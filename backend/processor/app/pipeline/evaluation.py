import re
from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

from app.pipeline.metrics import MatchResult, TimingSummary, match_events, summarize_timing
from app.pipeline.run_folder import BarBox, PageLayer, TimingLayer

# The pipeline's map measured against an answer key (the map Erez fixed in the editor): pure
# functions over the run folder's models, no files. The bar lines are matched on the page, the
# structure and the marks by bar number, the downbeats by (bar, pass). Only real bar lines are
# matched: the start of a line, and the start of a box that follows a clef, key or time signature
# after a gap, are not, so trimming a box's left edge cannot move the score.

MARK_KINDS = ("fermata", "rit")  # the timing layer's; rests are a part's and scored per part
WORST = 10  # bars listed with the largest timing error
# The gate of Spec/Original Phase Plan.md, Phase 0: bar-line recall "about 90 %" and aligned
# downbeats "within about 100 ms on most bars" on at least 2 samples. "Most" is set to 80 %.
GATE_BAR_LINE_RECALL = 0.90
GATE_ALIGNED_WITHIN_100 = 0.80
GATE_PIECES = 2
TOUCHING = 0.15  # boxes closer than this share of their height are neighbours at one bar line


# ---------------------------------------------------------------- bar lines


@dataclass(frozen=True)
class Edge:
    """One bar line on a page: where it is, how tall, and the bars on either side of it."""

    page: int
    x: float
    y0: float
    y1: float
    before: int  # the bar to its left
    after: int | None  # the bar to its right; None at the end of a line


@dataclass(frozen=True)
class BarLineScore:
    """Bar lines of one part: the key's found or missed, and the pipeline's extra ones."""

    match: MatchResult
    missed: list[Edge]  # in the key, not in the pipeline (bar numbers are the key's)
    extra: list[Edge]  # in the pipeline, not in the key (bar numbers are the pipeline's)


def _lines(layer: PageLayer) -> list[list[BarBox]]:
    """The boxes grouped by system: a box joins a line when they share most of a height."""
    lines: list[list[BarBox]] = []
    spans: list[tuple[int, float, float]] = []  # page, top, bottom of each line
    for box in sorted(layer.bars, key=lambda b: (b.pageIndex, b.y + b.h / 2, b.x)):
        if spans and spans[-1][0] == box.pageIndex:
            page, top, bottom = spans[-1]
            overlap = min(bottom, box.y + box.h) - max(top, box.y)
            if overlap > 0.5 * min(bottom - top, box.h):
                lines[-1].append(box)
                spans[-1] = (page, min(top, box.y), max(bottom, box.y + box.h))
                continue
        lines.append([box])
        spans.append((box.pageIndex, box.y, box.y + box.h))
    return lines


def line_count(layer: PageLayer) -> int:
    return len(_lines(layer))


def bar_edges(layer: PageLayer) -> list[Edge]:
    """Every bar line of the part: the right end of each box. Where the next box touches it, the
    bar line is where the two meet; the left end of a box that starts a line, or after a gap, is
    not a bar line."""
    edges: list[Edge] = []
    for line in _lines(layer):
        boxes = sorted(line, key=lambda b: b.x)
        page = boxes[0].pageIndex
        top = min(b.y for b in boxes)
        bottom = max(b.y + b.h for b in boxes)
        for left, right in zip(boxes, boxes[1:], strict=False):
            end = left.x + left.w
            touching = right.x - end <= TOUCHING * min(left.h, right.h)
            x = (end + right.x) / 2 if touching else end
            edges.append(Edge(page, x, top, bottom, left.bar, right.bar))
        edges.append(Edge(page, boxes[-1].x + boxes[-1].w, top, bottom, boxes[-1].bar, None))
    return edges


def _same_line(a: Edge, b: Edge) -> bool:
    overlap = min(a.y1, b.y1) - max(a.y0, b.y0)
    return a.page == b.page and overlap > 0.5 * min(a.y1 - a.y0, b.y1 - b.y0)


def _score(matched: int, truth: int, predicted: int) -> MatchResult:
    both_empty = truth == 0 and predicted == 0
    return MatchResult(
        recall=matched / truth if truth else float(both_empty),
        precision=matched / predicted if predicted else float(both_empty),
        matched=matched,
        truth=truth,
        predicted=predicted,
    )


def compare_bar_lines(
    key: PageLayer, found: PageLayer, page_widths: Mapping[int, float], tolerance: float
) -> BarLineScore:
    """Match the pipeline's bar lines to the key's one-to-one, on one line, within tolerance."""
    key_edges, found_edges = bar_edges(key), bar_edges(found)
    widest = max(page_widths.values(), default=0.0)

    def allowed(edge: Edge) -> float:
        return tolerance * page_widths.get(edge.page, widest)

    pairs = sorted(
        (abs(k.x - f.x), ki, fi)
        for ki, k in enumerate(key_edges)
        for fi, f in enumerate(found_edges)
        if _same_line(k, f) and abs(k.x - f.x) <= allowed(k)
    )
    used_key: set[int] = set()
    used_found: set[int] = set()
    for _, ki, fi in pairs:
        if ki not in used_key and fi not in used_found:
            used_key.add(ki)
            used_found.add(fi)
    return BarLineScore(
        match=_score(len(used_key), len(key_edges), len(found_edges)),
        missed=[e for i, e in enumerate(key_edges) if i not in used_key],
        extra=[e for i, e in enumerate(found_edges) if i not in used_found],
    )


# ---------------------------------------------------------------- structure


@dataclass(frozen=True)
class MarkScore:
    """One kind of mark, matched by bar number."""

    match: MatchResult
    missed: list[int]
    extra: list[int]

    @property
    def recall(self) -> float:
        return self.match.recall

    @property
    def precision(self) -> float:
        return self.match.precision


@dataclass(frozen=True)
class StructureScore:
    """The timing layer's structure, the pipeline's against the key's."""

    bar_count_key: int
    bar_count_found: int
    meters_key: list[list[int]]  # [fromBar, numerator, denominator]
    meters_found: list[list[int]]
    play_order_key: list[list[int]]  # [from, to]
    play_order_found: list[list[int]]
    marks: dict[str, MarkScore]
    same_bar_count: bool
    same_meters: bool
    same_play_order: bool


def _marks_of(timing: TimingLayer, kind: str) -> list[int]:
    return sorted(m.bar for m in timing.marks if m.kind == kind)


def _mark_score(truth: list[int], predicted: list[int]) -> MarkScore:
    return MarkScore(
        match=match_events([float(b) for b in truth], [float(b) for b in predicted], 0.0),
        missed=sorted(set(truth) - set(predicted)),
        extra=sorted(set(predicted) - set(truth)),
    )


def compare_rests(key: PageLayer, found: PageLayer) -> MarkScore:
    """One part's rests, the pipeline's against the key's, matched by bar number."""
    return _mark_score(sorted(key.rests), sorted(found.rests))


def compare_structure(key: TimingLayer, found: TimingLayer) -> StructureScore:
    marks = {kind: _mark_score(_marks_of(key, kind), _marks_of(found, kind)) for kind in MARK_KINDS}
    return StructureScore(
        bar_count_key=key.barCount,
        bar_count_found=found.barCount,
        meters_key=_meters(key),
        meters_found=_meters(found),
        play_order_key=_rows(key),
        play_order_found=_rows(found),
        marks=marks,
        same_bar_count=key.barCount == found.barCount,
        same_meters=_meters(key) == _meters(found),
        same_play_order=_rows(key) == _rows(found),
    )


def _meters(timing: TimingLayer) -> list[list[int]]:
    return [[m.fromBar, m.numerator, m.denominator] for m in timing.meters]


def _rows(timing: TimingLayer) -> list[list[int]]:
    return [[row.from_, row.to] for row in timing.playOrder]


def pool(scores: list[MatchResult]) -> MatchResult:
    """Several parts as one score: the counts added, the ratios taken again."""
    return _score(
        sum(s.matched for s in scores),
        sum(s.truth for s in scores),
        sum(s.predicted for s in scores),
    )


# ---------------------------------------------------------------- downbeats


@dataclass(frozen=True)
class SlotError:
    """One slot of the key's play order: the key's time and what the pipeline and Beat This say."""

    bar: int
    pass_index: int
    key_sec: float
    found_sec: float | None  # the pipeline's locator for the same bar and pass; None if it has none
    aligned_ms: float | None
    raw_ms: float | None  # to the nearest downbeat Beat This detected; None if it detected none
    flagged: bool  # the pipeline put it in the Review Queue
    key_confirmed: bool


@dataclass(frozen=True)
class Worst:
    bar: int
    pass_index: int
    error_ms: float


@dataclass(frozen=True)
class ErrorStats:
    summary: TimingSummary
    worst: list[Worst]


@dataclass(frozen=True)
class FlagScore:
    """The Review Queue against the real errors (a bar is off when it is over 100 ms out)."""

    bad: int
    flagged: int
    caught: int
    recall: float | None  # of the bars that were off, the share flagged; None if none were off
    precision: float | None  # of the flagged bars, the share really off; None if none flagged


@dataclass(frozen=True)
class DownbeatScore:
    slots: list[SlotError]
    missed: list[tuple[int, int]]  # key slots the pipeline has no locator for
    unkeyed: list[tuple[int, int]]  # slots of the key's play order the key has no time for
    play_order_differs: bool
    key_confirmed: int
    aligned: ErrorStats | None
    aligned_confirmed: ErrorStats | None  # only the slots the key's maker fixed or confirmed
    raw: ErrorStats | None
    flags: FlagScore


def play_slots(timing: TimingLayer) -> list[tuple[int, int]]:
    """The (bar, pass) of every slot of the play order, in the order they are played."""
    seen: dict[int, int] = {}
    slots: list[tuple[int, int]] = []
    for row in timing.playOrder:
        for bar in range(row.from_, row.to + 1):
            slots.append((bar, seen.get(bar, 0)))
            seen[bar] = seen.get(bar, 0) + 1
    return slots


def _deduplicated(frames: np.ndarray) -> list[float]:
    """Beat This' merge of adjacent peak frames (within 1 frame) into their mean."""
    merged: list[float] = []
    count = 0
    for frame in frames.tolist():
        if merged and frame - merged[-1] <= 1:
            count += 1
            merged[-1] += (frame - merged[-1]) / count
        else:
            merged.append(float(frame))
            count = 1
    return merged


def _peak_frames(logits: np.ndarray) -> list[float]:
    # the maxima within +/- 70 ms (7 frames) that are above 0.5 probability (logit > 0)
    padded = np.pad(np.asarray(logits, dtype=float), 3, constant_values=-np.inf)
    pooled = np.lib.stride_tricks.sliding_window_view(padded, 7).max(axis=1)
    return _deduplicated(np.flatnonzero((logits == pooled) & (logits > 0)))


def beat_this_downbeats(
    beat_logits: np.ndarray, downbeat_logits: np.ndarray, fps: float
) -> list[float]:
    """The downbeats Beat This reports for its logits: its "minimal" post-processing, in numpy."""
    beats = np.array(_peak_frames(beat_logits)) / fps
    downbeats = np.array(_peak_frames(downbeat_logits)) / fps
    if beats.size:  # a downbeat is moved to the nearest beat
        downbeats = np.array([beats[np.argmin(np.abs(beats - d))] for d in downbeats])
    return [float(t) for t in np.unique(downbeats)]


def _stats(errors: list[tuple[int, int, float]]) -> ErrorStats | None:
    if not errors:
        return None
    worst = sorted(errors, key=lambda e: -e[2])[:WORST]
    return ErrorStats(
        summary=summarize_timing([e[2] for e in errors]),
        worst=[Worst(bar, pass_index, ms) for bar, pass_index, ms in worst],
    )


def _flag_score(slots: list[SlotError]) -> FlagScore:
    judged = [s for s in slots if s.aligned_ms is not None]
    bad = [s for s in judged if s.aligned_ms is not None and s.aligned_ms > 100.0]
    flagged = [s for s in judged if s.flagged]
    caught = [s for s in bad if s.flagged]
    return FlagScore(
        bad=len(bad),
        flagged=len(flagged),
        caught=len(caught),
        recall=len(caught) / len(bad) if bad else None,
        precision=len(caught) / len(flagged) if flagged else None,
    )


def compare_downbeats(key: TimingLayer, found: TimingLayer, raw: list[float]) -> DownbeatScore:
    """Per slot of the key's play order: the pipeline and raw Beat This against the key."""
    key_locators = {(loc.bar, loc.passIndex): loc for loc in key.locators}
    found_locators = {(loc.bar, loc.passIndex): loc for loc in found.locators}
    slots: list[SlotError] = []
    unkeyed: list[tuple[int, int]] = []
    for slot in play_slots(key):
        truth = key_locators.get(slot)
        if truth is None:
            unkeyed.append(slot)
            continue
        ours = found_locators.get(slot)
        slots.append(
            SlotError(
                bar=slot[0],
                pass_index=slot[1],
                key_sec=truth.timeSec,
                found_sec=None if ours is None else ours.timeSec,
                aligned_ms=None if ours is None else abs(ours.timeSec - truth.timeSec) * 1000.0,
                raw_ms=min(abs(t - truth.timeSec) for t in raw) * 1000.0 if raw else None,
                flagged=ours is not None and any(f.severity > 0 for f in ours.flags or []),
                key_confirmed=truth.confirmed,
            )
        )
    judged = [s for s in slots if s.aligned_ms is not None]
    aligned = [(s.bar, s.pass_index, s.aligned_ms) for s in judged if s.aligned_ms is not None]
    confirmed = [
        (s.bar, s.pass_index, s.aligned_ms)
        for s in judged
        if s.key_confirmed and s.aligned_ms is not None
    ]
    return DownbeatScore(
        slots=slots,
        missed=[(s.bar, s.pass_index) for s in slots if s.found_sec is None],
        unkeyed=unkeyed,
        play_order_differs=_rows(key) != _rows(found),
        key_confirmed=sum(s.key_confirmed for s in slots),
        aligned=_stats(aligned),
        aligned_confirmed=_stats(confirmed),
        raw=_stats([(s.bar, s.pass_index, s.raw_ms) for s in slots if s.raw_ms is not None]),
        flags=_flag_score(slots),
    )


# ---------------------------------------------------------------- a second key: Sonic Visualiser


@dataclass(frozen=True)
class TapScore:
    """The key's downbeats against the taps of an independent annotation."""

    taps: int
    key_slots: int
    summary: TimingSummary | None
    over_100ms: list[Worst]


def parse_taps(text: str) -> list[float]:
    """The times in a Sonic Visualiser export: the first number of each line, seconds."""
    times: list[float] = []
    for line in text.splitlines():
        first = re.split(r"[\s,;]+", line.strip(), maxsplit=1)[0]
        try:
            times.append(float(first))
        except ValueError:  # a blank line, a comment or a header
            continue
    return times


def compare_to_taps(key: TimingLayer, taps: list[float]) -> TapScore:
    """For each downbeat of the key, in play order, the distance to the nearest tap."""
    times = {(loc.bar, loc.passIndex): loc.timeSec for loc in key.locators}
    slots = [slot for slot in play_slots(key) if slot in times]
    errors = [
        (bar, pass_index, min(abs(t - times[(bar, pass_index)]) for t in taps) * 1000.0)
        for bar, pass_index in slots
        if taps
    ]
    return TapScore(
        taps=len(taps),
        key_slots=len(slots),
        summary=summarize_timing([e[2] for e in errors]) if errors else None,
        over_100ms=[Worst(b, p, ms) for b, p, ms in errors if ms > 100.0],
    )


# ---------------------------------------------------------------- the run's cost and the gate


@dataclass(frozen=True)
class RunCost:
    """The time per stage and the vision cost, as run_piece.py wrote them in summary.txt."""

    mode: str  # "full" or "from align": the times are those of that run only
    stage_seconds: dict[str, float]
    cost_usd: float | None  # the vision model's cost in that run
    earlier_cost_usd: float | None  # what the reading it reused cost when it was made
    total_seconds: float  # the stages added; the "(in the read)" lines are parts of one stage
    vision_cost_usd: float | None  # what the reading cost, whenever it was made


def parse_summary(text: str) -> RunCost | None:
    """Read the stage times and the vision cost back out of summary.txt; None if it has neither."""
    stages: dict[str, float] = {}
    listing = False
    for line in text.splitlines():
        if line.startswith("time per stage"):
            listing = True
        elif listing:
            found = re.fullmatch(r"\s+(.+): ([0-9.]+) s", line)
            if found is None:
                listing = False
            else:
                stages[found.group(1)] = float(found.group(2))
    cost = re.search(
        r"vision cost this run: \$([0-9.]+)(?: \(reused the saved reading, \$([0-9.]+))?", text
    )
    if not stages and cost is None:
        return None
    this_run = float(cost.group(1)) if cost else None
    earlier = float(cost.group(2)) if cost and cost.group(2) else None
    return RunCost(
        mode="from align" if "from the alignment onwards" in text else "full",
        stage_seconds=stages,
        cost_usd=this_run,
        earlier_cost_usd=earlier,
        total_seconds=sum(v for name, v in stages.items() if not name.endswith("read)")),
        vision_cost_usd=earlier if earlier is not None else this_run,
    )


def share_within_100ms(score: DownbeatScore) -> float | None:
    """The share of the key's bars the pipeline put within 100 ms; a bar it lacks counts as off."""
    if not score.slots:
        return None
    return sum(s.aligned_ms is not None and s.aligned_ms <= 100.0 for s in score.slots) / len(
        score.slots
    )


def meets_gate(recall: float | None, within_100ms: float | None) -> tuple[bool, bool]:
    """Whether a piece meets the bar-line line and the downbeat line of the gate."""
    return (
        recall is not None and recall >= GATE_BAR_LINE_RECALL,
        within_100ms is not None and within_100ms >= GATE_ALIGNED_WITHIN_100,
    )


def gate_passes(pieces: list[tuple[float | None, float | None]]) -> bool:
    """The gate: GATE_PIECES pieces meet both lines. A piece is (recall, share within 100 ms)."""
    return sum(all(meets_gate(*piece)) for piece in pieces) >= GATE_PIECES
