import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.auth import TokenVerifier, get_token_verifier
from app.db import InMemoryDatabase
from app.deps import Services, get_services
from app.jobs import INTERRUPTED, InMemoryJobStore
from app.main import BUSY, create_app, get_job_runner
from app.pipeline.analysis import Analysis, save_analysis
from app.pipeline.models import Job, JobKind, JobStatus, Locator, MeterChange, PlayOrderRow
from app.pipeline.stages import AudioResult, FakeDownbeatStage
from app.settings import Settings, get_settings
from app.storage import InMemoryStorage
from app.supabase_rest import RestError
from tests.inline_runner import InlineRunner

SECRET = "route-test-shared-secret-0123456789abcdef"
OWNER = "user-owner"
STRANGER = "user-stranger"
PIECE = "piece-1"
MEMBER = "user-member"
TRIAL_OWNER = "user-trial"
ALLOWED_ORIGIN = "https://app.example.com"

ROUTES = [
    ("/jobs/process-piece", JobKind.PROCESS_PIECE),
    ("/jobs/realign", JobKind.REALIGN),
    ("/jobs/add-parts", JobKind.ADD_PARTS),
]


UPLOAD_ROUTES = [route for route in ROUTES if route[1] is not JobKind.REALIGN]


def token_for(user_id: str, secret: str = SECRET) -> str:
    now = int(time.time())
    claims = {"sub": user_id, "aud": "authenticated", "iat": now, "exp": now + 3600}
    return jwt.encode(claims, secret, algorithm="HS256")


def bearer(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_for(user_id)}"}


@dataclass
class World:
    client: TestClient
    db: InMemoryDatabase
    storage: InMemoryStorage
    jobs: InMemoryJobStore


@pytest.fixture
def world() -> World:
    db = InMemoryDatabase()
    db.add_piece(PIECE, OWNER)
    db.set_plan(OWNER, "creator")
    # The orchestrator needs a score file to process; realign needs a saved map to refit.
    db.add_score_file(PIECE, "file-1", f"{OWNER}/{PIECE}/score.pdf")
    db.save_structure(
        PIECE,
        [PlayOrderRow(start=1, end=8)],
        [MeterChange(numerator=4, denominator=4, from_bar=1)],
        [],
    )
    db.add_locators(
        PIECE, [Locator(bar=bar, pass_index=0, time_sec=float(bar)) for bar in range(1, 9)]
    )
    storage = InMemoryStorage()
    jobs = InMemoryJobStore()
    services = Services(db=db, storage=storage, jobs=jobs)
    app = create_app(Settings(allowed_origins=(ALLOWED_ORIGIN,)))
    app.dependency_overrides[get_services] = lambda: services
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(hs256_secret=SECRET)
    app.dependency_overrides[get_job_runner] = InlineRunner
    return World(client=TestClient(app), db=db, storage=storage, jobs=jobs)


def test_health_still_works(world: World) -> None:
    response = world.client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_no_token_is_401_and_creates_no_job(world: World, path: str, kind: JobKind) -> None:
    response = world.client.post(path, json={"piece_id": PIECE})
    assert response.status_code == 401
    assert world.jobs.history == {}


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_bad_token_is_401_and_creates_no_job(world: World, path: str, kind: JobKind) -> None:
    wrong_secret = "some-other-secret-0123456789abcdef"
    forged = {"Authorization": f"Bearer {token_for(OWNER, secret=wrong_secret)}"}
    response = world.client.post(path, json={"piece_id": PIECE}, headers=forged)
    assert response.status_code == 401
    garbage = world.client.post(
        path, json={"piece_id": PIECE}, headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert garbage.status_code == 401
    assert world.jobs.history == {}


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_unknown_piece_is_404_and_creates_no_job(world: World, path: str, kind: JobKind) -> None:
    response = world.client.post(path, json={"piece_id": "no-such-piece"}, headers=bearer(OWNER))
    assert response.status_code == 404
    assert world.jobs.history == {}


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_wrong_owner_is_403_and_creates_no_job(world: World, path: str, kind: JobKind) -> None:
    response = world.client.post(path, json={"piece_id": PIECE}, headers=bearer(STRANGER))
    assert response.status_code == 403
    assert world.jobs.history == {}


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_a_member_of_the_piece_gets_403_and_no_job(world: World, path: str, kind: JobKind) -> None:
    response = world.client.post(path, json={"piece_id": PIECE}, headers=bearer(MEMBER))
    assert response.status_code == 403
    assert world.jobs.history == {}


def plan_limit(key: str) -> dict[str, Any]:
    return {"detail": {"code": "plan_limit", "limit": key}}


FOUR_FOUR = [MeterChange(numerator=4, denominator=4, from_bar=1)]


def trial_piece(world: World, parts: int = 1, ticked: int = 0, piece: str = "piece-2") -> None:
    """A piece of a Trial owner with `parts` parts, the first `ticked` of them ticked for
    Advanced Reading (rows the browser could not add on Trial; the route must still refuse)."""
    world.db.add_piece(piece, TRIAL_OWNER)
    for index in range(parts):
        world.db.add_score_file(
            piece,
            f"{piece}-file-{index}",
            f"{TRIAL_OWNER}/{piece}/{index}.pdf",
            position=index,
            box_check=index < ticked,
        )


def post(world: World, path: str, user: str = TRIAL_OWNER, piece: str = "piece-2") -> Any:
    return world.client.post(path, json={"piece_id": piece}, headers=bearer(user))


def created_events(world: World, user: str = TRIAL_OWNER) -> list[bool]:
    """For each piece_created event of the user: has it been given back (voided)?"""
    return [e["voided_at"] is not None for e in world.db.events_of(user, "piece_created")]


@pytest.mark.parametrize(("path", "kind"), UPLOAD_ROUTES)
def test_a_trial_piece_with_one_plain_part_may_upload(
    world: World, path: str, kind: JobKind
) -> None:
    trial_piece(world)
    assert post(world, path).status_code == 200
    assert created_events(world) == [False]


@pytest.mark.parametrize(("path", "kind"), UPLOAD_ROUTES)
def test_several_parts_on_trial_are_refused_with_the_limit_and_make_no_job(
    world: World, path: str, kind: JobKind
) -> None:
    trial_piece(world, parts=2)
    response = post(world, path)
    assert response.status_code == 403
    assert response.json() == plan_limit("parts_per_piece_max")
    assert "uploads are limited" not in response.text
    assert world.jobs.history == {}


@pytest.mark.parametrize(("path", "kind"), UPLOAD_ROUTES)
def test_a_ticked_part_on_trial_is_refused_as_advanced_reading(
    world: World, path: str, kind: JobKind
) -> None:
    trial_piece(world, parts=1, ticked=1)
    response = post(world, path)
    assert response.status_code == 403
    assert response.json() == plan_limit("advanced_reading")
    assert world.jobs.history == {}


def test_a_refused_first_processing_gives_its_piece_back_and_add_parts_does_not(
    world: World,
) -> None:
    trial_piece(world, parts=2, piece="piece-2")
    trial_piece(world, parts=2, piece="piece-3")
    assert created_events(world) == [False, False]
    assert post(world, "/jobs/add-parts", piece="piece-2").status_code == 403
    assert created_events(world) == [False, False]  # add-parts: nothing to give back
    assert world.db.get_piece_owner("piece-2") == TRIAL_OWNER  # and nothing is deleted
    assert post(world, "/jobs/process-piece", piece="piece-2").status_code == 403
    assert created_events(world) == [True, False]  # only piece-2's event, and only once
    # The piece is gone (final review I2): it cannot be processed again after its files are swapped.
    assert post(world, "/jobs/process-piece", piece="piece-2").status_code == 404
    assert created_events(world) == [True, False]
    assert world.db.usage_of(TRIAL_OWNER)["pieces_created"] == 1
    assert world.db.usage_of(TRIAL_OWNER)["pieces_stored"] == 1  # piece-3 stays


def test_process_piece_claims_the_slot_of_a_piece_voided_at_job_time(world: World) -> None:
    # A job-time refusal voided the event and kept the piece; the next process-piece counts it.
    trial_piece(world, parts=1, piece="piece-2")
    world.db.void_piece_created("piece-2")
    assert created_events(world) == [True]
    assert post(world, "/jobs/process-piece", piece="piece-2").status_code == 200
    assert created_events(world) == [False]


def test_process_piece_answers_403_when_the_slot_was_used_meanwhile(world: World) -> None:
    trial_piece(world, parts=1, piece="piece-2")
    world.db.void_piece_created("piece-2")
    for name in ("piece-a", "piece-b", "piece-c"):
        world.db.add_piece(name, TRIAL_OWNER)  # three live pieces made: Trial's limit
    refused = post(world, "/jobs/process-piece", piece="piece-2")
    assert refused.status_code == 403
    assert refused.json() == plan_limit("pieces_created_max")
    assert world.jobs.history == {}
    assert created_events(world) == [True, False, False, False]  # still voided
    assert world.db.get_piece_owner("piece-2") is None  # a route-time refusal takes the piece back


def test_add_parts_does_not_claim(world: World) -> None:
    trial_piece(world, parts=1, piece="piece-2")
    world.db.void_piece_created("piece-2")
    world.db.save_page_layer("piece-2-file-0", [{"page_index": 0}], [])
    assert post(world, "/jobs/add-parts", piece="piece-2").status_code == 200
    assert created_events(world) == [True]


def upload_parts(world: World, piece: str = "piece-2", count: int = 2) -> list[str]:
    paths = [f"{TRIAL_OWNER}/{piece}/{index}.pdf" for index in range(count)]
    for path in paths:
        world.storage.upload(path, b"%PDF", "application/pdf")
    return paths


def test_a_refused_first_processing_deletes_the_pieces_rows_and_files_and_only_its_own(
    world: World,
) -> None:
    trial_piece(world, parts=2, piece="piece-2")
    trial_piece(world, parts=1, piece="piece-3")
    mine = upload_parts(world, "piece-2")
    mine.append(f"{TRIAL_OWNER}/piece-2/parts/listed-only-in-the-folder.pdf")
    world.storage.upload(mine[-1], b"%PDF", "application/pdf")
    world.storage.upload(f"{TRIAL_OWNER}/piece-2/upload/recording.mp3", b"mp3", "audio/mpeg")
    neighbour = upload_parts(world, "piece-3", 1)[0]
    elsewhere = f"{OWNER}/{PIECE}/score.pdf"  # another user's file
    world.storage.upload(elsewhere, b"%PDF", "application/pdf")
    # A part row that points outside the piece's folder must not take the stranger's file with it.
    world.db.add_score_file("piece-2", "piece-2-file-evil", elsewhere, position=5)

    assert post(world, "/jobs/process-piece", piece="piece-2").status_code == 403

    assert world.db.get_piece_owner("piece-2") is None
    assert world.db.list_score_files("piece-2") == []
    assert world.storage.paths() == sorted([neighbour, elsewhere])
    assert world.db.get_piece_owner("piece-3") == TRIAL_OWNER
    assert world.db.list_score_files("piece-3") != []
    assert created_events(world) == [True, False]


def test_the_slot_comes_back_only_when_the_piece_is_gone(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    trial_piece(world, parts=2, piece="piece-2")
    upload_parts(world)

    def broken(piece_id: str) -> None:
        raise RestError(503, None)

    monkeypatch.setattr(world.db, "delete_piece", broken)
    response = post(world, "/jobs/process-piece", piece="piece-2")

    assert response.status_code == 403  # the refusal still reaches the caller
    assert response.json() == plan_limit("parts_per_piece_max")
    assert world.db.get_piece_owner("piece-2") == TRIAL_OWNER
    assert created_events(world) == [False]  # still counted: the piece still exists
    assert len(world.storage.paths()) == 2  # and its files stay


def test_a_refused_processing_of_a_piece_that_was_processed_before_keeps_its_created_event(
    world: World,
) -> None:
    trial_piece(world, parts=2)
    world.db.save_page_layer("piece-2-file-0", [{"page_index": 0}], [])  # read before
    world.db.save_structure("piece-2", [PlayOrderRow(start=1, end=8)], FOUR_FOUR, [])
    response = post(world, "/jobs/process-piece")
    assert response.status_code == 403
    assert response.json() == plan_limit("parts_per_piece_max")
    assert created_events(world) == [False]
    trial_piece(world, parts=2, piece="piece-3")  # never processed: voided
    assert post(world, "/jobs/process-piece", piece="piece-3").status_code == 403
    assert created_events(world) == [False, True]


def test_a_processed_piece_with_its_parts_replaced_is_not_deleted_by_a_refusal(
    world: World,
) -> None:
    # Final re-review I2: every part unrendered is also true after a processed piece's parts are
    # replaced; only a piece with no play order (never processed) is a first processing.
    trial_piece(world, parts=2)  # two fresh, unrendered parts (the old ones were replaced)
    world.db.save_structure("piece-2", [PlayOrderRow(start=1, end=8)], FOUR_FOUR, [])
    response = post(world, "/jobs/process-piece")
    assert response.status_code == 403
    assert response.json() == plan_limit("parts_per_piece_max")
    assert world.db.get_piece_owner("piece-2") == TRIAL_OWNER
    assert len(world.db.list_score_files("piece-2")) == 2
    assert created_events(world) == [False]


def test_a_ticked_part_that_already_has_pages_is_not_counted_again(world: World) -> None:
    trial_piece(world, parts=1, ticked=1)
    world.db.save_page_layer("piece-2-file-0", [{"page_index": 0}], [])
    assert post(world, "/jobs/add-parts").status_code == 200  # nothing left to read


def test_a_ticked_part_is_refused_once_the_months_parts_are_used(world: World) -> None:
    world.db.add_piece("piece-2", TRIAL_OWNER)
    world.db.set_plan(TRIAL_OWNER, "creator")  # 30 parts a month
    for index in range(2):
        world.db.add_score_file(
            "piece-2", f"f{index}", f"{TRIAL_OWNER}/piece-2/{index}.pdf", box_check=True
        )
    world.db.record_usage(TRIAL_OWNER, "advanced_reading_part", "piece-2", None, 29)
    refused = post(world, "/jobs/process-piece")
    assert refused.status_code == 403
    assert refused.json() == plan_limit("advanced_reading_parts_per_month")
    assert world.db.get_piece_owner("piece-2") is None  # a refused first processing: taken back
    world.db.set_plan_limits("creator", advanced_reading_parts_per_month=31)
    world.db.add_piece("piece-3", TRIAL_OWNER)
    for index in range(2):
        world.db.add_score_file(
            "piece-3", f"g{index}", f"{TRIAL_OWNER}/piece-3/{index}.pdf", box_check=True
        )
    assert post(world, "/jobs/process-piece", piece="piece-3").status_code == 200


def read_creator_piece(world: World, ticked: int = 2) -> None:
    """A Creator's piece whose ticked parts were all read before (they have pages)."""
    world.db.add_piece("piece-2", TRIAL_OWNER)
    world.db.set_plan(TRIAL_OWNER, "creator")  # 30 parts a month
    for index in range(ticked):
        file_id = f"f{index}"
        world.db.add_score_file(
            "piece-2", file_id, f"{TRIAL_OWNER}/piece-2/{index}.pdf", position=index, box_check=True
        )
        world.db.save_page_layer(file_id, [{"page_index": 0}], [])
    world.db.save_structure("piece-2", [PlayOrderRow(start=1, end=8)], FOUR_FOUR, [])


def test_process_piece_counts_every_ticked_part_it_will_read_again(world: World) -> None:
    # Final review I3: process-piece reads every part of the piece, not only the ones without pages.
    read_creator_piece(world)
    world.db.record_usage(TRIAL_OWNER, "advanced_reading_part", "piece-2", None, 29)
    refused = post(world, "/jobs/process-piece")
    assert refused.status_code == 403
    assert refused.json() == plan_limit("advanced_reading_parts_per_month")
    # add-parts reads only the parts without pages: nothing left, nothing counted.
    assert post(world, "/jobs/add-parts").status_code == 200


def test_process_piece_on_a_piece_moved_to_trial_is_refused_as_advanced_reading(
    world: World,
) -> None:
    read_creator_piece(world, ticked=1)
    world.db.set_plan(TRIAL_OWNER, "trial")  # the ticks stay, the plan has no Advanced Reading
    refused = post(world, "/jobs/process-piece")
    assert refused.status_code == 403
    assert refused.json() == plan_limit("advanced_reading")
    assert world.db.get_piece_owner("piece-2") == TRIAL_OWNER  # it was read before: not deleted


@pytest.mark.parametrize(("path", "kind"), UPLOAD_ROUTES)
def test_a_creator_and_the_admin_may_upload_several_ticked_parts(
    world: World, path: str, kind: JobKind
) -> None:
    trial_piece(world, parts=3, ticked=2)
    world.db.set_plan(TRIAL_OWNER, "creator")
    assert post(world, path).status_code == 200
    trial_piece(world, parts=3, ticked=3, piece="piece-3")
    world.db.set_plan(TRIAL_OWNER, "trial")
    world.db.add_admin(TRIAL_OWNER)
    assert post(world, path, piece="piece-3").status_code == 200


def add_realign_piece(world: World, user: str) -> None:
    world.db.add_piece("piece-2", user)
    world.db.add_score_file("piece-2", "file-2", f"{user}/piece-2/score.pdf")
    world.db.save_structure(
        "piece-2",
        [PlayOrderRow(start=1, end=8)],
        [MeterChange(numerator=4, denominator=4, from_bar=1)],
        [],
    )
    world.db.add_locators(
        "piece-2", [Locator(bar=bar, pass_index=0, time_sec=float(bar)) for bar in range(1, 9)]
    )


def test_a_trial_owner_can_realign_and_the_realign_is_recorded_once(world: World) -> None:
    add_realign_piece(world, TRIAL_OWNER)
    response = post(world, "/jobs/realign")
    assert response.status_code == 200
    assert [e["piece_id"] for e in world.db.events_of(TRIAL_OWNER, "realign")] == ["piece-2"]
    assert world.db.plan_state(TRIAL_OWNER, "piece-2")["piece"]["realigns"] == 1


def test_a_realign_past_the_plans_limit_is_refused_and_not_recorded(world: World) -> None:
    add_realign_piece(world, TRIAL_OWNER)
    world.db.record_usage(TRIAL_OWNER, "realign", "piece-2", None, 4)
    assert post(world, "/jobs/realign").status_code == 200  # the 5th of 5
    refused = post(world, "/jobs/realign")
    assert refused.status_code == 403
    assert refused.json() == plan_limit("realign_per_piece_max")
    assert len(world.db.events_of(TRIAL_OWNER, "realign")) == 5
    assert len(world.jobs.history) == 1


def test_a_realign_that_finds_the_piece_busy_is_not_recorded(world: World) -> None:
    world.client.app.dependency_overrides[get_job_runner] = Holding
    add_realign_piece(world, TRIAL_OWNER)
    assert post(world, "/jobs/realign").status_code == 200
    assert post(world, "/jobs/realign").status_code == 409
    assert len(world.db.events_of(TRIAL_OWNER, "realign")) == 1


def test_a_creator_and_the_admin_realign_without_a_limit(world: World) -> None:
    for user, make_admin in ((TRIAL_OWNER, False), ("user-admin", True)):
        if make_admin:
            world.db.add_admin(user)
        else:
            world.db.set_plan(user, "creator")
        world.db.add_piece(f"p-{user}", user)
        world.db.record_usage(user, "realign", f"p-{user}", None, 99)
        assert post(world, "/jobs/realign", user, f"p-{user}").status_code == 200


def test_the_other_job_routes_record_no_realign(world: World) -> None:
    trial_piece(world)
    post(world, "/jobs/process-piece")
    post(world, "/jobs/add-parts")
    assert world.db.events_of(TRIAL_OWNER, "realign") == []


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_owner_starts_the_job_and_is_answered_queued(
    world: World, path: str, kind: JobKind
) -> None:
    response = world.client.post(path, json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"job_id", "status"}
    assert body["status"] == "queued"
    job = world.jobs.get(body["job_id"])
    assert job is not None
    assert job.piece_id == PIECE
    assert job.kind == kind
    assert job.status == JobStatus.DONE
    assert job.progress == 1.0
    assert world.jobs.history[body["job_id"]] == [
        JobStatus.QUEUED,
        JobStatus.RUNNING,
        JobStatus.DONE,
    ]
    assert list(world.jobs.history) == [body["job_id"]]


class Holding:
    """A runner that takes the job and never runs it: the job stays queued."""

    def __init__(self) -> None:
        self.held: list[Job] = []

    def submit(self, job: Job, services: Services) -> None:
        self.held.append(job)

    def knows(self, job_id: str) -> bool:
        return any(job.id == job_id for job in self.held)

    def shutdown(self) -> None:
        pass


def test_a_job_route_answers_before_the_job_ends(world: World) -> None:
    holding = Holding()
    world.client.app.dependency_overrides[get_job_runner] = lambda: holding
    body = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER)).json()
    assert body["status"] == "queued"
    stored = world.jobs.get(body["job_id"])
    assert stored is not None
    assert stored.status == JobStatus.QUEUED
    assert [job.id for job in holding.held] == [body["job_id"]]


def test_a_second_job_on_a_busy_piece_is_409_in_a_sentence_and_makes_no_job(world: World) -> None:
    holding = Holding()
    world.client.app.dependency_overrides[get_job_runner] = lambda: holding
    first = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    second = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"] == BUSY
    assert BUSY == "This piece is still being prepared; try again when it is done."
    assert len(world.jobs.history) == 1
    assert len(holding.held) == 1


class Refusing:
    """A runner that cannot take the job (no thread could be started, or it was stopped)."""

    def submit(self, job: Job, services: Services) -> None:
        raise RuntimeError("can't start new thread: https://x.example/private")

    def knows(self, job_id: str) -> bool:
        return False

    def shutdown(self) -> None:
        pass


def test_a_job_the_runner_cannot_take_ends_as_failed_and_does_not_lock_the_piece(
    world: World,
) -> None:
    world.client.app.dependency_overrides[get_job_runner] = Refusing
    response = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 503
    assert "private" not in response.text
    (job_id,) = world.jobs.history
    stored = world.jobs.get(job_id)
    assert stored is not None
    assert stored.status == JobStatus.ERROR
    assert stored.error is not None and "private" not in stored.error
    world.client.app.dependency_overrides[get_job_runner] = InlineRunner
    again = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert again.status_code == 200  # the piece is free again


def old_job(world: World, minutes: float) -> Job:
    """A job on the piece whose last update was `minutes` ago."""
    world.jobs.clock = lambda: datetime.now(UTC) - timedelta(minutes=minutes)
    job = world.jobs.create(PIECE, JobKind.REALIGN)
    world.jobs.update(job.id, status=JobStatus.RUNNING)
    world.jobs.clock = lambda: datetime.now(UTC)
    return job


def test_a_row_no_process_knows_and_nobody_touched_for_ten_minutes_is_ended_and_the_job_made(
    world: World,
) -> None:
    holding = Holding()
    world.client.app.dependency_overrides[get_job_runner] = lambda: holding
    stale = old_job(world, 11)
    response = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 200
    ended = world.jobs.get(stale.id)
    assert ended is not None
    assert ended.status == JobStatus.ERROR
    assert ended.error == INTERRUPTED
    assert [job.id for job in holding.held] == [response.json()["job_id"]]


def test_the_log_says_a_stale_job_was_ended_only_when_the_write_landed(
    world: World, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.job_end.pause", lambda seconds: None)
    holding = Holding()
    world.client.app.dependency_overrides[get_job_runner] = lambda: holding
    old_job(world, 11)

    def refuse(job_id: str, **changes: object) -> Job:
        raise RuntimeError("down")

    monkeypatch.setattr(world.jobs, "update", refuse)
    response = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 409
    assert "ended job" not in caplog.text


def test_a_failing_stale_check_is_logged_by_type_and_answers_409(
    world: World, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    world.client.app.dependency_overrides[get_job_runner] = lambda: Holding()
    old_job(world, 11)

    def broken(piece_id: str) -> None:
        raise RestError(503, None)

    monkeypatch.setattr(world.jobs, "active_job", broken)
    response = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 409
    assert "RestError" in caplog.text


def test_a_row_touched_a_minute_ago_that_no_process_knows_is_still_409(world: World) -> None:
    holding = Holding()
    world.client.app.dependency_overrides[get_job_runner] = lambda: holding
    fresh = old_job(world, 1)
    response = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 409
    assert response.json()["detail"] == BUSY
    active = world.jobs.get(fresh.id)
    assert active is not None and active.status == JobStatus.RUNNING
    assert holding.held == []


def test_a_row_the_runner_knows_is_never_ended_however_long_it_has_been_quiet(
    world: World,
) -> None:
    holding = Holding()
    world.client.app.dependency_overrides[get_job_runner] = lambda: holding
    quiet = old_job(world, 60)
    holding.held.append(quiet)  # this process is running it (a long stage with no progress write)
    response = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert response.status_code == 409
    active = world.jobs.get(quiet.id)
    assert active is not None and active.status == JobStatus.RUNNING


def test_each_request_makes_its_own_job(world: World) -> None:
    first = world.client.post(ROUTES[0][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    second = world.client.post(ROUTES[1][0], json={"piece_id": PIECE}, headers=bearer(OWNER))
    assert first.json()["job_id"] != second.json()["job_id"]
    assert len(world.jobs.history) == 2


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_body_without_piece_id_is_422(world: World, path: str, kind: JobKind) -> None:
    for payload in ({}, {"piece": PIECE}, {"piece_id": ""}, {"piece_id": None}):
        response = world.client.post(path, json=payload, headers=bearer(OWNER))
        assert response.status_code == 422, payload
    assert world.jobs.history == {}


def test_cors_preflight_from_an_allowed_origin(world: World) -> None:
    response = world.client.options(
        "/jobs/process-piece",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed
    assert "content-type" in allowed
    assert "access-control-allow-credentials" not in response.headers


def test_cors_preflight_from_another_origin_gets_no_allow_origin(world: World) -> None:
    response = world.client.options(
        "/jobs/process-piece",
        headers={
            "Origin": "https://evil.example.org",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert "access-control-allow-origin" not in response.headers


def test_cors_header_on_a_real_response_only_for_an_allowed_origin(world: World) -> None:
    allowed = world.client.get("/health", headers={"Origin": ALLOWED_ORIGIN})
    other = world.client.get("/health", headers={"Origin": "https://evil.example.org"})
    assert allowed.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert "access-control-allow-origin" not in other.headers


def test_no_allowed_origins_means_no_cors_headers() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/health", headers={"Origin": ALLOWED_ORIGIN})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


# --- the fakes / real services switch in get_services ------------------------------------------


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in (
        "USE_FAKES",
        "SUPABASE_URL",
        "SUPABASE_JWT_SECRET",
        "SUPABASE_JWKS_URL",
        "SUPABASE_SECRET_KEY",
        "ALLOWED_ORIGINS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(deps, "_fakes", None)
    monkeypatch.setattr(deps, "_real", None)
    return monkeypatch


def test_no_supabase_settings_gives_one_process_wide_set_of_fakes(
    clean_env: pytest.MonkeyPatch,
) -> None:
    first = get_services()
    assert first is get_services()
    assert isinstance(first.db, InMemoryDatabase)
    assert isinstance(first.storage, InMemoryStorage)
    assert isinstance(first.jobs, InMemoryJobStore)


def test_use_fakes_gives_fakes_even_with_supabase_settings(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("USE_FAKES", "1")
    clean_env.setenv("SUPABASE_URL", "https://project.supabase.example")
    clean_env.setenv("SUPABASE_JWT_SECRET", "secret")
    services = get_services()
    assert isinstance(services.db, InMemoryDatabase)
    assert services is get_services()


@pytest.mark.parametrize(
    ("name", "value", "missing"),
    [
        ("SUPABASE_URL", "https://project.supabase.example", "SUPABASE_SECRET_KEY"),
        ("SUPABASE_JWT_SECRET", "secret", "SUPABASE_URL and SUPABASE_SECRET_KEY"),
        (
            "SUPABASE_JWKS_URL",
            "https://project.supabase.example/jwks.json",
            "SUPABASE_URL and SUPABASE_SECRET_KEY",
        ),
        ("SUPABASE_SECRET_KEY", "sb_secret_x", "SUPABASE_URL"),
    ],
)
def test_half_a_supabase_configuration_is_refused_by_name_never_by_value(
    clean_env: pytest.MonkeyPatch, name: str, value: str, missing: str
) -> None:
    clean_env.setenv(name, value)
    with pytest.raises(RuntimeError, match=missing) as refused:
        get_services()
    assert value not in str(refused.value)


def test_supabase_settings_give_the_real_services(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("SUPABASE_URL", "https://project.supabase.example")
    clean_env.setenv("SUPABASE_SECRET_KEY", "sb_secret_x")
    services = get_services()
    assert type(services.db).__name__ == "SupabaseDatabase"
    assert type(services.storage).__name__ == "SupabaseStorage"
    assert type(services.jobs).__name__ == "SupabaseJobStore"
    assert get_services() is services  # one connection pool per process


def test_use_fakes_wins_over_a_complete_supabase_configuration(
    clean_env: pytest.MonkeyPatch,
) -> None:
    clean_env.setenv("USE_FAKES", "1")
    clean_env.setenv("SUPABASE_URL", "https://project.supabase.example")
    clean_env.setenv("SUPABASE_SECRET_KEY", "sb_secret_x")
    assert isinstance(get_services().db, InMemoryDatabase)


def test_a_malformed_key_is_refused_without_quoting_it(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("SUPABASE_URL", "https://project.supabase.example")
    clean_env.setenv("SUPABASE_SECRET_KEY", "sb_secret_x\x01tail")
    with pytest.raises(ValueError, match="characters") as refused:
        get_services()
    assert "tail" not in str(refused.value)


def test_the_default_app_serves_jobs_on_fakes(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("SUPABASE_JWT_SECRET", "x" * 40)
    clean_env.setenv("USE_FAKES", "true")
    app = create_app(Settings())
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(hs256_secret=SECRET)
    services = get_services()
    assert isinstance(services.db, InMemoryDatabase)
    services.db.add_piece(PIECE, OWNER)
    services.db.add_admin(OWNER)  # the fakes start everyone on Trial; the admin is never limited
    services.db.add_score_file(PIECE, "file-1", f"{OWNER}/{PIECE}/score.pdf")
    response = TestClient(app).post(
        "/jobs/process-piece", json={"piece_id": PIECE}, headers=bearer(OWNER)
    )
    assert response.status_code == 200
    assert response.json()["status"] == "queued"


def test_the_server_starts_on_fakes_without_any_tool() -> None:
    with TestClient(create_app(Settings(use_fakes=True))) as client:
        assert client.get("/health").json() == {"status": "ok"}


def test_the_server_with_real_services_refuses_to_start_when_a_tool_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.pipeline.real_stages.missing_tool", lambda: "Java is not installed.")
    app = create_app(
        Settings(supabase_url="https://abc.supabase.co", supabase_secret_key="sb_secret_x")
    )

    with pytest.raises(RuntimeError, match="Java is not installed"), TestClient(app):
        pass


def test_the_server_refuses_to_start_on_half_a_supabase_configuration() -> None:
    app = create_app(Settings(supabase_url="https://abc.supabase.co"))

    with pytest.raises(RuntimeError, match="SUPABASE_SECRET_KEY"), TestClient(app):
        pass


# --- startup and shutdown ------------------------------------------------------------------------


def real_env(clean_env: pytest.MonkeyPatch, key: str = "sb_secret_x") -> pytest.MonkeyPatch:
    clean_env.setenv("SUPABASE_URL", "https://project.supabase.example")
    clean_env.setenv("SUPABASE_SECRET_KEY", key)
    clean_env.setattr("app.main.startup_notes", lambda settings: [])
    return clean_env


def test_startup_ends_jobs_cut_off_by_a_redeploy(clean_env: pytest.MonkeyPatch) -> None:
    real_env(clean_env)
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.REALIGN)
    clean_env.setattr(
        "app.main.get_services",
        lambda: Services(db=InMemoryDatabase(), storage=InMemoryStorage(), jobs=jobs),
    )
    with TestClient(create_app(get_settings())):
        pass
    stored = jobs.get(job.id)
    assert stored is not None
    assert stored.status == JobStatus.ERROR
    assert stored.error == INTERRUPTED


def test_shutdown_leaves_a_running_job_alone(clean_env: pytest.MonkeyPatch) -> None:
    # An overlapping deploy's new process may already own a job; only startup sweeps (F10).
    real_env(clean_env)
    jobs = InMemoryJobStore()
    clean_env.setattr(
        "app.main.get_services",
        lambda: Services(db=InMemoryDatabase(), storage=InMemoryStorage(), jobs=jobs),
    )
    with TestClient(create_app(get_settings())):
        job = jobs.create(PIECE, JobKind.REALIGN)
    stored = jobs.get(job.id)
    assert stored is not None
    assert stored.status == JobStatus.QUEUED


class UnreachableJobs(InMemoryJobStore):
    def fail_interrupted(self) -> int:
        raise RestError(503, None)


def test_the_service_starts_when_supabase_cannot_be_reached_at_startup(
    clean_env: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    real_env(clean_env)
    clean_env.setattr(
        "app.main.get_services",
        lambda: Services(db=InMemoryDatabase(), storage=InMemoryStorage(), jobs=UnreachableJobs()),
    )
    with TestClient(create_app(get_settings())) as client:
        assert client.get("/health").json() == {"status": "ok"}
    assert "interrupted" in caplog.text
    assert "RestError" in caplog.text  # the type, never the message


def test_the_service_starts_with_a_malformed_key_and_says_nothing_of_it(
    clean_env: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    real_env(clean_env, key="sb_secret_x\x01tail")
    with TestClient(create_app(get_settings())) as client:
        assert client.get("/health").json() == {"status": "ok"}
    assert "tail" not in caplog.text
    assert "interrupted" in caplog.text
    assert "ValueError" in caplog.text


def test_the_service_starts_with_no_variables_at_all(clean_env: pytest.MonkeyPatch) -> None:
    with TestClient(create_app(get_settings())) as client:
        assert client.get("/health").json() == {"status": "ok"}
        # the one worker is made once, at startup, not by two first requests at the same time
        assert get_job_runner.cache_info().currsize == 1


FILL_BODY = {
    "timing": {
        "barCount": 8,
        "playOrder": [{"from": 1, "to": 8}],
        "meters": [{"fromBar": 1, "numerator": 4, "denominator": 4}],
        "marks": [],
        "locators": [{"bar": 1, "passIndex": 0, "timeSec": 0.5, "confirmed": True}],
    }
}


def fill(world: World, user: str | None, body: dict = FILL_BODY) -> Any:
    headers = bearer(user) if user else {}
    return world.client.post(f"/pieces/{PIECE}/fill", json=body, headers=headers)


def test_fill_refuses_like_the_job_routes(world: World) -> None:
    assert fill(world, None).status_code == 401
    assert fill(world, STRANGER).status_code == 403
    assert fill(world, MEMBER).status_code == 403
    response = world.client.post("/pieces/nothing/fill", json=FILL_BODY, headers=bearer(OWNER))
    assert response.status_code == 404


def test_fill_needs_the_analysis(world: World) -> None:
    assert fill(world, OWNER).status_code == 409


def test_fill_answers_the_timing_in_the_apps_shape_and_saves_nothing(world: World) -> None:
    audio = AudioResult(peaks={}, duration_sec=18.0)
    heard = FakeDownbeatStage().listen(audio)
    save_analysis(world.storage, OWNER, PIECE, Analysis(18.0, heard))
    before = world.db.get_locators(PIECE)
    response = fill(world, OWNER)
    assert response.status_code == 200
    assert len(response.json()["locators"]) == 8
    assert "timeSec" in response.json()["locators"][0]
    assert world.db.get_locators(PIECE) == before


def test_fill_refuses_a_timing_it_cannot_read_in_a_sentence(world: World) -> None:
    response = fill(world, OWNER, {"timing": {"barCount": "x"}})
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_fill_with_no_bar_to_start_from_is_422_in_a_sentence(world: World) -> None:
    audio = AudioResult(peaks={}, duration_sec=18.0)
    save_analysis(world.storage, OWNER, PIECE, Analysis(18.0, FakeDownbeatStage().listen(audio)))
    body = {"timing": {**FILL_BODY["timing"], "locators": []}}
    response = fill(world, OWNER, body)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_fill_refuses_a_huge_timing_in_a_sentence_before_it_loads_anything(world: World) -> None:
    # No analysis is saved: a 409 would mean the size was not looked at first.
    body = {
        "timing": {
            **FILL_BODY["timing"],
            "barCount": 200_000,
            "playOrder": [{"from": 1, "to": 200_000}],
        }
    }
    started = time.monotonic()
    response = fill(world, OWNER, body)
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert time.monotonic() - started < 1.0


# --- a body is limited, and an unauthenticated caller is turned away before one is read ----


MAX_BODY = 1_000_000


def _garbage(size: int) -> bytes:
    return b"{" + b"x" * size  # not JSON, so a parse would answer 422


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_an_oversized_body_with_no_token_is_413_and_never_parsed(
    world: World, path: str, kind: JobKind
) -> None:
    response = world.client.post(
        path, content=_garbage(MAX_BODY + 1), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert world.jobs.history == {}


def test_an_oversized_fill_body_is_413_for_a_signed_in_owner(world: World) -> None:
    response = world.client.post(
        f"/pieces/{PIECE}/fill",
        content=_garbage(MAX_BODY + 1),
        headers={**bearer(OWNER), "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_an_oversized_chunked_body_is_413_too(world: World) -> None:
    def chunks():  # no Content-Length: the size is only known by counting
        for _ in range(12):
            yield b"x" * 100_000

    response = world.client.post(
        "/jobs/realign",
        content=chunks(),
        headers={**bearer(OWNER), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert world.jobs.history == {}


def test_the_413_carries_the_cors_header_so_the_browser_can_read_it(world: World) -> None:
    response = world.client.post(
        "/jobs/realign",
        content=_garbage(MAX_BODY + 1),
        headers={"Origin": ALLOWED_ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN


def test_a_body_just_under_the_limit_is_read(world: World) -> None:
    padding = " " * (MAX_BODY - 100)
    response = world.client.post(
        "/jobs/realign",
        content=f'{{"piece_id": "{PIECE}"{padding}}}'.encode(),
        headers={**bearer(OWNER), "Content-Type": "application/json"},
    )
    assert response.status_code == 200


def test_a_real_sized_fill_body_passes(world: World) -> None:
    # The largest real timing (Los Banditos, 122 locators with their boxes) is under 200 KB.
    timing = {
        "barCount": 8,
        "playOrder": [{"from": 1, "to": 8}],
        "meters": [{"fromBar": 1, "numerator": 4, "denominator": 4}],
        "marks": [],
        "rests": [],
        "locators": [
            {"passIndex": 0, "barNumber": 1, "timeSec": 1.0, "confirmed": True, "flags": []}
        ],
        "pad": "x" * 300_000,
    }
    response = world.client.post(
        f"/pieces/{PIECE}/fill", json={"timing": timing}, headers=bearer(OWNER)
    )
    assert response.status_code != 413


@pytest.mark.parametrize(("path", "kind"), ROUTES)
def test_no_token_is_401_before_the_body_is_read(world: World, path: str, kind: JobKind) -> None:
    response = world.client.post(
        path, content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert world.jobs.history == {}


def test_no_token_on_fill_is_401_before_the_body_is_read(world: World) -> None:
    response = world.client.post(
        f"/pieces/{PIECE}/fill", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 401


def test_a_signed_in_caller_with_a_malformed_body_still_gets_422(world: World) -> None:
    response = world.client.post(
        "/jobs/realign",
        content=b"{not json",
        headers={**bearer(OWNER), "Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_the_health_check_and_preflight_ignore_the_body_rules(world: World) -> None:
    assert world.client.get("/health").status_code == 200
    preflight = world.client.options(
        "/jobs/realign",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert preflight.status_code == 200


def test_a_malformed_body_is_422_without_echoing_what_was_sent(world: World) -> None:
    response = world.client.post(
        "/jobs/realign",
        json={"piece_id": 7, "secret_note": "do-not-echo-this"},
        headers=bearer(OWNER),
    )
    assert response.status_code == 422
    assert "do-not-echo-this" not in response.text
