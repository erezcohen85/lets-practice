import io
import math
from collections.abc import Sequence
from typing import Protocol, runtime_checkable

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageOps

from app.pipeline.stages import PageImage, RenderedPart
from app.storage import Storage

# Rendered score pages: the PDF renderer and its fake, the deskew, and the WebP files a part
# stores. The skew helpers are pure.

MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_PAGES = 100  # per part (Erez, 2026-11-04: was 50, 2026-11-03: was 40)
DEFAULT_DPI = 200
SMALL_PAGE_DPI = 300
# 6 in: a page this small is rendered denser to keep the staves legible.
SMALL_PAGE_SHORT_SIDE_PT = 432.0
WEBP_QUALITY = 85

# Coarse search stages before the full-resolution pass: (width in px, step in degrees).
_COARSE_STAGES = ((600, 0.5), (1000, 0.1))
_RESAMPLE = Image.Resampling.BILINEAR


def _ink(image: Image.Image) -> Image.Image:
    """Grayscale with ink high and paper low."""
    return ImageOps.invert(image.convert("L"))


def _level_score(ink: Image.Image, skew_deg: float) -> float:
    """Variance of the row sums once a page skewed by `skew_deg` is rotated back level."""
    levelled = ink.rotate(-skew_deg, resample=_RESAMPLE, expand=False, fillcolor=0)
    return float(np.asarray(levelled, dtype=np.float64).sum(axis=1).var())


def _best_angle(ink: Image.Image, candidates: np.ndarray) -> float:
    """The candidate with the sharpest staff-line peaks; ties go to the one nearest zero."""
    scores = [_level_score(ink, float(angle)) for angle in candidates]
    best = max(scores)
    tied = [float(a) for a, s in zip(candidates, scores, strict=True) if s >= best * (1 - 1e-9)]
    return min(tied, key=abs)


def _at_width(ink: Image.Image, width: int | None) -> Image.Image:
    """The ink image shrunk to `width` px (never enlarged); None keeps full resolution."""
    if width is None or width >= ink.width:
        return ink
    return ink.resize((width, max(1, round(ink.height * width / ink.width))))


def estimate_skew_deg(image: Image.Image, max_angle: float = 5.0, step: float = 0.05) -> float:
    """Angle by which the page is rotated, counter-clockwise positive (the sign Image.rotate uses).

    Projection profile: staff lines give sharp row-sum peaks only when level. Coarse searches on
    shrunken copies narrow the angle, then a full-resolution pass settles it to `step` degrees.
    A blank page gives 0.0.
    """
    if max_angle < 0 or step <= 0:
        raise ValueError("max_angle must be >= 0 and step must be > 0")
    ink = _ink(image)
    if ink.getbbox() is None:
        return 0.0

    best, reach = 0.0, max_angle
    for width, stage_step in (*_COARSE_STAGES, (None, step)):
        low, high = max(-max_angle, best - reach), min(max_angle, best + reach)
        grid = np.arange(low, high + stage_step / 2, stage_step)
        candidates = np.unique(np.append(grid, best).clip(-max_angle, max_angle))
        best = _best_angle(_at_width(ink, width), candidates)
        reach = stage_step
    return round(best, 4) + 0.0


def deskew(image: Image.Image, max_angle: float = 5.0) -> tuple[Image.Image, float]:
    """Rotate the page level; returns (corrected, angle applied to Image.rotate, the negative skew).

    The corrected image keeps the input's size, with exposed corners filled white.
    """
    skew = estimate_skew_deg(image, max_angle=max_angle)
    if skew == 0.0:
        return image.copy(), 0.0
    page = image if image.mode in ("L", "RGB", "RGBA") else image.convert("RGB")
    fill = (255,) * len(page.getbands())
    corrected = page.rotate(-skew, resample=_RESAMPLE, expand=False, fillcolor=fill)
    return corrected, -skew


class PdfPagesError(ValueError):
    """A PDF that cannot become page images; the message is one sentence for the job."""


@runtime_checkable
class PdfRenderer(Protocol):
    """Read a PDF's pages as images."""

    def page_count(self, pdf: bytes) -> int:
        """Return the number of pages; a broken or password-protected PDF raises PdfPagesError."""
        ...

    def page_size_pt(self, pdf: bytes, page_index: int) -> tuple[float, float]:
        """Return the page's (width, height) in points, 72 to the inch."""
        ...

    def render(self, pdf: bytes, page_index: int, dpi: int) -> Image.Image:
        """Return the page as an RGB image at `dpi`; page_index is 0-based."""
        ...


class PyMuPdfRenderer:
    """PdfRenderer over PyMuPDF."""

    def page_count(self, pdf: bytes) -> int:
        with _open(pdf) as document:
            return len(document)

    def page_size_pt(self, pdf: bytes, page_index: int) -> tuple[float, float]:
        with _open(pdf) as document:
            rect = document[page_index].rect
        return rect.width, rect.height

    def render(self, pdf: bytes, page_index: int, dpi: int) -> Image.Image:
        with _open(pdf) as document:
            pixmap = document[page_index].get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
        return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _open(pdf: bytes) -> pymupdf.Document:
    try:
        document = pymupdf.open(stream=pdf, filetype="pdf")
    except Exception as error:  # PyMuPDF raises several types for damaged files
        raise PdfPagesError("The score is not a readable PDF.") from error
    if document.needs_pass:
        document.close()
        raise PdfPagesError("The score PDF is password-protected; remove the password and retry.")
    return document


class FakePdfRenderer:
    """Synthetic pages: white paper with ruled five-line staves, optionally skewed.

    `skews_deg[i]` tilts page i counter-clockwise (the sign of estimate_skew_deg). The PDF bytes
    are ignored; `rendered` lists the (page_index, dpi) of each render call.
    """

    def __init__(
        self,
        sizes_pt: Sequence[tuple[float, float]],
        skews_deg: Sequence[float] | None = None,
    ) -> None:
        self._sizes = list(sizes_pt)
        self._skews = list(skews_deg) if skews_deg is not None else [0.0] * len(self._sizes)
        self.rendered: list[tuple[int, int]] = []

    def page_count(self, pdf: bytes) -> int:
        return len(self._sizes)

    def page_size_pt(self, pdf: bytes, page_index: int) -> tuple[float, float]:
        return self._sizes[page_index]

    def render(self, pdf: bytes, page_index: int, dpi: int) -> Image.Image:
        self.rendered.append((page_index, dpi))
        width_pt, height_pt = self._sizes[page_index]
        width, height = round(width_pt * dpi / 72), round(height_pt * dpi / 72)
        page = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(page)
        cx, cy = width / 2, height / 2
        angle = math.radians(self._skews[page_index])
        cos, sin = math.cos(angle), math.sin(angle)

        def tilt(x: float, y: float) -> tuple[float, float]:
            dx, dy = x - cx, y - cy
            return cx + dx * cos + dy * sin, cy - dx * sin + dy * cos

        inch, line_width = dpi, max(1, dpi // 150)
        spacing, margin = 0.06 * inch, 0.75 * inch
        top = 0.75 * inch
        while top + 4 * spacing < height - 0.75 * inch:
            for line in range(5):
                y = top + line * spacing
                draw.line(
                    [tilt(margin, y), tilt(width - margin, y)], fill="black", width=line_width
                )
            for x in (margin, width - margin):
                draw.line(
                    [tilt(x, top), tilt(x, top + 4 * spacing)], fill="black", width=line_width
                )
            top += inch
        return page


def dpi_for(width_pt: float, height_pt: float) -> int:
    """200 DPI, or 300 when the page's shorter side is under 6 in."""
    if min(width_pt, height_pt) < SMALL_PAGE_SHORT_SIDE_PT:
        return SMALL_PAGE_DPI
    return DEFAULT_DPI


def render_part(
    pdf: bytes,
    user_id: str,
    piece_id: str,
    score_file_id: str,
    storage: Storage,
    renderer: PdfRenderer,
) -> RenderedPart:
    """Render every page, level it, and store it as WebP at {user}/{piece}/{score_file}/page-<n>."""
    if len(pdf) > MAX_PDF_BYTES:
        raise PdfPagesError(f"The score PDF is larger than {MAX_PDF_BYTES // (1024 * 1024)} MB.")
    count = renderer.page_count(pdf)
    if count == 0:
        raise PdfPagesError("The score PDF has no pages.")
    if count > MAX_PAGES:
        raise PdfPagesError(f"The score PDF has more than {MAX_PAGES} pages.")

    pages: list[PageImage] = []
    angles: list[float] = []
    dpis: list[int] = []
    for index in range(count):
        dpi = dpi_for(*renderer.page_size_pt(pdf, index))
        level, applied = deskew(renderer.render(pdf, index, dpi))
        buffer = io.BytesIO()
        level.save(buffer, format="WEBP", quality=WEBP_QUALITY)
        path = f"{user_id}/{piece_id}/{score_file_id}/page-{index}.webp"
        storage.upload(path, buffer.getvalue(), "image/webp")
        pages.append(PageImage(index, level.width, level.height, path))
        angles.append(applied)
        dpis.append(dpi)
    return RenderedPart(pages=pages, angles_deg=angles, dpi=dpis)
