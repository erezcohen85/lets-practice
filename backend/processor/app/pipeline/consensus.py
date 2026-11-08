from dataclasses import asdict, dataclass

import numpy as np

from app.pipeline.bar_boxes import Stack, merge_cost, merge_stacks, stacks_of, trim_courtesy
from app.pipeline.barlines import LineProbe, Staff
from app.pipeline.omr import OmrLine

# How many measures does each line have? Four witnesses, one answer.
#
# A vision model that reads a crowded line miscounts it, and the box check then trusted the
# miscount. Four independent witnesses are cheap, so the count of every line is decided by them:
#
#     H  the measures the score reader listed for the line
#     A  Audiveris' measure columns for it, after merging the fragments of a false bar line
#     P  the bar lines the page image verifies (barlines.LineProbe.scan), plus one
#        (A and P leave out the courtesy signature that may end a line: bar_boxes.trim_courtesy)
#     N  the bar numbers printed at the start of some lines
#
# A line whose A and P agree takes that count (two witnesses that read the page's pixels, not
# the note shapes, agree). Otherwise H stands, unless P or A is the only way to satisfy the
# printed numbers: a line's printed start number has to equal 1 + the bars before it, so the
# lines between two printed numbers must add up to their difference, and a choice that satisfies
# the numbers beats one that breaks them (P before A when both do). Counts are chosen for all the
# lines between two printed numbers at once. The lines whose chosen count is not H are the
# disputed ones: the reader is asked about them again, to place its marks on the right measures.

# what a witness costs to follow when the printed numbers force a choice among them
COSTS = {"H": 0, "P": 1, "A": 2}


# ---------------------------------------------------------------- the witnesses


def audiveris_count(stacks: list[Stack]) -> int:
    """Audiveris' measure columns of a line, with the fragments of a false bar line merged.

    Two neighbouring columns that each hold less than their measure are one measure cut by a
    false bar line (a half note's stem): they merge, and merge again while the result is still
    short. A fragment next to a full column is a measure of its own (a pick-up bar).
    """
    stacks = list(stacks)
    while True:
        pairs = [i for i in range(len(stacks) - 1) if merge_cost(stacks[i], stacks[i + 1]) == 0]
        if not pairs:
            return len(stacks)
        i = min(pairs, key=lambda i: stacks[i + 1].right - stacks[i].left)
        stacks[i : i + 2] = [merge_stacks(stacks[i], stacks[i + 1])]


def pixel_count(probe: LineProbe, left: int, right: int) -> int:
    """The measures the page shows between `left` and `right`: verified bar lines + 1."""
    return len(probe.scan(left, right)) + 1


def line_counts(line: OmrLine, ink: np.ndarray | None) -> tuple[int | None, int | None]:
    """(A, P) for a system: Audiveris' count and the page's. A witness that could not look is None.

    Both leave out the courtesy signature that ends the line. With no page image only A looks;
    a system Audiveris found no measure in has no count at all.
    """
    stacks = stacks_of(line)
    if not stacks:
        return None, None
    if ink is None:
        return audiveris_count(stacks), None
    probe = LineProbe(ink, [Staff.from_omr(staff) for staff in line.geometry.staves])
    stacks = trim_courtesy(stacks, probe)
    return audiveris_count(stacks), pixel_count(probe, stacks[0].left, stacks[-1].right)


# ---------------------------------------------------------------- the choice


@dataclass(frozen=True)
class Evidence:
    """What the witnesses say about one line. A witness that could not look is None."""

    line: int  # 1-based over the whole piece
    page: int  # the caller's page index
    read: int  # H
    audiveris: int | None  # A
    pixels: int | None  # P
    printed: int | None  # the bar number printed at the start of the line, if any
    rests: int = 0  # the bars a multi-rest of the reading adds to its measure count


@dataclass(frozen=True)
class Choice:
    """The count chosen for a line, who read it that way, and whether the numbers forced it."""

    count: int
    basis: str  # "H=A=P", "A=P", "H=A", "H=P", "H", "P" or "A": who read this count
    by_numbers: bool  # chosen over the default only because the printed numbers need it


def _basis(count: int, e: Evidence) -> str:
    agreeing = [
        name for name, seen in (("H", e.read), ("A", e.audiveris), ("P", e.pixels)) if seen == count
    ]
    return "=".join(agreeing) or "default"


def _options(e: Evidence) -> dict[int, int]:
    """The counts a line may take, each with the cost of following the witness behind it."""
    if e.audiveris is not None and e.audiveris == e.pixels:
        return {e.audiveris: 0}
    options: dict[int, int] = {}
    for name, seen in (("H", e.read), ("P", e.pixels), ("A", e.audiveris)):
        if seen is not None and seen >= 1:
            options.setdefault(seen, COSTS[name])
    return options or {1: 0}


def _solve(options: list[dict[int, int]], rests: list[int], target: int | None) -> list[int]:
    """The counts of a run of lines: the cheapest that add up to `target` bars.

    With no target, or none that any counts reach, each line takes its cheapest count.
    """
    cheapest = [min(o, key=o.__getitem__) for o in options]
    if target is None:
        return cheapest
    states: dict[int, tuple[int, list[int]]] = {0: (0, [])}  # bars so far -> (cost, counts)
    for line_options, extra in zip(options, rests, strict=True):
        step: dict[int, tuple[int, list[int]]] = {}
        for bars, (cost, picked) in states.items():
            for count, price in line_options.items():
                total = bars + count + extra
                if total <= target and (total not in step or cost + price < step[total][0]):
                    step[total] = (cost + price, [*picked, count])
        states = step
    return states[target][1] if target in states else cheapest


def choose_counts(evidence: list[Evidence]) -> list[Choice]:
    """The count of every line (see the module comment)."""
    options = [_options(e) for e in evidence]
    # a run starts at the first line and at every line that prints its number
    starts = [i for i, e in enumerate(evidence) if i == 0 or e.printed is not None]
    ends = [*starts[1:], len(evidence)]
    counts: list[int] = []
    for first, end in zip(starts, ends, strict=True):
        target = None
        if end < len(evidence):
            begins = evidence[first].printed if evidence[first].printed is not None else 1
            target = evidence[end].printed - begins
        counts += _solve(options[first:end], [e.rests for e in evidence[first:end]], target)
    cheapest = [min(o, key=o.__getitem__) for o in options]
    return [
        Choice(count, _basis(count, e), count != default)
        for count, default, e in zip(counts, cheapest, evidence, strict=True)
    ]


def disputed_lines(evidence: list[Evidence], choices: list[Choice]) -> list[int]:
    """The indices of the lines whose chosen count is not what the reader listed.

    The page overruled the reading there, so the reader is shown those lines again, with the
    count, to place its marks (meters, fermatas, repeats) on the right measures.
    """
    return [i for i, (e, c) in enumerate(zip(evidence, choices, strict=True)) if c.count != e.read]


# ---------------------------------------------------------------- the audit


@dataclass
class CountAudit:
    """What was seen and decided for one line."""

    line: int
    page: int
    bar: int  # the first bar of the line
    bars: int  # the bars it holds, multi-rests expanded
    read: int
    audiveris: int | None
    pixels: int | None
    count: int
    basis: str
    by_numbers: bool
    reread: int | None  # the measures the second look at the line saw; None if there was none


@dataclass
class StructureAudit:
    """The count of every line: the witnesses, the choice, the second looks."""

    lines: list[CountAudit]

    @property
    def corrected(self) -> int:
        return sum(1 for a in self.lines if a.count != a.read)

    @property
    def reread(self) -> int:
        return sum(1 for a in self.lines if a.reread is not None)

    def to_dict(self) -> dict:
        return {
            "lines": len(self.lines),
            "corrected": self.corrected,
            "reread": self.reread,
            "details": [asdict(a) for a in self.lines],
        }


def structure_audit(
    evidence: list[Evidence],
    choices: list[Choice],
    rereads: dict[int, int],
    bars: list[int] | None = None,
) -> StructureAudit:
    """The audit of a piece's lines: the evidence, the choices and the second looks.

    `rereads` maps a line's index to the number of measures the second look at it saw. `bars` is
    the bars each line ended up holding; by default the chosen count plus the bars its
    multi-rests add.
    """
    if bars is None:
        bars = [c.count + e.rests for e, c in zip(evidence, choices, strict=True)]
    if len(bars) != len(evidence):
        raise ValueError(f"{len(bars)} bar counts were given for {len(evidence)} lines")
    rows, first = [], 1
    for i, (e, choice, held) in enumerate(zip(evidence, choices, bars, strict=True)):
        rows.append(
            CountAudit(
                e.line,
                e.page,
                first,
                held,
                e.read,
                e.audiveris,
                e.pixels,
                choice.count,
                choice.basis,
                choice.by_numbers,
                rereads.get(i),
            )  # fmt: skip
        )
        first += held
    return StructureAudit(rows)


def _seen(value: int | None) -> str:
    return "?" if value is None else str(value)


def structure_audit_lines(audit: StructureAudit) -> list[str]:
    """The headline and one line per line of the piece, for the log."""
    bars = sum(a.bars for a in audit.lines)
    lines = [
        f"structure: {len(audit.lines)} lines, {bars} bars; "
        f"{audit.corrected} corrected, {audit.reread} re-read"
    ]
    for a in audit.lines:
        basis = a.basis + (", by the printed numbers" if a.by_numbers else "")
        text = (
            f"  line {a.line} (page {a.page + 1}, bars {a.bar}-{a.bar + a.bars - 1}): "
            f"reading {a.read}, Audiveris {_seen(a.audiveris)}, page {_seen(a.pixels)} "
            f"-> {a.count} ({basis})"
        )
        lines.append(text + ("" if a.reread is None else f"; re-read: {a.reread}"))
    return lines


def structure_audit_text(audit: dict | None) -> str | None:
    """One phrase for the job message (from StructureAudit.to_dict), or None when no line was
    changed from the reading."""
    corrected = audit["corrected"] if audit else 0
    if not corrected:
        return None
    return f"structure: {corrected} {'line' if corrected == 1 else 'lines'} corrected by the page"
