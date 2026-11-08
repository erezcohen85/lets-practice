"""The sample piece: deciding, copying rows and files, the route, and Storage.copy over HTTP."""

import json
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.auth import TokenVerifier, get_token_verifier
from app.db import Database, InMemoryDatabase
from app.deps import Services, get_services
from app.jobs import InMemoryJobStore
from app.main import create_app
from app.pipeline.models import BarBox, Locator, PlayOrderRow
from app.pipeline.sample_piece import SampleAlready, SampleNoMaster, SampleState, decide
from app.sample_piece import SampleCopyFailed, SamplePieceService
from app.settings import Settings
from app.storage import InMemoryStorage
from app.supabase_db import SupabaseDatabase
from app.supabase_rest import RestError, SupabaseRest, SupabaseStorage
from tests.test_routes import SECRET, bearer

ADMIN = "user-admin"
U1 = "user-one"
FULL = "user-full"
MASTER = "11111111-1111-4111-8111-111111111111"
CREDITS = [{"what": "Recording", "by": "Someone", "licence": "CC BY 4.0"}]

FILES = {
    f"{ADMIN}/{MASTER}/parts/sf1.pdf": (b"pdf bytes", "application/pdf"),
    f"{ADMIN}/{MASTER}/pages/sf1-0.webp": (b"page zero", "image/webp"),
    f"{ADMIN}/{MASTER}/pages/sf1-1.webp": (b"page one", "image/webp"),
    f"{ADMIN}/{MASTER}/upload/recording.mp3": (b"original audio", "audio/mpeg"),
    f"{ADMIN}/{MASTER}/audio.m4a": (b"playback audio", "audio/mp4"),
}


def state(**values: Any) -> SampleState:
    base: dict[str, Any] = {
        "given_at": None,
        "has_master": True,
        "is_master_owner": False,
        "room": True,
    }
    return SampleState(**{**base, **values})


def master_world() -> tuple[InMemoryDatabase, InMemoryStorage]:
    """A master piece of the admin with one part (two pages, three bars), a recording, a play
    order and two locators, and its five files in Storage."""
    db = InMemoryDatabase()
    storage = InMemoryStorage()
    db.add_admin(ADMIN)
    db.add_piece(MASTER, ADMIN)
    db.add_score_file(
        MASTER, "sf1", f"{ADMIN}/{MASTER}/parts/sf1.pdf", name="Flute", page_count=2, sha256="abc"
    )
    db.save_page_layer(
        "sf1",
        [
            {
                "page_index": 0,
                "image_path": f"{ADMIN}/{MASTER}/pages/sf1-0.webp",
                "width": 800,
                "height": 1000,
            },
            {
                "page_index": 1,
                "image_path": f"{ADMIN}/{MASTER}/pages/sf1-1.webp",
                "width": 800,
                "height": 1000,
            },
        ],
        [
            BarBox(bar=1, page_index=0, x=0, y=0, w=10, h=10),
            BarBox(bar=2, page_index=0, x=10, y=0, w=10, h=10),
            BarBox(bar=3, page_index=1, x=0, y=0, w=10, h=10),
        ],
        rests=[2],
    )
    db.set_audio_source(
        MASTER, "file", f"{ADMIN}/{MASTER}/upload/recording.mp3", duration=61.0, name="Take 2"
    )
    db.set_audio_stored(MASTER, f"{ADMIN}/{MASTER}/audio.m4a", 61.0)
    db.save_structure(MASTER, [PlayOrderRow(start=1, end=3)], [], [])
    db.add_locators(
        MASTER,
        [
            Locator(bar=1, pass_index=0, time_sec=0.5, confirmed=True),
            Locator(bar=2, pass_index=0, time_sec=2.5),
        ],
    )
    for path, (data, content_type) in FILES.items():
        storage.upload(path, data, content_type)
    db.set_sample_master(MASTER, CREDITS)
    return db, storage


def fill_up(db: InMemoryDatabase, user: str, n: int = 3) -> None:
    for index in range(n):
        db.add_piece(f"{user}-piece-{index}", user)


class FailingOnThird(InMemoryStorage):
    """Storage whose third copy raises; later copies work again once `broken` is switched off."""

    def __init__(self) -> None:
        super().__init__()
        self.copies = 0
        self.broken = True

    def copy(self, source: str, destination: str) -> None:
        self.copies += 1
        if self.broken and self.copies == 3:
            raise OSError("storage went away")
        super().copy(source, destination)


# ---------------------------------------------------------------- deciding


def test_a_given_account_is_already_whatever_else_is_true() -> None:
    assert decide(state(given_at="2026-11-08T10:00:00Z")) == "already"
    assert decide(state(given_at="2026-11-08T10:00:00Z", has_master=False, room=False)) == "already"


def test_no_master_is_not_a_skip_that_marks() -> None:
    assert decide(state(has_master=False)) == "no_master"
    assert decide(state(has_master=False, room=False)) == "no_master"


def test_the_masters_owner_or_no_room_skips() -> None:
    assert decide(state(is_master_owner=True)) == "skip"
    assert decide(state(room=False)) == "skip"


def test_otherwise_it_copies() -> None:
    assert decide(state()) == "copy"


# ---------------------------------------------------------------- the service on fakes


def test_a_claim_copies_the_five_files_under_the_users_new_piece() -> None:
    db, storage = master_world()

    assert SamplePieceService(db, storage).claim(U1) == "given"

    (piece,) = db.pieces_of(U1)
    mine = [path for path in storage.paths() if path.startswith(f"{U1}/{piece}/")]
    assert sorted(path.removeprefix(f"{U1}/{piece}/") for path in mine) == sorted(
        path.removeprefix(f"{ADMIN}/{MASTER}/") for path in FILES
    )
    for old, (data, content_type) in FILES.items():
        new = f"{U1}/{piece}/{old.removeprefix(f'{ADMIN}/{MASTER}/')}"
        assert storage.download(new) == data
        assert storage.content_type(new) == content_type
        assert storage.download(old) == data  # the master's own files are untouched
        assert storage.content_type(old) == content_type
    assert len(storage.paths()) == 10


def test_a_claim_copies_the_rows_and_points_them_at_the_new_files() -> None:
    db, storage = master_world()
    SamplePieceService(db, storage).claim(U1)
    (piece,) = db.pieces_of(U1)
    prefix = f"{U1}/{piece}/"

    (part,) = db.list_score_files(piece)
    assert part["id"] != "sf1" and part["name"] == "Flute" and part["page_count"] == 2
    assert part["storage_path"] == f"{prefix}parts/sf1.pdf"
    pages, bars = db.get_page_layer(part["id"])
    assert [page["image_path"] for page in pages] == [
        f"{prefix}pages/sf1-0.webp",
        f"{prefix}pages/sf1-1.webp",
    ]
    assert [bar.bar for bar in bars] == [1, 2, 3]
    assert db.get_rests(part["id"]) == [2]
    audio = db.get_audio_source(piece)
    assert audio is not None
    assert audio["url_or_path"] == f"{prefix}upload/recording.mp3"
    assert audio["stored_path"] == f"{prefix}audio.m4a"
    assert audio["name"] == "Take 2"
    assert db.get_structure(piece)[0] == [PlayOrderRow(start=1, end=3)]
    assert [(item.bar, item.confirmed) for item in db.get_locators(piece)] == [
        (1, True),
        (2, False),
    ]
    # the master's own rows did not move
    assert db.list_score_files(MASTER)[0]["id"] == "sf1"
    assert db.get_audio_source(MASTER)["stored_path"] == f"{ADMIN}/{MASTER}/audio.m4a"  # type: ignore[index]


def test_a_second_claim_is_already_and_adds_nothing() -> None:
    db, storage = master_world()
    service = SamplePieceService(db, storage)
    assert service.claim(U1) == "given"
    before = storage.paths()

    assert service.claim(U1) == "already"

    assert storage.paths() == before
    assert len(db.pieces_of(U1)) == 1


def test_an_account_with_no_room_is_skipped_once_and_not_asked_again() -> None:
    db, storage = master_world()
    fill_up(db, FULL)
    service = SamplePieceService(db, storage)

    assert service.claim(FULL) == "skipped"
    assert db.sample_given_of(FULL) is False
    assert service.claim(FULL) == "already"
    assert db.pieces_of(FULL) == [f"{FULL}-piece-{index}" for index in range(3)]
    assert len(storage.paths()) == 5


def test_no_master_is_skipped_without_a_mark_and_the_next_claim_after_one_is_set_gives() -> None:
    db, storage = master_world()
    db.clear_sample_master()
    service = SamplePieceService(db, storage)

    assert service.claim(U1) == "skipped"
    assert service.claim(U1) == "skipped"  # asked again, not "already"
    assert db.sample_given_of(U1) is None

    db.set_sample_master(MASTER, CREDITS)
    assert service.claim(U1) == "given"
    assert db.sample_given_of(U1) is True


def test_the_master_owner_is_skipped_and_marked() -> None:
    db, storage = master_world()
    assert SamplePieceService(db, storage).claim(ADMIN) == "skipped"
    assert db.sample_given_of(ADMIN) is False
    assert SamplePieceService(db, storage).claim(ADMIN) == "already"


def test_a_failed_copy_leaves_nothing_behind_and_the_next_claim_works() -> None:
    db, _ = master_world()
    storage = FailingOnThird()
    for path, (data, content_type) in FILES.items():
        storage.upload(path, data, content_type)
    service = SamplePieceService(db, storage)

    with pytest.raises(SampleCopyFailed):
        service.claim(U1)

    assert db.pieces_of(U1) == []
    assert storage.paths() == sorted(FILES)  # the two copied files were deleted again
    assert db.sample_given_of(U1) is None  # unmarked: asked again next time
    assert db.list_score_files(MASTER)[0]["id"] == "sf1"

    storage.broken = False
    assert service.claim(U1) == "given"
    assert len(db.pieces_of(U1)) == 1


def test_a_failed_copy_gives_the_trial_slot_back() -> None:
    db, _ = master_world()
    storage = FailingOnThird()
    for path, (data, content_type) in FILES.items():
        storage.upload(path, data, content_type)
    service = SamplePieceService(db, storage)
    assert db.usage_of(U1)["pieces_created"] == 0

    for _ in range(2):  # a retry that fails again must not burn a slot either
        storage.copies = 0
        with pytest.raises(SampleCopyFailed):
            service.claim(U1)
        assert db.usage_of(U1)["pieces_created"] == 0
        assert db.usage_of(U1)["pieces_stored"] == 0
    assert [e["voided_at"] is not None for e in db.events_of(U1, "piece_created")] == [True, True]

    storage.broken = False
    assert service.claim(U1) == "given"
    assert db.usage_of(U1)["pieces_created"] == 1


def test_the_database_saying_already_returns_already_and_copies_no_file() -> None:
    db, storage = master_world()

    class TwoTabs(InMemoryDatabase):
        def copy_sample_piece(self, user_id: str, new_piece_id: str) -> list[tuple[str, str]]:
            raise SampleAlready()

    racing = TwoTabs()
    racing.__dict__.update(db.__dict__)

    assert SamplePieceService(racing, storage).claim(U1) == "already"
    assert len(storage.paths()) == 5


def test_the_database_saying_no_master_skips_without_a_mark() -> None:
    db, storage = master_world()

    class Gone(InMemoryDatabase):
        def copy_sample_piece(self, user_id: str, new_piece_id: str) -> list[tuple[str, str]]:
            raise SampleNoMaster()

    gone = Gone()
    gone.__dict__.update(db.__dict__)

    assert SamplePieceService(gone, storage).claim(U1) == "skipped"
    assert gone.sample_given_of(U1) is None
    assert len(storage.paths()) == 5


# ---------------------------------------------------------------- the fake mirrors 0016


def test_a_sample_counts_as_created_and_stored_but_not_in_the_daily_cap() -> None:
    db, storage = master_world()
    SamplePieceService(db, storage).claim(U1)

    usage = db.plan_state(U1)["usage"]
    assert usage["pieces_created"] == 1
    assert usage["pieces_stored"] == 1
    assert usage["new_pieces_today_on_plan"] == 0
    # an ordinary piece of the same plan still counts in the cap (the master is the admin's own)
    db.add_piece("p-ordinary", U1)
    assert db.plan_state(U1)["usage"]["new_pieces_today_on_plan"] == 1


def test_a_copy_keeps_the_credits_it_was_made_with() -> None:
    db, storage = master_world()
    SamplePieceService(db, storage).claim(U1)
    (piece,) = db.pieces_of(U1)
    assert db.sample_credits_of(piece) == CREDITS
    assert db.sample_credits_of(MASTER) is None

    db.set_sample_master(MASTER, [{"what": "Score", "by": "Other", "licence": "CC0"}])
    db.clear_sample_master()
    assert db.sample_credits_of(piece) == CREDITS


def test_the_state_says_given_has_master_owner_and_room() -> None:
    db, storage = master_world()
    fill_up(db, FULL)

    assert db.sample_state(U1) == SampleState(None, True, False, True)
    assert db.sample_state(ADMIN).is_master_owner is True
    assert db.sample_state(ADMIN).room is True  # the admin is never limited
    assert db.sample_state(FULL).room is False
    db.set_plan(FULL, "creator")  # pieces made is no limit, pieces stored is 50
    assert db.sample_state(FULL).room is True
    SamplePieceService(db, storage).claim(U1)
    assert db.sample_state(U1).given_at is not None
    db.clear_sample_master()
    assert db.sample_state("someone-else").has_master is False


def test_the_fake_meets_the_database_protocol() -> None:
    assert isinstance(InMemoryDatabase(), Database)


# ---------------------------------------------------------------- the route


@dataclass
class World:
    client: TestClient
    db: InMemoryDatabase
    storage: InMemoryStorage


def build(storage: InMemoryStorage | None = None) -> World:
    db, base = master_world()
    if storage is not None:
        for path, (data, content_type) in FILES.items():
            storage.upload(path, data, content_type)
    storage = storage or base
    services = Services(db=db, storage=storage, jobs=InMemoryJobStore())
    app = create_app(Settings(allowed_origins=()))
    app.dependency_overrides[get_services] = lambda: services
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(hs256_secret=SECRET)
    return World(TestClient(app), db, storage)


def test_the_route_needs_a_token() -> None:
    assert build().client.post("/sample-piece").status_code == 401


def test_the_route_gives_the_sample_once() -> None:
    world = build()

    first = world.client.post("/sample-piece", headers=bearer(U1))
    assert first.status_code == 200
    body = first.json()
    assert body["status"] == "given"
    assert world.db.pieces_of(U1) == [body["piece_id"]]

    second = world.client.post("/sample-piece", headers=bearer(U1))
    assert second.status_code == 200
    assert second.json() == {"status": "already", "piece_id": None}


def test_the_route_says_skipped_with_no_piece() -> None:
    world = build()
    fill_up(world.db, FULL)
    reply = world.client.post("/sample-piece", headers=bearer(FULL))
    assert reply.json() == {"status": "skipped", "piece_id": None}


def test_the_route_answers_503_when_a_file_copy_failed() -> None:
    world = build(FailingOnThird())
    reply = world.client.post("/sample-piece", headers=bearer(U1))
    assert reply.status_code == 503
    assert reply.json() == {"detail": {"code": "sample_failed"}}
    assert world.db.pieces_of(U1) == []


# ---------------------------------------------------------------- Storage.copy over HTTP


def storage_over(handler: Any) -> SupabaseStorage:
    rest = SupabaseRest("https://p.example", "sb_secret_x", transport=httpx.MockTransport(handler))
    return SupabaseStorage(rest)


def test_storage_copy_posts_the_bucket_and_both_keys() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"Key": "pieces/u1/p2/a.pdf"})

    storage_over(handler).copy(f"{ADMIN}/{MASTER}/a.pdf", "u1/p2/a.pdf")

    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/storage/v1/object/copy"
    assert json.loads(seen[0].content) == {
        "bucketId": "pieces",
        "sourceKey": f"{ADMIN}/{MASTER}/a.pdf",
        "destinationKey": "u1/p2/a.pdf",
    }


def test_storage_copy_raises_on_a_refusal() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "no such key /secret/path"})

    with pytest.raises(RestError) as error:
        storage_over(handler).copy("a/b/c", "d/e/f")
    assert "secret" not in str(error.value)


def test_storage_copy_refuses_a_path_that_is_not_plain_before_any_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    with pytest.raises(ValueError):
        storage_over(handler).copy("../x", "d/e/f")
    with pytest.raises(ValueError):
        storage_over(handler).copy("a/b/c", "/abs")


def test_in_memory_copy_of_a_missing_file_raises() -> None:
    with pytest.raises(FileNotFoundError):
        InMemoryStorage().copy("a/b", "c/d")


# ---------------------------------------------------------------- the Supabase database


class Script:
    def __init__(self, answers: dict[tuple[str, str], Any]) -> None:
        self.answers = answers
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.get((request.method, request.url.path))
        if isinstance(answer, httpx.Response):
            return answer
        return httpx.Response(200, json=answer)

    def body(self, index: int = -1) -> Any:
        return json.loads(self.requests[index].content)


def supabase(script: Script) -> SupabaseDatabase:
    rest = SupabaseRest("https://p.example", "sb_secret_x", transport=httpx.MockTransport(script))
    return SupabaseDatabase(rest)


def test_supabase_sample_state_reads_the_function_json() -> None:
    script = Script(
        {
            ("POST", "/rest/v1/rpc/service_sample_state"): {
                "given_at": None,
                "has_master": True,
                "is_master_owner": False,
                "room": True,
            }
        }
    )
    assert supabase(script).sample_state(U1) == SampleState(None, True, False, True)
    assert script.body() == {"target": U1}


def test_supabase_copy_sample_piece_returns_the_pairs() -> None:
    script = Script(
        {
            ("POST", "/rest/v1/rpc/service_copy_sample_piece"): {
                "piece_id": MASTER,
                "files": [{"from": "a/b/x.pdf", "to": "c/d/x.pdf"}],
            }
        }
    )
    assert supabase(script).copy_sample_piece(U1, MASTER) == [("a/b/x.pdf", "c/d/x.pdf")]
    assert script.body() == {"target": U1, "new_piece": MASTER}


@pytest.mark.parametrize(
    ("message", "code", "expected"),
    [
        ("sample:already", "23505", SampleAlready),
        ("sample:no_master", "P0002", SampleNoMaster),
    ],
)
def test_supabase_maps_the_raised_messages(message: str, code: str, expected: type) -> None:
    refusal = httpx.Response(409, json={"code": code, "message": message})
    script = Script({("POST", "/rest/v1/rpc/service_copy_sample_piece"): refusal})
    with pytest.raises(expected):
        supabase(script).copy_sample_piece(U1, MASTER)


def test_supabase_leaves_other_refusals_as_they_are() -> None:
    other = httpx.Response(409, json={"code": "23505", "message": "duplicate key value (x)=(y)"})
    script = Script({("POST", "/rest/v1/rpc/service_copy_sample_piece"): other})
    with pytest.raises(RestError) as error:
        supabase(script).copy_sample_piece(U1, MASTER)
    assert "duplicate" not in str(error.value)


def test_supabase_marks_unmarks_and_deletes() -> None:
    script = Script(
        {
            ("POST", "/rest/v1/rpc/service_mark_sample"): None,
            ("POST", "/rest/v1/rpc/service_unmark_sample"): None,
            ("DELETE", "/rest/v1/pieces"): None,
        }
    )
    db = supabase(script)
    db.mark_sample(U1, given=False)
    assert script.body() == {"target": U1, "was_given": False}
    db.unmark_sample(U1)
    assert script.body() == {"target": U1}
    db.delete_piece(MASTER)
    assert script.requests[-1].method == "DELETE"
    assert script.requests[-1].url.params["id"] == f"eq.{MASTER}"


# ---------------------------------------------------------------- the clean-up survives failures


class StorageDown(FailingOnThird):
    """Storage whose third copy fails and whose delete fails too."""

    def delete(self, paths: Any) -> None:
        raise OSError("storage is down")


def test_a_failing_storage_delete_does_not_stop_the_database_roll_back() -> None:
    db, _ = master_world()
    storage = StorageDown()
    for path, (data, content_type) in FILES.items():
        storage.upload(path, data, content_type)
    service = SamplePieceService(db, storage)

    with pytest.raises(SampleCopyFailed):
        service.claim(U1)

    assert db.pieces_of(U1) == []
    assert [e["voided_at"] is not None for e in db.events_of(U1, "piece_created")] == [True]
    assert db.usage_of(U1)["pieces_created"] == 0
    assert db.sample_given_of(U1) is None
    storage.broken = False
    assert service.claim(U1) == "given"  # the orphans under the deleted piece are harmless


def test_the_route_answers_503_when_the_clean_up_also_fails() -> None:
    world = build(StorageDown())
    reply = world.client.post("/sample-piece", headers=bearer(U1))
    assert reply.status_code == 503
    assert reply.json() == {"detail": {"code": "sample_failed"}}
    assert world.db.pieces_of(U1) == []
    assert world.db.sample_given_of(U1) is None


def test_a_failing_delete_piece_does_not_stop_the_unmark_or_the_file_delete() -> None:
    db, _ = master_world()
    storage = FailingOnThird()
    for path, (data, content_type) in FILES.items():
        storage.upload(path, data, content_type)

    class StuckRows(InMemoryDatabase):
        def delete_piece(self, piece_id: str) -> None:
            raise RestError(503, None)

    stuck = StuckRows()
    stuck.__dict__.update(db.__dict__)

    with pytest.raises(SampleCopyFailed):
        SamplePieceService(stuck, storage).claim(U1)

    assert stuck.sample_given_of(U1) is None  # unmarked all the same
    assert storage.paths() == sorted(FILES)  # the copied files were deleted
    assert [e["voided_at"] is not None for e in stuck.events_of(U1, "piece_created")] == [True]
