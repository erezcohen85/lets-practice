"""app/staging.py (where a PDF waits) and the models dependency, on fakes."""

from datetime import UTC, datetime, timedelta

import pytest

from app import staging
from app.deps import get_models
from app.pipeline.name_suggester import ClaudeNameSuggester
from app.pipeline.pdf_split import ClaudePageHeaderReader
from app.storage import InMemoryStorage

ID = "33333333-3333-4333-8333-333333333333"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "abc",
        "../x",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        ID + "/..",
        "33333333-3333-4333-8333-33333333333g",
    ],
)
def test_only_a_lower_case_uuid_is_a_staged_id(bad: str) -> None:
    assert not staging.is_staged_id(bad)
    with pytest.raises(ValueError):
        staging.pdf_path("u", bad)


def test_paths_are_built_from_the_user_and_the_id_alone() -> None:
    assert staging.pdf_path("u", ID) == f"u/staging/{ID}.pdf"
    assert staging.meta_path("u", ID) == f"u/staging/{ID}.json"


def test_discard_removes_the_pdf_and_its_note_and_never_raises() -> None:
    storage = InMemoryStorage()
    storage.upload(staging.pdf_path("u", ID), b"x", "application/pdf")
    storage.upload(staging.meta_path("u", ID), b"{}", "application/json")

    staging.discard(storage, "u", ID)
    staging.discard(storage, "u", "not-an-id")  # logged, not raised

    assert storage.paths() == []


def test_sweep_removes_only_this_users_files_older_than_a_day() -> None:
    storage = InMemoryStorage()
    now = datetime.now(UTC)
    storage.upload("u/staging/old.pdf", b"x", "application/pdf")
    storage.upload("u/staging/edge.pdf", b"x", "application/pdf")
    storage.upload("u/staging/new.pdf", b"x", "application/pdf")
    storage.upload("v/staging/old.pdf", b"x", "application/pdf")
    storage.age("u/staging/old.pdf", timedelta(days=1, hours=1))
    storage.age("u/staging/edge.pdf", timedelta(hours=23))
    storage.age("v/staging/old.pdf", timedelta(days=5))

    staging.sweep(storage, "u", now=now)

    assert storage.paths() == ["u/staging/edge.pdf", "u/staging/new.pdf", "v/staging/old.pdf"]


def test_the_models_are_the_claude_ones_only_with_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("USE_FAKES", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert get_models().reader is None and get_models().suggester is None

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    models = get_models()
    assert isinstance(models.reader, ClaudePageHeaderReader)
    assert isinstance(models.suggester, ClaudeNameSuggester)

    monkeypatch.setenv("USE_FAKES", "1")
    assert get_models().reader is None
