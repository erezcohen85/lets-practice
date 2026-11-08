from dataclasses import replace

import pytest

from app.pipeline.models import BarMark, Meter, MeterChange, PlayOrderRow, expand_play_order
from app.pipeline.play_order import MarkKind, StructureMark
from app.pipeline.score_reader import Reading, ReadLine, ReadMeasure
from app.pipeline.structure import (
    PieceStructure,
    StructureError,
    alignment_inputs,
    bars_of,
    beats_per_bar,
    fit_measures,
    merge_reading,
    number_warnings,
    short_slots,
    structure_from_reading,
    units_per_beat,
    without_repeats,
)

# Synthetic readings only: no sample files, no network. The cases are the PoC's (structure_text.py,
# consensus.py), re-expressed on the app's types.


def measure(
    *, rests=1, sig=None, fermata=False, text=(), repeat="none", volta=None, nav=None
) -> ReadMeasure:
    return ReadMeasure(
        multi_rest_bars=rests,
        time_signature=sig,
        fermata_beats=[1] if fermata else [],
        text=list(text),
        repeat=repeat,
        volta=volta,
        navigation=nav,
    )


def plain(n: int, **first) -> list[ReadMeasure]:
    """n ordinary measures; `first` are the keyword arguments of the first one."""
    return [measure(**first)] + [measure() for _ in range(n - 1)]


def reading(*lines: list[ReadMeasure], part_name: str | None = None) -> Reading:
    """A Reading with each given list of measures as one line (system) on page 1."""
    return Reading(
        part_name=part_name,
        lines=[ReadLine(page=1, printed_start_number=None, measures=line) for line in lines],
        doubts=[],
    )


def numbered(*pairs: tuple[int, int | None]) -> Reading:
    """A reading from (measure count, printed start number) per line."""
    first = reading(*[plain(n) for n, _ in pairs])
    for line, (_, printed) in zip(first.lines, pairs, strict=True):
        line.printed_start_number = printed
    return first


# ---------------------------------------------------------------- fitting measures to a count


def test_fitting_measures_by_order_cuts_or_pads_at_the_end():
    three = [measure(sig="3/4"), measure(fermata=True), measure(text=["rit."])]
    assert fit_measures(three, 3) == three
    assert fit_measures(three, 2) == three[:2]
    padded = fit_measures(three[:1], 3)
    assert padded[0] == three[0] and padded[1] == padded[2] == measure()


def test_bars_of_counts_a_multi_rest_in_full():
    assert bars_of([measure(), measure(rests=4), measure()]) == 6
    assert bars_of([]) == 0


# ---------------------------------------------------------------- merging a re-read


def test_a_line_whose_count_stands_is_kept_as_read():
    first = reading(plain(4, sig="4/4"), [measure(), measure(fermata=True)])
    final, warnings = merge_reading(first, [4, 2], {})
    assert final.lines == first.lines and warnings == []


def test_a_re_read_that_gives_the_chosen_count_brings_its_annotations():
    first = reading(plain(4, sig="4/4"), plain(4))  # the second line has 5 measures
    again = {1: ReadLine(page=1, printed_start_number=7, measures=plain(5, sig="3/4"))}
    final, warnings = merge_reading(first, [4, 5], again)
    assert final.lines[1].measures == plain(5, sig="3/4")
    assert warnings == []


def test_the_page_and_printed_number_of_a_line_come_from_the_first_reading():
    first = reading(plain(4))
    first.lines[0].page, first.lines[0].printed_start_number = 2, 9
    again = {0: ReadLine(page=1, printed_start_number=7, measures=plain(5))}
    final, _ = merge_reading(first, [5], again)
    assert (final.lines[0].page, final.lines[0].printed_start_number) == (2, 9)


def test_the_part_name_and_the_doubts_stay_those_of_the_first_reading():
    first = reading(plain(4), part_name="Oboe")
    first.doubts.append("line 1: unsure")
    final, _ = merge_reading(first, [4], {})
    assert final.part_name == "Oboe" and final.doubts == ["line 1: unsure"]


def test_merging_leaves_the_first_reading_untouched():
    first = reading(plain(3))
    merge_reading(first, [5], {})
    assert len(first.lines[0].measures) == 3


def test_a_re_read_with_another_count_is_mapped_by_order_and_warned_about():
    first = reading(plain(4), plain(4), plain(4))
    seen = [measure(fermata=True), measure(), measure(text=["rit."]), *plain(3)]
    again = {1: ReadLine(page=1, printed_start_number=None, measures=seen)}
    final, warnings = merge_reading(first, [4, 5, 4], again)
    assert final.lines[1].measures == seen[:5]
    assert warnings == [
        "Line 2 (bars 5-9): the page shows 5 measures but the score reading saw 6; check it."
    ]


def test_a_re_read_with_too_few_measures_is_padded_and_warned_about():
    first = reading(plain(3), plain(3))
    seen = [measure(fermata=True), measure()]
    again = {1: ReadLine(page=1, printed_start_number=None, measures=seen)}
    final, warnings = merge_reading(first, [3, 4], again)
    assert final.lines[1].measures == [*seen, measure(), measure()]
    assert warnings == [
        "Line 2 (bars 4-7): the page shows 4 measures but the score reading saw 2; check it."
    ]


def test_a_line_without_a_re_read_and_another_count_is_fitted_and_warned_about():
    final, warnings = merge_reading(reading(plain(4)), [3], {})
    assert len(final.lines[0].measures) == 3
    assert warnings == [
        "Line 1 (bars 1-3): the page shows 3 measures but the score reading saw 4; check it."
    ]


def test_the_bars_in_a_warning_count_a_multi_rest_in_full():
    first = reading(plain(2), plain(2))
    seen = [measure(rests=4), measure(), measure()]
    again = {1: ReadLine(page=1, printed_start_number=None, measures=seen)}
    _, warnings = merge_reading(first, [2, 2], again)
    assert warnings == [
        "Line 2 (bars 3-7): the page shows 2 measures but the score reading saw 3; check it."
    ]


# ---------------------------------------------------------------- the printed numbers


def test_printed_numbers_that_match_the_bars_before_them_give_no_warning():
    assert number_warnings(numbered((4, None), (5, 5), (6, 10))) == []


def test_a_printed_number_that_breaks_the_count_is_warned_about():
    assert number_warnings(numbered((4, None), (5, 6), (6, 11))) == [
        "Line 2 starts with printed bar number 6, but the lines before it hold 4 bars; check it. "
        "Line 1 may be 1 bar short.",
    ]


def test_the_warning_names_the_line_that_has_a_bar_too_many():
    # line 3 holds five bars where four are printed: every later line starts one number too low
    reading = numbered((4, None), (4, 5), (5, 9), (4, 13), (4, 17), (4, 21))
    assert number_warnings(reading) == [
        "Line 4 starts with printed bar number 13, but the lines before it hold 13 bars; check it. "
        "Line 3 may have 1 bar too many."
    ]


def test_without_printed_numbers_between_it_names_the_lines_the_count_went_wrong_in():
    reading = numbered((4, None), (4, None), (4, None), (5, 14), (4, 19))
    assert number_warnings(reading) == [
        "Line 4 starts with printed bar number 14, but the lines before it hold 12 bars; check it. "
        "Lines 1 to 3 together may be 1 bar short."
    ]


def test_a_count_that_breaks_again_later_is_warned_about_again():
    reading = numbered((4, None), (4, 6), (4, 12))
    assert number_warnings(reading) == [
        "Line 2 starts with printed bar number 6, but the lines before it hold 4 bars; check it. "
        "Line 1 may be 1 bar short.",
        "Line 3 starts with printed bar number 12, but the lines before it hold 8 bars; check it. "
        "Line 2 may be 2 bars short.",
    ]


def test_a_count_that_is_right_again_gives_no_warning_after_the_one_that_broke_it():
    assert len(number_warnings(numbered((4, None), (4, 6), (4, 9)))) == 1


def test_a_multi_rest_counts_for_all_its_bars_in_the_printed_numbers():
    first = reading([measure(rests=2), measure()], plain(3))  # 3 bars before line 2
    first.lines[1].printed_start_number = 4
    assert number_warnings(first) == []
    first.lines[1].printed_start_number = 3
    assert len(number_warnings(first)) == 1


# ---------------------------------------------------------------- beats per bar


@pytest.mark.parametrize(
    ("numerator", "denominator", "beats"),
    [
        (4, 4, 4),
        (3, 4, 3),
        (2, 2, 2),
        (5, 4, 5),
        (3, 8, 3),  # simple meter in eighths: the numerator
        (6, 8, 2),  # compound: the felt beat is the dotted quarter
        (9, 8, 3),
        (12, 8, 4),
        (5, 8, 5),
    ],
)
def test_beats_per_bar_is_the_numerator_except_compound_eighths(numerator, denominator, beats):
    assert beats_per_bar(Meter(numerator=numerator, denominator=denominator)) == beats


# ---------------------------------------------------------------- reading -> structure


def with_text(total: int, text: dict[int, str]) -> Reading:
    """One line of `total` plain bars with tempo words on the given bars (a 4/4 first bar)."""
    measures = plain(total, sig="4/4")
    for bar, words in text.items():
        measures[bar - 1] = measure(sig="4/4" if bar == 1 else None, text=[words])
    return reading(measures)


def test_a_reading_becomes_meters_bar_marks_tempo_text_and_order():
    piece = reading(
        plain(4, sig="4/4", text=["Joyous!"]),
        [
            measure(),
            measure(text=["rall."]),
            measure(fermata=True),
            measure(rests=2, sig="3/4", text=["A tempo"]),
        ],
        plain(2),
        part_name="Clarinet in B\u266d 1",
    )
    structure = structure_from_reading(piece)
    assert structure.bar_count == 11
    assert structure.meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=8),
    ]
    assert structure.bar_marks == [
        BarMark(bar=6, kind="rit"),
        BarMark(bar=7, kind="fermata"),
        BarMark(bar=7, kind="rit"),
    ]
    assert structure.rests == [8, 9]
    assert structure.tempo_text == {1: "Joyous!", 6: "rall.", 8: "A tempo"}
    assert structure.play_order == [PlayOrderRow(start=1, end=11)]
    assert structure.marks == []
    assert structure.part_name == "Clarinet in B\u266d 1"
    assert structure.warnings == []


def test_a_multi_rest_counts_in_full_and_its_signature_lands_on_its_first_bar():
    structure = structure_from_reading(
        reading([measure(sig="4/4"), measure(rests=4, sig="3/4"), measure(fermata=True)])
    )
    assert structure.bar_count == 6
    assert structure.meters[1] == MeterChange(numerator=3, denominator=4, from_bar=2)
    assert [m.bar for m in structure.bar_marks if m.kind == "fermata"] == [6]
    assert structure.rests == [2, 3, 4, 5]
    assert all(m.kind != "rest" for m in structure.bar_marks)


def test_several_words_on_a_measure_are_joined():
    piece = reading([measure(sig="4/4", text=["poco rit.", "dim."]), measure()])
    assert structure_from_reading(piece).tempo_text == {1: "poco rit. / dim."}


def test_a_repeated_time_signature_does_not_split_the_meter():
    piece = reading(plain(3, sig="4/4"), plain(3, sig="4/4"), plain(2, sig="6/8"))
    assert structure_from_reading(piece).meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=6, denominator=8, from_bar=7),
    ]


@pytest.mark.parametrize(("printed", "meter"), [("C", (4, 4)), ("C|", (2, 2)), (" 6 / 8 ", (6, 8))])
def test_common_and_cut_time_and_loose_spacing_are_understood(printed, meter):
    structure = structure_from_reading(reading(plain(2, sig=printed)))
    assert (structure.meters[0].numerator, structure.meters[0].denominator) == meter
    assert structure.warnings == []


def test_a_missing_first_time_signature_assumes_four_four_and_warns():
    structure = structure_from_reading(reading(plain(4)))
    assert structure.meters == [MeterChange(numerator=4, denominator=4, from_bar=1)]
    assert structure.warnings == ["No time signature is printed at bar 1, so 4/4 is assumed."]


def test_a_signature_first_printed_later_still_gets_an_assumed_first_meter():
    structure = structure_from_reading(reading(plain(2), plain(2, sig="3/4")))
    assert [(m.from_bar, m.numerator) for m in structure.meters] == [(1, 4), (3, 3)]
    assert len(structure.warnings) == 1


@pytest.mark.parametrize("printed", ["allegro", "4/3", "0/4", "4"])
def test_an_unreadable_time_signature_is_ignored_with_a_warning(printed):
    structure = structure_from_reading(reading(plain(2, sig="4/4"), plain(2, sig=printed)))
    assert len(structure.meters) == 1
    assert structure.warnings == [
        f'The time signature "{printed}" at bar 3 was not understood and is ignored.'
    ]


def test_a_reading_with_no_measures_is_refused():
    with pytest.raises(StructureError, match="no bars"):
        structure_from_reading(Reading(part_name=None, lines=[], doubts=[]))


def test_a_structure_error_is_a_value_error():
    assert issubclass(StructureError, ValueError)


# ---------------------------------------------------------------- rit. and accel. spans


def rit_bars(total: int, text: dict[int, str]) -> set[int]:
    marks = structure_from_reading(with_text(total, text)).bar_marks
    return {mark.bar for mark in marks if mark.kind == "rit"}


def test_a_rit_span_runs_up_to_the_bar_before_the_next_text_mark():
    text = {30: "rall.", 33: "A tempo", 41: "gradually slower and softer", 45: "Expressive"}
    assert rit_bars(60, text) == {30, 31, 32, 41, 42, 43, 44}


def test_a_rit_span_is_at_most_eight_bars():
    assert rit_bars(60, {10: "rit.", 30: "A tempo"}) == set(range(10, 18))


def test_a_rit_span_is_at_least_its_own_bar():
    assert rit_bars(60, {10: "rit.", 11: "A tempo"}) == {10}


def test_the_last_text_mark_can_run_to_the_end_but_not_past_it():
    assert rit_bars(10, {8: "rall."}) == {8, 9, 10}


@pytest.mark.parametrize(
    "word",
    [
        *["rall.", "poco rit.", "Ritard.", "riten.", "rallentando", "gradually slower"],
        *["accel.", "faster", "stringendo"],
    ],
)
def test_the_words_that_start_a_rit_span(word):
    assert rit_bars(20, {5: word}) == set(range(5, 13))


@pytest.mark.parametrize(
    "word", ["A tempo", "Joyous!", "Smooth", "Tempo I", "div.", "Highly Expressive", "ritmico"]
)
def test_other_text_does_not_start_a_span(word):
    assert rit_bars(20, {5: word}) == set()


def test_a_rit_span_is_one_rit_mark_per_bar_and_the_rests_are_kept_apart():
    piece = reading(
        [measure(sig="4/4"), measure(text=["rall."]), measure(rests=2), measure(text=["A tempo"])]
    )
    structure = structure_from_reading(piece)
    assert structure.bar_marks == [
        BarMark(bar=2, kind="rit"),
        BarMark(bar=3, kind="rit"),
        BarMark(bar=4, kind="rit"),
    ]
    assert structure.rests == [3, 4]


def test_adjacent_rit_marks_make_one_continuous_span():
    # "poco rit." at 84 ends where "rit." starts at 87; the union is 84-90
    text = {84: "poco rit.", 87: "rit.", 91: "Tempo I"}
    assert rit_bars(126, text) == set(range(84, 91))


# ---------------------------------------------------------------- repeats and play order


def order_of(piece: Reading) -> list[int]:
    structure = structure_from_reading(piece)
    return [slot.bar for slot in expand_play_order(structure.play_order, structure.bar_count)]


def test_repeat_signs_become_marks_and_expand_into_the_order():
    piece = reading(
        [measure(sig="4/4", repeat="start"), measure(), measure(), measure(repeat="end")],
        plain(4),
    )
    structure = structure_from_reading(piece)
    assert structure.marks == [
        StructureMark(kind=MarkKind.REPEAT_START, bar=1),
        StructureMark(kind=MarkKind.REPEAT_END, bar=4),
    ]
    assert structure.play_order == [PlayOrderRow(start=1, end=4), PlayOrderRow(start=1, end=8)]
    assert structure.warnings == []


def test_no_repeat_signs_play_straight_through():
    assert order_of(reading(plain(6, sig="4/4"))) == [1, 2, 3, 4, 5, 6]


def test_an_end_repeat_without_a_start_goes_back_to_bar_one():
    piece = reading([measure(sig="4/4"), measure(), measure(repeat="end")], plain(3))
    assert order_of(piece) == [1, 2, 3, 1, 2, 3, 4, 5, 6]


def test_a_start_sign_without_an_end_sign_changes_nothing():
    piece = reading([measure(sig="4/4"), measure(repeat="start")], plain(4))
    assert order_of(piece) == [1, 2, 3, 4, 5, 6]


def test_two_repeated_sections_each_play_twice():
    piece = reading(
        [measure(sig="4/4", repeat="start"), *plain(2), measure(repeat="end")],
        [*plain(2), measure(repeat="start"), *plain(2), measure(repeat="end")],
        plain(2),
    )
    assert order_of(piece) == [
        *[1, 2, 3, 4, 1, 2, 3, 4, 5, 6],
        *[7, 8, 9, 10, 7, 8, 9, 10, 11, 12],
    ]


def test_a_both_sign_closes_the_section_before_it_and_opens_the_next():
    # |: 1 2 :||: 3 4 :|   (the model marks bar 3 "both" and bar 4 "end")
    piece = reading(
        [measure(sig="4/4", repeat="start"), measure(), measure(repeat="both"), measure()],
        [measure(repeat="end")],
    )
    structure = structure_from_reading(piece)
    assert {(m.kind, m.bar) for m in structure.marks} == {
        (MarkKind.REPEAT_START, 1),
        (MarkKind.REPEAT_END, 2),
        (MarkKind.REPEAT_START, 3),
        (MarkKind.REPEAT_END, 5),
    }
    assert order_of(piece) == [1, 2, 1, 2, 3, 4, 5, 3, 4, 5]


def test_a_both_sign_after_an_end_sign_does_not_double_the_end():
    piece = reading(
        [measure(sig="4/4", repeat="start"), measure(repeat="end")],
        [measure(repeat="both")],
        plain(2),
    )
    ends = [m.bar for m in structure_from_reading(piece).marks if m.kind is MarkKind.REPEAT_END]
    assert ends == [2]


def test_multi_rest_repeat_signs_land_on_the_bars_the_signs_touch():
    start = structure_from_reading(
        reading([measure(rests=2, repeat="start", sig="4/4"), measure()])
    )
    assert [(m.kind, m.bar) for m in start.marks] == [(MarkKind.REPEAT_START, 1)]
    end = structure_from_reading(reading([measure(rests=3, repeat="end", sig="4/4"), measure()]))
    assert [(m.kind, m.bar) for m in end.marks] == [(MarkKind.REPEAT_END, 3)]


def test_first_and_second_endings_are_expanded():
    # |: 1 2 3 | 1. 4 5 :| 2. 6 7 | 8 9 10
    piece = reading(
        [measure(sig="4/4", repeat="start"), *plain(2)],
        [measure(volta=1), measure(volta=1, repeat="end"), measure(volta=2), measure(volta=2)],
        plain(3),
    )
    structure = structure_from_reading(piece)
    assert [(m.bar, m.bar_end, m.number) for m in structure.marks if m.kind is MarkKind.VOLTA] == [
        (4, 5, 1),
        (6, 7, 2),
    ]
    assert order_of(piece) == [1, 2, 3, 4, 5, 1, 2, 3, 6, 7, 8, 9, 10]
    assert structure.warnings == []


def test_a_one_bar_first_ending():
    piece = reading(
        [measure(sig="4/4", repeat="start"), *plain(2), measure(volta=1, repeat="end")],
        [measure(volta=2), *plain(3)],
    )
    assert order_of(piece) == [1, 2, 3, 4, 1, 2, 3, 5, 6, 7, 8]


def test_a_multi_rest_in_an_ending_spans_all_its_bars():
    piece = reading(
        [measure(sig="4/4", repeat="start"), measure()],
        [measure(rests=2, volta=1, repeat="end"), measure(volta=2), measure()],
    )
    marks = structure_from_reading(piece).marks
    assert (StructureMark(kind=MarkKind.VOLTA, bar=3, bar_end=4, number=1)) in marks
    assert order_of(piece) == [1, 2, 3, 4, 1, 2, 5, 6]


def test_a_first_ending_without_a_repeat_sign_warns_and_is_played_through():
    piece = reading([measure(sig="4/4"), measure(), measure(volta=1), measure(volta=2)], plain(2))
    structure = structure_from_reading(piece)
    assert order_of(piece) == [1, 2, 3, 4, 5, 6]
    assert len(structure.warnings) == 1
    assert "1st ending" in structure.warnings[0] and "bar 3" in structure.warnings[0]


def test_a_third_ending_is_played_straight_through_with_a_warning():
    piece = reading(
        [measure(sig="4/4", repeat="start"), measure(volta=1, repeat="end"), measure(volta=2)],
        [measure(volta=3), measure()],
    )
    structure = structure_from_reading(piece)
    assert order_of(piece) == [1, 2, 3, 4, 5]
    assert len(structure.warnings) == 1 and "numbered" in structure.warnings[0]


def test_nested_repeats_are_played_straight_through_with_a_warning():
    # |: 1 2 |: 3 4 :| 5 6 :|
    piece = reading(
        [
            measure(sig="4/4", repeat="start"),
            measure(),
            measure(repeat="start"),
            measure(repeat="end"),
        ],
        [measure(), measure(repeat="end"), measure(), measure()],
    )
    structure = structure_from_reading(piece)
    assert order_of(piece) == [1, 2, 3, 4, 5, 6, 7, 8]
    assert len(structure.warnings) == 1 and "straight through" in structure.warnings[0]


# ---------------------------------------------------------------- navigation


def navigation_piece(*signs: tuple[int, str]) -> Reading:
    """Eight bars in 4/4 with a navigation sign on each given bar."""
    measures = plain(8, sig="4/4")
    for bar, text in signs:
        measures[bar - 1] = measure(sig="4/4" if bar == 1 else None, nav=text)
    return reading(measures)


def test_d_s_al_coda_without_a_segno_warns_and_plays_straight_through():
    piece = navigation_piece((6, "D.S. al Coda"))
    structure = structure_from_reading(piece)
    assert structure.marks == [StructureMark(kind=MarkKind.DS_AL_CODA, bar=6)]
    assert order_of(piece) == list(range(1, 9))
    assert len(structure.warnings) == 1
    assert "D.S. al coda at bar 6" in structure.warnings[0]


def test_segno_to_coda_d_s_al_coda_and_coda_expand_into_the_order():
    piece = navigation_piece((1, "Segno"), (4, "To Coda"), (6, "D.S. al Coda"), (7, "Coda"))
    structure = structure_from_reading(piece)
    assert {(m.kind, m.bar) for m in structure.marks} == {
        (MarkKind.SEGNO, 1),
        (MarkKind.TO_CODA, 4),
        (MarkKind.DS_AL_CODA, 6),
        (MarkKind.CODA, 7),
    }
    assert order_of(piece) == [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 7, 8]
    assert structure.warnings == []


def test_d_c_al_fine_stops_at_the_fine():
    piece = navigation_piece((3, "Fine"), (6, "D.C. al Fine"))
    assert order_of(piece) == [1, 2, 3, 4, 5, 6, 1, 2, 3]


def test_a_plain_d_c_means_al_fine_when_the_piece_has_a_fine():
    piece = navigation_piece((3, "Fine"), (6, "D.C."))
    structure = structure_from_reading(piece)
    assert StructureMark(kind=MarkKind.DC_AL_FINE, bar=6) in structure.marks
    assert order_of(piece) == [1, 2, 3, 4, 5, 6, 1, 2, 3]


def test_a_plain_d_s_means_al_coda_when_the_piece_has_a_coda_and_no_fine():
    piece = navigation_piece((1, "Segno"), (4, "To Coda"), (6, "D.S."), (7, "Coda"))
    assert StructureMark(kind=MarkKind.DS_AL_CODA, bar=6) in structure_from_reading(piece).marks


def test_a_plain_jump_with_nowhere_to_stop_is_ignored_with_a_warning():
    piece = navigation_piece((6, "D.C."))
    structure = structure_from_reading(piece)
    assert structure.marks == []
    assert structure.warnings == [
        "The D.C. at bar 6 has no fine or coda to go with it, so it is ignored."
    ]


def test_a_sign_that_is_not_understood_is_ignored_with_a_warning():
    structure = structure_from_reading(navigation_piece((3, "attacca")))
    assert structure.marks == []
    assert structure.warnings == ['The mark "attacca" at bar 3 was not understood and is ignored.']


def test_jumps_and_stops_sit_on_the_last_bar_of_a_multi_rest_measure():
    piece = reading(
        [measure(sig="4/4"), measure(rests=2, nav="Fine"), measure(), measure(nav="D.C. al Fine")]
    )
    marks = {m.kind: m.bar for m in structure_from_reading(piece).marks}
    assert marks == {MarkKind.FINE: 3, MarkKind.DC_AL_FINE: 5}


# ---------------------------------------------------------------- the alignment's inputs


def structure_of(piece: Reading) -> PieceStructure:
    return structure_from_reading(piece)


def test_alignment_inputs_follow_the_slots_of_the_play_order():
    piece = reading(
        [
            measure(sig="4/4", repeat="start"),
            measure(),
            measure(fermata=True),
            measure(repeat="end"),
        ],
        [measure(sig="3/4", text=["rit."]), measure(), measure()],
    )
    structure = structure_of(piece)
    rows = structure.play_order  # 1-4, 1-7: bars 1 2 3 4 1 2 3 4 5 6 7
    notated, soft, rit = alignment_inputs(structure, rows)
    assert notated == [4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3]
    assert soft == {2, 6, 10}  # bar 3 twice (slots 2 and 6) and the last slot
    assert rit == {8, 9, 10}  # the rit. span runs to the end of the piece


def test_alignment_inputs_read_the_rit_slots_from_the_bar_marks():
    structure = structure_of(reading(plain(6, sig="4/4")))
    marked = replace(structure, bar_marks=[BarMark(bar=3, kind="rit"), BarMark(bar=4, kind="rit")])
    _, _, rit = alignment_inputs(marked, marked.play_order)
    assert rit == {2, 3}


def test_alignment_inputs_use_the_rows_given_not_the_proposed_order():
    structure = structure_of(reading(plain(4, sig="4/4")))
    notated, soft, rit = alignment_inputs(structure, [PlayOrderRow(start=2, end=3)])
    assert notated == [4, 4] and soft == {1} and rit == set()


def test_compound_meters_give_felt_beats_per_slot():
    structure = structure_of(reading(plain(2, sig="4/4"), plain(2, sig="6/8")))
    notated, _, _ = alignment_inputs(structure, structure.play_order)
    assert notated == [4, 4, 2, 2]


def test_a_fermata_on_the_last_bar_does_not_duplicate_it():
    structure = structure_of(reading([*plain(3, sig="4/4"), measure(fermata=True)]))
    _, soft, _ = alignment_inputs(structure, structure.play_order)
    assert soft == {3}


def test_a_multi_rest_bar_is_notated_like_any_bar_of_its_meter():
    structure = structure_of(reading([measure(sig="3/4"), measure(rests=3)]))
    notated, _, _ = alignment_inputs(structure, structure.play_order)
    assert notated == [3, 3, 3, 3]


# ---------------------------------------------------------------- short bars


def with_pickup(structure: PieceStructure, units: int) -> PieceStructure:
    """The structure with a bar 0 of `units` notes before bar 1 and the rows starting at 0."""
    rows = [PlayOrderRow(start=0, end=structure.bar_count)]
    return replace(structure, short_bars={0: units}, play_order=rows)


def test_a_pickup_of_one_eighth_in_6_8_is_a_third_of_a_felt_beat():
    structure = with_pickup(structure_of(reading(plain(3, sig="6/8"))), 1)
    notated, _, _ = alignment_inputs(structure, structure.play_order)
    assert notated == pytest.approx([1 / 3, 2, 2, 2])
    assert short_slots(structure, structure.play_order) == {0}


def test_a_pickup_of_one_quarter_in_4_4_is_one_beat():
    structure = with_pickup(structure_of(reading(plain(3, sig="4/4"))), 1)
    notated, _, _ = alignment_inputs(structure, structure.play_order)
    assert notated == [1, 4, 4, 4]


def test_a_short_bar_in_the_middle_holds_its_units_in_the_meter_in_force_there():
    structure = structure_of(reading(plain(2, sig="4/4"), plain(3, sig="6/8")))
    structure = replace(structure, short_bars={2: 3, 4: 2})  # 3 quarters of 4/4, 2 eighths of 6/8
    notated, _, _ = alignment_inputs(structure, structure.play_order)
    assert notated == pytest.approx([4, 3, 2, 2 / 3, 2])
    assert short_slots(structure, structure.play_order) == {1, 3}


def test_the_short_slots_follow_the_rows_given():
    structure = structure_of(reading(plain(4, sig="4/4")))
    structure = replace(structure, short_bars={3: 2})
    rows = [PlayOrderRow(start=3, end=4), PlayOrderRow(start=3, end=3)]
    assert short_slots(structure, rows) == {0, 2}


def test_units_per_beat_is_three_in_compound_time_only():
    assert units_per_beat(Meter(numerator=6, denominator=8)) == 3
    assert units_per_beat(Meter(numerator=9, denominator=8)) == 3
    assert units_per_beat(Meter(numerator=3, denominator=8)) == 1
    assert units_per_beat(Meter(numerator=4, denominator=4)) == 1


def test_without_repeats_a_pickup_stays_in_front() -> None:
    structure = PieceStructure(
        bar_count=55,
        meters=[MeterChange(numerator=6, denominator=8, from_bar=1)],
        marks=[
            StructureMark(kind=MarkKind.REPEAT_START, bar=21),
            StructureMark(kind=MarkKind.REPEAT_END, bar=42),
        ],
        bar_marks=[],
        tempo_text={},
        part_name=None,
        play_order=[PlayOrderRow(start=0, end=42), PlayOrderRow(start=21, end=55)],
        warnings=[],
        short_bars={0: 1},
    )

    assert without_repeats(structure).play_order == [PlayOrderRow(start=0, end=55)]
