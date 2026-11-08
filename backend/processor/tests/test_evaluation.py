import pytest

from app.pipeline.evaluation import (
    GATE_ALIGNED_WITHIN_100,
    GATE_BAR_LINE_RECALL,
    bar_edges,
    beat_this_downbeats,
    compare_bar_lines,
    compare_downbeats,
    compare_rests,
    compare_structure,
    compare_to_taps,
    gate_passes,
    line_count,
    meets_gate,
    parse_summary,
    parse_taps,
    play_slots,
    pool,
    share_within_100ms,
)
from app.pipeline.metrics import match_events
from app.pipeline.run_folder import PageLayer, TimingLayer
from tests.run_fixtures import page_layer, timing_layer
from tests.synthetic import logit_curves


def pages(mutate=None) -> PageLayer:
    data = page_layer("part-flute")
    if mutate:
        mutate(data)
    return PageLayer.model_validate(data)


def timing(mutate=None) -> TimingLayer:
    data = timing_layer()
    if mutate:
        mutate(data)
    return TimingLayer.model_validate(data)


WIDTHS = {0: 200.0}  # the fixture page is 200 px wide, so 1.5 % is 3 px


# ------------------------------------------------------------ bar lines


def test_a_line_of_four_bars_has_four_bar_lines_with_their_neighbours() -> None:
    edges = bar_edges(pages())

    assert len(edges) == 8  # two systems; the start of a line is not a bar line
    first = [e for e in edges if e.y0 < 40]
    assert [e.x for e in first] == [55.0, 100.0, 145.0, 190.0]
    assert [(e.before, e.after) for e in first] == [(1, 2), (2, 3), (3, 4), (4, None)]


def after_a_signature(data: dict) -> None:
    """Bar 1 and bar 3 start 12 px later: the start of a line, and a clef / key after a gap."""
    bars = data["bars"]
    for index in (0, 2):
        bars[index]["x"] += 12.0
        bars[index]["w"] -= 12.0


def test_the_start_of_a_box_after_a_gap_is_not_a_bar_line_and_the_gap_does_not_move_the_line() -> (
    None
):
    edges = bar_edges(pages(after_a_signature))
    first = [e for e in edges if e.y0 < 40]
    assert [e.x for e in first] == [55.0, 100.0, 145.0, 190.0]
    assert [e.x for e in edges] == [e.x for e in bar_edges(pages())]


def test_a_gap_after_a_bar_line_leaves_the_bar_line_on_the_box_before_it() -> None:
    def gap(data: dict) -> None:
        data["bars"][2]["x"] += 12.0  # bar 3 starts after a signature
        data["bars"][2]["w"] -= 12.0

    first = [e for e in bar_edges(pages(gap)) if e.y0 < 40]
    assert [e.x for e in first] == [55.0, 100.0, 145.0, 190.0]


def test_trimming_the_left_edges_cannot_change_the_score() -> None:
    score = compare_bar_lines(pages(), pages(after_a_signature), WIDTHS, 0.015)
    assert score.match.recall == 1.0 and score.match.precision == 1.0
    assert score.match.truth == 8 and score.missed == [] and score.extra == []


def test_boxes_a_slight_tilt_apart_still_share_one_bar_line() -> None:
    def tilt(data: dict) -> None:
        data["bars"][1]["x"] += 1.5  # 1.5 px of the 40 px box height: touching
        data["bars"][1]["w"] -= 1.5

    first = [e for e in bar_edges(pages(tilt)) if e.y0 < 40]
    assert len(first) == 4 and first[0].x == pytest.approx(55.75)


def test_lines_are_counted_by_system() -> None:
    assert line_count(pages()) == 2


def test_an_identical_page_layer_is_perfect() -> None:
    score = compare_bar_lines(pages(), pages(), WIDTHS, 0.015)

    assert score.match.recall == 1.0 and score.match.precision == 1.0
    assert score.missed == [] and score.extra == []


def test_a_missed_bar_line_is_listed_by_bar_and_page() -> None:
    def merge_bars_2_and_3(data: dict) -> None:
        bars = data["bars"]
        bars[1]["w"] = 90.0  # bar 2 now runs to the end of bar 3
        del bars[2]

    found = pages(merge_bars_2_and_3)

    score = compare_bar_lines(pages(), found, WIDTHS, 0.015)

    assert score.match.matched == 7 and score.match.truth == 8 and score.match.predicted == 7
    assert score.match.recall == pytest.approx(7 / 8)
    assert score.match.precision == 1.0
    assert [(e.page, e.before, e.after) for e in score.missed] == [(0, 2, 3)]
    assert score.extra == []


def test_an_extra_bar_line_is_listed() -> None:
    def split_bar_1(data: dict) -> None:
        bars = data["bars"]
        bars[0]["w"] = 20.0
        bars.append({"bar": 9, "pageIndex": 0, "x": 30.0, "y": 5.0, "w": 25.0, "h": 40.0})

    score = compare_bar_lines(pages(), pages(split_bar_1), WIDTHS, 0.015)

    assert score.match.recall == 1.0
    assert score.match.precision == pytest.approx(8 / 9)
    assert [(e.before, e.after) for e in score.extra] == [(1, 9)]


def test_a_bar_line_moved_within_the_tolerance_still_matches_and_beyond_does_not() -> None:
    def move(dx: float):
        def mutate(data: dict) -> None:
            data["bars"][0]["w"] += dx  # the line between bars 1 and 2
            data["bars"][1]["x"] += dx
            data["bars"][1]["w"] -= dx

        return mutate

    inside = compare_bar_lines(pages(), pages(move(2.9)), WIDTHS, 0.015)
    outside = compare_bar_lines(pages(), pages(move(3.5)), WIDTHS, 0.015)

    assert inside.match.recall == 1.0
    assert outside.match.matched == 7
    assert len(outside.missed) == 1 and len(outside.extra) == 1


def test_bar_lines_on_another_system_never_match() -> None:
    def second_system_up(data: dict) -> None:
        for bar in data["bars"][4:]:
            bar["y"] = 5.0  # same x as the first system, now on the first line

    score = compare_bar_lines(pages(), pages(second_system_up), WIDTHS, 0.015)

    assert score.match.recall < 1.0


def test_a_layer_with_no_boxes_scores_nothing_found() -> None:
    empty = pages(lambda data: data["bars"].clear())

    score = compare_bar_lines(pages(), empty, WIDTHS, 0.015)

    assert score.match.recall == 0.0 and score.match.precision == 0.0
    assert len(score.missed) == 8


# ------------------------------------------------------------ structure


def test_the_same_structure_matches_everywhere() -> None:
    score = compare_structure(timing(), timing())

    assert score.same_bar_count and score.same_meters and score.same_play_order
    assert score.marks["fermata"].recall == 1.0 and score.marks["fermata"].precision == 1.0


def test_a_different_bar_count_meter_and_play_order_are_said() -> None:
    def key_with_a_repeat(data: dict) -> None:
        data["playOrder"] = [{"from": 1, "to": 8}, {"from": 7, "to": 8}]
        data["meters"].append({"fromBar": 5, "numerator": 3, "denominator": 4})
        data["barCount"] = 9
        data["playOrder"][0]["to"] = 9

    score = compare_structure(timing(key_with_a_repeat), timing())

    assert not score.same_bar_count and score.bar_count_key == 9 and score.bar_count_found == 8
    assert not score.same_meters
    assert not score.same_play_order
    assert score.play_order_key == [[1, 9], [7, 8]]


def test_marks_are_scored_by_kind() -> None:
    def key_marks(data: dict) -> None:
        data["marks"] = [
            {"bar": 3, "kind": "fermata"},
            {"bar": 5, "kind": "rit"},
            {"bar": 6, "kind": "rit"},
        ]

    def found_marks(data: dict) -> None:
        data["marks"] = [
            {"bar": 3, "kind": "fermata"},
            {"bar": 5, "kind": "rit"},
            {"bar": 8, "kind": "rit"},
        ]

    score = compare_structure(timing(key_marks), timing(found_marks))

    assert score.marks["fermata"].recall == 1.0 and score.marks["fermata"].precision == 1.0
    rit = score.marks["rit"]
    assert rit.recall == 0.5 and rit.precision == 0.5
    assert rit.missed == [6] and rit.extra == [8]
    assert set(score.marks) == {"fermata", "rit"}  # rests are a part's, scored per part


def test_a_parts_rests_are_scored_against_the_same_parts_key() -> None:
    key = pages(lambda d: d.update(rests=[3, 4, 5, 7]))
    found = pages(lambda d: d.update(rests=[3, 4, 6]))

    score = compare_rests(key, found)

    assert score.recall == 0.5 and score.precision == pytest.approx(2 / 3)
    assert score.missed == [5, 7] and score.extra == [6]


# ------------------------------------------------------------ downbeats


def with_times(base: TimingLayer, moves: dict[int, float] | None = None, **kw) -> TimingLayer:
    """The fixture timing with some bars moved by the given seconds, or flags set."""
    data = base.model_dump(by_alias=True)
    for loc in data["locators"]:
        loc["timeSec"] += (moves or {}).get(loc["bar"], 0.0)
        if loc["bar"] in kw.get("flagged", ()):
            loc["flags"] = [_FLAG]
    return TimingLayer.model_validate(data)


_FLAG = {
    "kind": "beat-count",
    "severity": 1,
    "expected": 4.0,
    "found": 3.0,
    "factor": None,
    "explainedBy": None,
    "uncertainLine": None,
}


def test_slots_follow_the_play_order_with_a_pass_count() -> None:
    def repeat(data: dict) -> None:
        data["barCount"] = 8
        data["playOrder"] = [{"from": 1, "to": 4}, {"from": 3, "to": 4}, {"from": 5, "to": 8}]

    assert play_slots(timing(repeat))[:7] == [
        (1, 0),
        (2, 0),
        (3, 0),
        (4, 0),
        (3, 1),
        (4, 1),
        (5, 0),
    ]


def test_a_perfect_map_has_no_error_anywhere() -> None:
    score = compare_downbeats(timing(), timing(), raw=[1.0 + 2.0 * i for i in range(8)])

    assert score.aligned is not None and score.aligned.summary.median_ms == 0.0
    assert score.aligned.summary.within_100ms == 1.0
    assert score.raw is not None and score.raw.summary.within_50ms == 1.0
    assert score.missed == [] and not score.play_order_differs


def test_a_shifted_locator_shows_in_the_median_the_fractions_and_the_worst_list() -> None:
    found = with_times(timing(), {3: 0.3, 4: 0.06})

    score = compare_downbeats(timing(), found, raw=[])

    assert score.aligned is not None
    assert score.aligned.summary.n == 8
    assert score.aligned.summary.within_100ms == pytest.approx(7 / 8)
    assert score.aligned.summary.within_50ms == pytest.approx(6 / 8)
    assert [(w.bar, round(w.error_ms)) for w in score.aligned.worst[:2]] == [(3, 300), (4, 60)]
    assert score.raw is None  # nothing detected


def test_raw_downbeats_are_the_nearest_detected_to_each_key_time() -> None:
    raw = [1.0, 3.12, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0]  # bar 2 is 120 ms late

    score = compare_downbeats(timing(), timing(), raw=raw)

    assert score.raw is not None
    assert score.raw.worst[0].bar == 2 and round(score.raw.worst[0].error_ms) == 120
    assert score.raw.summary.within_100ms == pytest.approx(7 / 8)


def test_a_slot_the_pipeline_lacks_is_missed_not_counted() -> None:
    def drop_bar_8(data: dict) -> None:
        data["locators"].pop()

    score = compare_downbeats(timing(), timing(drop_bar_8), raw=[])

    assert score.missed == [(8, 0)]
    assert score.aligned is not None and score.aligned.summary.n == 7


def test_a_repeat_added_in_the_key_is_compared_by_bar_and_pass() -> None:
    def key_repeat(data: dict) -> None:
        data["playOrder"] = [{"from": 1, "to": 8}, {"from": 7, "to": 8}]
        data["locators"] += [
            {"bar": 7, "passIndex": 1, "timeSec": 17.0, "confirmed": True},
            {"bar": 8, "passIndex": 1, "timeSec": 19.0, "confirmed": True},
        ]

    score = compare_downbeats(timing(key_repeat), timing(), raw=[])

    assert score.play_order_differs
    assert score.missed == [(7, 1), (8, 1)]
    assert score.aligned is not None and score.aligned.summary.n == 8


def test_flags_are_judged_against_the_real_errors() -> None:
    found = with_times(timing(), {2: 0.3, 5: 0.4}, flagged={2, 3})

    score = compare_downbeats(timing(), found, raw=[])

    flags = score.flags
    assert (flags.bad, flags.flagged, flags.caught) == (2, 2, 1)
    assert flags.recall == 0.5 and flags.precision == 0.5


def test_an_explained_flag_is_not_a_flag_in_the_queue() -> None:
    data = timing().model_dump(by_alias=True)
    data["locators"][1]["flags"] = [{**_FLAG, "severity": 0, "explainedBy": "fermata"}]
    data["locators"][1]["checked"] = True

    score = compare_downbeats(timing(), TimingLayer.model_validate(data), raw=[])

    assert score.flags.flagged == 0


def test_flag_scores_are_undefined_when_there_is_nothing_to_judge() -> None:
    score = compare_downbeats(timing(), timing(), raw=[])

    assert score.flags.recall is None and score.flags.precision is None


def test_the_confirmed_slots_of_the_key_have_their_own_numbers() -> None:
    key = timing(lambda d: d["locators"][0].update(confirmed=True))
    found = with_times(timing(), {1: 0.2})

    score = compare_downbeats(key, found, raw=[])

    assert score.key_confirmed == 1
    assert score.aligned_confirmed is not None and score.aligned_confirmed.summary.n == 1
    assert score.aligned_confirmed.summary.median_ms == pytest.approx(200)


def test_raw_downbeats_come_from_the_logits_as_beat_this_picks_them() -> None:
    beats = [1.0 + 0.5 * i for i in range(40)]
    downbeats = [1.0 + 2.0 * i for i in range(10)]
    beat_logits, downbeat_logits = logit_curves(beats, downbeats, 30.0)

    assert beat_this_downbeats(beat_logits, downbeat_logits, 50.0) == pytest.approx(downbeats)


def test_a_downbeat_between_beats_is_moved_to_the_nearest_beat() -> None:
    beat_logits, downbeat_logits = logit_curves([1.0, 1.5, 2.0], [1.46], 5.0)

    assert beat_this_downbeats(beat_logits, downbeat_logits, 50.0) == pytest.approx([1.5])


# ------------------------------------------------------------ taps, costs, gate


def test_taps_are_read_from_a_sonic_visualiser_export() -> None:
    text = "# header\n1.0\n3.0\tbar 2\n5.0,bar 3\n\ntime,label\n7.000000 1\n"

    assert parse_taps(text) == [1.0, 3.0, 5.0, 7.0]


def test_taps_are_compared_to_the_keys_downbeats_in_play_order() -> None:
    taps = [1.0 + 2.0 * i for i in range(8)]
    taps[2] += 0.25

    score = compare_to_taps(timing(), taps)

    assert score.taps == 8 and score.key_slots == 8
    assert score.summary is not None and score.summary.median_ms == 0.0
    assert [(w.bar, round(w.error_ms)) for w in score.over_100ms] == [(3, 250)]


def test_no_taps_means_no_numbers() -> None:
    assert compare_to_taps(timing(), []).summary is None


SUMMARY = """Ammerland – Jacob de Haan
recording 3:16; 47 bars, 47 locators, 14 to review; full run

warnings: none

time per stage:
  audio: 7.7 s
  pages: 4.8 s
  read the score: 71.9 s
  Audiveris (in the read): 64.8 s
  vision reader (in the read): 0.0 s
  downbeats: 63.9 s
  align: 0.1 s
vision cost this run: $0.000 (reused the saved reading, $0.013 when it was made)
"""


def test_the_summary_text_gives_stage_times_and_the_cost() -> None:
    cost = parse_summary(SUMMARY)

    assert cost.mode == "full"
    assert cost.stage_seconds["read the score"] == 71.9
    assert cost.total_seconds == pytest.approx(7.7 + 4.8 + 71.9 + 63.9 + 0.1)  # sub-steps not added
    assert cost.cost_usd == 0.0 and cost.earlier_cost_usd == 0.013
    assert cost.vision_cost_usd == 0.013


def test_a_summary_of_a_run_from_the_alignment_says_so() -> None:
    text = SUMMARY.replace("full run", "from the alignment onwards")

    assert parse_summary(text).mode == "from align"


def test_a_text_that_is_not_a_summary_gives_nothing() -> None:
    assert parse_summary("hello") is None


def test_the_gate_is_two_lines_and_two_pieces() -> None:
    assert meets_gate(GATE_BAR_LINE_RECALL, GATE_ALIGNED_WITHIN_100) == (True, True)
    assert meets_gate(0.5, 1.0) == (False, True)
    assert meets_gate(1.0, None) == (True, False)
    assert gate_passes([(1.0, 0.95), (0.92, 0.9)])
    assert not gate_passes([(1.0, 0.95), (0.7, 0.9)])
    assert not gate_passes([(1.0, 0.95)])  # one piece is not enough


def test_parts_pool_into_one_bar_line_score() -> None:
    a = match_events([1.0, 2.0], [1.0], 0.0)
    b = match_events([1.0, 2.0], [1.0, 2.0, 3.0], 0.0)

    pooled = pool([a, b])

    assert (pooled.matched, pooled.truth, pooled.predicted) == (3, 4, 4)
    assert pooled.recall == 0.75 and pooled.precision == 0.75


def test_the_gate_share_counts_a_missing_bar_as_off() -> None:
    found = with_times(timing(), {1: 0.5})
    found.locators.pop()  # bar 8 is missing

    score = compare_downbeats(timing(), found, raw=[])

    assert share_within_100ms(score) == pytest.approx(6 / 8)
    assert (
        share_within_100ms(compare_downbeats(timing(lambda d: d["locators"].clear()), found, []))
        is None
    )
