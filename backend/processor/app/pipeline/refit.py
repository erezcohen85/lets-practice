import numpy as np

from app.pipeline.align import realign_bars
from app.pipeline.analysis import Analysis, Heard
from app.pipeline.fill import fill_empty_bars, fill_runs_apart
from app.pipeline.models import (
    BarMark,
    MeterChange,
    PlayOrderRow,
    check_size,
    expand_play_order,
)
from app.pipeline.models import Locator as PipelineLocator
from app.pipeline.pulse import MAX_RATIO, MIN_RATIO, round_half_up
from app.pipeline.run_folder import Locator, RunFolderError, TimingLayer
from app.pipeline.structure import PieceStructure, alignment_inputs, short_slots

# A timing as the editor sends it, worked on against what was heard in the recording. One body for
# the real processor and the local server (spikes/ is not in the image, so it lives here). Nothing
# in this file saves anything.

REFIT_BAD = "Re-align failed: {}."

# When Beat This hears a slower pulse than the score (one beat a bar in a fast 3/4: Test,
# 2026-11-07), a bar can only start on a detected beat, so a pickup or a half bar, which starts
# between two of them, has nowhere to go and the fill or re-align fails. Then each gap between
# detected beats is split into the notated beats it holds, and the work is tried once more.
SPLIT_TOLERANCE = 0.25  # how far from a whole number the notated beats per detected beat may be


def check_timing_size(timing: TimingLayer) -> None:
    """Raise RunFolderError, in a sentence, when the timing is larger than any real piece.

    Looked at before any list of slots is made: the work follows the numbers, not the body's size.
    """
    played = sum(row.to - row.from_ + 1 for row in timing.playOrder)
    try:
        check_size(timing.barCount, max(played, len(timing.locators)))
    except ValueError as error:
        raise RunFolderError(str(error)) from None


def structure_of(timing: TimingLayer) -> tuple[PieceStructure, list[PlayOrderRow]]:
    """The timing as the alignment's structure and the rows of its play order."""
    check_timing_size(timing)
    if not timing.meters:
        raise RunFolderError("The timing has no meter, so the bars cannot be counted in beats.")
    if min(meter.fromBar for meter in timing.meters) > 1:
        raise RunFolderError("The first meter must start at bar 1.")
    rows = [PlayOrderRow(start=row.from_, end=row.to) for row in timing.playOrder]
    structure = PieceStructure(
        bar_count=timing.barCount,
        meters=[
            MeterChange(from_bar=m.fromBar, numerator=m.numerator, denominator=m.denominator)
            for m in timing.meters
        ],
        marks=[],
        bar_marks=[BarMark(bar=mark.bar, kind=mark.kind) for mark in timing.marks],
        tempo_text={},
        part_name=None,
        play_order=rows,
        warnings=[],
        short_bars={short.bar: short.units for short in timing.shortBars or []},
    )
    return structure, rows


def realign_inputs(timing: TimingLayer) -> tuple[list[float], set[int], set[int]]:
    """(notated, soft, rit) for the slots of `timing`'s play order, from its meters and marks.

    Worked out on every re-align, so a repeat or meter the user fixed in the editor counts. A bar
    shorter than its meter (the pickup, bar 0) holds a fraction of a beat.
    """
    structure, rows = structure_of(timing)
    try:
        return alignment_inputs(structure, rows)
    except (ValueError, IndexError, KeyError) as error:
        raise RunFolderError(REFIT_BAD.format(str(error).rstrip("."))) from None


def realign_short(timing: TimingLayer) -> set[int]:
    """The slots of `timing`'s play order whose bar is shorter than its meter."""
    structure, rows = structure_of(timing)
    return short_slots(structure, rows)


def pipeline_locators(by_slot: list[Locator | None]) -> list[PipelineLocator | None]:
    """The timing's locators, one per slot, as the alignment takes them."""
    return [
        None
        if item is None
        else PipelineLocator(
            bar=item.bar,
            pass_index=item.passIndex,
            time_sec=item.timeSec,
            confirmed=item.confirmed,
        )
        for item in by_slot
    ]


def refit_locator(old: Locator | None, bar: int, pass_index: int, time_sec: float) -> Locator:
    """The locator at its new time, keeping the flags and checked it had; a new one has none."""
    if old is None:
        return Locator(bar=bar, passIndex=pass_index, timeSec=time_sec, confirmed=False)
    return old.model_copy(update={"timeSec": time_sec})


def before_pickup(
    timing: TimingLayer, notated: list[float], short: set[int]
) -> tuple[list[float], set[int]]:
    """`notated` and `short` with the bar before a pickup holding only the rest of its meter.

    A pickup completes the bar before it: a bar split at a repeat is both halves of one bar of the
    music. It goes by the play order, so a bar is short only the times it leads into a pickup (a
    first ending leads into one by the row after it), and it is derived here, never stored. A bar
    with a short length of its own keeps it, and a short bar that is no pickup changes nothing.
    """
    pickups = {
        item.bar for item in timing.shortBars or [] if item.bar == 0 or item.unnumbered is True
    }
    slots = expand_play_order(
        [PlayOrderRow(start=row.from_, end=row.to) for row in timing.playOrder], timing.barCount
    )
    lengths = list(notated)
    marked = set(short)
    for position, following in enumerate(slots[1:]):
        rest = notated[position] - notated[position + 1]
        if following.bar in pickups and position not in short and rest > 0:
            lengths[position] = rest
            marked.add(position)
    return lengths, marked


def _lengths_to_try(
    timing: TimingLayer, notated: list[float]
) -> list[tuple[list[float], set[int]]]:
    """The bar lengths to work with, best first: with the pickups' bars short, then as written."""
    short = realign_short(timing)
    return [before_pickup(timing, notated, short), (notated, short)]


def fill_timing(timing: TimingLayer, analysis: Analysis) -> TimingLayer:
    """`timing` with a locator added for every slot it can time; the others are not touched.

    One chain through the whole piece when there is one. Otherwise each run of empty slots is
    worked on alone between its neighbours, so a run with no room stays empty and does not stop the
    others. Raises RunFolderError when no slot could be given a time.
    """
    notated, soft, rit = realign_inputs(timing)
    slots = expand_play_order(
        [PlayOrderRow(start=row.from_, end=row.to) for row in timing.playOrder], timing.barCount
    )
    old = {(item.bar, item.passIndex): item for item in timing.locators}
    by_slot = [old.get((slot.bar, slot.pass_index)) for slot in slots]
    heard = analysis.heard
    held = pipeline_locators(by_slot)
    beats = np.asarray(heard.beats)
    choices = _lengths_to_try(timing, notated)
    found, first_error = _fill_on(beats, heard, choices, held, soft, rit)
    empty = sum(item is None for item in by_slot)
    parts = notated_per_heard(beats, notated, [item and item.timeSec for item in by_slot])
    if len(found) < empty and parts is not None:
        again, _ = _fill_on(split_beats(beats, parts), heard, choices, held, soft, rit)
        found = {**again, **found}
    if empty and not found:
        raise RunFolderError(REFIT_BAD.format(str(first_error).rstrip("."))) from None
    locators = [
        item
        if item is not None
        else refit_locator(None, slot.bar, slot.pass_index, found[position])
        for position, (item, slot) in enumerate(zip(by_slot, slots, strict=True))
        if item is not None or position in found
    ]
    return timing.model_copy(update={"locators": locators})


def realign_timing(timing: TimingLayer, analysis: Analysis) -> TimingLayer:
    """`timing` with the unconfirmed locators refit to the audio; confirmed ones are untouched."""
    notated, soft, rit = realign_inputs(timing)
    slots = expand_play_order(
        [PlayOrderRow(start=row.from_, end=row.to) for row in timing.playOrder], timing.barCount
    )
    old = {(item.bar, item.passIndex): item for item in timing.locators}
    by_slot = [old.get((slot.bar, slot.pass_index)) for slot in slots]
    heard = analysis.heard
    beats = np.asarray(heard.beats)
    choices = _lengths_to_try(timing, notated)
    held = pipeline_locators(by_slot)
    starts, first_error = _realign_on(beats, heard, choices, held, soft, rit)
    parts = notated_per_heard(beats, notated, [item and item.timeSec for item in by_slot])
    if starts is None and parts is not None:
        starts, _ = _realign_on(split_beats(beats, parts), heard, choices, held, soft, rit)
    if starts is None:
        raise RunFolderError(REFIT_BAD.format(str(first_error).rstrip("."))) from None
    locators = [
        item
        if item is not None and item.confirmed
        else refit_locator(item, slot.bar, slot.pass_index, start)
        for item, slot, start in zip(by_slot, slots, starts, strict=True)
    ]
    return timing.model_copy(update={"locators": locators})


def _fill_on(
    beats: np.ndarray,
    heard: Heard,
    choices: list[tuple[list[float], set[int]]],
    held: list[PipelineLocator | None],
    soft: set[int],
    rit: set[int],
) -> tuple[dict[int, float], ValueError | None]:
    """The fill on `beats`: one chain through the piece, else each run of empty slots alone.

    Returns the times found by slot and the first error of the chain (None when a chain worked).
    """
    first_error: ValueError | None = None
    for lengths, short in choices:
        try:
            found = fill_empty_bars(
                heard.beat_logits,
                heard.downbeat_logits,
                beats,
                lengths,
                held,
                soft,
                rit,
                heard.fps,
                short,
            )
            return found, None
        except ValueError as error:
            first_error = first_error or error
    found = fill_runs_apart(
        heard.beat_logits, heard.downbeat_logits, beats, choices, held, soft, rit, heard.fps
    )
    return found, first_error


def _realign_on(
    beats: np.ndarray,
    heard: Heard,
    choices: list[tuple[list[float], set[int]]],
    held: list[PipelineLocator | None],
    soft: set[int],
    rit: set[int],
) -> tuple[list[float] | None, ValueError | None]:
    """The re-align on `beats` under the first bar lengths that fit; else None, the first error."""
    first_error: ValueError | None = None
    for lengths, short in choices:
        try:
            starts = realign_bars(
                heard.beat_logits,
                heard.downbeat_logits,
                beats,
                lengths,
                held,
                soft,
                rit,
                heard.fps,
                short,
            )
            return starts, None
        except ValueError as error:
            first_error = first_error or error
    return None, first_error


def notated_per_heard(
    beats: np.ndarray, notated: list[float], times: list[float | None]
) -> int | None:
    """How many notated beats one detected beat holds, when that is a whole number from MIN_RATIO
    to MAX_RATIO (within SPLIT_TOLERANCE), else None.

    Measured where the map has times: the notated beats from its first timed slot to its last, over
    the seconds between them, against the median gap between detected beats. None with fewer than
    two timed slots or two beats, or when no time passes between them.
    """
    timed = [(slot, time) for slot, time in enumerate(times) if time is not None]
    if len(timed) < 2 or len(beats) < 2:
        return None
    (first, start), (last, end) = timed[0], timed[-1]
    held = sum(notated[first:last])
    if end <= start or held <= 0:
        return None
    ratio = float(np.median(np.diff(beats))) / ((end - start) / held)
    whole = round_half_up(ratio)
    if not MIN_RATIO <= whole <= MAX_RATIO or abs(ratio - whole) > SPLIT_TOLERANCE:
        return None
    return whole


def split_beats(beats: np.ndarray, parts: int) -> np.ndarray:
    """`beats` with each gap between two of them split into `parts` even steps."""
    steps = np.diff(beats)
    inner = [beats[:-1] + steps * part / parts for part in range(1, parts)]
    return np.sort(np.concatenate([beats, *inner]))
