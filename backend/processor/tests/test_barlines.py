"""Tests for the bar-line check against the page image. A synthetic page: no sample files."""

import numpy as np

from app.pipeline.barlines import BarLine, LineProbe, Staff
from app.pipeline.omr import OmrStaff
from tests.barline_fixtures import (
    SPACE,
    TOP,
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


def probe_for(page, staves=None):
    return LineProbe(page, staves or [staff_at()])


# ---------------------------------------------------------------- the staff


def test_a_staff_is_made_from_the_lines_audiveris_found():
    staff = Staff.from_omr(
        OmrStaff(top_line=[(0.0, 10.0), (100.0, 20.0)], bottom_line=[(0.0, 90.0), (100.0, 100.0)])
    )
    assert staff.top.tolist() == [[0.0, 10.0], [100.0, 20.0]]
    assert staff.bottom.tolist() == [[0.0, 90.0], [100.0, 100.0]]


def test_the_rows_of_the_outer_lines_follow_a_tilted_staff():
    staff = Staff(np.array([[0.0, 10.0], [100.0, 20.0]]), np.array([[0.0, 90.0], [100.0, 100.0]]))
    assert staff.edges(50.0) == (15.0, 95.0)
    assert staff.rows(50.0) == (15, 95)
    assert staff.edges(500.0) == (20.0, 100.0)  # past the last point the line stays level


# ---------------------------------------------------------------- coverage


def test_a_bar_line_covers_every_row_between_the_outer_staff_lines():
    assert probe_for(page_with(300)).coverage(300) == 1.0


def test_a_plain_column_only_covers_the_rows_of_the_staff_lines():
    coverage = probe_for(page_with(300)).coverage(500)
    assert 0.15 < coverage < 0.25  # 5 lines of 3 rows in 81 rows


def test_coverage_counts_ink_within_two_columns_of_x():
    probe = probe_for(page_with(300))
    assert probe.coverage(302) == 1.0 and probe.coverage(298) == 1.0
    assert probe.coverage(304) < 0.3


def test_coverage_follows_a_tilted_staff():
    page = blank_page()
    top = np.array([[50.0, 100.0], [950.0, 190.0]])
    bottom = np.array([[50.0, 180.0], [950.0, 270.0]])
    # a bar line at x=500 sits where the staff is 45 px lower than at the left edge
    page[145:226, 499:502] = True
    assert LineProbe(page, [Staff(top, bottom)]).coverage(500) == 1.0


def test_coverage_is_the_lowest_of_the_systems_staves():
    page = blank_page()
    draw_staff(page, 100)
    draw_staff(page, 300)
    draw_bar(page, 400, top=100)  # the bar line stops at the first staff
    probe = LineProbe(page, [staff_at(100), staff_at(300)])
    assert probe.coverage(400) < 0.3
    draw_bar(page, 400, top=300)
    assert LineProbe(page, [staff_at(100), staff_at(300)]).coverage(400) == 1.0


# ---------------------------------------------------------------- what counts as a bar line


def test_a_bar_line_is_verified():
    check = probe_for(page_with(300)).check(300)
    assert check.ok and check.reason is None


def test_a_stem_that_stops_short_of_the_staff_is_not_a_bar_line():
    page = page_with()
    draw_bar(page, 300, y0=TOP + 10, y1=TOP + 80)  # 3.5 spaces
    check = probe_for(page).check(300)
    assert not check.ok and "coverage" in check.reason


def test_a_stem_that_carries_on_past_the_staff_is_not_a_bar_line():
    page = page_with()
    draw_bar(page, 300, y0=TOP - 30, y1=TOP + 80)
    assert not probe_for(page).check(300).ok
    below = page_with()
    draw_bar(below, 400, y0=TOP, y1=TOP + 4 * SPACE + 25)
    assert not probe_for(below).check(400).ok


def test_a_stem_with_a_notehead_against_it_is_not_a_bar_line():
    page = page_with()
    draw_bar(page, 300)  # exactly staff high, so only the notehead tells it from a bar line
    draw_notehead(page, 300, TOP + 3 * SPACE)
    check = probe_for(page).check(300)
    assert not check.ok and "notehead" in check.reason


def test_a_multi_rest_stroke_one_space_high_is_not_a_bar_line():
    page = page_with()
    draw_bar(page, 300, y0=TOP + SPACE + 10, y1=TOP + 3 * SPACE - 10)
    assert not probe_for(page).check(300).ok


def test_a_bar_line_is_verified_when_it_is_a_little_off_x():
    probe = probe_for(page_with(300))
    assert probe.check(302).ok and probe.check(298).ok
    assert not probe.check(306).ok


def test_check_near_snaps_to_the_bar_line_within_three_columns():
    probe = probe_for(page_with(300))
    assert probe.check_near(303).ok
    assert not probe.check_near(310).ok


def test_a_bar_line_missing_on_one_staff_of_the_system_is_not_verified():
    page = blank_page()
    draw_staff(page, 100)
    draw_staff(page, 300)
    draw_bar(page, 400, top=100)
    assert not LineProbe(page, [staff_at(100), staff_at(300)]).check(400).ok


# ---------------------------------------------------------------- the scan


def scan(page, left=100, right=900):
    return probe_for(page).scan(left, right)


def test_the_scan_finds_every_bar_line_between_the_edges():
    found = scan(page_with(300, 500, 700))
    assert [b.x for b in found] == [300, 500, 700]
    assert all(isinstance(b, BarLine) and b.coverage == 1.0 for b in found)


def test_a_double_bar_line_is_one_bar_line_at_its_centre():
    found = scan(page_with(500, 510))
    assert [b.x for b in found] == [505]


def test_a_repeat_bar_line_is_one_bar_line():
    page = page_with(500, 512, 521)  # three strokes within 25 px of each other
    assert [b.x for b in scan(page)] == [510]


def test_bar_lines_25_px_apart_are_two_lines():
    assert [b.x for b in scan(page_with(500, 530))] == [500, 530]


def test_a_bar_line_says_how_many_strokes_make_it():
    assert [b.strokes for b in scan(page_with(300))] == [1]
    assert [b.strokes for b in scan(page_with(500, 510))] == [2]  # a double bar line
    assert [b.strokes for b in scan(page_with(500, 512, 521))] == [3]  # a repeat bar line
    assert [b.strokes for b in scan(page_with(300, 500, 510))] == [1, 2]


def test_a_thick_bar_line_is_one_stroke():
    page = page_with()
    draw_bar(page, 500, width=9)
    assert [b.strokes for b in scan(page)] == [1]


def test_the_scan_leaves_out_the_edges_of_the_line():
    page = page_with(110, 500, 890, 898)
    assert [b.x for b in scan(page, left=100, right=900)] == [500]


def test_the_scan_skips_stems_and_staff_lines():
    page = page_with(300)
    draw_bar(page, 500, y0=TOP + 10, y1=TOP + 80)
    assert [b.x for b in scan(page)] == [300]


# ---------------------------------------------------------------- solid ink (notes, rests)


def test_the_height_of_a_staff_is_the_distance_between_its_outer_lines():
    assert probe_for(page_with()).staff_height(300) == 4 * SPACE


def test_a_notehead_is_solid_ink_wider_than_an_accidental():
    page = page_with()
    draw_notehead(page, 520, TOP + 2 * SPACE)  # 25 px wide: 1.25 spaces
    probe = probe_for(page)
    assert probe.solid_between(480, 560)
    assert not probe.solid_between(100, 400)


def test_an_accidental_is_not_solid_ink_even_though_the_bar_line_check_calls_it_heavy():
    page = page_with()
    draw_accidental(page, 500, TOP + 2 * SPACE)  # 16 px wide: 0.8 spaces
    probe = probe_for(page)
    assert probe._notehead_beside(508)  # a 12 px run is enough to keep a bar line from being one
    assert not probe.solid_between(480, 560)


def test_a_multi_rest_is_solid_ink():
    page = page_with()
    draw_multi_rest(page, 400, 600, TOP + 2 * SPACE)
    assert probe_for(page).solid_between(380, 620)


def test_a_whole_note_is_hollow_and_is_not_solid_ink():
    page = page_with()
    draw_hollow_notehead(page, 520, TOP + 2 * SPACE)
    assert page[TOP + 2 * SPACE, 520 - 13 : 520 + 14].any()  # it is there
    assert not probe_for(page).solid_between(480, 560)


def test_solid_ink_is_looked_for_between_the_two_columns_only():
    page = page_with()
    draw_notehead(page, 520, TOP + 2 * SPACE)
    probe = probe_for(page)
    assert not probe.solid_between(100, 480) and not probe.solid_between(560, 900)


def test_solid_ink_is_looked_for_up_to_the_edge_of_the_page():
    page = page_with()
    draw_notehead(page, 990, TOP + 2 * SPACE)  # the page is 1000 px wide
    assert probe_for(page).solid_between(960, 1200)
