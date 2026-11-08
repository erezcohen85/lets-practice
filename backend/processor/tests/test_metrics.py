import pytest

from app.pipeline.metrics import (
    MatchResult,
    TimingSummary,
    bar_line_recall,
    match_events,
    summarize_timing,
    timing_errors_ms,
)


def test_perfect_match_scores_one():
    result = match_events([1.0, 2.0, 3.0], [1.0, 2.0, 3.0], tolerance=0.1)
    assert result == MatchResult(recall=1.0, precision=1.0, matched=3, truth=3, predicted=3)


def test_small_offsets_inside_tolerance_still_match():
    result = match_events([1.0, 2.0], [1.05, 1.95], tolerance=0.1)
    assert result.matched == 2
    assert result.recall == 1.0
    assert result.precision == 1.0


def test_distance_exactly_at_tolerance_matches():
    assert match_events([1.0], [1.5], tolerance=0.5).matched == 1


def test_distance_beyond_tolerance_does_not_match():
    assert match_events([1.0], [1.6], tolerance=0.5).matched == 0


def test_one_missed_event_lowers_recall_only():
    result = match_events([1.0, 2.0, 3.0, 4.0], [1.0, 2.0, 4.0], tolerance=0.1)
    assert result.matched == 3
    assert result.recall == pytest.approx(0.75)
    assert result.precision == 1.0
    assert (result.truth, result.predicted) == (4, 3)


def test_one_extra_event_lowers_precision_only():
    result = match_events([1.0, 2.0, 3.0], [1.0, 2.0, 2.5, 3.0], tolerance=0.1)
    assert result.matched == 3
    assert result.recall == 1.0
    assert result.precision == pytest.approx(0.75)
    assert (result.truth, result.predicted) == (3, 4)


def test_one_missed_and_one_extra_event_lower_both():
    result = match_events([1.0, 2.0, 3.0, 4.0], [1.0, 2.0, 3.0, 9.0], tolerance=0.1)
    assert result.matched == 3
    assert result.recall == pytest.approx(0.75)
    assert result.precision == pytest.approx(0.75)


def test_one_prediction_cannot_match_two_truth_events():
    result = match_events([1.0, 1.2], [1.1], tolerance=0.5)
    assert result.matched == 1
    assert result.recall == pytest.approx(0.5)
    assert result.precision == 1.0


def test_one_truth_event_cannot_match_two_predictions():
    result = match_events([1.1], [1.0, 1.2], tolerance=0.5)
    assert result.matched == 1
    assert result.recall == 1.0
    assert result.precision == pytest.approx(0.5)


def test_greedy_takes_the_closest_pair_first():
    # the closest pair (0.75, 0.5) is taken first, which leaves truth 0.0 with nothing in reach;
    # an optimal assignment would match two, greedy-by-distance matches one by design
    result = match_events([0.0, 0.75], [0.5, 1.25], tolerance=0.5)
    assert result.matched == 1


def test_equal_distance_ties_go_to_the_earlier_truth_event():
    # 2.0 is 0.5 from both truths; the earlier truth takes it, so only one pair forms
    result = match_events([1.5, 2.5], [2.0], tolerance=0.5)
    assert result.matched == 1
    # with a second prediction only the later truth can still reach, proving the tie went early
    result = match_events([1.5, 2.5], [2.0, 2.9], tolerance=0.5)
    assert result.matched == 2


def test_input_order_does_not_matter():
    a = match_events([3.0, 1.0, 2.0], [2.05, 3.05, 0.95], tolerance=0.1)
    assert a.matched == 3


def test_inputs_are_not_modified():
    truth, predicted = [2.0, 1.0], [1.1, 2.1]
    match_events(truth, predicted, tolerance=0.5)
    assert truth == [2.0, 1.0]
    assert predicted == [1.1, 2.1]


def test_both_empty_scores_one():
    result = match_events([], [], tolerance=0.1)
    assert result == MatchResult(recall=1.0, precision=1.0, matched=0, truth=0, predicted=0)


def test_empty_truth_with_predictions_scores_zero():
    # convention: an empty denominator scores 1.0 only when both lists are empty, else 0.0
    result = match_events([], [1.0, 2.0], tolerance=0.1)
    assert result == MatchResult(recall=0.0, precision=0.0, matched=0, truth=0, predicted=2)


def test_empty_predictions_with_truth_scores_zero():
    result = match_events([1.0, 2.0], [], tolerance=0.1)
    assert result == MatchResult(recall=0.0, precision=0.0, matched=0, truth=2, predicted=0)


def test_negative_tolerance_raises():
    with pytest.raises(ValueError):
        match_events([1.0], [1.0], tolerance=-0.1)


def test_match_result_is_frozen():
    result = match_events([1.0], [1.0], tolerance=0.1)
    with pytest.raises(AttributeError):
        result.recall = 0.0  # type: ignore[misc]


def test_timing_errors_are_absolute_milliseconds_per_pair():
    errors = timing_errors_ms([1.0, 2.0, 3.0], [1.25, 1.5, 3.0])
    assert errors == pytest.approx([250.0, 500.0, 0.0])


def test_timing_errors_of_empty_lists_are_empty():
    assert timing_errors_ms([], []) == []


@pytest.mark.parametrize(("truth", "predicted"), [([1.0, 2.0], [1.0]), ([1.0], [1.0, 2.0])])
def test_timing_errors_of_different_lengths_raise(truth, predicted):
    with pytest.raises(ValueError):
        timing_errors_ms(truth, predicted)


def test_summary_of_ten_twenty_thirty_one_fifty():
    summary = summarize_timing([10.0, 20.0, 30.0, 150.0])
    assert summary == TimingSummary(
        median_ms=25.0, mean_ms=52.5, within_50ms=0.75, within_100ms=0.75, n=4
    )


def test_summary_counts_exactly_50_and_100_ms_as_within():
    summary = summarize_timing([50.0, 100.0, 100.5, 200.0])
    assert summary.within_50ms == pytest.approx(0.25)
    assert summary.within_100ms == pytest.approx(0.5)


def test_summary_of_a_single_error():
    summary = summarize_timing([100.0])
    assert summary == TimingSummary(
        median_ms=100.0, mean_ms=100.0, within_50ms=0.0, within_100ms=1.0, n=1
    )


def test_summary_of_empty_list_raises():
    with pytest.raises(ValueError):
        summarize_timing([])


def test_bar_line_recall_matches_x_positions_in_pixels():
    result = bar_line_recall([100.0, 300.0, 500.0], [102.0, 298.0, 700.0], tolerance_px=5.0)
    assert result.matched == 2
    assert result.recall == pytest.approx(2 / 3)
    assert result.precision == pytest.approx(2 / 3)
    assert (result.truth, result.predicted) == (3, 3)
