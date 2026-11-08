"""PDF pages: render generated PDFs with PyMuPDF, deskew, store as WebP; the fake for pure paths."""

import io
import math

import pymupdf
import pytest
from PIL import Image

from app.pipeline.pdf_pages import (
    MAX_PAGES,
    MAX_PDF_BYTES,
    FakePdfRenderer,
    PdfPagesError,
    PdfRenderer,
    PyMuPdfRenderer,
    estimate_skew_deg,
    render_part,
)
from app.pipeline.stages import PageImage
from app.storage import InMemoryStorage

LETTER = (612.0, 792.0)
SMALL = (396.0, 612.0)  # 5.5 x 8.5 in: shorter side under 6 in
LEVEL_TOLERANCE_DEG = 0.2
IDS = ("user-1", "piece-1", "score-1")


def draw_staves(page: pymupdf.Page, tilt_deg: float = 0.0) -> None:
    """Ruled five-line staves with bar lines; a positive tilt runs the lines up to the right."""
    width, height = page.rect.width, page.rect.height
    cx, cy = width / 2, height / 2
    cos, sin = math.cos(math.radians(tilt_deg)), math.sin(math.radians(tilt_deg))

    def tilt(x: float, y: float) -> pymupdf.Point:
        dx, dy = x - cx, y - cy
        return pymupdf.Point(cx + dx * cos + dy * sin, cy - dx * sin + dy * cos)

    margin, spacing = width * 0.12, 4.5
    for system in range(8):
        top = height * 0.1 + system * height * 0.1
        for line in range(5):
            y = top + spacing * line
            page.draw_line(tilt(margin, y), tilt(width - margin, y), width=0.6)
        for frac in (0.0, 0.3, 0.6, 1.0):
            x = margin + frac * (width - 2 * margin)
            page.draw_line(tilt(x, top), tilt(x, top + 4 * spacing), width=0.8)


def make_pdf(sizes: list[tuple[float, float]], tilts: list[float] | None = None) -> bytes:
    doc = pymupdf.open()
    for index, (width, height) in enumerate(sizes):
        page = doc.new_page(width=width, height=height)
        draw_staves(page, tilts[index] if tilts else 0.0)
    return doc.tobytes()


def stored_image(storage: InMemoryStorage, path: str) -> Image.Image:
    image = Image.open(io.BytesIO(storage.download(path)))
    image.load()
    return image


@pytest.mark.slow
def test_pdf_pages_render_at_the_dpi_rule_and_are_stored_as_webp() -> None:
    storage = InMemoryStorage()
    part = render_part(make_pdf([LETTER, SMALL]), *IDS, storage, PyMuPdfRenderer())

    assert [(p.page_index, p.width, p.height) for p in part.pages] == [
        (0, 1700, 2200),  # 612 x 792 pt at 200 DPI
        (1, 1650, 2550),  # 396 x 612 pt at 300 DPI
    ]
    assert part.dpi == [200, 300]
    base = "user-1/piece-1/score-1"
    assert [p.image_path for p in part.pages] == [f"{base}/page-0.webp", f"{base}/page-1.webp"]
    assert storage.paths() == [f"{base}/page-0.webp", f"{base}/page-1.webp"]
    for page in part.pages:
        assert storage.content_type(page.image_path) == "image/webp"
        image = stored_image(storage, page.image_path)
        assert image.format == "WEBP"
        assert image.size == (page.width, page.height)


@pytest.mark.slow
def test_tilted_page_comes_back_level_and_records_the_applied_angle() -> None:
    storage = InMemoryStorage()
    part = render_part(make_pdf([LETTER, LETTER], [1.5, 0.0]), *IDS, storage, PyMuPdfRenderer())

    # Counter-clockwise skew is positive; the angle applied to Image.rotate is its negative.
    assert part.angles_deg[0] == pytest.approx(-1.5, abs=LEVEL_TOLERANCE_DEG)
    assert part.angles_deg[1] == pytest.approx(0.0, abs=LEVEL_TOLERANCE_DEG)
    for page in part.pages:
        level = estimate_skew_deg(stored_image(storage, page.image_path))
        assert level == pytest.approx(0.0, abs=LEVEL_TOLERANCE_DEG)


def test_pymupdf_renderer_reports_counts_and_sizes() -> None:
    renderer = PyMuPdfRenderer()
    pdf = make_pdf([LETTER, SMALL])
    assert renderer.page_count(pdf) == 2
    assert renderer.page_size_pt(pdf, 1) == pytest.approx(SMALL)
    assert isinstance(renderer, PdfRenderer)


def test_broken_pdf_gives_one_sentence() -> None:
    with pytest.raises(PdfPagesError, match="not a readable PDF"):
        render_part(b"this is not a pdf", *IDS, InMemoryStorage(), PyMuPdfRenderer())


def test_password_protected_pdf_gives_one_sentence() -> None:
    doc = pymupdf.open()
    draw_staves(doc.new_page())
    locked = doc.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="open-sesame", owner_pw="owner"
    )
    with pytest.raises(PdfPagesError, match="password"):
        render_part(locked, *IDS, InMemoryStorage(), PyMuPdfRenderer())


def test_pdf_over_the_page_limit_is_refused_before_any_rendering() -> None:
    storage = InMemoryStorage()
    renderer = FakePdfRenderer([LETTER] * (MAX_PAGES + 1))
    with pytest.raises(PdfPagesError, match=f"more than {MAX_PAGES} pages"):
        render_part(b"%PDF", *IDS, storage, renderer)
    assert storage.paths() == []
    assert renderer.rendered == []


def test_pdf_with_no_pages_gives_one_sentence() -> None:
    with pytest.raises(PdfPagesError, match="no pages"):
        render_part(b"%PDF", *IDS, InMemoryStorage(), FakePdfRenderer([]))


def test_pdf_over_the_size_limit_is_refused_before_it_is_opened() -> None:
    renderer = FakePdfRenderer([LETTER])
    with pytest.raises(PdfPagesError, match="larger than 50 MB"):
        render_part(b"x" * (MAX_PDF_BYTES + 1), *IDS, InMemoryStorage(), renderer)
    assert renderer.rendered == []


def test_pdf_errors_are_value_errors_for_the_orchestrator() -> None:
    assert issubclass(PdfPagesError, ValueError)


def test_fake_renderer_draws_pages_at_the_asked_dpi() -> None:
    renderer = FakePdfRenderer([LETTER, SMALL])
    assert renderer.page_count(b"") == 2
    assert renderer.page_size_pt(b"", 1) == SMALL
    image = renderer.render(b"", 0, 100)
    assert image.mode == "RGB"
    assert image.size == (850, 1100)
    assert image.getextrema() == ((0, 255), (0, 255), (0, 255))  # white paper, black staff lines


def test_fake_pages_follow_the_dpi_rule_and_store_under_the_part_path() -> None:
    storage = InMemoryStorage()
    square, small = (440.0, 440.0), (144.0, 216.0)  # just over and well under 6 in
    part = render_part(b"%PDF", *IDS, storage, FakePdfRenderer([square, small]))
    assert part.dpi == [200, 300]
    assert [(p.width, p.height) for p in part.pages] == [(1222, 1222), (600, 900)]
    assert all(isinstance(p, PageImage) for p in part.pages)


@pytest.mark.slow
def test_fake_skew_is_levelled_and_recorded() -> None:
    storage = InMemoryStorage()
    renderer = FakePdfRenderer([(300.0, 300.0)], skews_deg=[-1.0])
    part = render_part(b"%PDF", *IDS, storage, renderer)
    assert part.angles_deg[0] == pytest.approx(1.0, abs=LEVEL_TOLERANCE_DEG)
    level = estimate_skew_deg(stored_image(storage, part.pages[0].image_path))
    assert level == pytest.approx(0.0, abs=LEVEL_TOLERANCE_DEG)
