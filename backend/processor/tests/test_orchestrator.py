import copy
import json
from dataclasses import dataclass, replace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.auth import AuthUser, current_user
from app.db import InMemoryDatabase
from app.deps import Services, get_services
from app.job_end import GENERIC_FAILURE
from app.jobs import InMemoryJobStore, run_job
from app.main import create_app, get_job_runner
from app.pipeline import orchestrator
from app.pipeline.align import NoAlignmentError
from app.pipeline.analysis import analysis_path, load_analysis
from app.pipeline.audio_ingest import AudioIngestError
from app.pipeline.audiveris import OmrError
from app.pipeline.beats import BeatModelError
from app.pipeline.models import (
    BarBox,
    BarMark,
    FailedPart,
    Job,
    JobKind,
    JobStatus,
    Locator,
    MeterChange,
    PlayOrderRow,
    ReviewFlag,
    ShortBar,
)
from app.pipeline.orchestrator import SKIPPED_REPEATS, add_parts, process_piece, realign_piece
from app.pipeline.pickup import renumbered, renumbered_boxes
from app.pipeline.play_order import MarkKind, StructureMark, propose_play_order
from app.pipeline.stages import (
    AudioResult,
    AudioStage,
    DownbeatStage,
    FakeAudioStage,
    FakeDownbeatStage,
    FakeOmrStage,
    FakePagesStage,
    Heard,
    OmrStage,
    PagesStage,
    RenderedPart,
    Stages,
    default_stages,
)
from app.pipeline.structure_read import PartRead
from app.settings import Settings
from app.storage import InMemoryStorage
from app.supabase_rest import RestError
from tests.inline_runner import InlineRunner
from tests.synthetic import bar_times, logit_curves

OWNER = "user-owner"
PIECE = "piece-1"
PART = "file-1"
PEAKS_PATH = f"{OWNER}/{PIECE}/peaks.json"
PROCESS_PROGRESS = [0, 0.2, 0.35, 0.55, 0.65, 0.8, 0.95, 1.0]
REALIGN_PROGRESS = [0, 0.1, 0.3, 0.6, 0.9, 1.0]


class SpyJobStore(InMemoryJobStore):
    """An InMemoryJobStore that remembers the job after every update."""

    def __init__(self) -> None:
        super().__init__()
        self.snapshots: list[Job] = []

    def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: float | None = None,
        error: str | None = None,
        warnings: list[str] | None = None,
        cost_usd: float | None = None,
        failed_parts: list[FailedPart] | None = None,
    ) -> Job:
        job = super().update(
            job_id,
            status=status,
            progress=progress,
            error=error,
            warnings=warnings,
            cost_usd=cost_usd,
            failed_parts=failed_parts,
        )
        self.snapshots.append(job)
        return job

    @property
    def progress(self) -> list[float]:
        return [job.progress for job in self.snapshots]


@dataclass
class World:
    db: InMemoryDatabase
    storage: InMemoryStorage
    jobs: SpyJobStore
    services: Services


def make_world(*, with_score_file: bool = True) -> World:
    db = InMemoryDatabase()
    db.add_piece(PIECE, OWNER)
    if with_score_file:
        db.add_score_file(PIECE, PART, f"{OWNER}/{PIECE}/score.pdf", name="Violin")
    storage = InMemoryStorage()
    jobs = SpyJobStore()
    return World(db, storage, jobs, Services(db=db, storage=storage, jobs=jobs))


@pytest.fixture
def world() -> World:
    return make_world()


def start(world: World, kind: JobKind) -> Job:
    return world.jobs.create(PIECE, kind)


def final(world: World, job: Job) -> Job:
    result = world.jobs.get(job.id)
    assert result is not None
    return result


def loc(bar: int, time_sec: float, pass_index: int = 0, confirmed: bool = False) -> Locator:
    return Locator(bar=bar, pass_index=pass_index, time_sec=time_sec, confirmed=confirmed)


# --- stages that fail or differ from the fakes --------------------------------------------------


class Boom:
    """One failing stage: raises `error` from whichever method the stage Protocol names."""

    def __init__(self, error: Exception) -> None:
        self.error = error

    def ingest(self, piece_id: str) -> AudioResult:
        raise self.error

    def page_count(self, score_file: dict) -> int:
        raise self.error

    def render(self, score_file: dict) -> RenderedPart:
        raise self.error

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        raise self.error

    def listen(self, audio: AudioResult) -> Heard:
        raise self.error


def stages_with(**changes: object) -> Stages:
    return replace(default_stages(), **changes)


def even_beats(starts: list[float], per_bar: int, last_length: float = 2.0) -> list[float]:
    """`per_bar` evenly spaced beats in every bar that starts at one of `starts`."""
    ends = [*starts[1:], starts[-1] + last_length]
    return [
        start + k * (end - start) / per_bar
        for start, end in zip(starts, ends, strict=True)
        for k in range(per_bar)
    ]


class FermataOmr(FakeOmrStage):
    """The fake OMR, plus a fermata printed on one bar."""

    def __init__(self, bar: int) -> None:
        self.bar = bar

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        structure = replace(result.structure, bar_marks=[BarMark(bar=self.bar, kind="fermata")])
        return replace(result, structure=structure)


class RitOmr(FakeOmrStage):
    """The fake OMR, plus a rit. span printed over some bars."""

    def __init__(self, *bars: int) -> None:
        self.bars = bars

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        marks = [BarMark(bar=bar, kind="rit") for bar in self.bars]
        return replace(result, structure=replace(result.structure, bar_marks=marks))


class BumpDownbeats:
    """A clean piece: a downbeat at each given time (seconds) and the given beats, at 50 fps.

    The downbeats at the `unsure` times are only just there (probability 0.4).
    """

    def __init__(
        self,
        times: list[float],
        duration: float,
        beats: list[float] | None = None,
        unsure: list[float] | None = None,
    ) -> None:
        self.times = times
        self.duration = duration
        self.beats = beats if beats is not None else even_beats(times, 4)
        self.unsure = unsure or []

    def listen(self, audio: AudioResult) -> Heard:
        beat_logits, downbeat_logits = logit_curves(self.beats, self.times, self.duration)
        for time in self.unsure:
            downbeat_logits[round(time * 50.0)] = float(np.log(0.4 / 0.6))
        return Heard(beat_logits, downbeat_logits, 50.0, list(self.beats))


class FlatDownbeats:
    """Nothing to hear: no downbeats, no beats."""

    def listen(self, audio: AudioResult) -> Heard:
        silence = np.full(900, -6.0)
        return Heard(silence, silence, 50.0, [])


# --- the fakes ---------------------------------------------------------------------------------


def test_default_stages_are_the_fakes() -> None:
    stages = default_stages()
    assert isinstance(stages.audio, FakeAudioStage)
    assert isinstance(stages.pages, FakePagesStage)
    assert isinstance(stages.omr, FakeOmrStage)
    assert isinstance(stages.downbeats, FakeDownbeatStage)
    assert isinstance(stages.audio, AudioStage)
    assert isinstance(stages.pages, PagesStage)
    assert isinstance(stages.omr, OmrStage)
    assert isinstance(stages.downbeats, DownbeatStage)


def test_the_fake_piece_is_eight_bars_of_four_four_on_one_page() -> None:
    stages = default_stages()
    audio = stages.audio.ingest(PIECE)
    assert audio.duration_sec > 16
    assert audio.peaks["version"] == 2
    assert audio.peaks["length"] == len(audio.peaks["data"]) > 0

    rendered = stages.pages.render({"id": PART, "storage_path": "x.pdf"})
    assert [page.page_index for page in rendered.pages] == [0]
    page = rendered.pages[0]
    assert page.width > 0 and page.height > 0 and page.image_path
    assert rendered.angles_deg == [0.0]

    part = stages.omr.read({"id": PART}, rendered)
    assert [box.bar for box in part.boxes] == list(range(1, 9))
    assert len({box.y for box in part.boxes}) == 2  # two systems of four bars
    assert part.structure.bar_count == 8
    assert part.structure.meters == [MeterChange(numerator=4, denominator=4, from_bar=1)]
    assert part.structure.play_order == [PlayOrderRow(start=1, end=8)]

    heard = stages.downbeats.listen(audio)
    assert heard.fps == 50.0
    assert heard.beat_logits.ndim == 1
    assert len(heard.beat_logits) / heard.fps == pytest.approx(audio.duration_sec, abs=0.05)
    assert len(heard.downbeat_logits) == len(heard.beat_logits)
    assert heard.beats == pytest.approx([0.5 + 0.5 * k for k in range(32)])  # four a bar, 8 bars
    assert heard.downbeat_probability.max() > 0.99 and heard.downbeat_probability.min() < 0.01


# --- process-piece -------------------------------------------------------------------------------


def test_process_piece_on_fakes_ends_done_at_full_progress(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    done = final(world, job)
    assert done.status == JobStatus.DONE
    assert done.progress == 1.0
    assert done.error is None
    assert world.jobs.history[job.id] == [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.DONE]


def test_process_piece_progress_only_goes_up(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    seen = world.jobs.progress
    assert seen == PROCESS_PROGRESS
    assert seen == sorted(seen)
    assert world.jobs.snapshots[0].status == JobStatus.RUNNING  # the first update is "running"


def test_process_piece_writes_eight_unconfirmed_locators_two_seconds_apart(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    locators = world.db.get_locators(PIECE)
    assert [(item.bar, item.pass_index) for item in locators] == [(bar, 0) for bar in range(1, 9)]
    assert not any(item.confirmed for item in locators)
    times = [item.time_sec for item in locators]
    assert times[0] == pytest.approx(0.5, abs=0.05)
    assert np.diff(times) == pytest.approx([2.0] * 7, abs=0.05)


def test_process_piece_on_a_steady_fake_piece_flags_nothing(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    locators = world.db.get_locators(PIECE)
    assert len(locators) == 8
    assert all(item.flags == [] and item.checked is False for item in locators)


def fermata_bar_world() -> tuple[World, Stages]:
    """Eight 4/4 bars, the fourth held 1.6 times as long by a fermata, with four beats each."""
    starts = bar_times([1.0, 1.0, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0], 2.0)
    stages = stages_with(
        omr=FermataOmr(4),
        downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 4)),
    )
    return make_world(), stages


def test_process_piece_stores_flags_and_checked_on_the_locators() -> None:
    world, stages = fermata_bar_world()
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    assert final(world, job).status == JobStatus.DONE
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    held = locators[4]
    assert [(flag.kind, flag.severity, flag.explained_by) for flag in held.flags] == [
        ("stretched", 0, "fermata")
    ]
    assert held.flags[0].factor == pytest.approx(1.6, abs=0.05)
    assert held.checked is True
    for bar in (1, 2, 3, 5, 6, 7, 8):
        assert locators[bar].flags == []
        assert locators[bar].checked is False


def rit_bar_world() -> tuple[World, Stages]:
    """Eight 4/4 bars, the fourth 1.6 times as long, under a rit. printed over bars 4 and 5."""
    starts = bar_times([1.0, 1.0, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0], 2.0)
    stages = stages_with(
        omr=RitOmr(4, 5), downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 4))
    )
    return make_world(), stages


def test_process_piece_stores_the_rit_marks_with_the_timing() -> None:
    world, stages = rit_bar_world()
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    _, _, marks = world.db.get_structure(PIECE)
    assert marks == [BarMark(bar=4, kind="rit"), BarMark(bar=5, kind="rit")]


def test_a_rit_span_explains_a_long_bar_the_way_a_fermata_does() -> None:
    world, stages = rit_bar_world()
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    assert final(world, job).status == JobStatus.DONE
    held = {item.bar: item for item in world.db.get_locators(PIECE)}[4]
    assert [(flag.kind, flag.severity, flag.explained_by) for flag in held.flags] == [
        ("stretched", 0, "rit")
    ]
    assert held.checked is True


def test_process_piece_flags_a_bar_the_score_does_not_explain() -> None:
    world, _ = fermata_bar_world()
    starts = bar_times([1.0, 1.0, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0], 2.0)
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 4)))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    # align_bars knows no tempo change the score does not mention, so it does not stretch bar 4:
    # it splits the long bar (a downbeat at 8.1 s) and the beat counts of both halves are wrong
    held = {item.bar: item for item in world.db.get_locators(PIECE)}[4]
    assert held.flags and all(
        flag.severity > 0 and flag.explained_by is None for flag in held.flags
    )
    assert held.checked is False


def test_process_piece_flags_the_beat_count_from_the_beat_stage() -> None:
    world = make_world()
    starts = bar_times([1.0] * 8, 2.0)
    beats = [beat for beat in even_beats(starts, 4) if beat != starts[2] + 1.0]  # bar 3: 3 beats
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, beats, unsure=[starts[2]]))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert [(flag.kind, flag.expected, flag.found) for flag in locators[3].flags] == [
        ("beat-count", 4, 3)
    ]
    assert sum(1 for item in locators.values() if item.flags) == 1


def test_process_piece_does_not_flag_a_missed_beat_between_two_sure_bar_lines() -> None:
    world = make_world()
    starts = bar_times([1.0] * 8, 2.0)
    beats = [beat for beat in even_beats(starts, 4) if beat != starts[2] + 1.0]
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, beats))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    assert not any(item.flags for item in world.db.get_locators(PIECE))


def test_a_failing_beat_stage_is_a_downbeats_error(world: World) -> None:
    class NoBeats(FakeDownbeatStage):
        def listen(self, audio: AudioResult) -> Heard:
            raise BeatModelError("no beat tracker")

    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(downbeats=NoBeats()))

    failed = final(world, job)
    assert failed.error == "downbeats failed: no beat tracker"
    assert world.db.get_locators(PIECE) == []


def test_process_piece_saves_structure_and_page_layer(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    rows, meters, marks = world.db.get_structure(PIECE)
    assert rows == [PlayOrderRow(start=1, end=8)]
    assert meters == [MeterChange(numerator=4, denominator=4, from_bar=1)]
    assert marks == []

    pages, bars = world.db.get_page_layer(PART)
    assert [page["page_index"] for page in pages] == [0]
    assert set(pages[0]) == {"page_index", "image_path", "width", "height"}
    assert [bar.bar for bar in bars] == list(range(1, 9))
    assert all(isinstance(bar, BarBox) and bar.page_index == 0 for bar in bars)
    # two systems of four bars: the first four share a row, the last four share another
    assert len({bar.y for bar in bars[:4]}) == 1
    assert len({bar.y for bar in bars[4:]}) == 1
    assert bars[4].y > bars[0].y
    assert all(0 <= bar.x and bar.x + bar.w <= pages[0]["width"] for bar in bars)


def test_process_piece_stores_the_waveform_peaks(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    assert PEAKS_PATH in world.storage.paths()
    assert world.storage.content_type(PEAKS_PATH) == "application/json"
    peaks = json.loads(world.storage.download(PEAKS_PATH))
    assert peaks["version"] == 2
    assert len(peaks["data"]) == peaks["length"]


def test_a_processed_piece_stores_the_beats_the_app_draws(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    path = f"{OWNER}/{PIECE}/beats.json"
    assert world.storage.content_type(path) == "application/json"
    stored = json.loads(world.storage.download(path))
    heard = load_analysis(world.storage, OWNER, PIECE)
    assert heard is not None
    assert [beat["t"] for beat in stored] == [round(time, 3) for time in heard.heard.beats]
    # the fake piece has a downbeat on every bar's first beat, and none on the second
    assert stored[0]["downbeat"] > 0.9
    assert stored[1]["downbeat"] < 0.1


def test_process_piece_saves_a_layer_for_every_part_and_times_from_the_first() -> None:
    world = make_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE
    for part in (PART, "file-2"):
        pages, bars = world.db.get_page_layer(part)
        assert len(pages) == 1
        assert len(bars) == 8
    assert len(world.db.get_locators(PIECE)) == 8


def test_reading_several_parts_writes_progress_between_the_parts() -> None:
    """One part can take minutes: the job row must keep changing, or the app takes it for dead."""
    world = make_world()
    for index in (2, 3, 4):
        world.db.add_score_file(
            PIECE,
            f"file-{index}",
            f"{OWNER}/{PIECE}/p{index}.pdf",
            name=f"P{index}",
            position=index,
        )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    seen = progress_of(world, job)
    between = [value for value in seen if 0.35 < value < 0.55]
    assert len(between) == 3  # four parts: after the first, second and third
    assert seen == sorted(seen)
    assert seen.index(between[0]) > seen.index(0.35)
    assert seen.index(0.55) > seen.index(between[-1])


def test_adding_several_parts_writes_progress_between_the_parts() -> None:
    world = processed_world()
    for index in (2, 3):
        world.db.add_score_file(
            PIECE,
            f"file-{index}",
            f"{OWNER}/{PIECE}/p{index}.pdf",
            name=f"P{index}",
            position=index,
        )
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, default_stages())

    seen = progress_of(world, job)
    assert len([value for value in seen if 0.3 < value < 0.8]) == 1  # two parts: after the first
    assert seen == sorted(seen)


def test_adding_a_part_keeps_a_pickup_with_no_number_exactly_as_it_is_stored() -> None:
    """The flag is the app's label for a bar: a part added later keeps it."""
    world = processed_world()
    rows, meters, marks = world.db.get_structure(PIECE)
    flagged = [ShortBar(bar=0, units=1), ShortBar(bar=5, units=2, unnumbered=True)]
    world.db.save_structure(PIECE, rows, meters, marks, flagged)
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/p2.pdf", name="P2", position=2)
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert world.db.get_short_bars(PIECE) == flagged


class ShortSecondPart(FakeOmrStage):
    """The fake OMR, except that the second part has only six bars."""

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        if score_file["id"] != "file-2":
            return result
        structure = replace(
            result.structure, bar_count=6, play_order=[PlayOrderRow(start=1, end=6)]
        )
        return replace(result, boxes=result.boxes[:6], structure=structure)


def test_a_part_with_another_bar_count_is_a_warning_not_a_failed_job() -> None:
    world = make_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=ShortSecondPart()))

    done = final(world, job)
    assert done.status == JobStatus.DONE
    assert done.warnings == ["Cello has 6 bars but the piece has 8; check its bar lines."]
    assert len(world.db.get_page_layer(PART)[1]) == 8
    assert len(world.db.get_page_layer("file-2")[1]) == 6  # saved as read; the editor flags it
    assert len(world.db.get_locators(PIECE)) == 8  # the first part's bars set the timing


def test_when_most_parts_disagree_with_the_first_they_set_the_timing() -> None:
    class ShortFirstPart(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            result = super().read(score_file, rendered)
            if score_file["id"] != PART:
                return result
            structure = replace(
                result.structure, bar_count=6, play_order=[PlayOrderRow(start=1, end=6)]
            )
            return replace(result, boxes=result.boxes[:6], structure=structure)

    world = make_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    world.db.add_score_file(PIECE, "file-3", f"{OWNER}/{PIECE}/oboe.pdf", name="Oboe", position=2)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=ShortFirstPart()))

    done = final(world, job)
    assert done.status == JobStatus.DONE
    assert len(world.db.get_locators(PIECE)) == 8
    assert any("has 6 bars but the piece has 8" in warning for warning in done.warnings)


def test_a_part_that_warns_puts_its_words_and_cost_on_the_job() -> None:
    world = make_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)

    class Warns(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            return replace(
                super().read(score_file, rendered), warnings=["Check the repeats."], cost_usd=0.02
            )

    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Warns()))

    done = final(world, job)
    assert done.warnings == ["Violin: Check the repeats.", "Cello: Check the repeats."]
    assert done.cost_usd == pytest.approx(0.04)


def test_a_single_part_job_has_no_part_name_in_front_of_its_warnings() -> None:
    world = make_world()

    class Warns(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            return replace(super().read(score_file, rendered), warnings=["Check the repeats."])

    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Warns()))

    assert final(world, job).warnings == ["Check the repeats."]


def test_a_part_without_a_name_gets_the_one_the_reader_found() -> None:
    world = make_world(with_score_file=False)
    world.db.add_score_file(PIECE, PART, f"{OWNER}/{PIECE}/score.pdf", name="")

    class Names(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            return replace(super().read(score_file, rendered), part_name="Violin II")

    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Names()))

    assert [row["name"] for row in world.db.list_score_files(PIECE)] == ["Violin II"]


def test_a_part_that_has_a_name_keeps_it() -> None:
    world = make_world()

    class Names(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            return replace(super().read(score_file, rendered), part_name="Violin II")

    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Names()))

    assert [row["name"] for row in world.db.list_score_files(PIECE)] == ["Violin"]


def test_a_name_made_from_the_file_is_replaced_by_the_one_the_reader_found() -> None:
    world = make_world(with_score_file=False)
    world.db.add_score_file(
        PIECE, PART, f"{OWNER}/{PIECE}/score.pdf", name="clar1 final", name_source="file"
    )

    class Names(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            return replace(super().read(score_file, rendered), part_name="Clarinet in B flat")

    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Names()))

    row = world.db.list_score_files(PIECE)[0]
    assert (row["name"], row["name_source"]) == ("Clarinet in B flat", "read")


def test_a_name_the_user_set_is_never_replaced_by_a_job_even_after_it_was_renamed() -> None:
    world = make_world(with_score_file=False)
    world.db.add_score_file(
        PIECE, PART, f"{OWNER}/{PIECE}/score.pdf", name="Clarinet 1", name_source="read"
    )
    world.db.set_part_name(PART, "My clarinet", source="user")

    class Names(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            return replace(super().read(score_file, rendered), part_name="Clarinet in B flat")

    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(omr=Names()))

    row = world.db.list_score_files(PIECE)[0]
    assert (row["name"], row["name_source"]) == ("My clarinet", "user")


def test_the_scratch_files_of_the_job_are_cleared_when_it_ends_either_way(world: World) -> None:
    cleared: list[str] = []
    clean_up = lambda: cleared.append("cleared")  # noqa: E731
    done = start(world, JobKind.PROCESS_PIECE)
    process_piece(done, world.services, stages_with(clean_up=clean_up))
    failed = start(world, JobKind.PROCESS_PIECE)
    broken = stages_with(clean_up=clean_up, omr=Boom(RuntimeError("x")))
    process_piece(failed, world.services, broken)

    assert cleared == ["cleared", "cleared"]


def test_a_repeat_sign_in_the_score_shapes_the_play_order(world: World) -> None:
    class RepeatingOmr(FakeOmrStage):
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            result = super().read(score_file, rendered)
            marks = [
                StructureMark(kind=MarkKind.REPEAT_START, bar=1),
                StructureMark(kind=MarkKind.REPEAT_END, bar=4),
            ]
            order = propose_play_order(marks, 8).rows
            return replace(
                result, structure=replace(result.structure, marks=marks, play_order=order)
            )

    stages = stages_with(
        omr=RepeatingOmr(),
        downbeats=BumpDownbeats(bar_times([1.0] * 12, 2.0), 30.0),
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    assert final(world, job).status == JobStatus.DONE
    rows, _, _ = world.db.get_structure(PIECE)
    assert rows == [PlayOrderRow(start=1, end=4), PlayOrderRow(start=1, end=8)]
    locators = world.db.get_locators(PIECE)
    assert len(locators) == 12  # bars 1-4 twice, then 5-8
    assert [(item.bar, item.pass_index) for item in locators if item.bar <= 4] == [
        (bar, pass_index) for bar in range(1, 5) for pass_index in (0, 1)
    ]


# --- errors --------------------------------------------------------------------------------------

# stage under test -> (name in the message, progress the job had reached before it)
FAILURES = {
    "audio": ("audio", 0),
    "pages": ("pages", 0.2),
    "omr": ("omr", 0.35),
    "downbeats": ("downbeats", 0.65),
}


@pytest.mark.parametrize("stage", list(FAILURES))
def test_a_failing_stage_sets_error_and_leaves_progress_where_it_was(
    world: World, stage: str
) -> None:
    name, reached = FAILURES[stage]
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(**{stage: Boom(ValueError("it broke"))}))

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error == f"{name} failed: it broke"
    assert failed.progress == reached
    assert world.jobs.history[job.id] == [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.ERROR]
    assert world.jobs.progress == sorted(world.jobs.progress)


def test_nothing_is_written_when_omr_fails(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Boom(ValueError("no staff lines"))))

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error is not None and failed.error.startswith("omr failed")
    assert world.db.get_locators(PIECE) == []
    assert world.db.get_structure(PIECE) == ([], [], [])
    assert world.db.get_page_layer(PART) == ([], [])
    assert world.storage.paths() == []
    # the last thing that happened to the job was the error; no update followed it
    assert world.jobs.snapshots[-1].status == JobStatus.ERROR
    assert [job.status for job in world.jobs.snapshots].count(JobStatus.ERROR) == 1


def test_an_alignment_that_cannot_be_made_is_an_align_error(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(downbeats=FlatDownbeats()))

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error is not None and failed.error.startswith("align failed: ")
    assert "no valid alignment" in failed.error
    assert failed.progress == 0.8
    assert world.db.get_locators(PIECE) == []
    assert world.storage.paths() == []


def test_a_piece_without_score_files_is_a_pages_error() -> None:
    world = make_world(with_score_file=False)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error is not None
    assert failed.error.startswith("pages failed:")
    assert "score file" in failed.error


def test_a_long_message_is_trimmed_to_one_short_line(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)
    noisy = ValueError("first line\n" + "x" * 500 + '\n  File "a.py", line 1, in <module>')

    process_piece(job, world.services, stages_with(audio=Boom(noisy)))

    error = final(world, job).error
    assert error is not None
    assert error.startswith("audio failed: first line xxx")
    assert "\n" not in error
    assert len(error) <= len("audio failed: ") + 200


def test_an_exception_without_a_message_is_named(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(pages=Boom(ValueError())))

    assert final(world, job).error == "pages failed: ValueError"


def test_the_orchestrator_does_not_raise_when_a_stage_does(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(audio=Boom(RuntimeError("x"))))
    realign_job = start(world, JobKind.REALIGN)
    realign_piece(realign_job, world.services, stages_with(audio=Boom(RuntimeError("x"))))
    assert final(world, job).status == JobStatus.ERROR
    assert final(world, realign_job).status == JobStatus.ERROR


def test_a_sentence_the_app_wrote_reaches_the_job_and_an_unknown_error_does_not(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(audio=Boom(AudioIngestError("Too long."))))
    assert final(world, job).error == "audio failed: Too long."

    job = world.jobs.create(PIECE, JobKind.REALIGN)  # the first job has ended
    secret = RuntimeError("https://x.supabase.co/private?token=abc")
    process_piece(job, world.services, stages_with(audio=Boom(secret)))
    error = final(world, job).error
    assert error == "audio failed: something went wrong on the server."
    assert "private" in caplog.text  # the detail is in the log, without the token
    assert "abc" not in caplog.text


@pytest.mark.parametrize(
    "error",
    [
        KeyError("row"),
        OSError("/tmp/secret/path"),
        json.JSONDecodeError("bad", '{"email": "a@b.com"}', 3),
        UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"),
    ],
)
def test_other_exception_types_never_put_their_text_on_the_job(
    world: World, error: Exception
) -> None:
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(omr=Boom(error)))
    assert final(world, job).error == "omr failed: something went wrong on the server."


def test_a_part_that_fails_with_an_unknown_error_is_noted_without_its_text(world: World) -> None:
    class TwoParts:
        def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
            if score_file["id"] == "file-2":
                raise RuntimeError("row {'email': 'a@b.com'}")
            return FakeOmrStage().read(score_file, rendered)

    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/two.pdf", name="Cello")
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(omr=TwoParts()))
    done = final(world, job)
    assert done.status == JobStatus.DONE
    assert [part.error for part in done.failed_parts] == ["something went wrong on the server."]
    assert "a@b.com" not in " ".join(done.warnings)


class FlakyEnd(SpyJobStore):
    """A job store whose first `blips` writes of an end status (done or error) fail with a 503."""

    def __init__(self, blips: int) -> None:
        super().__init__()
        self.blips = blips

    def update(self, job_id: str, **changes: object) -> Job:  # type: ignore[override]
        if changes.get("status") in (JobStatus.DONE, JobStatus.ERROR) and self.blips > 0:
            self.blips -= 1
            raise RestError(503, None)
        return super().update(job_id, **changes)  # type: ignore[arg-type]


class CostlyOmr(FakeOmrStage):
    """The fake OMR, plus a warning and what the vision model cost."""

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        return replace(result, cost_usd=0.5, warnings=["look at bar 3"])


def test_one_503_on_the_done_write_does_not_turn_a_finished_job_into_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.job_end.pause", lambda seconds: None)
    world = make_world()
    flaky = FlakyEnd(blips=1)
    services = Services(db=world.db, storage=world.storage, jobs=flaky)
    job = flaky.create(PIECE, JobKind.PROCESS_PIECE)

    process_piece(job, services, stages_with(omr=CostlyOmr()))

    done = flaky.get(job.id)
    assert done is not None
    assert done.status == JobStatus.DONE, done.error
    assert done.cost_usd == 0.5
    assert done.warnings == ["look at bar 3"]
    assert done.progress == 1.0


def test_one_503_on_the_error_write_keeps_the_real_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.job_end.pause", lambda seconds: None)
    world = make_world()
    flaky = FlakyEnd(blips=2)
    services = Services(db=world.db, storage=world.storage, jobs=flaky)
    job = flaky.create(PIECE, JobKind.PROCESS_PIECE)

    process_piece(job, services, stages_with(omr=Boom(OmrError("no staff lines"))))

    failed = flaky.get(job.id)
    assert failed is not None
    assert failed.error == "omr failed: no staff lines"


class RefusingEnd(SpyJobStore):
    """A job store that refuses (400, as Postgres does for a \\u0000 in a text) any end write that
    carries more than a status and a sentence; the minimal generic end is accepted."""

    def __init__(self) -> None:
        super().__init__()
        self.refused = 0

    def update(self, job_id: str, **changes: object) -> Job:  # type: ignore[override]
        rich = any(changes.get(name) for name in ("warnings", "failed_parts", "cost_usd"))
        carries_text = changes.get("error") not in (None, GENERIC_FAILURE)
        if changes.get("status") in (JobStatus.DONE, JobStatus.ERROR) and (rich or carries_text):
            self.refused += 1
            raise RestError(400, "22P05")
        return super().update(job_id, **changes)  # type: ignore[arg-type]


def test_a_refused_done_write_still_ends_the_job_with_the_generic_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.job_end.pause", lambda seconds: None)
    world = make_world()
    refusing = RefusingEnd()
    services = Services(db=world.db, storage=world.storage, jobs=refusing)
    job = refusing.create(PIECE, JobKind.PROCESS_PIECE)

    process_piece(job, services, stages_with(omr=CostlyOmr()))

    ended = refusing.get(job.id)
    assert ended is not None
    assert ended.status == JobStatus.ERROR  # not left running
    assert ended.error == GENERIC_FAILURE
    assert refusing.refused == 1  # a refusal is not retried


def test_a_refused_error_write_still_ends_the_job_with_the_generic_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.job_end.pause", lambda seconds: None)
    world = make_world()
    refusing = RefusingEnd()
    services = Services(db=world.db, storage=world.storage, jobs=refusing)
    job = refusing.create(PIECE, JobKind.PROCESS_PIECE)

    process_piece(job, services, stages_with(omr=Boom(OmrError("no staff lines"))))

    ended = refusing.get(job.id)
    assert ended is not None
    assert ended.status == JobStatus.ERROR
    assert ended.error == GENERIC_FAILURE


class FlakyProgress(SpyJobStore):
    """A job store whose progress writes fail, as when Supabase times out; status writes work."""

    def update(self, job_id: str, **changes: object) -> Job:  # type: ignore[override]
        if changes.get("status") is None and changes.get("progress") is not None:
            raise RuntimeError("https://x.supabase.co/private timed out")
        return super().update(job_id, **changes)  # type: ignore[arg-type]


def test_a_progress_write_that_fails_does_not_discard_a_finished_job(
    caplog: pytest.LogCaptureFixture,
) -> None:
    world = make_world()
    flaky = FlakyProgress()
    services = Services(db=world.db, storage=world.storage, jobs=flaky)
    job = flaky.create(PIECE, JobKind.PROCESS_PIECE)

    process_piece(job, services, default_stages())

    done = flaky.get(job.id)
    assert done is not None
    assert done.status == JobStatus.DONE, done.error
    assert len(world.db.get_locators(PIECE)) == 8
    assert "progress" in caplog.text
    assert "private" not in caplog.text  # logged without the error's detail


def test_a_progress_write_that_fails_does_not_fail_a_stage() -> None:
    world = make_world()
    flaky = FlakyProgress()
    services = Services(db=world.db, storage=world.storage, jobs=flaky)
    job = flaky.create(PIECE, JobKind.PROCESS_PIECE)

    process_piece(job, services, stages_with(omr=Boom(OmrError("no staff lines"))))

    failed = flaky.get(job.id)
    assert failed is not None
    assert failed.error == "omr failed: no staff lines"  # the real failure, not a progress one


# --- realign -------------------------------------------------------------------------------------

EIGHT_BARS = [PlayOrderRow(start=1, end=8)]
FOUR_FOUR = [MeterChange(numerator=4, denominator=4, from_bar=1)]


def seed_map(world: World, locators: list[Locator]) -> None:
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, [])
    world.db.add_locators(PIECE, locators)


def test_realign_keeps_confirmed_locators_exactly_and_refits_the_rest(world: World) -> None:
    seed_map(
        world,
        [
            loc(1, 0.52, confirmed=True),
            *(loc(bar, 0.1 * bar) for bar in (2, 3, 4)),  # junk times, unconfirmed
            loc(5, 8.55, confirmed=True),
            *(loc(bar, 0.1 * bar) for bar in (6, 7, 8)),
        ],
    )
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    done = final(world, job)
    assert done.status == JobStatus.DONE
    assert done.progress == 1.0
    assert world.jobs.history[job.id] == [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.DONE]
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert sorted(locators) == list(range(1, 9))
    assert locators[1] == loc(1, 0.52, confirmed=True)
    assert locators[5] == loc(5, 8.55, confirmed=True)
    for bar in (2, 3, 4, 6, 7, 8):
        assert not locators[bar].confirmed
        assert locators[bar].time_sec == pytest.approx(0.5 + 2.0 * (bar - 1), abs=0.05)


def test_realign_keeps_a_confirmed_locators_flags_and_recomputes_the_others(world: World) -> None:
    old = ReviewFlag(
        kind="stretched", severity=0, expected=2.0, found=3.2, factor=1.6, explained_by="fermata"
    )
    stale = ReviewFlag(kind="crowded", severity=2, expected=2.0, found=0.5, factor=0.25)
    anchor = Locator(bar=1, pass_index=0, time_sec=0.52, confirmed=True, flags=[old], checked=True)
    seed_map(
        world,
        [
            anchor,
            *(
                Locator(bar=bar, pass_index=0, time_sec=0.1 * bar, flags=[stale], checked=True)
                for bar in range(2, 9)
            ),
        ],
    )
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert locators[1] == anchor
    assert locators[1].flags == [old] and locators[1].checked is True
    for bar in range(2, 9):
        assert locators[bar].flags == [] and locators[bar].checked is False


def test_realign_flags_the_refit_locators_from_the_beats_and_the_saved_marks(
    world: World,
) -> None:
    starts = bar_times([1.0, 1.0, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0], 2.0)
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, [BarMark(bar=4, kind="fermata")])
    world.db.add_locators(
        PIECE,
        [loc(1, 0.5, confirmed=True), *(loc(bar, float(bar)) for bar in range(2, 9))],
    )
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 4)))
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, stages)

    assert final(world, job).status == JobStatus.DONE
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert locators[1].flags == [] and locators[1].checked is False
    assert [(flag.kind, flag.severity, flag.explained_by) for flag in locators[4].flags] == [
        ("stretched", 0, "fermata")
    ]
    assert locators[4].checked is True
    assert all(locators[bar].flags == [] for bar in (2, 3, 5, 6, 7, 8))


def test_realign_takes_the_rit_slots_from_the_stored_marks(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[set[int]] = []
    real_realign = orchestrator.realign_bars

    def spy(*args: object, **kwargs: object) -> list[float]:
        seen.append(set(args[6]))  # type: ignore[call-overload]
        return real_realign(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(orchestrator, "realign_bars", spy)
    marks = [BarMark(bar=4, kind="rit"), BarMark(bar=5, kind="rit")]
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, marks)
    world.db.add_locators(PIECE, [loc(bar, float(bar)) for bar in range(1, 9)])
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE
    assert seen == [{3, 4}]  # the slots of bars 4 and 5


def test_process_piece_keeps_what_it_heard_for_the_realign_to_use(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    stored = load_analysis(world.storage, OWNER, PIECE)
    expected = FakeDownbeatStage().listen(FakeAudioStage().ingest(PIECE))
    assert stored is not None
    assert stored.duration_sec == FakeAudioStage().ingest(PIECE).duration_sec
    assert stored.heard.fps == expected.fps and stored.heard.beats == expected.beats
    assert np.array_equal(stored.heard.beat_logits, expected.beat_logits)
    assert np.array_equal(stored.heard.downbeat_logits, expected.downbeat_logits)


def test_a_failed_process_piece_keeps_no_analysis(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=Boom(RuntimeError("x"))))

    assert load_analysis(world.storage, OWNER, PIECE) is None


def processed_world() -> World:
    """A piece processed on the fakes, then given junk unconfirmed locators and one anchor."""
    world = make_world()
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, default_stages())
    world.db.replace_unconfirmed_locators(PIECE, [])
    world.db.add_locators(
        PIECE, [loc(1, 0.52, confirmed=True), *(loc(bar, 0.1 * bar) for bar in range(2, 9))]
    )
    return world


def progress_of(world: World, job: Job) -> list[float]:
    return [snapshot.progress for snapshot in world.jobs.snapshots if snapshot.id == job.id]


def test_realign_uses_the_stored_analysis_and_never_listens_or_downloads_again() -> None:
    world = processed_world()
    deaf = stages_with(audio=Boom(RuntimeError("ingest")), downbeats=Boom(RuntimeError("listen")))
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, deaf)

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert locators[1].time_sec == 0.52 and locators[1].confirmed
    for bar in range(2, 9):
        assert locators[bar].time_sec == pytest.approx(0.5 + 2.0 * (bar - 1), abs=0.05)


def test_realign_of_a_piece_whose_recording_was_an_old_youtube_link_still_works() -> None:
    """Links are no longer fetched (Decision 2026-11-06); a stored "youtube" row still realigns."""
    world = processed_world()
    world.db.set_audio_source(PIECE, "youtube", "https://youtu.be/abc")
    deaf = stages_with(audio=Boom(RuntimeError("ingest")), downbeats=Boom(RuntimeError("listen")))
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, deaf)

    assert final(world, job).status == JobStatus.DONE, final(world, job).error


def test_realign_with_the_stored_analysis_gives_what_a_fresh_listen_gives() -> None:
    cached, fresh = processed_world(), processed_world()
    fresh.storage._files.pop(analysis_path(OWNER, PIECE))

    realign_piece(start(cached, JobKind.REALIGN), cached.services, default_stages())
    realign_piece(start(fresh, JobKind.REALIGN), fresh.services, default_stages())

    assert cached.db.get_locators(PIECE) == fresh.db.get_locators(PIECE)


def test_realign_with_the_stored_analysis_skips_the_audio_step_of_the_progress() -> None:
    world = processed_world()
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    assert progress_of(world, job) == [0, 0.1, 0.6, 0.9, 1.0]


def test_realign_listens_again_when_the_analysis_is_missing_or_unreadable() -> None:
    for damage in ("missing", "junk"):
        world = processed_world()
        path = analysis_path(OWNER, PIECE)
        if damage == "missing":
            world.storage._files.pop(path)
        else:
            world.storage.upload(path, b"not an npz", "application/octet-stream")
        job = start(world, JobKind.REALIGN)

        realign_piece(job, world.services, default_stages())

        assert final(world, job).status == JobStatus.DONE, damage
        assert progress_of(world, job) == REALIGN_PROGRESS, damage


def test_realign_progress_only_goes_up(world: World) -> None:
    seed_map(world, [loc(bar, float(bar)) for bar in range(1, 9)])
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    assert world.jobs.progress == REALIGN_PROGRESS


def test_realign_with_everything_confirmed_changes_nothing(world: World) -> None:
    confirmed = [loc(bar, 0.5 + 2.0 * (bar - 1) + 0.01, confirmed=True) for bar in range(1, 9)]
    seed_map(world, confirmed)
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE
    assert world.db.get_locators(PIECE) == confirmed


def test_realign_follows_the_play_order_through_a_repeat(world: World) -> None:
    rows = [PlayOrderRow(start=1, end=4), PlayOrderRow(start=1, end=8)]
    world.db.save_structure(PIECE, rows, FOUR_FOUR, [])
    anchor = loc(1, 8.52, pass_index=1, confirmed=True)  # slot 4 (bar 1, second pass) is due at 8.5
    world.db.add_locators(PIECE, [loc(bar, 0.0, pass_index=0) for bar in range(1, 5)] + [anchor])
    stages = stages_with(downbeats=BumpDownbeats(bar_times([1.0] * 12, 2.0), 30.0))
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, stages)

    assert final(world, job).status == JobStatus.DONE
    locators = {(item.bar, item.pass_index): item for item in world.db.get_locators(PIECE)}
    assert len(locators) == 12
    assert locators[(1, 1)] == anchor
    assert locators[(1, 1)].time_sec == 8.52  # the anchor is kept as it is, not moved to 8.5
    # unconfirmed slots refit around the anchor, in play order
    assert locators[(1, 0)].time_sec == pytest.approx(0.5, abs=0.05)
    assert locators[(4, 0)].time_sec == pytest.approx(6.5, abs=0.05)
    assert locators[(8, 0)].time_sec == pytest.approx(0.5 + 2.0 * 11, abs=0.05)
    assert not any(item.confirmed for key, item in locators.items() if key != (1, 1))


def test_realign_on_a_piece_with_no_structure_is_an_error(world: World) -> None:
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error is not None and failed.error.startswith("load failed:")
    assert "play order" in failed.error
    assert "process" in failed.error
    assert world.jobs.history[job.id] == [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.ERROR]
    assert world.db.get_locators(PIECE) == []


def test_realign_on_a_piece_with_no_locators_is_an_error(world: World) -> None:
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, [])
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error is not None and failed.error.startswith("load failed:")
    assert "locators" in failed.error
    assert world.db.get_locators(PIECE) == []


def test_realign_with_anchors_out_of_order_is_an_align_error(world: World) -> None:
    seed_map(world, [loc(1, 5.0, confirmed=True), loc(2, 3.0, confirmed=True)])
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, default_stages())

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error is not None and failed.error.startswith("align failed:")
    assert "out of time order" in failed.error
    assert failed.progress == 0.6
    assert [item.time_sec for item in world.db.get_locators(PIECE)] == [5.0, 3.0]


def test_a_failing_downbeat_stage_fails_realign_at_downbeats(world: World) -> None:
    seed_map(world, [loc(bar, float(bar)) for bar in range(1, 9)])
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, stages_with(downbeats=Boom(BeatModelError("no model"))))

    failed = final(world, job)
    assert failed.error == "downbeats failed: no model"
    assert failed.progress == 0.3
    assert [item.time_sec for item in world.db.get_locators(PIECE)] == [
        float(b) for b in range(1, 9)
    ]


# --- run_job and the routes ----------------------------------------------------------------------


def test_run_job_dispatches_on_the_job_kind(world: World) -> None:
    process = start(world, JobKind.PROCESS_PIECE)
    run_job(process, world.services)
    assert len(world.db.get_locators(PIECE)) == 8

    realign = start(world, JobKind.REALIGN)
    finished = run_job(realign, world.services)
    assert finished.id == realign.id
    assert finished.status == JobStatus.DONE


def test_run_job_uses_the_stages_it_is_given(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    finished = run_job(job, world.services, stages_with(omr=Boom(OmrError("custom"))))

    assert finished.status == JobStatus.ERROR
    assert finished.error == "omr failed: custom"


@pytest.fixture
def client(world: World) -> TestClient:
    world.db.add_admin(OWNER)  # the fakes start everyone on Trial; the admin is never limited
    app = create_app(Settings())
    app.dependency_overrides[get_services] = lambda: world.services
    app.dependency_overrides[current_user] = lambda: AuthUser(id=OWNER)
    app.dependency_overrides[get_job_runner] = InlineRunner
    return TestClient(app)


def test_process_piece_route_answers_queued_and_the_job_ends_done_through_the_orchestrator(
    world: World, client: TestClient
) -> None:
    response = client.post("/jobs/process-piece", json={"piece_id": PIECE})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert world.jobs.progress == PROCESS_PROGRESS
    assert len(world.db.get_locators(PIECE)) == 8
    stored = world.jobs.get(body["job_id"])
    assert stored is not None and stored.status == JobStatus.DONE


def test_process_piece_route_answers_queued_and_the_job_ends_in_error_when_a_stage_fails(
    world: World, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    broken = stages_with(omr=Boom(OmrError("audiveris crashed")))
    monkeypatch.setattr("app.jobs.default_stages", lambda services=None: broken)

    response = client.post("/jobs/process-piece", json={"piece_id": PIECE})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"job_id", "status"}
    assert body["status"] == "queued"
    stored = world.jobs.get(body["job_id"])
    assert stored is not None
    assert stored.status == JobStatus.ERROR
    assert stored.error == "omr failed: audiveris crashed"
    assert world.db.get_locators(PIECE) == []


def test_realign_route_answers_queued_and_the_job_ends_in_error_when_there_is_nothing_to_realign(
    world: World, client: TestClient
) -> None:
    response = client.post("/jobs/realign", json={"piece_id": PIECE})

    assert response.status_code == 200
    assert response.json()["status"] == "queued"
    stored = world.jobs.get(response.json()["job_id"])
    assert stored is not None and stored.error is not None
    assert stored.status == JobStatus.ERROR
    assert stored.error.startswith("load failed:")


# --- a pickup -----------------------------------------------------------------------------------


class PickupOmr:
    """The fake piece read as a pickup (bar 0) and seven bars; `sources` readings said so."""

    def __init__(self, sources: int = 2) -> None:
        self.sources = sources

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        part = FakeOmrStage().read(score_file, rendered)
        moved = renumbered(part.structure, -1)
        moved = replace(moved, short_bars={0: 1, **moved.short_bars}, pickup_sources=self.sources)
        return replace(part, structure=moved, boxes=renumbered_boxes(part.boxes, -1))


class PickupDownbeats:
    """A beat of the pickup at 0.5 s, then seven bars of four beats from 1.0 s, 2 s apart."""

    def listen(self, audio: AudioResult) -> Heard:
        beats = [0.5] + [1.0 + 0.5 * i for i in range(28)]
        downbeats = [1.0 + 2.0 * bar for bar in range(7)]
        frames = round(audio.duration_sec * 50.0)
        beat_logits, downbeat_logits = logit_curves(beats, downbeats, audio.duration_sec, 50.0)
        assert len(beat_logits) == frames
        return Heard(beat_logits, downbeat_logits, 50.0, beats)


def pickup_stages(sources: int = 2) -> Stages:
    return replace(default_stages(), omr=PickupOmr(sources), downbeats=PickupDownbeats())


def test_a_pickup_piece_gets_a_locator_for_bar_0_and_keeps_its_short_bar(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, pickup_stages())

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    rows, _, _ = world.db.get_structure(PIECE)
    assert [(row.start, row.end) for row in rows] == [(0, 7)]
    assert [(s.bar, s.units) for s in world.db.get_short_bars(PIECE)] == [(0, 1)]
    times = {locator.bar: locator.time_sec for locator in world.db.get_locators(PIECE)}
    assert sorted(times) == list(range(0, 8))
    assert times[0] == pytest.approx(0.5, abs=0.03)
    assert times[1] == pytest.approx(1.0, abs=0.03)
    assert times[7] == pytest.approx(13.0, abs=0.03)
    boxes = world.db.get_page_layer(PART)[1]
    assert [box.bar for box in boxes] == list(range(0, 8))


def test_a_pickup_two_readings_agree_on_with_a_beat_under_it_has_no_flag(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, pickup_stages(sources=2))

    bar_0 = next(item for item in world.db.get_locators(PIECE) if item.bar == 0)
    assert bar_0.flags == []


def test_a_pickup_only_one_reading_found_is_flagged_for_the_review_queue(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, pickup_stages(sources=1))

    bar_0 = next(item for item in world.db.get_locators(PIECE) if item.bar == 0)
    assert [(flag.kind, flag.found) for flag in bar_0.flags] == [("pickup", 1)]
    assert not bar_0.checked


def test_a_realign_keeps_the_pickup_and_its_doubt(world: World) -> None:
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, pickup_stages(sources=1))
    job = start(world, JobKind.REALIGN)

    realign_piece(job, world.services, pickup_stages(sources=1))

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    locators = {item.bar: item for item in world.db.get_locators(PIECE)}
    assert locators[0].time_sec == pytest.approx(0.5, abs=0.03)
    assert locators[3].time_sec == pytest.approx(5.0, abs=0.03)
    assert [flag.kind for flag in locators[0].flags] == ["pickup"]


def test_a_part_added_later_follows_the_pieces_pickup(world: World) -> None:
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, pickup_stages())
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/second.pdf", name="Viola")
    job = start(world, JobKind.ADD_PARTS)

    # the second part's own read found no pickup: eight bars, numbered 1 to 8
    add_parts(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    boxes = world.db.get_page_layer("file-2")[1]
    assert [box.bar for box in boxes] == list(range(0, 8))


class RestsOmr(FakeOmrStage):
    """The fake OMR, except that each part rests on the bars it is given by its id."""

    def __init__(self, rests: dict[str, list[int]]) -> None:
        self.rests = rests

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        rests = self.rests.get(score_file["id"], [])
        return replace(result, structure=replace(result.structure, rests=rests))


def test_each_part_keeps_its_own_rests_and_the_timing_gets_none() -> None:
    world = make_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    omr = RestsOmr({PART: [2, 3], "file-2": [6]})
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=omr))

    assert final(world, job).status == JobStatus.DONE
    assert world.db.get_rests(PART) == [2, 3]
    assert world.db.get_rests("file-2") == [6]
    assert world.db.get_structure(PIECE)[2] == []


def test_a_part_added_later_brings_its_own_rests_and_leaves_the_others() -> None:
    world = make_world()
    process_piece(
        start(world, JobKind.PROCESS_PIECE),
        world.services,
        stages_with(omr=RestsOmr({PART: [4]})),
    )
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, stages_with(omr=RestsOmr({"file-2": [1, 2]})))

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert world.db.get_rests("file-2") == [1, 2]
    assert world.db.get_rests(PART) == [4]


# --- a part that cannot be read ----------------------------------------------------------------


class FailsFor(FakeOmrStage):
    """The fake OMR, except that the parts named by id cannot be read."""

    def __init__(self, *ids: str) -> None:
        self.ids = ids

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        if score_file["id"] in self.ids:
            raise ValueError("The score reader failed: page 1 has no five-line staves.")
        return super().read(score_file, rendered)


def add_two_parts(world: World) -> None:
    db = world.db
    db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/horn.pdf", name="Horn", position=1)
    db.add_score_file(PIECE, "file-3", f"{OWNER}/{PIECE}/drums.pdf", name="Drums", position=2)


def test_a_part_that_cannot_be_read_is_skipped_and_the_others_are_added(world: World) -> None:
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, default_stages())
    add_two_parts(world)
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, stages_with(omr=FailsFor("file-3")))

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert len(world.db.get_page_layer("file-2")[1]) == 8
    assert world.db.get_page_layer("file-3") == ([], [])  # still waiting: a retry reads it again
    assert [row["id"] for row in world.db.list_unrendered_score_files(PIECE)] == ["file-3"]
    assert [(p.id, p.name, p.error) for p in done.failed_parts] == [
        ("file-3", "Drums", "The score reader failed: page 1 has no five-line staves.")
    ]
    assert done.warnings == [
        "Drums could not be read: The score reader failed: page 1 has no five-line staves."
    ]


def test_when_no_new_part_can_be_read_the_job_fails_and_names_them(world: World) -> None:
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, default_stages())
    add_two_parts(world)
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, stages_with(omr=FailsFor("file-2", "file-3")))

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error == "omr failed: The score reader failed: page 1 has no five-line staves."
    assert [p.id for p in failed.failed_parts] == ["file-2", "file-3"]


def test_a_new_piece_takes_its_timing_from_the_first_part_that_was_read() -> None:
    world = make_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/cello.pdf", name="Cello", position=1)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=FailsFor(PART)))

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert [p.id for p in done.failed_parts] == [PART]
    assert world.db.get_page_layer(PART) == ([], [])
    assert len(world.db.get_page_layer("file-2")[1]) == 8
    assert len(world.db.get_locators(PIECE)) == 8


def test_a_finished_job_with_every_part_read_has_no_failed_parts(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    assert final(world, job).failed_parts == []


class ExtraPickupOmr(FakeOmrStage):
    """The fake piece's eight bars, read with a pickup (bar 0) in front of them as well."""

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        part = super().read(score_file, rendered)
        first = part.boxes[0]
        pickup = first.model_copy(update={"bar": 0, "w": first.w / 4})
        structure = replace(part.structure, short_bars={0: 1, **part.structure.short_bars})
        return replace(part, structure=structure, boxes=[pickup, *part.boxes])


def test_a_part_added_later_drops_a_pickup_the_piece_does_not_have(world: World) -> None:
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, default_stages())
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/drums.pdf", name="Drums")
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, stages_with(omr=ExtraPickupOmr()))

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert [box.bar for box in world.db.get_page_layer("file-2")[1]] == list(range(1, 9))
    # one part in the job: its name is not put in front, as with any warning of a single part
    assert done.warnings == [
        "a pickup bar was read that the piece does not have; its box was left out."
    ]


class RepeatOmr(FakeOmrStage):
    """The fake OMR, plus the printed `marks`, and the play order they give."""

    def __init__(self, *marks: StructureMark) -> None:
        self.marks = list(marks)

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        structure = replace(
            result.structure,
            marks=self.marks,
            play_order=propose_play_order(self.marks, result.structure.bar_count).rows,
        )
        return replace(result, structure=structure)


REPEAT_AT_THE_END = StructureMark(kind=MarkKind.REPEAT_END, bar=8)
NO_FIT = "no valid alignment: no chain of slots fits"


@pytest.fixture
def only_eight_slots_fit(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """The alignment finds no chain for more than eight slots; returns the slot count of each try.

    Even synthetic beats squeeze into nearly any order, so the failure a real recording gives
    (a Gondellied of 92 beats against 78 slots of two) is stated here, not reproduced.
    """
    tries: list[int] = []
    real = orchestrator.align_bars

    def picky(
        beat_logits: np.ndarray,
        downbeat_logits: np.ndarray,
        beats: np.ndarray,
        notated: list,
        *rest,
        **named,
    ) -> list[float]:
        tries.append(len(notated))
        if len(notated) > 8:
            raise NoAlignmentError(NO_FIT)
        return real(beat_logits, downbeat_logits, beats, notated, *rest, **named)

    monkeypatch.setattr(orchestrator, "align_bars", picky)
    return tries


@pytest.mark.usefixtures("only_eight_slots_fit")
def test_a_recording_that_skips_the_repeat_is_mapped_straight_through(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=RepeatOmr(REPEAT_AT_THE_END)))

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    locators = world.db.get_locators(PIECE)
    assert [(item.bar, item.pass_index) for item in locators] == [(bar, 0) for bar in range(1, 9)]
    assert np.diff([item.time_sec for item in locators]) == pytest.approx([2.0] * 7, abs=0.05)
    assert world.db.get_structure(PIECE)[0] == [PlayOrderRow(start=1, end=8)]


@pytest.mark.usefixtures("only_eight_slots_fit")
def test_a_skipped_repeat_goes_to_review_on_the_bar_of_its_sign(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=RepeatOmr(REPEAT_AT_THE_END)))

    flagged = {
        item.bar: [flag.kind for flag in item.flags]
        for item in world.db.get_locators(PIECE)
        if item.flags
    }
    assert flagged == {8: ["skipped-repeat"]}
    assert world.db.get_locators(PIECE)[-1].checked is False
    assert any("repeat" in warning for warning in final(world, job).warnings)


def test_a_recording_that_plays_the_repeat_keeps_the_written_order(world: World) -> None:
    times = [0.5 + 2.0 * bar for bar in range(16)]
    stages = stages_with(omr=RepeatOmr(REPEAT_AT_THE_END), downbeats=BumpDownbeats(times, 34.0))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert done.warnings == []
    locators = world.db.get_locators(PIECE)
    assert [(item.bar, item.pass_index) for item in locators] == [
        (bar, passing) for bar in range(1, 9) for passing in (0, 1)
    ]
    assert world.db.get_structure(PIECE)[0] == [
        PlayOrderRow(start=1, end=8),
        PlayOrderRow(start=1, end=8),
    ]


@pytest.mark.usefixtures("only_eight_slots_fit")
def test_straight_through_is_refused_when_it_leaves_much_of_the_recording_out(
    world: World,
) -> None:
    # two repeats in the score, one taken in the recording: neither order is what was played
    marks = [
        StructureMark(kind=MarkKind.REPEAT_END, bar=4),
        StructureMark(kind=MarkKind.REPEAT_START, bar=5),
        StructureMark(kind=MarkKind.REPEAT_END, bar=8),
    ]
    times = [0.5 + 2.0 * bar for bar in range(12)]
    stages = stages_with(omr=RepeatOmr(*marks), downbeats=BumpDownbeats(times, 26.0))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    failed = final(world, job)
    assert failed.status == JobStatus.ERROR
    assert failed.error == f"align failed: {NO_FIT}"
    assert world.db.get_locators(PIECE) == []


def test_a_score_with_no_repeats_has_nothing_to_retry(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    tries: list[int] = []

    def no_fit(*_: object, **__: object) -> list[float]:
        tries.append(1)
        raise NoAlignmentError(NO_FIT)

    monkeypatch.setattr(orchestrator, "align_bars", no_fit)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    assert final(world, job).error == f"align failed: {NO_FIT}"
    assert len(tries) == 1


# --- the pulse check ----------------------------------------------------------------------------


def pulse_sentence(heard: int, score: int) -> str:
    return (
        f"The recording's beat looks like {heard} per bar, not {score}. "
        "The Editor can put the bar lines on the beats."
    )


def pulse_flags_by_slot(world: World) -> dict[tuple[int, int], list[ReviewFlag]]:
    """The pulse flags of each locator, by (bar, pass)."""
    return {
        (item.bar, item.pass_index): [flag for flag in item.flags if flag.kind == "pulse"]
        for item in world.db.get_locators(PIECE)
    }


class MeterOmr(FakeOmrStage):
    """The fake OMR with the meters of the piece set by hand: (numerator, denominator, from_bar)."""

    def __init__(self, *meters: tuple[int, int, int]) -> None:
        self.meters = [
            MeterChange(numerator=numerator, denominator=denominator, from_bar=from_bar)
            for numerator, denominator, from_bar in meters
        ]

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        result = super().read(score_file, rendered)
        return replace(result, structure=replace(result.structure, meters=self.meters))


def beats_by_bar(starts: list[float], counts: list[int], last_length: float = 2.0) -> list[float]:
    """`counts[i]` evenly spaced beats in the bar that starts at `starts[i]`."""
    ends = [*starts[1:], starts[-1] + last_length]
    return [
        start + k * (end - start) / count
        for start, end, count in zip(starts, ends, counts, strict=True)
        for k in range(count)
    ]


def test_a_recording_heard_one_beat_a_bar_against_a_four_beat_score_gets_a_pulse_flag(
    world: World,
) -> None:
    starts = bar_times([1.0] * 8, 2.0)
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 1)))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    flags = pulse_flags_by_slot(world)
    assert [slot for slot, found in flags.items() if found] == [(1, 0)]  # the first slot, once
    (flag,) = flags[(1, 0)]
    assert flag.severity == 1
    assert flag.expected == 4
    assert flag.found == pytest.approx(1.0)  # the unrounded value
    assert flag.factor == pytest.approx(0.25)
    assert flag.explained_by is None and flag.uncertain_line is None
    assert world.db.get_locators(PIECE)[0].checked is False
    assert done.warnings == [pulse_sentence(1, 4)]


def test_the_pulse_flag_does_not_change_the_map(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    starts = bar_times([1.0] * 8, 2.0)
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 1)))
    process_piece(start(world, JobKind.PROCESS_PIECE), world.services, stages)
    flagged = world.db.get_locators(PIECE)

    # the same recording and score with the check switched off
    plain = make_world()
    monkeypatch.setattr(orchestrator, "mismatched_pulse", lambda *_, **__: None)
    process_piece(start(plain, JobKind.PROCESS_PIECE), plain.services, stages)
    unflagged = plain.db.get_locators(PIECE)

    assert [flag.kind for flag in flagged[0].flags] == ["pulse"]
    assert not any(flag.kind == "pulse" for item in unflagged for flag in item.flags)
    assert [(item.bar, item.pass_index, item.time_sec) for item in flagged] == [
        (item.bar, item.pass_index, item.time_sec) for item in unflagged
    ]
    assert [item.time_sec for item in flagged] == pytest.approx(starts, abs=0.05)
    assert flagged[1:] == unflagged[1:]  # flags and checked too: only the first slot differs
    assert [flag for flag in flagged[0].flags if flag.kind != "pulse"] == unflagged[0].flags
    assert world.db.get_structure(PIECE)[0] == plain.db.get_structure(PIECE)[0]
    assert world.db.get_structure(PIECE)[0] == [PlayOrderRow(start=1, end=8)]
    assert final(world, world.jobs.snapshots[-1]).warnings == [pulse_sentence(1, 4)]
    assert final(plain, plain.jobs.snapshots[-1]).warnings == []


def test_a_recording_heard_at_the_scores_pulse_gets_no_pulse_flag_and_no_warning(
    world: World,
) -> None:
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())  # four beats a bar against 4/4

    assert not any(pulse_flags_by_slot(world).values())
    assert final(world, job).warnings == []


def test_a_six_eight_piece_heard_at_two_beats_a_bar_gets_no_pulse_flag(world: World) -> None:
    # 6/8 is felt in 2: the score's beats per bar are 2, not 6
    starts = bar_times([0.75] * 8, 2.0)
    stages = stages_with(
        omr=MeterOmr((6, 8, 1)), downbeats=BumpDownbeats(starts, 14.0, even_beats(starts, 2, 1.5))
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert not any(pulse_flags_by_slot(world).values())
    assert done.warnings == []


def test_a_six_eight_piece_heard_at_six_beats_a_bar_is_flagged_against_two(world: World) -> None:
    starts = bar_times([0.75] * 8, 2.0)
    stages = stages_with(
        omr=MeterOmr((6, 8, 1)), downbeats=BumpDownbeats(starts, 14.0, even_beats(starts, 6, 1.5))
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    (flag,) = pulse_flags_by_slot(world)[(1, 0)]
    assert (flag.expected, flag.found) == (2, pytest.approx(6.0))
    assert flag.factor == pytest.approx(3.0)
    assert done.warnings == [pulse_sentence(6, 2)]


def beats_every(gap: float, count: int, start: float = 0.5) -> list[float]:
    return [start + gap * k for k in range(count)]


def test_a_piece_that_changes_meter_is_judged_by_the_mean_of_its_bars(world: World) -> None:
    # six bars of 4/4 then two of 3/4: 30 beats in 8 bars, a mean of 3.75, not the first meter's 4
    starts = bar_times([1.0] * 6 + [0.75] * 2, 2.0)
    counts = [4] * 6 + [3] * 2
    stages = stages_with(
        omr=MeterOmr((4, 4, 1), (3, 4, 7)),
        downbeats=BumpDownbeats(starts, 18.0, beats_by_bar(starts, counts, 1.5)),
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert not any(pulse_flags_by_slot(world).values())
    assert done.warnings == []


def test_the_score_beats_of_a_pulse_flag_are_the_mean_of_the_bars_of_the_order(
    world: World,
) -> None:
    starts = bar_times([1.0] * 6 + [0.75] * 2, 2.0)
    stages = stages_with(
        omr=MeterOmr((4, 4, 1), (3, 4, 7)),
        downbeats=BumpDownbeats(starts, 18.0, beats_by_bar(starts, [1] * 8, 1.5)),
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    (flag,) = pulse_flags_by_slot(world)[(1, 0)]
    assert (flag.expected, flag.found) == (3.75, pytest.approx(1.0))
    assert flag.factor == pytest.approx(1.0 / 3.75)
    assert done.warnings == [pulse_sentence(1, 4)]


def test_the_warning_rounds_half_a_beat_up_as_the_card_does(world: World) -> None:
    # four bars of 2/4 then four of 3/4: a mean of 2.5. Python rounds 2.5 to 2; the card says 3.
    starts = bar_times([0.5] * 4 + [0.75] * 4, 2.0)
    stages = stages_with(
        omr=MeterOmr((2, 4, 1), (3, 4, 5)),
        downbeats=BumpDownbeats(starts, 14.0, beats_by_bar(starts, [1] * 8, 1.5)),
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    (flag,) = pulse_flags_by_slot(world)[(1, 0)]
    assert (flag.expected, flag.found) == (2.5, pytest.approx(1.0))
    assert done.warnings == [pulse_sentence(1, 3)]


def test_a_four_four_recording_heard_at_three_beats_a_bar_gets_no_pulse_flag(
    world: World,
) -> None:
    starts = bar_times([1.0] * 8, 2.0)
    stages = stages_with(downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 3)))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert not any(pulse_flags_by_slot(world).values())
    assert done.warnings == []


def test_a_pause_without_beats_does_not_make_a_pulse(world: World) -> None:
    # 4/4: bar 4 holds its four beats in its first two seconds and then nothing for four seconds,
    # so the last four bars start 4 s late. Beats over time said 5 a bar.
    starts = bar_times([1.0] * 4, 2.0) + bar_times([1.0] * 4, 2.0, start=12.5)
    beats = [*beats_every(0.5, 16), *beats_every(0.5, 16, start=12.5)]
    stages = stages_with(downbeats=BumpDownbeats(starts, 22.0, beats))
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert not any(pulse_flags_by_slot(world).values())
    assert done.warnings == []


def test_a_count_in_before_the_first_bar_does_not_make_a_pulse(world: World) -> None:
    # eight count-in beats, then 8 bars of 4/4: 40 beats over 8 bars would be 5 a bar
    starts = bar_times([1.0] * 8, 2.0, start=6.0)
    beats = [*beats_every(0.5, 8, start=2.0), *even_beats(starts, 4)]
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(downbeats=BumpDownbeats(starts, 24.0, beats)))

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert [item.time_sec for item in world.db.get_locators(PIECE)] == pytest.approx(
        starts, abs=0.05
    )
    assert not any(pulse_flags_by_slot(world).values())
    assert done.warnings == []


@pytest.mark.usefixtures("only_eight_slots_fit")
def test_a_recording_that_skips_the_repeats_with_the_right_pulse_gets_no_pulse_flag(
    world: World,
) -> None:
    # 16 written slots, 8 played, four 0.5 s beats to each played bar: the pulse is the score's
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=RepeatOmr(REPEAT_AT_THE_END)))

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    assert not any(pulse_flags_by_slot(world).values())
    assert done.warnings == [SKIPPED_REPEATS]


@pytest.mark.usefixtures("only_eight_slots_fit")
def test_a_pulse_the_written_order_hears_as_a_whole_number_is_flagged_when_repeats_were_skipped(
    world: World,
) -> None:
    # 16 beats a second apart: 2 to each of the 8 played bars, 1 to each of the 16 written slots.
    # The written order is tried first (the case of a waltz heard one beat a bar).
    stages = stages_with(
        omr=RepeatOmr(REPEAT_AT_THE_END),
        downbeats=BumpDownbeats(bar_times([1.0] * 8, 2.0), 18.0, beats_every(1.0, 16)),
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    (flag,) = pulse_flags_by_slot(world)[(1, 0)]
    assert (flag.expected, flag.found) == (4, pytest.approx(1.0))
    assert done.warnings == [SKIPPED_REPEATS, pulse_sentence(1, 4)]
    assert [flag.kind for flag in world.db.get_locators(PIECE)[0].flags] == ["pulse"]
    assert [flag.kind for flag in world.db.get_locators(PIECE)[-1].flags] == ["skipped-repeat"]


@pytest.mark.usefixtures("only_eight_slots_fit")
def test_a_pulse_only_the_played_order_hears_as_a_whole_number_is_flagged_by_the_played_one(
    world: World,
) -> None:
    # 8 beats 2 s apart: 1 to each of the 8 played bars, 0.5 to each of the 16 written slots
    starts = bar_times([1.0] * 8, 2.0)
    stages = stages_with(
        omr=RepeatOmr(REPEAT_AT_THE_END),
        downbeats=BumpDownbeats(starts, 18.0, even_beats(starts, 1)),
    )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages)

    done = final(world, job)
    assert done.status == JobStatus.DONE, done.error
    (flag,) = pulse_flags_by_slot(world)[(1, 0)]
    assert (flag.expected, flag.found) == (4, pytest.approx(1.0))
    assert done.warnings == [SKIPPED_REPEATS, pulse_sentence(1, 4)]


# --- plan limits at job time -------------------------------------------------------------------


class LongAudio(FakeAudioStage):
    """The fake recording, but `seconds` long as far as the plan can tell."""

    def __init__(self, seconds: float) -> None:
        self.seconds = seconds

    def ingest(self, piece_id: str) -> AudioResult:
        return replace(super().ingest(piece_id), duration_sec=self.seconds)


class Counting(FakeOmrStage):
    """The fake OMR that remembers which parts it was asked to read."""

    def __init__(self) -> None:
        self.read_parts: list[str] = []

    def read(self, score_file: dict, rendered: RenderedPart) -> PartRead:
        self.read_parts.append(score_file["id"])
        return super().read(score_file, rendered)


class PagesPerPart(FakePagesStage):
    """The fake pages stage with a page count per part; remembers what it counted and rendered."""

    def __init__(self, counts: dict[str, int]) -> None:
        super().__init__()
        self.counts = counts
        self.counted: list[str] = []
        self.rendered: list[str] = []

    def page_count(self, score_file: dict) -> int:
        self.counted.append(score_file["id"])
        return self.counts.get(score_file["id"], 1)

    def render(self, score_file: dict) -> RenderedPart:
        self.rendered.append(score_file["id"])
        return super().render(score_file)


def trial_events(world: World) -> list[bool]:
    """For each piece_created event of the owner: has it been given back?"""
    return [e["voided_at"] is not None for e in world.db.events_of(OWNER, "piece_created")]


def test_a_recording_over_the_trial_limit_ends_the_job_before_any_reading(world: World) -> None:
    omr, pages = Counting(), PagesPerPart({})
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(audio=LongAudio(601), omr=omr, pages=pages))

    done = final(world, job)
    assert done.status == JobStatus.ERROR
    assert done.error == "plan_limit:recording_minutes_max"
    assert omr.read_parts == [] and pages.rendered == [] and pages.counted == []
    assert world.db.get_structure(PIECE) == ([], [], [])
    assert world.db.get_locators(PIECE) == []
    assert trial_events(world) == [True]  # the refused first processing gave its piece back


def test_a_job_refused_on_a_piece_processed_before_keeps_its_created_event(world: World) -> None:
    world.db.save_page_layer(PART, [{"page_index": 0}], [])  # an earlier run rendered the part
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, [])  # and saved the play order
    long_recording = start(world, JobKind.PROCESS_PIECE)
    process_piece(long_recording, world.services, stages_with(audio=LongAudio(601)))
    assert final(world, long_recording).error == "plan_limit:recording_minutes_max"
    assert trial_events(world) == [False]

    long_part = start(world, JobKind.PROCESS_PIECE)
    process_piece(long_part, world.services, stages_with(pages=PagesPerPart({PART: 21})))
    assert final(world, long_part).error == "plan_limit:pages_per_part_max"
    assert trial_events(world) == [False]


def test_a_recording_of_exactly_the_limit_is_read(world: World) -> None:
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(audio=LongAudio(600), omr=Counting()))
    assert final(world, job).error != "plan_limit:recording_minutes_max"
    assert trial_events(world) == [False]


def test_a_part_over_the_page_limit_ends_the_job_before_anything_is_rendered(
    world: World,
) -> None:
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/p2.pdf", name="P2", position=2)
    omr, pages = Counting(), PagesPerPart({"file-2": 21})  # the second part is the long one
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=omr, pages=pages))

    done = final(world, job)
    assert done.status == JobStatus.ERROR and done.error == "plan_limit:pages_per_part_max"
    assert pages.counted == [PART, "file-2"]
    assert pages.rendered == [] and omr.read_parts == []  # not even the first part
    assert trial_events(world) == [True]


def test_twenty_pages_are_read_on_trial(world: World) -> None:
    omr = Counting()
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(omr=omr, pages=PagesPerPart({PART: 20})))
    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert omr.read_parts == [PART]


def test_a_creators_21_page_part_is_read(world: World) -> None:
    world.db.set_plan(OWNER, "creator")
    omr = Counting()
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(omr=omr, pages=PagesPerPart({PART: 21})))
    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert omr.read_parts == [PART]
    assert trial_events(world) == [False]


def test_the_admin_is_not_even_asked_for_page_counts(world: World) -> None:
    world.db.add_admin(OWNER)
    pages = PagesPerPart({PART: 500})
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, stages_with(audio=LongAudio(1100), pages=pages))
    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert pages.counted == [] and pages.rendered == [PART]


def test_adding_parts_over_the_page_limit_fails_the_job_and_keeps_the_piece_counted() -> None:
    world = processed_world()
    world.db.add_score_file(PIECE, "file-2", f"{OWNER}/{PIECE}/p2.pdf", name="P2", position=2)
    omr, pages = Counting(), PagesPerPart({"file-2": 21})
    job = start(world, JobKind.ADD_PARTS)

    add_parts(job, world.services, stages_with(omr=omr, pages=pages))

    done = final(world, job)
    assert done.status == JobStatus.ERROR and done.error == "plan_limit:pages_per_part_max"
    assert pages.rendered == [] and omr.read_parts == []
    assert trial_events(world) == [False]  # an added part never gives the piece back


def test_realign_makes_no_plan_check_of_its_own() -> None:
    world = processed_world()
    world.db.record_usage(OWNER, "realign", PIECE, None, 9)  # the route decides; the job runs
    job = start(world, JobKind.REALIGN)
    realign_piece(job, world.services, default_stages())
    assert final(world, job).status == JobStatus.DONE, final(world, job).error


def test_one_advanced_reading_event_is_recorded_for_each_ticked_part_read() -> None:
    world = make_world(with_score_file=False)
    world.db.set_plan(OWNER, "creator")
    for index, ticked in enumerate((True, False, True)):
        world.db.add_score_file(
            PIECE,
            f"file-{index}",
            f"{OWNER}/{PIECE}/p{index}.pdf",
            position=index,
            box_check=ticked,
        )
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    events = world.db.events_of(OWNER, "advanced_reading_part")
    assert [(e["piece_id"], e["part_id"]) for e in events] == [(PIECE, "file-0"), (PIECE, "file-2")]
    assert world.db.usage_of(OWNER)["advanced_reading_parts_this_month"] == 2


def test_no_advanced_reading_event_when_no_part_is_ticked_or_the_job_is_refused(
    world: World,
) -> None:
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, default_stages())
    assert world.db.events_of(OWNER, "advanced_reading_part") == []

    ticked = make_world(with_score_file=False)
    ticked.db.set_plan(OWNER, "creator")
    ticked.db.add_score_file(PIECE, PART, f"{OWNER}/{PIECE}/p.pdf", box_check=True)
    refused = start(ticked, JobKind.PROCESS_PIECE)
    process_piece(refused, ticked.services, stages_with(audio=LongAudio(1300)))
    assert final(ticked, refused).error == "plan_limit:recording_minutes_max"
    assert ticked.db.events_of(OWNER, "advanced_reading_part") == []


def test_added_ticked_parts_are_recorded_too() -> None:
    world = processed_world()
    world.db.set_plan(OWNER, "creator")
    world.db.add_score_file(
        PIECE, "file-2", f"{OWNER}/{PIECE}/p2.pdf", name="P2", position=2, box_check=True
    )
    job = start(world, JobKind.ADD_PARTS)
    add_parts(job, world.services, default_stages())
    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert [e["part_id"] for e in world.db.events_of(OWNER, "advanced_reading_part")] == ["file-2"]


def test_a_refusal_still_ends_the_job_when_giving_the_piece_back_fails(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(piece_id: str) -> None:
        raise RestError(503, None)

    monkeypatch.setattr(world.db, "void_piece_created", broken)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(audio=LongAudio(700)))

    assert final(world, job).error == "plan_limit:recording_minutes_max"


def ticked_creator_world(*, used: int = 0, ticked: int = 1) -> World:
    """A Creator's piece of `ticked` ticked parts that were all read before, `used` parts used."""
    world = make_world(with_score_file=False)
    world.db.set_plan(OWNER, "creator")
    for index in range(ticked):
        file_id = f"file-{index}"
        world.db.add_score_file(
            PIECE, file_id, f"{OWNER}/{PIECE}/p{index}.pdf", position=index, box_check=True
        )
        world.db.save_page_layer(file_id, [{"page_index": 0}], [])
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, [])  # processed before
    if used:
        world.db.record_usage(OWNER, "advanced_reading_part", PIECE, None, used)
    return world


def test_advanced_reading_is_checked_at_job_time_before_any_model_runs() -> None:
    # Final review I3 (1): a Creator moved to Trial keeps the ticks; a re-run must not read them.
    world = ticked_creator_world()
    world.db.set_plan(OWNER, "trial")
    omr = Counting()
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=omr))

    done = final(world, job)
    assert done.status == JobStatus.ERROR and done.error == "plan_limit:advanced_reading"
    assert omr.read_parts == []
    assert world.db.events_of(OWNER, "advanced_reading_part") == []
    assert world.db.get_piece_owner(PIECE) == OWNER  # processed before: not a first processing


def test_a_rerun_with_the_months_parts_used_is_refused_at_job_time() -> None:
    # Final review I3 (2): the route's count saw no unread ticks; the job reads them all again.
    world = ticked_creator_world(used=30)
    omr = Counting()
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(omr=omr))

    assert final(world, job).error == "plan_limit:advanced_reading_parts_per_month"
    assert omr.read_parts == []
    assert world.db.usage_of(OWNER)["advanced_reading_parts_this_month"] == 30


def test_a_rerun_with_room_reads_and_counts_every_ticked_part_again() -> None:
    world = ticked_creator_world(used=26, ticked=3)
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, default_stages())
    assert final(world, job).status == JobStatus.DONE, final(world, job).error
    assert world.db.usage_of(OWNER)["advanced_reading_parts_this_month"] == 29


def test_two_jobs_cannot_both_take_the_last_parts_of_the_month(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Final review I3 (3): each job passed `used + parts <= 30` on the plan it read when it
    # started. The check and the record are one call that sees what the other job recorded.
    world = ticked_creator_world(used=29)
    stale = world.db.plan_state(OWNER, PIECE)  # what both jobs read before either records
    monkeypatch.setattr(world.db, "plan_state", lambda user_id, piece_id=None: copy.deepcopy(stale))
    first = start(world, JobKind.PROCESS_PIECE)
    process_piece(first, world.services, default_stages())
    assert final(world, first).status == JobStatus.DONE, final(world, first).error

    second = world.jobs.create(PIECE, JobKind.PROCESS_PIECE)
    process_piece(second, world.services, default_stages())

    assert final(world, second).error == "plan_limit:advanced_reading_parts_per_month"
    assert len(world.db.events_of(OWNER, "advanced_reading_part")) == 30


def test_the_check_and_the_record_are_one_call_that_names_every_ticked_part() -> None:
    world = ticked_creator_world(ticked=3)
    calls: list[tuple[str, str, list[str]]] = []
    real = world.db.use_advanced_reading

    def spy(user_id: str, piece_id: str, part_ids: list[str]) -> str | None:
        calls.append((user_id, piece_id, list(part_ids)))
        return real(user_id, piece_id, part_ids)

    world.db.use_advanced_reading = spy  # type: ignore[method-assign]
    job = start(world, JobKind.PROCESS_PIECE)
    process_piece(job, world.services, default_stages())
    assert calls == [(OWNER, PIECE, ["file-0", "file-1", "file-2"])]


def test_a_job_time_refusal_of_a_first_processing_keeps_the_piece_and_gives_the_slot_back() -> None:
    # Final review I2 (b): the Processing page must still show the plan sentence.
    world = make_world()
    world.storage.upload(f"{OWNER}/{PIECE}/score.pdf", b"%PDF", "application/pdf")
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(pages=PagesPerPart({PART: 21})))

    assert final(world, job).error == "plan_limit:pages_per_part_max"
    assert world.db.get_piece_owner(PIECE) == OWNER
    assert len(world.db.list_score_files(PIECE)) == 1
    assert world.storage.paths() == [f"{OWNER}/{PIECE}/score.pdf"]
    assert trial_events(world) == [True]


def test_a_processed_piece_whose_only_part_was_replaced_keeps_its_event_when_refused() -> None:
    # Final re-review I2: "all parts unrendered" is also true after a processed piece's parts are
    # replaced. Only a piece that was never processed (no play order) is a first processing.
    world = make_world()
    world.db.save_structure(PIECE, EIGHT_BARS, FOUR_FOUR, [])  # processed before
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, stages_with(pages=PagesPerPart({PART: 25})))

    assert final(world, job).error == "plan_limit:pages_per_part_max"
    assert world.db.get_piece_owner(PIECE) == OWNER
    assert trial_events(world) == [False]  # not given back: repeating this cannot free a slot


def test_refuse_then_swap_the_file_then_process_again_ends_with_the_piece_counted() -> None:
    # The abuse of the review: a refused (voided) piece processed later must not stay uncounted.
    world = make_world()
    first = start(world, JobKind.PROCESS_PIECE)
    process_piece(first, world.services, stages_with(pages=PagesPerPart({PART: 25})))
    assert final(world, first).error == "plan_limit:pages_per_part_max"
    assert trial_events(world) == [True]

    # The file is swapped (nothing here to do), then the next process-piece starts by claiming.
    assert world.db.claim_piece(PIECE) is None
    second = world.jobs.create(PIECE, JobKind.PROCESS_PIECE)
    process_piece(second, world.services, stages_with(pages=PagesPerPart({PART: 5})))

    assert final(world, second).status == JobStatus.DONE, final(world, second).error
    assert trial_events(world) == [False]
    assert world.db.usage_of(OWNER)["pieces_created"] == 1


def test_a_claim_refused_because_the_slot_was_used_meanwhile_leaves_the_event_voided() -> None:
    world = make_world()
    first = start(world, JobKind.PROCESS_PIECE)
    process_piece(first, world.services, stages_with(audio=LongAudio(700)))
    for name in ("p-a", "p-b", "p-c"):
        world.db.add_piece(name, OWNER)
    assert world.db.claim_piece(PIECE) == "pieces_created_max"
    assert trial_events(world)[0] is True


def test_a_plan_that_cannot_be_read_fails_the_job_with_the_generic_sentence(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    def down(user_id: str, piece_id: str | None = None) -> dict:
        raise RestError(503, None)

    monkeypatch.setattr(world.db, "plan_state", down)
    job = start(world, JobKind.PROCESS_PIECE)

    process_piece(job, world.services, default_stages())

    done = final(world, job)
    assert done.status == JobStatus.ERROR
    assert done.error is not None and done.error.startswith("plan failed:")
    assert "503" not in done.error
