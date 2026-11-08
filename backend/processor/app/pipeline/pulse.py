import math
from collections.abc import Sequence
from typing import NamedTuple

# The pulse check: does the beat tracker hear the same pulse as the score? A fast 3/4 is heard one
# beat a bar: the alignment still finds its bar lines, but they land on every third beat and the
# beat marks of the app disagree with the bars. This counts the detected beats inside the music
# (from the first bar line of the map to the end of its last bar), shares them among the slots of
# an order of play, and says when that is a whole number other than the score's beats per bar.
# Counting beats, not seconds over a tempo, keeps a slow start, a pause or a count-in from making
# a pulse. The map is not touched; the Editor can put the bar lines on the beats once the user
# has been told. A mismatch is only reported when the heard pulse is a whole number of times the
# score's, faster or slower (half-time, double-time, three to a beat): a 4/4 heard at 3 a bar is
# the tracker's slip, not a pulse the bar lines can be put on.

PULSE_TOLERANCE = 0.12  # how far from a whole number the beats per bar may be and still count
MAX_PULSE = 6  # a heard pulse above this is a slip of the tracker, not a pulse to offer
MIN_RATIO = 2  # the heard pulse and the score's differ by a whole number from this ...
MAX_RATIO = 6  # ... to this, one way or the other
EDGE_SEC = 0.04  # a beat this close outside the music is its own (the alignment's edge slack)
_FLOAT_SLACK = 1e-9  # 1.12 - 1 is 0.12000000000000011: the tolerance is meant to be inclusive


def round_half_up(value: float) -> int:
    """The nearest whole number, a half going up (2.5 is 3), as the app's card rounds it.

    Python's round() sends a half to the even number (2.5 is 2), which would make the warning say
    another number than the card does.
    """
    return math.floor(value + 0.5)


class HeardPulse(NamedTuple):
    """What the recording gives a bar (not rounded) and what the score gives the same order."""

    heard: float
    expected: float


def heard_beats_per_bar(
    beat_times: Sequence[float], start_sec: float, end_sec: float, slots: int
) -> float | None:
    """The detected beats inside the music, shared among the `slots` of one order of play.

    The music runs from `start_sec` (the map's first bar line) to `end_sec` (where its last bar
    ends, often on the last beat itself); a beat before or after it, a count-in or applause, does
    not count. None without at least two beats inside or without a slot.
    """
    inside = sum(1 for beat in beat_times if start_sec - EDGE_SEC <= beat <= end_sec + EDGE_SEC)
    if inside < 2 or slots < 1:
        return None
    return inside / slots


def pulse_mismatch(heard: float | None, score_beats_per_bar: float) -> int | None:
    """round_half_up(heard) when heard is within PULSE_TOLERANCE of a whole number 1..6 that differs
    from the score's beats per bar (rounded half up) by a whole number of times, else None.

    The ratio between the two pulses has to be musical: the heard pulse is MIN_RATIO to MAX_RATIO
    times the score's, or the score's is that many times the heard one (see `_musical_ratio`).
    """
    if heard is None:
        return None
    whole = round_half_up(heard)
    if abs(heard - whole) > PULSE_TOLERANCE + _FLOAT_SLACK:
        return None
    if not 1 <= whole <= MAX_PULSE:
        return None
    score = round_half_up(score_beats_per_bar)
    if whole == score or not _musical_ratio(whole, score):
        return None
    return whole


def mismatched_pulse(
    beat_times: Sequence[float],
    start_sec: float,
    end_sec: float,
    *,
    written: Sequence[float],
    played: Sequence[float],
) -> HeardPulse | None:
    """The pulse to report when the recording's is not the score's, else None.

    `written` and `played` hold the score's beats of each slot of the written order of play and of
    the one the map keeps (the same list when the recording plays every repeat); the score's beats
    per bar of an order is their mean. The recording is first heard over the played order:
    within PULSE_TOLERANCE of the score's mean, the pulse is right, whatever the repeats do to the
    written count. Otherwise the written order is tried, then the played one, and the first whose
    heard pulse is a `pulse_mismatch` is reported.
    """
    played_heard = heard_beats_per_bar(beat_times, start_sec, end_sec, len(played))
    if played_heard is not None and _near(played_heard, _mean(played)):
        return None
    orders = [written] if list(written) == list(played) else [written, played]
    for order in orders:
        heard = heard_beats_per_bar(beat_times, start_sec, end_sec, len(order))
        if heard is not None and pulse_mismatch(heard, _mean(order)) is not None:
            return HeardPulse(heard, _mean(order))
    return None


def _mean(beats: Sequence[float]) -> float:
    return sum(beats) / len(beats)


def _near(heard: float, expected: float) -> bool:
    return abs(heard - expected) <= PULSE_TOLERANCE + _FLOAT_SLACK


def _musical_ratio(heard: int, score: int) -> bool:
    """True when one pulse is a whole number (MIN_RATIO to MAX_RATIO) of times the other: 1 against
    3 or 4 against 2, not 3 against 4 or 2 against 3. The pulses are the whole numbers the card
    shows, so the ratio is as exact as they are."""
    if heard < 1 or score < 1:
        return False
    larger, smaller = max(heard, score), min(heard, score)
    return larger % smaller == 0 and MIN_RATIO <= larger // smaller <= MAX_RATIO
