"""The hybrid structure read of a part, end to end, on a synthetic Audiveris book.

Two pages of one system each (four measures), ink drawn with the bar lines, and a scripted
score reader. No sample files, no network.
"""

import json
from pathlib import Path

import pytest

from app.pipeline.models import BarMark, Meter, MeterChange, PlayOrderRow
from app.pipeline.pdf_pages import RenderedPart
from app.pipeline.play_order import STRAIGHT_THROUGH, MarkKind
from app.pipeline.score_reader import (
    FakeScoreReader,
    LinePicture,
    ReaderResult,
    Reading,
    ReadLine,
    ScoreReaderError,
)
from app.pipeline.stages import PageImage
from app.pipeline.structure import PieceStructure
from app.pipeline.structure_read import (
    NO_KEY_WARNING,
    PartRead,
    StructureReadError,
    elect_piece_structure,
    part_problems,
    read_part,
)
from tests.barline_fixtures import blank_page, draw_bar, draw_staff
from tests.structure_fixtures import (
    BookEngine,
    ink_of,
    line,
    measure,
    reading,
    sheet_xml,
    system_xml,
)

PDF = Path("part.pdf")
SIZE = (1000, 600)


def rendered(pages: int = 2, angles: list[float] | None = None) -> RenderedPart:
    return RenderedPart(
        pages=[PageImage(i, *SIZE, f"u/p/f/page-{i}.webp") for i in range(pages)],
        angles_deg=angles or [0.0] * pages,
        dpi=[200] * pages,
    )


def two_pages(counts: tuple[int, int] = (4, 4)) -> BookEngine:
    """Page 1: four measures printing 4/4. Page 2: four measures printing 3/4, a repeat start."""
    return BookEngine(
        {
            1: sheet_xml(system_xml(100, counts[0], 1, "4/4")),
            2: sheet_xml(system_xml(100, counts[1], 10, "3/4", {0: "LEFT"})),
        },
        {1: ink_of(counts[0]), 2: ink_of(counts[1])},
    )


def agreeing() -> Reading:
    return reading(line(4, time_signature="4/4"), line(4, time_signature="3/4"), name="Violin I")


# ---------------------------------------------------------------- with the reader


def test_a_part_is_read_into_boxes_a_structure_and_a_name(tmp_path: Path) -> None:
    first = reading(
        line(4, time_signature="4/4"),
        ReadLine(
            page=2,
            printed_start_number=5,
            measures=[
                measure(time_signature="3/4"),
                measure(),
                measure(),
                measure(fermata_beats=[1]),
            ],
        ),
        name="Violin I",
    )
    reader = FakeScoreReader([first], cost_usd=0.01)

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert [box.bar for box in part.boxes] == list(range(1, 9))
    assert [box.page_index for box in part.boxes] == [0] * 4 + [1] * 4
    assert part.structure.bar_count == 8
    assert part.structure.meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=5),
    ]
    assert part.structure.bar_marks == [BarMark(bar=8, kind="fermata")]
    assert part.part_name == "Violin I"
    assert part.cost_usd == 0.01
    assert part.warnings == []
    assert len(part.audits.structure.lines) == 2
    assert part.audits.boxes.lines[0].confidence == "verified"


def test_each_line_is_shown_to_the_reader_with_its_page_and_line_number(tmp_path: Path) -> None:
    reader = FakeScoreReader([agreeing()])

    read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    (call,) = reader.calls
    assert [p.label for p in call] == ["page 1, line 1", "page 2, line 2"]
    assert all(p.caption is None and p.png.startswith(b"\x89PNG") for p in call)


def test_lines_the_page_agrees_with_are_read_only_once(tmp_path: Path) -> None:
    reader = FakeScoreReader([agreeing()])

    read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert len(reader.calls) == 1


def test_a_disputed_line_is_read_again_once_with_the_count_the_page_gives(tmp_path: Path) -> None:
    short = reading(line(4, time_signature="4/4"), line(3, time_signature="3/4"))
    again = reading(
        ReadLine(
            page=2,
            printed_start_number=None,
            measures=[
                measure(time_signature="3/4", repeat="start"),
                measure(),
                measure(),
                measure(fermata_beats=[1]),
            ],
        )
    )
    reader = FakeScoreReader([short, again], cost_usd=0.02)

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert len(reader.calls) == 2
    (picture,) = reader.calls[1]
    assert picture.label == "page 2, line 2"
    assert picture.caption == "this line has 4 measures (bars 5-8)"
    assert part.structure.bar_count == 8
    assert part.structure.bar_marks == [BarMark(bar=8, kind="fermata")]  # from the second look
    assert [m.kind for m in part.structure.marks] == [MarkKind.REPEAT_START]
    assert part.cost_usd == pytest.approx(0.04)
    assert part.audits.structure.lines[1].reread == 4
    assert part.audits.structure.corrected == 1


def test_a_line_is_never_read_a_third_time(tmp_path: Path) -> None:
    short = reading(line(4, time_signature="4/4"), line(3, time_signature="3/4"))
    still_short = reading(line(3))
    reader = FakeScoreReader([short, still_short])

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert len(reader.calls) == 2
    assert part.structure.bar_count == 8  # the page's count stands
    assert any("the page shows 4 measures but the score reading saw 3" in w for w in part.warnings)


def test_a_failed_second_look_keeps_the_first_reading_and_says_so(tmp_path: Path) -> None:
    class SecondFails(FakeScoreReader):
        def read(self, pictures: list[LinePicture]) -> ReaderResult:
            if self.calls:
                self.calls.append(pictures)
                raise ScoreReaderError("The Anthropic API could not be reached to read the score.")
            return super().read(pictures)

    reader = SecondFails([reading(line(4, time_signature="4/4"), line(3, time_signature="3/4"))])

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert part.structure.bar_count == 8
    assert part.structure.meters[1] == MeterChange(numerator=3, denominator=4, from_bar=5)
    assert "The Anthropic API could not be reached to read the score." in part.warnings
    assert "The disputed lines were not read again; check their marks." in part.warnings


def test_the_page_decides_the_count_when_the_reader_overcounts(tmp_path: Path) -> None:
    over = reading(line(4, time_signature="4/4"), line(5, time_signature="3/4"))
    reader = FakeScoreReader([over, reading(line(4, time_signature="3/4"))])

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert part.structure.bar_count == 8
    assert len(part.boxes) == 8


def test_a_multi_rest_measure_takes_all_its_bars_but_one_box_width(tmp_path: Path) -> None:
    rest = ReadLine(
        page=1,
        printed_start_number=None,
        measures=[measure(time_signature="4/4"), measure(multi_rest_bars=3), measure(), measure()],
    )
    reader = FakeScoreReader([reading(rest, line(4, time_signature="3/4"))])

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert part.structure.bar_count == 10
    assert [box.bar for box in part.boxes] == list(range(1, 11))
    assert (
        part.boxes[1]
        == part.boxes[2].model_copy(update={"bar": 2})
        == part.boxes[3].model_copy(update={"bar": 2})
    )
    assert part.structure.rests == [2, 3, 4]


def test_the_boxes_follow_the_levelling_angle_of_the_stored_page(tmp_path: Path) -> None:
    level = read_part(PDF, rendered(), two_pages(), FakeScoreReader([agreeing()]), tmp_path)
    tilted = read_part(
        PDF, rendered(angles=[1.0, 0.0]), two_pages(), FakeScoreReader([agreeing()]), tmp_path
    )

    assert tilted.boxes[0] != level.boxes[0]
    assert tilted.boxes[4] == level.boxes[4]


# ---------------------------------------------------------------- without the reader


def test_without_a_reader_the_bars_and_printed_signs_come_from_audiveris_and_the_page(
    tmp_path: Path,
) -> None:
    part = read_part(PDF, rendered(), two_pages(), None, tmp_path)

    assert [box.bar for box in part.boxes] == list(range(1, 9))
    assert part.structure.meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=5),
    ]
    assert [(m.kind, m.bar) for m in part.structure.marks] == [(MarkKind.REPEAT_START, 5)]
    assert part.structure.bar_marks == []
    assert part.cost_usd == 0.0
    assert part.part_name is None
    assert NO_KEY_WARNING in part.warnings
    assert NO_KEY_WARNING == (
        "The score's structure was read without the vision model (no Anthropic key); "
        "check repeats, fermatas and rests."
    )


def test_without_a_reader_audiveris_counts_stand_when_the_page_disagrees(tmp_path: Path) -> None:
    # Audiveris sees five columns on page 2 where the page shows four bars: the page overcounts
    # on real scans (a stem is no bar line), so with no reader Audiveris is followed
    engine = BookEngine(
        {1: sheet_xml(system_xml(100, 4, 1, "4/4")), 2: sheet_xml(system_xml(100, 5, 10))},
        {1: ink_of(4), 2: ink_of(4)},
    )

    part = read_part(PDF, rendered(), engine, None, tmp_path)

    assert part.structure.bar_count == 9
    assert part.audits.structure.lines[1].audiveris == 5
    assert part.audits.structure.lines[1].pixels == 4


def test_a_reader_that_fails_falls_back_and_puts_its_sentence_in_the_warnings(
    tmp_path: Path,
) -> None:
    class Refused:
        def read(self, pictures: list[LinePicture]) -> ReaderResult:
            raise ScoreReaderError("The Anthropic API refused the Anthropic API key.")

    part = read_part(PDF, rendered(), two_pages(), Refused(), tmp_path)

    assert part.warnings[0] == "The Anthropic API refused the Anthropic API key."
    assert part.warnings[1].startswith("The score's structure was read without the vision model")
    assert part.structure.bar_count == 8
    assert part.cost_usd == 0.0


def test_a_reader_that_returns_the_wrong_number_of_lines_falls_back(tmp_path: Path) -> None:
    reader = FakeScoreReader([reading(line(4))])

    part = read_part(PDF, rendered(), two_pages(), reader, tmp_path)

    assert part.warnings[0] == "The score reader returned 1 lines for 2 pictures."
    assert part.structure.bar_count == 8


def test_a_page_without_an_image_cannot_be_cut_so_the_read_falls_back(tmp_path: Path) -> None:
    engine = BookEngine(two_pages().sheets)  # no page images in the book
    reader = FakeScoreReader([agreeing()])

    part = read_part(PDF, rendered(), engine, reader, tmp_path)

    assert reader.calls == []
    assert "no page image for page 1" in part.warnings[0]
    assert part.structure.bar_count == 8
    assert part.audits.boxes.lines[0].confidence == "unchecked"


# ---------------------------------------------------------------- the pages


def test_a_page_audiveris_skipped_has_no_lines_and_a_warning(tmp_path: Path) -> None:
    engine = BookEngine(
        {
            1: sheet_xml(system_xml(100, 4, 1, "4/4")),
            3: sheet_xml(system_xml(100, 4, 10)),
        },
        {1: ink_of(4), 3: ink_of(4)},
    )
    reader = FakeScoreReader([reading(line(4, time_signature="4/4"), line(4))])

    part = read_part(PDF, rendered(3), engine, reader, tmp_path)

    assert [p.label for p in reader.calls[0]] == ["page 1, line 1", "page 3, line 2"]
    assert [box.page_index for box in part.boxes] == [0] * 4 + [2] * 4
    assert "The score reader found no music on page 2; its bars are missing." in part.warnings
    assert part.audits.boxes.lines[1].page == 2


def test_a_sheet_beyond_the_pdf_is_an_error(tmp_path: Path) -> None:
    engine = BookEngine({3: sheet_xml(system_xml(100, 4, 1))})

    with pytest.raises(StructureReadError, match="not in the PDF"):
        read_part(PDF, rendered(2), engine, None, tmp_path)


def test_a_book_without_staves_is_an_error(tmp_path: Path) -> None:
    engine = BookEngine({1: sheet_xml()})

    with pytest.raises(StructureReadError, match="No staves"):
        read_part(PDF, rendered(1), engine, None, tmp_path)


def test_a_structure_read_error_is_a_value_error() -> None:
    assert issubclass(StructureReadError, ValueError)


# ---------------------------------------------------------------- the parts of a piece


def part_of(tmp_path: Path, counts: tuple[int, int] = (4, 4)) -> PartRead:
    return read_part(PDF, rendered(), two_pages(counts), None, tmp_path)


def test_a_part_that_matches_the_piece_has_no_problem(tmp_path: Path) -> None:
    first = part_of(tmp_path)
    second = part_of(tmp_path)

    assert part_problems("Cello", second, first.structure.bar_count, first.structure.meters) == []


def test_a_part_with_another_bar_count_names_the_part_and_both_counts(tmp_path: Path) -> None:
    first = part_of(tmp_path)
    shorter = part_of(tmp_path, (4, 3))

    problems = part_problems("Cello", shorter, first.structure.bar_count, first.structure.meters)

    assert problems == ["Cello has 7 bars but the piece has 8; check its bar lines."]


def test_a_part_with_other_meters_is_a_problem_too(tmp_path: Path) -> None:
    part = part_of(tmp_path)
    other = [Meter(numerator=6, denominator=8)]
    meters = [
        MeterChange(numerator=m.numerator, denominator=m.denominator, from_bar=1) for m in other
    ]

    problems = part_problems("Cello", part, 8, meters)

    assert problems == [
        "Cello has the meters 4/4 from bar 1, 3/4 from bar 5 but the piece has 6/8 from bar 1; "
        "check them."
    ]


# ---------------------------------------------------------------- a pickup


PICKUP = 'special="PICKUP" expected="3/4" duration="1/8"'


def pickup_book(first: str | None = PICKUP) -> BookEngine:
    """Two pages of four measures; the first measure of the piece carries `first` as attributes."""
    attrs = {} if first is None else {0: first}
    return BookEngine(
        {
            1: sheet_xml(system_xml(100, 4, 1, "6/8", stack_attrs=attrs)),
            2: sheet_xml(system_xml(100, 4, 10, None)),
        },
        {1: ink_of(4), 2: ink_of(4)},
    )


def pickup_reading(beats: int | None, *, second_number: int | None = None) -> Reading:
    first = line(4, time_signature="6/8").model_copy(update={"first_measure_beats": beats})
    return reading(first, line(4, number=second_number), name="Violin")


def test_a_pickup_two_readings_agree_on_makes_bar_0_and_moves_the_numbers(tmp_path: Path) -> None:
    reader = FakeScoreReader([pickup_reading(1)])

    part = read_part(PDF, rendered(), pickup_book(), reader, tmp_path)

    assert [box.bar for box in part.boxes] == list(range(0, 8))
    assert part.structure.bar_count == 7
    assert part.structure.short_bars == {0: 1}
    assert part.structure.pickup_sources == 2
    assert [(row.start, row.end) for row in part.structure.play_order] == [(0, 7)]
    assert part.structure.meters == [MeterChange(numerator=6, denominator=8, from_bar=1)]


def test_one_reading_alone_still_makes_bar_0_but_with_one_source(tmp_path: Path) -> None:
    reader = FakeScoreReader([pickup_reading(None)])

    part = read_part(PDF, rendered(), pickup_book(), reader, tmp_path)

    assert part.structure.short_bars == {0: 1}
    assert part.structure.pickup_sources == 1
    assert part.boxes[0].bar == 0


def test_the_printed_numbers_can_be_the_second_reading(tmp_path: Path) -> None:
    reader = FakeScoreReader(
        [pickup_reading(None, second_number=4)]
    )  # 4 bars before it, none counted

    part = read_part(PDF, rendered(), pickup_book(first=None), reader, tmp_path)

    assert part.structure.pickup_sources == 1  # only the numbers; the length is the default one
    assert part.structure.short_bars == {0: 1}


def test_a_full_first_bar_everywhere_is_no_pickup(tmp_path: Path) -> None:
    full = 'expected="3/4" duration="3/4"'
    reader = FakeScoreReader([pickup_reading(0, second_number=5)])

    part = read_part(PDF, rendered(), pickup_book(full), reader, tmp_path)

    assert [box.bar for box in part.boxes] == list(range(1, 9))
    assert part.structure.short_bars == {}
    assert part.structure.bar_count == 8


def test_without_the_reader_audiveris_alone_still_finds_the_pickup(tmp_path: Path) -> None:
    part = read_part(PDF, rendered(), pickup_book(), None, tmp_path)

    assert part.structure.short_bars == {0: 1}
    assert part.structure.pickup_sources == 1


def test_a_short_bar_audiveris_finds_in_the_middle_keeps_its_number(tmp_path: Path) -> None:
    book = BookEngine(
        {
            1: sheet_xml(
                system_xml(100, 4, 1, "6/8", stack_attrs={2: 'expected="3/4" duration="1/4"'})
            ),
            2: sheet_xml(system_xml(100, 4, 10, None)),
        },
        {1: ink_of(4), 2: ink_of(4)},
    )
    reader = FakeScoreReader([pickup_reading(0, second_number=5)])

    part = read_part(PDF, rendered(), book, reader, tmp_path)

    assert part.structure.short_bars == {3: 2}
    assert any("Bar 3" in warning for warning in part.warnings)


def test_a_value_error_subclass_from_the_reader_does_not_put_its_text_in_the_warnings(
    tmp_path: Path,
) -> None:
    class Quoting:
        def read(self, pictures: list[LinePicture]) -> ReaderResult:
            raise json.JSONDecodeError("bad", '{"email": "a@b.com"}', 3)

    part = read_part(PDF, rendered(), two_pages(), Quoting(), tmp_path)

    assert not any("a@b.com" in w for w in part.warnings)
    assert part.warnings[1].startswith("The score's structure was read without the vision model")


# -------------------------------------------------------- a courtesy signature at a line end


def courtesy_system(top: int = 100) -> str:
    """Four bars (bar lines at 300, 500, 700 and a single one at 900) and, after the single bar
    line, a 50 px column in which Audiveris found no music and read a courtesy 3/4."""
    edges = [(50, 300), (300, 500), (500, 700), (700, 900), (900, 950)]
    stacks = (
        "".join(
            f'<stack id="{k}" left="{a}" right="{b}" expected="1" duration="1"/>'
            for k, (a, b) in enumerate(edges[:-1], 1)
        )
        + '<stack id="5" left="900" right="950" expected="1" duration="0" special="CAUTIONARY"/>'
    )
    measures = (
        '<measure id="1"><times>900</times></measure>'
        + "".join(f'<measure id="{k}"/>' for k in (2, 3, 4))
        + '<measure id="5"><times>901</times></measure>'
    )
    inters = (
        '<time-pair id="900" shape="TIME_CUSTOM" time-rational="4/4">'
        '<bounds x="60" y="0" w="30" h="40"/></time-pair>'
        '<time-pair id="901" shape="TIME_CUSTOM" time-rational="3/4">'
        '<bounds x="908" y="0" w="34" h="40"/></time-pair>'
    )
    lines = "".join(
        f'<line><point x="50" y="{y}"/><point x="950" y="{y}"/></line>' for y in (top, top + 80)
    )
    return (
        f"<system>{stacks}<part><staff><lines>{lines}</lines></staff>{measures}</part>"
        f"<sig><inters>{inters}</inters></sig></system>"
    )


def courtesy_book(next_line_prints_meter: bool = True) -> BookEngine:
    first_ink = blank_page()
    draw_staff(first_ink, 100)
    for x in (300, 500, 700, 900):
        draw_bar(first_ink, x, 100)
    return BookEngine(
        {
            1: sheet_xml(courtesy_system()),
            2: sheet_xml(system_xml(100, 4, 10, "3/4" if next_line_prints_meter else None)),
        },
        {1: first_ink, 2: ink_of(4)},
    )


def test_a_courtesy_time_signature_after_a_single_bar_line_is_no_bar(tmp_path: Path) -> None:
    reader = FakeScoreReader(
        [reading(line(4, time_signature="4/4"), line(4, time_signature="3/4"))]
    )

    part = read_part(PDF, rendered(), courtesy_book(), reader, tmp_path)

    assert part.structure.bar_count == 8
    assert [box.bar for box in part.boxes] == list(range(1, 9))
    assert [round(b.x + b.w) for b in part.boxes[:4]][-1] == 900  # the line ends at its bar line
    assert part.structure.meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=5),
    ]
    assert (part.audits.structure.lines[0].audiveris, part.audits.structure.lines[0].pixels) == (
        4,
        4,
    )


def test_without_a_reader_the_courtesy_meter_lands_on_the_first_bar_of_the_next_line(
    tmp_path: Path,
) -> None:
    # the next line prints no meter of its own here: the courtesy 3/4 is the only mark of it
    part = read_part(PDF, rendered(), courtesy_book(next_line_prints_meter=False), None, tmp_path)

    assert part.structure.bar_count == 8
    assert part.structure.meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=5),
    ]


# ---------------------------------------------------------------- the parts vote on the piece


def structure_of_part(
    bars: int,
    rows: list[tuple[int, int]],
    meter: tuple[int, int] = (2, 2),
    warnings: list[str] | None = None,
) -> PieceStructure:
    return PieceStructure(
        bar_count=bars,
        meters=[MeterChange(from_bar=1, numerator=meter[0], denominator=meter[1])],
        marks=[],
        bar_marks=[],
        tempo_text={},
        part_name=None,
        play_order=[PlayOrderRow(start=a, end=b) for a, b in rows],
        warnings=warnings or [],
    )


REPEATS = [(1, 20), (5, 19), (21, 143)]
GAVE_UP = [f"The 1st ending at bar 142 has no repeat-end sign{STRAIGHT_THROUGH}"]


def test_one_part_is_the_piece() -> None:
    only = structure_of_part(8, [(1, 8)])
    assert elect_piece_structure([only]) is only


def test_parts_that_agree_leave_the_first_part_as_the_piece() -> None:
    parts = [structure_of_part(143, REPEATS) for _ in range(3)]
    assert elect_piece_structure(parts) is parts[0]


def test_two_parts_that_differ_leave_the_first_part_as_the_piece() -> None:
    parts = [structure_of_part(143, REPEATS), structure_of_part(145, [(1, 145)])]
    assert elect_piece_structure(parts) is parts[0]


def test_most_parts_outvote_the_first_on_the_bar_count() -> None:
    parts = [structure_of_part(145, REPEATS), *[structure_of_part(143, REPEATS) for _ in range(2)]]
    assert elect_piece_structure(parts) is parts[1]


def test_a_part_that_gave_up_on_the_repeats_has_no_vote_on_the_play_order() -> None:
    # Straight through is what it fell back to, not what it read: two parts giving up the same
    # way do not outvote the one that read the repeats.
    gave_up = structure_of_part(143, [(1, 143)], warnings=GAVE_UP)
    read = structure_of_part(143, REPEATS)
    assert elect_piece_structure([gave_up, gave_up, read]) is read


def test_a_piece_with_no_repeats_is_a_vote_like_any_other() -> None:
    straight = [structure_of_part(143, [(1, 143)]) for _ in range(2)]
    one_read_a_false_repeat = structure_of_part(143, REPEATS)
    assert elect_piece_structure([one_read_a_false_repeat, *straight]) is straight[0]


def test_when_every_part_gave_up_the_first_part_is_the_piece() -> None:
    parts = [structure_of_part(143, [(1, 143)], warnings=GAVE_UP) for _ in range(3)]
    assert elect_piece_structure(parts) is parts[0]


def test_among_the_parts_with_the_order_most_read_the_meter_decides() -> None:
    common_time = structure_of_part(143, REPEATS, meter=(4, 4))
    cut_time = [structure_of_part(143, REPEATS, meter=(2, 2)) for _ in range(2)]
    assert elect_piece_structure([common_time, *cut_time]) is cut_time[0]


def test_stars_and_stripes() -> None:
    # Flutes first, with its three misreads: bar count, meter, and a 1st ending it gave up on.
    flutes = structure_of_part(145, [(1, 145)], meter=(4, 4), warnings=GAVE_UP)
    clarinet = structure_of_part(143, REPEATS)
    alto = structure_of_part(143, [(1, 143)], warnings=GAVE_UP)
    trombone = structure_of_part(143, REPEATS, meter=(4, 4))
    assert elect_piece_structure([flutes, clarinet, alto, clarinet, trombone]) is clarinet
