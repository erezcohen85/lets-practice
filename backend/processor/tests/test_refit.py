import time

import numpy as np
import pytest

from app.pipeline.analysis import Analysis, Heard
from app.pipeline.models import MAX_SLOTS, PlayOrderRow, expand_play_order
from app.pipeline.refit import fill_timing, notated_per_heard, realign_timing, split_beats
from app.pipeline.run_folder import RunFolderError, parse_timing
from app.pipeline.stages import FAKE_FPS, AudioResult, FakeDownbeatStage
from tests.test_align import FIRST, BarSignal


def analysis() -> Analysis:
    audio = AudioResult(peaks={}, duration_sec=18.0)
    return Analysis(18.0, FakeDownbeatStage().listen(audio))


def timing(locators: list[dict]) -> dict:
    return {
        "timing": {
            "barCount": 8,
            "playOrder": [{"from": 1, "to": 8}],
            "meters": [{"fromBar": 1, "numerator": 4, "denominator": 4}],
            "marks": [],
            "locators": locators,
        }
    }


def locator(bar: int, time: float, confirmed: bool = True) -> dict:
    return {"bar": bar, "passIndex": 0, "timeSec": time, "confirmed": confirmed}


def test_it_fills_only_the_empty_bars_and_leaves_the_others() -> None:
    body = timing([])
    body["timing"]["barCount"] = 6
    body["timing"]["playOrder"] = [{"from": 1, "to": 6}, {"from": 5, "to": 6}]  # 8 slots
    flag = {
        "kind": "crowded",
        "severity": 1,
        "expected": 4,
        "found": 3,
        "factor": None,
        "explainedBy": None,
        "uncertainLine": None,
    }
    given = [
        {**locator(1, 0.5), "flags": [flag], "checked": True},
        locator(2, 2.5, confirmed=False),
        locator(3, 4.5),
        locator(6, 10.5, confirmed=False),
        {"bar": 5, "passIndex": 1, "timeSec": 12.5, "confirmed": False},
        {"bar": 6, "passIndex": 1, "timeSec": 14.5, "confirmed": True},
    ]
    body["timing"]["locators"] = given
    filled = fill_timing(parse_timing(body), analysis())
    dumped = {
        (item.bar, item.passIndex): item.model_dump(by_alias=True, exclude_unset=True)
        for item in filled.locators
    }
    assert len(dumped) == 8
    for item in parse_timing(body).locators:
        assert dumped[(item.bar, item.passIndex)] == item.model_dump(
            by_alias=True, exclude_unset=True
        )
    new_ones = [dumped[key] for key in ((4, 0), (5, 0))]
    assert [item["confirmed"] for item in new_ones] == [False, False]
    assert all(set(item) == {"bar", "passIndex", "timeSec", "confirmed"} for item in new_ones)
    assert dumped[(4, 0)]["timeSec"] == pytest.approx(6.5, abs=2 / FAKE_FPS)
    assert dumped[(5, 0)]["timeSec"] == pytest.approx(8.5, abs=2 / FAKE_FPS)


def test_a_timing_with_no_meter_is_a_sentence() -> None:
    body = timing([])
    body["timing"]["meters"] = []
    with pytest.raises(RunFolderError, match="no meter"):
        fill_timing(parse_timing(body), analysis())


def test_a_timing_with_no_locator_at_all_is_a_sentence() -> None:
    with pytest.raises(RunFolderError, match="Re-align failed"):
        fill_timing(parse_timing(timing([])), analysis())


def test_the_arrays_are_not_written_to() -> None:
    held = analysis()
    before = np.copy(held.heard.beat_logits)
    fill_timing(parse_timing(timing([locator(1, 0.5)])), held)
    assert np.array_equal(held.heard.beat_logits, before)


def test_a_timing_with_a_meter_that_starts_after_bar_1_is_a_sentence() -> None:
    body = timing([locator(1, 0.5)])
    body["timing"]["meters"] = [{"fromBar": 3, "numerator": 4, "denominator": 4}]
    with pytest.raises(RunFolderError, match="first meter must start at bar 1"):
        fill_timing(parse_timing(body), analysis())


def test_a_huge_bar_count_is_refused_before_any_work() -> None:
    body = timing([locator(1, 0.5)])
    body["timing"]["barCount"] = 200_000
    body["timing"]["playOrder"] = [{"from": 1, "to": 200_000}]
    start = time.monotonic()
    with pytest.raises(RunFolderError, match="too large"):
        fill_timing(parse_timing(body), analysis())
    assert time.monotonic() - start < 1.0


def test_more_locators_than_slots_allowed_is_refused() -> None:
    many = [
        {"bar": 1, "passIndex": i, "timeSec": 0.5 + i, "confirmed": True}
        for i in range(MAX_SLOTS + 1)
    ]
    body = timing(many)
    with pytest.raises(RunFolderError, match="too large"):
        fill_timing(parse_timing(body), analysis())


def test_the_play_order_walk_and_the_beat_count_refuse_a_huge_piece() -> None:
    huge = [PlayOrderRow(start=1, end=MAX_SLOTS + 1)]
    with pytest.raises(ValueError, match="too large"):
        expand_play_order(huge, MAX_SLOTS + 1)
    with pytest.raises(ValueError, match="too large"):
        expand_play_order([PlayOrderRow(start=1, end=2)], 10 * MAX_SLOTS)


def test_the_sample_sized_pieces_are_far_under_the_limit() -> None:
    assert MAX_SLOTS >= 20 * 126  # the largest sample piece has 126 slots


def test_a_pickup_with_no_number_is_aligned_like_any_short_bar() -> None:
    """The flag is only how the bar is labelled; the alignment's inputs are the same without it."""
    from app.pipeline.refit import realign_inputs, realign_short

    plain = timing([])
    plain["timing"]["shortBars"] = [{"bar": 5, "units": 2}]
    flagged = timing([])
    flagged["timing"]["shortBars"] = [{"bar": 5, "units": 2, "unnumbered": True}]

    assert realign_inputs(parse_timing(flagged)) == realign_inputs(parse_timing(plain))
    assert realign_short(parse_timing(flagged)) == realign_short(parse_timing(plain)) == {4}


# --- The bar played before a pickup holds the rest of its meter (Mozart, 2026-11-06) ------------


def two_four(rows: list[dict], short: list[dict], bars: int = 8) -> dict:
    body = timing([])
    body["timing"].update(
        barCount=bars,
        playOrder=rows,
        meters=[{"fromBar": 1, "numerator": 2, "denominator": 4}],
        shortBars=short,
    )
    return body


def test_the_bar_before_a_pickup_is_short_by_the_pickup_each_time_it_is_played() -> None:
    from app.pipeline.refit import before_pickup, realign_inputs, realign_short

    # Bar 4 goes back to the top pickup, then on into the pickup bar 5.
    body = two_four(
        [{"from": 0, "to": 4}, {"from": 0, "to": 8}],
        [{"bar": 0, "units": 1}, {"bar": 5, "units": 1, "unnumbered": True}],
    )
    parsed = parse_timing(body)
    notated, short = before_pickup(parsed, realign_inputs(parsed)[0], realign_short(parsed))
    assert notated == [1, 2, 2, 2, 1, 1, 2, 2, 2, 1, 1, 2, 2, 2]
    assert short == {0, 4, 5, 9, 10}


def test_only_the_time_a_bar_goes_into_a_pickup_is_short() -> None:
    from app.pipeline.refit import before_pickup, realign_inputs, realign_short

    # A first ending: bar 6 leads back to the pickup bar 3, and bar 5 only leads on to a full bar.
    body = two_four(
        [{"from": 0, "to": 6}, {"from": 3, "to": 5}, {"from": 7, "to": 8}],
        [{"bar": 0, "units": 1}, {"bar": 3, "units": 1, "unnumbered": True}],
    )
    parsed = parse_timing(body)
    notated, short = before_pickup(parsed, realign_inputs(parsed)[0], realign_short(parsed))
    assert notated == [1, 2, 1, 1, 2, 2, 1, 1, 2, 2, 2, 2]
    assert short == {0, 2, 3, 6, 7}


def test_a_short_bar_that_is_no_pickup_leaves_the_bar_before_it_alone() -> None:
    from app.pipeline.refit import before_pickup, realign_inputs, realign_short

    body = two_four([{"from": 1, "to": 4}], [{"bar": 3, "units": 1}])
    parsed = parse_timing(body)
    notated, short = before_pickup(parsed, realign_inputs(parsed)[0], realign_short(parsed))
    assert notated == [2, 2, 1, 2]
    assert short == {2}


def test_a_bar_already_short_keeps_its_own_length_before_a_pickup() -> None:
    from app.pipeline.refit import before_pickup, realign_inputs, realign_short

    body = two_four(
        [{"from": 1, "to": 4}],
        [{"bar": 2, "units": 1}, {"bar": 3, "units": 1, "unnumbered": True}],
    )
    parsed = parse_timing(body)
    notated, short = before_pickup(parsed, realign_inputs(parsed)[0], realign_short(parsed))
    assert notated == [2, 1, 1, 2]
    assert short == {1, 2}


def repeat_with_pickups() -> tuple[BarSignal, list[tuple[int, int]], dict]:
    """A 2/4 piece as Mozart writes it: p 1 2 3| p 1 2 3| p 5 6, where the half bar 3 and the
    pickup after it share one bar of the music."""
    signal = BarSignal([1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2])
    slots = [(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1), (3, 1), (4, 0), (5, 0), (6, 0)]
    body = two_four(
        [{"from": 0, "to": 3}, {"from": 0, "to": 6}],
        [{"bar": 0, "units": 1}, {"bar": 4, "units": 1, "unnumbered": True}],
        bars=6,
    )
    return signal, slots, body


def heard_from(signal: BarSignal) -> Analysis:
    return Analysis(
        0.0, Heard(signal.beat_logits, signal.downbeat_logits, 50.0, list(signal.beats))
    )


def test_a_pickup_after_a_repeat_can_be_filled() -> None:
    signal, slots, body = repeat_with_pickups()
    empty = {(0, 1), (4, 0)}
    body["timing"]["locators"] = [
        {"bar": b, "passIndex": p, "timeSec": signal.starts[i], "confirmed": False}
        for i, (b, p) in enumerate(slots)
        if (b, p) not in empty
    ]
    filled = fill_timing(parse_timing(body), heard_from(signal))
    times = {(item.bar, item.passIndex): item.timeSec for item in filled.locators}
    assert len(times) == len(slots)
    for key in empty:
        assert times[key] == pytest.approx(signal.starts[slots.index(key)], abs=0.05)


def test_a_full_bar_before_a_pickup_is_still_filled_when_the_recording_says_so() -> None:
    # The bar before the pickup really is whole: the plain lengths are tried after the short.
    signal = BarSignal([2, 2, 2, 2, 1, 2, 2, 2])
    body = two_four(
        [{"from": 1, "to": 8}],
        [{"bar": 5, "units": 1, "unnumbered": True}],
    )
    body["timing"]["locators"] = [
        {"bar": i + 1, "passIndex": 0, "timeSec": signal.starts[i], "confirmed": False}
        for i in range(8)
        if i != 6
    ]
    filled = fill_timing(parse_timing(body), heard_from(signal))
    times = {item.bar: item.timeSec for item in filled.locators}
    assert times[7] == pytest.approx(signal.starts[6], abs=0.05)


def test_a_run_with_no_room_stays_empty_and_the_others_are_filled() -> None:
    signal = BarSignal([4] * 14)
    body = timing([])
    body["timing"].update(barCount=14, playOrder=[{"from": 1, "to": 14}])
    # Bars 3 and 4 have room. Bar 10 has none: bars 9 and 11 sit half a bar of music apart.
    given = {b: signal.starts[b - 1] for b in range(1, 10) if b not in (3, 4)}
    given.update({b: signal.starts[b - 2] - 1.0 for b in (11, 12, 13, 14)})
    body["timing"]["locators"] = [locator(b, t, confirmed=False) for b, t in sorted(given.items())]
    filled = fill_timing(parse_timing(body), heard_from(signal))
    times = {item.bar: item.timeSec for item in filled.locators}
    assert times[3] == pytest.approx(signal.starts[2], abs=0.05)
    assert times[4] == pytest.approx(signal.starts[3], abs=0.05)
    assert 10 not in times


def test_when_no_run_has_room_the_fill_is_a_sentence() -> None:
    signal = BarSignal([4] * 8)
    body = timing([])
    given = {b: signal.starts[b - 1] for b in (1, 2, 3)}
    given.update({b: signal.starts[b - 2] - 1.0 for b in (5, 6, 7, 8)})
    body["timing"]["locators"] = [locator(b, t, confirmed=False) for b, t in sorted(given.items())]
    with pytest.raises(RunFolderError, match="Re-align failed"):
        fill_timing(parse_timing(body), heard_from(signal))


def test_a_realign_keeps_the_confirmed_bars_and_goes_through_the_pickups() -> None:
    signal, slots, body = repeat_with_pickups()
    body["timing"]["locators"] = [
        {"bar": b, "passIndex": p, "timeSec": signal.starts[i], "confirmed": i < 4}
        for i, (b, p) in enumerate(slots)
    ]
    parsed = parse_timing(body)
    done = realign_timing(parsed, heard_from(signal))
    times = {(item.bar, item.passIndex): item.timeSec for item in done.locators}
    for i, key in enumerate(slots):
        assert times[key] == pytest.approx(signal.starts[i], abs=0.05)


# Test (2026-11-07): a 3/4 piece where Beat This hears one beat a bar, so a pickup starts between
# two detected beats. The music, in notated beats: 1 2 3 4| p 5 6 7 8| p 5 6 7 8, the half bars 4
# and 8 (two beats) and the pickup after each (one beat) sharing one bar of the music.
SLOW_SLOTS = [(bar, 0) for bar in range(1, 9)] + [(bar, 1) for bar in range(5, 9)]
SLOW_STARTS = [0, 3, 6, 9, 11, 12, 15, 18, 20, 21, 24, 27]  # in notated beats; the music ends on 30
NOTATED_BEAT = 0.28  # seconds; the detected beat is three of them


def slow_pulse() -> tuple[Analysis, list[float], dict]:
    signal = BarSignal([1] * 11, beat=3 * NOTATED_BEAT)  # a detected beat (and downbeat) a bar
    body = timing([])
    body["timing"].update(
        barCount=8,
        playOrder=[{"from": 1, "to": 8}, {"from": 5, "to": 8}],
        meters=[{"fromBar": 1, "numerator": 3, "denominator": 4}],
        shortBars=[{"bar": 5, "units": 1, "unnumbered": True}],
    )
    starts = [FIRST + NOTATED_BEAT * beats for beats in SLOW_STARTS]
    return heard_from(signal), starts, body


@pytest.mark.parametrize(
    "empty",
    [{(5, 1)}, {(5, 1), (6, 1), (7, 1), (8, 1)}],
    ids=["the pickup after a repeat", "a repeat that starts on a pickup"],
)
def test_a_pickup_between_two_detected_beats_is_filled_when_the_beat_is_a_whole_bar(
    empty: set[tuple[int, int]],
) -> None:
    analysis, starts, body = slow_pulse()
    body["timing"]["locators"] = [
        {"bar": b, "passIndex": p, "timeSec": starts[i], "confirmed": True}
        for i, (b, p) in enumerate(SLOW_SLOTS)
        if (b, p) not in empty
    ]
    filled = fill_timing(parse_timing(body), analysis)
    times = {(item.bar, item.passIndex): item.timeSec for item in filled.locators}
    for key in empty:
        assert times[key] == pytest.approx(starts[SLOW_SLOTS.index(key)], abs=0.05)


def test_a_realign_goes_through_pickups_between_two_detected_beats() -> None:
    analysis, starts, body = slow_pulse()
    body["timing"]["locators"] = [
        {"bar": b, "passIndex": p, "timeSec": starts[i] + 0.1, "confirmed": i in (0, 1, 11)}
        for i, (b, p) in enumerate(SLOW_SLOTS)
    ]
    body["timing"]["locators"][0]["timeSec"] = starts[0]
    body["timing"]["locators"][1]["timeSec"] = starts[1]
    body["timing"]["locators"][11]["timeSec"] = starts[11]
    done = realign_timing(parse_timing(body), analysis)
    times = {(item.bar, item.passIndex): item.timeSec for item in done.locators}
    for i, key in enumerate(SLOW_SLOTS):
        assert times[key] == pytest.approx(starts[i], abs=0.05)


def test_beats_are_split_only_when_a_detected_beat_holds_a_whole_number_of_notated_ones() -> None:
    analysis, starts, body = slow_pulse()
    beats = np.asarray(analysis.heard.beats)
    notated = [3, 3, 3, 2, 1, 3, 3, 2, 1, 3, 3, 3]
    assert notated_per_heard(beats, notated, starts) == 3
    assert notated_per_heard(beats, [1] * 12, starts) is None  # one notated beat a detected one
    assert notated_per_heard(beats, notated, [starts[0]] + [None] * 11) is None  # one time only
    split = split_beats(beats, 3)
    assert len(split) == 3 * (len(beats) - 1) + 1
    assert split[1] == pytest.approx(beats[0] + NOTATED_BEAT)
