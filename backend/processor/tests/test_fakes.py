import inspect

import pytest

from app.db import Database, InMemoryDatabase
from app.jobs import InMemoryJobStore, JobStore
from app.pipeline.models import (
    BarBox,
    BarMark,
    JobKind,
    JobStatus,
    Locator,
    MeterChange,
    PlayOrderRow,
    ReviewFlag,
)
from app.storage import InMemoryStorage, Storage

OWNER = "user-1"
PIECE = "piece-1"


def loc(bar: int, pass_index: int = 0, time_sec: float = 1.0, confirmed: bool = False) -> Locator:
    return Locator(bar=bar, pass_index=pass_index, time_sec=time_sec, confirmed=confirmed)


def keys(locators: list[Locator]) -> list[tuple[int, int, bool]]:
    return [(item.bar, item.pass_index, item.confirmed) for item in locators]


@pytest.fixture
def db() -> InMemoryDatabase:
    database = InMemoryDatabase()
    database.add_piece(PIECE, OWNER)
    return database


# --- protocols ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fake", "protocol"),
    [
        (InMemoryDatabase, Database),
        (InMemoryStorage, Storage),
        (InMemoryJobStore, JobStore),
    ],
)
def test_fakes_satisfy_their_protocols(fake: type, protocol: type) -> None:
    assert isinstance(fake(), protocol)
    assert not isinstance(object(), protocol)


@pytest.mark.parametrize(
    ("fake", "protocol"),
    [
        (InMemoryDatabase, Database),
        (InMemoryStorage, Storage),
        (InMemoryJobStore, JobStore),
    ],
)
def test_fake_methods_take_the_same_parameters_as_the_protocol(fake: type, protocol: type) -> None:
    for name, member in inspect.getmembers(protocol, inspect.isfunction):
        if name.startswith("_"):
            continue
        wanted = inspect.signature(member).parameters
        got = inspect.signature(getattr(fake, name)).parameters
        assert list(got) == list(wanted), name
        for param_name, param in wanted.items():
            assert got[param_name].kind == param.kind, (name, param_name)


# --- database: pieces, score files, audio ------------------------------------------------------


def test_piece_owner_round_trips_and_unknown_piece_is_none(db: InMemoryDatabase) -> None:
    assert db.get_piece_owner(PIECE) == OWNER
    assert db.get_piece_owner("nope") is None


def test_list_score_files_returns_the_pieces_parts_in_hub_order(db: InMemoryDatabase) -> None:
    db.add_piece("piece-2", "user-2")
    db.add_score_file(PIECE, "f-b", "user-1/piece-1/b.pdf", name="Viola", position=1)
    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="Violin")
    db.add_score_file("piece-2", "f-c", "user-2/piece-2/c.pdf", name="Cello")

    files = db.list_score_files(PIECE)

    assert [f["id"] for f in files] == ["f-a", "f-b"]
    assert files[0]["piece_id"] == PIECE
    assert files[0]["storage_path"] == "user-1/piece-1/a.pdf"
    assert files[0]["name"] == "Violin"
    assert set(files[0]) == {
        "id",
        "piece_id",
        "storage_path",
        "sha256",
        "page_count",
        "name",
        "name_source",
        "box_check",
        "position",
    }
    assert files[1]["position"] == 1
    assert db.list_score_files("nope") == []


def test_score_files_are_copies(db: InMemoryDatabase) -> None:
    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="Violin")

    db.list_score_files(PIECE)[0]["name"] = "Hacked"
    db.list_score_files(PIECE).clear()

    assert db.list_score_files(PIECE)[0]["name"] == "Violin"


def test_audio_source_round_trips_and_is_a_copy(db: InMemoryDatabase) -> None:
    assert db.get_audio_source(PIECE) is None

    db.set_audio_source(PIECE, "file", "user-1/piece-1/audio.mp3", duration=61.5)
    source = db.get_audio_source(PIECE)

    assert source is not None
    assert source["piece_id"] == PIECE
    assert source["kind"] == "file"
    assert source["url_or_path"] == "user-1/piece-1/audio.mp3"
    assert source["duration"] == 61.5

    source["url_or_path"] = "elsewhere"
    again = db.get_audio_source(PIECE)
    assert again is not None
    assert again["url_or_path"] == "user-1/piece-1/audio.mp3"


# --- database: structure -----------------------------------------------------------------------


def test_structure_defaults_to_empty(db: InMemoryDatabase) -> None:
    assert db.get_structure(PIECE) == ([], [], [])
    assert db.get_structure("nope") == ([], [], [])


def test_structure_round_trips(db: InMemoryDatabase) -> None:
    rows = [PlayOrderRow(start=1, end=8), PlayOrderRow(start=1, end=4)]
    meters = [
        MeterChange(from_bar=1, numerator=4, denominator=4),
        MeterChange(from_bar=5, numerator=3, denominator=4),
    ]
    marks = [BarMark(bar=8, kind="fermata"), BarMark(bar=2, kind="rit")]

    db.save_structure(PIECE, rows, meters, marks)

    assert db.get_structure(PIECE) == (rows, meters, marks)


def test_save_structure_replaces_the_previous_one(db: InMemoryDatabase) -> None:
    meter = MeterChange(from_bar=1, numerator=4, denominator=4)
    db.save_structure(PIECE, [PlayOrderRow(start=1, end=8)], [meter], [BarMark(bar=3, kind="rit")])

    db.save_structure(PIECE, [PlayOrderRow(start=1, end=2)], [], [])

    assert db.get_structure(PIECE) == ([PlayOrderRow(start=1, end=2)], [], [])


def test_structure_is_stored_and_returned_as_copies(db: InMemoryDatabase) -> None:
    rows = [PlayOrderRow(start=1, end=8)]
    meters = [MeterChange(from_bar=1, numerator=4, denominator=4)]
    marks = [BarMark(bar=8, kind="fermata")]
    db.save_structure(PIECE, rows, meters, marks)

    # Changing what was passed in does not reach the store.
    rows.append(PlayOrderRow(start=9, end=12))
    meters[0].numerator = 7
    marks.clear()
    # Changing what was returned does not reach the store either.
    got_rows, got_meters, got_marks = db.get_structure(PIECE)
    got_rows.clear()
    got_meters[0].numerator = 9
    got_marks.append(BarMark(bar=1, kind="rit"))

    assert db.get_structure(PIECE) == (
        [PlayOrderRow(start=1, end=8)],
        [MeterChange(from_bar=1, numerator=4, denominator=4)],
        [BarMark(bar=8, kind="fermata")],
    )


# --- database: locators ------------------------------------------------------------------------


def test_locators_start_empty(db: InMemoryDatabase) -> None:
    assert db.get_locators(PIECE) == []
    assert db.get_locators("nope") == []


def test_replace_unconfirmed_locators_inserts_into_an_empty_piece(db: InMemoryDatabase) -> None:
    db.replace_unconfirmed_locators(PIECE, [loc(2, 0, 3.0), loc(1, 0, 1.5), loc(1, 1, 9.0)])

    got = db.get_locators(PIECE)

    assert keys(got) == [(1, 0, False), (1, 1, False), (2, 0, False)]
    assert got[0].time_sec == 1.5


def test_replace_unconfirmed_locators_keeps_confirmed_rows_untouched(db: InMemoryDatabase) -> None:
    confirmed = loc(1, 0, 1.25, confirmed=True)
    db.add_locators(PIECE, [confirmed, loc(2, 0, 2.0), loc(3, 0, 3.0)])

    db.replace_unconfirmed_locators(PIECE, [loc(2, 0, 2.5), loc(4, 0, 4.0)])

    got = db.get_locators(PIECE)
    assert keys(got) == [(1, 0, True), (2, 0, False), (4, 0, False)]
    assert got[0] == confirmed
    assert got[1].time_sec == 2.5  # replaced, not merged
    assert all(item.bar != 3 for item in got)  # the old unconfirmed bar 3 is gone


def test_replace_unconfirmed_locators_with_nothing_deletes_the_unconfirmed(
    db: InMemoryDatabase,
) -> None:
    db.add_locators(PIECE, [loc(1, 0, confirmed=True), loc(2, 0)])

    db.replace_unconfirmed_locators(PIECE, [])

    assert keys(db.get_locators(PIECE)) == [(1, 0, True)]


def test_replace_unconfirmed_locators_leaves_other_pieces_alone(db: InMemoryDatabase) -> None:
    db.add_piece("piece-2", "user-2")
    db.add_locators("piece-2", [loc(1, 0, 7.0), loc(2, 0, confirmed=True)])

    db.replace_unconfirmed_locators(PIECE, [loc(1, 0, 1.0)])

    assert keys(db.get_locators("piece-2")) == [(1, 0, False), (2, 0, True)]
    assert db.get_locators("piece-2")[0].time_sec == 7.0


def test_replace_unconfirmed_locators_rejects_a_collision_with_a_confirmed_row(
    db: InMemoryDatabase,
) -> None:
    db.add_locators(PIECE, [loc(1, 0, 1.0, confirmed=True), loc(2, 0, 2.0)])
    before = db.get_locators(PIECE)

    with pytest.raises(ValueError, match="confirmed"):
        db.replace_unconfirmed_locators(PIECE, [loc(3, 0, 3.0), loc(1, 0, 1.1)])

    assert db.get_locators(PIECE) == before  # nothing was deleted or inserted


def test_same_bar_on_another_pass_does_not_collide_with_a_confirmed_row(
    db: InMemoryDatabase,
) -> None:
    db.add_locators(PIECE, [loc(1, 0, 1.0, confirmed=True)])

    db.replace_unconfirmed_locators(PIECE, [loc(1, 1, 9.0)])

    assert keys(db.get_locators(PIECE)) == [(1, 0, True), (1, 1, False)]


def test_replace_unconfirmed_locators_rejects_duplicates_in_the_given_list(
    db: InMemoryDatabase,
) -> None:
    db.add_locators(PIECE, [loc(5, 0, 5.0)])

    with pytest.raises(ValueError, match="twice"):
        db.replace_unconfirmed_locators(PIECE, [loc(1, 0, 1.0), loc(1, 0, 1.2)])

    assert keys(db.get_locators(PIECE)) == [(5, 0, False)]


def test_add_locators_rejects_a_second_locator_for_the_same_bar_and_pass(
    db: InMemoryDatabase,
) -> None:
    db.add_locators(PIECE, [loc(1, 0)])

    with pytest.raises(ValueError):
        db.add_locators(PIECE, [loc(1, 0, 2.0)])


def test_locators_are_stored_and_returned_as_copies(db: InMemoryDatabase) -> None:
    given = [loc(1, 0, 1.0)]
    db.replace_unconfirmed_locators(PIECE, given)

    given[0].time_sec = 99.0
    given.append(loc(2, 0))
    got = db.get_locators(PIECE)
    got[0].time_sec = 55.0
    got[0].confirmed = True
    got.clear()

    after = db.get_locators(PIECE)
    assert len(after) == 1
    assert after[0] == loc(1, 0, 1.0)


def test_locators_keep_their_flags_and_checked_and_return_copies(db: InMemoryDatabase) -> None:
    flag = ReviewFlag(
        kind="stretched", severity=0, expected=2.0, found=3.2, factor=1.6, explained_by="fermata"
    )
    given = Locator(bar=4, pass_index=0, time_sec=6.5, flags=[flag], checked=True)
    db.replace_unconfirmed_locators(PIECE, [given])

    given.flags.clear()
    got = db.get_locators(PIECE)
    got[0].flags.clear()
    got[0].checked = False

    after = db.get_locators(PIECE)
    assert after[0].flags == [flag]
    assert after[0].checked is True


def test_replace_unconfirmed_locators_keeps_a_confirmed_rows_flags_and_checked(
    db: InMemoryDatabase,
) -> None:
    flag = ReviewFlag(kind="crowded", severity=1, expected=2.0, found=1.0, factor=0.5)
    db.add_locators(
        PIECE,
        [Locator(bar=1, pass_index=0, time_sec=1.0, confirmed=True, flags=[flag], checked=True)],
    )

    db.replace_unconfirmed_locators(PIECE, [loc(2)])

    kept = db.get_locators(PIECE)[0]
    assert kept.flags == [flag]
    assert kept.checked is True


# --- database: page layer ----------------------------------------------------------------------


def test_page_layer_round_trips_and_replaces(db: InMemoryDatabase) -> None:
    pages = [{"page_index": 0, "image_path": "u/p/0.png", "width": 800, "height": 1100}]
    bars = [
        BarBox(bar=1, page_index=0, x=10, y=20, w=100, h=50),
        BarBox(bar=2, page_index=0, x=110, y=20, w=100, h=50),
    ]

    db.save_page_layer("f-a", pages, bars)
    assert db.get_page_layer("f-a") == (pages, bars)

    db.save_page_layer("f-a", [], [bars[0]])
    assert db.get_page_layer("f-a") == ([], [bars[0]])
    assert db.get_page_layer("f-unknown") == ([], [])


def test_rests_are_a_parts_own_and_a_save_replaces_them(db: InMemoryDatabase) -> None:
    db.save_page_layer("f-a", [], [], [5, 3, 4, 4])
    db.save_page_layer("f-b", [], [], [9])

    assert db.get_rests("f-a") == [3, 4, 5]
    assert db.get_rests("f-b") == [9]
    assert db.get_rests("f-unknown") == []

    db.save_page_layer("f-a", [], [])  # a layer saved without rests has none

    assert db.get_rests("f-a") == []
    assert db.get_rests("f-b") == [9]


def test_page_layer_is_stored_and_returned_as_copies(db: InMemoryDatabase) -> None:
    pages = [{"page_index": 0, "image_path": "u/p/0.png", "width": 800, "height": 1100}]
    bars = [BarBox(bar=1, page_index=0, x=10, y=20, w=100, h=50)]
    db.save_page_layer("f-a", pages, bars)

    pages[0]["width"] = 1
    bars[0].x = 999
    got_pages, got_bars = db.get_page_layer("f-a")
    got_pages[0]["width"] = 2
    got_bars[0].x = 888

    assert db.get_page_layer("f-a") == (
        [{"page_index": 0, "image_path": "u/p/0.png", "width": 800, "height": 1100}],
        [BarBox(bar=1, page_index=0, x=10, y=20, w=100, h=50)],
    )


# --- storage -----------------------------------------------------------------------------------


def test_storage_round_trips_bytes() -> None:
    storage = InMemoryStorage()

    storage.upload("user-1/piece-1/score.pdf", b"%PDF-1.7", "application/pdf")

    assert storage.download("user-1/piece-1/score.pdf") == b"%PDF-1.7"
    assert storage.content_type("user-1/piece-1/score.pdf") == "application/pdf"


def test_storage_download_of_a_missing_path_raises_file_not_found() -> None:
    storage = InMemoryStorage()
    storage.upload("user-1/piece-1/a.png", b"a", "image/png")

    with pytest.raises(FileNotFoundError):
        storage.download("user-1/piece-1/b.png")
    with pytest.raises(FileNotFoundError):
        storage.content_type("user-1/piece-1/b.png")


def test_storage_upload_overwrites() -> None:
    storage = InMemoryStorage()
    storage.upload("u/p/a.bin", b"one", "application/octet-stream")
    storage.upload("u/p/a.bin", b"two", "text/plain")

    assert storage.download("u/p/a.bin") == b"two"
    assert storage.content_type("u/p/a.bin") == "text/plain"
    assert storage.paths() == ["u/p/a.bin"]


def test_storage_keeps_its_own_copy_of_uploaded_bytes() -> None:
    storage = InMemoryStorage()
    data = bytearray(b"abc")

    storage.upload("u/p/a.bin", data, "application/octet-stream")  # type: ignore[arg-type]
    data[0] = ord("z")

    assert storage.download("u/p/a.bin") == b"abc"
    assert isinstance(storage.download("u/p/a.bin"), bytes)


def test_storage_paths_are_listed_sorted() -> None:
    storage = InMemoryStorage()
    storage.upload("u/p/b", b"", "text/plain")
    storage.upload("u/p/a", b"", "text/plain")

    assert storage.paths() == ["u/p/a", "u/p/b"]


# --- jobs --------------------------------------------------------------------------------------


def test_create_makes_a_queued_job_with_zero_progress() -> None:
    jobs = InMemoryJobStore()

    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)

    assert job.piece_id == PIECE
    assert job.kind == JobKind.PROCESS_PIECE
    assert job.status == JobStatus.QUEUED
    assert job.progress == 0
    assert job.error is None
    assert job.id
    assert jobs.get(job.id) == job


def test_create_gives_every_job_its_own_id() -> None:
    jobs = InMemoryJobStore()

    first = jobs.create(PIECE, JobKind.PROCESS_PIECE)
    jobs.update(first.id, status=JobStatus.DONE)  # one unfinished job at a time per piece
    second = jobs.create(PIECE, JobKind.REALIGN)

    assert first.id != second.id
    assert second.kind == JobKind.REALIGN


def test_get_of_an_unknown_job_is_none() -> None:
    assert InMemoryJobStore().get("nope") is None


def test_update_sets_status_progress_and_error_and_returns_the_new_job() -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)

    running = jobs.update(job.id, status=JobStatus.RUNNING, progress=0.35)

    assert running.status == JobStatus.RUNNING
    assert running.progress == 0.35
    assert running.id == job.id
    assert jobs.get(job.id) == running


def test_update_leaves_unspecified_fields_alone() -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)
    jobs.update(job.id, status=JobStatus.RUNNING, progress=0.5)

    after = jobs.update(job.id, progress=0.75)

    assert after.status == JobStatus.RUNNING
    assert after.progress == 0.75
    assert after.error is None


@pytest.mark.parametrize("progress", [-0.01, 1.01, 2, float("nan")])
def test_update_rejects_progress_outside_zero_to_one(progress: float) -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)

    with pytest.raises(ValueError, match="progress"):
        jobs.update(job.id, status=JobStatus.RUNNING, progress=progress)

    unchanged = jobs.get(job.id)
    assert unchanged == job  # the rejected update changed nothing, not even the status
    assert jobs.history[job.id] == [JobStatus.QUEUED]


@pytest.mark.parametrize("progress", [0, 1, 0.0, 1.0])
def test_update_accepts_progress_at_the_ends(progress: float) -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)

    assert jobs.update(job.id, progress=progress).progress == progress


def test_update_of_an_unknown_job_raises_key_error() -> None:
    with pytest.raises(KeyError):
        InMemoryJobStore().update("nope", status=JobStatus.RUNNING)


TERMINAL_MOVES = [
    (terminal, target)
    for terminal in (JobStatus.DONE, JobStatus.ERROR)
    for target in JobStatus
    if target != terminal
]


@pytest.mark.parametrize(("terminal", "target"), TERMINAL_MOVES)
def test_no_transition_out_of_a_terminal_status(terminal: JobStatus, target: JobStatus) -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)
    jobs.update(job.id, status=JobStatus.RUNNING)
    jobs.update(job.id, status=terminal, progress=1.0 if terminal == JobStatus.DONE else 0.4)
    final = jobs.get(job.id)

    with pytest.raises(ValueError, match="status"):
        jobs.update(job.id, status=target)

    assert jobs.get(job.id) == final
    assert jobs.history[job.id][-1] == terminal


def test_history_records_queued_running_done() -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.PROCESS_PIECE)
    assert jobs.history[job.id] == [JobStatus.QUEUED]

    jobs.update(job.id, status=JobStatus.RUNNING, progress=0.2)
    jobs.update(job.id, progress=0.6)  # a progress tick is not a new status
    jobs.update(job.id, status=JobStatus.RUNNING, progress=0.8)  # neither is repeating one
    jobs.update(job.id, status=JobStatus.DONE, progress=1.0)

    assert jobs.history[job.id] == [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.DONE]


def test_history_of_a_failed_job_ends_with_error() -> None:
    jobs = InMemoryJobStore()
    job = jobs.create(PIECE, JobKind.REALIGN)

    jobs.update(job.id, status=JobStatus.RUNNING, progress=0.3)
    failed = jobs.update(job.id, status=JobStatus.ERROR, error="deskew failed")

    assert jobs.history[job.id] == [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.ERROR]
    assert failed.status == JobStatus.ERROR
    assert failed.error == "deskew failed"
    assert failed.progress == 0.3  # progress stays where the job stopped


def test_history_is_kept_per_job() -> None:
    jobs = InMemoryJobStore()
    first = jobs.create(PIECE, JobKind.PROCESS_PIECE)
    second = jobs.create("another-piece", JobKind.PROCESS_PIECE)  # one unfinished job per piece

    jobs.update(first.id, status=JobStatus.RUNNING)

    assert jobs.history[first.id] == [JobStatus.QUEUED, JobStatus.RUNNING]
    assert jobs.history[second.id] == [JobStatus.QUEUED]


def test_jobs_are_returned_as_copies() -> None:
    jobs = InMemoryJobStore()
    created = jobs.create(PIECE, JobKind.PROCESS_PIECE)

    created.status = JobStatus.DONE
    created.progress = 1.0
    fetched = jobs.get(created.id)
    assert fetched is not None
    fetched.error = "tampered"
    updated = jobs.update(created.id, status=JobStatus.RUNNING)
    updated.progress = 0.9

    final = jobs.get(created.id)
    assert final is not None
    assert final.status == JobStatus.RUNNING
    assert final.progress == 0
    assert final.error is None
    assert final is not jobs.get(created.id)


def test_score_files_without_pages_are_listed_in_hub_order(db: InMemoryDatabase) -> None:
    db.add_score_file(PIECE, "f-b", "user-1/piece-1/b.pdf", name="Cello", position=1)
    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="Violin", position=0)
    db.add_score_file(PIECE, "f-c", "user-1/piece-1/c.pdf", name="Viola", position=2)
    pages = [{"page_index": 0, "image_path": "u/p/0.png", "width": 800, "height": 1100}]

    db.save_page_layer("f-a", pages, [])

    assert [row["id"] for row in db.list_unrendered_score_files(PIECE)] == ["f-b", "f-c"]
    assert db.list_unrendered_score_files("nope") == []


def test_a_part_can_be_named(db: InMemoryDatabase) -> None:
    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="")

    db.set_part_name("f-a", "Violin II")

    assert db.list_score_files(PIECE)[0]["name"] == "Violin II"
    with pytest.raises(KeyError):
        db.set_part_name("f-unknown", "x")


def test_a_part_given_a_name_is_the_users_and_one_without_is_named_after_its_file(
    db: InMemoryDatabase,
) -> None:
    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="Flute")
    db.add_score_file(PIECE, "f-b", "user-1/piece-1/b.pdf", name="", position=1)
    db.add_score_file(
        PIECE, "f-c", "user-1/piece-1/c.pdf", name="Oboe", name_source="file", position=2
    )

    assert [row["name_source"] for row in db.list_score_files(PIECE)] == ["user", "file", "file"]


def test_the_name_the_reader_finds_is_marked_as_read_and_a_file_name_as_a_file_name(
    db: InMemoryDatabase,
) -> None:
    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="")

    db.set_part_name("f-a", "Violin II")
    assert db.list_score_files(PIECE)[0]["name_source"] == "read"

    db.set_part_name("f-a", "a", source="file")
    assert db.list_score_files(PIECE)[0]["name_source"] == "file"


def test_the_recording_has_no_name_until_one_is_given(db: InMemoryDatabase) -> None:
    db.set_audio_source(PIECE, "file", "user-1/piece-1/recording.mp3")
    source = db.get_audio_source(PIECE)
    assert source is not None and source["name"] is None

    db.set_audio_name(PIECE, "Los Banditos")

    source = db.get_audio_source(PIECE)
    assert source is not None and source["name"] == "Los Banditos"
    with pytest.raises(KeyError):
        db.set_audio_name("nope", "x")


def test_the_playback_copy_and_length_of_the_recording_are_recorded(db: InMemoryDatabase) -> None:
    db.set_audio_source(PIECE, "file", "user-1/piece-1/recording.mp3")

    db.set_audio_stored(PIECE, "user-1/piece-1/audio.m4a", 61.5)

    source = db.get_audio_source(PIECE)
    assert source is not None
    assert source["stored_path"] == "user-1/piece-1/audio.m4a"
    assert source["duration"] == 61.5
    assert source["url_or_path"] == "user-1/piece-1/recording.mp3"  # the source itself is untouched
    with pytest.raises(KeyError):
        db.set_audio_stored("nope", "x", 1.0)


def test_box_flags_and_the_tick_are_kept_per_part(db: InMemoryDatabase) -> None:
    from app.pipeline.run_folder import BoxFlag

    db.add_score_file(PIECE, "f-a", "user-1/piece-1/a.pdf", name="Violin", box_check=True)

    assert db.list_score_files(PIECE)[0]["box_check"] is True
    db.set_box_flags("f-a", [BoxFlag(bar=2, verdict="two_bars", note="n")])
    assert db.get_box_flags("f-a") == [
        {"bar": 2, "verdict": "two_bars", "note": "n", "suggestedX": None}
    ]
    db.set_box_flags("f-a", [])
    assert db.get_box_flags("f-a") == []
    with pytest.raises(KeyError):
        db.set_box_flags("nope", [])


def test_the_storage_fake_lists_and_deletes_by_folder() -> None:
    storage = InMemoryStorage()
    for path in ("u/staging/a.pdf", "u/staging/b.json", "u/staging/deep/c.pdf", "v/staging/a.pdf"):
        storage.upload(path, b"x", "application/pdf")

    assert [item.name for item in storage.list_objects("u/staging")] == ["a.pdf", "b.json"]
    assert storage.list_objects("nope") == []
    storage.delete(["u/staging/a.pdf", "u/staging/none.pdf"])
    assert [item.name for item in storage.list_objects("u/staging")] == ["b.json"]


# --- plans: the fake database builds the plan state the SQL function returns ------------------


def test_the_three_plans_are_seeded_with_the_contracts_values(db: InMemoryDatabase) -> None:
    trial = db.plan_state("u")["plan"]
    assert trial["id"] == "trial" and trial["name"] == "Trial"
    assert (trial["pieces_created_max"], trial["pages_per_part_max"]) == (3, 20)
    assert (trial["recording_minutes_max"], trial["advanced_reading"]) == (10, False)
    db.set_plan("c", "creator")
    creator = db.plan_state("c")["plan"]
    assert creator["id"] == "creator" and creator["pieces_created_max"] is None
    assert (creator["pages_per_part_max"], creator["advanced_reading_parts_per_month"]) == (100, 30)
    db.set_plan("x", "unlimited")
    assert db.plan_state("x")["plan"]["advanced_reading_parts_per_month"] is None
    assert set(trial) == set(creator) == set(db.plan_state("x")["plan"])


def test_the_admin_is_on_the_unlimited_row_whatever_the_plan_says(db: InMemoryDatabase) -> None:
    db.add_admin("a")
    db.set_plan("a", "trial")
    state = db.plan_state("a")
    assert state["is_admin"] is True and state["plan"]["id"] == "unlimited"
    assert db.plan_state("nobody")["is_admin"] is False


def test_set_plan_refuses_an_unknown_plan_and_limits_an_unknown_column(
    db: InMemoryDatabase,
) -> None:
    with pytest.raises(KeyError):
        db.set_plan("u", "gold")
    with pytest.raises(KeyError):
        db.set_plan_limits("trial", colour="red")
    with pytest.raises(KeyError):
        db.set_plan_limits("trial", name="Free")
    db.set_plan_limits("trial", pages_per_part_max=30, realign_per_piece_max=None)
    plan = db.plan_state("u")["plan"]
    assert (plan["pages_per_part_max"], plan["realign_per_piece_max"]) == (30, None)


def test_plan_limits_changes_do_not_leak_between_databases(db: InMemoryDatabase) -> None:
    db.set_plan_limits("trial", pages_per_part_max=1)
    assert InMemoryDatabase().plan_state("u")["plan"]["pages_per_part_max"] == 20


def test_pieces_are_counted_as_created_and_stored_and_a_void_gives_one_back() -> None:
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    db.add_piece("p2", "u")
    db.add_piece("p3", "other")
    assert db.usage_of("u")["pieces_created"] == 2
    assert db.usage_of("u")["pieces_stored"] == 2
    assert db.usage_of("u")["new_pieces_today_on_plan"] == 3  # all on Trial
    db.void_piece_created("p1")
    db.void_piece_created("p1")  # twice is the same as once
    assert db.usage_of("u")["pieces_created"] == 1
    assert db.usage_of("u")["pieces_stored"] == 2  # the piece is still there
    assert db.usage_of("u")["new_pieces_today_on_plan"] == 2
    assert [e["voided_at"] is not None for e in db.events_of("u", "piece_created")] == [True, False]


def test_delete_piece_removes_the_piece_and_what_hangs_on_it_but_not_its_events() -> None:
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    db.add_piece("p2", "u")
    db.add_score_file("p1", "f1", "u/p1/a.pdf")
    db.add_score_file("p2", "f2", "u/p2/a.pdf")
    db.save_page_layer("f1", [{"page_index": 0}], [])
    db.save_structure("p1", [PlayOrderRow(start=1, end=2)], [], [])

    db.delete_piece("p1")
    db.delete_piece("p1")  # twice is the same as once

    assert db.get_piece_owner("p1") is None
    assert db.list_score_files("p1") == [] and db.get_structure("p1") == ([], [], [])
    assert db.get_piece_owner("p2") == "u" and len(db.list_score_files("p2")) == 1
    assert db.usage_of("u")["pieces_stored"] == 1
    assert db.usage_of("u")["pieces_created"] == 2  # a deleted piece is still a piece made


def test_claim_piece_clears_a_voided_event_when_there_is_room_and_names_the_limit_when_not() -> (
    None
):
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    db.void_piece_created("p1")
    assert db.usage_of("u")["pieces_created"] == 0
    assert db.claim_piece("p1") is None
    assert db.usage_of("u")["pieces_created"] == 1  # counted again
    assert db.claim_piece("p1") is None  # a live event: nothing to do
    assert len(db.events_of("u", "piece_created")) == 1

    db.void_piece_created("p1")
    for name in ("a", "b", "c"):
        db.add_piece(name, "u")  # the freed slot, and more, is taken meanwhile
    assert db.claim_piece("p1") == "pieces_created_max"
    assert db.events_of("u", "piece_created")[0]["voided_at"] is not None


def test_claim_piece_checks_the_daily_cap_and_never_refuses_the_admin_or_an_unknown_piece() -> None:
    db = InMemoryDatabase()
    db.set_plan_limits("trial", new_pieces_per_day=1, pieces_created_max=None)
    db.add_piece("p1", "u")
    db.void_piece_created("p1")
    db.add_piece("p2", "other")  # today's cap is taken by someone else on Trial
    assert db.claim_piece("p1") == "new_pieces_per_day"
    db.add_admin("u")
    assert db.claim_piece("p1") is None
    assert db.usage_of("u")["pieces_created"] == 1
    assert db.claim_piece("no-such-piece") is None


def test_use_advanced_reading_checks_and_records_in_one_call() -> None:
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    db.set_plan("u", "creator")  # 30 parts a month
    db.record_usage("u", "advanced_reading_part", "p1", None, 28)
    assert db.use_advanced_reading("u", "p1", ["f1", "f2"]) is None
    assert [e["part_id"] for e in db.events_of("u", "advanced_reading_part")][-2:] == ["f1", "f2"]
    assert db.use_advanced_reading("u", "p1", ["f3"]) == "advanced_reading_parts_per_month"
    assert len(db.events_of("u", "advanced_reading_part")) == 30  # a refusal records nothing
    assert db.use_advanced_reading("u", "p1", []) is None  # nothing to read, nothing to count


def test_use_advanced_reading_is_refused_on_a_plan_without_it_and_never_for_the_admin() -> None:
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    assert db.use_advanced_reading("u", "p1", ["f1"]) == "advanced_reading"
    assert db.events_of("u", "advanced_reading_part") == []
    db.add_admin("u")
    db.record_usage("u", "advanced_reading_part", "p1", None, 500)
    assert db.use_advanced_reading("u", "p1", ["f1"]) is None


def test_a_new_piece_is_counted_on_the_plan_its_owner_was_on() -> None:
    db = InMemoryDatabase()
    db.set_plan("c", "creator")
    db.add_piece("p1", "c")
    assert db.events_of("c")[0]["plan_id"] == "creator"
    assert db.usage_of("c")["new_pieces_today_on_plan"] == 1
    assert db.usage_of("u")["new_pieces_today_on_plan"] == 0


def test_record_usage_adds_n_events_and_the_month_counts_advanced_reading() -> None:
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    db.record_usage("u", "advanced_reading_part", "p1", "f1", 2)
    db.record_usage("u", "advanced_reading_part", "p1", "f2")
    assert len(db.events_of("u", "advanced_reading_part")) == 3
    assert db.usage_of("u")["advanced_reading_parts_this_month"] == 3
    assert db.usage_of("other")["advanced_reading_parts_this_month"] == 0


def test_the_piece_block_counts_parts_realigns_and_read_again_per_part() -> None:
    db = InMemoryDatabase()
    db.add_piece("p1", "u")
    db.add_score_file("p1", "f1", "u/p1/a.pdf")
    db.add_score_file("p1", "f2", "u/p1/b.pdf", position=1)
    db.record_usage("u", "realign", "p1", None)
    db.record_usage("u", "read_again", "p1", "f1", 2)
    assert db.plan_state("u", "p1")["piece"] == {
        "id": "p1",
        "parts": 2,
        "realigns": 1,
        "read_again_by_part": {"f1": 2},
    }
    assert db.plan_state("u")["piece"] is None
    assert db.plan_state("other", "p1")["piece"] is None  # not their piece
