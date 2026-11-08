"""Tests for the bar boxes: fitting Audiveris' columns to the page and mapping them to the image.

Synthetic pages and hand-made stacks only; no sample files.
"""

from fractions import Fraction

import numpy as np
import pytest
from PIL import Image

from app.pipeline.bar_boxes import (
    BOX_MARGIN,
    HEADER_GAP,
    BoxAudit,
    BoxMap,
    PageTarget,
    Stack,
    box_audit_lines,
    box_audit_text,
    fit_columns,
    map_boxes,
    reconcile_line,
    stacks_of,
    trim_courtesy,
)
from app.pipeline.barlines import LineProbe, Staff
from app.pipeline.models import BarBox
from app.pipeline.omr import OmrLine, OmrMeasure, OmrStaff, OmrSystem, OmrSystemGeometry
from tests.barline_fixtures import (
    HEIGHT,
    SPACE,
    TOP,
    WIDTH,
    blank_page,
    draw_accidental,
    draw_bar,
    draw_hollow_notehead,
    draw_multi_rest,
    draw_notehead,
    draw_staff,
    page_with,
    staff_at,
)


def _st(left, right, expected=None, duration=None, signed_to=None) -> Stack:
    """A stack with fractions written as text, e.g. "1/2"; None for an unknown value."""

    def frac(text):
        return None if text is None else Fraction(text)

    return Stack(left, right, frac(expected), frac(duration), signed_to)


def _line(
    stacks,
    top=TOP,
    page=0,
    size=(WIDTH, HEIGHT),
    staves=None,
    header=None,
    opening=(),
    blocks=None,
    left=50.0,
) -> OmrLine:
    """A system of the synthetic page: one staff 80 px high and `stacks` as its columns.

    `header` is where its opening block ends, `opening` what that holds and `blocks` maps the
    index of a measure to the right edge of the signature printed at its start.
    """
    blocks = blocks or {}
    staves = staves or [
        OmrStaff(
            top_line=[(50.0, float(top)), (950.0, float(top))],
            bottom_line=[(50.0, float(top + 80)), (950.0, float(top + 80))],
        )
    ]
    return OmrLine(
        page=page,
        size=size,
        system=OmrSystem(
            top=staves[0].top,
            bottom=staves[-1].bottom,
            measures=[
                OmrMeasure(
                    left=s.left,
                    right=s.right,
                    expected=s.expected,
                    duration=s.duration,
                    signed_to=s.signed_to,
                    block_right=blocks.get(i),
                )
                for i, s in enumerate(stacks)
            ],
            header_stop=header,
            opening=list(opening),
        ),
        geometry=OmrSystemGeometry(left=left, right=950.0, staves=staves),
    )


LEVEL = {0: PageTarget(WIDTH, HEIGHT)}


def _boxes(stacks, count, page=None, spans=None, targets=LEVEL, **line_args) -> BoxMap:
    ink = {} if page is None else {0: page}
    return map_boxes([_line(stacks, **line_args)], [spans or [1] * count], ink, targets)


def _xs(result: BoxMap) -> list[tuple[int, int]]:
    return [(round(b.x), round(b.x + b.w)) for b in result.boxes]


def _confidences(result: BoxMap) -> set[str]:
    return {line.confidence for line in result.audit.lines}


def _changes(result: BoxMap) -> list[str]:
    return [change for line in result.audit.lines for change in line.changes]


# ---------------------------------------------------------------- the stacks


def test_the_stacks_of_a_line_are_its_columns_on_whole_pixels():
    line = _line([])
    line.system.measures.append(
        OmrMeasure(left=206.6, right=589.4, expected=Fraction(3, 4), duration=Fraction(1, 2))
    )
    assert stacks_of(line) == [Stack(207, 589, Fraction(3, 4), Fraction(1, 2))]


# ---------------------------------------------------------------- columns without the page


def test_boxes_use_the_stacks_when_the_count_matches():
    result = _boxes([_st(200, 600), _st(600, 900)], 2)
    assert _xs(result) == [(200, 600), (600, 900)]
    assert _confidences(result) == {"unchecked"}


def test_multi_rest_bars_share_the_printed_measure_box():
    result = _boxes([_st(200, 400), _st(400, 600), _st(600, 900)], 3, spans=[1, 2, 1])
    assert [b.bar for b in result.boxes] == [1, 2, 3, 4]
    assert result.boxes[1] == result.boxes[2].model_copy(update={"bar": 2})
    assert _xs(result) == [(200, 400), (400, 600), (400, 600), (600, 900)]


def test_bar_numbers_continue_across_lines_and_pages():
    lines = [
        _line([_st(200, 600), _st(600, 900)]),
        _line([_st(200, 900)], top=300),
        _line([_st(200, 900)], page=1),
    ]
    targets = {0: PageTarget(WIDTH, HEIGHT), 1: PageTarget(WIDTH, HEIGHT)}
    result = map_boxes(lines, [[1, 1], [1], [1]], {}, targets)
    assert [(b.bar, b.page_index) for b in result.boxes] == [(1, 0), (2, 0), (3, 0), (4, 1)]
    assert [line.bar for line in result.audit.lines] == [1, 3, 4]
    assert [line.page for line in result.audit.lines] == [0, 0, 1]


def test_stack_count_mismatch_splits_the_system_evenly_and_is_uncertain():
    result = _boxes([_st(200, 500), _st(500, 800), _st(800, 1000)], 4)
    assert _xs(result) == [(200, 400), (400, 600), (600, 800), (800, 1000)]
    assert _confidences(result) == {"uncertain"}


def test_a_false_bar_line_inside_a_measure_is_merged_not_spread_over_the_line():
    # Audiveris line 5 of a real part: 7 stacks for 6 measures; the line at x=1108 is a half
    # note's stem, so the (1046, 1108) and (1108, 1362) fragments are one bar
    stacks = [
        _st(215, 708, 1, 1),
        _st(708, 1046, 1, 1),
        _st(1046, 1108, 1, 0),
        _st(1108, 1362, 1, "1/2"),
        _st(1362, 1738, 1, 1),
        _st(1738, 2051, 1, 1),
        _st(2051, 2392, 1, 1),
    ]
    result = _boxes(stacks, 6, targets={0: PageTarget(2400, 2400)}, size=(2400, 2400))
    assert _xs(result) == [
        (215, 708),
        (708, 1046),
        (1046, 1362),
        (1362, 1738),
        (1738, 2051),
        (2051, 2392),
    ]
    assert _confidences(result) == {"unchecked"}


def test_a_merge_prefers_two_fragments_over_a_pair_that_adds_up_to_a_measure():
    stacks = [
        _st(100, 300, 1, 1),
        _st(300, 400, 1, 0),
        _st(400, 500, 1, "1/4"),
        _st(500, 700, 1, 1),
    ]
    assert _xs(_boxes(stacks, 3)) == [(100, 300), (300, 500), (500, 700)]


def test_a_fragment_next_to_full_measures_merges_with_the_closer_total():
    # 1 + 0 -> cost 1; 0 + 1 -> cost 1; the tie goes to the narrower combined width
    stacks = [_st(100, 500, 1, 1), _st(500, 560, 1, 0), _st(560, 700, 1, 1)]
    assert _xs(_boxes(stacks, 2)) == [(100, 500), (500, 700)]


def test_the_pair_with_the_closer_total_beats_a_narrower_pair():
    # 1 + 1/2 over a measure of 1 -> cost 3/2 (narrowest pair); 1 + 0 -> cost 1 wins
    stacks = [
        _st(100, 400, 1, 1),
        _st(400, 460, 1, "1/2"),
        _st(460, 900, 1, 1),
        _st(900, 960, 1, 0),
    ]
    assert _xs(_boxes(stacks, 3)) == [(100, 400), (400, 460), (460, 960)]


def test_several_fragments_collapse_into_one_measure():
    stacks = [
        _st(100, 400, 1, 1),
        _st(400, 450, 1, "1/4"),
        _st(450, 500, 1, "1/4"),
        _st(500, 560, 1, "1/4"),
        _st(560, 900, 1, 1),
    ]
    result = _boxes(stacks, 3)
    assert _xs(result) == [(100, 400), (400, 560), (560, 900)]
    assert _confidences(result) == {"unchecked"}


def test_unknown_durations_merge_the_pair_with_the_narrowest_combined_width():
    stacks = [_st(100, 500), _st(500, 560), _st(560, 700), _st(700, 900)]
    assert _xs(_boxes(stacks, 3)) == [(100, 500), (500, 700), (700, 900)]


def test_unknown_durations_cost_more_than_a_pair_that_adds_up():
    # (100, 500) + (500, 560): 1 + 0 -> cost 1; the unknown pair (560, 700) + (700, 800) costs 2
    stacks = [_st(100, 500, 1, 1), _st(500, 560, 1, 0), _st(560, 700), _st(700, 800)]
    assert _xs(_boxes(stacks, 3)) == [(100, 560), (560, 700), (700, 800)]


def test_a_missed_bar_line_splits_the_overfull_stack_in_two_equal_halves():
    stacks = [_st(200, 500, 1, 1), _st(500, 1100, 1, 2), _st(1100, 1400, 1, 1)]
    result = _boxes(stacks, 4, targets={0: PageTarget(1500, 600)}, size=(1500, 600))
    assert _xs(result) == [(200, 500), (500, 800), (800, 1100), (1100, 1400)]
    assert _confidences(result) == {"unchecked"}


def test_the_stack_with_the_largest_duration_is_split_first():
    stacks = [_st(100, 500, 1, 2), _st(500, 1100, 1, 3), _st(1100, 1300, 1, 1)]
    result = _boxes(stacks, 4, targets={0: PageTarget(1500, 600)}, size=(1500, 600))
    assert _xs(result) == [(100, 500), (500, 800), (800, 1100), (1100, 1300)]


def test_no_stack_to_split_falls_back_to_the_even_split_and_is_uncertain():
    # one stack is a bit long (3/2 of a measure) but none holds two measures
    stacks = [_st(200, 500, 1, 1), _st(500, 800, 1, "3/2"), _st(800, 1000, 1, 1)]
    result = _boxes(stacks, 4, targets={0: PageTarget(1500, 600)}, size=(1500, 600))
    assert _xs(result) == [(200, 400), (400, 600), (600, 800), (800, 1000)]
    assert _confidences(result) == {"uncertain"}


def test_stacks_without_expected_or_duration_never_split():
    result = _boxes([_st(200, 500), _st(500, 1000)], 3, targets={0: PageTarget(1500, 600)},
                    size=(1500, 600))  # fmt: skip
    assert _xs(result) == [(200, 467), (467, 733), (733, 1000)]
    assert _confidences(result) == {"uncertain"}


def test_a_matching_count_keeps_every_stack_even_when_one_is_a_fragment():
    stacks = [_st(100, 400, 1, 1), _st(400, 450, 1, 0), _st(450, 900, 1, 1)]
    result = _boxes(stacks, 3)
    assert _xs(result) == [(100, 400), (400, 450), (450, 900)]
    assert _confidences(result) == {"unchecked"}


def test_fit_columns_says_whether_the_columns_follow_real_bar_lines():
    assert fit_columns([_st(0, 100), _st(100, 200)], 2) == ([(0, 100), (100, 200)], True)
    assert fit_columns([_st(0, 100), _st(100, 200)], 4) == (
        [(0, 50), (50, 100), (100, 150), (150, 200)],
        False,
    )


def test_a_system_audiveris_found_no_measure_in_is_split_evenly_and_uncertain():
    result = _boxes([], 2, page=page_with(500))
    assert _xs(result) == [(50, 500), (500, 950)]
    assert _confidences(result) == {"uncertain"}
    assert "no measure" in _changes(result)[0]


# ---------------------------------------------------------------- checked against the page image


def _checked(stacks, count, page, **line_args) -> BoxMap:
    return _boxes(stacks, count, page=page, **line_args)


def test_bar_lines_that_all_check_out_make_a_verified_line():
    result = _checked([_st(100, 300), _st(300, 600), _st(600, 900)], 3, page_with(300, 600))
    assert _xs(result) == [(100, 300), (300, 600), (600, 900)]
    assert _confidences(result) == {"verified"}
    assert result.audit.to_dict()["verified"] == 1 and result.audit.to_dict()["details"] == []


def test_a_boundary_that_is_a_stem_is_dropped_and_the_line_is_repaired():
    page = page_with(300, 600)
    draw_bar(page, 500, y0=TOP + 10, y1=TOP + 80)  # a stem where Audiveris saw a bar line
    stacks = [_st(100, 300), _st(300, 500), _st(500, 600), _st(600, 900)]
    result = _checked(stacks, 3, page)
    assert _xs(result) == [(100, 300), (300, 600), (600, 900)]
    assert _confidences(result) == {"repaired"}
    detail = result.audit.to_dict()["details"][0]
    assert (detail["page"], detail["bar"], detail["confidence"]) == (0, 1, "repaired")
    assert "dropped false bar line at x=500" in detail["changes"][0]
    assert "coverage 0.9" in detail["changes"][0]


def test_a_bar_line_audiveris_missed_is_added_from_the_scan():
    result = _checked([_st(100, 300), _st(300, 900)], 3, page_with(300, 600))
    assert _xs(result) == [(100, 300), (300, 600), (600, 900)]
    assert _confidences(result) == {"repaired"}
    assert "added missed bar line at x=600" in _changes(result)[0]


def test_a_bar_line_beside_a_boundary_is_that_boundary_not_one_more():
    # Audiveris put its boundary 10 px off the bar line; three columns for four measures stays
    # too few, because the scan's lines are the two boundaries it already has
    result = _checked([_st(100, 300), _st(300, 610), _st(610, 900)], 4, page_with(300, 600))
    assert _confidences(result) == {"uncertain"} and len(result.boxes) == 4


def test_one_wrong_and_one_missed_boundary_are_swapped():
    page = page_with(300, 700)
    draw_bar(page, 500, y0=TOP + 10, y1=TOP + 80)
    result = _checked([_st(100, 300), _st(300, 500), _st(500, 900)], 3, page)
    assert _xs(result) == [(100, 300), (300, 700), (700, 900)]
    assert _confidences(result) == {"repaired"}
    changes = _changes(result)
    assert "dropped false bar line at x=500" in changes[0]
    assert "added missed bar line at x=700" in changes[1]


def test_a_boundary_nothing_on_the_page_confirms_makes_an_uncertain_line():
    result = _checked([_st(100, 300), _st(300, 900)], 2, page_with())  # no bar line at all
    assert _xs(result) == [(100, 300), (300, 900)]
    assert _confidences(result) == {"uncertain"}
    assert "could not verify bar line at x=300" in _changes(result)[0]


def test_fragments_settle_it_when_every_boundary_is_a_verified_bar_line():
    # a half note's stem drawn as tall as a bar line: the page cannot tell, the durations can
    stacks = [
        _st(100, 300, 1, 1),
        _st(300, 340, 1, 0),
        _st(340, 600, 1, "1/2"),
        _st(600, 900, 1, 1),
    ]
    result = _checked(stacks, 3, page_with(300, 340, 600))
    assert _xs(result) == [(100, 300), (300, 600), (600, 900)]
    assert _confidences(result) == {"repaired"}
    assert "merged" in _changes(result)[0]


def test_too_many_verified_boundaries_without_fragments_make_an_uncertain_line():
    stacks = [_st(100, 300, 1, 1), _st(300, 500, 1, 1), _st(500, 700, 1, 1), _st(700, 900, 1, 1)]
    result = _checked(stacks, 3, page_with(300, 500, 700))
    assert len(result.boxes) == 3 and _confidences(result) == {"uncertain"}


def test_a_stack_holding_two_measures_is_halved_but_the_unconfirmed_bar_line_is_uncertain():
    result = _checked([_st(100, 300, 1, 1), _st(300, 900, 1, 2)], 3, page_with(300))
    assert _xs(result) == [(100, 300), (300, 600), (600, 900)]
    assert _confidences(result) == {"uncertain"}
    assert "split" in _changes(result)[0]


def test_without_any_evidence_the_line_is_split_evenly_and_uncertain():
    result = _checked([_st(100, 500), _st(500, 900)], 4, page_with())
    assert _xs(result) == [(100, 300), (300, 500), (500, 700), (700, 900)]
    assert _confidences(result) == {"uncertain"}
    assert "evenly" in _changes(result)[-1]


def test_the_candidate_in_the_overfull_column_is_the_one_added():
    # 300 and 700 are bar lines the stacks do not have
    result = _checked([_st(100, 500, 1, 1), _st(500, 900, 1, 2)], 3, page_with(300, 500, 700))
    assert _xs(result) == [(100, 500), (500, 700), (700, 900)]


def test_a_page_without_an_image_is_not_checked():
    result = _boxes([_st(100, 500), _st(500, 900)], 2, page=None)
    assert _confidences(result) == {"unchecked"}


# ---------------------------------------------------------------- the courtesy signature


def _ends_with(left, right, duration, signed_to=None):
    """Stacks of a line (staff 80 px high) whose last stack runs from `left` to `right`;
    `signed_to` is where Audiveris says the key or time signature in it ends."""
    columns = [(100, 300, 1, 1), (300, 600, 1, 1)]
    if left > 600:
        columns.append((600, left, 1, 1))
    return [_st(*c) for c in [*columns, (left, right, 1, duration, signed_to)]]


def _bounds(stacks):
    return [(s.left, s.right) for s in stacks]


def _courtesy_probe(page):
    return LineProbe(page, [staff_at()])


def _double_bar_page():
    """Bar lines at 300 and 600 and a double bar line (strokes at 795 and 806) that ends the
    line; Audiveris' boundary is on the thick stroke, so the courtesy stack begins at 806."""
    return page_with(300, 600, 795, 806)


def test_a_narrow_region_without_notes_after_a_double_bar_line_is_not_a_measure():
    trimmed = trim_courtesy(_ends_with(806, 900, 0), _courtesy_probe(_double_bar_page()))
    assert _bounds(trimmed) == [(100, 300), (300, 600), (600, 800)]


def test_the_key_signature_of_a_courtesy_region_is_not_music():
    page = _double_bar_page()
    draw_accidental(page, 830, TOP + SPACE)
    draw_accidental(page, 860, TOP + 3 * SPACE)
    trimmed = trim_courtesy(_ends_with(806, 900, 0), _courtesy_probe(page))
    assert _bounds(trimmed)[-1] == (600, 800)


def test_a_narrow_region_after_a_single_bar_line_is_a_measure():
    stacks = _ends_with(800, 900, 0)
    assert trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 800))) == stacks


# A courtesy signature can also follow a single bar line (a Trombone part's 3/4 at the end of line
# 8, 39 px wide on a staff 64 px high). Audiveris having read a key or time signature that reaches
# the end of the line says it is no bar, and so does a region under one staff height wide; in both
# the region holds no notes or rests, Audiveris found no music in it and it follows a bar line.


def test_a_signature_audiveris_read_after_a_single_bar_line_is_not_a_measure():
    stacks = _ends_with(800, 900, 0, signed_to=885)  # 100 px: 1.25 staff heights
    trimmed = trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 800)))
    assert _bounds(trimmed) == [(100, 300), (300, 600), (600, 800)]


def test_a_courtesy_signature_with_its_bar_line_a_few_px_off_ends_at_the_page_bar_line():
    stacks = _ends_with(803, 900, 0, signed_to=885)
    trimmed = trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 800)))
    assert _bounds(trimmed)[-1] == (600, 800)


def test_a_wide_courtesy_signature_after_a_single_bar_line_is_not_a_measure():
    # a key signature of five sharps and a time signature: 3 staff heights
    stacks = _ends_with(660, 900, 0, signed_to=890)
    assert len(trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 660)))) == 3


@pytest.mark.parametrize("width, trimmed", [(319, True), (320, False)])
def test_a_signature_audiveris_read_still_needs_a_region_under_four_staff_heights(width, trimmed):
    stacks = [
        _st(100, 300, 1, 1),
        _st(300, 500, 1, 1),
        _st(500, 500 + width, 1, 0, 500 + width - 10),
    ]
    assert (len(trim_courtesy(stacks, _courtesy_probe(page_with(300, 500)))) == 2) is trimmed


def test_a_signature_in_the_middle_of_the_region_leaves_room_for_a_note_and_is_a_measure():
    # a time signature at the start of a final bar of one hollow note: it ends 60 px from the end
    stacks = _ends_with(800, 900, 0, signed_to=840)
    assert trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 800))) == stacks


def test_the_ink_of_the_signature_audiveris_read_is_not_music():
    page = page_with(300, 600, 800)
    draw_notehead(page, 840, TOP + 2 * SPACE)  # heavy digits, solid like a notehead
    stacks = _ends_with(800, 880, 0, signed_to=845)  # 80 px: not under a staff height
    assert len(trim_courtesy(stacks, _courtesy_probe(page))) == 3


def test_a_signature_audiveris_read_does_not_trim_a_region_that_holds_a_note_after_it():
    page = page_with(300, 600, 800)
    draw_notehead(page, 880, TOP + 2 * SPACE)
    stacks = _ends_with(800, 900, 0, signed_to=860)
    assert trim_courtesy(stacks, _courtesy_probe(page)) == stacks


def test_a_signature_audiveris_read_does_not_trim_a_region_it_found_music_in():
    stacks = _ends_with(800, 900, "1/4", signed_to=885)
    assert trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 800))) == stacks


def test_a_region_under_a_staff_height_after_a_single_bar_line_is_not_a_measure_either():
    # 49 px wide on a staff 80 px high: the Trombone part's 39 px on 64, and nothing read in it
    stacks = _ends_with(800, 849, 0)
    trimmed = trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 800)))
    assert _bounds(trimmed) == [(100, 300), (300, 600), (600, 800)]


@pytest.mark.parametrize("width, trimmed", [(79, True), (80, False)])
def test_under_a_staff_height_means_under_one_staff_height(width, trimmed):
    stacks = _ends_with(800, 800 + width, 0)
    probe = _courtesy_probe(page_with(300, 600, 800))
    assert (len(trim_courtesy(stacks, probe)) == 3) is trimmed


def test_a_region_under_a_staff_height_is_not_a_measure_even_when_its_digits_are_solid_ink():
    # a courtesy 6/4 is heavy: solid runs as wide as a notehead's (Impromptu I, line 4, 34 px on 73)
    page = page_with(300, 600, 800)
    draw_notehead(page, 840, TOP + 2 * SPACE)
    stacks = _ends_with(800, 849, 0)
    assert len(trim_courtesy(stacks, _courtesy_probe(page))) == 3


def test_a_region_under_a_staff_height_not_after_a_bar_line_is_a_measure():
    stacks = _ends_with(800, 849, 0)
    assert trim_courtesy(stacks, _courtesy_probe(page_with(300, 600))) == stacks


def test_two_bar_lines_30_px_apart_are_not_a_double_bar_line():
    stacks = _ends_with(800, 900, 0)
    assert trim_courtesy(stacks, _courtesy_probe(page_with(300, 600, 770, 800))) == stacks


def test_a_final_whole_note_bar_after_a_single_bar_line_is_a_measure():
    # Audiveris read nothing in it (duration 0) and the hollow note is no solid ink, but a line
    # that ends on a single bar line has no courtesy signature after its last bar
    page = page_with(300, 600, 880)
    draw_hollow_notehead(page, 740, TOP + 2 * SPACE)
    stacks = _ends_with(600, 880, 0)  # 280 px: 3.5 staff heights
    assert trim_courtesy(stacks, _courtesy_probe(page)) == stacks


def test_a_narrow_region_with_a_note_is_a_measure():
    page = _double_bar_page()
    draw_notehead(page, 860, TOP + 2 * SPACE)
    stacks = _ends_with(806, 900, 0)
    assert trim_courtesy(stacks, _courtesy_probe(page)) == stacks


def test_a_narrow_region_with_a_multi_rest_is_a_measure():
    page = _double_bar_page()
    draw_multi_rest(page, 815, 890, TOP + 2 * SPACE)
    stacks = _ends_with(806, 900, 0)
    assert trim_courtesy(stacks, _courtesy_probe(page)) == stacks


def test_a_region_audiveris_found_music_in_is_a_measure():
    stacks = _ends_with(806, 900, "1/4")
    assert trim_courtesy(stacks, _courtesy_probe(_double_bar_page())) == stacks


def test_a_region_whose_contents_audiveris_did_not_say_is_a_measure():
    stacks = _ends_with(806, 900, None)
    assert trim_courtesy(stacks, _courtesy_probe(_double_bar_page())) == stacks


def test_a_wide_region_is_a_measure_even_when_it_holds_no_notes():
    stacks = [_st(100, 300, 1, 1), _st(300, 520, 1, 1), _st(520, 900, 1, 0)]
    page = page_with(300, 515, 526)  # a double bar line before it
    assert trim_courtesy(stacks, _courtesy_probe(page)) == stacks


@pytest.mark.parametrize("width, trimmed", [(319, True), (320, False)])
def test_narrow_means_under_four_staff_heights(width, trimmed):
    stacks = _ends_with(806, 806 + width, 0)  # a staff is 80 px high
    probe = _courtesy_probe(_double_bar_page())
    assert (len(trim_courtesy(stacks, probe)) == 3) is trimmed


def test_a_narrow_stack_that_does_not_begin_at_a_bar_line_is_not_a_courtesy_region():
    stacks = _ends_with(806, 900, 0)
    assert trim_courtesy(stacks, _courtesy_probe(page_with(300, 600))) == stacks


def test_a_line_that_is_one_region_is_left_alone():
    stacks = [_st(806, 900, 1, 0)]
    assert trim_courtesy(stacks, _courtesy_probe(_double_bar_page())) == stacks


def test_the_courtesy_region_gets_no_box_and_the_line_stays_verified():
    stacks = [_st(100, 300, 1, 1), _st(300, 600, 1, 1), _st(600, 806, 1, 1), _st(806, 900, 1, 0)]
    result = _checked(stacks, 3, _double_bar_page())
    assert _xs(result) == [(100, 300), (300, 600), (600, 800)]
    assert _confidences(result) == {"verified"} and result.audit.to_dict()["verified"] == 1


def test_a_final_whole_note_bar_after_a_single_bar_line_keeps_its_box():
    page = page_with(300, 600, 880)
    draw_hollow_notehead(page, 740, TOP + 2 * SPACE)
    stacks = [_st(100, 300, 1, 1), _st(300, 600, 1, 1), _st(600, 880, 1, 0)]
    result = _checked(stacks, 3, page)
    assert _xs(result) == [(100, 300), (300, 600), (600, 880)]
    assert _confidences(result) == {"verified"}


def test_a_line_without_a_page_image_keeps_every_column():
    stacks = [_st(100, 300, 1, 1), _st(300, 600, 1, 1), _st(600, 806, 1, 1), _st(806, 900, 1, 0)]
    assert _xs(_boxes(stacks, 4))[-1] == (806, 900)


# Line 6 of a real part (bars 26-30), as measured: Audiveris missed the bar line at 975 and read
# the key signature after the final double bar as a measure of its own

LINE_6 = [
    _st(136, 703, 1, 1),
    _st(703, 1430, 1, 1),
    _st(1430, 1703, 1, 0),
    _st(1703, 2240, 1, 1),
    _st(2240, 2337, 1, 0),
]


def _line_6():
    """The page of line 6: a staff 69 px high, bar lines at 702, 975, 1429 and 1703, a double bar
    line centred on 2235 and a courtesy key signature of three signs after it."""
    page = np.zeros((2100, 2400), dtype=bool)
    top, bottom = 1890, 1959
    for k in range(5):
        y = round(top + k * (bottom - top) / 4)
        page[y - 1 : y + 2, 136:2338] = True
    for x in (702, 975, 1429, 1703, 2231, 2240):
        page[top : bottom + 1, x - 1 : x + 2] = True
    for x, y in ((2258, 1915), (2282, 1934), (2308, 1915)):
        draw_accidental(page, x, y)
    staff = OmrStaff(
        top_line=[(136.0, float(top)), (2337.0, float(top))],
        bottom_line=[(136.0, float(bottom)), (2337.0, float(bottom))],
    )
    return page, _line(LINE_6, size=(2400, 2100), staves=[staff])


def test_the_page_of_line_6_shows_the_bar_lines_the_controller_measured():
    page, line = _line_6()
    probe = LineProbe(page, [Staff.from_omr(staff) for staff in line.geometry.staves])
    assert [b.x for b in probe.scan(136, 2337)] == [702, 975, 1429, 1703, 2235]


def test_line_6_has_five_boxes_ending_at_the_final_bar_line_and_the_missed_bar_line_is_used():
    page, line = _line_6()
    result = map_boxes([line], [[1] * 5], {0: page}, {0: PageTarget(2400, 2100)})
    assert _xs(result) == [(136, 703), (703, 975), (975, 1430), (1430, 1703), (1703, 2235)]
    assert _confidences(result) == {"repaired"}
    assert "added missed bar line at x=975" in _changes(result)[0]


# ---------------------------------------------------------------- a verified bar line no box uses

FOUR = [_st(100, 300, 1, 1), _st(300, 500, 1, 1), _st(500, 700, 1, 1), _st(700, 900, 1, 1)]


def test_a_verified_bar_line_inside_a_box_keeps_the_line_from_being_verified():
    result = _checked(FOUR, 4, page_with(300, 500, 600, 700))  # 600 lies inside the third box
    assert _xs(result) == [(100, 300), (300, 500), (500, 700), (700, 900)]
    assert _confidences(result) == {"uncertain"}
    (detail,) = result.audit.to_dict()["details"]
    assert detail["confidence"] == "uncertain"
    assert "unused bar line at x=600 inside bar 3" in detail["changes"]


def test_the_pixel_bar_lines_replace_the_boundaries_when_they_make_exactly_the_count():
    # Audiveris split the double bar line at 500-515 into a sliver measure and missed the bar
    # line at 700: its three boundaries are all bar lines, the page shows three bar lines
    stacks = [_st(100, 300, 1, 1), _st(300, 500, 1, 1), _st(500, 515, 1, 0), _st(515, 900, 1, 2)]
    result = _checked(stacks, 4, page_with(300, 500, 515, 700))
    assert _xs(result) == [(100, 300), (300, 507), (507, 700), (700, 900)]
    assert _confidences(result) == {"repaired"}
    assert "bar line at x=700 lay inside bar 4" in _changes(result)[-1]


def test_a_bar_line_that_barely_passes_the_check_is_not_taken_for_an_unused_one():
    # a long stem on a rough scan: 96 % of the staff has ink, a bar line has all of it
    page = page_with(300, 500, 700)
    draw_bar(page, 600, y0=TOP + 5)
    assert LineProbe(page, [staff_at()]).check(600).ok
    assert _confidences(_checked(FOUR, 4, page)) == {"verified"}


def test_a_bar_line_within_40_px_of_a_boundary_is_not_an_unused_one():
    stacks = [_st(100, 300, 1, 1), _st(300, 500, 1, 1), _st(500, 900, 1, 1)]
    assert _confidences(_checked(stacks, 3, page_with(300, 500, 535))) == {"verified"}


def test_a_bar_line_the_fragment_rule_merged_away_is_not_an_unused_one():
    # 360 is a bar-line-high stem 60 px from the boundary at 300: the durations explained it
    stacks = [
        _st(100, 300, 1, 1),
        _st(300, 360, 1, 0),
        _st(360, 600, 1, "1/2"),
        _st(600, 900, 1, 1),
    ]
    result = _checked(stacks, 3, page_with(300, 360, 600))
    assert _xs(result) == [(100, 300), (300, 600), (600, 900)]
    assert _confidences(result) == {"repaired"}
    assert "merged" in _changes(result)[0]


def test_the_bar_of_an_unused_bar_line_counts_the_bars_of_a_multi_rest_before_it():
    result = _boxes(FOUR, 4, page=page_with(300, 500, 600, 700), spans=[1, 3, 1, 1])
    # the multi-rest holds bars 2-4, so the box that holds the bar line is bar 5
    assert "unused bar line at x=600 inside bar 5" in _changes(result)


def test_reconcile_line_numbers_default_to_one_onwards():
    fit = reconcile_line(FOUR, 4, LineProbe(page_with(300, 500, 600, 700), [staff_at()]))
    assert "unused bar line at x=600 inside bar 3" in fit.changes


# ---------------------------------------------------------------- the audit


def test_the_audit_counts_every_line_and_lists_the_ones_that_changed():
    page = page_with(300, 600)
    lines = [
        _line([_st(100, 300), _st(300, 600), _st(600, 900)]),
        _line([_st(100, 300), _st(300, 900)]),
    ]
    result = map_boxes(lines, [[1, 1, 1], [1, 1, 1]], {0: page}, LEVEL)
    summary = result.audit.to_dict()
    assert {k: summary[k] for k in ("lines", "verified", "repaired", "uncertain", "unchecked")} == {
        "lines": 2,
        "verified": 1,
        "repaired": 1,
        "uncertain": 0,
        "unchecked": 0,
    }
    assert [d["bar"] for d in summary["details"]] == [4]
    assert box_audit_text(summary) == "boxes: 1 verified, 1 repaired, 0 uncertain"


def test_the_audit_text_mentions_lines_that_were_not_checked():
    audit = {"lines": 3, "verified": 1, "repaired": 0, "uncertain": 0, "unchecked": 2}
    assert box_audit_text(audit) == "boxes: 1 verified, 0 repaired, 0 uncertain, 2 not checked"


def test_the_audit_log_has_the_headline_and_the_changes_of_each_doubtful_line():
    result = _checked([_st(100, 300), _st(300, 900)], 3, page_with(300, 600))
    assert box_audit_lines(result.audit.to_dict()) == [
        "boxes: 0 verified, 1 repaired, 0 uncertain",
        "  page 1, line from bar 1: repaired",
        "    added missed bar line at x=600 (coverage 1.00)",
    ]


def test_an_empty_audit_is_all_zeros():
    assert BoxAudit().to_dict() == {
        "lines": 0,
        "verified": 0,
        "repaired": 0,
        "uncertain": 0,
        "unchecked": 0,
        "details": [],
    }


# ---------------------------------------------------------------- the box on the stored image


def test_a_box_hugs_the_staff_with_a_margin_of_half_a_staff_space():
    assert BOX_MARGIN == 0.5
    (box,) = _boxes([_st(100, 900)], 1).boxes
    assert box == BarBox(bar=1, page_index=0, x=100, y=TOP - 10, w=800, h=80 + 20)


def test_a_box_of_a_system_with_two_staves_covers_both():
    staves = [
        OmrStaff(top_line=[(50.0, y), (950.0, y)], bottom_line=[(50.0, y + 80), (950.0, y + 80)])
        for y in (100.0, 300.0)
    ]
    (box,) = _boxes([_st(100, 900)], 1, staves=staves).boxes
    assert (box.y, box.y + box.h) == (90, 390)


def test_a_box_follows_a_tilted_staff():
    staff = OmrStaff(
        top_line=[(50.0, 100.0), (950.0, 190.0)], bottom_line=[(50.0, 180.0), (950.0, 270.0)]
    )
    (box,) = _boxes([_st(100, 900)], 1, staves=[staff]).boxes
    # at x=100 the top line is at 105 and at x=900 the bottom line is at 265: a margin of 10 each
    assert (box.y, box.y + box.h) == (95, 275)


def test_the_box_is_scaled_to_the_stored_image():
    targets = {0: PageTarget(WIDTH // 2, HEIGHT // 2)}
    (box,) = _boxes([_st(100, 900)], 1, targets=targets).boxes
    assert box == BarBox(bar=1, page_index=0, x=50, y=(TOP - 10) / 2, w=400, h=50)


def test_each_axis_is_scaled_by_its_own_factor():
    targets = {0: PageTarget(WIDTH * 2, HEIGHT)}
    (box,) = _boxes([_st(100, 900)], 1, targets=targets).boxes
    assert (box.x, box.w, box.y, box.h) == (200, 1600, TOP - 10, 100)


def test_a_box_is_kept_inside_the_image():
    (box,) = _boxes([_st(0, 900)], 1, top=2).boxes
    assert (box.x, box.y) == (0, 0)


@pytest.mark.parametrize("angle", [1.5, -2.0])
def test_a_point_lands_where_pillow_puts_it_after_the_same_rotation(angle):
    image = Image.new("L", (200, 100), 255)
    image.putpixel((150, 30), 0)
    rotated = image.rotate(angle, resample=Image.Resampling.NEAREST, expand=False, fillcolor=255)
    ys, xs = np.nonzero(np.asarray(rotated) < 128)
    target = PageTarget(200, 100, angle)
    x, y = target.to_image(150.0, 30.0, (200, 100))
    assert (round(float(xs.mean())), round(float(ys.mean()))) == pytest.approx((x, y), abs=1)


def test_the_scale_is_applied_before_the_rotation():
    # an OMR page twice the size: its point (300, 60) is the point (150, 30) of the stored image
    assert PageTarget(200, 100, 2.0).to_image(300.0, 60.0, (400, 200)) == pytest.approx(
        PageTarget(200, 100, 2.0).to_image(150.0, 30.0, (200, 100))
    )
    assert PageTarget(200, 100).to_image(300.0, 60.0, (400, 200)) == (150.0, 30.0)


def test_a_tilted_page_levelled_by_the_angle_gives_a_box_that_hugs_the_levelled_staff():
    # the scan is rotated 1 degree clockwise: the staff falls 14 px over 800 px; the stored image
    # was levelled by rotating it 1 degree counter-clockwise, so its staff is level again
    slope = np.tan(np.radians(1.0))
    staff = OmrStaff(
        top_line=[(0.0, 300.0), (1000.0, 300.0 + 1000 * slope)],
        bottom_line=[(0.0, 380.0), (1000.0, 380.0 + 1000 * slope)],
    )
    target = PageTarget(1000, 600, angle_deg=1.0)
    line = _line([_st(100, 900)], size=(1000, 600), staves=[staff])
    (box,) = map_boxes([line], [[1]], {}, {0: target}).boxes
    assert box.h == pytest.approx(80 + 20, abs=4)  # the staff band, not a band 14 px taller
    assert box.x == pytest.approx(100, abs=3) and box.w == pytest.approx(800, abs=4)


# ---------------------------------------------------------------- what map_boxes refuses


def test_the_measure_lists_must_pair_with_the_lines():
    with pytest.raises(ValueError, match="2 lines"):
        map_boxes([_line([_st(100, 900)]), _line([_st(100, 900)], top=300)], [[1]], {}, LEVEL)


def test_a_line_needs_at_least_one_measure():
    with pytest.raises(ValueError, match="at least one measure"):
        map_boxes([_line([_st(100, 900)])], [[]], {}, LEVEL)


def test_a_page_without_a_stored_image_size_is_named():
    with pytest.raises(ValueError, match="page 2"):
        map_boxes([_line([_st(100, 900)], page=1)], [[1]], {}, LEVEL)


# ---------------------------------------------------------------- the boxes after the signatures


def test_a_lines_first_box_starts_half_a_staff_space_after_its_opening_block():
    assert HEADER_GAP == 0.5
    result = _boxes([_st(200, 600), _st(600, 900)], 2, header=250, opening=["0:clef:G"])
    assert _xs(result) == [(260, 600), (600, 900)]


def test_lines_with_the_same_opening_on_a_page_start_at_one_shared_x():
    lines = [
        _line([_st(200, 600)], header=250, opening=["0:clef:G", "0:key:-1"]),
        _line([_st(205, 600)], top=300, header=255, opening=["0:clef:G", "0:key:-1"]),
        _line([_st(202, 600)], top=450, header=252, opening=["0:clef:G", "0:key:-1"]),
    ]
    result = map_boxes(lines, [[1], [1], [1]], {}, LEVEL)
    assert [b.x for b in result.boxes] == [265, 265, 265]


def test_a_line_that_also_prints_a_time_signature_starts_after_it_and_the_others_stay():
    key = ["0:clef:G", "0:key:-1"]
    lines = [
        _line([_st(200, 600)], header=250, opening=key + ["0:time:4/4"]),
        _line([_st(205, 600)], top=300, header=255, opening=key),
        _line([_st(205, 600)], top=450, header=250, opening=key),
    ]
    result = map_boxes(lines, [[1], [1], [1]], {}, LEVEL)
    assert [b.x for b in result.boxes] == [260, 265, 265]


def test_an_indented_line_shares_the_width_of_the_opening_not_its_x():
    # Los Banditos, 1st trumpet: the first line is indented (the catalogue number is printed before
    # its staff), so its clef ends far to the right; the other lines start after their own clef.
    clef = ["0:clef:G"]
    lines = [
        _line([_st(240, 600)], header=320, opening=clef, left=230.0),
        _line([_st(60, 600)], top=300, header=130, opening=clef),
        _line([_st(60, 600)], top=450, header=135, opening=clef),
    ]
    result = map_boxes(lines, [[1], [1], [1]], {}, LEVEL)
    # the widest opening is 90 px from its staff's start; each line adds it to its own start
    assert [b.x for b in result.boxes] == [330, 150, 150]


def test_a_line_whose_header_audiveris_left_empty_takes_the_usual_width_of_the_page():
    # Los Banditos, 2nd trombone: on 6 of 11 lines Audiveris gives a header that stops where it
    # starts (it missed the bass clef and key), so their first box held the clef and the key.
    key = ["0:clef:F", "0:key:-2"]
    lines = [
        _line([_st(200, 600)], header=250, opening=key + ["0:time:2/4"]),
        _line([_st(60, 600)], top=300, header=130, opening=key),
        _line([_st(60, 600)], top=450, header=50, opening=()),
        _line([_st(60, 600)], top=600, header=132, opening=key),
    ]
    result = map_boxes(lines, [[1], [1], [1], [1]], {}, LEVEL)
    # the opening of the others is 82 px wide plus the 10 px gap; the median line's width is used
    assert [round(b.x) for b in result.boxes] == [260, 142, 142, 142]


def test_an_empty_header_on_a_page_where_no_line_has_one_starts_at_the_left_edge():
    lines = [_line([_st(60, 600)], header=50, opening=()), _line([_st(60, 600)], top=300)]
    result = map_boxes(lines, [[1], [1]], {}, LEVEL)
    assert [round(b.x) for b in result.boxes] == [60, 60]


def test_a_line_with_no_header_on_its_page_starts_after_the_ink_of_its_opening():
    # Los Banditos, snare drum: Audiveris gives every line an empty header (it does not read the
    # percussion clef), so the page has no usual width; the clef's ink on the staff is used.
    page = blank_page()
    draw_staff(page)
    for x0 in (60, 72):  # the percussion clef: two thick strokes on the middle of the staff
        page[TOP + SPACE : TOP + 3 * SPACE, x0 : x0 + 7] = True
    draw_notehead(page, 130, TOP + 2 * SPACE)  # the first note, 1.3 spaces after the clef
    lines = [_line([_st(50, 600)], header=50, opening=())]
    result = map_boxes(lines, [[1]], {0: page}, LEVEL)
    assert round(result.boxes[0].x) == 79 + 10  # the clef's last column plus half a space


def test_a_line_whose_ink_shows_no_opening_stays_at_the_left_edge():
    page = blank_page()
    draw_staff(page)
    page[TOP + SPACE : TOP + 3 * SPACE, 60:400] = True  # one block with no gap after it
    lines = [_line([_st(50, 600)], header=50, opening=())]
    result = map_boxes(lines, [[1]], {0: page}, LEVEL)
    assert round(result.boxes[0].x) == 50


def test_the_same_opening_on_another_page_has_its_own_start():
    lines = [
        _line([_st(200, 600)], header=250, opening=["0:clef:G"]),
        _line([_st(200, 600)], header=270, opening=["0:clef:G"], page=1),
    ]
    targets = {0: PageTarget(WIDTH, HEIGHT), 1: PageTarget(WIDTH, HEIGHT)}
    result = map_boxes(lines, [[1], [1]], {}, targets)
    assert [b.x for b in result.boxes] == [260, 280]


def test_the_gap_is_half_the_staff_space_of_the_line():
    taller = [
        OmrStaff(
            top_line=[(50.0, 100.0), (950.0, 100.0)], bottom_line=[(50.0, 260.0), (950.0, 260.0)]
        )
    ]
    result = _boxes([_st(200, 600)], 1, staves=taller, header=250, opening=["0:clef:G"])
    assert result.boxes[0].x == 270


def test_a_line_without_a_header_keeps_the_left_edge_of_the_line():
    result = _boxes([_st(200, 600)], 1)
    assert _xs(result) == [(200, 600)]
    assert result.audit.lines[0].notes == []


def test_a_line_that_starts_with_a_signature_but_has_no_header_says_so():
    result = _boxes([_st(200, 600)], 1, blocks={0: 250})
    assert _xs(result) == [(200, 600)]
    assert result.audit.lines[0].notes == [
        "no header found: the first bar starts at the left edge of the line"
    ]
    (detail,) = result.audit.to_dict()["details"]
    assert detail["notes"] == result.audit.lines[0].notes
    assert box_audit_lines(result.audit.to_dict()) == [
        "boxes: 0 verified, 0 repaired, 0 uncertain, 1 not checked",
        "  page 1, line from bar 1: unchecked",
        "    no header found: the first bar starts at the left edge of the line",
    ]


def test_a_header_wider_than_the_first_bar_leaves_the_edge_and_says_so():
    result = _boxes([_st(200, 400), _st(400, 900)], 2, header=390, opening=["0:clef:G"])
    assert _xs(result) == [(200, 400), (400, 900)]
    assert result.audit.lines[0].notes == [
        "the opening block leaves no room in the first bar: it starts at the left edge of the line"
    ]


def test_a_bar_that_starts_with_a_signature_starts_after_it_and_leaves_a_gap():
    result = _boxes([_st(200, 600), _st(600, 900), _st(900, 1000)], 3, blocks={1: 650})
    assert _xs(result) == [(200, 600), (660, 900), (900, 1000)]


def test_the_two_staves_and_the_height_of_a_box_after_a_signature_are_unchanged():
    result = _boxes([_st(200, 600), _st(600, 900)], 2, blocks={1: 650})
    assert [(b.y, b.h) for b in result.boxes] == [(TOP - 10, 100)] * 2


def test_a_signature_block_too_wide_for_its_bar_is_ignored():
    result = _boxes([_st(200, 600), _st(600, 700)], 2, blocks={1: 690})
    assert _xs(result) == [(200, 600), (600, 700)]


def test_a_signature_is_found_on_a_line_the_page_checked():
    page = page_with(300, 600)
    stacks = [_st(100, 305), _st(305, 600), _st(600, 900)]
    result = _checked(stacks, 3, page, blocks={1: 340})
    assert _xs(result) == [(100, 305), (350, 600), (600, 900)]


def test_a_merged_column_keeps_the_signature_at_its_start():
    stacks = [
        _st(100, 300, 1, 1),
        _st(300, 400, 1, 0),
        _st(400, 500, 1, "1/4"),
        _st(500, 700, 1, 1),
    ]
    result = _boxes(stacks, 3, blocks={1: 330})
    assert _xs(result) == [(100, 300), (340, 500), (500, 700)]


def test_a_multi_rest_after_a_signature_shares_one_box():
    result = _boxes([_st(200, 400), _st(400, 800)], 2, spans=[1, 3], blocks={1: 450})
    assert _xs(result) == [(200, 400), (460, 800), (460, 800), (460, 800)]


def test_the_box_after_a_signature_follows_the_rotation_of_the_page():
    target = {0: PageTarget(WIDTH, HEIGHT, 2.0)}
    plain = _boxes([_st(200, 600), _st(600, 900)], 2, targets=target).boxes[1]
    trimmed = _boxes([_st(200, 600), _st(600, 900)], 2, targets=target, blocks={1: 650}).boxes[1]
    assert trimmed.x == pytest.approx(plain.x + 60, abs=5)  # the plain box shares its edge
    assert trimmed.x + trimmed.w == pytest.approx(plain.x + plain.w, abs=0.01)


def test_neighbouring_boxes_of_a_levelled_page_share_one_exact_edge():
    target = {0: PageTarget(WIDTH, HEIGHT, 2.0)}
    result = _boxes([_st(200, 400), _st(400, 650), _st(650, 900)], 3, targets=target)
    edges = [(b.x, b.x + b.w) for b in result.boxes]
    assert edges[0][1] == edges[1][0] and edges[1][1] == edges[2][0]


def test_a_gap_after_a_signature_stays_a_gap_on_a_levelled_page():
    target = {0: PageTarget(WIDTH, HEIGHT, 2.0)}
    result = _boxes([_st(200, 400), _st(400, 900)], 2, targets=target, blocks={1: 450})
    first, second = result.boxes
    assert second.x - (first.x + first.w) == pytest.approx(60, abs=5)
