from collections.abc import Callable
from dataclasses import dataclass, replace
from fractions import Fraction
from typing import Literal

from app.pipeline.models import BarBox, BarMark, Meter, MeterChange, PlayOrderRow
from app.pipeline.omr import DEFAULT_METER, OmrLine, OmrMeasure
from app.pipeline.play_order import StructureMark
from app.pipeline.review_flags import PICKUP_SURE
from app.pipeline.score_reader import ReadLine
from app.pipeline.structure import PieceStructure

# A pickup (anacrusis) is bar 0; the first full bar is bar 1, as printed. The structure read
# numbers the measures 1..M in page order, the pickup as bar 1, so a pickup is found from three
# readings of the first measure and then every number of the part moves one down (`renumbered`).
# Two readings that agree make bar 0 a pickup; one alone still makes it one, with a Review Queue
# flag asking (review_flags.py). The readings:
#   - Audiveris: it calls the first measure of the piece a pickup itself (stack special PICKUP),
#     or the first measure holds less than the time signature says;
#   - the score reader: it says how many notes the first measure of the first line holds;
#   - the printed bar numbers: the second line starts at the number that counts the first
#     measure out (a pickup) or in (a full bar).
# Audiveris also tells a short bar in the middle (a measure that holds less than its meter); it
# is trusted only when there are few of them (see MAX_AUTO_SHORT_BARS).

DEFAULT_UNITS = 1  # the length of a pickup when no reading gives one
MAX_AUTO_SHORT_BARS = 3  # Audiveris' durations are not trusted when it finds more short bars

Says = Literal["pickup", "full", "unknown"]


@dataclass(frozen=True)
class PickupVote:
    """What one reading says about the first measure; units is the length it gives, if any."""

    source: str
    says: Says
    units: int | None = None


@dataclass(frozen=True)
class PickupFinding:
    """The pickup of a part: its length (None = no pickup) and how many readings said so."""

    units: int | None
    sources: int
    votes: tuple[PickupVote, ...]


def units_of(duration: Fraction | None, meter: Meter) -> int | None:
    """A duration in whole notes as notes of the meter's denominator, when it is a whole number
    of them and shorter than the bar."""
    if duration is None:
        return None
    count = duration * meter.denominator
    if count.denominator != 1 or not 0 < count < meter.numerator:
        return None
    return int(count)


def audiveris_vote(first: OmrMeasure | None, meter: Meter) -> PickupVote:
    """The first measure of the piece as Audiveris saw it."""
    if first is None:
        return PickupVote("audiveris", "unknown")
    units = units_of(first.duration, meter)
    if first.special == "PICKUP":
        return PickupVote("audiveris", "pickup", units)
    if first.expected is None or first.duration is None or first.duration == 0:
        return PickupVote("audiveris", "unknown")  # an empty measure says nothing
    if first.duration >= first.expected:
        return PickupVote("audiveris", "full")
    return PickupVote("audiveris", "pickup", units) if units else PickupVote("audiveris", "unknown")


def reader_vote(first_line: ReadLine | None) -> PickupVote:
    """The first measure of the first line as the score reader described it."""
    beats = None if first_line is None else first_line.first_measure_beats
    if beats is None:
        return PickupVote("reader", "unknown")
    return PickupVote("reader", "pickup", beats) if beats > 0 else PickupVote("reader", "full")


def number_vote(lines: list[ReadLine]) -> PickupVote:
    """The printed bar numbers at the start of the lines after the first.

    A line that starts at the number after the bars before it counts the first measure in (a
    full bar); one that starts at that number less one counts it out (a pickup). Most lines win.
    """
    bar = 1 + sum(m.multi_rest_bars for m in lines[0].measures) if lines else 1
    full = pickup = 0
    for line in lines[1:]:
        if line.printed_start_number is not None:
            full += line.printed_start_number == bar
            pickup += line.printed_start_number == bar - 1
        bar += sum(m.multi_rest_bars for m in line.measures)
    if pickup > full:
        return PickupVote("numbers", "pickup")
    return PickupVote("numbers", "full") if full > pickup else PickupVote("numbers", "unknown")


def decide_pickup(votes: list[PickupVote]) -> PickupFinding:
    """A pickup when two readings say so, or one says so and at most one says it is a full bar.

    The length is the first one a reading gives (the votes come in order of trust); readings that
    give another length do not count as agreeing.
    """
    yes = [vote for vote in votes if vote.says == "pickup"]
    no = [vote for vote in votes if vote.says == "full"]
    if not yes or (len(yes) == 1 and len(no) >= PICKUP_SURE):
        return PickupFinding(None, 0, tuple(votes))
    units = next((vote.units for vote in yes if vote.units is not None), DEFAULT_UNITS)
    agreeing = [vote for vote in yes if vote.units in (None, units)]
    return PickupFinding(units, len(agreeing), tuple(votes))


def short_bars_in_the_middle(
    measures: list[tuple[int, OmrMeasure]], meters: list[MeterChange]
) -> dict[int, int]:
    """The bars Audiveris found shorter than their meter, by bar, from (bar, column) pairs.

    Only a whole number of notes of the meter's denominator counts, and only where Audiveris'
    expected duration is that of the meter. More than MAX_AUTO_SHORT_BARS means Audiveris
    misjudges this part's durations, and none are taken.
    """
    found: dict[int, int] = {}
    for bar, column in measures:
        meter = _meter_at(meters, bar)
        if column.special == "CAUTIONARY" or column.expected != Fraction(
            meter.numerator, meter.denominator
        ):
            continue
        if column.duration is None or not 0 < column.duration < column.expected:
            continue
        if (units := units_of(column.duration, meter)) is not None:
            found[bar] = units
    return found if len(found) <= MAX_AUTO_SHORT_BARS else {}


def _meter_at(meters: list[MeterChange], bar: int) -> Meter:
    found: Meter = DEFAULT_METER
    for change in sorted(meters, key=lambda change: change.from_bar):
        if change.from_bar > bar:
            break
        found = change
    return found


def first_measure(lines: list[OmrLine]) -> OmrMeasure | None:
    """The first measure of the part: the first of its first system."""
    return lines[0].system.measures[0] if lines and lines[0].system.measures else None


# ---------------------------------------------------------------- moving the numbers


def renumbered(structure: PieceStructure, by: int) -> PieceStructure:
    """The structure with every bar number moved by `by` (-1 makes bar 1 the pickup, +1 undoes
    it). Bar 1 holds the first meter either way."""
    if by not in (-1, 1):
        raise ValueError("bars move one number at a time")
    return replace(
        structure,
        bar_count=structure.bar_count + by,
        meters=_meters(structure.meters, by),
        marks=[_mark(mark, by) for mark in structure.marks],
        bar_marks=[BarMark(bar=mark.bar + by, kind=mark.kind) for mark in structure.bar_marks],
        rests=[bar + by for bar in structure.rests],
        tempo_text={bar + by: text for bar, text in structure.tempo_text.items()},
        play_order=[
            PlayOrderRow(start=row.start + by, end=row.end + by) for row in structure.play_order
        ],
        # undoing a pickup forgets its length; the length of a new one is the caller's to give
        short_bars={
            bar + by: units
            for bar, units in structure.short_bars.items()
            if not (by == 1 and bar == 0)
        },
    )


def renumbered_boxes(boxes: list[BarBox], by: int) -> list[BarBox]:
    return [box.model_copy(update={"bar": box.bar + by}) for box in boxes]


def moved_mark(mark: StructureMark, move: Callable[[int], int]) -> StructureMark:
    """The mark with its bar (and its last bar, for a volta) given by `move`."""
    end = None if mark.bar_end is None else move(mark.bar_end)
    return mark.model_copy(update={"bar": move(mark.bar), "bar_end": end})


def _mark(mark: StructureMark, by: int) -> StructureMark:
    return moved_mark(mark, lambda bar: bar + by)


def _meters(meters: list[MeterChange], by: int) -> list[MeterChange]:
    ordered = sorted(meters, key=lambda change: change.from_bar)
    moved = [
        change.model_copy(update={"from_bar": 1 if i == 0 else change.from_bar + by})
        for i, change in enumerate(ordered)
    ]
    return tidy_meters(moved)


def tidy_meters(moved: list[MeterChange]) -> list[MeterChange]:
    """Meter changes, in bar order, after their bars were moved: of changes that landed on one
    bar the last takes over, and equal neighbours are one meter."""
    kept = [
        c for i, c in enumerate(moved) if i + 1 == len(moved) or moved[i + 1].from_bar > c.from_bar
    ]
    return [
        c
        for i, c in enumerate(kept)
        if i == 0
        or (c.numerator, c.denominator) != (kept[i - 1].numerator, kept[i - 1].denominator)
    ]
