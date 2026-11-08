import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any, TypeVar

import numpy as np

from app.db import Database
from app.job_end import GENERIC_FAILURE, update_final, void_created
from app.pipeline.align import NoAlignmentError, align_bars, realign_bars, unused_beat_share
from app.pipeline.analysis import Analysis, detected_beats, load_analysis, save_analysis
from app.pipeline.audio_ingest import AudioIngestError
from app.pipeline.audiveris import OmrError
from app.pipeline.beats import BeatModelError
from app.pipeline.models import (
    BarMark,
    FailedPart,
    Job,
    JobKind,
    JobStatus,
    Locator,
    MeterChange,
    PlayOrderRow,
    PlaySlot,
    ReviewFlag,
    ShortBar,
    expand_play_order,
)
from app.pipeline.pdf_pages import PdfPagesError
from app.pipeline.plan_limits import PlanRefused, decide
from app.pipeline.pulse import mismatched_pulse, round_half_up
from app.pipeline.review_flags import (
    PICKUP_SURE,
    is_checked,
    review_flags,
    skipped_repeat_bars,
)
from app.pipeline.score_reader import ScoreReaderError
from app.pipeline.sentences import user_sentence
from app.pipeline.stages import (
    AudioResult,
    Heard,
    OmrStage,
    PagesStage,
    RenderedPart,
    Stages,
)
from app.pipeline.structure import (
    PieceStructure,
    StructureError,
    alignment_inputs,
    short_slots,
    without_repeats,
)
from app.pipeline.structure_read import (
    PartRead,
    StructureReadError,
    agree_on_pickup,
    elect_piece_structure,
    part_problems,
)

if TYPE_CHECKING:
    from app.deps import Services

# Runs the stages of one job in order and writes how far it got to the job. A failing stage ends
# the job as `error` ("<stage> failed: <message>") and is not re-raised: the browser reads the
# error from the jobs table (the job runs in the background, after the HTTP answer). A job
# that finishes carries the warnings of its reads (a part with another bar count, a score read
# without the vision model) and what the vision model cost.

_log = logging.getLogger("uvicorn.error")

T = TypeVar("T")


class _StageFailed(Exception):
    """A stage raised; carries the stage name and the original error."""

    def __init__(self, stage: str, cause: Exception) -> None:
        super().__init__(stage)
        self.stage = stage
        self.cause = cause


class _Runner:
    """Runs the stages of one job and records the progress each one reaches."""

    def __init__(self, job: Job, services: "Services") -> None:
        self.job = job
        self.services = services
        self.warnings: list[str] = []
        self.cost_usd = 0.0
        self.failed_parts: list[FailedPart] = []
        self._plan: dict[str, Any] | None = None

    def stage(self, name: str, work: Callable[[], T], progress: float | None = None) -> T:
        """Run `work`; a failure becomes _StageFailed, a success moves progress to `progress`.
        A plan refusal is not a failure of the stage: it passes through, and the job ends on it."""
        try:
            result = work()
        except PlanRefused:
            raise
        except Exception as error:
            raise _StageFailed(name, error) from error
        if progress is not None:
            self.advance(progress)
        return result

    def owner(self) -> str:
        owner_id = self.services.db.get_piece_owner(self.job.piece_id)
        if owner_id is None:
            raise ValueError("the piece no longer exists")
        return owner_id

    def plan(self) -> dict[str, Any]:
        """The owner's plan state, read once per job (the piece's plan is the owner's)."""
        if self._plan is None:
            owner_id = self.owner()
            self._plan = self.services.db.plan_state(owner_id, self.job.piece_id)
        return self._plan

    def check(self, action: str, **facts: Any) -> None:
        """Stop the job with PlanRefused when the owner's plan does not allow `action`."""
        state = self.stage("plan", self.plan)
        limit = decide(state, action, **facts)
        if limit is not None:
            raise PlanRefused(limit)

    def advance(self, progress: float) -> None:
        """Record that the job has got this far. Best effort: one timeout on this write must not
        throw away a finished stage and the vision model's cost, so it is logged and work goes on.
        """
        try:
            self.services.jobs.update(self.job.id, progress=progress)
        except Exception:
            # no detail: the error of a failed request can hold the project's address
            _log.warning("progress of job %s could not be saved", self.job.id)


def process_piece(job: Job, services: "Services", stages: Stages) -> None:
    """Read the score and the recording, align them, and write the first map of the piece."""
    _execute(job, services, stages, lambda run: _process(run, stages))


def realign_piece(job: Job, services: "Services", stages: Stages) -> None:
    """Refit the unconfirmed locators of a piece around its confirmed ones."""
    _execute(job, services, stages, lambda run: _realign(run, stages))


def add_parts(job: Job, services: "Services", stages: Stages) -> None:
    """Give the parts that have no pages yet their page images and bar boxes.

    The piece's shared timing is never touched; each new part is checked against it.
    """
    _execute(job, services, stages, lambda run: _add_parts(run, stages))


def _execute(
    job: Job, services: "Services", stages: Stages, body: Callable[[_Runner], None]
) -> None:
    services.jobs.update(job.id, status=JobStatus.RUNNING)
    run = _Runner(job, services)
    try:
        body(run)
    except PlanRefused as refused:
        _end(
            services,
            job.id,
            status=JobStatus.ERROR,
            error=str(refused),
            failed_parts=run.failed_parts,
        )
        # The plan stopped the job before any model ran. A first processing gives its slot back
        # and keeps the piece, so the page can show why; the next process-piece claims the slot.
        if job.kind is JobKind.PROCESS_PIECE:
            void_created(services.db, job.piece_id)
        return
    except _StageFailed as failure:
        message = _failure_message(failure.stage, failure.cause)
        _end(
            services,
            job.id,
            status=JobStatus.ERROR,
            error=message,
            failed_parts=run.failed_parts,
        )
        return
    finally:
        stages.clean_up()
    _end(
        services,
        job.id,
        status=JobStatus.DONE,
        progress=1.0,
        warnings=run.warnings,
        cost_usd=run.cost_usd,
        failed_parts=run.failed_parts,
    )


def _end(services: "Services", job_id: str, **fields: Any) -> None:
    """Write the job's end with all its fields. If Supabase refuses that write (a 400, for text it
    cannot store), end the job with the generic sentence alone, so it is not left running."""
    if update_final(services.jobs, job_id, **fields):
        return
    _log.error("the end of job %s was refused; ending it with the generic sentence", job_id)
    update_final(services.jobs, job_id, status=JobStatus.ERROR, error=GENERIC_FAILURE)


def _failure_message(stage: str, error: Exception) -> str:
    """One short line: the stage and the error's message, never a stack trace."""
    return f"{stage} failed: {_sentence(error)}"


# What the app itself writes as one plain sentence for the user. Members can read jobs.error under
# RLS, and any other exception's text can hold an address or a row (final review M-2).
_OWN_SENTENCES = (
    NoAlignmentError,
    AudioIngestError,
    PdfPagesError,
    OmrError,
    BeatModelError,
    ScoreReaderError,
    StructureReadError,
    StructureError,
)


def _sentence(error: Exception) -> str:
    """What the job may tell the user about `error` (see sentences.user_sentence)."""
    return user_sentence(error, _OWN_SENTENCES)


# --- the parts ----------------------------------------------------------------


@dataclass(frozen=True)
class _Part:
    """One part (a score_files row) with its stored pages and what was read from them."""

    row: dict[str, Any]
    rendered: RenderedPart
    read: PartRead

    @property
    def name(self) -> str:
        if self.takes_read_name:
            return str(self.read.part_name)
        return str(self.row.get("name") or self.read.part_name or self.row.get("id"))

    @property
    def takes_read_name(self) -> bool:
        """The read found a name and the part's own was not set by the user."""
        return bool(self.read.part_name) and self.row.get("name_source") != "user"


def _render_parts(
    run: _Runner, rows: list[dict[str, Any]], pages: PagesStage
) -> list[tuple[dict[str, Any], RenderedPart]]:
    """Render the parts, once every one of them is within the plan's page limit (counting pages is
    cheap; nothing is rendered, read or paid for before all of them pass)."""
    state = run.plan()
    if not state.get("is_admin") and state["plan"].get("pages_per_part_max") is not None:
        for row in rows:
            run.check("pages", pages=pages.page_count(row))
    return [(row, pages.render(row)) for row in rows]


def _record_reading(run: _Runner, rendered: list[tuple[dict[str, Any], RenderedPart]]) -> None:
    """Check the plan for Advanced Reading and record one advanced_reading_part event for every
    ticked part about to be read, in one call that sees what other jobs recorded (so two jobs
    cannot both take the last parts of the month). A refusal ends the job before any model runs:
    OMR comes after this stage. The state read when the job began is not trusted for this."""
    ticked = [str(row["id"]) for row, _ in rendered if row.get("box_check")]
    if not ticked:
        return
    limit = run.services.db.use_advanced_reading(run.owner(), run.job.piece_id, ticked)
    if limit is not None:
        raise PlanRefused(limit)


def _read_parts(
    run: _Runner,
    omr: OmrStage,
    rendered: list[tuple[dict[str, Any], RenderedPart]],
    piece: PieceStructure | None = None,
    span: tuple[float, float] | None = None,
) -> list[_Part]:
    """Read every part; a part that cannot be read is left out and noted on the job, so one
    part never costs the others. Raises the first part's error only when none could be read.

    `span` is the progress the job has before and after this stage. One part takes minutes, so the
    job writes its progress after each part but the last (the stage writes the end): a job that
    is alive keeps changing, and the app can tell it from one that was abandoned."""
    parts: list[_Part] = []
    first_error: Exception | None = None
    for index, (row, pages) in enumerate(rendered):
        try:
            parts.append(_Part(row, pages, omr.read(row, pages)))
        except Exception as error:
            first_error = first_error or error
            name = str(row.get("name") or row.get("id"))
            run.failed_parts.append(FailedPart(id=row["id"], name=name, error=_sentence(error)))
            run.warnings.append(f"{name} could not be read: {_sentence(error)}")
        if span is not None and index < len(rendered) - 1:
            run.advance(span[0] + (span[1] - span[0]) * (index + 1) / len(rendered))
    if not parts and first_error is not None:
        raise first_error
    if not parts:
        return parts
    # the part most agree with (or the piece, when it has its timing) decides if there is a pickup
    reads = agree_on_pickup(
        [part.read for part in parts],
        piece or elect_piece_structure([part.read.structure for part in parts]),
    )
    return [replace(part, read=read) for part, read in zip(parts, reads, strict=True)]


def _piece_of(parts: list[_Part]) -> PieceStructure:
    return elect_piece_structure([part.read.structure for part in parts])


def _report(run: _Runner, parts: list[_Part], bar_count: int, structure: PieceStructure) -> None:
    """Put the parts' warnings and the vision cost on the job, and check each part against the
    piece's bar count and meters (`structure` is the piece's)."""
    several = len(parts) > 1
    for part in parts:
        run.cost_usd += part.read.cost_usd
        run.warnings += [f"{part.name}: {w}" if several else w for w in part.read.warnings]
        run.warnings += part_problems(part.name, part.read, bar_count, structure.meters)
    run.warnings[:] = list(dict.fromkeys(run.warnings))


def _save_page_layers(services: "Services", parts: list[_Part]) -> None:
    db = services.db
    for part in parts:
        pages = [
            {
                "page_index": image.page_index,
                "image_path": image.image_path,
                "width": image.width,
                "height": image.height,
            }
            for image in part.rendered.pages
        ]
        db.save_page_layer(part.row["id"], pages, part.read.boxes, part.read.structure.rests)
        if part.takes_read_name and part.read.part_name:
            db.set_part_name(part.row["id"], part.read.part_name)


# --- process-piece ------------------------------------------------------------


def _process(run: _Runner, stages: Stages) -> None:
    db, piece_id = run.services.db, run.job.piece_id

    audio = run.stage("audio", lambda: stages.audio.ingest(piece_id), 0.2)
    run.check("recording", seconds=audio.duration_sec)
    rendered = run.stage(
        "pages", lambda: _render_parts(run, _score_files(db, piece_id), stages.pages), 0.35
    )
    run.stage("usage", lambda: _record_reading(run, rendered))
    parts = run.stage(
        "omr", lambda: _read_parts(run, stages.omr, rendered, span=(0.35, 0.55)), 0.55
    )
    # Timing is shared by all parts: the reading most agree with sets the bars, meters and signs.
    structure = _piece_of(parts)
    run.stage(
        "play order", lambda: expand_play_order(structure.play_order, structure.bar_count), 0.65
    )
    heard = run.stage("downbeats", lambda: stages.downbeats.listen(audio), 0.8)
    aligned = run.stage("align", lambda: _align(heard, audio.duration_sec, structure), 0.95)
    run.stage("save", lambda: _save_piece(run.services, piece_id, audio, heard, parts, aligned))
    if aligned.structure is not structure:
        run.warnings.append(SKIPPED_REPEATS)
    if aligned.pulse is not None:
        run.warnings.append(
            PULSE_MISMATCH.format(
                heard=round_half_up(aligned.pulse.found),
                score=round_half_up(aligned.pulse.expected),
            )
        )
    _report(run, parts, structure.bar_count, structure)


def _score_files(db: Database, piece_id: str) -> list[dict[str, Any]]:
    rows = db.list_score_files(piece_id)
    if not rows:
        raise ValueError("the piece has no score files")
    return rows


# A recording may skip the repeats of the score (common in piano sonatas). The written order is then
# too long for it, and the map is tried once with no repeat taken; only a written order that fails
# gets the second try, so a piece that aligns today is not touched. Above this share of the detected
# beats left out, straight through is not what was played either (one repeat of two taken, say).
MAX_UNUSED_WITHOUT_REPEATS = 0.1
SKIPPED_REPEATS = (
    "The recording does not play the repeats in the score, so its bars are mapped straight through."
)
# The beat tracker hears another pulse than the score's (a fast 3/4 in one, say). The map is kept.
PULSE_MISMATCH = (
    "The recording's beat looks like {heard} per bar, not {score}. "
    "The Editor can put the bar lines on the beats."
)


@dataclass(frozen=True)
class _Aligned:
    """The map of a recording. `structure` is the piece's, without its repeats if it skips them."""

    structure: PieceStructure
    slots: list[PlaySlot]
    times: list[float]
    flags: list[list[ReviewFlag]]
    # set when the recording's beat is not the score's; the flag is also on the first slot's list
    pulse: ReviewFlag | None = None


def _align(heard: Heard, duration_sec: float, structure: PieceStructure) -> _Aligned:
    """One downbeat time per slot of the play order the recording follows, with the review flags."""
    played = structure
    try:
        found = _bar_times(heard, structure)
    except NoAlignmentError as written_failure:
        played = without_repeats(structure)
        if played.play_order == structure.play_order:
            raise
        found = _straight_through_times(heard, played, written_failure)
    slots = expand_play_order(played.play_order, played.bar_count)
    times = found[:-1]  # the last entry is where the last slot ends
    flags = _flags(slots, times, duration_sec, played, heard)
    if played is not structure:
        flags = _with_skipped_repeats(flags, slots, structure, played)
    pulse = _pulse_flag(heard, structure, played, start=found[0], end=found[-1])
    if pulse is not None:
        flags = [[*flags[0], pulse], *flags[1:]]
    return _Aligned(played, slots, times, flags, pulse)


def _bar_times(heard: Heard, structure: PieceStructure) -> list[float]:
    notated, soft, rit = alignment_inputs(structure, structure.play_order)
    return align_bars(
        heard.beat_logits,
        heard.downbeat_logits,
        np.asarray(heard.beats),
        notated,
        soft,
        rit,
        fps=heard.fps,
        short=short_slots(structure, structure.play_order),
    )


def _straight_through_times(
    heard: Heard, played: PieceStructure, written_failure: NoAlignmentError
) -> list[float]:
    """The bar times with no repeat taken; if they do not hold, the written failure stands."""
    try:
        found = _bar_times(heard, played)
    except NoAlignmentError:
        raise written_failure from None
    if unused_beat_share(np.asarray(heard.beats), found[0], found[-1]) > MAX_UNUSED_WITHOUT_REPEATS:
        raise written_failure
    return found


def _with_skipped_repeats(
    flags: list[list[ReviewFlag]],
    slots: list[PlaySlot],
    written: PieceStructure,
    played: PieceStructure,
) -> list[list[ReviewFlag]]:
    """The flags plus a note for the Review Queue on each bar where a repeat was skipped."""
    bars = skipped_repeat_bars(written.play_order, played.play_order)
    note = ReviewFlag(
        kind="skipped-repeat",
        severity=1,
        expected=len(expand_play_order(written.play_order, written.bar_count)),
        found=len(slots),
        factor=None,
    )
    return [
        [*slot_flags, note] if slot.bar in bars else slot_flags
        for slot, slot_flags in zip(slots, flags, strict=True)
    ]


def _pulse_flag(
    heard: Heard, written: PieceStructure, played: PieceStructure, *, start: float, end: float
) -> ReviewFlag | None:
    """A note for the first slot when the beats of the recording make a whole number of beats to a
    bar that is not the score's; the map is kept.

    The beats inside the map (from `start`, its first bar line, to `end`, where its last bar ends)
    are shared among the slots of the played and of the written order (see `mismatched_pulse`); the
    score's beats per bar of an order is the mean of what the alignment takes for its slots, so a
    change of meter, a compound meter and a short bar are counted as the alignment counts them.
    """
    found = mismatched_pulse(
        heard.beats,
        start,
        end,
        written=alignment_inputs(written, written.play_order)[0],
        played=alignment_inputs(played, played.play_order)[0],
    )
    if found is None:
        return None
    return ReviewFlag(
        kind="pulse",
        severity=1,
        expected=found.expected,
        found=found.heard,
        factor=found.heard / found.expected,
        explained_by=None,
        uncertain_line=None,
    )


def _flags(
    slots: list[PlaySlot],
    times: list[float],
    duration_sec: float,
    structure: PieceStructure,
    heard: Heard,
) -> list[list[ReviewFlag]]:
    return review_flags(
        slots,
        times,
        duration_sec,
        structure.meters,
        structure.bar_marks,
        heard.downbeat_probability,
        heard.fps,
        heard.beats,
        short_bars=structure.short_bars,
        pickup_sources=structure.pickup_sources,
    )


def _save_piece(
    services: "Services",
    piece_id: str,
    audio: AudioResult,
    heard: Heard,
    parts: list[_Part],
    aligned: _Aligned,
) -> None:
    db = services.db
    owner_id = db.get_piece_owner(piece_id)
    if owner_id is None:
        raise ValueError("the piece no longer exists")
    services.storage.upload(
        f"{owner_id}/{piece_id}/peaks.json",
        json.dumps(audio.peaks).encode(),
        "application/json",
    )
    # the beats the waveform draws (the app reads this file; local mode writes the same list)
    services.storage.upload(
        f"{owner_id}/{piece_id}/beats.json",
        json.dumps(detected_beats(heard)).encode(),
        "application/json",
    )
    # kept so a re-align need not listen to the recording again
    save_analysis(services.storage, owner_id, piece_id, Analysis(audio.duration_sec, heard))
    _save_page_layers(services, parts)
    structure = aligned.structure
    db.save_structure(
        piece_id,
        structure.play_order,
        structure.meters,
        structure.bar_marks,
        [ShortBar(bar=bar, units=units) for bar, units in sorted(structure.short_bars.items())],
    )
    db.replace_unconfirmed_locators(
        piece_id,
        [
            _locator(slot, time, slot_flags)
            for slot, time, slot_flags in zip(
                aligned.slots, aligned.times, aligned.flags, strict=True
            )
        ],
    )


def _locator(slot: PlaySlot, time_sec: float, flags: list[ReviewFlag]) -> Locator:
    """A new unconfirmed locator with its review flags; checked when the score explains them all."""
    return Locator(
        bar=slot.bar,
        pass_index=slot.pass_index,
        time_sec=time_sec,
        confirmed=False,
        flags=flags,
        checked=is_checked(flags),
    )


# --- realign ------------------------------------------------------------------


@dataclass(frozen=True)
class _Timeline:
    """The saved map laid out slot by slot, in play order."""

    slots: list[PlaySlot]
    locators: list[Locator | None]  # one per slot; None where the slot has no locator
    structure: PieceStructure  # what the database keeps: the order, meters and fermatas


def _realign(run: _Runner, stages: Stages) -> None:
    db, piece_id = run.services.db, run.job.piece_id

    timeline, saved = run.stage(
        "load",
        lambda: (_load_timeline(db, piece_id), _load_saved_analysis(run.services, piece_id)),
        0.1,
    )
    if saved is None:  # a piece processed before analyses were kept: listen again
        audio = run.stage("audio", lambda: stages.audio.ingest(piece_id), 0.3)
        heard = run.stage("downbeats", lambda: stages.downbeats.listen(audio), 0.6)
        analysis = Analysis(audio.duration_sec, heard)
    else:
        analysis = saved
        run.advance(0.6)
    refit = run.stage("align", lambda: _refit(timeline, analysis), 0.9)
    run.stage("save", lambda: db.replace_unconfirmed_locators(piece_id, refit))


def _load_saved_analysis(services: "Services", piece_id: str) -> Analysis | None:
    owner_id = services.db.get_piece_owner(piece_id)
    if owner_id is None:
        raise ValueError("the piece no longer exists")
    return load_analysis(services.storage, owner_id, piece_id)


def _refit(timeline: _Timeline, analysis: Analysis) -> list[Locator]:
    """New unconfirmed locators, flagged, for the slots without a confirmed one.

    The flags of every slot are worked out so each refit bar has its neighbours, but only the refit
    locators are returned: a confirmed locator keeps the flags and `checked` it has.
    """
    structure, heard = timeline.structure, analysis.heard
    if _pickup_in_doubt(timeline):
        structure = replace(structure, pickup_sources=PICKUP_SURE - 1)
    notated, soft, rit = alignment_inputs(structure, structure.play_order)
    times = realign_bars(
        heard.beat_logits,
        heard.downbeat_logits,
        np.asarray(heard.beats),
        notated,
        timeline.locators,
        soft,
        rit,
        fps=heard.fps,
        short=short_slots(structure, structure.play_order),
    )
    flags = _flags(timeline.slots, times, analysis.duration_sec, structure, heard)
    return [
        _locator(slot, time, slot_flags)
        for slot, locator, time, slot_flags in zip(
            timeline.slots, timeline.locators, times, flags, strict=True
        )
        if locator is None or not locator.confirmed
    ]


def _pickup_in_doubt(timeline: _Timeline) -> bool:
    """True when the locator of bar 0 carries the flag that only one reading called it a pickup."""
    return any(
        flag.kind == "pickup" and flag.found < flag.expected
        for locator in timeline.locators
        if locator is not None and locator.bar == 0
        for flag in locator.flags
    )


def _load_timeline(db: Database, piece_id: str) -> _Timeline:
    rows, meters, marks = db.get_structure(piece_id)
    if not rows:
        raise ValueError("the piece has no play order yet; process the piece first")
    locators = db.get_locators(piece_id)
    if not locators:
        raise ValueError("the piece has no locators yet; process the piece first")
    structure = _stored_structure(rows, meters, marks, db.get_short_bars(piece_id))
    slots = expand_play_order(rows, structure.bar_count)
    by_key = {(locator.bar, locator.pass_index): locator for locator in locators}
    return _Timeline(
        slots=slots,
        locators=[by_key.get((slot.bar, slot.pass_index)) for slot in slots],
        structure=structure,
    )


def _stored_structure(
    rows: list[PlayOrderRow],
    meters: list[MeterChange],
    marks: list[BarMark],
    short_bars: list[ShortBar],
) -> PieceStructure:
    """The structure as the database keeps it: its marks include the rit. spans, so a realign
    knows which slots slow down. Tempo words are not stored."""
    return PieceStructure(
        bar_count=max(row.end for row in rows),
        meters=meters,
        marks=[],
        bar_marks=marks,
        tempo_text={},
        part_name=None,
        play_order=rows,
        warnings=[],
        short_bars={short.bar: short.units for short in short_bars},
        # the doubt about a pickup is not stored; a realign keeps the flag it put on the locator
        pickup_sources=PICKUP_SURE if any(short.bar == 0 for short in short_bars) else 0,
    )


# --- add-parts ----------------------------------------------------------------


def _add_parts(run: _Runner, stages: Stages) -> None:
    db, piece_id = run.services.db, run.job.piece_id

    structure, pending = run.stage("load", lambda: _load_pending(db, piece_id))
    rendered = run.stage("pages", lambda: _render_parts(run, pending, stages.pages), 0.3)
    run.stage("usage", lambda: _record_reading(run, rendered))
    parts = run.stage(
        "omr", lambda: _read_parts(run, stages.omr, rendered, structure, span=(0.3, 0.8)), 0.8
    )
    run.stage("save", lambda: _save_page_layers(run.services, parts))
    _report(run, parts, structure.bar_count, structure)


def _load_pending(db: Database, piece_id: str) -> tuple[PieceStructure, list[dict[str, Any]]]:
    """The piece's stored structure and the parts still without pages (all, on a retry)."""
    rows, meters, marks = db.get_structure(piece_id)
    if not rows:
        raise ValueError("the piece has no play order yet; process the piece first")
    structure = _stored_structure(rows, meters, marks, db.get_short_bars(piece_id))
    return structure, db.list_unrendered_score_files(piece_id)
