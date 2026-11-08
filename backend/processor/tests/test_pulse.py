import pytest

from app.pipeline.pulse import (
    PULSE_TOLERANCE,
    heard_beats_per_bar,
    mismatched_pulse,
    pulse_mismatch,
    round_half_up,
)


def beats_apart(gap: float, count: int, start: float = 0.0) -> list[float]:
    return [start + gap * k for k in range(count)]


def span_of(beats: list[float]) -> tuple[float, float]:
    """The music of a map that starts on the first beat and ends one gap after the last."""
    return beats[0], beats[-1] + (beats[-1] - beats[-2])


# --- the beats the recording gives a bar --------------------------------------------------------


def test_the_beats_in_the_music_are_shared_by_the_slots_of_an_order() -> None:
    beats = beats_apart(0.84, 154)
    start, end = span_of(beats)

    assert heard_beats_per_bar(beats, start, end, 149) == pytest.approx(154 / 149)
    assert heard_beats_per_bar(beats, start, end, 64) == pytest.approx(154 / 64)


def test_a_count_in_and_the_applause_do_not_count() -> None:
    count_in = beats_apart(0.5, 8)  # 0 to 3.5 s
    music = beats_apart(0.5, 32, start=10.0)  # 8 bars of 4/4
    applause = beats_apart(0.5, 6, start=40.0)

    heard = heard_beats_per_bar([*count_in, *music, *applause], 10.0, 26.0, 8)

    assert heard == pytest.approx(4.0)


def test_a_beat_on_either_end_of_the_music_counts_and_one_further_out_does_not() -> None:
    beats = beats_apart(1.0, 12, start=10.0)  # 10 s to 21 s

    # the end of the last bar of an alignment is often its last beat itself
    assert heard_beats_per_bar(beats, 10.0, 17.0, 1) == 8  # 10 to 17, both ends
    assert heard_beats_per_bar(beats, 10.03, 17.0, 1) == 8  # 10 is 30 ms before the line: its own
    assert heard_beats_per_bar(beats, 10.0, 16.97, 1) == 8  # 17 is 30 ms after the end: its own
    assert heard_beats_per_bar(beats, 10.1, 17.0, 1) == 7  # 10 is a count-in beat
    assert heard_beats_per_bar(beats, 10.0, 16.9, 1) == 7  # 17 is a beat after the music


def test_the_beats_are_counted_whatever_their_order() -> None:
    beats = beats_apart(0.5, 40)

    assert heard_beats_per_bar(list(reversed(beats)), 0.0, 20.0, 10) == pytest.approx(
        heard_beats_per_bar(beats, 0.0, 20.0, 10)
    )


@pytest.mark.parametrize(
    ("beats", "slots"),
    [
        ([], 8),
        ([1.0], 8),  # one beat tells nothing
        (beats_apart(0.5, 16), 0),
    ],
)
def test_there_is_no_heard_pulse_without_two_beats_in_the_music_or_without_slots(
    beats: list[float], slots: int
) -> None:
    assert heard_beats_per_bar(beats, 0.0, 8.0, slots) is None


def test_two_beats_outside_the_music_are_no_pulse() -> None:
    assert heard_beats_per_bar(beats_apart(0.5, 16), 100.0, 108.0, 4) is None


# --- when a heard pulse is a mismatch -----------------------------------------------------------


def test_2_45_beats_a_bar_is_not_near_a_whole_number() -> None:
    assert pulse_mismatch(2.45, 3) is None


def test_a_6_8_piece_heard_at_two_beats_a_bar_is_no_mismatch() -> None:
    # 6/8 is felt in 2: the score's beats per bar are 2, not 6
    assert pulse_mismatch(2.0, 2) is None
    assert pulse_mismatch(2.05, 2) is None


def test_a_heard_pulse_that_is_the_score_is_no_mismatch() -> None:
    assert pulse_mismatch(3.0, 3) is None
    assert pulse_mismatch(3.1, 3) is None


def test_a_whole_pulse_that_differs_from_the_score_is_the_mismatch() -> None:
    assert pulse_mismatch(1.0, 3) == 1
    assert pulse_mismatch(2.0, 4) == 2
    assert pulse_mismatch(4.9, 1) == 5
    assert pulse_mismatch(6.0, 2) == 6


def test_the_tolerance_is_inclusive_and_a_little_more_is_not_a_mismatch() -> None:
    assert PULSE_TOLERANCE == 0.12
    assert pulse_mismatch(1.12, 3) == 1  # 1.12 - 1 is 0.12000000000000011 in floating point
    assert pulse_mismatch(0.88, 3) == 1
    assert pulse_mismatch(1.13, 3) is None
    assert pulse_mismatch(2.87, 4) is None


def test_the_score_is_compared_by_its_rounded_beats() -> None:
    assert pulse_mismatch(3.0, 3.0) is None
    assert pulse_mismatch(3.0, 2.9) is None
    assert pulse_mismatch(3.0, 2.94) is None  # a mean over meters: 2.94 is felt as 3


def test_half_a_beat_in_the_score_rounds_up_as_the_card_shows_it() -> None:
    # a mean of 2.5 is 3 on the card (Math.round), so a pulse of 3 is the score's, not a mismatch
    assert pulse_mismatch(3.0, 2.5) is None
    assert pulse_mismatch(1.0, 2.5) == 1  # and 1 is the card's "1 per bar, not 3"
    assert pulse_mismatch(4.0, 3.5) is None  # 3.5 is 4


def test_round_half_up_rounds_a_half_up_where_python_rounds_it_to_even() -> None:
    assert round(2.5) == 2  # what the processor said before
    assert round_half_up(2.5) == 3
    assert round_half_up(0.5) == 1
    assert round_half_up(3.5) == 4
    assert round_half_up(2.4999) == 2
    assert round_half_up(2.9375) == 3
    assert round_half_up(1.03) == 1


# --- the ratio between the heard pulse and the score's has to be a musical one -------------------


@pytest.mark.parametrize(
    ("heard", "score", "reported"),
    [(1.0, 2, 1), (2.0, 4, 2), (1.0, 3, 1), (1.0, 4, 1), (3.0, 1, 3), (6.0, 3, 6), (2.0, 6, 2)],
)
def test_a_pulse_a_whole_number_of_times_faster_or_slower_than_the_score_s_is_the_mismatch(
    heard: float, score: float, reported: int
) -> None:
    assert pulse_mismatch(heard, score) == reported


@pytest.mark.parametrize(
    ("heard", "score"), [(3.0, 4), (4.0, 3), (2.0, 3), (3.0, 2), (4.0, 6), (6.0, 4), (5.0, 3)]
)
def test_a_pulse_that_is_no_whole_number_of_times_the_score_s_is_no_mismatch(
    heard: float, score: float
) -> None:
    # a 4/4 heard at 3 a bar is a ratio of 0.75: not a half-time or a double-time of anything
    assert pulse_mismatch(heard, score) is None


def test_a_four_four_piece_heard_at_three_beats_a_bar_is_not_flagged() -> None:
    # 32 beats over 8 bars of 4/4 heard as 24 over 8: three a bar, and the ratio is 0.75
    beats = beats_apart(2 / 3, 24)
    start, end = span_of(beats)

    assert mismatched_pulse(beats, start, end, written=[4.0] * 8, played=[4.0] * 8) is None


@pytest.mark.parametrize("heard", [None, 0.0, 0.4, 7.0, 8.0, 12.0])
def test_no_pulse_or_one_outside_1_to_6_is_no_mismatch(heard: float | None) -> None:
    assert pulse_mismatch(heard, 3) is None


# --- the pulse to report, over the played and the written order ----------------------------------


def waltz(slots: int) -> list[float]:
    return [3.0] * slots


def test_a_waltz_heard_one_beat_a_bar_over_the_written_order_is_the_pulse_to_report() -> None:
    # 154 beats: the 64 slots of the order the map keeps hear 2.4 beats a bar (no whole number),
    # the 149 written slots hear 1.03
    beats = beats_apart(0.84, 154)
    start, end = span_of(beats)

    found = mismatched_pulse(beats, start, end, written=waltz(149), played=waltz(64))

    assert found is not None
    assert (found.heard, found.expected) == (pytest.approx(154 / 149), 3.0)
    assert pulse_mismatch(found.heard, found.expected) == 1


def test_a_recording_that_skips_its_repeats_with_the_right_pulse_is_no_mismatch() -> None:
    # 4/4: 32 beats over the 8 bars played; the written order has 16 slots (2 a bar)
    beats = beats_apart(0.5, 32)
    start, end = span_of(beats)

    assert mismatched_pulse(beats, start, end, written=[4.0] * 16, played=[4.0] * 8) is None


def test_a_piece_with_a_slow_start_is_no_mismatch() -> None:
    # 64 bars of 3/4, the first 30 per cent of the beats at half tempo: time over tempo said 3.89
    slow = beats_apart(1.0, 58)
    quick = beats_apart(0.5, 134, start=slow[-1] + 1.0)
    beats = [*slow, *quick]
    start, end = span_of(beats)

    assert len(beats) == 64 * 3
    assert mismatched_pulse(beats, start, end, written=waltz(64), played=waltz(64)) is None


def test_a_piece_with_a_long_pause_without_beats_is_no_mismatch() -> None:
    # 64 bars of 4/4 with one 20 s hole in the beats: time over tempo said 5.0 a bar
    before = beats_apart(0.3125, 100)
    after = beats_apart(0.3125, 156, start=before[-1] + 0.3125 + 20.0)
    beats = [*before, *after]
    start, end = span_of(beats)

    assert len(beats) == 64 * 4
    assert mismatched_pulse(beats, start, end, written=[4.0] * 64, played=[4.0] * 64) is None


def test_a_piece_of_2_4_and_3_4_is_judged_by_the_mean_of_its_bars() -> None:
    # 4 bars of 2/4 then 60 of 3/4: the score's mean is 2.94, the first meter's 2 is not the pulse
    notated = [2.0] * 4 + [3.0] * 60
    beats = [*beats_apart(0.4, 8), *beats_apart(0.6, 180, start=3.2)]
    start, end = span_of(beats)

    assert mismatched_pulse(beats, start, end, written=notated, played=notated) is None


def test_a_6_8_piece_heard_at_two_beats_a_bar_is_no_mismatch_in_either_order() -> None:
    two_a_bar = beats_apart(1.0, 32)
    start, end = span_of(two_a_bar)

    assert mismatched_pulse(two_a_bar, start, end, written=[2.0] * 16, played=[2.0] * 16) is None
    assert mismatched_pulse(two_a_bar, start, end, written=[2.0] * 32, played=[2.0] * 16) is None


def test_a_count_in_does_not_make_a_pulse() -> None:
    # 8 bars of 4/4 after 8 count-in beats: all 40 beats over 8 slots would be 5 a bar
    beats = [*beats_apart(0.5, 8), *beats_apart(0.5, 32, start=10.0)]

    assert mismatched_pulse(beats, 10.0, 26.0, written=[4.0] * 8, played=[4.0] * 8) is None


def test_the_played_order_wrong_and_the_written_one_not_a_whole_number_reports_the_played() -> None:
    # 16 beats: 2 a played bar of 8, 0.67 a written bar of 24, in a 4/4 score
    beats = beats_apart(1.0, 16)
    start, end = span_of(beats)

    found = mismatched_pulse(beats, start, end, written=[4.0] * 24, played=[4.0] * 8)

    assert found is not None
    assert (found.heard, found.expected) == (pytest.approx(2.0), 4.0)


def test_when_both_orders_are_a_mismatch_the_written_one_is_reported() -> None:
    # 16 beats: 2 a played bar of 8, 1 a written bar of 16, in a 4/4 score
    beats = beats_apart(1.0, 16)
    start, end = span_of(beats)

    found = mismatched_pulse(beats, start, end, written=[4.0] * 16, played=[4.0] * 8)

    assert found is not None
    assert (found.heard, found.expected) == (pytest.approx(1.0), 4.0)


def test_the_score_beats_reported_are_the_mean_of_the_order_that_gave_the_pulse() -> None:
    # played: 4 bars of 4 and 4 of 2 (mean 3); written plays the first four again (mean 3.33)
    played = [4.0] * 4 + [2.0] * 4
    written = [4.0] * 8 + [2.0] * 4
    beats = beats_apart(1.0, 12)  # 1.5 a played bar, 1 a written bar
    start, end = span_of(beats)

    found = mismatched_pulse(beats, start, end, written=written, played=played)

    assert found is not None
    assert (found.heard, found.expected) == (pytest.approx(1.0), pytest.approx(10 / 3))


def test_a_piece_without_repeats_is_judged_once_as_before() -> None:
    one_a_bar = beats_apart(0.84, 154)
    start, end = span_of(one_a_bar)

    found = mismatched_pulse(one_a_bar, start, end, written=waltz(149), played=waltz(149))

    assert found is not None
    assert (found.heard, found.expected) == (pytest.approx(154 / 149), 3.0)
    three_a_bar = beats_apart(0.6, 64 * 3)
    start, end = span_of(three_a_bar)
    assert mismatched_pulse(three_a_bar, start, end, written=waltz(64), played=waltz(64)) is None


@pytest.mark.parametrize("count", [288, 312])
def test_the_played_order_is_right_at_exactly_the_score_beats_plus_or_minus_the_tolerance(
    count: int,
) -> None:
    # 100 played slots, 300 written ones, 3/4. The played order hears count / 100: 2.88 and 3.12 are
    # the score's 3 within 0.12, so whatever the written order hears (0.96, 1.04) is not reported.
    beats = beats_apart(0.5, count)
    start, end = span_of(beats)

    assert mismatched_pulse(beats, start, end, written=waltz(300), played=waltz(100)) is None


@pytest.mark.parametrize("count", [287, 313])
def test_a_little_beyond_the_tolerance_the_played_order_is_no_longer_the_score_s(
    count: int,
) -> None:
    beats = beats_apart(0.5, count)
    start, end = span_of(beats)

    found = mismatched_pulse(beats, start, end, written=waltz(300), played=waltz(100))

    assert found is not None
    assert pulse_mismatch(found.heard, found.expected) == 1  # the written order, 0.96 or 1.04


def test_there_is_no_pulse_to_report_without_beats() -> None:
    assert mismatched_pulse([], 0.0, 8.0, written=waltz(16), played=waltz(8)) is None
    assert mismatched_pulse([2.0], 0.0, 8.0, written=waltz(16), played=waltz(8)) is None
