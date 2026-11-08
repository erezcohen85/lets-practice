import io
import math
from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.pipeline.omr import OmrLine

# One picture per line (system) of the part, for the score reader.
#
# A model that is shown a whole page miscounts the measures of a crowded line. Shown one line at
# a time, at the pixels Audiveris worked from, it counts better, and every picture is a known
# system of the .omr, so a reading maps onto the systems one to one. A crop is the full page width
# and the rows from CROP_MARGIN staff heights above the system's top staff line to CROP_MARGIN
# staff heights below its bottom one (room for the bar number, the tempo words and the fermatas),
# clamped to the page and to halfway to the neighbouring system, so that a crowded page (a piano
# score, whose systems sit close) does not show the reader pieces of the lines above and below,
# which it would report as lines of their own. The page is the binarised image in the .omr, so
# crop and Audiveris share pixels.

CROP_MARGIN = 2.5  # staff heights above and below the system


@dataclass(frozen=True)
class LineCrop:
    """The picture of one system: where it sits on the page and the PNG bytes."""

    page: int  # the caller's page index
    system_index: int  # 0-based over the whole part, page after page
    rows: tuple[int, int]  # the page rows [first, end) the crop covers
    png: bytes

    @property
    def label(self) -> str:
        """What the reader is told: pages and lines count from 1, lines over the whole part."""
        return f"page {self.page + 1}, line {self.system_index + 1}"


def crop_rows(
    line: OmrLine, page_height: int, above: float | None = None, below: float | None = None
) -> tuple[int, int]:
    """The page rows [first, end) of a system's crop.

    The margin is CROP_MARGIN heights of the first staff; the crop reaches from the highest top
    line to the lowest bottom line of the system's staves (a system with two staves holds both).
    `above` is the last row of the system above on the page and `below` the first row of the one
    below: the crop does not go past halfway to either.
    """
    staves = line.geometry.staves
    margin = CROP_MARGIN * (staves[0].bottom - staves[0].top)
    top = min(staff.top for staff in staves)
    bottom = max(staff.bottom for staff in staves)
    first = max(0, math.floor(top - margin))
    end = min(page_height, math.ceil(bottom + margin))
    if above is not None:
        first = max(first, math.ceil((above + top) / 2))
    if below is not None:
        end = min(end, math.floor((bottom + below) / 2))
    return first, end


def _png(ink: np.ndarray) -> bytes:
    """A (height, width) boolean ink array as a grey PNG: black ink on white."""
    buffer = io.BytesIO()
    Image.fromarray(np.where(ink, 0, 255).astype(np.uint8), "L").save(buffer, format="PNG")
    return buffer.getvalue()


def line_crops(lines: list[OmrLine], images: dict[int, np.ndarray]) -> list[LineCrop]:
    """A crop for every system, in reading order. `images` is the ink of each page by page index.

    Raises ValueError for a page with no image.
    """
    crops = []
    for index, line in enumerate(lines):
        page = images.get(line.page)
        if page is None:
            raise ValueError(
                f"the score has no page image for page {line.page + 1}, so its lines cannot "
                "be cut out"
            )
        above, below = _neighbours(lines, index)
        first, end = crop_rows(line, page.shape[0], above, below)
        crops.append(LineCrop(line.page, index, (first, end), _png(page[first:end])))
    return crops


def _neighbours(lines: list[OmrLine], index: int) -> tuple[float | None, float | None]:
    """The last row of the system above and the first row of the one below, on the same page."""
    line = lines[index]
    above = below = None
    if index > 0 and lines[index - 1].page == line.page:
        above = max(staff.bottom for staff in lines[index - 1].geometry.staves)
    if index + 1 < len(lines) and lines[index + 1].page == line.page:
        below = min(staff.top for staff in lines[index + 1].geometry.staves)
    return above, below
