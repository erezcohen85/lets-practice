from fractions import Fraction

import pytest

from app.pipeline.models import BarBox, BarMark, Meter, MeterChange, PlayOrderRow
from app.pipeline.omr import OmrMeasure
from app.pipeline.pickup import (
    DEFAULT_UNITS,
    PickupVote,
    audiveris_vote,
    decide_pickup,
    number_vote,
    reader_vote,
    renumbered,
    renumbered_boxes,
    short_bars_in_the_middle,
    units_of,
)
from app.pipeline.play_order import MarkKind, StructureMark
from app.pipeline.score_reader import ReadLine
from app.pipeline.structure import PieceStructure
from tests.structure_fixtures import line, measure

SIX_EIGHT = Meter(numerator=6, denominator=8)
FOUR_FOUR = Meter(numerator=4, denominator=4)


def column(expected: str | None, duration: str | None, special: str | None = None) -> OmrMeasure:
    return OmrMeasure(
        left=0,
        right=100,
        expected=None if expected is None else Fraction(expected),
        duration=None if duration is None else Fraction(duration),
        special=special,
    )


# ---------------------------------------------------------------- the readings


def test_units_are_the_notes_of_the_denominator_in_a_duration_shorter_than_the_bar() -> None:
    assert units_of(Fraction(1, 8), SIX_EIGHT) == 1
    assert units_of(Fraction(5, 8), SIX_EIGHT) == 5
    assert units_of(Fraction(1, 4), FOUR_FOUR) == 1
    assert units_of(Fraction(3, 4), FOUR_FOUR) == 3


@pytest.mark.parametrize(
    "duration", [None, Fraction(0), Fraction(3, 4), Fraction(1), Fraction(1, 12)]
)
def test_a_duration_that_is_not_a_short_whole_number_of_notes_has_no_units(
    duration: Fraction | None,
) -> None:
    assert units_of(duration, SIX_EIGHT) is None


def test_audiveris_calls_a_stack_it_marked_pickup_a_pickup_of_the_duration_it_holds() -> None:
    vote = audiveris_vote(column("3/4", "1/8", "PICKUP"), SIX_EIGHT)

    assert (vote.says, vote.units) == ("pickup", 1)


def test_audiveris_marks_a_pickup_without_a_duration_as_a_pickup_of_unknown_length() -> None:
    vote = audiveris_vote(column("3/4", None, "PICKUP"), SIX_EIGHT)

    assert (vote.says, vote.units) == ("pickup", None)


def test_audiveris_reads_a_first_measure_that_holds_less_than_it_should_as_a_pickup() -> None:
    assert audiveris_vote(column("3/4", "1/4"), SIX_EIGHT).says == "pickup"
    assert audiveris_vote(column("3/4", "1/4"), SIX_EIGHT).units == 2


def test_audiveris_calls_a_full_first_measure_full_and_an_empty_or_unknown_one_nothing() -> None:
    assert audiveris_vote(column("3/4", "3/4"), SIX_EIGHT).says == "full"
    assert audiveris_vote(column("3/4", "9/8"), SIX_EIGHT).says == "full"
    assert audiveris_vote(column("3/4", "0"), SIX_EIGHT).says == "unknown"
    assert audiveris_vote(column(None, None), SIX_EIGHT).says == "unknown"
    assert audiveris_vote(None, SIX_EIGHT).says == "unknown"


def test_audiveris_does_not_guess_a_length_that_is_not_a_whole_number_of_notes() -> None:
    assert audiveris_vote(column("1", "1/12"), FOUR_FOUR).says == "unknown"


def test_the_reader_gives_the_length_it_counted_or_says_the_bar_is_full() -> None:
    assert reader_vote(line(4).model_copy(update={"first_measure_beats": 1})) == PickupVote(
        "reader", "pickup", 1
    )
    assert reader_vote(line(4).model_copy(update={"first_measure_beats": 0})).says == "full"
    assert reader_vote(line(4)).says == "unknown"  # an old reading did not say
    assert reader_vote(None).says == "unknown"


def numbered(*lines: ReadLine) -> list[ReadLine]:
    return list(lines)


def test_a_line_that_starts_at_the_number_counting_the_first_measure_out_says_pickup() -> None:
    # five measures on line 1; line 2 is printed 5, so the first measure is not counted
    assert number_vote(numbered(line(5), line(5, number=5))).says == "pickup"


def test_a_line_that_starts_at_the_number_counting_it_in_says_full() -> None:
    assert number_vote(numbered(line(5), line(5, number=6))).says == "full"


def test_the_printed_numbers_of_several_lines_vote_and_a_multi_rest_counts_in_full() -> None:
    lines = numbered(
        line(4),
        line(4, number=4),  # counting the first measure in this line would start at 5
        ReadLine(page=1, printed_start_number=8, measures=[measure(rests=3), measure()]),
        line(4, number=12),  # 4 + 4 + 4 bars before it: 13 counting in, 12 counting out
    )

    assert number_vote(lines).says == "pickup"


def test_most_of_the_printed_numbers_win_when_they_disagree() -> None:
    lines = numbered(line(4), line(4, number=4), line(4, number=9), line(4, number=12))

    assert number_vote(lines).says == "pickup"  # two lines count it out, one counts it in


def test_numbers_that_fit_neither_or_that_are_not_printed_say_nothing() -> None:
    assert number_vote(numbered(line(5), line(5, number=9))).says == "unknown"
    assert number_vote(numbered(line(5), line(5))).says == "unknown"
    assert number_vote(numbered(line(5))).says == "unknown"
    assert number_vote([]).says == "unknown"


# ---------------------------------------------------------------- the decision


def vote(says: str, units: int | None = None, source: str = "x") -> PickupVote:
    return PickupVote(source, says, units)  # type: ignore[arg-type]


def test_two_readings_that_agree_make_a_pickup_nobody_questions() -> None:
    found = decide_pickup([vote("pickup", 1), vote("pickup", 1), vote("unknown")])

    assert (found.units, found.sources) == (1, 2)


def test_one_reading_alone_makes_a_pickup_that_is_questioned() -> None:
    found = decide_pickup([vote("unknown"), vote("pickup", 1), vote("unknown")])

    assert (found.units, found.sources) == (1, 1)


def test_no_reading_for_a_pickup_is_no_pickup() -> None:
    assert decide_pickup([vote("full"), vote("full"), vote("unknown")]).units is None
    assert decide_pickup([]).units is None


def test_one_reading_against_two_for_a_full_bar_is_no_pickup() -> None:
    assert decide_pickup([vote("pickup", 1), vote("full"), vote("full")]).units is None


def test_one_for_and_one_against_is_still_a_pickup_that_is_questioned() -> None:
    found = decide_pickup([vote("pickup", 1), vote("full"), vote("unknown")])

    assert (found.units, found.sources) == (1, 1)


def test_the_length_is_the_first_one_given_and_a_reading_with_another_does_not_agree() -> None:
    found = decide_pickup([vote("pickup", 2), vote("pickup", 1), vote("pickup")])

    assert (found.units, found.sources) == (2, 2)  # the one for 1 does not agree; the numbers do


def test_without_any_length_the_pickup_is_one_note() -> None:
    assert decide_pickup([vote("pickup"), vote("pickup")]).units == DEFAULT_UNITS


# ---------------------------------------------------------------- short bars in the middle


def test_a_measure_holding_less_than_its_meter_is_a_short_bar_with_its_units() -> None:
    columns = [(3, column("3/4", "3/4")), (4, column("3/4", "1/4")), (5, column("3/4", "9/8"))]

    found = short_bars_in_the_middle(columns, [MeterChange(numerator=6, denominator=8, from_bar=1)])

    assert found == {4: 2}


def test_a_column_that_expects_something_other_than_the_meter_is_not_trusted() -> None:
    columns = [(2, column("1/2", "1/4"))]

    assert (
        short_bars_in_the_middle(columns, [MeterChange(numerator=6, denominator=8, from_bar=1)])
        == {}
    )


def test_a_cautionary_stack_and_an_empty_one_are_not_short_bars() -> None:
    columns = [
        (2, column("3/4", "1/4", "CAUTIONARY")),
        (3, column("3/4", "0")),
        (4, column("3/4", None)),
    ]

    assert (
        short_bars_in_the_middle(columns, [MeterChange(numerator=6, denominator=8, from_bar=1)])
        == {}
    )


def test_a_part_with_many_short_bars_is_not_trusted_at_all() -> None:
    columns = [(bar, column("3/4", "1/4")) for bar in range(2, 7)]

    assert (
        short_bars_in_the_middle(columns, [MeterChange(numerator=6, denominator=8, from_bar=1)])
        == {}
    )


def test_the_meter_in_force_at_the_bar_decides_the_units() -> None:
    meters = [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=6, denominator=8, from_bar=5),
    ]

    found = short_bars_in_the_middle([(3, column("1", "1/2")), (6, column("3/4", "1/2"))], meters)

    assert found == {3: 2, 6: 4}


# ---------------------------------------------------------------- moving the numbers


def structure(**changes: object) -> PieceStructure:
    base = PieceStructure(
        bar_count=56,
        meters=[
            MeterChange(numerator=6, denominator=8, from_bar=1),
            MeterChange(numerator=3, denominator=4, from_bar=40),
        ],
        marks=[
            StructureMark(kind=MarkKind.REPEAT_START, bar=22),
            StructureMark(kind=MarkKind.REPEAT_END, bar=43),
            StructureMark(kind=MarkKind.VOLTA, bar=42, bar_end=43, number=1),
        ],
        bar_marks=[BarMark(bar=1, kind="rit"), BarMark(bar=30, kind="fermata")],
        rests=[1, 2, 3],
        tempo_text={1: "Allegro", 30: "rit."},
        part_name="Violin",
        play_order=[PlayOrderRow(start=1, end=43), PlayOrderRow(start=22, end=56)],
        warnings=[],
    )
    return PieceStructure(**{**base.__dict__, **changes})


def test_a_pickup_moves_every_number_of_the_structure_one_down() -> None:
    moved = renumbered(structure(), -1)

    assert moved.bar_count == 55
    assert moved.play_order == [PlayOrderRow(start=0, end=42), PlayOrderRow(start=21, end=55)]
    assert moved.meters == [
        MeterChange(numerator=6, denominator=8, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=39),
    ]
    assert [(m.kind, m.bar, m.bar_end) for m in moved.marks] == [
        (MarkKind.REPEAT_START, 21, None),
        (MarkKind.REPEAT_END, 42, None),
        (MarkKind.VOLTA, 41, 42),
    ]
    assert moved.bar_marks == [BarMark(bar=0, kind="rit"), BarMark(bar=29, kind="fermata")]
    assert moved.rests == [0, 1, 2]
    assert moved.tempo_text == {0: "Allegro", 29: "rit."}


def test_removing_the_pickup_is_the_exact_reverse() -> None:
    original = structure()

    assert renumbered(renumbered(original, -1), 1) == original


def test_a_meter_that_began_on_bar_2_takes_over_when_it_becomes_bar_1() -> None:
    changes = [
        MeterChange(numerator=2, denominator=8, from_bar=1),
        MeterChange(numerator=6, denominator=8, from_bar=2),
    ]

    assert renumbered(structure(meters=changes), -1).meters == [
        MeterChange(numerator=6, denominator=8, from_bar=1)
    ]


def test_short_bars_move_with_their_bars_and_a_forgotten_pickup_leaves() -> None:
    assert renumbered(structure(short_bars={44: 3}), -1).short_bars == {43: 3}
    assert renumbered(structure(short_bars={0: 1, 44: 3}), 1).short_bars == {45: 3}


def test_boxes_move_the_same_way() -> None:
    boxes = [BarBox(bar=b, page_index=0, x=b * 10.0, y=0, w=9, h=5) for b in (1, 2, 3)]

    assert [box.bar for box in renumbered_boxes(boxes, -1)] == [0, 1, 2]
    assert [box.x for box in renumbered_boxes(boxes, -1)] == [10, 20, 30]
    assert [box.bar for box in renumbered_boxes(renumbered_boxes(boxes, -1), 1)] == [1, 2, 3]


def test_bars_move_by_one_and_no_more() -> None:
    with pytest.raises(ValueError):
        renumbered(structure(), -2)
