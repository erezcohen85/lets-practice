"""A synthetic Audiveris book for the structure-read tests: sheets, page ink and an engine."""

import io
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

from app.pipeline.audiveris import OmrBook
from app.pipeline.score_reader import Reading, ReadLine, ReadMeasure
from app.pipeline.structure import blank_measure
from tests.barline_fixtures import HEIGHT, SPACE, WIDTH, blank_page, draw_bar, draw_staff

LEFT, RIGHT = 50, 950  # the staff's extent on the 1000 x 600 page
TOPS = (100, 350)  # the first staff line of the first and second system on a page


def system_xml(
    top: int,
    count: int,
    first_id: int,
    signature: str | None = None,
    repeats: dict[int, str] | None = None,
    stack_attrs: dict[int, str] | None = None,
) -> str:
    """A system of `count` equal measures on one staff; the first prints `signature` (a/b).

    `stack_attrs` adds raw attributes to the stack of a measure, e.g. {0: 'special="PICKUP"'}."""
    width = (RIGHT - LEFT) / count
    repeats = repeats or {}
    ids = range(first_id, first_id + count)
    stacks = "".join(
        f'<stack id="{i}" left="{LEFT + width * k}" right="{LEFT + width * (k + 1)}"'
        + (f' repeat="{repeats[k]}"' if k in repeats else "")
        + (f" {(stack_attrs or {})[k]}" if k in (stack_attrs or {}) else "")
        + "/>"
        for k, i in enumerate(ids)
    )
    measures = "".join(
        f'<measure id="{i}"><times>900</times></measure>'
        if signature and k == 0
        else f'<measure id="{i}"/>'
        for k, i in enumerate(ids)
    )
    inters = ""
    if signature:
        top_number, bottom = signature.split("/")
        inters = f'<time-pair id="900" shape="TIME_CUSTOM" time-rational="{top_number}/{bottom}"/>'
    lines = "".join(
        f'<line><point x="{LEFT}" y="{y}"/><point x="{RIGHT}" y="{y}"/></line>'
        for y in (top, top + 4 * SPACE)
    )
    return (
        f"<system>{stacks}<part><staff><lines>{lines}</lines></staff>{measures}</part>"
        f"<sig><inters>{inters}</inters></sig></system>"
    )


def sheet_xml(*systems: str) -> str:
    return (
        f'<sheet><picture width="{WIDTH}" height="{HEIGHT}"/>'
        f'<page id="1">{"".join(systems)}</page></sheet>'
    )


def ink_of(*counts: int) -> np.ndarray:
    """The page image of systems with `counts` measures: staves and the inner bar lines."""
    page = blank_page()
    for top, count in zip(TOPS, counts, strict=False):
        draw_staff(page, top)
        for k in range(1, count):
            draw_bar(page, round(LEFT + (RIGHT - LEFT) * k / count), top)
    return page


def png(ink: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(np.where(ink, 0, 255).astype(np.uint8)).save(buffer, format="PNG")
    return buffer.getvalue()


class BookEngine:
    """An OmrEngine that writes the given sheets (and page images) as a real .omr zip."""

    def __init__(
        self,
        sheets: dict[int, str],
        ink: dict[int, np.ndarray] | None = None,
    ) -> None:
        self.sheets = sheets  # by Audiveris sheet number
        self.ink = ink or {}

    def run(self, pdf: Path, out_dir: Path) -> OmrBook:
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{pdf.stem}.omr"
        with zipfile.ZipFile(path, "w") as book:
            for number, xml in self.sheets.items():
                book.writestr(f"sheet#{number}/sheet#{number}.xml", xml)
                if number in self.ink:
                    book.writestr(f"sheet#{number}/BINARY.png", png(self.ink[number]))
        numbers = sorted(self.sheets)
        return OmrBook(path, [self.sheets[n] for n in numbers], numbers)


# --- readings as the score reader gives them


def measure(**changes: object) -> ReadMeasure:
    return blank_measure().model_copy(update=changes)


def line(count: int, number: int | None = None, **first: object) -> ReadLine:
    measures = [measure(**first)] + [measure() for _ in range(count - 1)]
    return ReadLine(page=1, printed_start_number=number, measures=measures)


def reading(*lines: ReadLine, name: str | None = None) -> Reading:
    return Reading(part_name=name, lines=list(lines), doubts=[])
