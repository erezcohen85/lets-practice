import io
import zipfile
from fractions import Fraction
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.pipeline.models import BarBox, Meter, MeterChange
from app.pipeline.omr import (
    OmrLine,
    OmrMeasure,
    OmrPage,
    OmrSystem,
    omr_lines,
    parse_omr_sheet,
    parse_omr_systems,
    read_omr_ink,
    to_bar_boxes,
)
from app.pipeline.play_order import MarkKind, StructureMark

FIXTURE = Path(__file__).parent / "fixtures" / "omr_sheet.xml"


@pytest.fixture
def fixture_xml() -> str:
    return FIXTURE.read_text(encoding="utf-8")


@pytest.fixture
def page(fixture_xml: str) -> OmrPage:
    return parse_omr_sheet(fixture_xml, page_index=0)


def staff_xml(top: float, bottom: float) -> str:
    """A staff drawn as its top and bottom lines only."""
    return "".join(
        f'<line><point x="0" y="{y}"/><point x="1000" y="{y}"/></line>' for y in (top, bottom)
    )


def system_xml(
    top: float,
    bottom: float,
    stacks: list[tuple[int, float, float]],
    times: dict[int, str] | None = None,
    inters: str = "",
    repeats: dict[int, str] | None = None,
) -> str:
    """One <system>; stacks are (id, left, right); times maps a measure id to its <times> text."""
    repeats = repeats or {}
    stack_tags = "".join(
        f'<stack id="{i}" left="{left}" right="{right}"'
        + (f' repeat="{repeats[i]}"' if i in repeats else "")
        + "/>"
        for i, left, right in stacks
    )
    measure_tags = "".join(
        f'<measure id="{i}"><times>{times[i]}</times></measure>'
        if times and i in times
        else f'<measure id="{i}"/>'
        for i, _, _ in stacks
    )
    return (
        f"<system>{stack_tags}<part><staff><lines>{staff_xml(top, bottom)}</lines></staff>"
        f"{measure_tags}</part><sig><inters>{inters}</inters></sig></system>"
    )


def sheet_xml(*systems: str, width: int = 2000, height: int = 2800) -> str:
    return (
        f'<sheet><picture width="{width}" height="{height}"/>'
        f'<page id="1">{"".join(systems)}</page></sheet>'
    )


def plain_page(index: int, *bars_per_system: int) -> OmrPage:
    """A page of equally wide, unmarked measures, one system per count."""
    systems = [
        OmrSystem(
            top=100.0 + 300.0 * n,
            bottom=200.0 + 300.0 * n,
            measures=[OmrMeasure(left=100.0 * i, right=100.0 * (i + 1)) for i in range(count)],
        )
        for n, count in enumerate(bars_per_system)
    ]
    return OmrPage(page_index=index, image_width=2000, image_height=2800, systems=systems)


def boxes_of(page: OmrPage, size: tuple[int, int]) -> list[BarBox]:
    return to_bar_boxes([page], {page.page_index: size})[0]


# --- parse_omr_sheet ---------------------------------------------------------------------------


def test_fixture_parses_into_two_systems_of_four_measures(page: OmrPage) -> None:
    assert page.page_index == 0
    assert (page.image_width, page.image_height) == (2000, 2800)
    assert [len(system.measures) for system in page.systems] == [4, 4]


def test_system_extent_comes_from_the_staff_lines(page: OmrPage) -> None:
    first, second = page.systems
    assert (first.top, first.bottom) == (400, 560)
    assert (second.top, second.bottom) == (1000, 1160)


def test_measure_extent_comes_from_the_stacks(page: OmrPage) -> None:
    spans = [[(m.left, m.right) for m in system.measures] for system in page.systems]
    assert spans == [
        [(150, 550), (550, 950), (950, 1350), (1350, 1850)],
        [(150, 600), (600, 1000), (1000, 1400), (1400, 1850)],
    ]


def test_time_signatures_are_read_where_they_are_printed(page: OmrPage) -> None:
    printed = [[m.time_signature for m in system.measures] for system in page.systems]
    assert printed == [
        [Meter(numerator=4, denominator=4), None, None, None],
        [None, None, Meter(numerator=3, denominator=4), None],
    ]


def test_repeat_signs_are_read_per_side(page: OmrPage) -> None:
    starts = [[m.repeat_start for m in system.measures] for system in page.systems]
    ends = [[m.repeat_end for m in system.measures] for system in page.systems]
    assert starts == [[False] * 4, [True, False, False, False]]
    assert ends == [[False, False, False, True], [False] * 4]


def test_page_index_is_the_callers(fixture_xml: str) -> None:
    assert parse_omr_sheet(fixture_xml, page_index=7).page_index == 7


def test_time_pair_and_custom_signatures_are_read() -> None:
    inters = (
        '<time-pair id="5" time-rational="7/8"/>'
        '<time-custom id="6" time-rational="5/4"/>'
        '<time-number id="7" shape="TIME_SEVEN"/>'
    )
    xml = sheet_xml(
        system_xml(0, 100, [(1, 0, 100), (2, 100, 200)], times={1: "7 5", 2: "6"}, inters=inters)
    )
    measures = parse_omr_sheet(xml, 0).systems[0].measures
    assert [m.time_signature for m in measures] == [
        Meter(numerator=7, denominator=8),
        Meter(numerator=5, denominator=4),
    ]


def test_a_two_staff_measure_takes_the_first_resolvable_signature() -> None:
    inters = '<time-whole id="9" time-rational="6/8"/>'
    xml = sheet_xml(
        system_xml(0, 100, [(1, 0, 100)], times={1: "404 9 9"}, inters=inters),
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[0].time_signature == Meter(
        numerator=6, denominator=8
    )


def test_a_time_reference_that_points_nowhere_is_ignored() -> None:
    xml = sheet_xml(system_xml(0, 100, [(1, 0, 100)], times={1: "404"}))
    assert parse_omr_sheet(xml, 0).systems[0].measures[0].time_signature is None


def test_both_repeat_sides_on_one_stack() -> None:
    xml = sheet_xml(system_xml(0, 100, [(1, 0, 100)], repeats={1: "LEFT RIGHT"}))
    only = parse_omr_sheet(xml, 0).systems[0].measures[0]
    assert (only.repeat_start, only.repeat_end) == (True, True)


def test_systems_and_measures_are_put_in_page_order() -> None:
    xml = sheet_xml(
        system_xml(500, 600, [(3, 100, 200), (2, 0, 100)]),
        system_xml(100, 200, [(1, 0, 100)]),
    )
    parsed = parse_omr_sheet(xml, 0)
    assert [system.top for system in parsed.systems] == [100, 500]
    assert [m.left for m in parsed.systems[1].measures] == [0, 100]


def test_declaration_and_comments_are_fine() -> None:
    xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!-- hi -->' + sheet_xml(
        system_xml(0, 100, [(1, 0, 100)])
    )
    assert len(parse_omr_sheet(xml, 0).systems) == 1


def test_a_sheet_with_no_systems_parses_to_an_empty_page() -> None:
    assert parse_omr_sheet(sheet_xml(), 0).systems == []


@pytest.mark.parametrize(
    "xml",
    [
        "",
        "not xml at all",
        "<sheet><picture width='2000' height='2800'/>",
        "<score><picture width='2000' height='2800'/></score>",
        "<sheet><page/></sheet>",
        "<sheet><picture height='2800'/></sheet>",
        "<sheet><picture width='wide' height='2800'/></sheet>",
        "<sheet><picture width='0' height='2800'/></sheet>",
        "<sheet><picture width='nan' height='2800'/></sheet>",
    ],
    ids=[
        "empty",
        "not-xml",
        "truncated",
        "wrong-root",
        "no-picture",
        "no-width",
        "width-not-a-number",
        "zero-width",
        "width-nan",
    ],
)
def test_malformed_input_raises_value_error(xml: str) -> None:
    with pytest.raises(ValueError):
        parse_omr_sheet(xml, 0)


STAFF = "<part><staff><lines>" + staff_xml(0, 100) + "</lines></staff></part>"


@pytest.mark.parametrize(
    "system",
    [
        '<system><stack id="1" left="0" right="10"/></system>',
        '<system><stack id="1" right="10"/>' + STAFF + "</system>",
        '<system><stack id="1" left="10" right="10"/>' + STAFF + "</system>",
        '<system><stack id="1" left="10" right="20"/><part><staff><lines>'
        '<line><point x="0"/></line></lines></staff></part></system>',
        system_xml(0, 100, [(1, 0, 100)], times={1: "5"}, inters='<time-whole id="5"/>'),
        system_xml(
            0, 100, [(1, 0, 100)], times={1: "5"}, inters='<time-whole id="5" time-rational="4"/>'
        ),
        system_xml(
            0,
            100,
            [(1, 0, 100)],
            times={1: "5"},
            inters='<time-whole id="5" time-rational="4/3"/>',
        ),
    ],
    ids=[
        "no-staff-lines",
        "stack-without-left",
        "stack-with-no-width",
        "point-without-y",
        "time-without-rational",
        "time-rational-without-slash",
        "time-rational-bad-denominator",
    ],
)
def test_a_broken_system_raises_value_error(system: str) -> None:
    with pytest.raises(ValueError):
        parse_omr_sheet(sheet_xml(system), 0)


def test_a_time_signature_nobody_refers_to_is_not_read() -> None:
    xml = sheet_xml(
        system_xml(0, 100, [(1, 0, 100)], inters='<time-whole id="5" time-rational="4/3"/>')
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[0].time_signature is None


# --- to_bar_boxes ------------------------------------------------------------------------------


def test_bars_are_numbered_one_to_eight_in_page_order(page: OmrPage) -> None:
    boxes = boxes_of(page, (2000, 2800))
    assert [b.bar for b in boxes] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert {b.page_index for b in boxes} == {0}
    assert [b.y for b in boxes] == [400] * 4 + [1000] * 4
    assert [b.x for b in boxes] == [150, 550, 950, 1350, 150, 600, 1000, 1400]
    assert [b.w for b in boxes] == [400, 400, 400, 500, 450, 400, 400, 450]


def test_box_height_spans_the_system_top_to_bottom(page: OmrPage) -> None:
    boxes = boxes_of(page, (2000, 2800))
    for box in boxes[:4]:
        assert (box.y, box.h) == (400, 160)
    for box in boxes[4:]:
        assert (box.y, box.h) == (1000, 160)


def test_scaling_to_half_size_halves_every_coordinate(page: OmrPage) -> None:
    native = boxes_of(page, (2000, 2800))
    halved = boxes_of(page, (1000, 1400))
    assert len(halved) == len(native) == 8
    for full, half in zip(native, halved, strict=True):
        assert (half.bar, half.page_index) == (full.bar, full.page_index)
        assert (half.x, half.y, half.w, half.h) == (
            full.x / 2,
            full.y / 2,
            full.w / 2,
            full.h / 2,
        )


def test_each_axis_scales_by_its_own_factor(page: OmrPage) -> None:
    first = boxes_of(page, (1000, 2800))[0]
    assert (first.x, first.y, first.w, first.h) == (75, 400, 200, 160)
    first = boxes_of(page, (4000, 1400))[0]
    assert (first.x, first.y, first.w, first.h) == (300, 200, 800, 80)


def test_meter_changes_follow_the_printed_signatures(page: OmrPage) -> None:
    _, meters, _ = to_bar_boxes([page], {0: (1000, 1400)})
    assert meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=7),
    ]


def test_repeat_barlines_become_structure_marks(page: OmrPage) -> None:
    _, _, marks = to_bar_boxes([page], {0: (1000, 1400)})
    assert marks == [
        StructureMark(kind=MarkKind.REPEAT_END, bar=4),
        StructureMark(kind=MarkKind.REPEAT_START, bar=5),
    ]


def test_a_bar_with_both_repeat_signs_gets_start_then_end() -> None:
    only = plain_page(0, 1)
    only.systems[0].measures[0].repeat_start = True
    only.systems[0].measures[0].repeat_end = True
    _, _, marks = to_bar_boxes([only], {0: (2000, 2800)})
    assert [(m.kind, m.bar) for m in marks] == [
        (MarkKind.REPEAT_START, 1),
        (MarkKind.REPEAT_END, 1),
    ]


def test_two_pages_in_a_row_continue_the_numbering(fixture_xml: str) -> None:
    pages = [parse_omr_sheet(fixture_xml, 0), parse_omr_sheet(fixture_xml, 1)]
    boxes, meters, marks = to_bar_boxes(pages, {0: (1000, 1400), 1: (500, 700)})
    assert [b.bar for b in boxes] == list(range(1, 17))
    assert [b.page_index for b in boxes] == [0] * 8 + [1] * 8
    second_page_first = boxes[8]
    assert (second_page_first.bar, second_page_first.x, second_page_first.y) == (9, 37.5, 100)
    assert [(m.numerator, m.from_bar) for m in meters] == [(4, 1), (3, 7), (4, 9), (3, 15)]
    assert [(m.kind, m.bar) for m in marks] == [
        (MarkKind.REPEAT_END, 4),
        (MarkKind.REPEAT_START, 5),
        (MarkKind.REPEAT_END, 12),
        (MarkKind.REPEAT_START, 13),
    ]


def test_pages_are_taken_in_page_index_order() -> None:
    first, second = plain_page(0, 2), plain_page(1, 3)
    boxes, _, _ = to_bar_boxes([second, first], {0: (2000, 2800), 1: (2000, 2800)})
    assert [(b.bar, b.page_index) for b in boxes] == [(1, 0), (2, 0), (3, 1), (4, 1), (5, 1)]


def test_a_signature_carries_over_the_page_break() -> None:
    first = plain_page(0, 2)
    first.systems[0].measures[1].time_signature = Meter(numerator=3, denominator=4)
    second = plain_page(1, 2)
    _, meters, _ = to_bar_boxes([first, second], {0: (2000, 2800), 1: (2000, 2800)})
    assert meters == [
        MeterChange(numerator=4, denominator=4, from_bar=1),
        MeterChange(numerator=3, denominator=4, from_bar=2),
    ]


def test_without_a_printed_signature_the_piece_starts_in_four_four() -> None:
    _, meters, _ = to_bar_boxes([plain_page(0, 3)], {0: (2000, 2800)})
    assert meters == [MeterChange(numerator=4, denominator=4, from_bar=1)]


def test_a_signature_that_repeats_the_current_meter_is_not_a_change() -> None:
    only = plain_page(0, 4)
    four_four = Meter(numerator=4, denominator=4)
    three_four = Meter(numerator=3, denominator=4)
    for index, meter in {0: four_four, 1: three_four, 2: three_four, 3: four_four}.items():
        only.systems[0].measures[index].time_signature = meter
    _, meters, _ = to_bar_boxes([only], {0: (2000, 2800)})
    assert [(m.numerator, m.from_bar) for m in meters] == [(4, 1), (3, 2), (4, 4)]


def test_no_pages_gives_nothing() -> None:
    assert to_bar_boxes([], {}) == ([], [], [])


def test_a_missing_target_size_raises_value_error(page: OmrPage) -> None:
    with pytest.raises(ValueError, match="page 0"):
        to_bar_boxes([page], {})


@pytest.mark.parametrize("size", [(0, 1400), (1000, 0), (-5, 1400)])
def test_a_target_size_must_be_positive(page: OmrPage, size: tuple[int, int]) -> None:
    with pytest.raises(ValueError):
        to_bar_boxes([page], {0: size})


# --- parse_omr_systems -------------------------------------------------------------------------


def lines_xml(ys_left: list[float], ys_right: list[float], x0: float, x1: float) -> str:
    """A staff of lines running from (x0, left y) to (x1, right y)."""
    return (
        "<lines>"
        + "".join(
            f'<line><point x="{x0}" y="{a}"/><point x="{x1}" y="{b}"/></line>'
            for a, b in zip(ys_left, ys_right, strict=True)
        )
        + "</lines>"
    )


def geometry_system(*staves: str) -> str:
    return (
        "<system>" + "<part>" + "".join(f"<staff>{s}</staff>" for s in staves) + "</part></system>"
    )


def five(top: float, step: float = 10.0) -> list[float]:
    return [top + step * i for i in range(5)]


def test_system_geometry_reads_the_edges_and_the_outer_staff_lines(fixture_xml: str) -> None:
    geometry = parse_omr_systems(fixture_xml, page_index=3)
    assert (geometry.page_index, geometry.image_width, geometry.image_height) == (3, 2000, 2800)
    first, second = geometry.systems
    assert (first.left, first.right) == (150, 1850)
    assert [(s.top, s.bottom) for s in first.staves] == [(400, 560)]
    assert [(s.top, s.bottom) for s in second.staves] == [(1000, 1160)]
    assert first.staves[0].top_line == [(150, 400), (1850, 400)]
    assert first.staves[0].bottom_line == [(150, 560), (1850, 560)]


def test_a_tilted_staff_keeps_its_points_sorted_and_its_extent_is_the_extreme() -> None:
    staff = lines_xml(five(470), five(460), 200, 900)
    xml = sheet_xml(geometry_system(staff))
    system = parse_omr_systems(xml, 0).systems[0]
    assert (system.left, system.right) == (200, 900)
    assert system.staves[0].top_line == [(200, 470), (900, 460)]
    assert (system.staves[0].top, system.staves[0].bottom) == (460, 510)


def test_points_out_of_order_are_sorted_by_x() -> None:
    reversed_line = '<lines><line><point x="900" y="5"/><point x="100" y="4"/></line></lines>'
    system = parse_omr_systems(sheet_xml(geometry_system(reversed_line)), 0).systems[0]
    assert system.staves[0].top_line == [(100, 4), (900, 5)]
    assert (system.left, system.right) == (100, 900)


def test_a_system_with_two_staves_lists_both_top_first() -> None:
    upper = lines_xml(five(100), five(100), 150, 1000)
    lower = lines_xml(five(300), five(300), 120, 1100)
    system = parse_omr_systems(sheet_xml(geometry_system(upper, lower)), 0).systems[0]
    assert [(s.top, s.bottom) for s in system.staves] == [(100, 140), (300, 340)]
    assert (system.left, system.right) == (120, 1100)  # the widest staff sets the system


def test_a_staff_without_lines_is_skipped_but_its_neighbour_counts() -> None:
    empty = "<lines/>"
    lower = lines_xml(five(300), five(300), 0, 100)
    system = parse_omr_systems(sheet_xml(geometry_system(empty, lower)), 0).systems[0]
    assert [(s.top, s.bottom) for s in system.staves] == [(300, 340)]


def test_a_staff_with_one_line_has_the_same_top_and_bottom() -> None:
    one = lines_xml([50], [50], 0, 100)
    staff = parse_omr_systems(sheet_xml(geometry_system(one)), 0).systems[0].staves[0]
    assert (staff.top, staff.bottom) == (50, 50)


def test_a_system_with_no_staff_lines_raises_value_error() -> None:
    with pytest.raises(ValueError, match="no staff lines"):
        parse_omr_systems(sheet_xml(geometry_system("<lines/>")), 0)
    with pytest.raises(ValueError, match="no staff lines"):
        parse_omr_systems(sheet_xml("<system/>"), 0)


def test_a_page_with_no_systems_has_empty_geometry() -> None:
    assert parse_omr_systems(sheet_xml(), 0).systems == []


def test_systems_come_in_the_same_order_as_parse_omr_sheet() -> None:
    low = system_xml(500, 600, [(2, 0, 100)])
    high = system_xml(100, 200, [(1, 0, 100)])
    xml = sheet_xml(low, high)
    tops = [system.staves[0].top for system in parse_omr_systems(xml, 0).systems]
    assert tops == [system.top for system in parse_omr_sheet(xml, 0).systems] == [100, 500]


@pytest.mark.parametrize(
    "xml",
    [
        "",
        "<score/>",
        "<sheet><page/></sheet>",
        "<sheet><picture width='x' height='9'/></sheet>",
        sheet_xml(geometry_system("<lines><line><point x='1'/></line></lines>")),
        sheet_xml(geometry_system("<lines><line><point y='1'/></line></lines>")),
    ],
    ids=["empty", "wrong-root", "no-picture", "bad-width", "point-without-y", "point-without-x"],
)
def test_malformed_geometry_input_raises_value_error(xml: str) -> None:
    with pytest.raises(ValueError):
        parse_omr_systems(xml, 0)


# --- read_omr_ink ------------------------------------------------------------------------------


def png_bytes(pixels: np.ndarray, mode: str = "L") -> bytes:
    """A PNG of a boolean array, dark where True."""
    gray = np.where(pixels, 0, 255).astype(np.uint8)
    image = Image.fromarray(gray).convert(mode)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def write_book(path: Path, pages: dict[int, tuple[str, bytes | None]]) -> None:
    with zipfile.ZipFile(path, "w") as book:
        for number, (xml, binary) in pages.items():
            book.writestr(f"sheet#{number}/sheet#{number}.xml", xml)
            if binary is not None:
                book.writestr(f"sheet#{number}/BINARY.png", binary)


def small_sheet(width: int, height: int) -> str:
    return f'<sheet><picture width="{width}" height="{height}"/><page id="1"/></sheet>'


def test_ink_is_the_dark_pixels_of_each_sheets_binary_image(tmp_path: Path) -> None:
    ink = np.zeros((6, 10), dtype=bool)
    ink[2, 3:7] = True
    ink[:, 0] = True
    book = tmp_path / "part.omr"
    write_book(book, {1: (small_sheet(10, 6), png_bytes(ink))})
    pages = read_omr_ink(book)
    assert list(pages) == [1]
    assert pages[1].dtype == bool and pages[1].shape == (6, 10)
    assert np.array_equal(pages[1], ink)


def test_a_one_bit_image_reads_the_same_as_a_gray_one(tmp_path: Path) -> None:
    ink = np.zeros((4, 8), dtype=bool)
    ink[1, :] = True
    book = tmp_path / "part.omr"
    write_book(book, {1: (small_sheet(8, 4), png_bytes(ink, mode="1"))})
    assert np.array_equal(read_omr_ink(book)[1], ink)


def test_ink_is_keyed_by_sheet_number_and_skips_sheets_without_an_image(tmp_path: Path) -> None:
    ink = np.ones((2, 2), dtype=bool)
    book = tmp_path / "part.omr"
    write_book(
        book,
        {
            1: (small_sheet(2, 2), None),
            2: (small_sheet(2, 2), png_bytes(ink)),
            11: (small_sheet(2, 2), png_bytes(ink)),
        },
    )
    assert sorted(read_omr_ink(book)) == [2, 11]


def test_a_book_with_no_images_has_no_ink(tmp_path: Path) -> None:
    book = tmp_path / "part.omr"
    write_book(book, {1: (small_sheet(2, 2), None)})
    assert read_omr_ink(book) == {}


def test_an_image_that_does_not_match_the_sheets_size_raises_value_error(tmp_path: Path) -> None:
    book = tmp_path / "part.omr"
    write_book(book, {1: (small_sheet(10, 6), png_bytes(np.zeros((5, 10), dtype=bool)))})
    with pytest.raises(ValueError, match="size"):
        read_omr_ink(book)


def test_an_image_that_is_not_a_png_raises_value_error(tmp_path: Path) -> None:
    book = tmp_path / "part.omr"
    write_book(book, {1: (small_sheet(2, 2), b"not a png")})
    with pytest.raises(ValueError, match="page image"):
        read_omr_ink(book)


def test_a_file_that_is_not_a_book_raises_value_error(tmp_path: Path) -> None:
    junk = tmp_path / "part.omr"
    junk.write_bytes(b"junk")
    with pytest.raises(ValueError):
        read_omr_ink(junk)


# --- what a stack holds ------------------------------------------------------------------------


def content_sheet(*stacks: str) -> str:
    """A one-system sheet whose stacks are the given <stack .../> tags."""
    staff = lines_xml(five(100.0), five(100.0), 0.0, 1000.0)
    return (
        '<sheet><picture width="2000" height="2800"/><page id="1"><system>'
        f"{''.join(stacks)}<part><staff>{staff}</staff></part></system></page></sheet>"
    )


def test_a_stack_says_the_duration_its_measure_should_hold_and_the_duration_it_does() -> None:
    xml = content_sheet(
        '<stack id="1" left="0" right="400" expected="3/4" duration="9/8" excess="3/8"/>',
        '<stack id="2" left="400" right="800" expected="1" duration="0" special="CAUTIONARY"/>',
    )
    first, second = parse_omr_sheet(xml, 0).systems[0].measures
    assert (first.expected, first.duration) == (Fraction(3, 4), Fraction(9, 8))
    assert (second.expected, second.duration) == (Fraction(1), Fraction(0))


def test_a_stack_without_durations_leaves_them_unknown() -> None:
    (measure,) = (
        parse_omr_sheet(content_sheet('<stack id="1" left="0" right="400"/>'), 0)
        .systems[0]
        .measures
    )
    assert (measure.expected, measure.duration) == (None, None)


@pytest.mark.parametrize("text", ["n/a", "1/0", "", "x"])
def test_a_duration_that_cannot_be_read_is_unknown(text: str) -> None:
    xml = content_sheet(f'<stack id="1" left="0" right="400" expected="1" duration="{text}"/>')
    (measure,) = parse_omr_sheet(xml, 0).systems[0].measures
    assert (measure.expected, measure.duration) == (Fraction(1), None)


# --- omr_lines ---------------------------------------------------------------------------------


def test_the_lines_pair_each_system_with_its_geometry_page_after_page(fixture_xml: str) -> None:
    pages = [parse_omr_sheet(fixture_xml, index) for index in (0, 1)]
    geometries = [parse_omr_systems(fixture_xml, index) for index in (0, 1)]
    lines = omr_lines(pages, geometries)
    assert [(line.page, line.size) for line in lines] == [(0, (2000, 2800))] * 2 + [
        (1, (2000, 2800))
    ] * 2
    assert all(isinstance(line, OmrLine) for line in lines)
    assert lines[1].system.top == 1000 and lines[1].geometry.staves[0].top == 1000


def test_pages_are_paired_by_page_index_not_by_position(fixture_xml: str) -> None:
    pages = [parse_omr_sheet(fixture_xml, 1), parse_omr_sheet(fixture_xml, 0)]
    geometries = [parse_omr_systems(fixture_xml, 0), parse_omr_systems(fixture_xml, 1)]
    assert [line.page for line in omr_lines(pages, geometries)] == [0, 0, 1, 1]


def test_a_page_without_geometry_or_with_another_system_count_raises_value_error(
    fixture_xml: str,
) -> None:
    page = parse_omr_sheet(fixture_xml, 0)
    geometry = parse_omr_systems(fixture_xml, 0)
    with pytest.raises(ValueError, match="page 0"):
        omr_lines([page], [])
    short = geometry.model_copy(update={"systems": geometry.systems[:1]})
    with pytest.raises(ValueError, match="page 0"):
        omr_lines([page], [short])


# --- the opening block: clef, key and time signature -------------------------------------------

SPACE = 10.0  # staff space of the sheets below: five lines 10 px apart


def inter_xml(tag: str, x: int, w: int, staff: int = 1, **attributes: str) -> str:
    attrs = "".join(f' {name}="{value}"' for name, value in attributes.items())
    return f'<{tag} staff="{staff}"{attrs}><bounds x="{x}" y="0" w="{w}" h="40"/></{tag}>'


def opening_sheet(
    stacks: list[tuple[float, float, str]],
    header: tuple[int, int] | None,
    inters: str = "",
) -> str:
    """One system, one staff; stacks are (left, right, extra attributes of the <stack>)."""
    stack_tags = "".join(
        f'<stack id="{i}" left="{left}" right="{right}" {extra}/>'
        for i, (left, right, extra) in enumerate(stacks, 1)
    )
    head = "" if header is None else f'<header start="{header[0]}" stop="{header[1]}"/>'
    staff = lines_xml(five(100.0, SPACE), five(100.0, SPACE), 0.0, 1000.0)
    return (
        '<sheet><picture width="2000" height="2800"/><page id="1"><system>'
        f'{stack_tags}<part><staff id="1">{staff}{head}</staff></part>'
        f"<sig><inters>{inters}</inters></sig></system></page></sheet>"
    )


CLEF_KEY_TIME = (
    inter_xml("clef", 25, 20, shape="G_CLEF")
    + inter_xml("key", 50, 15, fifths="-1")
    + inter_xml("key-alter", 50, 15, shape="FLAT")
    + inter_xml("time-pair", 70, 20, **{"time-rational": "3/4"})
    + inter_xml("time-number", 70, 20, value="3")
)


def test_the_header_stop_is_where_the_opening_block_ends() -> None:
    xml = opening_sheet([(10, 400, ""), (400, 800, "")], header=(10, 92), inters=CLEF_KEY_TIME)
    (system,) = parse_omr_sheet(xml, 0).systems
    assert system.header_stop == 92


def test_a_system_with_two_staves_stops_at_the_wider_header() -> None:
    staff = lines_xml(five(100.0, SPACE), five(100.0, SPACE), 0.0, 1000.0)
    lower = lines_xml(five(300.0, SPACE), five(300.0, SPACE), 0.0, 1000.0)
    xml = (
        '<sheet><picture width="2000" height="2800"/><page id="1"><system>'
        '<stack id="1" left="10" right="400"/><part>'
        f'<staff id="1">{staff}<header start="10" stop="60"/></staff>'
        f'<staff id="2">{lower}<header start="10" stop="75"/></staff>'
        "</part></system></page></sheet>"
    )
    assert parse_omr_sheet(xml, 0).systems[0].header_stop == 75


def test_a_system_without_a_header_has_no_header_stop() -> None:
    xml = opening_sheet([(10, 400, "")], header=None, inters=CLEF_KEY_TIME)
    assert parse_omr_sheet(xml, 0).systems[0].header_stop is None


def test_the_opening_names_the_clef_key_and_time_inside_the_header() -> None:
    xml = opening_sheet([(10, 400, "")], header=(10, 92), inters=CLEF_KEY_TIME)
    assert parse_omr_sheet(xml, 0).systems[0].opening == [
        "0:clef:G_CLEF",
        "0:key:-1",
        "0:time:3/4",
    ]


def test_an_inter_past_the_header_is_not_part_of_the_opening() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 800, "")],
        header=(10, 70),
        inters=inter_xml("clef", 25, 20, shape="G_CLEF") + inter_xml("key", 410, 15, fifths="2"),
    )
    assert parse_omr_sheet(xml, 0).systems[0].opening == ["0:clef:G_CLEF"]


def test_a_key_without_fifths_is_named_by_its_shape() -> None:
    xml = opening_sheet(
        [(10, 400, "")],
        header=(10, 70),
        inters=inter_xml("clef", 25, 20, shape="G_CLEF")
        + inter_xml("key", 50, 15, shape="KEY_CANCEL"),
    )
    assert parse_omr_sheet(xml, 0).systems[0].opening == ["0:clef:G_CLEF", "0:key:KEY_CANCEL"]


def test_a_measure_that_starts_with_a_signature_says_where_it_ends() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 800, ""), (800, 1200, "")],
        header=(10, 70),
        inters=inter_xml("clef", 25, 20, shape="G_CLEF")
        + inter_xml("time-whole", 407, 30, **{"time-rational": "3/4"}),
    )
    first, second, third = parse_omr_sheet(xml, 0).systems[0].measures
    assert (first.block_right, second.block_right, third.block_right) == (45, 437, None)


def test_a_clef_key_and_time_in_a_row_make_one_block() -> None:
    inters = (
        inter_xml("clef", 405, 20, shape="G_CLEF")
        + inter_xml("key", 430, 15, fifths="1")
        + inter_xml("time-pair", 450, 20, **{"time-rational": "6/8"})
    )
    xml = opening_sheet([(10, 400, ""), (400, 800, "")], header=None, inters=inters)
    assert parse_omr_sheet(xml, 0).systems[0].measures[1].block_right == 470


def test_a_signature_far_from_the_bar_line_is_not_the_start_of_the_measure() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 800, "")],
        header=None,
        inters=inter_xml("clef", 560, 20, shape="G_CLEF"),
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[1].block_right is None


def test_a_courtesy_stack_never_starts_with_a_printed_signature() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 480, 'special="CAUTIONARY"')],
        header=None,
        inters=inter_xml("key", 410, 15, fifths="2"),
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[1].block_right is None


def test_note_shapes_and_alterations_are_not_a_signature() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 800, "")],
        header=None,
        inters=inter_xml("key-alter", 405, 15, shape="SHARP") + inter_xml("head", 410, 20),
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[1].block_right is None


def test_a_signature_that_ends_before_the_bar_line_is_the_previous_measures() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 800, "")],
        header=None,
        inters=inter_xml("key", 385, 14, fifths="2"),
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[1].block_right is None


def test_a_stack_says_where_the_last_key_or_time_signature_in_it_ends() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 480, 'special="CAUTIONARY"')],
        header=None,
        inters=inter_xml("clef", 25, 20, shape="G_CLEF")
        + inter_xml("key", 410, 15, fifths="2")
        + inter_xml("time-whole", 440, 30, **{"time-rational": "3/4"}),
    )
    first, second = parse_omr_sheet(xml, 0).systems[0].measures
    assert (first.signed_to, second.signed_to) == (None, 470)


def test_a_clef_is_not_a_signature_a_stack_is_signed_by() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 480, "")],
        header=None,
        inters=inter_xml("clef", 410, 20, shape="G_CLEF"),
    )
    assert parse_omr_sheet(xml, 0).systems[0].measures[1].signed_to is None


def test_a_signature_that_belongs_to_the_next_stack_does_not_sign_this_one() -> None:
    xml = opening_sheet(
        [(10, 400, ""), (400, 800, "")],
        header=None,
        inters=inter_xml("key", 410, 15, fifths="2"),
    )
    first, second = parse_omr_sheet(xml, 0).systems[0].measures
    assert (first.signed_to, second.signed_to) == (None, 425)
