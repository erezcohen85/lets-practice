import statistics
from typing import Literal

import numpy as np

from app.pipeline.models import (
    BarMark,
    MeterChange,
    PlayOrderRow,
    PlaySlot,
    ReviewFlag,
    UncertainLine,
)
from app.pipeline.omr import DEFAULT_METER

# Flags the bars whose timing looks wrong, for the Review Queue: a bar much shorter or longer than
# its neighbours, a different number of beats heard than notated, a weak downbeat. A fermata or a
# rit. mark on the bar explains a long bar, extra beats or (rit. only) a crowded bar, each within
# its plausibility cap (severity 0) when the audio is sure of both bar lines. The rules are the
# proof of concept's (spikes/viewer_data.py on poc-beat-viewer), minus the flags the product does
# not have, with three changes the spike report's answer keys asked for. A rit. mark stands for a
# rit., rall. or accel. span alike, so it may explain a crowded bar as well as a long one.
#
# - A beat count that differs from the notated one is a doubt only when the audio is not sure of
#   a bar line, the bar's length is odd too, or the bar sits beside a fermata bar (whose free
#   length can hide a slip of the chain): with both lines on strong downbeats and a regular
#   length, a missed beat in a long note says nothing about where the bar starts.
# - A weak downbeat on every other bar is the detector hearing the bars in pairs (a 2/4 piece
#   read as 4/4); the weak start between two strong ones, repeated two bars on, is not a doubt.
# - When the next bars have a second reading of the downbeat nearly as strong as the chosen one,
#   a few beats away, the first bar of that run says so; the bars after it follow the answer.
# - A bar shorter than its meter (a pickup, an incomplete bar) is judged by its own length: it has
#   no beat count and no downbeat to be weak. The pickup (bar 0) is flagged "pickup" when only one
#   reading of the score called it one, or when no beat in the recording lies near its start.

ExplainedBy = Literal["fermata", "rit"]

EARLY = 0.07  # a beat this far before a bar start still belongs to that bar
SNAP = 2  # frames either side of a bar start to look for the downbeat
NEIGHBOURS = 3  # slots either side that set the tempo reference
LAST_BAR_LOOKBACK = 4  # previous slots that set the length of the last slot
CROWDED = 0.75
CROWDED_SEVERE = 0.55
STRETCHED = 1.35
STRETCHED_SEVERE = 1.8
WEAK_DOWNBEAT = 0.3
FERMATA_STRETCH = 3.0  # a fermata bar may be this many times longer than its neighbours
FERMATA_BEATS = 2  # a fermata bar may have this many times its notated beats heard
RIT_STRETCH = 1.8  # a bar in a rit. span may be this many times longer than its neighbours
RIT_CROWD = 0.6  # ...or, for an accel., this fraction of their length
BAR_LINE_CONF = 0.5  # the audio must be at least this sure of both bar lines to explain a flag
OTHER_WINDOW = 4  # bars, from the one judged, whose downbeats a second reading is compared on
OTHER_MIN = 3  # fewer bars than this say too little about a second reading
OTHER_RATIO = 0.85  # a second reading this fraction as strong as the chosen one is a doubt
OTHER_FLOOR = 0.6  # ...if it is itself a downbeat: mean probability at least this
PICKUP_SURE = 2  # readings of the score that must agree for a pickup to go unquestioned
PICKUP_NEAR = 0.5  # a beat within this share of the pickup's length of its start supports it...
PICKUP_SLACK_SEC = 0.06  # ...and at least this many seconds either side


def review_flags(
    slots: list[PlaySlot],
    times: list[float],
    recording_end: float,
    meters: list[MeterChange],
    marks: list[BarMark],
    activation: np.ndarray,
    fps: float,
    beats: list[float] | None,
    short_bars: dict[int, int] | None = None,
    pickup_sources: int = PICKUP_SURE,
) -> list[list[ReviewFlag]]:
    """One list of flags per slot; `times` holds one strictly increasing start per slot.

    `short_bars` maps a bar to the notes of its meter's denominator it holds when it is shorter
    than the meter; `pickup_sources` is how many readings of the score called bar 0 a pickup.
    """
    if len(slots) != len(times):
        raise ValueError(f"{len(slots)} slots but {len(times)} times")
    short = short_bars or {}
    notated = [short.get(slot.bar, _notated_beats(slot, meters)) for slot in slots]
    ends = _ends(times, notated, recording_end)
    units = [(end - start) / count for start, end, count in zip(times, ends, notated, strict=True)]
    fermatas = {mark.bar for mark in marks if mark.kind == "fermata"}
    rits = {mark.bar for mark in marks if mark.kind == "rit"}
    beat_times = None if beats is None else np.asarray(beats, dtype=float)
    confs = [_downbeat_conf(activation, fps, start) for start in times]
    others = _other_readings(slots, times, units, notated, fermatas, activation, fps, confs)

    result: list[list[ReviewFlag]] = []
    for i, slot in enumerate(slots):
        start, end, count = times[i], ends[i], notated[i]
        # (flag, what in the score could explain it)
        found: list[tuple[ReviewFlag, ExplainedBy | None]] = []

        ref = _reference(units, i)
        if ref is not None and ref > 0:
            ratio = units[i] / ref
            kind = "crowded" if ratio < CROWDED else "stretched" if ratio > STRETCHED else None
            if kind is not None:
                severe = ratio < CROWDED_SEVERE if kind == "crowded" else ratio > STRETCHED_SEVERE
                flag = ReviewFlag(
                    kind=kind,
                    severity=2 if severe else 1,
                    expected=ref * count,
                    found=end - start,
                    factor=ratio,
                )
                found.append((flag, _reason_for_length(kind, ratio, slot.bar, fermatas, rits)))
        # the audio's bar lines of this slot; the last one's end was projected, not heard
        lines = [(start, confs[i])]
        if i + 1 < len(slots):
            lines.append((times[i + 1], confs[i + 1]))
        weak = min(
            (line for line in lines if line[1] < BAR_LINE_CONF), key=lambda x: x[1], default=None
        )
        is_short = slot.bar in short
        if beat_times is not None and not is_short:
            detected = int(
                np.count_nonzero((beat_times >= start - EARLY) & (beat_times < end - EARLY))
            )
            reason = _reason_for_beats(detected, count, slot.bar, fermatas, rits)
            # nothing else odd about the bar and both lines sure: a missed or extra beat inside
            doubtful = bool(found) or weak is not None or reason is not None
            if detected != count and (doubtful or _beside_held_bar(slots, i, fermatas)):
                flag = ReviewFlag(
                    kind="beat-count",
                    severity=1 if abs(detected - count) == 1 else 2,
                    expected=count,
                    found=detected,
                    factor=None,
                )
                found.append((flag, reason))
        if confs[i] < WEAK_DOWNBEAT and not is_short and not _heard_in_pairs(confs, i):
            flag = ReviewFlag(
                kind="weak-downbeat",
                severity=1,
                expected=WEAK_DOWNBEAT,
                found=confs[i],
                factor=None,
            )
            found.append((flag, None))

        flags = [
            flag if reason is None else _explained(flag, reason, weak) for flag, reason in found
        ]
        if slot.bar == 0 and 0 in short:
            doubt = _pickup_doubt(start, end - start, beat_times, pickup_sources)
            if doubt is not None:
                flags.append(doubt)
        if i in others:
            flags.append(others[i])
        result.append(flags)
    return result


def _pickup_doubt(
    start: float, length: float, beat_times: np.ndarray | None, sources: int
) -> ReviewFlag | None:
    """A flag when the readings of the score do not agree that bar 0 is a pickup, or when no
    detected beat lies near where it starts (None without detected beats to judge by)."""
    if sources < PICKUP_SURE:
        return ReviewFlag(
            kind="pickup", severity=1, expected=PICKUP_SURE, found=sources, factor=None
        )
    if beat_times is None:
        return None
    near = np.abs(beat_times - start) <= max(PICKUP_NEAR * length, PICKUP_SLACK_SEC)
    if near.any():
        return None
    return ReviewFlag(
        kind="pickup", severity=1, expected=PICKUP_SURE, found=PICKUP_SURE, factor=None
    )


def skipped_repeat_bars(written: list[PlayOrderRow], played: list[PlayOrderRow]) -> set[int]:
    """The played bars where the score goes back and the recording carries on: the bar of the
    repeat sign, or the last bar before a 1st ending the recording left out."""
    still_jumps = {row.end for row in played[:-1]}
    bars = [bar for row in played for bar in range(row.start, row.end + 1)]
    return {
        max(bar for bar in bars if bar <= row.end)
        for row in written[:-1]
        if row.end not in still_jumps and any(bar <= row.end for bar in bars)
    }


def is_checked(flags: list[ReviewFlag]) -> bool:
    """True when there are flags and the score explains every one of them."""
    return bool(flags) and all(flag.severity == 0 for flag in flags)


def _beside_held_bar(slots: list[PlaySlot], index: int, fermatas: set[int]) -> bool:
    """True when the slot before or after is a fermata bar, whose length the chain may bend."""
    return any(0 <= k < len(slots) and slots[k].bar in fermatas for k in (index - 1, index + 1))


def _heard_in_pairs(confs: list[float], index: int) -> bool:
    """True when the weak start sits between strong ones and the pattern repeats two bars on.

    The downbeat detector groups the bars of some pieces in twos: strong, weak, strong, weak. A
    single weak start among strong ones, or a run of weak ones, is not that.
    """
    around = [confs[k] for k in (index - 1, index + 1) if 0 <= k < len(confs)]
    repeats = [confs[k] for k in (index - 2, index + 2) if 0 <= k < len(confs)]
    return (
        bool(around)
        and all(conf >= BAR_LINE_CONF for conf in around)
        and any(conf < WEAK_DOWNBEAT for conf in repeats)
    )


def _other_readings(
    slots: list[PlaySlot],
    times: list[float],
    units: list[float],
    notated: list[int],
    fermatas: set[int],
    activation: np.ndarray,
    fps: float,
    confs: list[float],
) -> dict[int, ReviewFlag]:
    """For the first bar of each run of doubt, a flag when another phase reads nearly as strong.

    Bars shifted by the same number of beats, fewer than a bar either way, make a second chain.
    Its downbeat probabilities over the next few bars are compared with the chosen chain's. A
    held bar ends the window (its length says nothing about the beats after it) and cannot start
    one. Only the first bar of a run is flagged: the bars after it share the one question, and
    fixing the first moves them.
    """
    flags: dict[int, ReviewFlag] = {}
    after_run = True
    for i in range(len(slots)):
        found = _other_reading(i, slots, times, units, notated, fermatas, activation, fps, confs)
        if found is not None and after_run:
            flags[i] = found
        after_run = found is None
    return flags


def _other_reading(
    index: int,
    slots: list[PlaySlot],
    times: list[float],
    units: list[float],
    notated: list[int],
    fermatas: set[int],
    activation: np.ndarray,
    fps: float,
    confs: list[float],
) -> ReviewFlag | None:
    window = []
    for k in range(index, min(index + OTHER_WINDOW, len(slots))):
        if slots[k].bar in fermatas:
            break
        window.append(k)
    if len(window) < OTHER_MIN:
        return None
    chosen = statistics.fmean(confs[k] for k in window)
    best_strength, best_shift = 0.0, 0
    for shift in range(1 - min(notated[k] for k in window), min(notated[k] for k in window)):
        if shift == 0 or times[index] + shift * units[index] < 0:
            continue  # a reading that starts the bar before the recording is no reading
        strength = statistics.fmean(
            _downbeat_conf(activation, fps, times[k] + shift * units[k]) for k in window
        )
        if strength > best_strength:
            best_strength, best_shift = strength, shift
    if best_strength < OTHER_FLOOR or best_strength < OTHER_RATIO * chosen:
        return None
    return ReviewFlag(
        kind="other-downbeat",
        severity=1,
        expected=chosen,
        found=best_strength,
        factor=best_strength / chosen,
        uncertain_line=UncertainLine(
            time_sec=times[index] + best_shift * units[index], confidence=best_strength
        ),
    )


def _reason_for_length(
    kind: str, ratio: float, bar: int, fermatas: set[int], rits: set[int]
) -> ExplainedBy | None:
    """What explains a bar that is too long or too short, within the caps; a fermata first."""
    if kind == "stretched":
        if bar in fermatas and ratio <= FERMATA_STRETCH:
            return "fermata"
        if bar in rits and ratio <= RIT_STRETCH:
            return "rit"
    elif bar in rits and ratio >= RIT_CROWD:
        return "rit"
    return None


def _reason_for_beats(
    detected: int, notated: int, bar: int, fermatas: set[int], rits: set[int]
) -> ExplainedBy | None:
    """What explains a beat count that is not the notated one; a fermata first."""
    if bar in fermatas and detected <= FERMATA_BEATS * notated:
        return "fermata"
    if bar in rits and abs(detected - notated) <= notated:
        return "rit"
    return None


def _explained(
    flag: ReviewFlag, reason: ExplainedBy, weak: tuple[float, float] | None
) -> ReviewFlag:
    """The score explains the flag when the audio is sure of both bar lines, else only partly."""
    if weak is None:
        return flag.model_copy(update={"severity": 0, "explained_by": reason})
    time_sec, confidence = weak
    return flag.model_copy(
        update={
            "severity": 1,
            "explained_by": reason,
            "uncertain_line": UncertainLine(time_sec=time_sec, confidence=confidence),
        }
    )


def _notated_beats(slot: PlaySlot, meters: list[MeterChange]) -> int:
    """The numerator of the meter in force at the slot's bar (4/4 before any change)."""
    meter = DEFAULT_METER
    for change in sorted(meters, key=lambda change: change.from_bar):
        if change.from_bar > slot.bar:
            break
        meter = change
    return meter.numerator


def _ends(times: list[float], notated: list[int], recording_end: float) -> list[float]:
    """Each slot ends where the next starts; the last runs its beats at the recent tempo."""
    ends = times[1:]
    last = len(times) - 1
    before = range(max(0, last - LAST_BAR_LOOKBACK), last)
    if before:
        unit = statistics.median((times[k + 1] - times[k]) / notated[k] for k in before)
        ends.append(min(times[last] + notated[last] * unit, recording_end))
    else:
        ends.append(recording_end)
    return ends


def _reference(units: list[float], index: int) -> float | None:
    """Median seconds per beat of the slots either side, in play order, not the slot itself."""
    near = units[max(0, index - NEIGHBOURS) : index] + units[index + 1 : index + 1 + NEIGHBOURS]
    return statistics.median(near) if near else None


def _downbeat_conf(activation: np.ndarray, fps: float, time_sec: float) -> float:
    """The strongest downbeat probability within SNAP frames of the time; 0 outside the signal."""
    frame = round(time_sec * fps)
    if frame + SNAP < 0:  # before the recording: a negative slice end would read its far end
        return 0.0
    window = activation[max(0, frame - SNAP) : frame + SNAP + 1]
    return float(window.max()) if len(window) else 0.0
