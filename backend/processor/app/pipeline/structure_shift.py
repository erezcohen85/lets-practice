import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace

from app.pipeline.models import BarMark
from app.pipeline.pickup import moved_mark, tidy_meters
from app.pipeline.play_order import propose_play_order
from app.pipeline.read_again import LineChange
from app.pipeline.structure import PRINTED_NUMBER_WORDS, PieceStructure, with_the_pickup_of

# Advanced Reading can change how many bars a line holds (read_again.py: a LineChange). The bars
# after that line then have other numbers, and the structure of the part, read from the first
# read's numbers, follows: bar_count, meters, marks, fermatas and rit. spans, tempo words, short
# bars and rests. What the structure says about the music is not read again; only where it is.


def structure_after(structure: PieceStructure, changes: Sequence[LineChange]) -> PieceStructure:
    """The structure with the bar numbers of the changed lines made good.

    The changes are applied from the highest line down, so that each one's numbers (the first
    read's) are still right when its turn comes. Bars after a changed line move by the difference
    in its bar count, and so does the line's own last bar (a repeat sign, a fermata or a jump sits
    at the end of a line, and the end stays the end); what sits on a bar the line no longer has
    moves to the line's last bar left; the line's rests are the new line's multi-rests. Bar 0, a
    pickup, never moves. The play order is proposed again from the moved marks, with the pickup in
    front as before. The warnings, the part's name and the number of readings that found the
    pickup stay as they were. With no change the structure is returned as it is.
    """
    if not changes:
        return structure
    moved = structure
    for change in sorted(changes, key=lambda change: change.old_last, reverse=True):
        moved = _after_one(moved, change)
    rows = propose_play_order(moved.marks, moved.bar_count).rows
    return replace(moved, play_order=with_the_pickup_of(structure, rows))


@dataclass(frozen=True)
class _Line:
    """One changed line: the bars it had in the first read's numbers, and how many it holds now."""

    first: int
    old_last: int
    new_bars: int

    @property
    def difference(self) -> int:
        return self.new_bars - (self.old_last - self.first + 1)

    @property
    def last(self) -> int:
        """The last bar the line has now."""
        return self.first + self.new_bars - 1

    def move(self, bar: int) -> int:
        """Where a bar (a mark, a meter, a name in a warning) goes: the bars before the line's
        end and the line's first bar stay, a bar it no longer has goes to its last bar left, and
        the line's last bar and everything after move with the difference."""
        if bar <= self.first:
            return bar
        return bar + self.difference if bar >= self.old_last else min(bar, self.last)

    def keeps(self, bar: int) -> bool:
        """Whether a fact about one bar (a short bar) outlives the change: not when the bar is
        one the line no longer has."""
        return bar > self.old_last or bar <= self.last


def _lines(changes: Sequence[LineChange]) -> list[_Line]:
    """The changed lines from the highest down: the order they are applied in."""
    ordered = sorted(changes, key=lambda change: change.old_last, reverse=True)
    return [_Line(change.old_first, change.old_last, change.new_bars) for change in ordered]


def _after_one(structure: PieceStructure, change: LineChange) -> PieceStructure:
    line = _Line(change.old_first, change.old_last, change.new_bars)
    move = line.move
    meters = sorted(structure.meters, key=lambda meter: meter.from_bar)
    on_the_line = {bar for bar in structure.rests if line.first <= bar <= line.old_last}
    new_rests = {
        line.first + offset + k for offset, length in change.rest_runs for k in range(length)
    }
    return replace(
        structure,
        bar_count=structure.bar_count + line.difference,
        meters=tidy_meters(
            [meter.model_copy(update={"from_bar": move(meter.from_bar)}) for meter in meters]
        ),
        marks=[moved_mark(mark, move) for mark in structure.marks],
        bar_marks=_bar_marks(structure.bar_marks, move),
        tempo_text=_tempo_text(structure.tempo_text, move),
        short_bars={
            move(bar): units for bar, units in structure.short_bars.items() if line.keeps(bar)
        },
        rests=sorted({move(bar) for bar in structure.rests if bar not in on_the_line} | new_rests),
    )


# ---------------------------------------------------------------- the warnings of the first read

# A bar named in a sentence: "bar 9", "Bar 9", "bars 5-8", "bars 4 and 9". A count ("hold 113 bars")
# has no number after the word and is not one.
_BAR_NAMED = re.compile(r"\b([Bb]ars?) (\d+)(?:( and |-)(\d+))?")
_SHORT_BAR_NOTE = re.compile(r"^Bar (\d+) holds ")


def warnings_after(warnings: Sequence[str], changes: Sequence[LineChange]) -> list[str]:
    """The warnings of the first read after Advanced Reading changed the bar count of some lines.

    The warnings about printed bar numbers go: they compare the numbers printed on the page with
    the first read's counts, and those counts have changed. A bar a sentence names (the line from
    bar N, bars 5-8, at bar N) gets the number it has now, by the rule structure_after moves bars
    by; the note that a bar is set as a short bar goes with a bar that is gone, as the short bar
    does. Everything else passes through, in order. With no change nothing is touched.
    """
    if not changes:
        return list(warnings)
    lines = _lines(changes)

    def now(bar: int) -> int:
        for line in lines:
            bar = line.move(bar)
        return bar

    def renamed(found: re.Match[str]) -> str:
        word, first, joiner, second = found.groups()
        tail = "" if second is None else f"{joiner}{now(int(second))}"
        return f"{word} {now(int(first))}{tail}"

    out: list[str] = []
    for warning in warnings:
        if PRINTED_NUMBER_WORDS in warning:
            continue
        short = _SHORT_BAR_NOTE.match(warning)
        if short and not _short_bar_survives(lines, int(short[1])):
            continue
        out.append(_BAR_NAMED.sub(renamed, warning))
    return out


def _short_bar_survives(lines: list[_Line], bar: int) -> bool:
    for line in lines:
        if not line.keeps(bar):
            return False
        bar = line.move(bar)
    return True


def _bar_marks(marks: list[BarMark], move: Callable[[int], int]) -> list[BarMark]:
    """The fermatas and rit. bars moved; of two marks of one kind that meet on a bar, one."""
    seen: set[tuple[int, str]] = set()
    moved: list[BarMark] = []
    for mark in marks:
        key = (move(mark.bar), mark.kind)
        if key not in seen:
            seen.add(key)
            moved.append(BarMark(bar=key[0], kind=mark.kind))
    return moved


def _tempo_text(words: dict[int, str], move: Callable[[int], int]) -> dict[int, str]:
    """The tempo words moved; words that meet on one bar are joined, as a measure's are."""
    moved: dict[int, str] = {}
    for bar in sorted(words):
        target = move(bar)
        moved[target] = f"{moved[target]} / {words[bar]}" if target in moved else words[bar]
    return moved
