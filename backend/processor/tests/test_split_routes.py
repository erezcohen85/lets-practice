"""POST /splits/{id}/propose and /splits/{id}/cut: a PDF staged in Storage, on fakes."""

import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import jwt
import pymupdf
import pytest
from fastapi.testclient import TestClient

from app import splits
from app.auth import TokenVerifier, get_token_verifier
from app.db import InMemoryDatabase
from app.deps import Models, Services, get_models, get_services
from app.jobs import InMemoryJobStore
from app.main import create_app
from app.pipeline.pdf_split import FakePageHeaderReader, PageHeader
from app.settings import Settings
from app.storage import InMemoryStorage
from tests.split_fixtures import Page, full_score, pdf_of, three_parts
from tests.test_routes import SECRET, bearer

OWNER = "user-owner"
STRANGER = "user-stranger"
LIMITED = "user-limited"
PIECE = "piece-1"
THEIR_PIECE = "piece-2"
STAGED = "11111111-1111-4111-8111-111111111111"
PART_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PART_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PART_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

HEADERS: dict[int, Any] = {
    1: PageHeader("Flute", 1, False),
    2: PageHeader(None, 2, False),
    3: PageHeader("Oboe", 1, False),
    4: PageHeader("Clarinet in B♭ 2", 1, False),
    5: PageHeader(None, 2, False),
    6: PageHeader(None, 3, False),
}


@dataclass
class World:
    client: TestClient
    db: InMemoryDatabase
    storage: InMemoryStorage


def build(reader: FakePageHeaderReader | None) -> World:
    db = InMemoryDatabase()
    db.add_piece(PIECE, OWNER)
    db.add_piece(THEIR_PIECE, STRANGER)
    for user in (OWNER, STRANGER):
        db.set_plan(user, "creator")
    storage = InMemoryStorage()
    services = Services(db=db, storage=storage, jobs=InMemoryJobStore())
    app = create_app(Settings(allowed_origins=()))
    app.dependency_overrides[get_services] = lambda: services
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(hs256_secret=SECRET)
    app.dependency_overrides[get_models] = lambda: Models(reader, None)
    return World(TestClient(app), db, storage)


@pytest.fixture
def world() -> World:
    return build(FakePageHeaderReader(HEADERS, cost_usd=0.001))


def stage(world: World, user: str = OWNER, data: bytes | None = None, staged: str = STAGED) -> str:
    path = f"{user}/staging/{staged}.pdf"
    world.storage.upload(path, three_parts() if data is None else data, "application/pdf")
    return path


def propose(world: World, user: str = OWNER, staged: str = STAGED) -> Any:
    return world.client.post(f"/splits/{staged}/propose", headers=bearer(user))


def cut(world: World, parts: list[dict[str, Any]], piece: str = PIECE, user: str = OWNER) -> Any:
    return world.client.post(
        f"/splits/{STAGED}/cut", json={"piece_id": piece, "parts": parts}, headers=bearer(user)
    )


def entry(part_id: str, name: str, first: int, last: int, skip: list[int] | None = None) -> Any:
    item: dict[str, Any] = {"id": part_id, "name": name, "fromPage": first, "toPage": last}
    if skip is not None:
        item["skipPages"] = skip
    return item


def pages_of(data: bytes) -> list[str]:
    with pymupdf.open(stream=data, filetype="pdf") as document:
        return [page.get_text().strip().splitlines()[-1] for page in document]


# ---------------------------------------------------------------- who may ask


def test_both_routes_need_a_signed_in_user(world: World) -> None:
    stage(world)
    assert world.client.post(f"/splits/{STAGED}/propose").status_code == 401
    anonymous = world.client.post(f"/splits/{STAGED}/cut", json={"piece_id": PIECE, "parts": []})
    assert anonymous.status_code == 401
    forged = {"Authorization": f"Bearer {jwt.encode({'sub': OWNER}, 'x' * 40, algorithm='HS256')}"}
    assert world.client.post(f"/splits/{STAGED}/propose", headers=forged).status_code == 401


def test_a_plan_without_split_pdf_is_refused_before_anything_is_read(world: World) -> None:
    stage(world, LIMITED)  # LIMITED is on Trial, which has no split_pdf

    response = propose(world, LIMITED)

    assert response.status_code == 403
    assert response.json() == {"detail": {"code": "plan_limit", "limit": "split_pdf"}}


def test_the_admin_and_a_plan_with_split_pdf_may_propose(world: World) -> None:
    world.db.add_admin(LIMITED)
    stage(world, LIMITED)
    assert propose(world, LIMITED).status_code == 200
    world.db.set_plan("someone", "unlimited")
    stage(world, "someone")
    assert propose(world, "someone").status_code == 200


def test_a_staged_id_that_is_not_a_uuid_is_a_404(world: World) -> None:
    assert propose(world, staged="..%2F..%2Fx").status_code == 404
    assert propose(world, staged="not-a-uuid").status_code == 404


def test_propose_reads_only_the_callers_own_folder(world: World) -> None:
    stage(world, STRANGER)  # the same id in another user's folder

    response = propose(world, OWNER)

    assert response.status_code == 410
    assert response.json()["detail"] == "This split has expired: choose the PDF again."


# ---------------------------------------------------------------- propose


def test_the_proposal_lists_the_parts_and_a_picture_of_every_page(world: World) -> None:
    stage(world)

    response = propose(world)

    assert response.status_code == 200
    body = response.json()
    assert body["splitId"] == STAGED
    assert body["pageCount"] == 6
    assert body["fullScore"] is False
    assert body["note"] is None
    assert body["costUsd"] == pytest.approx(0.006)
    assert body["parts"] == [
        {"name": "Flute", "fromPage": 1, "toPage": 2},
        {"name": "Oboe", "fromPage": 3, "toPage": 3},
        {"name": "Clarinet in B♭ 2", "fromPage": 4, "toPage": 6},
    ]
    assert [page["page"] for page in body["pages"]] == [1, 2, 3, 4, 5, 6]
    assert body["pages"][2]["partName"] == "Oboe"
    assert all(page["thumb"].startswith("data:image/webp;base64,") for page in body["pages"])


def test_the_proposal_leaves_a_note_for_the_cut_beside_the_pdf(world: World) -> None:
    stage(world)

    propose(world)

    note = json.loads(world.storage.download(f"{OWNER}/staging/{STAGED}.json"))
    assert note == {"pageCount": 6, "fullScore": False}


def test_without_a_key_it_answers_with_one_part_and_says_why() -> None:
    world = build(None)
    stage(world)

    body = propose(world).json()

    assert body["parts"] == [{"name": "Part 1", "fromPage": 1, "toPage": 6}]
    assert body["costUsd"] == 0
    assert "could not be read" in body["note"]


def test_a_full_score_is_said_to_be_one() -> None:
    every = {n: PageHeader(None, n, True) for n in (1, 2, 3)}
    world = build(FakePageHeaderReader(every))
    stage(world, data=full_score())

    assert propose(world).json()["fullScore"] is True


@pytest.mark.parametrize(
    ("data", "said"),
    [
        (b"not a pdf at all", "This file is not a PDF."),
        (b"%PDF-1.7 broken", "This file could not be read as a PDF."),
        (pdf_of(*[Page(None, n) for n in range(1, 122)]), "more than 120 pages"),
    ],
)
def test_a_pdf_that_cannot_be_split_is_a_400_with_one_sentence(
    world: World, data: bytes, said: str
) -> None:
    stage(world, data=data)

    response = propose(world)

    assert response.status_code == 400
    assert said in response.json()["detail"]


def test_a_pdf_over_the_size_limit_is_a_400(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(splits, "MAX_PDF_BYTES", 100)
    stage(world)

    response = propose(world)

    assert response.status_code == 400
    assert response.json()["detail"] == "This PDF is larger than 0 MB."


def test_a_proposal_sweeps_the_callers_files_older_than_a_day(world: World) -> None:
    old, fresh, theirs = (
        f"{OWNER}/staging/old.pdf",
        f"{OWNER}/staging/new.pdf",
        f"{STRANGER}/staging/x.pdf",
    )
    for path in (old, fresh, theirs):
        world.storage.upload(path, b"x", "application/pdf")
    world.storage.age(old, timedelta(days=2))
    world.storage.age(theirs, timedelta(days=2))
    stage(world)

    propose(world)

    paths = world.storage.paths()
    assert old not in paths and fresh in paths
    assert theirs in paths  # another user's files are not this caller's to sweep


# ---------------------------------------------------------------- cut


def staged_and_proposed(world: World, user: str = OWNER, data: bytes | None = None) -> None:
    stage(world, user, data)
    assert propose(world, user).status_code == 200


def test_the_kept_parts_are_written_into_the_pieces_own_folder(world: World) -> None:
    staged_and_proposed(world)

    response = cut(world, [entry(PART_A, "Flute", 1, 2), entry(PART_B, "Clarinet", 4, 6)])

    assert response.status_code == 200
    made = response.json()["parts"]
    assert [item["id"] for item in made] == [PART_A, PART_B]
    for item, expected in zip(
        made, (["sheet 1", "sheet 2"], ["sheet 4", "sheet 5", "sheet 6"]), strict=True
    ):
        data = world.storage.download(f"{OWNER}/{PIECE}/parts/{item['id']}.pdf")
        assert pages_of(data) == expected
        assert item["sha256"] == hashlib.sha256(data).hexdigest()
        assert world.storage.content_type(f"{OWNER}/{PIECE}/parts/{item['id']}.pdf") == (
            "application/pdf"
        )


def test_the_staged_pdf_is_used_up(world: World) -> None:
    staged_and_proposed(world)

    cut(world, [entry(PART_A, "Flute", 1, 2)])

    assert not [path for path in world.storage.paths() if "/staging/" in path]
    assert cut(world, [entry(PART_A, "Flute", 1, 2)]).status_code == 410


def test_discarded_pages_are_left_out_of_the_part(world: World) -> None:
    staged_and_proposed(world)

    made = cut(world, [entry(PART_A, "Clarinet", 4, 6, [5])]).json()["parts"]

    data = world.storage.download(f"{OWNER}/{PIECE}/parts/{made[0]['id']}.pdf")
    assert pages_of(data) == ["sheet 4", "sheet 6"]


def test_a_pdf_can_be_cut_into_any_number_of_parts(world: World) -> None:
    count = 60
    staged_and_proposed(world, data=pdf_of(*[Page(f"Part {n}", 1) for n in range(1, count + 1)]))

    response = cut(
        world,
        [entry(f"{n:08x}-0000-4000-8000-000000000000", f"P{n}", n, n) for n in range(1, count + 1)],
    )

    assert response.status_code == 200
    assert len(response.json()["parts"]) == count


def test_a_part_of_someone_elses_piece_is_refused_and_nothing_is_written(world: World) -> None:
    staged_and_proposed(world)

    response = cut(world, [entry(PART_A, "Flute", 1, 2)], piece=THEIR_PIECE)

    assert response.status_code == 403
    assert not [path for path in world.storage.paths() if "/parts/" in path]


def test_a_piece_that_does_not_exist_is_a_404(world: World) -> None:
    staged_and_proposed(world)

    assert cut(world, [entry(PART_A, "Flute", 1, 2)], piece="nope").status_code == 404


def test_nothing_is_ever_written_under_another_users_folder(world: World) -> None:
    # The stranger stages their own PDF and cuts it into their own piece: it lands in their folder.
    staged_and_proposed(world, STRANGER)

    response = cut(world, [entry(PART_A, "Flute", 1, 2)], piece=THEIR_PIECE, user=STRANGER)

    assert response.status_code == 200
    assert world.storage.paths() == [f"{STRANGER}/{THEIR_PIECE}/parts/{PART_A}.pdf"]


def test_a_plan_without_split_pdf_cannot_cut(world: World) -> None:
    world.db.add_piece("piece-limited", LIMITED)
    staged_and_proposed(world, OWNER)

    response = cut(world, [entry(PART_A, "Flute", 1, 2)], piece="piece-limited", user=LIMITED)

    assert response.status_code == 403
    assert response.json() == {"detail": {"code": "plan_limit", "limit": "split_pdf"}}
    assert not [path for path in world.storage.paths() if "piece-limited" in path]


def test_a_cut_without_a_proposal_is_expired(world: World) -> None:
    stage(world)  # staged, never proposed: there is no note

    assert cut(world, [entry(PART_A, "Flute", 1, 2)]).status_code == 410


def test_a_full_score_cannot_be_cut() -> None:
    every = {n: PageHeader(None, n, True) for n in (1, 2, 3)}
    world = build(FakePageHeaderReader(every))
    staged_and_proposed(world, data=full_score())

    response = cut(world, [entry(PART_A, "Flute", 1, 2)])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Full scores")
    assert not [path for path in world.storage.paths() if "/parts/" in path]


@pytest.mark.parametrize(
    ("parts", "said"),
    [
        ([], "Keep at least one part."),
        ([entry(PART_A, "", 1, 2)], "name of 1 to 80 characters"),
        ([entry(PART_A, "Flute", 0, 2)], "pages 0 to 2"),
        ([entry(PART_A, "Flute", 5, 7)], "pages 5 to 7"),
        ([entry(PART_A, "Flute", 1, 3), entry(PART_B, "Oboe", 3, 4)], "in page order"),
        ([entry(PART_A, "Flute", 1, 2, [9])], "inside the part's pages"),
        ([entry(PART_A, "Flute", 1, 2, [1, 2])], "at least one page that is not skipped"),
        ([entry(PART_A, "Flute", 1, 2), entry(PART_A, "Oboe", 3, 3)], "new id of its own"),
        ([entry("../../x", "Flute", 1, 2)], "new id of its own"),
        ([{"name": "Flute", "fromPage": 1, "toPage": 2}], "new id of its own"),
        (["Flute"], "page numbers"),
    ],
)
def test_a_bad_list_is_a_400_with_one_sentence_and_writes_nothing(
    world: World, parts: list[Any], said: str
) -> None:
    staged_and_proposed(world)

    response = cut(world, parts)

    assert response.status_code == 400
    assert said in response.json()["detail"]
    assert not [path for path in world.storage.paths() if "/parts/" in path]
    assert f"{OWNER}/staging/{STAGED}.pdf" in world.storage.paths()  # the user can fix it and retry


def test_a_cut_that_fails_half_way_leaves_no_part_behind(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    staged_and_proposed(world)
    real = splits.write_part_pdf
    calls = []

    def flaky(*args: Any) -> bytes:
        calls.append(1)
        if len(calls) == 2:
            raise OSError("disk")
        return real(*args)

    monkeypatch.setattr(splits, "write_part_pdf", flaky)
    broken = TestClient(world.client.app, raise_server_exceptions=False)

    response = broken.post(
        f"/splits/{STAGED}/cut",
        json={
            "piece_id": PIECE,
            "parts": [entry(PART_A, "Flute", 1, 2), entry(PART_B, "Oboe", 3, 3)],
        },
        headers=bearer(OWNER),
    )

    assert response.status_code == 500
    assert not [path for path in world.storage.paths() if "/parts/" in path]


def test_the_body_must_be_json_with_a_piece(world: World) -> None:
    response = world.client.post(f"/splits/{STAGED}/cut", json={"parts": []}, headers=bearer(OWNER))

    assert response.status_code == 422
