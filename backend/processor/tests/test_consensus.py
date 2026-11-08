"""Tests for the measure count of a line by consensus: reader, Audiveris, pixels, numbers."""

from fractions import Fraction

import pytest

from app.pipeline.bar_boxes import Stack
from app.pipeline.barlines import LineProbe
from app.pipeline.consensus import (
    Choice,
    CountAudit,
    Evidence,
    StructureAudit,
    audiveris_count,
    choose_counts,
    disputed_lines,
    line_counts,
    pixel_count,
    structure_audit,
    structure_audit_lines,
    structure_audit_text,
)
from app.pipeline.omr import OmrLine, OmrMeasure, OmrStaff, OmrSystem, OmrSystemGeometry
from tests.barline_fixtures import HEIGHT, TOP, WIDTH, draw_bar, page_with, staff_at

WHOLE = Fraction(1)


def counts(evidence):
    return [c.count for c in choose_counts(evidence)]


def line(read, audiveris, pixels, printed=None, rests=0, number=1):
    return Evidence(number, 0, read, audiveris, pixels, printed, rests)


# ---------------------------------------------------------------- A: Audiveris' stacks


def stack(duration=WHOLE, expected=WHOLE, left=0):
    return Stack(left, left + 100, expected, duration)


def test_audiveris_counts_its_measure_columns():
    assert audiveris_count([stack(left=100 * k) for k in range(5)]) == 5


def test_two_fragments_side_by_side_are_one_measure():
    half = Fraction(1, 2)
    stacks = [stack(), stack(half), stack(half), stack()]  # a half note's stem cut a measure
    assert audiveris_count(stacks) == 3


def test_a_fragment_next_to_a_full_column_is_a_measure_of_its_own():
    assert audiveris_count([stack(Fraction(1, 4)), stack()]) == 2  # a pick-up bar


def test_fragments_that_still_fall_short_go_on_merging():
    third = Fraction(1, 3)
    assert audiveris_count([stack(third), stack(third), stack(third)]) == 1


def test_columns_whose_contents_are_unknown_are_counted_as_they_are():
    assert audiveris_count([Stack(0, 100), Stack(100, 200), Stack(200, 300)]) == 3


# ---------------------------------------------------------------- P: bar lines on the page


def test_the_page_count_is_the_bar_lines_it_verifies_plus_one():
    probe = LineProbe(page_with(300, 500, 700), [staff_at()])
    assert pixel_count(probe, 50, 950) == 4


def test_a_stem_is_not_a_bar_line_on_the_page():
    page = page_with(300, 700)
    draw_bar(page, 500, y0=TOP + 10, y1=TOP + 60)
    assert pixel_count(LineProbe(page, [staff_at()]), 50, 950) == 3


# ---------------------------------------------------------------- A and P of a line of the part


def omr_line(stacks):
    staff = OmrStaff(
        top_line=[(50.0, float(TOP)), (950.0, float(TOP))],
        bottom_line=[(50.0, TOP + 80.0), (950.0, TOP + 80.0)],
    )
    return OmrLine(
        page=0,
        size=(WIDTH, HEIGHT),
        system=OmrSystem(
            top=staff.top,
            bottom=staff.bottom,
            measures=[
                OmrMeasure(
                    left=s.left,
                    right=s.right,
                    expected=s.expected,
                    duration=s.duration,
                    signed_to=s.signed_to,
                )
                for s in stacks
            ],
        ),
        geometry=OmrSystemGeometry(left=50.0, right=950.0, staves=[staff]),
    )


FOUR_COLUMNS = [Stack(100, 300, WHOLE, WHOLE), Stack(300, 600, WHOLE, WHOLE),
                Stack(600, 900, WHOLE, WHOLE)]  # fmt: skip


def test_a_line_is_counted_by_audiveris_and_by_the_page():
    assert line_counts(omr_line(FOUR_COLUMNS), page_with(300, 600)) == (3, 3)


def test_the_page_can_count_a_bar_line_audiveris_missed():
    stacks = [Stack(100, 300, WHOLE, WHOLE), Stack(300, 900, WHOLE, 2 * WHOLE)]
    assert line_counts(omr_line(stacks), page_with(300, 600)) == (2, 3)


def test_the_courtesy_signature_that_ends_a_line_is_not_counted_by_either():
    stacks = [*FOUR_COLUMNS[:2], Stack(600, 806, WHOLE, WHOLE), Stack(806, 900, WHOLE, 0)]
    assert line_counts(omr_line(stacks), page_with(300, 600, 795, 806)) == (3, 3)


def test_the_courtesy_signature_after_a_single_bar_line_is_not_counted_either():
    stacks = [*FOUR_COLUMNS[:2], Stack(600, 806, WHOLE, WHOLE), Stack(806, 900, WHOLE, 0, 890)]
    assert line_counts(omr_line(stacks), page_with(300, 600, 806)) == (3, 3)


def test_without_the_page_image_only_audiveris_counts():
    assert line_counts(omr_line(FOUR_COLUMNS), None) == (3, None)


def test_a_system_audiveris_found_no_measure_in_has_no_count():
    assert line_counts(omr_line([]), page_with(300)) == (None, None)


# ---------------------------------------------------------------- choosing the count


def test_audiveris_and_the_page_agreeing_outvote_the_reading():
    (choice,) = choose_counts([line(read=6, audiveris=5, pixels=5)])
    assert choice == Choice(5, "A=P", False)


def test_all_three_agreeing_is_said_so():
    (choice,) = choose_counts([line(read=5, audiveris=5, pixels=5)])
    assert choice == Choice(5, "H=A=P", False)


def test_without_the_page_and_without_numbers_the_reading_stands():
    assert choose_counts([line(read=5, audiveris=6, pixels=None)]) == [Choice(5, "H", False)]


def test_when_audiveris_and_the_page_differ_and_no_number_decides_the_reading_stands():
    assert choose_counts([line(read=5, audiveris=6, pixels=4)]) == [Choice(5, "H", False)]
    assert choose_counts([line(read=5, audiveris=5, pixels=4)]) == [Choice(5, "H=A", False)]
    assert choose_counts([line(read=5, audiveris=4, pixels=5)]) == [Choice(5, "H=P", False)]


def test_the_page_count_wins_over_the_reading_when_the_printed_numbers_agree_with_it():
    evidence = [
        line(read=4, audiveris=4, pixels=4, number=1),
        line(read=4, audiveris=6, pixels=5, printed=5, number=2),  # the next line starts at bar 10
        line(read=5, audiveris=5, pixels=5, printed=10, number=3),
    ]
    assert choose_counts(evidence)[1] == Choice(5, "P", True)


def test_the_reading_stands_when_the_page_count_breaks_the_numbers():
    evidence = [
        line(read=4, audiveris=4, pixels=4, number=1),
        line(read=5, audiveris=6, pixels=4, printed=5, number=2),
        line(read=5, audiveris=5, pixels=5, printed=10, number=3),
    ]
    assert choose_counts(evidence)[1] == Choice(5, "H", False)


def test_a_candidate_that_satisfies_the_numbers_beats_one_that_breaks_them_whatever_it_is():
    evidence = [
        line(read=4, audiveris=4, pixels=4, number=1),
        line(read=4, audiveris=5, pixels=6, printed=5, number=2),  # only Audiveris gives 5 bars
        line(read=5, audiveris=5, pixels=5, printed=10, number=3),
    ]
    assert choose_counts(evidence)[1] == Choice(5, "A", True)


def test_when_two_candidates_satisfy_the_numbers_the_page_is_preferred_to_audiveris():
    evidence = [
        line(read=3, audiveris=5, pixels=4, number=1),
        line(read=5, audiveris=5, pixels=5, printed=5, number=2),
    ]
    assert counts(evidence) == [4, 5]  # bars 1-4 before bar 5: the page's 4, not Audiveris' 5


def test_the_numbers_settle_the_lines_between_two_of_them_together():
    evidence = [
        line(
            read=5, audiveris=4, pixels=3, number=1
        ),  # the reading's 5 is not what the numbers want
        line(read=5, audiveris=5, pixels=5, number=2),
        line(read=5, audiveris=5, pixels=5, printed=10, number=3),
    ]
    assert counts(evidence)[:2] == [4, 5]
    assert choose_counts(evidence)[0] == Choice(4, "A", True)


def test_a_multi_rest_counts_for_all_its_bars_in_the_numbers():
    evidence = [
        line(read=4, audiveris=4, pixels=4, rests=1, number=1),  # a 2-bar rest: 5 bars
        line(read=4, audiveris=4, pixels=4, printed=6, number=2),
    ]
    assert choose_counts(evidence) == [Choice(4, "H=A=P", False)] * 2


def test_numbers_that_no_candidate_can_satisfy_leave_the_defaults():
    evidence = [
        line(read=4, audiveris=5, pixels=3, number=1),
        line(read=4, audiveris=4, pixels=4, printed=20, number=2),
    ]
    assert choose_counts(evidence)[0] == Choice(4, "H", False)


def test_the_lines_after_the_last_printed_number_are_not_checked():
    evidence = [
        line(read=4, audiveris=4, pixels=4, number=1),
        line(read=5, audiveris=6, pixels=4, printed=5, number=2),
        line(read=5, audiveris=6, pixels=4, number=3),
    ]
    assert counts(evidence) == [4, 5, 5]


def test_a_line_that_prints_its_own_number_without_any_line_before_it_is_not_a_check():
    assert counts([line(read=5, audiveris=6, pixels=4, printed=1)]) == [5]


def test_a_long_run_of_lines_between_two_numbers_is_solved_at_once():
    run = [line(read=4, audiveris=5, pixels=3, number=k + 1) for k in range(60)]
    run.append(line(read=4, audiveris=4, pixels=4, printed=1 + 60 * 5, number=61))
    assert counts(run)[:60] == [5] * 60  # Audiveris' 5 everywhere is the one way to 300 bars


def test_no_evidence_at_all_is_a_single_measure():
    assert counts([line(read=0, audiveris=None, pixels=None)]) == [1]


def test_the_lines_the_reader_is_asked_again_are_those_the_choice_changed():
    evidence = [
        line(read=4, audiveris=4, pixels=4, number=1),
        line(read=6, audiveris=5, pixels=5, number=2),  # Audiveris and the page outvote it
        line(read=5, audiveris=6, pixels=4, number=3),  # nobody agrees: the reading stands
        line(read=3, audiveris=None, pixels=None, number=4),
    ]
    assert disputed_lines(evidence, choose_counts(evidence)) == [1]


def test_a_line_the_printed_numbers_moved_off_the_reading_is_disputed():
    evidence = [
        line(read=4, audiveris=4, pixels=4, number=1),
        line(read=4, audiveris=6, pixels=5, printed=5, number=2),
        line(read=5, audiveris=5, pixels=5, printed=10, number=3),
    ]
    assert disputed_lines(evidence, choose_counts(evidence)) == [1]


def test_nothing_is_disputed_when_every_choice_is_the_reading():
    evidence = [line(read=4, audiveris=4, pixels=4), line(read=5, audiveris=5, pixels=None)]
    assert disputed_lines(evidence, choose_counts(evidence)) == []


# ---------------------------------------------------------------- the audit


def audit_of(*rows):
    return StructureAudit([CountAudit(*row) for row in rows])


ROWS = (
    # line, page, first bar, bars, H, A, P, count, basis, by numbers, re-read count
    (1, 0, 1, 4, 4, 4, 4, 4, "H=A=P", False, None),
    (2, 0, 5, 5, 6, 5, 5, 5, "A=P", False, 5),
    (3, 0, 10, 5, 4, 6, 5, 5, "P", True, 6),
)


def test_the_audit_says_per_line_what_each_source_saw_and_what_was_chosen():
    assert structure_audit_lines(audit_of(*ROWS)) == [
        "structure: 3 lines, 14 bars; 2 corrected, 2 re-read",
        "  line 1 (page 1, bars 1-4): reading 4, Audiveris 4, page 4 -> 4 (H=A=P)",
        "  line 2 (page 1, bars 5-9): reading 6, Audiveris 5, page 5 -> 5 (A=P); re-read: 5",
        "  line 3 (page 1, bars 10-14): reading 4, Audiveris 6, page 5 -> 5 (P, by the printed"
        " numbers); re-read: 6",
    ]


def test_the_audit_headline_for_the_status_is_empty_when_nothing_was_corrected():
    assert structure_audit_text(None) is None
    assert structure_audit_text(audit_of(ROWS[0]).to_dict()) is None
    two = structure_audit_text(audit_of(*ROWS).to_dict())
    assert two == "structure: 2 lines corrected by the page"
    one = structure_audit_text(audit_of(ROWS[1]).to_dict())
    assert one == "structure: 1 line corrected by the page"


def test_the_audit_writes_to_json_with_the_unknowns_as_null():
    first = StructureAudit([CountAudit(1, 0, 1, 4, 4, 4, None, 4, "H=A", False, None)])
    assert first.to_dict() == {
        "lines": 1,
        "corrected": 0,
        "reread": 0,
        "details": [
            {
                "line": 1,
                "page": 0,
                "bar": 1,
                "bars": 4,
                "read": 4,
                "audiveris": 4,
                "pixels": None,
                "count": 4,
                "basis": "H=A",
                "by_numbers": False,
                "reread": None,
            }
        ],
    }


def test_the_audit_is_made_from_the_evidence_the_choices_and_the_second_looks():
    evidence = [
        line(read=4, audiveris=4, pixels=4, rests=1, number=1),  # a 2-bar rest: 5 bars
        line(read=6, audiveris=5, pixels=5, number=2),
    ]
    audit = structure_audit(evidence, choose_counts(evidence), {1: 5})
    assert [(a.line, a.bar, a.bars, a.count, a.reread) for a in audit.lines] == [
        (1, 1, 5, 4, None),
        (2, 6, 5, 5, 5),
    ]
    assert (audit.corrected, audit.reread) == (1, 1)


def test_the_bars_of_a_line_can_be_given_when_the_second_look_changed_its_rests():
    evidence = [line(read=6, audiveris=5, pixels=5, rests=0), line(read=3, audiveris=3, pixels=3)]
    audit = structure_audit(evidence, choose_counts(evidence), {0: 5}, bars=[8, 3])
    assert [(a.bar, a.bars) for a in audit.lines] == [(1, 8), (9, 3)]


def test_the_bars_given_must_pair_with_the_lines():
    evidence = [line(read=4, audiveris=4, pixels=4)]
    with pytest.raises(ValueError, match="bar counts"):
        structure_audit(evidence, choose_counts(evidence), {}, bars=[4, 4])
