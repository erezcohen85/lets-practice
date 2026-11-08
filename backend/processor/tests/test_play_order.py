import pytest

from app.pipeline import play_order
from app.pipeline.models import PlayOrderRow, expand_play_order
from app.pipeline.play_order import (
    MarkKind,
    PlayOrderProposal,
    StructureMark,
    order_without_repeats,
    propose_play_order,
)


def mark(
    kind: MarkKind, bar: int, bar_end: int | None = None, number: int | None = None
) -> StructureMark:
    return StructureMark(kind=kind, bar=bar, bar_end=bar_end, number=number)


def volta(number: int, bar: int, bar_end: int | None = None) -> StructureMark:
    return mark(MarkKind.VOLTA, bar, bar_end=bar_end, number=number)


def rows_of(proposal: PlayOrderProposal) -> list[tuple[int, int]]:
    return [(row.start, row.end) for row in proposal.rows]


def played(proposal: PlayOrderProposal, bar_count: int) -> list[int]:
    return [slot.bar for slot in expand_play_order(proposal.rows, bar_count)]


def bars(*spans: tuple[int, int]) -> list[int]:
    return [bar for start, end in spans for bar in range(start, end + 1)]


def test_plain_piece_plays_straight_through() -> None:
    proposal = propose_play_order([], 16)
    assert rows_of(proposal) == [(1, 16)]
    assert proposal.warnings == []


def test_simple_repeat_goes_back_to_the_repeat_start_once() -> None:
    marks = [mark(MarkKind.REPEAT_START, 5), mark(MarkKind.REPEAT_END, 8)]
    proposal = propose_play_order(marks, 12)
    assert rows_of(proposal) == [(1, 8), (5, 12)]
    assert played(proposal, 12) == bars((1, 8), (5, 12))
    assert proposal.warnings == []


def test_repeat_without_a_start_sign_goes_back_to_bar_one() -> None:
    proposal = propose_play_order([mark(MarkKind.REPEAT_END, 4)], 12)
    assert played(proposal, 12) == bars((1, 4), (1, 4), (5, 12))
    assert rows_of(proposal) == [(1, 4), (1, 12)]
    assert proposal.warnings == []


def test_first_and_second_volta_play_on_their_own_pass() -> None:
    marks = [
        mark(MarkKind.REPEAT_START, 1),
        volta(1, 8),
        mark(MarkKind.REPEAT_END, 8),
        volta(2, 9),
    ]
    proposal = propose_play_order(marks, 12)
    assert played(proposal, 12) == bars((1, 8), (1, 7), (9, 12))
    assert rows_of(proposal) == [(1, 8), (1, 7), (9, 12)]
    assert proposal.warnings == []


def test_multi_bar_voltas_skip_every_bar_of_the_other_ending() -> None:
    marks = [
        mark(MarkKind.REPEAT_START, 1),
        volta(1, 7, bar_end=8),
        mark(MarkKind.REPEAT_END, 8),
        volta(2, 9, bar_end=10),
    ]
    proposal = propose_play_order(marks, 12)
    assert played(proposal, 12) == bars((1, 8), (1, 6), (9, 12))
    assert proposal.warnings == []


def test_voltas_in_two_separate_repeated_sections_each_start_at_pass_one() -> None:
    marks = [
        mark(MarkKind.REPEAT_START, 1),
        volta(1, 4),
        mark(MarkKind.REPEAT_END, 4),
        volta(2, 5),
        mark(MarkKind.REPEAT_START, 6),
        volta(1, 9),
        mark(MarkKind.REPEAT_END, 9),
        volta(2, 10),
    ]
    proposal = propose_play_order(marks, 12)
    assert played(proposal, 12) == bars((1, 4), (1, 3), (5, 9), (6, 8), (10, 12))
    assert proposal.warnings == []


def test_ds_al_coda_repeats_from_the_segno_then_jumps_to_the_coda() -> None:
    marks = [
        mark(MarkKind.SEGNO, 5),
        mark(MarkKind.TO_CODA, 8),
        mark(MarkKind.DS_AL_CODA, 12),
        mark(MarkKind.CODA, 13),
    ]
    proposal = propose_play_order(marks, 16)
    assert rows_of(proposal) == [(1, 12), (5, 8), (13, 16)]
    assert played(proposal, 16) == bars((1, 12), (5, 8), (13, 16))
    assert proposal.warnings == []


def test_dc_al_fine_goes_back_to_bar_one_and_stops_at_the_fine() -> None:
    marks = [mark(MarkKind.FINE, 4), mark(MarkKind.DC_AL_FINE, 8)]
    proposal = propose_play_order(marks, 8)
    assert rows_of(proposal) == [(1, 8), (1, 4)]
    assert played(proposal, 8) == bars((1, 8), (1, 4))
    assert proposal.warnings == []


def test_dc_al_coda_goes_back_to_bar_one_then_jumps_to_the_coda() -> None:
    marks = [
        mark(MarkKind.TO_CODA, 4),
        mark(MarkKind.DC_AL_CODA, 8),
        mark(MarkKind.CODA, 9),
    ]
    proposal = propose_play_order(marks, 12)
    assert rows_of(proposal) == [(1, 8), (1, 4), (9, 12)]
    assert proposal.warnings == []


def test_ds_al_fine_repeats_from_the_segno_and_stops_at_the_fine() -> None:
    marks = [
        mark(MarkKind.SEGNO, 3),
        mark(MarkKind.FINE, 6),
        mark(MarkKind.DS_AL_FINE, 10),
    ]
    proposal = propose_play_order(marks, 10)
    assert played(proposal, 10) == bars((1, 10), (3, 6))
    assert proposal.warnings == []


def test_the_fine_and_to_coda_signs_are_ignored_on_the_first_pass() -> None:
    marks = [
        mark(MarkKind.FINE, 4),
        mark(MarkKind.TO_CODA, 4),
        mark(MarkKind.DC_AL_FINE, 8),
    ]
    proposal = propose_play_order(marks, 8)
    assert played(proposal, 8) == bars((1, 8), (1, 4))


def test_a_repeat_inside_the_ds_section_is_not_taken_on_the_ds_pass() -> None:
    marks = [
        mark(MarkKind.SEGNO, 3),
        mark(MarkKind.REPEAT_START, 5),
        mark(MarkKind.REPEAT_END, 6),
        mark(MarkKind.FINE, 8),
        mark(MarkKind.DS_AL_FINE, 10),
    ]
    proposal = propose_play_order(marks, 12)
    # First pass 1-6, repeat 5-10; D.S. pass 3-8 plays bars 5-6 once, not twice.
    assert played(proposal, 12) == bars((1, 6), (5, 10), (3, 8))
    assert rows_of(proposal) == [(1, 6), (5, 10), (3, 8)]
    assert proposal.warnings == []


def test_the_first_ending_is_skipped_on_the_dc_pass() -> None:
    marks = [
        mark(MarkKind.REPEAT_START, 1),
        volta(1, 4),
        mark(MarkKind.REPEAT_END, 4),
        volta(2, 5),
        mark(MarkKind.FINE, 6),
        mark(MarkKind.DC_AL_FINE, 8),
    ]
    proposal = propose_play_order(marks, 8)
    assert played(proposal, 8) == bars((1, 4), (1, 3), (5, 8), (1, 3), (5, 6))
    assert proposal.warnings == []


def test_the_order_of_the_marks_in_the_list_does_not_matter() -> None:
    marks = [
        mark(MarkKind.CODA, 13),
        mark(MarkKind.DS_AL_CODA, 12),
        mark(MarkKind.TO_CODA, 8),
        mark(MarkKind.SEGNO, 5),
    ]
    assert rows_of(propose_play_order(marks, 16)) == [(1, 12), (5, 8), (13, 16)]


def assert_straight_through(
    marks: list[StructureMark], bar_count: int, *fragments: str
) -> PlayOrderProposal:
    proposal = propose_play_order(marks, bar_count)
    assert rows_of(proposal) == [(1, bar_count)]
    assert len(proposal.warnings) == 1
    for fragment in fragments:
        assert fragment in proposal.warnings[0]
    return proposal


def test_ds_without_a_segno_falls_back_with_a_warning() -> None:
    assert_straight_through([mark(MarkKind.DS_AL_CODA, 12)], 16, "segno")


def test_ds_with_the_segno_after_it_falls_back_with_a_warning() -> None:
    marks = [mark(MarkKind.DS_AL_FINE, 6), mark(MarkKind.SEGNO, 9), mark(MarkKind.FINE, 10)]
    assert_straight_through(marks, 12, "segno")


def test_al_coda_without_a_coda_sign_falls_back_with_a_warning() -> None:
    marks = [mark(MarkKind.DC_AL_CODA, 8), mark(MarkKind.TO_CODA, 4)]
    assert_straight_through(marks, 12, "D.C. al coda", "no coda sign")


def test_al_coda_without_a_to_coda_sign_falls_back_with_a_warning() -> None:
    marks = [mark(MarkKind.DS_AL_CODA, 8), mark(MarkKind.SEGNO, 2), mark(MarkKind.CODA, 9)]
    assert_straight_through(marks, 12, "D.S. al coda", "no to-coda sign")


def test_al_fine_without_a_fine_falls_back_with_a_warning() -> None:
    assert_straight_through([mark(MarkKind.DC_AL_FINE, 8)], 8, "D.C. al fine", "fine")


def test_a_fine_before_the_place_the_jump_lands_falls_back_with_a_warning() -> None:
    marks = [mark(MarkKind.SEGNO, 5), mark(MarkKind.FINE, 3), mark(MarkKind.DS_AL_FINE, 8)]
    assert_straight_through(marks, 8, "fine sign at bar 3")


def test_a_to_coda_before_the_segno_falls_back_with_a_warning() -> None:
    marks = [
        mark(MarkKind.SEGNO, 5),
        mark(MarkKind.TO_CODA, 3),
        mark(MarkKind.DS_AL_CODA, 8),
        mark(MarkKind.CODA, 9),
    ]
    assert_straight_through(marks, 12, "to-coda sign at bar 3")


def test_two_navigation_marks_fall_back_with_a_warning() -> None:
    marks = [mark(MarkKind.DC_AL_FINE, 6), mark(MarkKind.DC_AL_FINE, 8), mark(MarkKind.FINE, 3)]
    assert_straight_through(marks, 8, "more than one")


def test_a_mark_bar_out_of_range_falls_back_with_a_warning() -> None:
    proposal = assert_straight_through([mark(MarkKind.REPEAT_END, 20)], 16, "bar 20")
    assert proposal.warnings[0].endswith(".")


def test_a_mark_before_bar_one_falls_back_with_a_warning() -> None:
    assert_straight_through([mark(MarkKind.SEGNO, 0)], 16, "bar 0")


def test_a_volta_reaching_past_the_last_bar_falls_back_with_a_warning() -> None:
    marks = [volta(1, 10, bar_end=14), mark(MarkKind.REPEAT_END, 10)]
    assert_straight_through(marks, 12, "10-14")


def test_overlapping_voltas_fall_back_with_a_warning() -> None:
    marks = [
        mark(MarkKind.REPEAT_START, 1),
        volta(1, 7, bar_end=8),
        mark(MarkKind.REPEAT_END, 8),
        volta(2, 8, bar_end=9),
    ]
    assert_straight_through(marks, 12, "overlap")


def test_a_first_ending_without_a_repeat_end_falls_back_with_a_warning() -> None:
    marks = [volta(1, 8), volta(2, 9)]
    assert_straight_through(marks, 12, "1st ending", "repeat-end")


def test_a_volta_without_a_number_falls_back_with_a_warning() -> None:
    marks = [mark(MarkKind.VOLTA, 8), mark(MarkKind.REPEAT_END, 8)]
    assert_straight_through(marks, 12, "number")


def test_a_second_ending_without_a_first_falls_back_with_a_warning() -> None:
    assert_straight_through([volta(2, 9)], 12, "numbered")


def test_two_repeat_ends_with_no_repeat_start_between_fall_back_with_a_warning() -> None:
    marks = [mark(MarkKind.REPEAT_END, 4), mark(MarkKind.REPEAT_END, 8)]
    assert_straight_through(marks, 12, "bars 4 and 8")


def test_a_runaway_simulation_falls_back_with_a_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(play_order, "STEP_LIMIT_FACTOR", 1)
    marks = [mark(MarkKind.REPEAT_START, 5), mark(MarkKind.REPEAT_END, 8)]
    assert_straight_through(marks, 12, "circles")


def test_a_piece_needs_at_least_one_bar() -> None:
    with pytest.raises(ValueError, match="bar_count"):
        propose_play_order([], 0)


SCENARIOS: dict[str, tuple[list[StructureMark], int]] = {
    "plain": ([], 16),
    "repeat": ([mark(MarkKind.REPEAT_START, 5), mark(MarkKind.REPEAT_END, 8)], 12),
    "repeat to start": ([mark(MarkKind.REPEAT_END, 4)], 12),
    "repeat to the last bar": ([mark(MarkKind.REPEAT_END, 12)], 12),
    "voltas": (
        [
            mark(MarkKind.REPEAT_START, 1),
            volta(1, 8),
            mark(MarkKind.REPEAT_END, 8),
            volta(2, 9, bar_end=12),
        ],
        12,
    ),
    "ds al coda": (
        [
            mark(MarkKind.SEGNO, 5),
            mark(MarkKind.TO_CODA, 8),
            mark(MarkKind.DS_AL_CODA, 12),
            mark(MarkKind.CODA, 13),
        ],
        16,
    ),
    "dc al fine": ([mark(MarkKind.FINE, 4), mark(MarkKind.DC_AL_FINE, 8)], 8),
    "ds without segno": ([mark(MarkKind.DS_AL_CODA, 12)], 16),
    "out of range": ([mark(MarkKind.REPEAT_END, 99)], 16),
    "single bar": ([], 1),
}


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_the_proposed_rows_always_expand_without_error(name: str) -> None:
    marks, bar_count = SCENARIOS[name]
    proposal = propose_play_order(marks, bar_count)
    slots = expand_play_order(proposal.rows, bar_count)
    assert slots
    assert all(1 <= slot.bar <= bar_count for slot in slots)
    assert [slot.position for slot in slots] == list(range(len(slots)))


def test_without_repeats_every_bar_is_played_once() -> None:
    marks = [mark(MarkKind.REPEAT_START, 5), mark(MarkKind.REPEAT_END, 8)]

    assert order_without_repeats(marks, 12) == [PlayOrderRow(start=1, end=12)]


def test_without_repeats_the_first_ending_is_left_out() -> None:
    marks = [mark(MarkKind.REPEAT_END, 8), volta(1, 7, 8), volta(2, 9, 10)]

    assert order_without_repeats(marks, 12) == [
        PlayOrderRow(start=1, end=6),
        PlayOrderRow(start=9, end=12),
    ]


def test_without_repeats_a_da_capo_is_still_followed() -> None:
    marks = [
        mark(MarkKind.REPEAT_END, 4),
        mark(MarkKind.DC_AL_FINE, 12),
        mark(MarkKind.FINE, 6),
    ]

    assert order_without_repeats(marks, 12) == [
        PlayOrderRow(start=1, end=12),
        PlayOrderRow(start=1, end=6),
    ]


def test_without_repeats_marks_that_cannot_be_followed_give_straight_through() -> None:
    marks = [mark(MarkKind.DS_AL_FINE, 8)]  # no segno to jump back to

    assert order_without_repeats(marks, 8) == [PlayOrderRow(start=1, end=8)]
