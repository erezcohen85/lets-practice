import math
from dataclasses import dataclass, field
from fractions import Fraction
from statistics import median
from typing import NamedTuple

import numpy as np

from app.pipeline.barlines import EDGE, GROUP, LINE_HALF, BarLine, LineProbe, Staff
from app.pipeline.models import BarBox
from app.pipeline.omr import OmrLine

# Turns a line's chosen measure count into bar boxes on the stored page image.
#
# Audiveris' measure columns ("stacks") are the starting point. The page pixels (barlines.py) say
# which of their boundaries are real bar lines, and what a stack holds (its duration against its
# expected one) says which false bar lines cut one measure in two. reconcile_line settles one line
# to exactly the chosen number of columns and says how far to trust the result: "verified" (every
# Audiveris boundary stands and the page confirms it), "repaired" (some were changed and every bar
# line of the result is confirmed) or "uncertain" (a bar line the page does not confirm, or one
# the page shows that no column uses). A line with no page image is "unchecked".
# map_boxes then cuts the staff band into one box per bar and maps it onto the stored image. The
# first box of a line and any box that starts with a printed clef, key or time signature begin
# after that signature (line_starts, _box_lefts), so the cursor's glide covers only the notes.

COURTESY_HEIGHTS = 4  # staff heights: a region after a line's last bar line narrower than this
# may be a courtesy signature
LONE_HEIGHTS = 1  # staff heights: with no other sign, a region this narrow is one (courtesy
# signatures measured 0.47, 0.6 and 1.4; of the other last columns Audiveris found no music in,
# the narrowest on 20 real parts is 1.6)
SIGNATURE_REACH = 0.5  # staff heights: Audiveris' signature must end this close to the line's end
UNUSED_PX = 40  # a bar line the page shows this far from both edges of a box is unused
UNUSED_COVERAGE = 0.99  # ...if all of the staff has ink there: a long stem on a rough scan has 0.96
BOX_MARGIN = 0.5  # staff spaces above the top line and below the bottom line of a box
# A box that starts after a signature leaves this many staff spaces between the signature and its
# left edge: half a space keeps the box clear of the signature's last stroke on a scan and still
# well short of the first note, which the engraver sets at least a space after it.
HEADER_GAP = 0.5
MIN_BOX_SPACES = 2  # staff spaces: a box trimmed by a signature must stay at least this wide
EMPTY_HEADER_SPACES = 1  # staff spaces: a header narrower than this is one Audiveris did not find
# With no header on the whole page, the opening is read from the ink right after the staff starts:
OPENING_REACH = 1.5  # staff spaces: its first glyph begins this close to the staff's left edge
OPENING_JOIN = 0.3  # staff spaces: ink columns closer than this are one glyph
OPENING_GAP = 1.0  # staff spaces: glyphs closer than this are one opening; a wider gap ends it
OPENING_MAX = 8  # staff spaces: an opening wider than this is not one (it was music)


class Stack(NamedTuple):
    """One Audiveris measure column: its x span, the duration it should hold and what it holds.

    Durations are whole-note fractions; None when Audiveris did not say. `signed_to` is where the
    last key or time signature Audiveris read inside the column ends, None when it read none.
    """

    left: int
    right: int
    expected: Fraction | None = None
    duration: Fraction | None = None
    signed_to: int | None = None


def stacks_of(line: OmrLine) -> list[Stack]:
    """The measure columns of a system, left to right, on whole pixels."""
    return [
        Stack(
            round(m.left),
            round(m.right),
            m.expected,
            m.duration,
            None if m.signed_to is None else round(m.signed_to),
        )
        for m in line.system.measures
    ]


# ---------------------------------------------------------------- fitting the columns


def _split(x0: int, x1: int, n: int) -> list[tuple[int, int]]:
    edges = [round(x0 + (x1 - x0) * i / n) for i in range(n + 1)]
    return list(zip(edges, edges[1:], strict=False))


def _is_fragment(stack: Stack) -> bool:
    """A column that holds less than its measure should: a false bar line cut it off."""
    return (
        stack.expected is not None
        and stack.duration is not None
        and stack.duration < stack.expected
    )


def merge_cost(a: Stack, b: Stack) -> Fraction:
    """How unlikely `a` and `b` are to be parts of one printed measure (lower = likelier)."""
    if _is_fragment(a) and _is_fragment(b):
        return Fraction(0)
    expected = a.expected if a.expected is not None else b.expected
    if a.duration is None or b.duration is None or expected is None:
        return Fraction(2)
    return abs(a.duration + b.duration - expected) + 1


def merge_stacks(a: Stack, b: Stack) -> Stack:
    duration = None if a.duration is None or b.duration is None else a.duration + b.duration
    return Stack(a.left, b.right, a.expected if a.expected is not None else b.expected, duration)


def _is_overfull(stack: Stack) -> bool:
    """A column that holds at least two measures' worth of music: a bar line was missed in it."""
    return (
        stack.expected is not None
        and stack.expected > 0
        and stack.duration is not None
        and stack.duration >= 2 * stack.expected
    )


def _merge_down(stacks: list[Stack], count: int) -> list[Stack]:
    """Merge the likeliest adjacent pair until `count` columns remain (narrower pair on a tie)."""
    stacks = list(stacks)
    while len(stacks) > count:
        i = min(
            range(len(stacks) - 1),
            key=lambda i: (
                merge_cost(stacks[i], stacks[i + 1]),
                stacks[i + 1].right - stacks[i].left,
            ),
        )
        stacks[i : i + 2] = [merge_stacks(stacks[i], stacks[i + 1])]
    return stacks


def _split_up(stacks: list[Stack], count: int) -> list[Stack] | None:
    """Halve the fullest overfull column until `count` remain; None when none is overfull."""
    stacks = list(stacks)
    while len(stacks) < count:
        overfull = [i for i, s in enumerate(stacks) if _is_overfull(s)]
        if not overfull:
            return None
        i = max(overfull, key=lambda i: stacks[i].duration / stacks[i].expected)
        s = stacks[i]
        (left, mid), (_, right) = _split(s.left, s.right, 2)
        half = s.duration / 2
        stacks[i : i + 1] = [
            Stack(left, mid, s.expected, half),
            Stack(mid, right, s.expected, half),
        ]
    return stacks


def fit_columns(stacks: list[Stack], count: int) -> tuple[list[tuple[int, int]], bool]:
    """The `count` measure columns of a system and whether they follow real bar lines.

    Too many stacks (a false bar line, such as a half note's stem): merge the likeliest adjacent
    pairs, fragments first. Too few (a missed bar line): halve the stacks that hold two measures'
    worth. When neither rule can reach `count`, the system's span is split evenly and the
    columns are not exact.
    """
    if len(stacks) > count:
        fitted = _merge_down(stacks, count)
    elif len(stacks) < count:
        fitted = _split_up(stacks, count)
    else:
        fitted = stacks
    if fitted is None:
        return _split(stacks[0].left, stacks[-1].right, count), False
    return [(s.left, s.right) for s in fitted], True


def trim_courtesy(stacks: list[Stack], probe: LineProbe) -> list[Stack]:
    """The measure columns of a line without the courtesy signature that ends it, if it has one.

    The region after a line's last bar line (a key or time signature for the next line) is not a
    measure when Audiveris found no music in its column (duration 0), it is narrower than
    COURTESY_HEIGHTS staff heights, its left edge is a bar line (single, double or repeat) and
    one more thing says it is a signature, which a last bar of one hollow note that Audiveris
    read nothing in cannot show:
    - the region is narrower than LONE_HEIGHTS staff height: too narrow to hold a bar's music,
      whatever ink it has (a courtesy 6/4 is as solid as a notehead). A courtesy 3/4 is printed
      after a single bar line, so the bar line need not be a double one; or
    - Audiveris read a key or time signature in the column that ends within SIGNATURE_REACH staff
      heights of the line's end (a note after it would leave more room) and the page has no
      notes or rests after that signature; or
    - the bar line is a double one (thin-thick or two strokes within GROUP px of each other) and
      the page has no solid ink in the region wider than an accidental.
    That bar line is then the right end of the line (the one the page shows, which Audiveris'
    boundary may be a few px off from) and the column before it stops there.
    """
    if len(stacks) < 2 or stacks[-1].duration != 0:
        return list(stacks)
    last = stacks[-1]
    height = probe.staff_height(last.left)
    if last.right - last.left >= COURTESY_HEIGHTS * height:
        return list(stacks)
    if not probe.check_near(last.left).ok:
        return list(stacks)
    near = probe.scan(last.left - GROUP - EDGE, last.left + GROUP + EDGE)
    ends = [b for b in near if abs(b.x - last.left) <= GROUP]
    if not ends:
        return list(stacks)
    double = [b for b in ends if b.strokes >= 2]
    signed = last.signed_to is not None and last.right - last.signed_to <= SIGNATURE_REACH * height
    if last.right - last.left < LONE_HEIGHTS * height:
        pass  # too narrow for a note, so its ink is a signature's, however heavy (a 6/4 is solid)
    elif signed:
        if probe.solid_between(last.signed_to, last.right):  # music after the signature
            return list(stacks)
    elif not double or probe.solid_between(last.left, last.right):
        return list(stacks)
    end = min(double or ends, key=lambda b: abs(b.x - last.left)).x
    return [*stacks[:-2], stacks[-2]._replace(right=end)]


# ---------------------------------------------------------------- reconciling one line


@dataclass
class Cut:
    """An inner bar line of a system: where two measure columns meet, and what the page says."""

    x: int
    ok: bool
    coverage: float
    reason: str | None = None


@dataclass
class LineFit:
    """The measure columns chosen for one line, how far to trust them and what was changed."""

    columns: list[tuple[int, int]]
    confidence: str  # "verified" | "repaired" | "uncertain"
    changes: list[str]


def _column_at(columns: list[Stack], x: int) -> int | None:
    return next((i for i, c in enumerate(columns) if c.left < x < c.right), None)


def _insert_cut(columns: list[Stack], cuts: list[Cut], x: int, cut: Cut) -> None:
    """Split the column that holds x there; its duration is shared out by width."""
    i = _column_at(columns, x)
    c = columns[i]
    share = Fraction(x - c.left, c.right - c.left)
    first = None if c.duration is None else c.duration * share
    second = None if c.duration is None else c.duration * (1 - share)
    columns[i : i + 1] = [
        Stack(c.left, x, c.expected, first),
        Stack(x, c.right, c.expected, second),
    ]
    cuts.insert(i, cut)


def _fullness(column: Stack) -> Fraction:
    """How much of its measure a column holds (1 when unknown)."""
    if column.duration is None or not column.expected:
        return Fraction(1)
    return column.duration / column.expected


def _drop_cut(columns: list[Stack], cuts: list[Cut], i: int) -> None:
    columns[i : i + 2] = [merge_stacks(columns[i], columns[i + 1])]
    del cuts[i]


def reconcile_line(
    stacks: list[Stack], count: int, probe: LineProbe, numbers: list[int] | None = None
) -> LineFit:
    """The `count` measure columns of one line, checked against the page image.

    The inner bar lines should number count - 1. Audiveris' boundaries that the page does not
    show as bar lines are dropped first (the fragment rule picks among them); bar lines the page
    shows and Audiveris missed are added (the fullest column first); when the counts agree but a
    boundary is wrong and a bar line is missing, they are swapped. Too many boundaries that are
    all bar lines on the page go to the fragment rule; too few and no bar line to add, to the
    split rule, then the even split.

    A bar line the page verifies (with ink over all of the staff: UNUSED_COVERAGE) must not lie
    unused inside a column, more than UNUSED_PX from both its edges, unless a boundary dropped
    for the reasons above explains it. If one does, the line is not "verified": when the page's
    bar lines make exactly `count` columns they replace the boundaries ("repaired"), otherwise
    the line is "uncertain" and the change says where the bar line is. `numbers` are the bar
    numbers of the line's measures, for that text (default 1...).

    "verified": Audiveris' boundaries all stand and the page confirms each. "repaired": some
    were changed and every bar line of the result is confirmed. "uncertain": the result holds a
    bar line the page does not confirm, or the fragments did not explain a dropped one, or the
    page has a bar line no column uses.
    """
    target = count - 1
    numbers = numbers or list(range(1, count + 1))
    left, right = stacks[0].left, stacks[-1].right
    columns = list(stacks)
    cuts = []
    for stack in stacks[:-1]:
        check = probe.check_near(stack.right)
        cuts.append(Cut(stack.right, check.ok, check.coverage, check.reason))
    scanned: list[BarLine] | None = None
    changes: list[str] = []
    unexplained = False
    dropped: list[int] = []  # x of every boundary that was dropped, each with its reason in changes

    def scan() -> list[BarLine]:
        nonlocal scanned
        if scanned is None:
            scanned = probe.scan(left, right)
        return scanned

    def candidates() -> list[BarLine]:
        """Bar lines the page shows that no boundary is within GROUP px of."""
        return [
            b
            for b in scan()
            if all(abs(b.x - cut.x) > GROUP for cut in cuts)
            and _column_at(columns, b.x) is not None
        ]

    def cost_of_merging(i: int) -> tuple[Fraction, int]:
        return merge_cost(columns[i], columns[i + 1]), columns[i + 1].right - columns[i].left

    def drop(i: int) -> None:
        nonlocal unexplained
        cut = cuts[i]
        if not cut.ok:
            changes.append(f"dropped false bar line at x={cut.x} ({cut.reason})")
        elif cost_of_merging(i)[0] == 0:
            changes.append(
                f"merged the fragments at x={cut.x}: it looks like a bar line (coverage "
                f"{cut.coverage:.2f}) but the columns either side each hold less than a measure"
            )
        else:
            unexplained = True
            changes.append(
                f"dropped bar line at x={cut.x} (coverage {cut.coverage:.2f}): the page shows more "
                "bar lines than the line has measures"
            )
        dropped.append(cut.x)
        _drop_cut(columns, cuts, i)

    def add(pool: list[BarLine]) -> None:
        def rank(b: BarLine):
            column = columns[_column_at(columns, b.x)]
            return (-_fullness(column), -b.coverage, abs(b.x - (column.left + column.right) / 2))

        best = min(pool, key=rank)
        _insert_cut(columns, cuts, best.x, Cut(best.x, True, best.coverage))
        changes.append(f"added missed bar line at x={best.x} (coverage {best.coverage:.2f})")

    def unverified_first() -> int:
        pool = [i for i, c in enumerate(cuts) if not c.ok] or list(range(len(cuts)))
        return min(pool, key=cost_of_merging)

    while len(cuts) > target:
        drop(unverified_first())
    while len(cuts) < target and (pool := candidates()):
        add(pool)
    while len(cuts) < target:  # nothing on the page to add: halve the fullest column
        overfull = [i for i, c in enumerate(columns) if _is_overfull(c)]
        if not overfull:
            changes.append(
                f"no bar line on the page for {count} measures: the line is split evenly"
            )
            return LineFit(_split(left, right, count), "uncertain", changes)
        column = columns[max(overfull, key=lambda i: _fullness(columns[i]))]
        mid = (column.left + column.right) // 2
        check = probe.check_near(mid)
        _insert_cut(columns, cuts, mid, Cut(mid, check.ok, check.coverage, check.reason))
        changes.append(f"split a column that holds two measures at x={mid} (no bar line there)")
    while any(not c.ok for c in cuts) and candidates():  # as many cuts as measures, one wrong
        drop(unverified_first())
        add(candidates())
    for cut in cuts:
        if not cut.ok:
            changes.append(f"could not verify bar line at x={cut.x} ({cut.reason})")
    uncertain = unexplained or any(not c.ok for c in cuts)

    def unused() -> list[tuple[BarLine, int]]:
        """(bar line, index of the column it lies inside) for every bar line no column uses."""
        found = []
        for b in scan():
            if b.coverage < UNUSED_COVERAGE or any(abs(b.x - x) <= GROUP for x in dropped):
                continue
            for k, c in enumerate(columns):
                if c.left + UNUSED_PX < b.x < c.right - UNUSED_PX:
                    found.append((b, k))
        return found

    if lost := unused():
        edges = [left, *(b.x for b in scan()), right]
        first, k = lost[0]
        if len(edges) == count + 1:  # the page's own bar lines make exactly the line's measures
            changes.append(
                f"replaced the boundaries by the {count - 1} bar lines the page shows: the bar "
                f"line at x={first.x} lay inside bar {numbers[k]}"
            )
            return LineFit(list(zip(edges, edges[1:], strict=False)), "repaired", changes)
        uncertain = True
        for b, k in lost:
            changes.append(f"unused bar line at x={b.x} inside bar {numbers[k]}")
    confidence = "uncertain" if uncertain else "repaired" if changes else "verified"
    return LineFit([(c.left, c.right) for c in columns], confidence, changes)


# ---------------------------------------------------------------- the audit


@dataclass
class LineAudit:
    page: int  # the caller's page index
    bar: int  # the first bar of the line
    confidence: str
    changes: list[str]
    notes: list[str] = field(default_factory=list)  # what is known about the line's left edges


@dataclass
class BoxAudit:
    """What the bar-line check did, line by line."""

    lines: list[LineAudit] = field(default_factory=list)

    def to_dict(self) -> dict:
        counts = {
            k: sum(1 for line in self.lines if line.confidence == k)
            for k in ("verified", "repaired", "uncertain", "unchecked")
        }
        details = [
            {
                "page": line.page,
                "bar": line.bar,
                "confidence": line.confidence,
                "changes": line.changes,
                **({"notes": line.notes} if line.notes else {}),
            }
            for line in self.lines
            if line.confidence in ("repaired", "uncertain") or line.notes
        ]
        return {"lines": len(self.lines), **counts, "details": details}


def box_audit_text(audit: dict) -> str:
    """One line for the job message, e.g. "boxes: 19 verified, 1 repaired, 0 uncertain"."""
    text = (
        f"boxes: {audit['verified']} verified, {audit['repaired']} repaired, "
        f"{audit['uncertain']} uncertain"
    )
    return text + (f", {audit['unchecked']} not checked" if audit["unchecked"] else "")


def box_audit_lines(audit: dict) -> list[str]:
    """The headline and one line per repaired or uncertain line, for the log."""
    lines = [box_audit_text(audit)]
    for detail in audit["details"]:
        where = f"page {detail['page'] + 1}, line from bar {detail['bar']}: {detail['confidence']}"
        lines.append(f"  {where}")
        lines += [f"    {change}" for change in [*detail["changes"], *detail.get("notes", [])]]
    return lines


# ---------------------------------------------------------------- the boxes


@dataclass(frozen=True)
class PageTarget:
    """The stored image of a page: its size and the angle it was levelled by.

    Audiveris read the page as rendered. The stored image is the same page scaled to its own
    size and then rotated about its centre by `angle_deg`, counter-clockwise positive, the angle
    pdf_pages.deskew applied to Image.rotate.
    """

    width: int
    height: int
    angle_deg: float = 0.0

    def to_image(self, x: float, y: float, omr_size: tuple[int, int]) -> tuple[float, float]:
        """Where the point (x, y) of the OMR image lies on the stored image."""
        omr_width, omr_height = omr_size
        dx = x * self.width / omr_width - self.width / 2
        dy = y * self.height / omr_height - self.height / 2
        angle = math.radians(self.angle_deg)
        return (
            self.width / 2 + dx * math.cos(angle) + dy * math.sin(angle),
            self.height / 2 - dx * math.sin(angle) + dy * math.cos(angle),
        )


@dataclass(frozen=True)
class BoxMap:
    """The bar boxes of a part, bar 1 first, and what the bar-line check did."""

    boxes: list[BarBox]
    audit: BoxAudit


def _band(staves: list[Staff], x: float) -> tuple[float, float]:
    """The y of the staff band at x, a margin of BOX_MARGIN staff spaces beyond the outer lines."""
    top, first_bottom = staves[0].edges(x)
    bottom = staves[-1].edges(x)[1]
    margin = BOX_MARGIN * (first_bottom - top) / 4
    return top - margin, bottom + margin


def _box(
    bar: int, line: OmrLine, staves: list[Staff], target: PageTarget, x0: float, x1: float
) -> BarBox:
    """The box of the columns x0..x1 on the stored image: the smallest one around the band."""
    corners = [target.to_image(x, y, line.size) for x in (x0, x1) for y in _band(staves, x)]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    left, right = max(0.0, min(xs)), min(float(target.width), max(xs))
    top, bottom = max(0.0, min(ys)), min(float(target.height), max(ys))
    return BarBox(bar=bar, page_index=line.page, x=left, y=top, w=right - left, h=bottom - top)


def _columns(
    line: OmrLine, stacks: list[Stack], numbers: list[int], probe: LineProbe | None
) -> tuple[list[tuple[int, int]], str, list[str]]:
    """The line's columns, how far to trust them and what was changed."""
    count = len(numbers)
    if not stacks:
        edges = _split(round(line.geometry.left), round(line.geometry.right), count)
        return edges, "uncertain", ["Audiveris found no measure in the line: it is split evenly"]
    if probe is None:
        columns, matched = fit_columns(stacks, count)
        return columns, "unchecked" if matched else "uncertain", []
    fit = reconcile_line(stacks, count, probe, numbers)
    return fit.columns, fit.confidence, fit.changes


def _line_space(line: OmrLine) -> float:
    """The distance between the staff lines at the left of the line's first staff."""
    staff = line.geometry.staves[0]
    top, bottom = Staff.from_omr(staff).edges(staff.top_line[0][0])
    return (bottom - top) / 4


def line_starts(lines: list[OmrLine]) -> list[float | None]:
    """The x each line's first box starts at, None where the line has no header to start after.

    Lines of one page with the same opening (clef, key, and time if printed) share its width, so
    their first boxes line up: each starts the widest header of the group, plus HEADER_GAP, after
    its own staff's start. The width, not the x, is shared: an indented line (a first line with a
    number printed before its staff) would otherwise push every line's start to its own.
    """
    widths: dict[tuple[int, tuple[str, ...]], float] = {}
    keys: list[tuple[int, tuple[str, ...]] | None] = []
    for line in lines:
        stop = line.system.header_stop
        # Audiveris gives a header that stops where it starts when it missed the clef and key
        if stop is None or stop - line.geometry.left < EMPTY_HEADER_SPACES * _line_space(line):
            keys.append(None)
            continue
        key = (line.page, tuple(line.system.opening))
        width = stop - line.geometry.left + HEADER_GAP * _line_space(line)
        widths[key] = max(widths.get(key, 0.0), width)
        keys.append(key)
    # A line with no header found takes the opening width of the page's median line: every line
    # of a part prints its clef and key, so its header is there even when Audiveris missed it.
    usual: dict[int, float] = {}
    for page in {line.page for line in lines}:
        found = [widths[k] for line, k in zip(lines, keys, strict=True) if k and line.page == page]
        if found:
            usual[page] = median(found)
    return [
        line.geometry.left + (widths[key] if key is not None else usual[line.page])
        if key is not None or line.page in usual
        else None
        for line, key in zip(lines, keys, strict=True)
    ]


def ink_line_start(line: OmrLine, probe: LineProbe) -> float | None:
    """Where the first box of a line starts when no header was found on its page: after the ink
    that begins right at the staff's left edge (the clef, key and time) and ends at the first gap
    of OPENING_GAP staff spaces, plus HEADER_GAP. None when the ink shows no such opening."""
    space = _line_space(line)
    left = int(line.geometry.left)
    reach = left + int(OPENING_MAX * space) + int(2 * OPENING_GAP * space)
    inked: list[int] = []
    for x in range(left, min(reach, probe.ink.shape[1])):
        count = 0
        for staff in probe.staves:
            top, bottom = staff.rows(x)
            rows = np.arange(top, bottom + 1)
            music = np.ones(len(rows), dtype=bool)
            for k in range(5):  # the five lines are evenly spaced
                music &= np.abs(rows - (top + k * (bottom - top) / 4)) > LINE_HALF
            count += int(probe.ink[rows[music], x].sum())
        if count >= 2:
            inked.append(x)
    if not inked or inked[0] - left > OPENING_REACH * space:
        return None
    end = inked[0]
    for x in inked[1:]:
        if x - end >= OPENING_GAP * space:
            if end - inked[0] > OPENING_MAX * space:
                return None
            return end + 1 + HEADER_GAP * space
        end = x
    return None


def _box_lefts(
    line: OmrLine, columns: list[tuple[int, int]], start: float | None
) -> tuple[list[float], list[str]]:
    """The left edge of each column's box, and what is known about the left edges.

    The first box begins at `start`, the others where a signature printed at their start ends
    plus HEADER_GAP. A box keeps its column's edge where the signature would leave it too narrow.
    """
    space = _line_space(line)
    gap, narrowest = HEADER_GAP * space, MIN_BOX_SPACES * space
    lefts = [float(x0) for x0, _ in columns]
    notes: list[str] = []
    measures = line.system.measures
    if start is None:
        if measures and measures[0].block_right is not None:
            notes.append("no header found: the first bar starts at the left edge of the line")
    elif start <= columns[0][1] - narrowest:
        lefts[0] = start
    else:
        notes.append(
            "the opening block leaves no room in the first bar: "
            "it starts at the left edge of the line"
        )
    for k, (x0, x1) in enumerate(columns[1:], 1):
        printed = [
            m for m in measures[1:] if m.block_right is not None and abs(m.left - x0) <= GROUP
        ]
        if printed:
            after = min(printed, key=lambda m: abs(m.left - x0)).block_right + gap
            if after <= x1 - narrowest:
                lefts[k] = after
    return lefts, notes


def _share_edges(placed: list[BarBox], lefts: list[float], columns: list[tuple[int, int]]) -> None:
    """Make two boxes that meet at a bar line share one exact edge.

    Rotating each box on its own leaves the right edge of one and the left edge of the next up to a
    pixel apart or overlapping; the line is where they meet, so both take the middle. A box that
    starts after a signature keeps its gap.
    """
    for k in range(len(placed) - 1):
        if lefts[k + 1] != columns[k][1]:
            continue
        edge = (placed[k].x + placed[k].w + placed[k + 1].x) / 2
        placed[k] = placed[k].model_copy(update={"w": edge - placed[k].x})
        placed[k + 1] = placed[k + 1].model_copy(
            update={"x": edge, "w": placed[k + 1].x + placed[k + 1].w - edge}
        )


def map_boxes(
    lines: list[OmrLine],
    measures: list[list[int]],
    ink: dict[int, np.ndarray],
    targets: dict[int, PageTarget],
) -> BoxMap:
    """A box for every bar of the part, numbered from 1 in reading order.

    `measures[i]` holds, for each measure of line i, the bars it covers: 1 for an ordinary
    measure, more for a multi-rest, whose bars share one box. Its length is the line's chosen
    measure count. `ink` is the page image of each page by page index and `targets` the stored
    image of each page; a page without ink is not checked (confidence "unchecked").

    The courtesy signature that may end a line gets no box (trim_courtesy): the last box ends at
    the line's last bar line. Each box hugs the staff, from its top line to its bottom line plus
    BOX_MARGIN, as Audiveris found them at the box's edges.

    A line's first box starts after its opening block (line_starts) and a box whose bar begins with
    a printed clef, key or time signature starts after that, so the previous box's right edge stays
    on its bar line and a gap lies between the two. The audit notes a line it could not do this for.
    """
    if len(measures) != len(lines):
        raise ValueError(f"{len(measures)} measure lists were given for {len(lines)} lines")
    boxes: list[BarBox] = []
    audit = BoxAudit()
    bar = 1
    starts = line_starts(lines)
    for line, spans, start in zip(lines, measures, starts, strict=True):
        if not spans:
            raise ValueError("every line needs at least one measure")
        target = targets.get(line.page)
        if target is None:
            raise ValueError(f"no stored image size for page {line.page + 1}")
        staves = [Staff.from_omr(s) for s in line.geometry.staves]
        probe = LineProbe(ink[line.page], staves) if line.page in ink else None
        stacks = stacks_of(line)
        if probe is not None and stacks:
            stacks = trim_courtesy(stacks, probe)
        starts = [bar + sum(spans[:k]) for k in range(len(spans))]
        columns, confidence, changes = _columns(line, stacks, starts, probe)
        if start is None and probe is not None:
            start = ink_line_start(line, probe)
        lefts, notes = _box_lefts(line, columns, start)
        audit.lines.append(LineAudit(line.page, bar, confidence, changes, notes))
        placed = [
            _box(bar, line, staves, target, x0, x1)
            for x0, (_, x1) in zip(lefts, columns, strict=True)
        ]
        _share_edges(placed, lefts, columns)
        for box, covered in zip(placed, spans, strict=True):
            for _ in range(covered):  # the bars of a multi-rest share one printed measure
                boxes.append(box.model_copy(update={"bar": bar}))
                bar += 1
    return BoxMap(boxes, audit)
