"""POST /pieces/{id}/suggest-name and POST /suggest-name, on a fake model and fake Storage."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenVerifier, get_token_verifier
from app.db import InMemoryDatabase
from app.deps import Models, Services, get_models, get_services
from app.jobs import InMemoryJobStore
from app.main import create_app
from app.pipeline.name_suggester import FakeNameSuggester, pdf_top_strip
from app.settings import Settings
from app.storage import InMemoryStorage
from tests.split_fixtures import Page, pdf_of
from tests.test_routes import SECRET, bearer

OWNER, STRANGER, LIMITED = "user-owner", "user-stranger", "user-limited"
PIECE = "piece-1"
STAGED = "22222222-2222-4222-8222-222222222222"


@dataclass
class World:
    client: TestClient
    db: InMemoryDatabase
    storage: InMemoryStorage
    suggester: FakeNameSuggester


def build(with_model: bool = True) -> World:
    db = InMemoryDatabase()
    db.add_piece(PIECE, OWNER)
    for user in (OWNER, STRANGER):
        db.set_plan(user, "creator")
    storage = InMemoryStorage()
    suggester = FakeNameSuggester("Carnival of the Animals (Saint-Saëns)", cost_usd=0.001)
    services = Services(db=db, storage=storage, jobs=InMemoryJobStore())
    app = create_app(Settings(allowed_origins=()))
    app.dependency_overrides[get_services] = lambda: services
    app.dependency_overrides[get_token_verifier] = lambda: TokenVerifier(hs256_secret=SECRET)
    app.dependency_overrides[get_models] = lambda: Models(None, suggester if with_model else None)
    return World(TestClient(app), db, storage, suggester)


@pytest.fixture
def world() -> World:
    return build()


def piece_name(world: World, user: str = OWNER, piece: str = PIECE) -> Any:
    return world.client.post(f"/pieces/{piece}/suggest-name", headers=bearer(user))


def form_name(world: World, body: dict[str, Any], user: str = OWNER) -> Any:
    return world.client.post("/suggest-name", json=body, headers=bearer(user))


# ---------------------------------------------------------------- a piece that exists


def test_a_piece_name_comes_from_the_recordings_name_and_the_first_page(world: World) -> None:
    world.db.set_audio_source(PIECE, "file", f"{OWNER}/{PIECE}/upload/recording.mp3", name="Take 2")
    world.db.add_score_file(PIECE, "f1", f"{OWNER}/{PIECE}/parts/f1.pdf", position=0)
    world.storage.upload(f"{OWNER}/{PIECE}/parts/f1.pdf", pdf_of(Page("Flute", 1)), "x")

    response = piece_name(world)

    assert response.status_code == 200
    assert response.json() == {
        "name": "Carnival of the Animals (Saint-Saëns)",
        "source": "claude",
        "note": None,
    }
    clues = world.suggester.calls[0]
    assert clues.audio_name == "Take 2" and clues.strip_png is not None


def test_the_first_part_is_the_one_in_hub_order(world: World) -> None:
    world.db.add_score_file(PIECE, "second", f"{OWNER}/{PIECE}/parts/b.pdf", position=1)
    world.db.add_score_file(PIECE, "first", f"{OWNER}/{PIECE}/parts/a.pdf", position=0)
    world.storage.upload(f"{OWNER}/{PIECE}/parts/b.pdf", pdf_of(Page("B", 1)), "x")
    world.storage.upload(f"{OWNER}/{PIECE}/parts/a.pdf", pdf_of(Page("A", 1)), "x")

    piece_name(world)

    assert world.suggester.calls[0].strip_png == pdf_top_strip(pdf_of(Page("A", 1)))
    assert world.suggester.calls[0].strip_png != pdf_top_strip(pdf_of(Page("B", 1)))


def test_without_a_model_a_piece_name_falls_back_to_the_recording_name() -> None:
    world = build(with_model=False)
    world.db.set_audio_source(PIECE, "file", "x", name="los_banditos-2019")

    body = piece_name(world).json()

    assert body["name"] == "los banditos 2019"
    assert body["source"] == "fallback"
    assert "no Anthropic API key" in body["note"]


def test_a_part_path_outside_the_piece_is_not_read(world: World) -> None:
    world.db.add_score_file(PIECE, "f1", f"{STRANGER}/other/parts/f1.pdf")
    world.storage.upload(f"{STRANGER}/other/parts/f1.pdf", pdf_of(Page("X", 1)), "x")

    piece_name(world)

    assert world.suggester.calls[0].strip_png is None


def test_a_trial_user_may_ask_for_a_name_and_the_admin_always_may(world: World) -> None:
    world.db.add_piece("p-trial", LIMITED)
    assert piece_name(world, LIMITED, "p-trial").status_code == 200  # Trial has suggest_name
    world.db.set_plan_limits("trial", suggest_name=False)
    assert piece_name(world, LIMITED, "p-trial").status_code == 403
    world.db.add_admin(LIMITED)
    assert piece_name(world, LIMITED, "p-trial").status_code == 200
    assert form_name(world, {"recording_name": "x"}, LIMITED).status_code == 200


def test_a_piece_name_needs_a_signed_in_owner_whose_plan_allows_it(world: World) -> None:
    assert world.client.post(f"/pieces/{PIECE}/suggest-name").status_code == 401
    assert piece_name(world, STRANGER).status_code == 403
    assert piece_name(world, OWNER, "nope").status_code == 404
    world.db.add_piece("p-limited", LIMITED)
    world.db.set_plan_limits("trial", suggest_name=False)
    limited = piece_name(world, LIMITED, "p-limited")
    assert limited.status_code == 403
    assert limited.json() == {"detail": {"code": "plan_limit", "limit": "suggest_name"}}
    assert world.suggester.calls == []


# ---------------------------------------------------------------- the New piece form


def test_a_form_name_uses_the_file_name_and_the_staged_pdf_and_uses_it_up(world: World) -> None:
    path = f"{OWNER}/staging/{STAGED}.pdf"
    world.storage.upload(path, pdf_of(Page("Flute", 1)), "application/pdf")

    response = form_name(world, {"recording_name": "take.mp3", "staged_id": STAGED})

    assert response.status_code == 200 and response.json()["source"] == "claude"
    clues = world.suggester.calls[0]
    assert clues.audio_name == "take.mp3" and clues.strip_png is not None
    assert path not in world.storage.paths()


def test_a_form_name_works_with_the_file_name_alone(world: World) -> None:
    response = form_name(world, {"recording_name": "take.mp3"})

    assert response.status_code == 200
    assert world.suggester.calls[0].strip_png is None


def test_a_staged_pdf_that_is_gone_is_just_no_clue(world: World) -> None:
    response = form_name(world, {"recording_name": "take.mp3", "staged_id": STAGED})

    assert response.status_code == 200
    assert world.suggester.calls[0].strip_png is None


def test_another_users_staged_pdf_is_not_read(world: World) -> None:
    world.storage.upload(f"{STRANGER}/staging/{STAGED}.pdf", pdf_of(Page("X", 1)), "x")

    form_name(world, {"recording_name": "take.mp3", "staged_id": STAGED})

    assert world.suggester.calls[0].strip_png is None
    assert f"{STRANGER}/staging/{STAGED}.pdf" in world.storage.paths()


def test_a_form_name_sweeps_old_staged_files(world: World) -> None:
    old = f"{OWNER}/staging/old.pdf"
    world.storage.upload(old, b"x", "application/pdf")
    world.storage.age(old, timedelta(days=3))

    form_name(world, {"recording_name": "take.mp3"})

    assert old not in world.storage.paths()


def test_the_form_route_checks_the_caller_and_the_id(world: World) -> None:
    assert world.client.post("/suggest-name", json={}).status_code == 401
    assert form_name(world, {"staged_id": "../x"}).status_code == 404
    world.db.set_plan_limits("trial", suggest_name=False)
    refused = form_name(world, {"recording_name": "x"}, LIMITED)
    assert refused.status_code == 403
    assert refused.json() == {"detail": {"code": "plan_limit", "limit": "suggest_name"}}
    assert form_name(world, {"recording_name": "x" * 301}).status_code == 422
