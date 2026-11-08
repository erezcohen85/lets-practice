from collections.abc import Collection, Sequence

import numpy as np

from app.pipeline.align import realign_bars
from app.pipeline.models import Locator

# Refilling the slots a structure edit left without a time (a changed play order drops the locators
# of a repeat's second pass). Only the empty slots get a time, and each run of them is held between
# the locators on either side of it, confirmed or not, so nothing the user or an earlier run placed
# ever moves. The other locators are not fixed points: a hand-edited map can hold two neighbours too
# close for the tempo limits, and that must not stop a gap elsewhere from being filled.

_NO_ANCHOR = "there is no bar with a time to fill the others around"


def fill_empty_bars(
    beat_logits: np.ndarray,
    downbeat_logits: np.ndarray,
    beats: np.ndarray,
    notated: list[float],
    locators_by_slot: list[Locator | None],
    soft: Collection[int] = (),
    rit: Collection[int] = (),
    fps: float = 50.0,
    short: Collection[int] = (),
) -> dict[int, float]:
    """The start time of every slot that has no locator, by slot; the others keep their time.

    `locators_by_slot` has one entry per slot of `notated` (None where a slot has no locator).
    The locators beside a run of empty slots are held exactly where they are, whether confirmed or
    not. Raises ValueError when the lengths differ, when no locator is present, when the held times
    are not finite and increasing, or when the empty bars do not fit between them.
    """
    slots = len(notated)
    if len(locators_by_slot) != slots:
        raise ValueError(f"{len(locators_by_slot)} locators for {slots} slots")
    empty = [slot for slot, locator in enumerate(locators_by_slot) if locator is None]
    if not empty:
        return {}
    if len(empty) == slots:
        raise ValueError(_NO_ANCHOR)
    held = [
        locator.model_copy(update={"confirmed": True})
        if locator is not None and _beside_empty(locators_by_slot, slot)
        else None
        for slot, locator in enumerate(locators_by_slot)
    ]
    times = realign_bars(beat_logits, downbeat_logits, beats, notated, held, soft, rit, fps, short)
    return {slot: times[slot] for slot in empty}


def _beside_empty(locators_by_slot: list[Locator | None], slot: int) -> bool:
    neighbours = (slot - 1, slot + 1)
    return any(0 <= n < len(locators_by_slot) and locators_by_slot[n] is None for n in neighbours)


def fill_runs_apart(
    beat_logits: np.ndarray,
    downbeat_logits: np.ndarray,
    beats: np.ndarray,
    lengths: Sequence[tuple[list[float], Collection[int]]],
    locators_by_slot: list[Locator | None],
    soft: Collection[int] = (),
    rit: Collection[int] = (),
    fps: float = 50.0,
) -> dict[int, float]:
    """The start time of the empty slots of each run that fits, each between its neighbours.

    For when no chain goes through the whole piece: only the slots from the locator before a run to
    the locator after it are aligned, so a run with no room, or labels that are off somewhere else,
    leave the other runs alone. `lengths` holds the (notated, short) to try, best first. A run that
    fits under none of them is left out of the answer.
    """
    found: dict[int, float] = {}
    for first, last in _empty_runs(locators_by_slot):
        for notated, short in lengths:
            times = _fill_window(
                beat_logits,
                downbeat_logits,
                beats,
                notated,
                short,
                locators_by_slot,
                first,
                last,
                soft,
                rit,
                fps,
            )
            if times is not None:
                found.update(times)
                break
    return found


def _empty_runs(locators_by_slot: list[Locator | None]) -> list[tuple[int, int]]:
    """Each run of slots with no locator, as (first, last), in order."""
    runs: list[tuple[int, int]] = []
    for slot, locator in enumerate(locators_by_slot):
        if locator is not None:
            continue
        if runs and runs[-1][1] == slot - 1:
            runs[-1] = (runs[-1][0], slot)
        else:
            runs.append((slot, slot))
    return runs


def _fill_window(
    beat_logits: np.ndarray,
    downbeat_logits: np.ndarray,
    beats: np.ndarray,
    notated: list[float],
    short: Collection[int],
    locators_by_slot: list[Locator | None],
    first: int,
    last: int,
    soft: Collection[int],
    rit: Collection[int],
    fps: float,
) -> dict[int, float] | None:
    """The times of the run `first`..`last` between the locators around it, or None if none fit."""
    start = max(first - 1, 0)
    # A window that opened on a short bar would be read as a pickup at the top of a piece.
    if start > 0 and start in short and locators_by_slot[start - 1] is not None:
        start -= 1
    stop = min(last + 1, len(notated) - 1)
    if start == first and stop == last:
        return None
    window = range(start, stop + 1)
    held = [
        None if slot in range(first, last + 1) else _held(locators_by_slot[slot]) for slot in window
    ]

    def shifted(slots: Collection[int]) -> set[int]:
        return {slot - start for slot in slots if slot in window}

    try:
        times = realign_bars(
            beat_logits,
            downbeat_logits,
            beats,
            notated[start : stop + 1],
            held,
            shifted(soft),
            shifted(rit),
            fps,
            shifted(short),
        )
    except ValueError:
        return None
    return {slot: times[slot - start] for slot in range(first, last + 1)}


def _held(locator: Locator | None) -> Locator | None:
    return None if locator is None else locator.model_copy(update={"confirmed": True})
