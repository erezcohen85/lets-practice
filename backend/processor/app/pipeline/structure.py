import re
from dataclasses import dataclass, field, replace
from typing import Literal

from pydantic import ValidationError

from app.pipeline.models import (
    BarMark,
    Meter,
    MeterChange,
    PlayOrderRow,
    check_size,
    expand_play_order,
)
from app.pipeline.omr import DEFAULT_METER
from app.pipeline.play_order import (
    MarkKind,
    StructureMark,
    order_without_repeats,
    propose_play_order,
)
from app.pipeline.score_reader import Reading, ReadLine, ReadMeasure

# What a reading of the score means: the measure count of every line is settled first
# (merge_reading, with the counts the consensus chose), then the reading becomes the piece's
# structure in the app's own types (meters, repeat and navigation marks, fermatas, rit. spans,
# tempo words) and the per-slot facts the alignment takes. Ported from the PoC's structure_text.py
# and consensus.py; the play order itself comes from play_order.propose_play_order.


MAX_RIT_BARS = 8  # a rit. span covers at most this many bars
_SLOW = r"rall|rit(?!m)|ritard|riten|rallent|slower"
_ACCEL = r"accel|faster|stringendo"
# What the alignment may stretch: slowing down and, like the PoC, speeding up (the tempo moves).
_RIT_WORDS = re.compile(rf"\b(?:{_SLOW}|{_ACCEL})", re.IGNORECASE)
_COMPOUND = {6, 9, 12}  # x/8 with these numerators is felt in x/3 beats
_SIGNATURE = re.compile(r"^(\d+)\s*/\s*(\d+)$")


class StructureError(ValueError):
    """The reading cannot be used; the message is one sentence a user may read."""


@dataclass(frozen=True)
class PieceStructure:
    """What a reading says about the piece, in the app's types; bar numbers are written bars."""

    bar_count: int  # multi-rests counted in full
    meters: list[MeterChange]
    marks: list[StructureMark]  # repeats, voltas, navigation: the input of propose_play_order
    # a fermata on its bar, every bar of a rit. / rall. / accel. span as "rit"
    bar_marks: list[BarMark]
    tempo_text: dict[int, str]  # tempo and character words by the bar they start on
    part_name: str | None
    play_order: list[PlayOrderRow]  # propose_play_order(marks, bar_count)
    warnings: list[str]
    # bars shorter than their meter, by bar: how many notes of the meter's denominator they hold.
    # Bar 0 is a pickup; then bar_count stays the printed count (1..bar_count) and bar 0 is extra.
    short_bars: dict[int, int] = field(default_factory=dict)
    # the bars this part rests (every bar of a multi-rest); a part's own, not the piece's
    rests: list[int] = field(default_factory=list)
    # how many readings of the score called bar 0 a pickup (0 without one); fewer than two make
    # the Review Queue ask
    pickup_sources: int = 0


def blank_measure() -> ReadMeasure:
    """A measure with nothing marked on it."""
    return ReadMeasure(
        multi_rest_bars=1,
        time_signature=None,
        fermata_beats=[],
        text=[],
        repeat="none",
        volta=None,
        navigation=None,
    )


def fit_measures(measures: list[ReadMeasure], count: int) -> list[ReadMeasure]:
    """The measures mapped by order onto `count` measures: the extra ones dropped, missing blank."""
    return [*measures[:count], *(blank_measure() for _ in range(count - len(measures)))]


def bars_of(measures: list[ReadMeasure]) -> int:
    """The written bars the measures hold, a multi-rest counting in full."""
    return sum(m.multi_rest_bars for m in measures)


def merge_reading(
    first: Reading, counts: list[int], rereads: dict[int, ReadLine]
) -> tuple[Reading, list[str]]:
    """The reading with every line at its chosen measure count, and warnings for the doubtful.

    `counts` is the chosen count per line; `rereads` maps a line's index to the line the second
    look at it gave, which then supplies the line's measures. A line that still has another count
    than chosen keeps the chosen count: its measures are mapped by order (extra ones dropped,
    missing ones blank) and a warning asks the user to check. The page and the printed number of a
    line stay those of the first reading.
    """
    lines: list[ReadLine] = []
    warnings: list[str] = []
    bar = 1
    for i, (line, count) in enumerate(zip(first.lines, counts, strict=True)):
        source = rereads.get(i, line).measures
        measures = fit_measures(source, count)
        lines.append(line.model_copy(update={"measures": measures}))
        span = bars_of(measures)
        if len(source) != count:
            warnings.append(
                f"Line {i + 1} (bars {bar}-{bar + span - 1}): the page shows {count} measures "
                f"but the score reading saw {len(source)}; check it."
            )
        bar += span
    return first.model_copy(update={"lines": lines}), warnings


def _where(first: int, last: int, delta: int) -> str:
    """Which lines hold the bars the printed number is off by (1-based), and how."""
    bars = f"{abs(delta)} bar{'s' if abs(delta) > 1 else ''}"
    fault = f"{bars} short" if delta > 0 else f"{bars} too many"
    if first == last:
        return f"Line {first} may be {fault}." if delta > 0 else f"Line {first} may have {fault}."
    return f"Lines {first} to {last} together may be {fault}."


# What marks a warning as being about the printed bar numbers: they are compared with the first
# read's counts, so Advanced Reading, which changes counts, drops them (structure_shift.py).
PRINTED_NUMBER_WORDS = "starts with printed bar number"


def number_warnings(reading: Reading) -> list[str]:
    """A warning where a printed start number stops fitting the bars before the line.

    A number that is not 1 + the bars before the line is warned about once, where the count went
    wrong: the lines after it that are off by the same amount are not, and the warning names the
    lines between the last printed number that fitted (or the first line) and this one, where the
    missing or extra bar is.
    """
    warnings: list[str] = []
    bar = 1
    off = 0  # how far the last printed number was from the count: printed - counted
    anchor = 0  # the line index of the last printed number
    for i, line in enumerate(reading.lines):
        printed = line.printed_start_number
        if printed is not None:
            delta = printed - bar - off  # how far this number is off beyond the last one
            if printed != bar and delta != 0:
                warnings.append(
                    f"Line {i + 1} {PRINTED_NUMBER_WORDS} {printed}, but the lines before "
                    f"it hold {bar - 1} bars; check it. {_where(anchor + 1, i, delta)}"
                )
            off = printed - bar
            anchor = i
        bar += bars_of(line.measures)
    return warnings


# ---------------------------------------------------------------- from a reading


@dataclass(frozen=True)
class _Placed:
    """A measure and the written bars it covers (a multi-rest covers several)."""

    first: int
    last: int
    measure: ReadMeasure


def _place(reading: Reading) -> list[_Placed]:
    placed: list[_Placed] = []
    bar = 0
    for line in reading.lines:
        for m in line.measures:
            placed.append(_Placed(bar + 1, bar + m.multi_rest_bars, m))
            bar += m.multi_rest_bars
    return placed


def structure_from_reading(reading: Reading) -> PieceStructure:
    """The piece's meters, marks, fermatas, rit. spans and proposed play order from a reading."""
    placed = _place(reading)
    if not placed:
        raise StructureError("The score reading has no bars.")
    bar_count = placed[-1].last
    warnings: list[str] = []
    meters = _meters(placed, warnings)
    marks = [*_repeat_marks(placed), *_volta_marks(placed), *_navigation_marks(placed, warnings)]
    tempo_text = {p.first: " / ".join(p.measure.text) for p in placed if p.measure.text}
    proposal = propose_play_order(marks, bar_count)
    return PieceStructure(
        bar_count=bar_count,
        meters=meters,
        marks=marks,
        bar_marks=_bar_marks(placed, _rit_bars(tempo_text, bar_count)),
        rests=_rests(placed),
        tempo_text=tempo_text,
        part_name=reading.part_name,
        play_order=proposal.rows,
        warnings=[*warnings, *proposal.warnings],
    )


def _parse_signature(text: str) -> Meter | None:
    """'6/8' -> 6/8; 'C' is 4/4 and cut time is 2/2; None if it is not a time signature."""
    clean = text.strip()
    if clean.upper() == "C":
        return Meter(numerator=4, denominator=4)
    if clean.upper() in ("C|", "CUT", "\u00a2"):
        return Meter(numerator=2, denominator=2)
    match = _SIGNATURE.match(clean)
    if match is None:
        return None
    try:
        return Meter(numerator=int(match[1]), denominator=int(match[2]))
    except ValidationError:
        return None


def _meters(placed: list[_Placed], warnings: list[str]) -> list[MeterChange]:
    printed: list[tuple[int, Meter]] = []
    for p in placed:
        text = p.measure.time_signature
        if not text:
            continue
        meter = _parse_signature(text)
        if meter is None:
            warnings.append(
                f'The time signature "{text}" at bar {p.first} was not understood and is ignored.'
            )
            continue
        printed.append((p.first, meter))
    if not printed or printed[0][0] != 1:
        printed.insert(0, (1, DEFAULT_METER))
        warnings.append(
            f"No time signature is printed at bar 1, so "
            f"{DEFAULT_METER.numerator}/{DEFAULT_METER.denominator} is assumed."
        )
    changes: list[MeterChange] = []
    current: Meter | None = None
    for bar, meter in printed:
        if meter != current:
            changes.append(
                MeterChange(numerator=meter.numerator, denominator=meter.denominator, from_bar=bar)
            )
            current = meter
    return changes


def beats_per_bar(meter: Meter) -> int:
    """The numerator, except compound x/8 with x in {6, 9, 12}, which is felt in x/3."""
    if meter.denominator == 8 and meter.numerator in _COMPOUND:
        return meter.numerator // 3
    return meter.numerator


def _bar_marks(placed: list[_Placed], rit_bars: set[int]) -> list[BarMark]:
    marks: list[BarMark] = []
    for p in placed:
        if p.measure.fermata_beats:
            marks.append(BarMark(bar=p.first, kind="fermata"))
    marks.extend(BarMark(bar=b, kind="rit") for b in sorted(rit_bars))
    return sorted(marks, key=lambda mark: mark.bar)  # stable: a bar's fermata comes first


def _rests(placed: list[_Placed]) -> list[int]:
    """Every bar of a multi-rest."""
    return [b for p in placed if p.measure.multi_rest_bars > 1 for b in range(p.first, p.last + 1)]


def _repeat_marks(placed: list[_Placed]) -> list[StructureMark]:
    """Repeat signs per bar. A multi-rest's start sign lands on its first bar, its end sign on its
    last. A "both" sign (:||:) closes the section before it and opens the next one at it."""
    found: dict[tuple[MarkKind, int], None] = {}  # ordered, without doubles
    for p in placed:
        sign = p.measure.repeat
        if sign in ("start", "both"):
            found[(MarkKind.REPEAT_START, p.first)] = None
        if sign == "both" and p.first > 1:
            found[(MarkKind.REPEAT_END, p.first - 1)] = None
        if sign == "end":
            found[(MarkKind.REPEAT_END, p.last)] = None
    return [StructureMark(kind=kind, bar=bar) for kind, bar in found]


def _volta_marks(placed: list[_Placed]) -> list[StructureMark]:
    """One mark per run of consecutive measures under the same ending number."""
    marks: list[StructureMark] = []
    run: tuple[int, int, int] | None = None  # (number, first bar, last bar)
    for p in placed:
        number = p.measure.volta
        if run is not None and number == run[0]:
            run = (run[0], run[1], p.last)
            continue
        if run is not None:
            marks.append(_volta(run))
        run = None if number is None else (number, p.first, p.last)
    if run is not None:
        marks.append(_volta(run))
    return marks


def _volta(run: tuple[int, int, int]) -> StructureMark:
    number, first, last = run
    return StructureMark(kind=MarkKind.VOLTA, bar=first, bar_end=last, number=number)


_JUMPS = {
    ("ds", "coda"): MarkKind.DS_AL_CODA,
    ("ds", "fine"): MarkKind.DS_AL_FINE,
    ("dc", "coda"): MarkKind.DC_AL_CODA,
    ("dc", "fine"): MarkKind.DC_AL_FINE,
}
_JUMP_WORDS = (("ds", r"\b(ds|dal segno)\b"), ("dc", r"\b(dc|da capo)\b"))
# Signs that sit at the start of a measure; the others (a jump, "to coda", "fine") happen after it.
_AT_START = (MarkKind.SEGNO, MarkKind.CODA)


def _classify(text: str) -> MarkKind | Literal["ds", "dc"] | None:
    """What a printed navigation word is; "ds" / "dc" alone still need their target."""
    words = " ".join(text.lower().replace(".", "").split())
    target = "coda" if "coda" in words else "fine" if "fine" in words else None
    for jump, pattern in _JUMP_WORDS:
        if re.search(pattern, words):
            return jump if target is None else _JUMPS[(jump, target)]
    if "segno" in words:
        return MarkKind.SEGNO
    if "coda" in words:
        return MarkKind.TO_CODA if re.search(r"\b(to|al)\b", words) else MarkKind.CODA
    if "fine" in words:
        return MarkKind.FINE
    return None


def _navigation_marks(placed: list[_Placed], warnings: list[str]) -> list[StructureMark]:
    """Segno, coda, fine and D.S. / D.C. signs. A bare D.S. / D.C. goes "al fine" when the piece
    has a fine sign, else "al coda" when it has a coda. A jump, a to-coda or a fine sign sits on
    the last bar of its measure (after a multi-rest, not before it); a segno or coda on the first.
    """
    signs = [(p, p.measure.navigation) for p in placed if p.measure.navigation]
    classified = [(p, text, _classify(text)) for p, text in signs]
    kinds = {sign for _, _, sign in classified if isinstance(sign, MarkKind)}
    has_fine = MarkKind.FINE in kinds
    has_coda = bool(kinds & {MarkKind.TO_CODA, MarkKind.CODA})
    marks: list[StructureMark] = []
    for p, text, sign in classified:
        if sign is None:
            warnings.append(
                f'The mark "{text}" at bar {p.first} was not understood and is ignored.'
            )
            continue
        if sign in ("ds", "dc"):
            target = "fine" if has_fine else "coda" if has_coda else None
            if target is None:
                name = "D.S." if sign == "ds" else "D.C."
                warnings.append(
                    f"The {name} at bar {p.last} has no fine or coda to go with it, "
                    "so it is ignored."
                )
                continue
            sign = _JUMPS[(sign, target)]
        marks.append(StructureMark(kind=sign, bar=p.first if sign in _AT_START else p.last))
    return marks


def _rit_bars(tempo_text: dict[int, str], total: int) -> set[int]:
    """Bars under a rit./rall./accel. word.

    A span starts at a bar whose words match and runs up to the bar before the next text mark of
    any kind, at most MAX_RIT_BARS bars, at least the bar itself.
    """
    marked = sorted(b for b in tempo_text if b <= total)
    bars: set[int] = set()
    for i, bar in enumerate(marked):
        if not _RIT_WORDS.search(tempo_text[bar]):
            continue
        next_mark = marked[i + 1] if i + 1 < len(marked) else total + 1
        last = min(next_mark - 1, bar + MAX_RIT_BARS - 1, total)
        bars.update(range(bar, max(last, bar) + 1))
    return bars


# ---------------------------------------------------------------- what the alignment takes


def alignment_inputs(
    structure: PieceStructure, rows: list[PlayOrderRow]
) -> tuple[list[float], set[int], set[int]]:
    """(notated, soft, rit) over the slots of the play order `rows` (0-based positions).

    `notated[i]` is the beats of slot i's bar (a fraction for a bar shorter than its meter: see
    `short_slots`); `soft` the slots that may stretch (fermata bars and the last slot); `rit` the
    slots whose bar has a rit. mark (a rit. / rall. / accel. span).
    """
    beats = _beats_by_bar(structure)
    fermatas = {m.bar for m in structure.bar_marks if m.kind == "fermata"}
    slots = expand_play_order(rows, structure.bar_count)
    notated = [beats[slot.bar] for slot in slots]
    soft = {slot.position for slot in slots if slot.bar in fermatas}
    if slots:
        soft.add(len(slots) - 1)
    rit_bars = {m.bar for m in structure.bar_marks if m.kind == "rit"}
    rit = {slot.position for slot in slots if slot.bar in rit_bars}
    return notated, soft, rit


def short_slots(structure: PieceStructure, rows: list[PlayOrderRow]) -> set[int]:
    """The slots of the play order `rows` whose bar is shorter than its meter (a pickup, an
    incomplete bar): the alignment gives them no beat comb."""
    slots = expand_play_order(rows, structure.bar_count)
    return {slot.position for slot in slots if slot.bar in structure.short_bars}


def with_the_pickup_of(structure: PieceStructure, rows: list[PlayOrderRow]) -> list[PlayOrderRow]:
    """The play-order rows `rows` (made from the marks, so they start at bar 1) with bar 0 in front
    of the first one when the structure has a pickup, as its own play order starts."""
    if structure.play_order and structure.play_order[0].start == 0 and rows[0].start == 1:
        return [PlayOrderRow(start=0, end=rows[0].end), *rows[1:]]
    return rows


def without_repeats(structure: PieceStructure) -> PieceStructure:
    """The piece as a recording that takes no repeat plays it; a pickup stays in front."""
    rows = order_without_repeats(structure.marks, structure.bar_count)
    return replace(structure, play_order=with_the_pickup_of(structure, rows))


def units_per_beat(meter: Meter) -> int:
    """How many notes of the meter's denominator make one felt beat: 3 in compound x/8, else 1."""
    return 3 if meter.denominator == 8 and meter.numerator in _COMPOUND else 1


def _beats_by_bar(structure: PieceStructure) -> dict[int, float]:
    """Beats per written bar, bar 0 (a pickup) included when the structure has one."""
    check_size(structure.bar_count, 0)
    changes = sorted(structure.meters, key=lambda change: change.from_bar)
    beats: dict[int, float] = {}
    for i, change in enumerate(changes):
        end = changes[i + 1].from_bar if i + 1 < len(changes) else structure.bar_count + 1
        for bar in range(change.from_bar, end):
            beats[bar] = beats_per_bar(change)
    for bar, units in structure.short_bars.items():
        meter = _meter_in_force(changes, bar)
        beats[bar] = units / units_per_beat(meter)
    return beats


def _meter_in_force(changes: list[MeterChange], bar: int) -> MeterChange:
    """The meter at a bar: the last change at or before it, the first for a pickup."""
    found = changes[0]
    for change in changes:
        if change.from_bar <= bar:
            found = change
    return found
