import numpy as np
import pytest

from app.pipeline.fill import fill_empty_bars
from app.pipeline.models import Locator
from tests.test_align import BarSignal, regular

# --- fill_empty_bars: only the slots without a locator are aligned ------------------------------


def present(
    times: dict[int, float], slots: int, confirmed: frozenset[int] = frozenset()
) -> list[Locator | None]:
    return [
        Locator(bar=i + 1, pass_index=0, time_sec=times[i], confirmed=i in confirmed)
        if i in times
        else None
        for i in range(slots)
    ]


def test_the_empty_slots_get_times_between_their_neighbours() -> None:
    signal, notated = regular(12)
    have = {i: t for i, t in enumerate(signal.starts) if not 4 <= i <= 7}
    found = fill_empty_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, present(have, 12)
    )
    assert sorted(found) == [4, 5, 6, 7]
    assert [found[i] for i in range(4, 8)] == pytest.approx(signal.starts[4:8], abs=0.03)
    assert have[3] < found[4] < found[5] < found[6] < found[7] < have[8]


def test_a_present_locator_is_never_moved_confirmed_or_not() -> None:
    # Every present time is a little off the music; a full realign would refit the unconfirmed
    # ones, the fill holds them all where they are.
    signal, notated = regular(10)
    have = {i: t + 0.07 for i, t in enumerate(signal.starts) if i not in (3, 4)}
    locators = present(have, 10, confirmed=frozenset({0, 9}))
    found = fill_empty_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, locators
    )
    assert sorted(found) == [3, 4]
    assert have[2] < found[3] < found[4] < have[5]


def test_present_locators_too_close_together_away_from_the_gap_do_not_stop_the_fill() -> None:
    # A hand-edited map: slots 8 and 9 sit 1.0 s apart where the tempo limits allow no such step.
    # The gap at slots 3-4 is filled all the same, and slots 8 and 9 come back unasked.
    signal, notated = regular(12)
    have = {i: t for i, t in enumerate(signal.starts) if i not in (3, 4)}
    have[9] = have[8] + 1.0
    found = fill_empty_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, present(have, 12)
    )
    assert sorted(found) == [3, 4]
    assert [found[3], found[4]] == pytest.approx(signal.starts[3:5], abs=0.03)


def test_empty_slots_at_the_start_and_the_end_are_filled_too() -> None:
    signal, notated = regular(10)
    have = {i: signal.starts[i] for i in range(3, 7)}
    found = fill_empty_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, present(have, 10)
    )
    assert sorted(found) == [0, 1, 2, 7, 8, 9]
    assert all(found[i] < have[3] for i in (0, 1, 2))
    assert all(found[i] > have[6] for i in (7, 8, 9))


def test_nothing_is_empty_gives_nothing_and_no_search() -> None:
    times = {i: 1.0 + 2.0 * i for i in range(4)}
    found = fill_empty_bars(np.zeros(0), np.zeros(0), np.zeros(0), [4] * 4, present(times, 4))
    assert found == {}


def test_a_gap_that_is_a_different_meter_follows_the_notated_beats() -> None:
    signal = BarSignal([4] * 4 + [3] * 4 + [4] * 4)
    notated = [4] * 4 + [3] * 4 + [4] * 4
    have = {i: t for i, t in enumerate(signal.starts) if not 4 <= i <= 7}
    found = fill_empty_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, present(have, 12)
    )
    assert [found[i] for i in range(4, 8)] == pytest.approx(signal.starts[4:8], abs=0.03)


def test_with_no_locator_at_all_there_is_nothing_to_hold_the_fill_by() -> None:
    signal, notated = regular(6)
    with pytest.raises(ValueError, match="no bar with a time"):
        fill_empty_bars(
            signal.beat_logits, signal.downbeat_logits, signal.beats, notated, [None] * 6
        )


def test_present_locators_out_of_time_order_cannot_be_held() -> None:
    signal, notated = regular(8)
    have = {2: signal.starts[5], 5: signal.starts[2]}
    with pytest.raises(ValueError, match="order"):
        fill_empty_bars(
            signal.beat_logits, signal.downbeat_logits, signal.beats, notated, present(have, 8)
        )


def test_a_gap_too_short_for_its_bars_cannot_be_filled() -> None:
    # Four empty bars of 4 beats cannot fit in 1.0 s between two held locators.
    signal, notated = regular(10)
    have = {i: signal.starts[i] for i in range(10) if not 3 <= i <= 6}
    have[7] = have[2] + 1.0
    with pytest.raises(ValueError):
        fill_empty_bars(
            signal.beat_logits, signal.downbeat_logits, signal.beats, notated, present(have, 10)
        )


def test_one_entry_per_slot_is_needed() -> None:
    signal, notated = regular(6)
    with pytest.raises(ValueError, match="locators for 6 slots"):
        fill_empty_bars(
            signal.beat_logits, signal.downbeat_logits, signal.beats, notated, [None] * 5
        )
