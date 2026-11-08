from collections.abc import Collection, Sequence
from dataclasses import dataclass

import numpy as np

from app.pipeline.models import Locator

# Score-informed downbeat alignment: choose exactly N downbeat times from an activation curve so
# that they fit the notated meters and keep a smooth tempo. Dynamic programming over candidate
# peaks with a second-order state (current and previous candidate), so the tempo term sees two
# consecutive bar durations.

BEAM_WIDTH = 10
"""Best predecessors kept per candidate and slot (the beam). A candidate with no more than this many
in its window is searched exactly; on the noisy synthetic fixtures 10 gave the same path and score
as a beam of 400, and 30 took about twice as long."""

_EPS = 1e-3  # added to the activation before the log, so a zero frame costs about -6.9, not -inf
_TOL = 1e-9  # seconds of slack on the interval limits
_NO_PATH = "no valid alignment: {}"


class NoAlignmentError(ValueError):
    """No chain of slots fits this recording, though the input itself is fine."""


@dataclass(frozen=True)
class AlignParams:
    fps: float = 50.0  # activation frames per second
    min_bar_sec: float = 0.4  # per 4/4 bar (scaled by bar length in whole notes)
    max_bar_sec: float = 8.0
    tempo_weight: float = 4.0  # penalty on log tempo change between consecutive bars
    candidate_threshold: float = 0.05  # candidates = local maxima above this (plus anchors)


def align_downbeats(
    activation: np.ndarray,
    bar_lengths: list[float],
    params: AlignParams = AlignParams(),  # noqa: B008
    anchors: dict[int, float] | None = None,
) -> list[float]:
    """Exactly len(bar_lengths) strictly increasing downbeat times (seconds), best by the score.

    `bar_lengths[i]` is slot i's length in whole notes (4/4 is 1.0, 3/4 is 0.75). The score is the
    sum of log(activation + eps) at the chosen peaks minus `tempo_weight` times the sum of squared
    changes in log tempo between consecutive bars (tempo = bar length / bar duration). `anchors`
    maps a 0-based slot to a time the slot must have, exactly, even off a local maximum. Raises
    ValueError when no path satisfies the interval limits and the anchors.
    """
    values = np.asarray(activation, dtype=np.float64)
    if values.ndim != 1:
        raise ValueError(f"activation must be 1-D, got {values.ndim}-D")
    _check_params(params)
    lengths = np.asarray(bar_lengths, dtype=np.float64)
    if lengths.size and not np.all(np.isfinite(lengths) & (lengths > 0)):
        raise ValueError("bar_lengths must be positive and finite")
    slots = lengths.size
    fixed = _check_anchors(anchors or {}, slots)
    if slots == 0:
        return []

    times, scores = _candidates(values, params, fixed)
    if times.size == 0:
        raise ValueError(_NO_PATH.format("no candidate downbeats"))
    forced = {slot: int(np.searchsorted(times, t)) for slot, t in fixed.items()}
    path = _best_path(times, scores, lengths, params, forced)
    found = [float(times[c]) for c in path]
    for slot, t in fixed.items():
        found[slot] = float(t)
    return found


def realign(
    activation: np.ndarray,
    bar_lengths: list[float],
    locators_by_slot: list[Locator | None],
    params: AlignParams = AlignParams(),  # noqa: B008
) -> list[float]:
    """Refit the unconfirmed slots of a map; the confirmed locators are fixed anchors.

    `locators_by_slot` has one entry per slot of `bar_lengths` (None where a slot has no locator).
    A confirmed locator keeps its `time_sec`, returned unchanged; an unconfirmed locator's old time
    is ignored. With every slot confirmed the times come back as they are, with no search and no
    check of the interval limits. Raises ValueError when the lengths differ, or when the confirmed
    times are not finite and increasing, or when no alignment fits between them.
    """
    slots = len(bar_lengths)
    if len(locators_by_slot) != slots:
        raise ValueError(f"{len(locators_by_slot)} locators for {slots} slots")
    anchors = {
        slot: locator.time_sec
        for slot, locator in enumerate(locators_by_slot)
        if locator is not None and locator.confirmed
    }
    if len(anchors) == slots:
        return list(_check_anchors(anchors, slots).values())
    return align_downbeats(activation, bar_lengths, params, anchors)


def _check_params(params: AlignParams) -> None:
    if params.fps <= 0:
        raise ValueError("fps must be positive")
    if not 0 < params.min_bar_sec <= params.max_bar_sec:
        raise ValueError("bar limits must satisfy 0 < min_bar_sec <= max_bar_sec")
    if params.tempo_weight < 0:
        raise ValueError("tempo_weight must not be negative")


def _check_anchors(anchors: dict[int, float], slots: int) -> dict[int, float]:
    """The anchors by ascending slot; every slot must exist and the times must increase."""
    ordered: dict[int, float] = {}
    for slot in sorted(anchors):
        if not 0 <= slot < slots:
            raise ValueError(f"anchor on slot {slot}, but there are slots 0-{slots - 1}")
        if not np.isfinite(anchors[slot]):
            raise ValueError(f"anchor on slot {slot} has a non-finite time")
        ordered[slot] = float(anchors[slot])
    anchor_times = list(ordered.values())
    if any(b <= a for a, b in zip(anchor_times, anchor_times[1:], strict=False)):
        raise ValueError("anchors out of time order")
    return ordered


def _candidates(
    values: np.ndarray, params: AlignParams, anchors: dict[int, float]
) -> tuple[np.ndarray, np.ndarray]:
    """Sorted candidate times and their log scores: refined local maxima plus the anchor times."""
    fps = params.fps
    padded = np.concatenate([[-np.inf], values, [-np.inf]])
    # a flat top counts at its first frame; the array edges can hold peaks
    peaks = np.flatnonzero(
        (values > params.candidate_threshold) & (values > padded[:-2]) & (values >= padded[2:])
    )
    peak_times = (peaks + _parabola_offset(values, peaks)) / fps
    peak_values = values[peaks]

    anchor_times = np.array(list(anchors.values()), dtype=np.float64)
    if values.size:
        frames = np.clip(np.rint(anchor_times * fps), 0, values.size - 1).astype(int)
        anchor_values = values[frames]
    else:
        anchor_values = np.zeros(anchor_times.shape)

    times = np.concatenate([peak_times, anchor_times])
    activation = np.concatenate([peak_values, anchor_values])
    times, first = np.unique(times, return_index=True)
    return times, np.log(activation[first] + _EPS)


def _parabola_offset(values: np.ndarray, frames: np.ndarray) -> np.ndarray:
    """Sub-frame shift (-0.5..0.5 frames) of each peak from a parabola through its 3 samples."""
    offset = np.zeros(frames.size)
    inner = (frames > 0) & (frames < values.size - 1)
    f = frames[inner]
    left, mid, right = values[f - 1], values[f], values[f + 1]
    curvature = left - 2.0 * mid + right
    bent = curvature < 0
    shift = 0.5 * (left - right) / np.where(bent, curvature, 1.0)
    offset[inner] = np.where(bent, np.clip(shift, -0.5, 0.5), 0.0)
    return offset


def _windows(
    times: np.ndarray, length: float, params: AlignParams
) -> tuple[np.ndarray, np.ndarray, int]:
    """For each candidate, the candidates that may start a bar of `length` ending there.

    Returns (index matrix, valid mask, width): row n lists the sorted candidates whose distance
    before n is within [min_bar_sec, max_bar_sec] x length.
    """
    count = times.size
    lo = np.searchsorted(times, times - params.max_bar_sec * length - _TOL, side="left")
    hi = np.searchsorted(times, times - params.min_bar_sec * length + _TOL, side="right")
    hi = np.minimum(hi, np.arange(count))  # strictly earlier than the candidate itself
    hi = np.maximum(hi, lo)
    width = int((hi - lo).max())
    if width == 0:
        raise ValueError(_NO_PATH.format("no two candidates are a bar apart"))
    idx = lo[:, None] + np.arange(width)[None, :]
    valid = idx < hi[:, None]
    return np.minimum(idx, count - 1), valid, width


def _top_k(matrix: np.ndarray, k: int) -> np.ndarray:
    """Column indices of the (up to) k largest entries of each row."""
    if matrix.shape[1] <= k:
        return np.broadcast_to(np.arange(matrix.shape[1]), matrix.shape)
    return np.argpartition(-matrix, k - 1, axis=1)[:, :k]


def _best_path(
    times: np.ndarray,
    scores: np.ndarray,
    lengths: np.ndarray,
    params: AlignParams,
    forced: dict[int, int],
) -> list[int]:
    """Candidate index of each slot on the best path.

    State at slot i: (candidate c, previous candidate p), stored per c as up to BEAM_WIDTH best
    predecessors with their score and the log tempo of the bar p -> c. Extending to slot i+1 adds
    the next candidate's score and the tempo penalty between bar i - 1 and bar i.
    """
    count, slots = times.size, lengths.size
    weight = params.tempo_weight

    def slot_scores(slot: int) -> np.ndarray:
        if slot not in forced:
            return scores
        only = np.full(count, -np.inf)
        only[forced[slot]] = scores[forced[slot]]
        return only

    if slots == 1:
        best = int(np.argmax(slot_scores(0)))
        if not np.isfinite(slot_scores(0)[best]):
            raise ValueError(_NO_PATH.format("no candidate for the only bar"))
        return [best]

    # slot 1: previous candidates in the window of bar 0, no tempo term yet
    idx, valid, _ = _windows(times, float(lengths[0]), params)
    first = np.where(valid, slot_scores(0)[idx], -np.inf) + slot_scores(1)[:, None]
    keep = _top_k(first, BEAM_WIDTH)
    score = np.take_along_axis(first, keep, axis=1)
    prev = np.take_along_axis(idx, keep, axis=1)
    back = np.zeros(prev.shape, dtype=np.int16)
    score, prev, log_tempo = _finish_slot(times, score, prev, float(lengths[0]))
    prevs: list[np.ndarray | None] = [None, prev]  # per slot: previous candidate of each state
    backs: list[np.ndarray | None] = [None, back]  # per slot: that state's index one slot back

    for slot in range(1, slots - 1):
        length = float(lengths[slot])
        idx, valid, width = _windows(times, length, params)
        valid &= np.isfinite(score).any(axis=1)[idx]  # skip pairs whose earlier end is unreachable
        counts = valid.sum(axis=1)
        if not counts.any():
            raise ValueError(_NO_PATH.format(f"slot {slot + 1} cannot be reached"))
        rows = np.repeat(np.arange(count), counts)
        cur = idx[valid]
        new_tempo = np.log(length / (times[rows] - times[cur]))
        # score - w (x - l)^2 = (score - w l^2) + 2 w l x - w x^2, the last term shared by a pair
        offset = score - weight * log_tempo**2
        slope = 2.0 * weight * log_tempo
        step = np.take(offset, cur, axis=0) + new_tempo[:, None] * np.take(slope, cur, axis=0)
        best_k = step.argmax(axis=1)
        best = step[np.arange(rows.size), best_k] - weight * new_tempo**2
        grid = np.full((count, width), -np.inf)
        grid[valid] = best
        grid += slot_scores(slot + 1)[:, None]
        which = np.zeros((count, width), dtype=np.int16)
        which[valid] = best_k
        keep = _top_k(grid, BEAM_WIDTH)
        score = np.take_along_axis(grid, keep, axis=1)
        prev = np.take_along_axis(idx, keep, axis=1)
        back = np.take_along_axis(which, keep, axis=1)
        score, prev, log_tempo = _finish_slot(times, score, prev, length)
        prevs.append(prev)
        backs.append(back)

    last = int(np.argmax(score))
    cand, k = divmod(last, score.shape[1])
    if not np.isfinite(score[cand, k]):
        raise ValueError(_NO_PATH.format("no chain of bars fits the interval limits"))
    path = [cand]
    for slot in range(slots - 1, 0, -1):
        previous, k = int(prevs[slot][cand, k]), int(backs[slot][cand, k])
        path.append(previous)
        cand = previous
    return path[::-1]


def _finish_slot(
    times: np.ndarray, score: np.ndarray, prev: np.ndarray, length: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Mark dead states (prev = -1) and give each live one the log tempo of its last bar."""
    alive = np.isfinite(score)
    if not alive.any():
        raise ValueError(_NO_PATH.format("no chain of bars fits the interval limits"))
    duration = np.where(alive, times[:, None] - times[np.where(alive, prev, 0)], 1.0)
    log_tempo = np.where(alive, np.log(length / duration), 0.0)
    return score, np.where(alive, prev, -1), log_tempo


# --- Bars from the beats and the score -----------------------------------------------------------
# The PoC's "Automatic from PDF" alignment. Unlike the downbeat DP above it does not pick peaks of
# one curve: it works on slots (0-based positions of the expanded play order) that each know their
# beat count from the score, and a slot is an edge between two candidate times, where it starts and
# where the next slot starts. The best chain of edges maximizes
#
#     downbeat logit at each slot start
#   + COMB_W * beat logits at the slot's evenly spaced inner beats (the "comb")
#   - a cost on the change of beat period against the previous slot
#
# so a rit. (gradual) is cheap and a sudden halving or doubling is expensive. Lost or doubled beats
# cannot shift the slot labels, because the score, not the detected beats, says how many there are.
# Fermata slots ("soft") may stretch, rit. slots pay less for a tempo change, and a hard limit stops
# every other change. Slots between two elastic ones that hold an anchor are locked to their notated
# beat count, so a pinned slot keeps its bar phase through the stretch around it.

TEMPO_W = 10.0  # cost of a tempo jump, per unit of |log ratio| (10% change ~ 1, doubling ~ 7)
SOFT_TEMPO_W = 1.0
RIT_TEMPO_W = 3.0
FERMATA_MIN = 0.6
FERMATA_MAX = 2.5
TEMPO_LIMIT = (0.75, 1.33)  # hard limit on the beat-period ratio between consecutive slots
# likewise into or out of a rit. or accel. slot; 1.75 and not 1.67 because a real rit. bar took a
# 1.71 step in the beat period
RIT_LIMIT = (0.6, 1.75)
LOCK_W = 100.0  # cost per detected beat a locked slot holds more or less than it notates
LOCK_EARLY = 0.1  # seconds; a beat this far before a slot start still belongs to that slot
COMB_W = 1.0
SKIP_W = 1.0  # cost per detected beat left before slot 0
# seconds per beat; the limits of a normal tempo, widened to the recording's own by `tempo_limits`
MIN_PERIOD, MAX_PERIOD, MAX_SOFT_PERIOD = 0.25, 1.5, 3.0
# a slot's beat may last this many times the median detected beat: Beat This may track the eighths
# of a notated beat of three (6/8), or a slow piece one beat in two
PERIOD_SPAN = 4.0
ABS_PERIOD = (0.1, 6.0)  # seconds per beat; far outside music, whatever the recording says
# a stretch with no detected beat for this many bars (of the shortest slot's notated beats at the
# median detected beat) is a hole that one ordinary bar cannot explain: the player broadened a bar
# and Beat This missed its beats. A slot that covers (almost all of) one may change the beat
# period like a rit. slot (RIT_LIMIT, RIT_TEMPO_W), and so may the slot after it.
HOLE_BARS = 1.4
HOLE_COVER = 0.8
SNAP = 2  # frames either side of a time to look for the logit peak
CLIP = 4.0  # logits beyond +-CLIP add nothing to the comb
ANCHOR_SNAP = 0.03  # seconds; a candidate this close to an anchor is replaced by the anchor time

_PEAK_FLOOR = -2.0  # a logit peak below this is not a candidate
_NEW_PEAK_GAP = 0.08  # seconds; a logit peak this far from every detected beat is a candidate too
_TAIL_BEATS = 8  # extrapolated beats after the last detected one, for a final slot past the end
_BEAT_EDGE = 0.04  # seconds; slack when counting the beats before or after a time
_LEFT_W = 0.5  # cost per detected beat left after the last slot


def tempo_limits(beats: np.ndarray) -> tuple[float, float, float]:
    """The shortest, longest and longest fermata or rit. beat period (seconds) for a recording.

    A normal tempo keeps MIN_PERIOD, MAX_PERIOD and MAX_SOFT_PERIOD. A slow recording (a 6/8 bar
    of two beats lasting 3.5 s, a Largo in 4/4) widens the upper limits in step with the median
    detected beat period, a fast one lowers the lower limit; ABS_PERIOD stops both far outside
    music.
    """
    median = float(np.median(np.diff(np.sort(beats)))) if len(beats) > 1 else MAX_PERIOD / 3
    low = min(MIN_PERIOD, median / 2)
    high = max(MAX_PERIOD, PERIOD_SPAN * median)
    soft = max(MAX_SOFT_PERIOD, 2 * PERIOD_SPAN * median)
    return (
        max(low, ABS_PERIOD[0]),
        min(high, ABS_PERIOD[1]),
        min(soft, 2 * ABS_PERIOD[1]),
    )


def unused_beat_share(beats: np.ndarray, start: float, end: float) -> float:
    """The share of the detected beats before `start` or after `end`: what a map leaves out."""
    detected = np.sort(np.asarray(beats, dtype=np.float64))
    if detected.size == 0:
        return 0.0
    before = np.searchsorted(detected, start - _BEAT_EDGE)
    after = detected.size - np.searchsorted(detected, end + _BEAT_EDGE, side="right")
    return float(before + after) / detected.size


def align_bars(
    beat_logits: np.ndarray,
    downbeat_logits: np.ndarray,
    beats: np.ndarray,
    notated: Sequence[float],
    soft: Collection[int] = (),
    rit: Collection[int] = (),
    anchors: dict[int, float] | None = None,
    fps: float = 50.0,
    short: Collection[int] = (),
) -> list[float]:
    """The start time of every slot plus the end of the last slot: len(notated) + 1 times.

    `notated[i]` is slot i's beat count from the score. `beats` are the detected beat times and
    the logits are Beat This' frame curves at `fps`. `soft` holds the slots that may stretch
    (fermatas, and the last slot), `rit` the slots marked rit. or accel. `anchors` maps a slot to
    a time it must start at, exactly. `short` holds the slots shorter than their meter (a pickup,
    an incomplete bar): their beat count may be a fraction, they get no beat comb, and a pickup
    in slot 0 is placed from the bars after it. Raises ValueError for bad input, or when no
    chain of slots fits the anchors and the tempo limits.
    """
    if 0 in short and len(notated) > 1:
        return _with_pickup(
            beat_logits, downbeat_logits, beats, notated, soft, rit, anchors, fps, short
        )
    beat_l = np.asarray(beat_logits, dtype=np.float64)
    down_l = np.asarray(downbeat_logits, dtype=np.float64)
    beat_times = np.sort(np.asarray(beats, dtype=np.float64))
    if beat_l.ndim != 1 or beat_l.shape != down_l.shape:
        raise ValueError("beat and downbeat logits must be 1-D and have the same length")
    if fps <= 0:
        raise ValueError("fps must be positive")
    if any(n <= 0 or (n < 1 and slot not in short) for slot, n in enumerate(notated)):
        raise ValueError("notated beats must be at least 1 in every slot, a short slot above 0")
    slots = len(notated)
    fixed = _check_anchors(anchors or {}, slots)
    if slots == 0:
        return []
    if beat_times.size < 2:
        raise ValueError(_NO_PATH.format("fewer than two beats were detected"))

    times = _bar_candidates(beat_times, beat_l, down_l, fps)
    forced: dict[int, int] = {}
    if fixed:
        times, forced = _pin_anchors(times, fixed)
    limits = tempo_limits(beat_times)
    edges = _Edges.build(times, max(notated) * limits[2])
    context = _BarContext(
        limits=limits,
        edges=edges,
        beats=beat_times,
        down_at=_sliding_max(down_l, SNAP),
        beat_at=np.clip(_sliding_max(beat_l, SNAP), -CLIP, CLIP),
        notated=notated,
        soft=set(soft),
        rit=set(rit),
        forced=forced,
        locked=_locked_slots(slots, set(fixed), set(soft), set(rit)),
        short=set(short),
        hole=_hole_edges(edges, beat_times, min((n for n in notated if n >= 1), default=1)),
        fps=fps,
    )
    chain = _best_chain(context, bool(fixed))
    return [float(times[edges.src[e]]) for e in chain] + [float(times[edges.dst[chain[-1]]])]


# a detected beat this close to where a pickup should start (as a share of its length, at least
# _PICKUP_SLACK_SEC) is the pickup's own beat
_PICKUP_NEAR = 0.5
_PICKUP_SLACK_SEC = 0.06


def _with_pickup(
    beat_logits: np.ndarray,
    downbeat_logits: np.ndarray,
    beats: np.ndarray,
    notated: Sequence[float],
    soft: Collection[int],
    rit: Collection[int],
    anchors: dict[int, float] | None,
    fps: float,
    short: Collection[int],
) -> list[float]:
    """`align_bars` for a pickup in slot 0: the bars after it are aligned alone, and the pickup
    starts its own length before bar 1 at bar 1's beat period (Beat This often hears nothing
    there), on a detected beat when one lies near that place."""
    fixed = _check_anchors(anchors or {}, len(notated))
    rest = align_bars(
        beat_logits,
        downbeat_logits,
        beats,
        notated[1:],
        {slot - 1 for slot in soft if slot > 0},
        {slot - 1 for slot in rit if slot > 0},
        {slot - 1: t for slot, t in fixed.items() if slot > 0},
        fps,
        {slot - 1 for slot in short if slot > 0},
    )
    if 0 in fixed:
        return [fixed[0], *rest]
    period = (rest[1] - rest[0]) / notated[1]
    length = notated[0] * period
    start = rest[0] - length
    detected = np.sort(np.asarray(beats, dtype=np.float64))
    near = detected[np.abs(detected - start) <= max(_PICKUP_NEAR * length, _PICKUP_SLACK_SEC)]
    if near.size:
        start = float(near[np.argmin(np.abs(near - start))])
    if not 0 <= start < rest[0]:
        raise NoAlignmentError(_NO_PATH.format("the pickup would start before the recording"))
    return [start, *rest]


def realign_bars(
    beat_logits: np.ndarray,
    downbeat_logits: np.ndarray,
    beats: np.ndarray,
    notated: Sequence[float],
    locators_by_slot: list[Locator | None],
    soft: Collection[int] = (),
    rit: Collection[int] = (),
    fps: float = 50.0,
    short: Collection[int] = (),
) -> list[float]:
    """Refit the unconfirmed slots of a map; the confirmed locators are fixed anchors.

    The contract of `realign`: `locators_by_slot` has one entry per slot, a confirmed locator keeps
    its `time_sec` unchanged and an unconfirmed locator's old time is ignored. The result has one
    start per slot (unlike `align_bars` it has no end of the last slot, which all-confirmed has no
    way to know). With every slot confirmed the times come back as they are, with no search.
    """
    slots = len(notated)
    if len(locators_by_slot) != slots:
        raise ValueError(f"{len(locators_by_slot)} locators for {slots} slots")
    anchors = {
        slot: locator.time_sec
        for slot, locator in enumerate(locators_by_slot)
        if locator is not None and locator.confirmed
    }
    if len(anchors) == slots:
        return list(_check_anchors(anchors, slots).values())
    found = align_bars(beat_logits, downbeat_logits, beats, notated, soft, rit, anchors, fps, short)
    return found[:-1]


@dataclass(frozen=True)
class _Edges:
    """Every plausible slot as an edge from candidate `src` to candidate `dst`."""

    times: np.ndarray  # the sorted candidate times
    src: np.ndarray
    dst: np.ndarray
    dur: np.ndarray  # seconds

    @staticmethod
    def build(times: np.ndarray, longest: float) -> "_Edges":
        first = np.searchsorted(times, times, side="right")
        last = np.searchsorted(times, times + longest, side="right")
        counts = last - first
        src = np.repeat(np.arange(times.size), counts)
        offset = np.arange(src.size) - np.repeat(np.cumsum(counts) - counts, counts)
        dst = first[src] + offset
        return _Edges(
            times=times,
            src=src,
            dst=dst,
            dur=times[dst] - times[src],
        )


@dataclass(frozen=True)
class _BarContext:
    limits: tuple[float, float, float]  # tempo_limits of the recording
    edges: _Edges
    beats: np.ndarray
    down_at: np.ndarray  # downbeat logit with a +-SNAP frame max, per frame
    beat_at: np.ndarray  # beat logit likewise, clipped
    notated: list[int]
    soft: set[int]
    rit: set[int]
    forced: dict[int, int]  # anchored slot -> index of its candidate
    locked: set[int]
    short: set[int]  # slots shorter than their meter: no beat comb, no beat-count lock
    hole: np.ndarray  # per edge: covers a stretch without detected beats
    fps: float

    def frame(self, seconds: np.ndarray) -> np.ndarray:
        return np.clip(np.round(seconds * self.fps).astype(int), 0, self.down_at.size - 1)


def _hole_edges(edges: _Edges, beats: np.ndarray, bar_beats: float) -> np.ndarray:
    """Per edge: whether it covers HOLE_COVER of a stretch without detected beats (a hole).

    A hole lasts HOLE_BARS bars of `bar_beats` detected beats."""
    gaps = np.diff(beats)
    long = gaps >= HOLE_BARS * bar_beats * np.median(gaps)
    covered = np.zeros(edges.src.size, dtype=bool)
    first, last = edges.times[edges.src], edges.times[edges.dst]
    for hole_start, hole_end in zip(beats[:-1][long], beats[1:][long], strict=True):
        overlap = np.minimum(last, hole_end) - np.maximum(first, hole_start)
        covered |= overlap >= HOLE_COVER * (hole_end - hole_start)
    return covered


def _bar_candidates(
    beats: np.ndarray, beat_l: np.ndarray, down_l: np.ndarray, fps: float
) -> np.ndarray:
    """Detected beats, weaker logit peaks (blind stretches) and a grid extrapolated past the end."""
    loudest = np.maximum(beat_l, down_l)
    peak = (
        np.flatnonzero(
            (loudest[1:-1] >= loudest[:-2])
            & (loudest[1:-1] >= loudest[2:])
            & (loudest[1:-1] > _PEAK_FLOOR)
        )
        + 1
    )
    extra = [t for t in peak / fps if np.min(np.abs(beats - t)) > _NEW_PEAK_GAP]
    period = np.median(np.diff(beats))
    tail = beats[-1] + period * np.arange(1, _TAIL_BEATS + 1)
    return np.unique(np.concatenate([beats, extra, tail]))


def _pin_anchors(times: np.ndarray, anchors: dict[int, float]) -> tuple[np.ndarray, dict[int, int]]:
    """Add every anchor time to the candidates (replacing any within ANCHOR_SNAP of it).

    Returns the new candidates and, per anchored slot, the index of its candidate.
    """
    pinned = np.array(list(anchors.values()))
    near = np.abs(times[:, None] - pinned[None, :]).min(axis=1) < ANCHOR_SNAP
    times = np.unique(np.concatenate([times[~near], pinned]))
    return times, {slot: int(np.searchsorted(times, t)) for slot, t in anchors.items()}


def _sliding_max(values: np.ndarray, radius: int) -> np.ndarray:
    padded = np.pad(values, radius, constant_values=-np.inf)
    return np.max([padded[s : s + values.size] for s in range(2 * radius + 1)], axis=0)


def _tempo_band(slot: int, soft: set[int], rit: set[int]) -> tuple[float, float] | None:
    """The hard limit on the log beat-period change from slot - 1 into `slot`; None = no limit.

    Elastic slots have none: a fermata slot and the slot after it, which may return to any tempo.
    A slot in or right after a rit. or accel. slot may change by RIT_LIMIT, every other by
    TEMPO_LIMIT.
    """
    if slot in soft or slot - 1 in soft:
        return None
    limit = RIT_LIMIT if slot in rit or slot - 1 in rit else TEMPO_LIMIT
    return float(np.log(limit[0])), float(np.log(limit[1]))


def _locked_slots(slots: int, anchors: set[int], soft: set[int], rit: set[int]) -> set[int]:
    """The slots whose beat count the anchors lock.

    A stretch is a run of ordinary slots: not a fermata or rit. slot and not the slot after one.
    A stretch that holds an anchor is locked from its first slot to its last, before and after it.
    """
    locked: set[int] = set()
    stretch: list[int] = []
    for slot in range(slots + 1):
        if slot < slots and not ({slot, slot - 1} & (soft | rit)):
            stretch.append(slot)
            continue
        if any(s in anchors for s in stretch):
            locked.update(stretch)
        stretch = []
    return locked


def _slot_terms(context: _BarContext, slot: int) -> tuple[np.ndarray, np.ndarray]:
    """Local score of every edge as slot `slot`, and its log beat period."""
    edges, n = context.edges, context.notated[slot]
    is_short = slot in context.short
    times = edges.times
    is_soft = slot in context.soft
    period = edges.dur / n
    slow = is_soft or slot in context.rit  # a rit. ending may pass MAX_PERIOD like a fermata
    low, high, soft = context.limits
    ok = (period >= low) & (period <= (soft if slow else high))
    start = times[edges.src]
    # a fermata slot's beats are not evenly spaced, so the comb would only mislead there; a short
    # slot has too few beats for one
    if is_soft or is_short:
        comb = 0
    else:
        inner = start[:, None] + period[:, None] * np.arange(1, int(n))
        comb = context.beat_at[context.frame(inner)].mean(axis=1)
    start_logit = context.down_at[context.frame(start)]
    # the grid past the end is there for the end of the last bar: no bar starts out there
    ok = ok & (start < context.down_at.size / context.fps)
    local = np.where(ok, start_logit + COMB_W * comb, -np.inf)
    if slot in context.forced:  # an anchored slot may only start at its anchor
        local = np.where(edges.src == context.forced[slot], local, -np.inf)
    # a locked slot pays LOCK_W per detected beat more or less than it notates (not a short one)
    if slot in context.locked and not is_short:
        held = np.searchsorted(context.beats, times[edges.dst] - LOCK_EARLY) - np.searchsorted(
            context.beats, start - LOCK_EARLY
        )
        local = local - LOCK_W * np.abs(held - n)
    return local, np.log(period)


def _jump_cost(change: np.ndarray, slot: int, soft: set[int], rit: set[int]) -> np.ndarray:
    """Cost of the log beat-period change from the previous slot into `slot`."""
    if slot in soft:  # fermata: a free band, FERMATA_MIN to FERMATA_MAX times the last period
        over = np.maximum(np.log(FERMATA_MIN) - change, 0) + np.maximum(
            change - np.log(FERMATA_MAX), 0
        )
        return TEMPO_W * over
    if slot - 1 in soft:
        return SOFT_TEMPO_W * np.abs(change)
    if slot in rit or slot - 1 in rit:
        return RIT_TEMPO_W * np.abs(change)
    return TEMPO_W * np.abs(change)


def _extend(
    context: _BarContext,
    slot: int,
    score: np.ndarray,
    log_period: np.ndarray,
    local: np.ndarray,
    new_period: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Score every edge as `slot` after its best predecessor edge (one ending where it starts).

    Returns the scores (-inf where the edge is no option) and the chosen predecessor of each. Only
    reachable predecessors and allowed edges are paired; a tie goes to the earlier predecessor.
    """
    edges = context.edges
    count = edges.times.size
    new = np.full(edges.src.size, -np.inf)
    arg = np.full(edges.src.size, -1)
    reachable = np.flatnonzero(np.isfinite(score))
    reachable = reachable[np.argsort(edges.dst[reachable], kind="stable")]
    arriving = np.bincount(edges.dst[reachable], minlength=count)
    first_arriving = np.cumsum(arriving) - arriving
    allowed = np.flatnonzero(np.isfinite(local))
    allowed = allowed[arriving[edges.src[allowed]] > 0]
    if allowed.size == 0:
        return new, arg

    # one group per allowed edge, holding every reachable edge that ends where it starts
    width = arriving[edges.src[allowed]]
    group_start = np.cumsum(width) - width
    pairs = int(width.sum())
    nxt = np.repeat(allowed, width)
    offset = np.arange(pairs) - np.repeat(group_start, width)
    prev = reachable[np.repeat(first_arriving[edges.src[allowed]], width) + offset]

    change = new_period[nxt] - log_period[prev]
    cost = _jump_cost(change, slot, context.soft, context.rit)
    band = _tempo_band(slot, context.soft, context.rit)
    if band:  # outside the limit the slot is not an option at all
        # into, over and out of a hole the bars are treated like rit. bars: the recording itself
        # shows a broadened bar
        hole = context.hole[nxt] | context.hole[prev]
        low = np.where(hole, min(band[0], np.log(RIT_LIMIT[0])), band[0])
        high = np.where(hole, max(band[1], np.log(RIT_LIMIT[1])), band[1])
        cost = np.where(hole, np.minimum(cost, RIT_TEMPO_W * np.abs(change)), cost)
        cost = np.where((change < low) | (change > high), np.inf, cost)
    total = score[prev] - cost
    best = np.maximum.reduceat(total, group_start)
    tied = np.where(total == np.repeat(best, width), np.arange(pairs), pairs)
    new[allowed] = best + local[allowed]
    arg[allowed] = prev[np.minimum.reduceat(tied, group_start)]
    return new, arg


def _best_chain(context: _BarContext, anchored: bool) -> list[int]:
    """The edge of each slot on the best chain; raises ValueError when no chain fits."""
    edges = context.edges
    times = edges.times
    slots = len(context.notated)
    local, log_period = _slot_terms(context, 0)
    skipped = np.searchsorted(context.beats, times[edges.src] - _BEAT_EDGE)
    score = local - SKIP_W * skipped
    back: list[np.ndarray] = []
    for slot in range(1, slots):
        local, new_period = _slot_terms(context, slot)
        new, arg = _extend(context, slot, score, log_period, local, new_period)
        score, log_period = new, new_period
        back.append(arg)

    left_after = context.beats.size - np.searchsorted(context.beats, times[edges.dst] + _BEAT_EDGE)
    last = int(np.argmax(score - _LEFT_W * left_after))
    if not np.isfinite(score[last]):
        raise NoAlignmentError(
            _NO_PATH.format("anchors cannot be satisfied" if anchored else "no chain of slots fits")
        )
    chain = [last]
    for arg in reversed(back):
        chain.append(int(arg[chain[-1]]))
    return chain[::-1]
