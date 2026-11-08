"""structure_after: the structure of a part after Advanced Reading changed the bar count of some of
its lines (docs/plans/2026-11-07-advanced-reader-judge.md, task 3). Pure: synthetic structures."""

from app.pipeline.models import BarMark, MeterChange, PlayOrderRow
from app.pipeline.play_order import MarkKind, StructureMark, propose_play_order
from app.pipeline.read_again import LineChange
from app.pipeline.structure import PRINTED_NUMBER_WORDS, PieceStructure, number_warnings
from app.pipeline.structure_read import NO_KEY_WARNING, SHORT_BAR_NOTE, UNSURE_LINE
from app.pipeline.structure_shift import structure_after, warnings_after
from tests.structure_fixtures import line as read_line
from tests.structure_fixtures import reading

WARNINGS = ["Line 2: check it.", "No time signature is printed at bar 1."]


def meter(numerator: int, denominator: int, from_bar: int) -> MeterChange:
    return MeterChange(numerator=numerator, denominator=denominator, from_bar=from_bar)


def structure(
    bar_count: int,
    *,
    meters: list[MeterChange] | None = None,
    marks: list[StructureMark] | None = None,
    bar_marks: list[BarMark] | None = None,
    tempo: dict[int, str] | None = None,
    rests: list[int] | None = None,
    short: dict[int, int] | None = None,
    pickup: bool = False,
    pickup_sources: int = 0,
) -> PieceStructure:
    """A structure whose play order is the one propose_play_order gives its marks (with the
    pickup, bar 0, in front of the first row when `pickup`)."""
    marks = marks or []
    rows = propose_play_order(marks, bar_count).rows
    if pickup:
        rows = [PlayOrderRow(start=0, end=rows[0].end), *rows[1:]]
    return PieceStructure(
        bar_count=bar_count,
        meters=meters or [meter(4, 4, 1)],
        marks=marks,
        bar_marks=bar_marks or [],
        tempo_text=tempo or {},
        part_name="Flute",
        play_order=rows,
        warnings=list(WARNINGS),
        short_bars=({0: 1, **(short or {})} if pickup else short or {}),
        rests=rests or [],
        pickup_sources=pickup_sources,
    )


def mark(kind: MarkKind, bar: int, end: int | None = None, number: int | None = None):
    return StructureMark(kind=kind, bar=bar, bar_end=end, number=number)


def rows(structure_: PieceStructure) -> list[tuple[int, int]]:
    return [(row.start, row.end) for row in structure_.play_order]


# Three lines of four bars: 1-4, 5-8, 9-12. A change to the middle one is LineChange(5, 8, n, ...).
def middle(new_bars: int, runs: list[tuple[int, int]] | None = None) -> LineChange:
    return LineChange(old_first=5, old_last=8, new_bars=new_bars, rest_runs=runs or [])


def test_no_change_gives_the_same_structure() -> None:
    before = structure(12, rests=[2, 3])

    assert structure_after(before, []) is before


def test_a_line_that_gains_a_bar_moves_everything_after_it_up_by_one() -> None:
    before = structure(
        12,
        meters=[meter(4, 4, 1), meter(3, 4, 9)],
        marks=[
            mark(MarkKind.REPEAT_START, 1),
            mark(MarkKind.REPEAT_END, 4),
            mark(MarkKind.VOLTA, 9, 10, 1),
        ],
        bar_marks=[BarMark(bar=3, kind="fermata"), BarMark(bar=11, kind="fermata")],
        tempo={1: "Allegro", 11: "rit."},
        short={7: 2, 11: 1},
        rests=[2, 3, 10, 11],
    )

    after = structure_after(before, [middle(5)])

    assert after.bar_count == 13
    assert after.meters == [meter(4, 4, 1), meter(3, 4, 10)]
    assert [(m.kind, m.bar, m.bar_end) for m in after.marks] == [
        (MarkKind.REPEAT_START, 1, None),
        (MarkKind.REPEAT_END, 4, None),
        (MarkKind.VOLTA, 10, 11),
    ]
    assert [(m.bar, m.kind) for m in after.bar_marks] == [(3, "fermata"), (12, "fermata")]
    assert after.tempo_text == {1: "Allegro", 12: "rit."}
    assert after.short_bars == {7: 2, 12: 1}
    assert after.rests == [2, 3, 11, 12]


def test_what_sits_on_the_last_bar_of_a_line_that_gains_a_bar_stays_on_its_last_bar() -> None:
    # the line 5-8 gains a bar; a repeat sign, a fermata, a word and a meter at its end follow it,
    # while what is inside the line (bar 7) stays where it is
    before = structure(
        12,
        meters=[meter(4, 4, 1), meter(3, 4, 8)],
        marks=[mark(MarkKind.REPEAT_END, 8)],
        bar_marks=[BarMark(bar=8, kind="fermata")],
        tempo={7: "poco", 8: "rit."},
        short={8: 2},
    )

    after = structure_after(before, [middle(5)])

    assert after.meters == [meter(4, 4, 1), meter(3, 4, 9)]
    assert [(m.kind, m.bar) for m in after.marks] == [(MarkKind.REPEAT_END, 9)]
    assert [(m.bar, m.kind) for m in after.bar_marks] == [(9, "fermata")]
    assert after.tempo_text == {7: "poco", 9: "rit."}
    assert after.short_bars == {9: 2}


def test_the_play_order_is_proposed_again_from_the_shifted_marks() -> None:
    before = structure(
        12,
        marks=[mark(MarkKind.REPEAT_START, 9), mark(MarkKind.REPEAT_END, 12)],
    )
    assert rows(before) == [(1, 12), (9, 12)]

    after = structure_after(before, [middle(5)])

    assert rows(after) == [(1, 13), (10, 13)]
    assert after.play_order == propose_play_order(after.marks, 13).rows


def test_a_line_that_loses_bars_moves_what_is_after_it_down() -> None:
    before = structure(
        12,
        meters=[meter(4, 4, 1), meter(3, 4, 9)],
        marks=[mark(MarkKind.REPEAT_START, 9), mark(MarkKind.REPEAT_END, 12)],
        bar_marks=[BarMark(bar=12, kind="fermata")],
        tempo={10: "rall."},
        short={9: 2},
        rests=[11, 12],
    )

    after = structure_after(before, [middle(2)])

    assert after.bar_count == 10
    assert after.meters == [meter(4, 4, 1), meter(3, 4, 7)]
    assert [(m.kind, m.bar) for m in after.marks] == [
        (MarkKind.REPEAT_START, 7),
        (MarkKind.REPEAT_END, 10),
    ]
    assert [(m.bar, m.kind) for m in after.bar_marks] == [(10, "fermata")]
    assert after.tempo_text == {8: "rall."}
    assert after.short_bars == {7: 2}
    assert after.rests == [9, 10]
    assert rows(after) == [(1, 10), (7, 10)]


def test_what_was_on_a_bar_the_line_no_longer_has_moves_to_its_last_remaining_bar() -> None:
    # the line 5-8 keeps two bars: 5 and 6
    before = structure(
        12,
        meters=[meter(4, 4, 1), meter(3, 4, 7), meter(6, 8, 8)],
        marks=[mark(MarkKind.REPEAT_END, 8), mark(MarkKind.VOLTA, 7, 8, 2)],
        bar_marks=[BarMark(bar=7, kind="rit"), BarMark(bar=8, kind="rit")],
        tempo={5: "Allegro", 7: "poco", 8: "rit."},
        short={6: 3, 8: 2},
    )

    after = structure_after(before, [middle(2)])

    assert after.meters == [meter(4, 4, 1), meter(6, 8, 6)]  # the later of two on one bar wins
    assert [(m.kind, m.bar, m.bar_end) for m in after.marks] == [
        (MarkKind.REPEAT_END, 6, None),
        (MarkKind.VOLTA, 6, 6),
    ]
    assert [(m.bar, m.kind) for m in after.bar_marks] == [(6, "rit")]  # one mark, not two
    assert after.tempo_text == {5: "Allegro", 6: "poco / rit."}
    assert after.short_bars == {6: 3}  # a short bar on a bar that is gone is gone


def test_equal_neighbouring_meters_become_one() -> None:
    before = structure(12, meters=[meter(4, 4, 1), meter(3, 4, 7), meter(4, 4, 8)])

    after = structure_after(before, [middle(2)])

    assert after.meters == [meter(4, 4, 1)]  # 3/4 on bar 6 is shadowed by 4/4, the same as before


def test_the_rests_of_the_changed_line_are_the_new_lines_multi_rests() -> None:
    # bars 6-8 were one multi-rest; the line now holds 5 bars with a 3-bar rest as its last
    before = structure(12, rests=[2, 6, 7, 8, 11])

    after = structure_after(before, [middle(5, [(2, 3)])])

    assert after.rests == [2, 7, 8, 9, 12]  # 5, 6 | 7 8 9 | and later bars +1


def test_a_count_change_before_a_multi_rest_moves_the_rest_with_its_bars() -> None:
    before = structure(12, rests=[10, 11, 12])

    after = structure_after(before, [LineChange(1, 4, 3, [])])

    assert after.bar_count == 11 and after.rests == [9, 10, 11]


def test_a_change_that_keeps_the_number_of_bars_changes_only_the_rests() -> None:
    before = structure(12, marks=[mark(MarkKind.REPEAT_END, 8)], tempo={7: "a tempo"}, rests=[5, 6])

    after = structure_after(before, [middle(4, [(2, 2)])])

    assert after.bar_count == 12 and after.tempo_text == {7: "a tempo"}
    assert after.marks == before.marks and after.play_order == before.play_order
    assert after.rests == [7, 8]


def test_several_changed_lines_are_applied_from_the_highest_down_in_the_old_numbers() -> None:
    before = structure(
        12,
        marks=[mark(MarkKind.REPEAT_START, 9), mark(MarkKind.REPEAT_END, 12)],
        tempo={2: "a", 6: "b", 10: "c"},
        rests=[3, 7, 11],
    )
    # line 1 gains a bar and holds a 2-bar rest at its bars 3-4; line 3 loses one and holds a
    # 2-bar rest at its bars 10-11
    changes = [LineChange(1, 4, 5, [(2, 2)]), LineChange(9, 12, 3, [(1, 2)])]

    one = structure_after(before, changes)
    other = structure_after(before, list(reversed(changes)))

    assert one == other
    assert one.bar_count == 12
    assert [(m.kind, m.bar) for m in one.marks] == [
        (MarkKind.REPEAT_START, 10),
        (MarkKind.REPEAT_END, 12),
    ]
    assert one.tempo_text == {2: "a", 7: "b", 11: "c"}
    assert one.rests == [3, 4, 8, 11, 12]


def test_a_pickup_is_bar_zero_and_never_moves() -> None:
    # bar 0 is the pickup, the first line holds bars 0-3 and grows by one
    before = structure(
        8,
        marks=[mark(MarkKind.REPEAT_END, 8)],
        tempo={0: "Moderato", 5: "rit."},
        pickup=True,
        pickup_sources=2,
    )

    after = structure_after(before, [LineChange(0, 3, 5, [])])

    assert after.bar_count == 9
    assert after.short_bars == {0: 1}
    assert after.tempo_text == {0: "Moderato", 6: "rit."}
    assert rows(after) == [(0, 9), (1, 9)]  # the pickup stays in front of the first row
    assert after.pickup_sources == 2


def test_a_pickup_stays_when_a_later_line_changes() -> None:
    before = structure(8, pickup=True, tempo={0: "Moderato"})

    after = structure_after(before, [LineChange(4, 7, 3, [])])

    assert after.bar_count == 7 and after.short_bars == {0: 1}
    assert after.tempo_text == {0: "Moderato"} and rows(after) == [(0, 7)]


def test_the_warnings_the_name_and_the_pickup_sources_stay_as_they_were() -> None:
    before = structure(12, pickup=True, pickup_sources=1, rests=[6, 7])

    after = structure_after(before, [LineChange(5, 8, 5, [(1, 2)])])

    assert after.warnings == WARNINGS
    assert after.part_name == "Flute" and after.pickup_sources == 1


def test_the_bar_count_of_the_structure_agrees_with_the_last_bar_after_every_kind_of_change() -> (
    None
):
    # boxes are numbered 0 (the pickup) to bar_count; each change adds or removes whole bars
    for n in (1, 2, 4, 5, 9):
        before = structure(12, pickup=True)

        after = structure_after(before, [LineChange(5, 8, n, [])])

        assert after.bar_count == 12 + n - 4
        assert rows(after)[-1][1] == after.bar_count


# ---------------------------------------------------------------- the warnings of the first read

PRINTED = (
    "Line 17 starts with printed bar number 113, but the lines before it hold 113 bars; check it. "
    "Line 16 may have 1 bar too many."
)
UNSURE_139 = (
    "Page 2, the line from bar 139: the bar lines could not be checked against the page; "
    "check its boxes."
)


def test_the_wording_of_the_printed_number_warning_is_the_one_the_read_makes() -> None:
    [warning] = number_warnings(reading(read_line(4), read_line(4, number=9)))

    assert PRINTED_NUMBER_WORDS in warning and PRINTED_NUMBER_WORDS in PRINTED


def test_the_sentences_the_read_makes_of_a_named_bar_are_the_ones_the_shift_knows() -> None:
    assert UNSURE_LINE.format(page=2, bar=139) == UNSURE_139
    assert SHORT_BAR_NOTE.format(bar=7, units=2).startswith("Bar 7 holds ")


def test_with_no_change_every_warning_stays() -> None:
    warnings = [NO_KEY_WARNING, PRINTED, UNSURE_139]

    assert warnings_after(warnings, []) == warnings


def test_a_flutes_part_that_lost_two_bars_loses_the_number_warning_and_renames_the_bar() -> None:
    # line 16 (bars 100-112) lost a bar, and so did line 19 (bars 125-136)
    changes = [LineChange(100, 112, 12, []), LineChange(125, 136, 11, [])]

    after = warnings_after([PRINTED, UNSURE_139], changes)

    assert after == [
        "Page 2, the line from bar 137: the bar lines could not be checked against the page; "
        "check its boxes."
    ]


def test_the_printed_number_warnings_made_by_the_read_are_dropped_when_a_line_changed() -> None:
    made = number_warnings(reading(read_line(4), read_line(4, number=9)))

    assert warnings_after(made, [LineChange(1, 4, 5, [])]) == []
    assert warnings_after(made, []) == made


def test_a_bar_named_after_a_line_that_gained_bars_moves_up_and_one_before_it_stays() -> None:
    warnings = [UNSURE_LINE.format(page=1, bar=9), UNSURE_LINE.format(page=1, bar=3)]

    after = warnings_after(warnings, [LineChange(5, 8, 6, [])])

    assert after == [UNSURE_LINE.format(page=1, bar=11), UNSURE_LINE.format(page=1, bar=3)]


def test_a_bar_named_after_a_line_that_lost_bars_moves_down() -> None:
    after = warnings_after([UNSURE_LINE.format(page=1, bar=9)], [LineChange(5, 8, 2, [])])

    assert after == [UNSURE_LINE.format(page=1, bar=7)]


def test_a_short_bar_note_follows_its_bar_and_goes_with_a_bar_that_is_gone() -> None:
    notes = [SHORT_BAR_NOTE.format(bar=n, units=2) for n in (3, 6, 7, 8, 10)]

    grown = warnings_after(notes, [LineChange(5, 8, 5, [])])
    shrunk = warnings_after(notes, [LineChange(5, 8, 2, [])])

    assert grown == [SHORT_BAR_NOTE.format(bar=n, units=2) for n in (3, 6, 7, 9, 11)]
    # bars 7 and 8 are gone with the line's last two bars; bar 6 is its last remaining
    assert shrunk == [SHORT_BAR_NOTE.format(bar=n, units=2) for n in (3, 6, 8)]


def test_a_short_bar_note_agrees_with_the_short_bars_the_structure_keeps() -> None:
    changes = [LineChange(1, 4, 5, []), LineChange(9, 12, 3, [])]
    before = structure(12, short={n: 2 for n in range(1, 13)})

    kept = structure_after(before, changes).short_bars
    notes = warnings_after([SHORT_BAR_NOTE.format(bar=n, units=2) for n in range(1, 13)], changes)

    assert notes == [SHORT_BAR_NOTE.format(bar=n, units=2) for n in sorted(kept)]


def test_the_other_ways_a_warning_names_a_bar_are_renumbered_too() -> None:
    warnings = [
        'The time signature "7/4" at bar 9 was not understood and is ignored.',
        "The repeat-end signs at bars 4 and 9 have no repeat-start sign between them, "
        "so the piece is played straight through.",
        "Line 2 (bars 5-8): the page shows 4 measures but the score reading saw 3; check it.",
        "The D.S. at bar 12 has no fine or coda to go with it, so it is ignored.",
    ]

    after = warnings_after(warnings, [LineChange(5, 8, 5, [])])

    assert after == [
        'The time signature "7/4" at bar 10 was not understood and is ignored.',
        "The repeat-end signs at bars 4 and 10 have no repeat-start sign between them, "
        "so the piece is played straight through.",
        "Line 2 (bars 5-9): the page shows 4 measures but the score reading saw 3; check it.",
        "The D.S. at bar 13 has no fine or coda to go with it, so it is ignored.",
    ]


def test_a_count_of_bars_is_not_a_bar_number_and_is_left_alone() -> None:
    warnings = [
        "The lines before it hold 113 bars; check it.",
        "The repeat sign at bar 9 is outside the 12 bars of the piece",
    ]

    after = warnings_after(warnings, [LineChange(5, 8, 5, [])])

    assert after == [warnings[0], "The repeat sign at bar 10 is outside the 12 bars of the piece"]


def test_everything_else_passes_through_unchanged_and_in_order() -> None:
    warnings = [
        NO_KEY_WARNING,
        "The score reader found no music on page 2; its bars are missing.",
        PRINTED,
        "Violin: part problem with no bar named.",
        UNSURE_LINE.format(page=1, bar=9),
    ]

    after = warnings_after(warnings, [LineChange(5, 8, 5, [])])

    assert after == [
        NO_KEY_WARNING,
        "The score reader found no music on page 2; its bars are missing.",
        "Violin: part problem with no bar named.",
        UNSURE_LINE.format(page=1, bar=10),
    ]


def test_a_bar_in_a_warning_goes_where_a_mark_on_that_bar_goes() -> None:
    changes = [LineChange(1, 4, 5, [(2, 2)]), LineChange(9, 12, 3, [(1, 2)])]
    for bar in range(1, 13):
        alone = structure(12, marks=[mark(MarkKind.REPEAT_END, bar)])
        moved = structure_after(alone, changes).marks[0].bar

        [said] = warnings_after([f"The mark at bar {bar} is odd."], changes)

        assert said == f"The mark at bar {moved} is odd.", bar


def test_a_first_line_of_one_bar_that_gains_bars_keeps_what_is_on_bar_one_on_bar_one() -> None:
    before = structure(12, marks=[mark(MarkKind.REPEAT_START, 1)], tempo={1: "Allegro"})
    grown = [LineChange(1, 1, 3, [])]

    after = structure_after(before, grown)

    assert after.bar_count == 14 and after.meters == [meter(4, 4, 1)]
    assert [(m.kind, m.bar) for m in after.marks] == [(MarkKind.REPEAT_START, 1)]
    assert after.tempo_text == {1: "Allegro"}
    said = "No time signature is printed at bar 1, so 4/4 is assumed."
    assert warnings_after([said], grown) == [said]
