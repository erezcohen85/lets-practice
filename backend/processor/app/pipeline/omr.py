import io
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import NamedTuple

import numpy as np
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app.pipeline.models import BarBox, Meter, MeterChange
from app.pipeline.play_order import MarkKind, StructureMark

# Reads the sheet#N.xml that Audiveris stores in a .omr project file (JAXB class Sheet):
#   sheet > picture@width,@height                  OMR image size in pixels
#   sheet > page > system                          page order, top to bottom
#   system > stack@id,@left,@right,@repeat         one stack per measure; repeat = LEFT, RIGHT
#   system > stack@expected,@duration              what the measure should hold and what its voices
#                                                  fill, as whole-note fractions ("3/4", "9/8", "0")
#   system > stack@special                         PICKUP where Audiveris took the first measure of
#                                                  the movement for a pickup (also CAUTIONARY, ...)
#   system > part > staff > lines > line > point    staff lines, give the system top and bottom
#   system > part > measure@id > times              IDREFs (measure id equals stack id)
#   system > sig > inters > time-whole | time-pair | time-custom @id,@time-rational
#   system > part > staff > header@stop            where the clef, key and time signature end
#   system > sig > inters > clef | key | time-*    @staff and bounds@x,@w: the pieces of a signature
# Everything else Audiveris writes (barlines, notes, ...) is ignored.
# parse_omr_systems also keeps the first and last line of every staff as (x, y) points, which the
# bar-line check needs. read_omr_ink reads sheet#N/BINARY.png, the page image Audiveris worked
# from, out of the .omr zip.

_TIME_TAGS = ("time-whole", "time-pair", "time-custom")
_SIGNATURE_TAGS = ("clef", "key", *_TIME_TAGS)  # key-alter and time-number are parts of these

# A clef, key or time signature printed at the start of a measure begins within BLOCK_REACH staff
# spaces of its bar line, and each further one within BLOCK_CHAIN of the one before.
BLOCK_REACH = 2.0
BLOCK_CHAIN = 2.0

# A piece with no printed time signature starts in this meter (same default as the PoC spike).
DEFAULT_METER = Meter(numerator=4, denominator=4)


class OmrMeasure(BaseModel):
    """One measure in OMR image pixels; time_signature is set only where one is printed.

    block_right is the right edge of the clef, key and time signature printed at the start of the
    measure, None where none is. signed_to is the right edge of the last key or time signature
    Audiveris found inside the column wherever it sits (a courtesy signature that ends a line
    sits in a column of its own), None where it found none.

    expected and duration are whole-note fractions, None where Audiveris did not say: a column
    that holds less than it should is a measure cut by a false bar line, or a pickup or an
    incomplete bar (special is "PICKUP" where Audiveris itself called the first measure one).
    """

    left: float
    right: float
    expected: Fraction | None = None
    duration: Fraction | None = None
    special: str | None = None
    time_signature: Meter | None = None
    repeat_start: bool = False
    repeat_end: bool = False
    block_right: float | None = None
    signed_to: float | None = None


class OmrSystem(BaseModel):
    """One system: its vertical extent and its measures from left to right.

    header_stop is where the opening block (clef, key, time) of the line ends, None where Audiveris
    gave no header. opening names what that block holds, staff by staff, like "0:key:-1".
    """

    top: float
    bottom: float
    measures: list[OmrMeasure]
    header_stop: float | None = None
    opening: list[str] = Field(default_factory=list)


class OmrPage(BaseModel):
    """One scanned page as the OMR saw it: image size in pixels and its systems top to bottom."""

    page_index: int
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    systems: list[OmrSystem]


def _number(element: ET.Element, name: str, what: str) -> float:
    raw = element.get(name)
    if raw is None:
        raise ValueError(f"{what} has no {name} attribute")
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{what} has {name}={raw!r}, which is not a number") from None
    if not math.isfinite(value):
        raise ValueError(f"{what} has {name}={raw!r}, which is not a finite number")
    return value


def _parse_meter(inter: ET.Element) -> Meter:
    text = inter.get("time-rational")
    label = f"time signature {inter.get('id')}"
    if text is None:
        raise ValueError(f"{label} has no time-rational attribute")
    parts = text.split("/")
    if len(parts) != 2:
        raise ValueError(f"{label} has time-rational={text!r}, expected like 3/4")
    try:
        return Meter(numerator=int(parts[0]), denominator=int(parts[1]))
    except ValueError as error:
        raise ValueError(f"{label} has time-rational={text!r}: {error}") from error


def _fraction(stack: ET.Element, name: str) -> Fraction | None:
    """A duration like "1/2", "9/8" or "0"; None when missing or unreadable."""
    try:
        return None if (text := stack.get(name)) is None else Fraction(text)
    except (ValueError, ZeroDivisionError):
        return None


def _printed_meters(system: ET.Element) -> dict[str, Meter]:
    """Map measure (stack) id to the first time signature that measure refers to."""
    inters = {
        inter.get("id"): inter
        for inter in system.iterfind("sig/inters/*")
        if inter.tag in _TIME_TAGS and inter.get("id") is not None
    }
    meters: dict[str, Meter] = {}
    for measure in system.iterfind("part/measure"):
        measure_id = measure.get("id")
        if measure_id is None or measure_id in meters:
            continue
        for ref in (measure.findtext("times") or "").split():
            if (inter := inters.get(ref)) is not None:  # a dangling reference is skipped
                meters[measure_id] = _parse_meter(inter)
                break
    return meters


def _staff_line_ys(system: ET.Element, label: str) -> list[float]:
    """Every staff line point's y in the system; the extent and the page order come from these."""
    ys = [
        _number(point, "y", f"{label} staff line point")
        for point in system.iterfind("part/staff/lines/line/point")
    ]
    if not ys:
        raise ValueError(f"{label} has no staff lines")
    return ys


SIGNATURE_SLACK = 5  # px: a signature this far outside a column's edge still belongs to it


class _Signature(NamedTuple):
    """One clef, key or time signature: what it is, on which staff, and its x extent."""

    staff: str | None
    kind: str
    value: str
    left: float
    right: float


def _signatures(system: ET.Element) -> list[_Signature]:
    found: list[_Signature] = []
    for inter in system.iterfind("sig/inters/*"):
        bounds = inter.find("bounds")
        if inter.tag not in _SIGNATURE_TAGS or bounds is None:
            continue
        label = f"{inter.tag} {inter.get('id', '?')}"
        left = _number(bounds, "x", label)
        kind = "time" if inter.tag in _TIME_TAGS else inter.tag
        value = {
            "clef": inter.get("shape"),
            "key": inter.get("fifths") or inter.get("shape"),
            "time": inter.get("time-rational"),
        }[kind]
        found.append(
            _Signature(
                inter.get("staff"), kind, value or "?", left, left + _number(bounds, "w", label)
            )
        )
    return sorted(found, key=lambda item: item.left)


def _staff_space(system: ET.Element) -> float | None:
    """The distance between staff lines, from the first staff's outer lines; None if unknown."""
    lines = system.findall("part/staff/lines/line")
    if len(lines) < 2:
        return None
    ys = [[_number(p, "y", "staff line point") for p in line.iter("point")] for line in lines]
    if not all(ys):
        return None
    return (sum(ys[-1]) / len(ys[-1]) - sum(ys[0]) / len(ys[0])) / (len(lines) - 1)


def _block_right(signatures: list[_Signature], left: float, space: float) -> float | None:
    """The right edge of the signatures that follow `left` closely, one after the other."""
    right: float | None = None
    for item in signatures:
        if right is None:
            if not (item.right > left and left - space < item.left <= left + BLOCK_REACH * space):
                continue
        elif item.left - right > BLOCK_CHAIN * space:
            break
        right = max(right or item.right, item.right)
    return right


def _signed_to(signatures: list[_Signature], left: float, right: float) -> float | None:
    """The right edge of the last key or time signature that lies inside the column, if any."""
    inside = [
        item.right
        for item in signatures
        if item.kind != "clef" and left - SIGNATURE_SLACK <= item.left < right
    ]
    return max(inside) if inside else None


def _header_stop(system: ET.Element) -> float | None:
    stops = [
        _number(header, "stop", "staff header")
        for header in system.iterfind("part/staff/header")
        if header.get("stop") is not None
    ]
    return max(stops) if stops else None


def _opening(system: ET.Element, signatures: list[_Signature], stop: float | None) -> list[str]:
    """What the header holds, e.g. ["0:clef:G_CLEF", "0:key:-1"], staff by staff."""
    if stop is None:
        return []
    ranks = {staff.get("id"): rank for rank, staff in enumerate(system.iterfind("part/staff"))}
    inside = [item for item in signatures if item.left < stop]
    order = ("clef", "key", "time")
    inside.sort(key=lambda item: (ranks.get(item.staff, 0), order.index(item.kind), item.left))
    return [f"{ranks.get(item.staff, 0)}:{item.kind}:{item.value}" for item in inside]


def _parse_system(system: ET.Element) -> OmrSystem:
    label = f"system {system.get('id', '?')}"
    ys = _staff_line_ys(system, label)
    meters = _printed_meters(system)
    signatures = _signatures(system)
    space = _staff_space(system)
    measures: list[OmrMeasure] = []
    for stack in system.findall("stack"):
        stack_label = f"{label} stack {stack.get('id', '?')}"
        left = _number(stack, "left", stack_label)
        right = _number(stack, "right", stack_label)
        if right <= left:
            raise ValueError(f"{stack_label} runs from {left} to {right}, which has no width")
        sides = (stack.get("repeat") or "").split()
        measures.append(
            OmrMeasure(
                left=left,
                right=right,
                expected=_fraction(stack, "expected"),
                duration=_fraction(stack, "duration"),
                special=stack.get("special"),
                time_signature=meters.get(stack.get("id") or ""),
                repeat_start="LEFT" in sides,
                repeat_end="RIGHT" in sides,
                # a courtesy signature at the end of a line is not the start of anything
                block_right=(
                    None
                    if space is None or stack.get("special") == "CAUTIONARY"
                    else _block_right(signatures, left, space)
                ),
                signed_to=_signed_to(signatures, left, right),
            )
        )
    measures.sort(key=lambda measure: measure.left)
    stop = _header_stop(system)
    return OmrSystem(
        top=min(ys),
        bottom=max(ys),
        measures=measures,
        header_stop=stop,
        opening=_opening(system, signatures, stop),
    )


def _sheet_root(xml_text: str) -> tuple[ET.Element, ET.Element]:
    """The <sheet> element and its <picture>, or a ValueError saying what is wrong."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as error:
        raise ValueError(f"OMR output is not valid XML: {error}") from error
    if root.tag != "sheet":
        raise ValueError(f"OMR output must be a <sheet> document, got <{root.tag}>")
    picture = root.find("picture")
    if picture is None:
        raise ValueError("OMR sheet has no <picture> element with the image size")
    return root, picture


def parse_omr_sheet(xml_text: str, page_index: int) -> OmrPage:
    """Parse one Audiveris sheet XML into systems and measures, in OMR image pixels."""
    root, picture = _sheet_root(xml_text)
    systems = [_parse_system(system) for system in root.findall("page/system")]
    systems.sort(key=lambda system: system.top)
    return OmrPage(
        page_index=page_index,
        image_width=int(_number(picture, "width", "picture")),
        image_height=int(_number(picture, "height", "picture")),
        systems=systems,
    )


class OmrStaff(BaseModel):
    """One staff as its first and last line, each a polyline of (x, y) points sorted by x.

    The lines are not level on a skewed scan, so the bar-line check reads y at a given x.
    """

    top_line: list[tuple[float, float]]
    bottom_line: list[tuple[float, float]]

    @property
    def top(self) -> float:
        return min(y for _, y in self.top_line)

    @property
    def bottom(self) -> float:
        return max(y for _, y in self.bottom_line)


class OmrSystemGeometry(BaseModel):
    """One system's horizontal extent and its staves, top to bottom as Audiveris lists them."""

    left: float
    right: float
    staves: list[OmrStaff]


class OmrPageGeometry(BaseModel):
    """The systems of one page in the same order as `parse_omr_sheet` gives them."""

    page_index: int
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    systems: list[OmrSystemGeometry]


def _line_points(line: ET.Element, label: str) -> list[tuple[float, float]]:
    return sorted(
        (_number(point, "x", f"{label} point"), _number(point, "y", f"{label} point"))
        for point in line.iter("point")
    )


def _parse_system_geometry(system: ET.Element) -> tuple[float, OmrSystemGeometry]:
    """The system's geometry and its top y (the page-order key `parse_omr_sheet` also uses)."""
    label = f"system {system.get('id', '?')}"
    top = min(_staff_line_ys(system, label))
    staves: list[OmrStaff] = []
    for staff in system.findall("part/staff"):
        lines = staff.findall("lines/line")
        if lines:  # a staff Audiveris gave no lines cannot be placed, so it is left out
            staves.append(
                OmrStaff(
                    top_line=_line_points(lines[0], label),
                    bottom_line=_line_points(lines[-1], label),
                )
            )
    xs = [x for staff in staves for line in (staff.top_line, staff.bottom_line) for x, _ in line]
    return top, OmrSystemGeometry(left=min(xs), right=max(xs), staves=staves)


def parse_omr_systems(xml_text: str, page_index: int) -> OmrPageGeometry:
    """Parse the staff geometry of each system of one Audiveris sheet XML, in image pixels."""
    root, picture = _sheet_root(xml_text)
    found = [_parse_system_geometry(system) for system in root.findall("page/system")]
    found.sort(key=lambda item: item[0])
    return OmrPageGeometry(
        page_index=page_index,
        image_width=int(_number(picture, "width", "picture")),
        image_height=int(_number(picture, "height", "picture")),
        systems=[geometry for _, geometry in found],
    )


@dataclass(frozen=True)
class OmrLine:
    """One system with what the pixel rules need: its measure columns and its staves.

    `page` is the caller's page index (the one `OmrPage.page_index` carries) and `size` the OMR
    image's (width, height), the pixels every coordinate here is in.
    """

    page: int
    size: tuple[int, int]
    system: OmrSystem
    geometry: OmrSystemGeometry


def omr_lines(pages: list[OmrPage], geometries: list[OmrPageGeometry]) -> list[OmrLine]:
    """Every system of the part in reading order, each with its geometry (pages by page index)."""
    by_page = {geometry.page_index: geometry for geometry in geometries}
    lines: list[OmrLine] = []
    for page in sorted(pages, key=lambda page: page.page_index):
        geometry = by_page.get(page.page_index)
        if geometry is None or len(geometry.systems) != len(page.systems):
            raise ValueError(f"page {page.page_index} has no staff geometry for its systems")
        size = (page.image_width, page.image_height)
        lines += [
            OmrLine(page.page_index, size, system, staves)
            for system, staves in zip(page.systems, geometry.systems, strict=True)
        ]
    return lines


_BINARY_IMAGE = re.compile(r"sheet#(\d+)/BINARY\.png")
_INK_BELOW = 128  # a gray level under this is ink


def read_omr_ink(omr_path: Path) -> dict[int, np.ndarray]:
    """The page image of every sheet that has one, as a (height, width) bool array, True = ink.

    Keyed by Audiveris sheet number. The bar-line check looks at these pixels, which are what
    Audiveris saw, to settle where its own measure columns disagree with the page.
    """
    try:
        book = zipfile.ZipFile(omr_path)
    except (zipfile.BadZipFile, OSError) as error:
        raise ValueError(
            f"{Path(omr_path).name} is not a readable Audiveris book: {error}"
        ) from error
    pages: dict[int, np.ndarray] = {}
    with book:
        for name in book.namelist():
            if (found := _BINARY_IMAGE.fullmatch(name)) is None:
                continue
            number = int(found[1])
            _, picture = _sheet_root(
                book.read(f"sheet#{number}/sheet#{number}.xml").decode("utf-8")
            )
            expected = (
                int(_number(picture, "height", "picture")),
                int(_number(picture, "width", "picture")),
            )
            try:
                with Image.open(io.BytesIO(book.read(name))) as image:
                    gray = np.asarray(image.convert("L"))
            except (UnidentifiedImageError, OSError) as error:
                raise ValueError(
                    f"the page image of sheet {number} cannot be read: {error}"
                ) from error
            if gray.shape != expected:
                raise ValueError(
                    f"the page image of sheet {number} has size {gray.shape[::-1]}, "
                    f"expected {expected[::-1]}"
                )
            pages[number] = gray < _INK_BELOW
    return pages


def to_bar_boxes(
    pages: list[OmrPage], target_sizes: dict[int, tuple[int, int]]
) -> tuple[list[BarBox], list[MeterChange], list[StructureMark]]:
    """Number bars 1..N in page order, scale to each target size, and list meters and repeats."""
    boxes: list[BarBox] = []
    meter_changes: list[MeterChange] = []
    marks: list[StructureMark] = []
    meter: Meter | None = None
    for page in sorted(pages, key=lambda page: page.page_index):
        size = target_sizes.get(page.page_index)
        if size is None:
            raise ValueError(f"no target image size for page {page.page_index}")
        target_width, target_height = size
        if target_width <= 0 or target_height <= 0:
            raise ValueError(
                f"target image size for page {page.page_index} must be positive, got {size}"
            )
        ow, oh = page.image_width, page.image_height
        for system in page.systems:
            for measure in system.measures:
                bar = len(boxes) + 1
                boxes.append(
                    BarBox(
                        bar=bar,
                        page_index=page.page_index,
                        x=measure.left * target_width / ow,
                        y=system.top * target_height / oh,
                        w=(measure.right - measure.left) * target_width / ow,
                        h=(system.bottom - system.top) * target_height / oh,
                    )
                )
                printed = measure.time_signature
                if printed is None and meter is None:
                    printed = DEFAULT_METER
                if printed is not None and printed != meter:
                    meter = printed
                    meter_changes.append(
                        MeterChange(
                            numerator=printed.numerator,
                            denominator=printed.denominator,
                            from_bar=bar,
                        )
                    )
                if measure.repeat_start:
                    marks.append(StructureMark(kind=MarkKind.REPEAT_START, bar=bar))
                if measure.repeat_end:
                    marks.append(StructureMark(kind=MarkKind.REPEAT_END, bar=bar))
    return boxes, meter_changes, marks
