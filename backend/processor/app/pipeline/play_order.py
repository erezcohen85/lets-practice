from dataclasses import dataclass, replace
from enum import StrEnum

from pydantic import BaseModel

from app.pipeline.models import PlayOrderRow

# The simulation gives up after this many bar visits per bar of the piece.
STEP_LIMIT_FACTOR = 10


# How a warning ends when the marks could not be followed: straight through is then a fallback, not
# what the score was read to say.
STRAIGHT_THROUGH = ", so the piece is played straight through."


class MarkKind(StrEnum):
    """A structure sign printed in the score."""

    REPEAT_START = "repeat-start"  # |: at the start of `bar`
    REPEAT_END = "repeat-end"  # :| at the end of `bar`
    VOLTA = "volta"  # ending `number` covering bar..bar_end
    SEGNO = "segno"
    CODA = "coda"
    TO_CODA = "to-coda"
    FINE = "fine"
    DS_AL_CODA = "ds-al-coda"
    DS_AL_FINE = "ds-al-fine"
    DC_AL_CODA = "dc-al-coda"
    DC_AL_FINE = "dc-al-fine"


class StructureMark(BaseModel):
    """One sign at a bar; a volta also has bar_end (default: bar) and its ending number."""

    kind: MarkKind
    bar: int
    bar_end: int | None = None
    number: int | None = None


class PlayOrderProposal(BaseModel):
    """The proposed play-order rows and plain-sentence warnings about what could not be resolved."""

    rows: list[PlayOrderRow]
    warnings: list[str]


_LABELS = {
    MarkKind.REPEAT_START: "repeat-start sign",
    MarkKind.REPEAT_END: "repeat-end sign",
    MarkKind.VOLTA: "volta ending",
    MarkKind.SEGNO: "segno",
    MarkKind.CODA: "coda sign",
    MarkKind.TO_CODA: "to-coda sign",
    MarkKind.FINE: "fine sign",
    MarkKind.DS_AL_CODA: "D.S. al coda",
    MarkKind.DS_AL_FINE: "D.S. al fine",
    MarkKind.DC_AL_CODA: "D.C. al coda",
    MarkKind.DC_AL_FINE: "D.C. al fine",
}
_DS_KINDS = (MarkKind.DS_AL_CODA, MarkKind.DS_AL_FINE)
_JUMP_KINDS = (*_DS_KINDS, MarkKind.DC_AL_CODA, MarkKind.DC_AL_FINE)
_AL_CODA_KINDS = (MarkKind.DS_AL_CODA, MarkKind.DC_AL_CODA)


class _Unresolvable(Exception):
    """The marks cannot be played as written; the message is a clause naming the problem."""


@dataclass(frozen=True)
class _Ending:
    """One bar of a volta ending and what decides whether it is played."""

    number: int
    last_number: int  # the highest ending number in this ending's group
    first_ending_repeat_bars: tuple[int, ...]  # repeat-end bars inside the group's 1st ending


@dataclass(frozen=True)
class _Plan:
    """The marks, checked and arranged for the simulation."""

    bar_count: int
    repeat_to: dict[int, int]  # bar of a repeat-end sign -> bar its repeat goes back to
    endings: dict[int, _Ending]  # bar -> the ending it belongs to
    jump_bar: int | None  # the bar after which D.S. / D.C. jumps
    jump_to: int  # the segno bar, or 1 for D.C.
    stop_bar: int | None  # the fine bar, when the jump is "al fine"
    coda_jump: tuple[int, int] | None  # (to-coda bar, coda bar), when the jump is "al coda"


def propose_play_order(marks: list[StructureMark], bar_count: int) -> PlayOrderProposal:
    """Simulate playback of the marks; fall back to straight through plus a warning if unclear."""
    if bar_count < 1:
        raise ValueError(f"bar_count must be an integer of at least 1, got {bar_count}")
    try:
        order = _walk(_read_marks(marks, bar_count))
    except _Unresolvable as problem:
        straight = [PlayOrderRow(start=1, end=bar_count)]
        return PlayOrderProposal(rows=straight, warnings=[f"{problem}{STRAIGHT_THROUGH}"])
    return PlayOrderProposal(rows=_compress(order), warnings=[])


def order_without_repeats(marks: list[StructureMark], bar_count: int) -> list[PlayOrderRow]:
    """The play order of a performance that takes no repeat: 1st endings are left out, D.S. and
    D.C. are still followed. Marks that cannot be followed give straight through."""
    try:
        plan = _read_marks(marks, bar_count)
        first_endings = {bar for bar, ending in plan.endings.items() if ending.number == 1}
        order = _walk(replace(plan, repeat_to={}, endings={}))
    except _Unresolvable:
        return [PlayOrderRow(start=1, end=bar_count)]
    return _compress([bar for bar in order if bar not in first_endings])


def _compress(order: list[int]) -> list[PlayOrderRow]:
    """Merge consecutive played bars into rows."""
    rows: list[PlayOrderRow] = []
    start = previous = order[0]
    for bar in order[1:]:
        if bar != previous + 1:
            rows.append(PlayOrderRow(start=start, end=previous))
            start = bar
        previous = bar
    rows.append(PlayOrderRow(start=start, end=previous))
    return rows


def _read_marks(marks: list[StructureMark], bar_count: int) -> _Plan:
    """Check the marks against each other and the piece, or raise _Unresolvable."""
    for found in marks:
        _check_in_range(found, bar_count)
    starts = sorted(m.bar for m in marks if m.kind is MarkKind.REPEAT_START)
    ends = sorted(m.bar for m in marks if m.kind is MarkKind.REPEAT_END)
    for before, after in zip(ends, ends[1:], strict=False):
        if not any(before < start <= after for start in starts):
            raise _Unresolvable(
                f"The repeat-end signs at bars {before} and {after} have no repeat-start sign "
                "between them"
            )
    repeat_to = {end: max((s for s in starts if s <= end), default=1) for end in ends}
    endings = _read_endings(marks, ends)

    jump = _only(marks, _JUMP_KINDS, "D.S. or D.C. mark")
    segno = _only(marks, (MarkKind.SEGNO,), "segno")
    to_coda = _only(marks, (MarkKind.TO_CODA,), "to-coda sign")
    coda = _only(marks, (MarkKind.CODA,), "coda sign")
    fine = _only(marks, (MarkKind.FINE,), "fine sign")
    if jump is None:
        return _Plan(bar_count, repeat_to, endings, None, 1, None, None)

    name = f"{_LABELS[jump.kind]} at bar {jump.bar}"
    jump_to = 1
    if jump.kind in _DS_KINDS:
        if segno is None:
            raise _Unresolvable(f"{name} has no segno to jump back to")
        if segno.bar > jump.bar:
            raise _Unresolvable(f"{name} comes before its segno at bar {segno.bar}")
        jump_to = segno.bar
    if jump.kind in _AL_CODA_KINDS:
        if to_coda is None or coda is None:
            absent = " or ".join(
                label
                for label, sign in (("to-coda sign", to_coda), ("coda sign", coda))
                if sign is None
            )
            raise _Unresolvable(
                f"{name} needs both a to-coda sign and a coda sign, but has no {absent}"
            )
        if to_coda.bar < jump_to:
            raise _Unresolvable(
                f"{name} never reaches the to-coda sign at bar {to_coda.bar}, "
                f"which comes before bar {jump_to}"
            )
        return _Plan(
            bar_count, repeat_to, endings, jump.bar, jump_to, None, (to_coda.bar, coda.bar)
        )
    if fine is None:
        raise _Unresolvable(f"{name} has no fine sign to stop at")
    if fine.bar < jump_to:
        raise _Unresolvable(
            f"{name} never reaches the fine sign at bar {fine.bar}, "
            f"which comes before bar {jump_to}"
        )
    return _Plan(bar_count, repeat_to, endings, jump.bar, jump_to, fine.bar, None)


def _check_in_range(found: StructureMark, bar_count: int) -> None:
    last = found.bar
    if found.kind is MarkKind.VOLTA and found.bar_end is not None:
        last = found.bar_end
    if found.bar < 1 or last < found.bar or last > bar_count:
        raise _Unresolvable(
            f"The {_LABELS[found.kind]} at {_where(found.bar, last)} is outside the "
            f"{bar_count} bars of the piece"
        )


def _only(
    marks: list[StructureMark], kinds: tuple[MarkKind, ...], name: str
) -> StructureMark | None:
    """The one mark of these kinds, None if there is none; more than one is unclear."""
    found = [m for m in marks if m.kind in kinds]
    if len(found) > 1:
        raise _Unresolvable(f"The piece has more than one {name}")
    return found[0] if found else None


def _read_endings(marks: list[StructureMark], repeat_ends: list[int]) -> dict[int, _Ending]:
    """Group the voltas into 1st / 2nd endings and map every ending bar to its ending."""
    voltas = sorted((m for m in marks if m.kind is MarkKind.VOLTA), key=lambda m: m.bar)
    groups: list[list[StructureMark]] = []
    for volta in voltas:
        if volta.number is None:
            raise _Unresolvable(
                f"The volta ending at {_where(volta.bar, _end(volta))} has no number"
            )
        if groups:
            previous = groups[-1][-1]
            if volta.bar <= _end(previous):
                raise _Unresolvable(
                    f"The volta endings at {_where(previous.bar, _end(previous))} and "
                    f"{_where(volta.bar, _end(volta))} overlap"
                )
            if volta.bar == _end(previous) + 1 and (volta.number or 0) > (previous.number or 0):
                groups[-1].append(volta)
                continue
        groups.append([volta])

    endings: dict[int, _Ending] = {}
    for group in groups:
        numbers = [volta.number or 0 for volta in group]
        if numbers not in ([1], [1, 2]):
            raise _Unresolvable(
                f"The volta endings starting at bar {group[0].bar} are numbered "
                f"{', '.join(map(str, numbers))}, but only a 1st ending and an optional 2nd "
                "ending can be followed"
            )
        first_start, first_end = group[0].bar, _end(group[0])
        repeat_bars = tuple(r for r in repeat_ends if first_start <= r <= first_end)
        if not repeat_bars:
            raise _Unresolvable(
                f"The 1st ending at {_where(first_start, first_end)} has no repeat-end sign"
            )
        for volta, number in zip(group, numbers, strict=True):
            ending = _Ending(number, numbers[-1], repeat_bars)
            for bar in range(volta.bar, _end(volta) + 1):
                endings[bar] = ending
    return endings


def _end(volta: StructureMark) -> int:
    """The last bar of a volta ending."""
    return volta.bar if volta.bar_end is None else volta.bar_end


def _where(first: int, last: int) -> str:
    """Name a bar or a span of bars for a warning."""
    return f"bar {first}" if first == last else f"bars {first}-{last}"


def _ending_is_played(ending: _Ending, taken: set[int], jumped: bool) -> bool:
    """Whether this ending plays now: the 1st ending on pass one, the 2nd on pass two."""
    if jumped:
        return ending.number == ending.last_number
    second_pass = any(bar in taken for bar in ending.first_ending_repeat_bars)
    return ending.number == (2 if second_pass else 1)


def _walk(plan: _Plan) -> list[int]:
    """Play the piece bar by bar and return the played bars in order."""
    order: list[int] = []
    taken: set[int] = set()  # repeat-end bars that already sent playback back
    jumped = False  # past the D.S. / D.C.: repeats are not taken, last endings are played
    at_coda = False
    bar = 1
    steps = 0
    limit = STEP_LIMIT_FACTOR * plan.bar_count
    while bar <= plan.bar_count:
        steps += 1
        if steps > limit:
            raise _Unresolvable("The marks send playback round in circles")
        ending = plan.endings.get(bar)
        if ending is not None and not _ending_is_played(ending, taken, jumped):
            bar += 1
            continue
        order.append(bar)
        following = bar + 1
        if jumped:
            if bar == plan.stop_bar:
                break
            if plan.coda_jump is not None and bar == plan.coda_jump[0] and not at_coda:
                at_coda = True
                following = plan.coda_jump[1]
        elif bar in plan.repeat_to and bar not in taken:
            taken.add(bar)
            following = plan.repeat_to[bar]
        elif bar == plan.jump_bar:
            jumped = True
            following = plan.jump_to
        bar = following
    return order
