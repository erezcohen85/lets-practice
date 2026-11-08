"""Names the user can change: parts and the recording, from the run folder to the local server."""

import json
from pathlib import Path

import pytest

from app.pipeline.run_folder import (
    NAMES_NAME,
    RunFolderError,
    forget_part_name,
    read_names,
    read_run,
    read_run_file,
    save_names,
)
from tests.run_fixtures import write_run


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    return write_run(tmp_path / "run")


def names_file(folder: Path) -> dict[str, object]:
    return json.loads((folder / NAMES_NAME).read_text())


# ---------------------------------------------------------------- the file


def test_a_run_without_names_json_keeps_the_names_it_has(folder: Path) -> None:
    run = read_run_file(folder)

    assert [(p.name, p.nameSource) for p in run.parts] == [("Flute", "file"), ("Horn", "file")]
    assert run.recordingName is None


def test_names_json_is_read_over_the_names_of_the_run(folder: Path) -> None:
    (folder / NAMES_NAME).write_text(
        json.dumps({"parts": {"part-horn": "French horn"}, "recording": "Take 3"})
    )

    read = read_run(folder)

    assert [(p.name, p.nameSource) for p in read.run.parts] == [
        ("Flute", "file"),
        ("French horn", "user"),
    ]
    assert read.run.recordingName == "Take 3"
    dumped = read.run.model_dump(by_alias=True, exclude_unset=True)
    assert dumped["parts"][1]["nameSource"] == "user" and dumped["recordingName"] == "Take 3"


@pytest.mark.parametrize("text", ["{not json", "[]", '{"parts": 3, "recording": 4}', '"x"'])
def test_a_damaged_names_json_does_not_stop_the_run_from_opening(folder: Path, text: str) -> None:
    (folder / NAMES_NAME).write_text(text)

    assert [p.name for p in read_run_file(folder).parts] == ["Flute", "Horn"]
    assert read_names(folder).parts == {} and read_names(folder).recording is None


def test_saving_a_name_writes_names_json_and_nothing_else(folder: Path) -> None:
    before = {p.name: p.read_bytes() for p in folder.rglob("*") if p.is_file()}

    names = save_names(folder, {"parts": {"part-flute": "  Piccolo  "}, "recording": "Take 3"})

    assert names.parts == {"part-flute": "Piccolo"} and names.recording == "Take 3"
    assert names_file(folder) == {"parts": {"part-flute": "Piccolo"}, "recording": "Take 3"}
    after = {p.name: p.read_bytes() for p in folder.rglob("*") if p.is_file()}
    assert set(after) - set(before) == {NAMES_NAME}
    assert {k: v for k, v in after.items() if k != NAMES_NAME} == before  # local-run.json too
    assert not list(folder.glob(".names-*"))  # the temp file was swapped in


def test_saving_names_adds_to_the_ones_already_saved(folder: Path) -> None:
    save_names(folder, {"parts": {"part-flute": "Piccolo"}, "recording": "Take 3"})

    save_names(folder, {"parts": {"part-horn": "French horn"}})
    save_names(folder, {"parts": {"part-flute": "Flute 1"}})

    assert names_file(folder) == {
        "parts": {"part-flute": "Flute 1", "part-horn": "French horn"},
        "recording": "Take 3",
    }


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"parts": {"part-flute": ""}}, "1 to 80"),
        ({"parts": {"part-flute": "   "}}, "1 to 80"),
        ({"parts": {"part-flute": "x" * 81}}, "1 to 80"),
        ({"parts": {"part-flute": 3}}, "1 to 80"),
        ({"parts": {"part-tuba": "Tuba"}}, "not in this run"),
        ({"parts": ["Tuba"]}, "object"),
        ({"recording": ""}, "1 to 120"),
        ({"recording": "x" * 121}, "1 to 120"),
        ({"recording": 7}, "1 to 120"),
        ([], "JSON object"),
    ],
)
def test_a_name_that_is_not_allowed_refuses_the_request_and_saves_nothing(
    folder: Path, body: object, message: str
) -> None:
    with pytest.raises(RunFolderError, match=message):
        save_names(folder, body)

    assert not (folder / NAMES_NAME).exists()


def test_the_longest_names_are_allowed(folder: Path) -> None:
    save_names(folder, {"parts": {"part-flute": "p" * 80}, "recording": "r" * 120})

    assert len(read_run_file(folder).parts[0].name) == 80
    assert len(read_run_file(folder).recordingName or "") == 120


# ---------------------------------------------------------------- the piece title


def test_a_piece_title_is_saved_in_names_json_and_read_over_the_runs(folder: Path) -> None:
    names = save_names(folder, {"title": "  Los Banditos  "})

    assert names.title == "Los Banditos"
    assert names_file(folder) == {"parts": {}, "recording": None, "title": "Los Banditos"}
    assert read_run_file(folder).piece.title == "Los Banditos"
    assert read_run(folder).run.piece.title == "Los Banditos"


def test_a_run_never_renamed_has_no_title_key_in_names_json(folder: Path) -> None:
    save_names(folder, {"recording": "Take 3"})

    assert names_file(folder) == {"parts": {}, "recording": "Take 3"}
    assert read_run_file(folder).piece.title == "Synthetic Etude"


def test_the_title_stays_through_the_other_renames_and_a_part_delete(folder: Path) -> None:
    save_names(folder, {"title": "Los Banditos"})

    save_names(folder, {"parts": {"part-flute": "Piccolo"}})
    forget_part_name(folder, "part-flute")

    assert read_names(folder).title == "Los Banditos"
    assert read_run_file(folder).piece.title == "Los Banditos"


@pytest.mark.parametrize("title", ["", "   ", 7, "x" * 201])
def test_a_title_that_is_not_allowed_refuses_the_request_and_saves_nothing(
    folder: Path, title: object
) -> None:
    with pytest.raises(RunFolderError, match="1 to 200"):
        save_names(folder, {"title": title, "parts": {"part-flute": "Piccolo"}})

    assert not (folder / NAMES_NAME).exists()
