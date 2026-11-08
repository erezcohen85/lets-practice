import numpy as np
import pytest

from app.pipeline.models import (
    BarMark,
    MeterChange,
    PlayOrderRow,
    ReviewFlag,
    expand_play_order,
)
from app.pipeline.review_flags import is_checked, review_flags, skipped_repeat_bars
from tests.synthetic import bump_curve

# Bars of 20 s (4/4, 5 s per beat) so the bounds 0.75 and 1.35 are exact binary-friendly ratios:
# 15 / 4 / 5 == 0.75 and 27 / 4 / 5 == 1.35 with no rounding. Times start at 0 and are whole
# seconds, so each one sits on a frame of the 50 fps activation.

FPS = 50.0
BAR = 20.0
BEAT = 5.0


def slots_of(count: int) -> list:
    return expand_play_order([PlayOrderRow(start=1, end=count)], count)


def starts_of(lengths: list[float]) -> list[float]:
    starts = [0.0]
    for length in lengths[:-1]:
        starts.append(starts[-1] + length)
    return starts


def activation_for(
    starts: list[float], end: float, heights: dict[float, float] | None = None
) -> np.ndarray:
    """A bump on every start (height 1, or the one given for that time)."""
    curve = np.zeros(round(end * FPS))
    for t in starts:
        height = (heights or {}).get(t, 1.0)
        curve = np.maximum(curve, bump_curve([t], end, FPS, height=height))
    return curve


def beats_for(starts: list[float], lengths: list[float], counts: dict[int, int] | None = None):
    """Evenly spaced beats per bar: notated 4 unless `counts` gives that slot's count."""
    beats: list[float] = []
    for index, (start, length) in enumerate(zip(starts, lengths, strict=True)):
        count = (counts or {}).get(index, 4)
        beats.extend(start + k * length / count for k in range(count))
    return beats


def run(
    lengths: list[float],
    *,
    last: float | None = None,
    marks: list[BarMark] | None = None,
    meters: list[MeterChange] | None = None,
    heights: dict[float, float] | None = None,
    beats: list[float] | None = None,
    slots: list | None = None,
) -> list[list[ReviewFlag]]:
    """Flags for slots with the given lengths; the last slot ends at start + `last` (or BAR)."""
    starts = starts_of(lengths)
    end = starts[-1] + (last if last is not None else lengths[-1])
    return review_flags(
        slots if slots is not None else slots_of(len(lengths)),
        starts,
        end,
        meters or [],
        marks or [],
        activation_for(starts, end + 1.0, heights),
        FPS,
        beats,
    )


def only(flags: list[ReviewFlag], kind: str) -> ReviewFlag:
    found = [flag for flag in flags if flag.kind == kind]
    assert len(found) == 1, flags
    return found[0]


def test_a_steady_piece_has_no_flags() -> None:
    result = run([BAR] * 8)

    assert result == [[] for _ in range(8)]


# --- crowded and stretched ---------------------------------------------------------------------


def test_one_short_bar_is_crowded_with_severity_1_at_ratio_0_7() -> None:
    result = run([BAR, BAR, BAR, 14.0, BAR, BAR, BAR, BAR])

    flag = only(result[3], "crowded")
    assert flag.severity == 1
    assert flag.expected == pytest.approx(20.0)
    assert flag.found == pytest.approx(14.0)
    assert flag.factor == pytest.approx(0.7)
    assert flag.explained_by is None
    assert flag.uncertain_line is None
    assert [flags for index, flags in enumerate(result) if index != 3] == [[]] * 7


def test_a_much_shorter_bar_is_crowded_with_severity_2_at_ratio_0_5() -> None:
    result = run([BAR, BAR, BAR, 10.0, BAR, BAR, BAR, BAR])

    flag = only(result[3], "crowded")
    assert flag.severity == 2
    assert flag.factor == pytest.approx(0.5)


def test_a_long_bar_is_stretched_at_1_4_and_severe_at_1_9() -> None:
    result = run([BAR, BAR, BAR, 28.0, BAR, BAR, BAR, BAR])
    severe = run([BAR, BAR, BAR, 38.0, BAR, BAR, BAR, BAR])

    flag = only(result[3], "stretched")
    assert flag.severity == 1
    assert flag.expected == pytest.approx(20.0)
    assert flag.found == pytest.approx(28.0)
    assert flag.factor == pytest.approx(1.4)
    assert only(severe[3], "stretched").severity == 2
    assert only(severe[3], "stretched").factor == pytest.approx(1.9)


def test_the_bounds_0_75_and_1_35_do_not_flag() -> None:
    assert run([BAR, BAR, BAR, 15.0, BAR, BAR, BAR, BAR])[3] == []
    assert run([BAR, BAR, BAR, 27.0, BAR, BAR, BAR, BAR])[3] == []


def test_the_severe_bounds_0_55_and_1_8_are_still_severity_1() -> None:
    # 11 / 4 / 5 == 0.55 and 36 / 4 / 5 == 1.8 exactly
    assert only(run([BAR, BAR, BAR, 11.0, BAR, BAR, BAR, BAR])[3], "crowded").severity == 1
    assert only(run([BAR, BAR, BAR, 36.0, BAR, BAR, BAR, BAR])[3], "stretched").severity == 1


def test_the_reference_is_the_three_slots_either_side_not_four() -> None:
    # Slot 4 is 10 s per beat unit 5; with three neighbours a side the reference is 3.75 (ratio
    # 1.33, fine); with four it would be 2.5 (ratio 2). Slot 3 is then crowded against 3.75.
    result = run([10.0, 10.0, 10.0, 10.0, BAR, BAR, BAR, BAR])

    assert result[4] == []
    flag = only(result[3], "crowded")
    assert flag.factor == pytest.approx(2.5 / 3.75)
    assert flag.expected == pytest.approx(15.0)


def test_a_meter_change_uses_the_numerator_of_the_meter_in_force() -> None:
    meters = [MeterChange(numerator=2, denominator=4, from_bar=4)]
    lengths = [BAR, BAR, BAR, 10.0, 10.0, 10.0, 10.0, 10.0]

    # bars 4 on are 2/4 at the same 5 s per beat, so 10 s long: no tempo flag
    assert run(lengths, meters=meters) == [[]] * 8
    # read as 4/4 the same times are crowded bars
    assert any(flags for flags in run(lengths)[3:])


def test_a_lone_slot_has_no_reference_and_no_tempo_flag() -> None:
    assert run([BAR]) == [[]]


def test_the_last_slot_runs_a_notated_length_at_the_recent_tempo_and_stops_at_the_end() -> None:
    lengths = [BAR] * 7
    starts = starts_of(lengths + [BAR])
    activation = activation_for(starts, 200.0)

    def last_flags(recording_end: float) -> list[ReviewFlag]:
        return review_flags(slots_of(8), starts, recording_end, [], [], activation, FPS, None)[7]

    assert last_flags(200.0) == []  # 4 beats at 5 s: runs to 140 + 20 = 160
    cut = only(last_flags(148.0), "crowded")  # the recording ends 8 s into the bar
    assert cut.found == pytest.approx(8.0)
    assert cut.factor == pytest.approx(0.4)
    assert cut.severity == 2


def test_a_repeat_uses_its_own_neighbours_in_play_order() -> None:
    rows = [PlayOrderRow(start=1, end=4), PlayOrderRow(start=1, end=4)]
    slots = expand_play_order(rows, 4)
    lengths = [BAR, BAR, BAR, BAR, BAR, 30.0, BAR, BAR]

    result = run(lengths, slots=slots)

    flag = only(result[5], "stretched")  # bar 2 on its second pass
    assert flag.factor == pytest.approx(1.5)
    assert flag.expected == pytest.approx(20.0)
    assert flag.found == pytest.approx(30.0)
    assert result[1] == []  # bar 2 on its first pass is a normal bar
    assert [index for index, flags in enumerate(result) if flags] == [5]


# --- fermata -----------------------------------------------------------------------------------


FERMATA_BAR_4 = [BarMark(bar=4, kind="fermata")]


def test_a_fermata_explains_a_bar_1_6_times_longer() -> None:
    result = run([BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR], marks=FERMATA_BAR_4)

    flag = only(result[3], "stretched")
    assert flag.severity == 0
    assert flag.explained_by == "fermata"
    assert flag.uncertain_line is None
    assert flag.factor == pytest.approx(1.6)
    assert is_checked(result[3])


def test_a_fermata_on_another_bar_explains_nothing() -> None:
    marks = [BarMark(bar=5, kind="fermata")]

    flag = only(run([BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR], marks=marks)[3], "stretched")

    assert flag.explained_by is None


def test_a_fermata_does_not_explain_a_bar_3_2_times_longer() -> None:
    result = run([BAR, BAR, BAR, 64.0, BAR, BAR, BAR, BAR], marks=FERMATA_BAR_4)

    flag = only(result[3], "stretched")
    assert flag.severity == 2
    assert flag.explained_by is None
    assert not is_checked(result[3])


def test_a_fermata_explains_up_to_3_times_longer_and_no_further() -> None:
    at_three = run([BAR, BAR, BAR, 60.0, BAR, BAR, BAR, BAR], marks=FERMATA_BAR_4)

    assert only(at_three[3], "stretched").explained_by == "fermata"


def test_a_weak_bar_line_next_to_a_fermata_bar_makes_it_severity_1_with_the_uncertain_line() -> (
    None
):
    # bar 5 starts at 3 * 20 + 32 = 92 s; its downbeat is only 0.4 (above the weak-downbeat 0.3)
    result = run(
        [BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR], marks=FERMATA_BAR_4, heights={92.0: 0.4}
    )

    flag = only(result[3], "stretched")
    assert flag.severity == 1
    assert flag.explained_by == "fermata"
    assert flag.uncertain_line is not None
    assert flag.uncertain_line.time_sec == 92.0
    assert flag.uncertain_line.confidence == pytest.approx(0.4)
    assert not is_checked(result[3])
    assert result[4] == []  # 0.4 is not a weak downbeat


def test_the_weakest_of_the_two_bar_lines_is_the_uncertain_one() -> None:
    # the fermata bar starts at 60 s and ends at 92 s; both lines are weak, the start the weaker
    result = run(
        [BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR],
        marks=FERMATA_BAR_4,
        heights={60.0: 0.35, 92.0: 0.45},
    )

    line = only(result[3], "stretched").uncertain_line
    assert line is not None
    assert line.time_sec == 60.0
    assert line.confidence == pytest.approx(0.35)


def test_a_bar_line_at_exactly_0_5_is_not_weak() -> None:
    result = run(
        [BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR], marks=FERMATA_BAR_4, heights={92.0: 0.5}
    )

    assert only(result[3], "stretched").severity == 0


def test_the_last_slot_has_only_its_own_start_as_a_bar_line() -> None:
    lengths = [BAR] * 8
    marks = [BarMark(bar=8, kind="fermata")]
    beats = beats_for(starts_of(lengths), lengths, {7: 6})  # six beats heard in the last bar

    sure = only(run(lengths, marks=marks, beats=beats)[7], "beat-count")
    unsure = only(run(lengths, marks=marks, beats=beats, heights={140.0: 0.4})[7], "beat-count")

    assert sure.severity == 0
    assert sure.explained_by == "fermata"
    assert unsure.severity == 1
    assert unsure.uncertain_line is not None
    assert unsure.uncertain_line.time_sec == 140.0
    assert unsure.uncertain_line.confidence == pytest.approx(0.4)


# --- beat count --------------------------------------------------------------------------------


def test_a_bar_with_the_notated_number_of_beats_has_no_beat_flag() -> None:
    lengths = [BAR] * 8
    beats = beats_for(starts_of(lengths), lengths)

    assert run(lengths, beats=beats) == [[]] * 8


# The start of bar 3 (40 s) at 0.4: above the weak-downbeat 0.3, below the 0.5 that counts as sure.
UNSURE_BAR_3 = {40.0: 0.4}


def test_one_beat_too_few_is_beat_count_severity_1() -> None:
    lengths = [BAR] * 8
    beats = beats_for(starts_of(lengths), lengths, {2: 3})

    flag = only(run(lengths, beats=beats, heights=UNSURE_BAR_3)[2], "beat-count")

    assert flag.severity == 1
    assert flag.expected == 4
    assert flag.found == 3
    assert flag.factor is None
    assert flag.explained_by is None


def test_two_beats_off_is_beat_count_severity_2() -> None:
    lengths = [BAR] * 8
    many = beats_for(starts_of(lengths), lengths, {2: 6})
    few = beats_for(starts_of(lengths), lengths, {2: 2})
    too_many = run(lengths, beats=many, heights=UNSURE_BAR_3)
    too_few = run(lengths, beats=few, heights=UNSURE_BAR_3)

    assert only(too_many[2], "beat-count").severity == 2
    assert only(too_many[2], "beat-count").found == 6
    assert only(too_few[2], "beat-count").severity == 2
    assert only(too_few[2], "beat-count").found == 2


def test_a_beat_just_before_the_bar_start_belongs_to_that_bar() -> None:
    lengths = [BAR] * 8
    starts = starts_of(lengths)
    # every beat 0.05 s early: still inside [start - 0.07, end - 0.07)
    early = [t - 0.05 for t in beats_for(starts, lengths)]

    assert run(lengths, beats=early) == [[]] * 8


def test_without_beats_the_beat_count_is_skipped() -> None:
    lengths = [BAR] * 8
    wrong = beats_for(starts_of(lengths), lengths, {2: 3})

    assert run(lengths, beats=None, heights=UNSURE_BAR_3)[2] == []
    assert only(run(lengths, beats=wrong, heights=UNSURE_BAR_3)[2], "beat-count")


def test_no_beats_at_all_is_every_bar_having_none_heard() -> None:
    result = run([BAR] * 4, beats=[], heights={20.0: 0.4, 40.0: 0.4, 60.0: 0.4})

    for flags in result:
        flag = only(flags, "beat-count")
        assert flag.found == 0
        assert flag.severity == 2


def test_a_fermata_explains_up_to_twice_the_notated_beats() -> None:
    lengths = [BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR]
    starts = starts_of(lengths)
    eight = beats_for(starts, lengths, {3: 8})
    nine = beats_for(starts, lengths, {3: 9})

    result = run(lengths, marks=FERMATA_BAR_4, beats=eight)
    over = run(lengths, marks=FERMATA_BAR_4, beats=nine)

    assert only(result[3], "beat-count").severity == 0
    assert only(result[3], "beat-count").explained_by == "fermata"
    assert only(over[3], "beat-count").severity == 2
    assert only(over[3], "beat-count").explained_by is None


def test_a_beat_count_alone_is_dropped_when_the_audio_is_sure_of_both_bar_lines() -> None:
    # a long note or a missed beat inside a bar whose lines both sit on strong downbeats and whose
    # length matches its neighbours says nothing about the timing
    lengths = [BAR] * 8
    few = beats_for(starts_of(lengths), lengths, {2: 2})
    many = beats_for(starts_of(lengths), lengths, {2: 7})

    assert run(lengths, beats=few) == [[]] * 8
    assert run(lengths, beats=many) == [[]] * 8


def test_a_beat_count_stays_when_either_bar_line_is_not_sure() -> None:
    lengths = [BAR] * 8
    beats = beats_for(starts_of(lengths), lengths, {2: 3})

    assert only(run(lengths, beats=beats, heights={40.0: 0.49})[2], "beat-count")  # its start
    assert only(run(lengths, beats=beats, heights={60.0: 0.49})[2], "beat-count")  # its end
    assert run(lengths, beats=beats, heights={40.0: 0.5, 60.0: 0.5})[2] == []  # 0.5 is sure


def test_a_beat_count_stays_next_to_a_length_flag_even_with_sure_bar_lines() -> None:
    lengths = [BAR, BAR, BAR, 14.0, BAR, BAR, BAR, BAR]
    beats = beats_for(starts_of(lengths), lengths, {3: 3})

    result = run(lengths, beats=beats)

    assert [flag.kind for flag in result[3]] == ["crowded", "beat-count"]


def test_a_beat_count_stays_next_to_a_held_bar_even_with_sure_bar_lines() -> None:
    # a fermata bar's length is free, so a slip of the chain can hide in the bars beside it
    lengths = [BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR]
    marks = [BarMark(bar=4, kind="fermata")]
    starts = starts_of(lengths)
    before = beats_for(starts, lengths, {2: 3})
    after = beats_for(starts, lengths, {4: 3})
    far = beats_for(starts, lengths, {6: 3})

    assert only(run(lengths, marks=marks, beats=before)[2], "beat-count")
    assert only(run(lengths, marks=marks, beats=after)[4], "beat-count")
    assert run(lengths, marks=marks, beats=far)[6] == []


def test_the_last_bar_is_judged_by_its_own_start_alone() -> None:
    lengths = [BAR] * 8
    beats = beats_for(starts_of(lengths), lengths, {7: 2})

    assert run(lengths, beats=beats)[7] == []
    assert only(run(lengths, beats=beats, heights={140.0: 0.4})[7], "beat-count")


# --- a rit. span -------------------------------------------------------------------------------

RIT_BAR_4 = [BarMark(bar=4, kind="rit")]
LONG_BAR_4 = [BAR, BAR, BAR, 32.0, BAR, BAR, BAR, BAR]


def test_a_rit_mark_explains_a_bar_1_6_times_longer() -> None:
    result = run(LONG_BAR_4, marks=RIT_BAR_4)

    flag = only(result[3], "stretched")
    assert flag.severity == 0
    assert flag.explained_by == "rit"
    assert flag.factor == pytest.approx(1.6)
    assert is_checked(result[3])


def test_a_rit_mark_explains_up_to_1_8_times_longer_and_no_further() -> None:
    at_cap = run([BAR, BAR, BAR, 36.0, BAR, BAR, BAR, BAR], marks=RIT_BAR_4)
    over = run([BAR, BAR, BAR, 37.0, BAR, BAR, BAR, BAR], marks=RIT_BAR_4)

    assert only(at_cap[3], "stretched").explained_by == "rit"
    assert only(over[3], "stretched").explained_by is None
    assert only(over[3], "stretched").severity == 2


def test_a_rit_mark_does_not_stretch_as_far_as_a_fermata() -> None:
    lengths = [BAR, BAR, BAR, 48.0, BAR, BAR, BAR, BAR]  # 2.4 times longer

    assert only(run(lengths, marks=FERMATA_BAR_4)[3], "stretched").explained_by == "fermata"
    assert only(run(lengths, marks=RIT_BAR_4)[3], "stretched").explained_by is None


def test_a_bar_with_a_fermata_and_a_rit_mark_is_explained_by_the_fermata() -> None:
    marks = [BarMark(bar=4, kind="fermata"), BarMark(bar=4, kind="rit")]

    assert only(run(LONG_BAR_4, marks=marks)[3], "stretched").explained_by == "fermata"


def test_a_rit_mark_on_another_bar_explains_nothing() -> None:
    marks = [BarMark(bar=5, kind="rit")]

    assert only(run(LONG_BAR_4, marks=marks)[3], "stretched").explained_by is None


def test_a_rit_mark_explains_a_beat_count_within_the_notated_beats_either_way() -> None:
    starts = starts_of(LONG_BAR_4)
    fewer = beats_for(starts, LONG_BAR_4, {3: 2})
    eight = beats_for(starts, LONG_BAR_4, {3: 8})
    nine = beats_for(starts, LONG_BAR_4, {3: 9})

    for beats in (fewer, eight):
        flag = only(run(LONG_BAR_4, marks=RIT_BAR_4, beats=beats)[3], "beat-count")
        assert (flag.severity, flag.explained_by) == (0, "rit")
    over = only(run(LONG_BAR_4, marks=RIT_BAR_4, beats=nine)[3], "beat-count")
    assert (over.severity, over.explained_by) == (2, None)


def test_a_rit_mark_explains_a_crowded_bar_down_to_0_6_for_an_accel() -> None:
    near = run([BAR, BAR, BAR, 14.0, BAR, BAR, BAR, BAR], marks=RIT_BAR_4)  # 0.7
    far = run([BAR, BAR, BAR, 11.0, BAR, BAR, BAR, BAR], marks=RIT_BAR_4)  # 0.55

    assert only(near[3], "crowded").explained_by == "rit"
    assert only(far[3], "crowded").explained_by is None
    assert only(run([BAR, BAR, BAR, 14.0, BAR, BAR, BAR, BAR])[3], "crowded").explained_by is None


def test_a_weak_bar_line_next_to_a_rit_bar_makes_it_severity_1_with_the_uncertain_line() -> None:
    result = run(LONG_BAR_4, marks=RIT_BAR_4, heights={92.0: 0.4})

    flag = only(result[3], "stretched")
    assert flag.severity == 1
    assert flag.explained_by == "rit"
    assert flag.uncertain_line is not None
    assert flag.uncertain_line.time_sec == 92.0
    assert not is_checked(result[3])


def test_a_rit_mark_never_explains_a_weak_downbeat() -> None:
    result = run([BAR] * 8, marks=RIT_BAR_4, heights={60.0: 0.2})

    flag = only(result[3], "weak-downbeat")
    assert (flag.severity, flag.explained_by) == (1, None)


# --- weak downbeat -----------------------------------------------------------------------------


def test_an_activation_dip_at_a_bar_start_is_a_weak_downbeat() -> None:
    result = run([BAR] * 8, heights={60.0: 0.2})

    flag = only(result[3], "weak-downbeat")
    assert flag.severity == 1
    assert flag.expected == 0.3
    assert flag.found == pytest.approx(0.2)
    assert flag.factor is None
    assert [index for index, flags in enumerate(result) if flags] == [3]


def test_a_downbeat_of_exactly_0_3_is_not_weak() -> None:
    assert run([BAR] * 8, heights={60.0: 0.3}) == [[]] * 8


def test_the_downbeat_is_the_strongest_value_within_two_frames_of_the_start() -> None:
    starts = [0.0, 20.0, 40.0, 60.0]
    activation = np.zeros(round(81.0 * FPS))
    for t in starts:
        activation[round(t * FPS)] = 1.0
    activation[round(20.0 * FPS)] = 0.1
    activation[round(20.0 * FPS) + 2] = 0.9  # two frames late: still counts
    activation[round(40.0 * FPS)] = 0.1
    activation[round(40.0 * FPS) + 3] = 0.9  # three frames late: out of reach

    result = review_flags(slots_of(4), starts, 80.0, [], [], activation, FPS, None)

    assert result[1] == []
    assert only(result[2], "weak-downbeat").found == pytest.approx(0.1)


def test_a_start_beyond_the_activation_has_no_downbeat_at_all() -> None:
    starts = [0.0, 20.0, 40.0, 60.0]
    activation = np.ones(round(50.0 * FPS))  # ends before bars 3 and 4 begin

    result = review_flags(slots_of(4), starts, 80.0, [], [], activation, FPS, None)

    assert only(result[3], "weak-downbeat").found == 0.0


def test_a_fermata_never_explains_a_weak_downbeat() -> None:
    result = run([BAR] * 8, marks=[BarMark(bar=4, kind="fermata")], heights={60.0: 0.2})

    flag = only(result[3], "weak-downbeat")
    assert flag.severity == 1
    assert flag.explained_by is None


def test_a_weak_bar_start_between_two_strong_ones_in_a_repeating_pattern_is_not_flagged() -> None:
    # the detector hears the bars in pairs (a 2/4 piece read as 4/4): every other start is weak
    weak = {t: 0.1 for t in (20.0, 60.0, 100.0, 140.0)}

    assert run([BAR] * 8, heights=weak) == [[]] * 8


def test_a_weak_start_beside_another_weak_start_is_still_flagged() -> None:
    result = run([BAR] * 8, heights={60.0: 0.1, 80.0: 0.1})

    assert [index for index, flags in enumerate(result) if flags] == [3, 4]


def test_a_weak_start_whose_neighbour_is_weak_too_is_flagged_though_two_away_repeats() -> None:
    # 0.4 is not strong enough to make 20 s a clear pair partner of 60 s
    result = run([BAR] * 8, heights={20.0: 0.1, 40.0: 0.4, 60.0: 0.1})

    assert [index for index, flags in enumerate(result) if flags] == [1, 3]


def test_a_slot_can_carry_several_flags_in_a_fixed_order() -> None:
    lengths = [BAR, BAR, BAR, 14.0, BAR, BAR, BAR, BAR]
    starts = starts_of(lengths)
    beats = beats_for(starts, lengths, {3: 3})

    result = run(lengths, heights={60.0: 0.2}, beats=beats)

    assert [flag.kind for flag in result[3]] == ["crowded", "beat-count", "weak-downbeat"]


# --- another downbeat nearly as strong -----------------------------------------------------------


def with_half_bar_readings(
    lengths: list[float], bars: range, height: float
) -> tuple[np.ndarray, list[float], float]:
    """An activation with a bump on every start and one half a bar later in the given bars."""
    starts = starts_of(lengths)
    end = starts[-1] + lengths[-1]
    extra = {starts[i] + lengths[i] / 2: height for i in bars}
    return activation_for(starts + list(extra), end + 1.0, extra), starts, end


def other_run(
    lengths: list[float],
    bars: range,
    height: float,
    marks: list[BarMark] | None = None,
) -> list[list[ReviewFlag]]:
    activation, starts, end = with_half_bar_readings(lengths, bars, height)
    return review_flags(slots_of(len(lengths)), starts, end, [], marks or [], activation, FPS, None)


def test_a_second_reading_nearly_as_strong_flags_the_first_bar_of_its_run() -> None:
    result = other_run([BAR] * 12, range(4, 10), 0.9)

    flag = only(result[4], "other-downbeat")
    assert flag.severity == 1
    assert flag.expected == pytest.approx(1.0)
    assert flag.found == pytest.approx(0.9)
    assert flag.factor == pytest.approx(0.9)
    assert flag.explained_by is None
    assert flag.uncertain_line is not None
    assert flag.uncertain_line.time_sec == pytest.approx(4 * BAR + 2 * BEAT)
    assert flag.uncertain_line.confidence == pytest.approx(0.9)
    # one card for the run: the bars after it, which share the doubt, carry no flag of their own
    assert [index for index, flags in enumerate(result) if flags] == [4]


def test_a_second_reading_any_whole_number_of_beats_away_counts() -> None:
    lengths = [BAR] * 12
    starts = starts_of(lengths)
    end = starts[-1] + BAR
    # a bump one beat before the starts of bars 4 to 9: three beats after the starts of bars 3 to 8
    extra = {starts[i] - BEAT: 0.95 for i in range(4, 10)}
    activation = activation_for(starts + list(extra), end + 1.0, extra)

    result = review_flags(slots_of(12), starts, end, [], [], activation, FPS, None)

    flag = only(result[3], "other-downbeat")
    assert flag.uncertain_line is not None
    assert flag.uncertain_line.time_sec == pytest.approx(3 * BAR + 3 * BEAT)
    assert [index for index, flags in enumerate(result) if flags] == [3]


def test_a_second_reading_never_puts_a_bar_before_the_recording() -> None:
    lengths = [BAR] * 12
    starts = starts_of(lengths)
    end = starts[-1] + BAR
    # a bump one beat before the starts of bars 1 to 5: shifted one beat back, bar 0 would start
    # before the recording, which the curve cannot say anything about
    extra = {starts[i] - BEAT: 0.95 for i in range(1, 6)}
    activation = activation_for(starts + list(extra), end + 1.0, extra)

    result = review_flags(slots_of(12), starts, end, [], [], activation, FPS, None)

    lines = [f.uncertain_line for flags in result for f in flags if f.kind == "other-downbeat"]
    assert lines, "the reading three beats on is still a doubt"
    assert all(line is not None and line.time_sec >= 0 for line in lines)
    assert lines[0] is not None and lines[0].time_sec == pytest.approx(3 * BEAT)


def test_a_clearly_weaker_second_reading_is_no_doubt() -> None:
    assert other_run([BAR] * 12, range(4, 10), 0.8) == [[]] * 12


def test_a_second_reading_that_is_itself_weak_is_no_doubt() -> None:
    lengths = [BAR] * 12
    activation, starts, end = with_half_bar_readings(lengths, range(4, 10), 0.55)
    # every start at 0.55 as well: equal strength, but neither reading is a real downbeat
    flat = np.minimum(activation, 0.55)

    result = review_flags(slots_of(12), starts, end, [], [], flat, FPS, None)

    assert result == [[]] * 12


def test_a_second_reading_in_fewer_than_three_bars_is_no_doubt() -> None:
    assert other_run([BAR] * 12, range(4, 6), 0.9) == [[]] * 12


def test_the_last_bars_are_judged_on_the_bars_that_are_left() -> None:
    result = other_run([BAR] * 12, range(8, 12), 0.9)

    assert only(result[8], "other-downbeat")
    assert result[9:] == [[]] * 3  # the run's later bars carry none
    assert other_run([BAR] * 12, range(10, 12), 0.9) == [[]] * 12  # two bars are too few


def test_a_fermata_bar_ends_the_window_and_cannot_start_one() -> None:
    marks = [BarMark(bar=8, kind="fermata")]  # slot 7
    lengths = [BAR] * 7 + [40.0] + [BAR] * 6

    # two bars before the held one, and the held one itself, have the other reading
    result = other_run(lengths, range(5, 8), 0.9, marks=marks)

    assert [flag.kind for flags in result for flag in flags] == ["stretched"]


def test_a_run_after_a_fermata_bar_is_flagged_on_its_first_bar() -> None:
    marks = [BarMark(bar=8, kind="fermata")]
    lengths = [BAR] * 7 + [40.0] + [BAR] * 6

    result = other_run(lengths, range(8, 14), 0.9, marks=marks)

    assert only(result[8], "other-downbeat")
    assert [
        i for i, flags in enumerate(result) if any(f.kind == "other-downbeat" for f in flags)
    ] == [8]


def test_other_readings_are_listed_after_the_other_flags() -> None:
    lengths = [BAR] * 12
    activation, starts, end = with_half_bar_readings(lengths, range(4, 10), 0.9)
    index = round(starts[4] * FPS)
    activation[index - 2 : index + 3] = 0.2  # a weak downbeat on slot 4 as well

    result = review_flags(slots_of(12), starts, end, [], [], activation, FPS, None)

    assert [flag.kind for flag in result[4]] == ["weak-downbeat", "other-downbeat"]


# --- is_checked --------------------------------------------------------------------------------


def flag(severity: int, explained_by: str | None = None) -> ReviewFlag:
    return ReviewFlag(
        kind="stretched",
        severity=severity,  # type: ignore[arg-type]
        expected=20.0,
        found=32.0,
        factor=1.6,
        explained_by=explained_by,  # type: ignore[arg-type]
    )


def test_is_checked_needs_flags_and_all_of_them_explained() -> None:
    assert not is_checked([])
    assert is_checked([flag(0, "fermata")])
    assert is_checked([flag(0, "fermata"), flag(0, "fermata")])
    assert not is_checked([flag(0, "fermata"), flag(1)])
    assert not is_checked([flag(1, "fermata")])


# --- a pickup and other short bars ---------------------------------------------------------------


def pickup_run(
    *, sources: int = 2, beats: list[float] | None = None, units: int = 1
) -> list[list[ReviewFlag]]:
    """Bar 0 of `units` beats (5 s each), then bars 1-6 of 4/4; no downbeat is heard at bar 0."""
    lengths = [units * BEAT] + [BAR] * 6
    starts = starts_of(lengths)
    end = starts[-1] + BAR
    return review_flags(
        expand_play_order([PlayOrderRow(start=0, end=6)], 6),
        starts,
        end,
        [MeterChange(from_bar=1, numerator=4, denominator=4)],
        [],
        activation_for(starts[1:], end + 1.0),
        FPS,
        beats,
        short_bars={0: units},
        pickup_sources=sources,
    )


def test_a_pickup_two_readings_agree_on_and_a_beat_supports_has_no_flag() -> None:
    result = pickup_run(beats=[0.0, 5.0, 25.0])

    assert result[0] == []  # no weak downbeat, no crowded, no beat count for a pickup
    assert all(flags == [] for flags in result)


def test_a_pickup_only_one_reading_called_one_is_flagged_for_review() -> None:
    flag = only(pickup_run(sources=1, beats=[0.0, 5.0, 25.0])[0], "pickup")

    assert (flag.severity, flag.expected, flag.found) == (1, 2, 1)


def test_a_pickup_no_beat_lies_near_is_flagged_even_when_the_readings_agree() -> None:
    flag = only(pickup_run(beats=[5.0, 25.0, 45.0])[0], "pickup")

    assert (flag.severity, flag.expected, flag.found) == (1, 2, 2)


def test_a_pickup_is_not_flagged_for_a_missing_beat_when_the_beats_are_not_known() -> None:
    assert pickup_run(beats=None)[0] == []


def test_a_pickup_beat_a_little_off_its_start_still_supports_it() -> None:
    assert pickup_run(beats=[1.0, 5.0, 25.0])[0] == []  # within half its length (2.5 s)


def test_a_short_bar_is_judged_by_its_own_length_against_its_neighbours() -> None:
    # bar 3 holds 2 of 4 beats and lasts 10 s: the same 5 s a beat as the bars around it
    lengths = [BAR, BAR, 10.0, BAR, BAR, BAR]
    starts = starts_of(lengths)
    end = starts[-1] + BAR
    result = review_flags(
        slots_of(6),
        starts,
        end,
        [MeterChange(from_bar=1, numerator=4, denominator=4)],
        [],
        activation_for(starts, end + 1.0),
        FPS,
        beats_for(starts, lengths, {2: 2}),
        short_bars={3: 2},
    )

    assert all(flags == [] for flags in result)


def test_the_skipped_repeat_is_flagged_on_the_bar_that_carries_its_sign() -> None:
    written = [PlayOrderRow(start=0, end=42), PlayOrderRow(start=21, end=55)]
    played = [PlayOrderRow(start=0, end=55)]

    assert skipped_repeat_bars(written, played) == {42}


def test_a_skipped_first_ending_is_flagged_on_the_bar_before_it() -> None:
    written = [
        PlayOrderRow(start=1, end=8),
        PlayOrderRow(start=1, end=6),
        PlayOrderRow(start=9, end=12),
    ]
    played = [PlayOrderRow(start=1, end=6), PlayOrderRow(start=9, end=12)]

    assert skipped_repeat_bars(written, played) == {6}


def test_a_jump_the_recording_still_plays_is_not_a_skipped_repeat() -> None:
    written = [
        PlayOrderRow(start=1, end=4),
        PlayOrderRow(start=1, end=12),
        PlayOrderRow(start=1, end=6),
    ]
    played = [PlayOrderRow(start=1, end=12), PlayOrderRow(start=1, end=6)]

    assert skipped_repeat_bars(written, played) == {4}
