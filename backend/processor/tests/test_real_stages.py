"""The real stages run on fakes of their tools, end to end through the orchestrator.

One synthetic piece: a 25 s recording of eight 4/4 bars two seconds apart, a one-page PDF drawn
as two systems of four measures, a scripted score reader and a scripted beat model.
"""

import shutil
from dataclasses import replace
from pathlib import Path

import pymupdf
import pytest

import app.pipeline.real_stages as rs
from app.db import InMemoryDatabase
from app.deps import Services
from app.jobs import InMemoryJobStore
from app.pipeline.audio_ingest import AudioIngestError, AudioProbe, FakeAudioTool
from app.pipeline.beats import BeatActivations, BeatModelError, BeatTrack, FakeBeatModel
from app.pipeline.models import BarMark, Job, JobKind, JobStatus, Locator
from app.pipeline.orchestrator import add_parts, process_piece, realign_piece
from app.pipeline.pdf_pages import FakePdfRenderer
from app.pipeline.real_stages import (
    NO_KEY_NOTICE,
    RealAudioStage,
    RealDownbeatStage,
    RealOmrStage,
    RealPagesStage,
    Tools,
    missing_tool,
    real_stages,
    startup_notes,
)
from app.pipeline.score_reader import FakeScoreReader
from app.pipeline.stages import (
    AudioResult,
    AudioStage,
    DownbeatStage,
    FakeAudioStage,
    OmrStage,
    PagesStage,
    Stages,
    default_stages,
)
from app.settings import Settings
from app.storage import InMemoryStorage
from tests.structure_fixtures import BookEngine, ink_of, line, reading, sheet_xml, system_xml
from tests.synthetic import logit_curves
from tests.test_beats import click_track

OWNER, PIECE, PART = "user-owner", "piece-1", "file-1"
RECORDING = f"{OWNER}/{PIECE}/recording.mp3"
PDF_PATH = f"{OWNER}/{PIECE}/score.pdf"
OLD_LINK = "https://www.youtube.com/watch?v=abc"
DURATION = 25.0
BEATS = [0.5 + 0.5 * k for k in range(32)]
PAGE_PT = (240.0, 144.0)  # 1000 x 600 px at the 300 DPI small pages get


def beat_model() -> FakeBeatModel:
    beat_logits, downbeat_logits = logit_curves(BEATS, BEATS[::4], DURATION)
    return FakeBeatModel(
        BeatActivations(beat_logits, downbeat_logits, 50.0), BeatTrack(BEATS, BEATS[::4])
    )


def engine() -> BookEngine:
    sheet = sheet_xml(system_xml(100, 4, 1, "4/4"), system_xml(350, 4, 5))
    return BookEngine({1: sheet}, {1: ink_of(4, 4)})


def tools(reader: FakeScoreReader | None = None, pages: int = 1) -> Tools:
    return Tools(
        audio=FakeAudioTool(AudioProbe(DURATION, 44100, 2, "mp3")),
        renderer=FakePdfRenderer([PAGE_PT] * pages),
        engine=engine(),
        reader=reader,
        beats=beat_model(),
    )


def one_reading():
    return reading(line(4, time_signature="4/4"), line(4), name="Violin I")


class World:
    def __init__(self, tmp_path: Path, reader: FakeScoreReader | None = None) -> None:
        self.db = InMemoryDatabase()
        self.storage = InMemoryStorage()
        self.jobs = InMemoryJobStore()
        self.services = Services(db=self.db, storage=self.storage, jobs=self.jobs)
        self.scratch = tmp_path / "scratch"
        self.tools = tools(reader or FakeScoreReader([one_reading()]))
        self.db.add_piece(PIECE, OWNER)
        self.db.add_score_file(PIECE, PART, PDF_PATH, name="Violin")
        self.db.set_audio_source(PIECE, "file", RECORDING)
        self.storage.upload(PDF_PATH, b"%PDF-1.7 fake", "application/pdf")
        self.storage.upload(RECORDING, b"fake mp3", "audio/mpeg")

    @property
    def stages(self) -> Stages:
        return real_stages(self.db, self.storage, self.tools, self.scratch)

    def run(self, runner, kind: JobKind, stages: Stages | None = None) -> Job:
        job = self.jobs.create(PIECE, kind)
        runner(job, self.services, stages or self.stages)
        done = self.jobs.get(job.id)
        assert done is not None
        return done


@pytest.fixture
def world(tmp_path: Path) -> World:
    return World(tmp_path)


# ---------------------------------------------------------------- the contract


def test_every_real_stage_satisfies_its_protocol(world: World) -> None:
    stages = world.stages
    assert isinstance(stages.audio, AudioStage)
    assert isinstance(stages.pages, PagesStage)
    assert isinstance(stages.omr, OmrStage)
    assert isinstance(stages.downbeats, DownbeatStage)
    assert isinstance(stages.audio, RealAudioStage)
    assert isinstance(stages.pages, RealPagesStage)
    assert isinstance(stages.omr, RealOmrStage)
    assert isinstance(stages.downbeats, RealDownbeatStage)


# ---------------------------------------------------------------- the stages alone


def test_an_uploaded_recording_is_stored_decoded_and_given_peaks(world: World) -> None:
    audio = world.stages.audio.ingest(PIECE)

    assert audio.duration_sec == pytest.approx(DURATION, abs=0.01)
    assert audio.wav_path is not None and audio.wav_path.is_file()
    assert audio.peaks["version"] == 2
    assert f"{OWNER}/{PIECE}/audio.m4a" in world.storage.paths()


def test_the_recordings_length_and_stored_copy_are_written_to_the_database(world: World) -> None:
    world.stages.audio.ingest(PIECE)

    source = world.db.get_audio_source(PIECE)
    assert source is not None
    assert source["stored_path"] == f"{OWNER}/{PIECE}/audio.m4a"
    assert source["duration"] == pytest.approx(DURATION, abs=0.01)
    assert source["url_or_path"] == RECORDING


def test_an_old_youtube_row_is_refused_with_a_sentence(
    world: World,
) -> None:
    world.db.set_audio_source(PIECE, "youtube", OLD_LINK)

    with pytest.raises(AudioIngestError, match="Add the recording as a file"):
        world.stages.audio.ingest(PIECE)


def test_an_uploaded_file_keeps_the_name_it_was_given(world: World) -> None:
    world.db.set_audio_name(PIECE, "take 3")

    world.stages.audio.ingest(PIECE)

    source = world.db.get_audio_source(PIECE)
    assert source is not None and source["name"] == "take 3"


def test_a_piece_without_a_recording_says_so(world: World) -> None:
    world.db._audio_sources.clear()

    with pytest.raises(ValueError, match="no recording"):
        world.stages.audio.ingest(PIECE)


@pytest.mark.parametrize("name", ["recording.m3u8", "recording.txt", "recording"])
def test_a_recording_with_another_suffix_is_refused_before_ffmpeg_sees_it(
    world: World, name: str
) -> None:
    path = f"{OWNER}/{PIECE}/upload/{name}"
    world.storage.upload(path, b"#EXTM3U\nhttp://169.254.169.254/latest/meta-data/", "text/plain")
    world.db.set_audio_source(PIECE, "file", path)
    probed = world.tools.audio
    assert isinstance(probed, FakeAudioTool)
    probed.probed.clear()

    with pytest.raises(AudioIngestError, match="not a recording"):
        world.stages.audio.ingest(PIECE)

    assert probed.probed == []  # the audio tool never saw the file


def test_a_suffix_in_capitals_is_still_a_recording(world: World) -> None:
    path = f"{OWNER}/{PIECE}/upload/recording.MP3"
    world.storage.upload(path, b"fake mp3", "audio/mpeg")
    world.db.set_audio_source(PIECE, "file", path)

    audio = world.stages.audio.ingest(PIECE)

    assert audio.duration_sec == pytest.approx(DURATION, abs=0.01)


def test_a_retry_on_an_imported_piece_passes_the_suffix_check(world: World) -> None:
    """An imported piece's url_or_path ends in .m4a, the converted copy the import stored."""
    path = f"{OWNER}/{PIECE}/audio.m4a"
    world.storage.upload(path, b"fake m4a", "audio/mp4")
    world.db.set_audio_source(PIECE, "file", path)

    assert world.stages.audio.ingest(PIECE).duration_sec == pytest.approx(DURATION, abs=0.01)


def test_a_recording_missing_from_storage_says_so(world: World) -> None:
    world.db.set_audio_source(PIECE, "file", f"{OWNER}/{PIECE}/gone.mp3")

    with pytest.raises(ValueError, match="missing from storage"):
        world.stages.audio.ingest(PIECE)


def test_the_pdf_is_rendered_into_stored_page_images(world: World) -> None:
    (row,) = world.db.list_score_files(PIECE)

    rendered = world.stages.pages.render(row)

    assert [(p.width, p.height) for p in rendered.pages] == [(1000, 600)]
    assert rendered.pages[0].image_path == f"{OWNER}/{PIECE}/{PART}/page-0.webp"
    assert rendered.pages[0].image_path in world.storage.paths()


def test_a_pdf_missing_from_storage_says_so(world: World) -> None:
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/gone.pdf", name="Cello", position=1)
    row = world.db.list_score_files(PIECE)[1]

    with pytest.raises(ValueError, match="PDF is missing"):
        world.stages.pages.render(row)


def test_the_omr_reads_the_pdf_the_pages_stage_fetched(world: World) -> None:
    (row,) = world.db.list_score_files(PIECE)
    stages = world.stages
    rendered = stages.pages.render(row)

    part = stages.omr.read(row, rendered)

    assert len(part.boxes) == 8
    assert part.part_name == "Violin I"
    (pdf,) = world.scratch.glob(f"*/{PIECE}/parts/{PART}/part.pdf")
    assert pdf.read_bytes() == b"%PDF-1.7 fake"


def test_the_downbeat_stage_gives_the_logits_and_the_beats(world: World) -> None:
    audio = AudioResult({}, DURATION, Path("audio.wav"))

    heard = world.stages.downbeats.listen(audio)

    assert heard.fps == 50.0
    assert heard.beats == BEATS
    assert len(heard.beat_logits) == len(heard.downbeat_logits) == round(DURATION * 50)


def test_a_recording_that_was_not_decoded_cannot_be_listened_to(world: World) -> None:
    with pytest.raises(ValueError, match="not decoded"):
        world.stages.downbeats.listen(AudioResult({}, DURATION))


def test_a_recording_with_hardly_any_beats_is_refused(world: World) -> None:
    track = BeatTrack([0.5, 1.0, 1.5], [0.5])
    model = FakeBeatModel(beat_model().activations(Path("x")), track)

    with pytest.raises(BeatModelError, match="Only 3 beats"):
        RealDownbeatStage(model).listen(AudioResult({}, DURATION, Path("audio.wav")))


# ---------------------------------------------------------------- process-piece


def test_process_piece_on_the_real_stages_writes_the_map(world: World) -> None:
    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.DONE, job.error
    assert job.warnings == []
    pages, bars = world.db.get_page_layer(PART)
    assert [p["page_index"] for p in pages] == [0]
    assert [b.bar for b in bars] == list(range(1, 9))
    locators = world.db.get_locators(PIECE)
    assert [item.bar for item in locators] == list(range(1, 9))
    assert [item.time_sec for item in locators] == pytest.approx(
        [0.5 + 2 * k for k in range(8)], abs=0.05
    )
    assert all(item.flags == [] for item in locators)
    rows, meters, _ = world.db.get_structure(PIECE)
    assert [(r.start, r.end) for r in rows] == [(1, 8)]
    assert [(m.numerator, m.denominator) for m in meters] == [(4, 4)]
    assert f"{OWNER}/{PIECE}/peaks.json" in world.storage.paths()
    assert list(world.scratch.iterdir()) == []  # the job's scratch folder is cleared


def test_every_job_has_a_scratch_folder_of_its_own(world: World) -> None:
    first, second = world.stages, world.stages
    first.audio.ingest(PIECE)
    second.audio.ingest(PIECE)

    assert len(list(world.scratch.iterdir())) == 2
    first.clean_up()
    assert len(list(world.scratch.iterdir())) == 1  # the other job's files are still there
    second.clean_up()
    assert list(world.scratch.iterdir()) == []


def test_the_vision_cost_and_the_part_name_reach_the_job_and_the_database(
    tmp_path: Path,
) -> None:
    world = World(tmp_path, FakeScoreReader([one_reading()], cost_usd=0.012))
    world.db.set_part_name(PART, "")

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.cost_usd == pytest.approx(0.012)
    assert world.db.list_score_files(PIECE)[0]["name"] == "Violin I"


def test_without_a_key_the_job_still_finishes_and_says_so(tmp_path: Path) -> None:
    world = World(tmp_path)
    world.tools = replace(world.tools, reader=None)

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.DONE, job.error
    assert job.cost_usd == 0.0
    assert any("without the vision model (no Anthropic key)" in w for w in job.warnings)
    assert len(world.db.get_locators(PIECE)) == 8


def test_a_fermata_the_reader_saw_is_kept_in_the_structure(tmp_path: Path) -> None:
    fermata = reading(
        line(4, time_signature="4/4"),
        line(4).model_copy(
            update={"measures": [*line(4).measures[:3], line(1, fermata_beats=[1]).measures[0]]}
        ),
    )
    world = World(tmp_path, FakeScoreReader([fermata]))

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.DONE, job.error
    assert world.db.get_structure(PIECE)[2] == [BarMark(bar=8, kind="fermata")]


def test_a_failing_tool_ends_the_job_with_its_sentence(world: World) -> None:
    world.db.set_audio_source(PIECE, "file", f"{OWNER}/{PIECE}/gone.mp3")

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.ERROR
    assert job.error == "audio failed: The recording file is missing from storage."
    assert world.db.get_locators(PIECE) == []


# ---------------------------------------------------------------- stored paths a user wrote

FOREIGN = "user-other/piece-9/secret.pdf"
NOT_IN_FOLDER = "The stored file is not in this piece's folder."


class WatchedStorage(InMemoryStorage):
    """An InMemoryStorage that remembers every path it was asked to download."""

    def __init__(self) -> None:
        super().__init__()
        self.downloads: list[str] = []

    def download(self, path: str) -> bytes:
        self.downloads.append(path)
        return super().download(path)


def watched(world: World) -> WatchedStorage:
    """Swap the world's storage for a watched copy holding the same files."""
    storage = WatchedStorage()
    for path in world.storage.paths():
        storage.upload(path, world.storage.download(path), world.storage.content_type(path))
    storage.upload(FOREIGN, b"%PDF-1.7 another user's score", "application/pdf")
    world.storage = storage
    world.services = Services(db=world.db, storage=storage, jobs=world.jobs)
    return storage


def test_a_part_pointing_into_another_users_folder_is_refused_and_not_downloaded(
    world: World,
) -> None:
    storage = watched(world)
    world.db.add_score_file(PIECE, "file-2", FOREIGN, name="Cello", position=1)
    row = world.db.list_score_files(PIECE)[1]
    storage.downloads.clear()

    with pytest.raises(ValueError) as caught:
        world.stages.pages.render(row)

    assert str(caught.value) == NOT_IN_FOLDER
    assert storage.downloads == []


def test_the_omr_stage_also_refuses_a_foreign_part_path(world: World) -> None:
    storage = watched(world)
    (row,) = world.db.list_score_files(PIECE)
    stages = world.stages
    rendered = stages.pages.render(row)
    foreign = {**row, "id": "file-2", "storage_path": FOREIGN}
    storage.downloads.clear()

    with pytest.raises(ValueError) as caught:
        stages.omr.read(foreign, rendered)

    assert str(caught.value) == NOT_IN_FOLDER
    assert storage.downloads == []


def test_a_foreign_part_path_fails_the_job_with_the_sentence_and_downloads_nothing(
    world: World,
) -> None:
    storage = watched(world)
    world.db.add_score_file(PIECE, "file-2", FOREIGN, name="Cello", position=1)

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.ERROR
    assert job.error is not None and job.error.endswith(NOT_IN_FOLDER)
    assert "secret" not in job.error and "user-other" not in job.error
    assert FOREIGN not in storage.downloads


@pytest.mark.parametrize(
    "path", [FOREIGN, f"{OWNER}/{PIECE}/../piece-9/a.mp3", f"{OWNER}/{PIECE}x/a.mp3"]
)
def test_a_recording_outside_the_piece_folder_is_refused_and_not_downloaded(
    world: World, path: str
) -> None:
    storage = watched(world)
    world.db.set_audio_source(PIECE, "file", path)
    storage.downloads.clear()

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.ERROR
    assert job.error == f"audio failed: {NOT_IN_FOLDER}"
    assert storage.downloads == []


def test_a_normal_piece_still_processes_with_every_path_inside_its_folder(world: World) -> None:
    storage = watched(world)

    job = world.run(process_piece, JobKind.PROCESS_PIECE)

    assert job.status == JobStatus.DONE, job.error
    assert PDF_PATH in storage.downloads and RECORDING in storage.downloads
    assert FOREIGN not in storage.downloads


# ---------------------------------------------------------------- realign


def test_realign_on_the_real_stages_keeps_the_confirmed_locator(world: World) -> None:
    world.run(process_piece, JobKind.PROCESS_PIECE)
    world.db.replace_unconfirmed_locators(PIECE, [])
    world.db.add_locators(
        PIECE,
        [
            Locator(bar=1, pass_index=0, time_sec=0.52, confirmed=True),
            *(Locator(bar=b, pass_index=0, time_sec=float(b)) for b in range(2, 9)),
        ],
    )

    job = world.run(realign_piece, JobKind.REALIGN)

    assert job.status == JobStatus.DONE, job.error
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert locators[1].time_sec == 0.52 and locators[1].confirmed
    assert [locators[b].time_sec for b in range(2, 9)] == pytest.approx(
        [0.5 + 2 * (b - 1) for b in range(2, 9)], abs=0.05
    )


# ---------------------------------------------------------------- add-parts


def two_part_world(tmp_path: Path, second_reading=None) -> World:
    """A processed piece with one part, and a second score file waiting for its pages."""
    reader = FakeScoreReader([one_reading(), second_reading or one_reading()])
    world = World(tmp_path, reader)
    world.run(process_piece, JobKind.PROCESS_PIECE)
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    world.storage.upload(f"{OWNER}/{PIECE}/cello.pdf", b"%PDF-1.7 cello", "application/pdf")
    return world


def test_add_parts_reads_only_the_parts_without_pages_and_leaves_the_timing(tmp_path: Path) -> None:
    world = two_part_world(tmp_path)
    timing = (world.db.get_structure(PIECE), world.db.get_locators(PIECE))
    first_layer = world.db.get_page_layer(PART)
    world.tools = replace(world.tools, renderer=FakePdfRenderer([PAGE_PT]))

    job = world.run(add_parts, JobKind.ADD_PARTS)

    assert job.status == JobStatus.DONE, job.error
    assert job.warnings == []
    pages, bars = world.db.get_page_layer("file-2")
    assert len(pages) == 1 and [b.bar for b in bars] == list(range(1, 9))
    assert world.db.get_page_layer(PART) == first_layer
    assert (world.db.get_structure(PIECE), world.db.get_locators(PIECE)) == timing
    assert [r["id"] for r in world.db.list_unrendered_score_files(PIECE)] == []


def test_add_parts_with_nothing_new_is_a_no_op(tmp_path: Path) -> None:
    world = two_part_world(tmp_path)
    world.run(add_parts, JobKind.ADD_PARTS)
    calls = len(world.tools.reader.calls)

    job = world.run(add_parts, JobKind.ADD_PARTS)

    assert job.status == JobStatus.DONE
    assert len(world.tools.reader.calls) == calls  # nothing was read again


def test_a_new_part_with_another_bar_count_is_a_part_problem_not_a_failure(
    tmp_path: Path,
) -> None:
    short = reading(line(4, time_signature="4/4"), line(3))
    world = two_part_world(tmp_path, short)
    world.tools = replace(
        world.tools,
        engine=BookEngine(
            {1: sheet_xml(system_xml(100, 4, 1, "4/4"), system_xml(350, 3, 5))}, {1: ink_of(4, 3)}
        ),
    )

    job = world.run(add_parts, JobKind.ADD_PARTS)

    assert job.status == JobStatus.DONE, job.error
    assert job.warnings == ["Cello has 7 bars but the piece has 8; check its bar lines."]
    assert len(world.db.get_page_layer("file-2")[1]) == 7


def test_add_parts_on_a_piece_that_was_never_processed_is_an_error(tmp_path: Path) -> None:
    world = World(tmp_path)

    job = world.run(add_parts, JobKind.ADD_PARTS)

    assert job.status == JobStatus.ERROR
    assert job.error is not None and job.error.startswith("load failed:")


def test_add_parts_progress_follows_the_three_steps_of_the_processing_screen(
    tmp_path: Path,
) -> None:
    world = two_part_world(tmp_path)
    seen: list[float] = []

    class Spy(InMemoryJobStore):
        def update(self, job_id, **changes):  # type: ignore[no-untyped-def]
            job = super().update(job_id, **changes)
            seen.append(job.progress)
            return job

    world.jobs = Spy()
    world.services = Services(db=world.db, storage=world.storage, jobs=world.jobs)

    world.run(add_parts, JobKind.ADD_PARTS)

    assert seen == [0, 0.3, 0.8, 1.0]


# ---------------------------------------------------------------- choosing the stages


def test_the_fakes_run_unless_the_services_are_real(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("USE_FAKES", "SUPABASE_URL", "SUPABASE_JWT_SECRET", "SUPABASE_JWKS_URL"):
        monkeypatch.delenv(name, raising=False)
    services = Services(InMemoryDatabase(), InMemoryStorage(), InMemoryJobStore())

    assert isinstance(default_stages().audio, FakeAudioStage)
    assert isinstance(default_stages(services).audio, FakeAudioStage)
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setenv("USE_FAKES", "1")
    assert isinstance(default_stages(services).audio, FakeAudioStage)


def test_real_services_without_use_fakes_get_the_real_stages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("USE_FAKES", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setattr(rs, "real_tools", lambda settings: tools())
    services = Services(InMemoryDatabase(), InMemoryStorage(), InMemoryJobStore())

    assert isinstance(default_stages(services).audio, RealAudioStage)


def test_a_missing_tool_is_named_in_one_sentence(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: None)

    assert missing_tool() == "FFmpeg is not installed on the server."
    with pytest.raises(RuntimeError, match="FFmpeg is not installed"):
        rs.real_tools(Settings())


def test_missing_java_is_named(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: "/bin/" + name if name != "java" else None)
    monkeypatch.delenv("JAVA_HOME", raising=False)

    assert missing_tool() == "Java is not installed on the server (Audiveris needs it)."


def test_missing_audiveris_is_named(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: "/bin/" + name)
    monkeypatch.setenv("AUDIVERIS_HOME", str(tmp_path))

    assert missing_tool() is not None and "AUDIVERIS_HOME" in missing_tool()


def test_a_missing_beat_extra_is_named(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "bin").mkdir()
    (tmp_path / "bin" / "Audiveris").write_text("")
    monkeypatch.setattr(shutil, "which", lambda name: "/bin/" + name)
    monkeypatch.setenv("AUDIVERIS_HOME", str(tmp_path))
    monkeypatch.setattr("importlib.util.find_spec", lambda name: None)

    assert missing_tool() == "Beat This is not installed (uv sync --extra beat)."


REAL_SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_secret_key="sb_secret_x")


def test_the_startup_check_is_silent_on_fakes_and_raises_on_a_missing_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert startup_notes(Settings()) == []
    assert startup_notes(Settings(use_fakes=True, supabase_url="https://x.supabase.co")) == []
    monkeypatch.setattr(rs, "missing_tool", lambda: "Java is not installed.")
    with pytest.raises(RuntimeError, match="Java is not installed"):
        startup_notes(REAL_SETTINGS)


@pytest.mark.parametrize(
    ("settings", "missing"),
    [
        (Settings(supabase_url="https://x.supabase.co"), "SUPABASE_SECRET_KEY"),
        (Settings(supabase_secret_key="sb_secret_x"), "SUPABASE_URL"),
        (Settings(supabase_jwt_secret="s" * 40), "SUPABASE_URL and SUPABASE_SECRET_KEY"),
    ],
)
def test_the_startup_check_refuses_half_a_configuration_by_name(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, missing: str
) -> None:
    monkeypatch.setattr(rs, "missing_tool", lambda: None)
    with pytest.raises(RuntimeError, match=missing) as refused:
        startup_notes(settings)
    assert "sb_secret_x" not in str(refused.value)


def test_the_startup_check_notes_a_missing_anthropic_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rs, "missing_tool", lambda: None)
    real = REAL_SETTINGS

    assert startup_notes(real) == [NO_KEY_NOTICE]
    assert startup_notes(real.model_copy(update={"anthropic_api_key": "k"})) == []


# ---------------------------------------------------------------- the real tools


def one_line_pdf(path: Path) -> None:
    """One page with a single system: a five-line staff of four measures with note heads."""
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    for k in range(5):
        page.draw_line((50, 120 + 8 * k), (562, 120 + 8 * k), width=0.8)
    for x in (50, 178, 306, 434, 562):
        page.draw_line((x, 120), (x, 152), width=1.0)
    for x in (90, 150, 220, 280, 350, 410, 480, 530):
        y = 148 - (x % 3) * 4
        page.draw_oval(pymupdf.Rect(x - 5, y - 3.5, x + 5, y + 3.5), fill=(0, 0, 0))
        page.draw_line((x + 5, y), (x + 5, y - 28), width=1.0)
    document.save(path)


@pytest.mark.real
def test_a_generated_piece_goes_through_the_real_tools(tmp_path: Path) -> None:
    """FFmpeg, PyMuPDF, Audiveris and Beat This on a 25 s click track and a one-line PDF."""
    pdf, wav = tmp_path / "score.pdf", tmp_path / "clicks.wav"
    one_line_pdf(pdf)
    click_track(wav, seconds=25.0)
    world = World(tmp_path)
    world.storage.upload(PDF_PATH, pdf.read_bytes(), "application/pdf")
    world.storage.upload(RECORDING, wav.read_bytes(), "audio/wav")
    world.tools = rs.real_tools(Settings())
    stages = real_stages(world.db, world.storage, world.tools, world.scratch)

    job = world.run(process_piece, JobKind.PROCESS_PIECE, stages)

    assert job.status == JobStatus.DONE, job.error
    pages, bars = world.db.get_page_layer(PART)
    locators = world.db.get_locators(PIECE)
    print(f"real piece: {len(pages)} page(s), {len(bars)} bar boxes, {len(locators)} locators")
    print("locator times:", [round(item.time_sec, 2) for item in locators])
    print("warnings:", job.warnings)
    assert len(pages) == 1 and len(bars) >= 2
    assert len(locators) == len(bars)
    assert [item.time_sec for item in locators] == sorted(item.time_sec for item in locators)
    assert NO_KEY_NOTICE not in job.warnings  # that notice is the server's, not the job's
    assert any("without the vision model" in w for w in job.warnings)
