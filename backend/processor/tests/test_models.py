import pytest
from pydantic import ValidationError

from app.pipeline.models import (
    BarBox,
    BarMark,
    Job,
    JobKind,
    JobStatus,
    Locator,
    Meter,
    MeterChange,
    PlayOrderRow,
    PlaySlot,
    ReviewFlag,
    UncertainLine,
    expand_play_order,
)


def row(start: int, end: int) -> PlayOrderRow:
    return PlayOrderRow(start=start, end=end)


def test_row_dumps_with_from_and_to_aliases() -> None:
    assert row(1, 9).model_dump(by_alias=True) == {"from": 1, "to": 9}


def test_row_reads_from_and_to_aliases() -> None:
    parsed = PlayOrderRow.model_validate({"from": 1, "to": 9})
    assert (parsed.start, parsed.end) == (1, 9)
    assert parsed == row(1, 9)


def test_row_json_round_trip() -> None:
    original = row(3, 7)
    text = original.model_dump_json(by_alias=True)
    assert text == '{"from":3,"to":7}'
    assert PlayOrderRow.model_validate_json(text) == original


def test_row_is_frozen() -> None:
    with pytest.raises(ValidationError):
        row(1, 4).start = 2  # type: ignore[misc]


def test_row_rejects_end_before_start() -> None:
    with pytest.raises(ValidationError):
        row(5, 3)


def test_row_rejects_start_below_zero() -> None:
    with pytest.raises(ValidationError):
        row(-1, 3)


def test_a_row_may_start_at_bar_0_the_pickup() -> None:
    slots = expand_play_order([row(0, 3), row(2, 3)], 3)

    assert [(s.bar, s.pass_index) for s in slots] == [
        (0, 0),
        (1, 0),
        (2, 0),
        (3, 0),
        (2, 1),
        (3, 1),
    ]


def test_expand_plain_piece_is_one_slot_per_bar_on_the_first_pass() -> None:
    slots = expand_play_order([row(1, 8)], 8)

    assert [s.bar for s in slots] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert [s.position for s in slots] == [0, 1, 2, 3, 4, 5, 6, 7]
    assert all(s.pass_index == 0 for s in slots)


def test_expand_simple_repeat_counts_the_second_pass() -> None:
    slots = expand_play_order([row(1, 4), row(1, 4), row(5, 8)], 8)

    assert len(slots) == 12
    assert slots[4] == PlaySlot(position=4, bar=1, pass_index=1)
    assert [s for s in slots if s.bar == 3] == [
        PlaySlot(position=2, bar=3, pass_index=0),
        PlaySlot(position=6, bar=3, pass_index=1),
    ]


def test_expand_first_and_second_ending() -> None:
    slots = expand_play_order([row(1, 8), row(1, 7), row(9, 12)], 12)

    assert len(slots) == 19
    assert [s for s in slots if s.bar == 8] == [PlaySlot(position=7, bar=8, pass_index=0)]
    for bar in range(1, 8):
        assert len([s for s in slots if s.bar == bar]) == 2
    assert slots[14] == PlaySlot(position=14, bar=7, pass_index=1)
    assert slots[15] == PlaySlot(position=15, bar=9, pass_index=0)


def test_expand_replays_the_section_after_a_jump_on_its_second_pass() -> None:
    slots = expand_play_order([row(1, 12), row(5, 8), row(13, 16)], 16)

    assert len(slots) == 20
    assert slots[12:16] == [
        PlaySlot(position=12, bar=5, pass_index=1),
        PlaySlot(position=13, bar=6, pass_index=1),
        PlaySlot(position=14, bar=7, pass_index=1),
        PlaySlot(position=15, bar=8, pass_index=1),
    ]


def test_expand_does_not_mutate_its_input() -> None:
    rows = [row(1, 4), row(1, 4)]
    before = list(rows)

    expand_play_order(rows, 4)

    assert rows == before


def test_expand_empty_rows_gives_no_slots() -> None:
    assert expand_play_order([], 8) == []


def test_expand_rejects_a_row_past_the_last_bar() -> None:
    with pytest.raises(ValueError, match="1-9"):
        expand_play_order([row(1, 9)], 8)


def test_expand_rejects_a_bar_count_below_one() -> None:
    with pytest.raises(ValueError, match="bar_count"):
        expand_play_order([], 0)


def test_meter_accepts_common_meters() -> None:
    assert Meter(numerator=6, denominator=8).denominator == 8
    for denominator in (1, 2, 4, 8, 16, 32):
        Meter(numerator=3, denominator=denominator)


def test_meter_rejects_numerator_below_one() -> None:
    with pytest.raises(ValidationError):
        Meter(numerator=0, denominator=4)


@pytest.mark.parametrize("denominator", [0, 3, 5, 6, 12, 64, -4])
def test_meter_rejects_a_denominator_that_is_not_a_note_value(denominator: int) -> None:
    with pytest.raises(ValidationError):
        Meter(numerator=4, denominator=denominator)


def test_meter_change_is_a_meter_that_starts_at_a_bar() -> None:
    change = MeterChange(numerator=3, denominator=4, from_bar=9)

    assert isinstance(change, Meter)
    assert change.from_bar == 9
    with pytest.raises(ValidationError):
        MeterChange(numerator=3, denominator=3, from_bar=9)


def test_bar_box_holds_a_page_rectangle() -> None:
    box = BarBox(bar=2, page_index=0, x=10.0, y=20.5, w=300.0, h=80.0)

    assert (box.bar, box.page_index, box.x, box.y, box.w, box.h) == (2, 0, 10.0, 20.5, 300.0, 80.0)


def test_bar_mark_is_a_fermata_or_a_rit() -> None:
    assert BarMark(bar=4, kind="fermata").kind == "fermata"
    assert BarMark(bar=4, kind="rit").kind == "rit"
    with pytest.raises(ValidationError):
        BarMark(bar=4, kind="coda")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        BarMark(bar=4, kind="rest")  # type: ignore[arg-type]  # a rest is a part's, not the timing's
    with pytest.raises(ValidationError):
        BarMark(bar=-1, kind="rit")
    assert BarMark(bar=0, kind="fermata").bar == 0  # the pickup


def test_locator_is_not_confirmed_by_default() -> None:
    locator = Locator(bar=1, pass_index=0, time_sec=1.5)

    assert locator.confirmed is False
    assert Locator(bar=1, pass_index=0, time_sec=1.5, confirmed=True).confirmed is True


def test_locator_has_no_flags_and_is_not_checked_by_default() -> None:
    locator = Locator(bar=1, pass_index=0, time_sec=1.5)

    assert locator.flags == []
    assert locator.checked is False
    locator.flags.append(
        ReviewFlag(kind="crowded", severity=1, expected=2.0, found=1.4, factor=0.7)
    )
    assert Locator(bar=1, pass_index=0, time_sec=1.5).flags == []  # no list shared between locators


def test_review_flag_round_trips_in_snake_case() -> None:
    flag = ReviewFlag(
        kind="stretched",
        severity=1,
        expected=2.0,
        found=3.2,
        factor=1.6,
        explained_by="fermata",
        uncertain_line=UncertainLine(time_sec=9.7, confidence=0.4),
    )

    dumped = flag.model_dump(mode="json")

    assert dumped == {
        "kind": "stretched",
        "severity": 1,
        "expected": 2.0,
        "found": 3.2,
        "factor": 1.6,
        "explained_by": "fermata",
        "uncertain_line": {"time_sec": 9.7, "confidence": 0.4},
    }
    assert ReviewFlag.model_validate(dumped) == flag
    locator = Locator(bar=4, pass_index=0, time_sec=6.5, flags=[flag], checked=False)
    assert Locator.model_validate(locator.model_dump(mode="json")) == locator


def test_review_flag_optional_fields_default_to_none() -> None:
    flag = ReviewFlag(kind="beat-count", severity=2, expected=4, found=6, factor=None)

    assert flag.explained_by is None
    assert flag.uncertain_line is None


def test_a_review_flag_can_be_explained_by_a_fermata_or_a_rit_mark() -> None:
    base = {"kind": "stretched", "severity": 0, "expected": 2.0, "found": 3.0, "factor": 1.5}
    for reason in ("fermata", "rit"):
        assert ReviewFlag.model_validate({**base, "explained_by": reason}).explained_by == reason


def test_review_flag_rejects_an_unknown_kind_severity_or_explanation() -> None:
    base = {"kind": "crowded", "severity": 1, "expected": 2.0, "found": 1.0, "factor": 0.5}
    for change in ({"kind": "disagree"}, {"severity": 3}, {"explained_by": "rit."}):
        with pytest.raises(ValidationError):
            ReviewFlag.model_validate({**base, **change})


def test_job_enums_have_the_wire_values() -> None:
    assert [k.value for k in JobKind] == ["process-piece", "realign", "add-parts"]
    assert [s.value for s in JobStatus] == ["queued", "running", "done", "error"]
    assert JobKind("realign") is JobKind.REALIGN
    assert JobStatus.DONE == "done"


def test_job_defaults_to_no_error() -> None:
    job = Job(
        id="j1", piece_id="p1", kind=JobKind.PROCESS_PIECE, status=JobStatus.RUNNING, progress=0.5
    )

    assert job.error is None


@pytest.mark.parametrize("progress", [0.0, 0.25, 1.0])
def test_job_accepts_progress_from_zero_to_one(progress: float) -> None:
    job = Job(
        id="j1", piece_id="p1", kind=JobKind.REALIGN, status=JobStatus.QUEUED, progress=progress
    )

    assert job.progress == progress


@pytest.mark.parametrize("progress", [-0.1, 1.01])
def test_job_rejects_progress_outside_zero_to_one(progress: float) -> None:
    with pytest.raises(ValidationError):
        Job(
            id="j1", piece_id="p1", kind=JobKind.REALIGN, status=JobStatus.QUEUED, progress=progress
        )
