"""Deskew: estimate and undo the rotation of a rendered score page (synthetic pages, seeded)."""

import math

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.pipeline.pdf_pages import deskew, estimate_skew_deg

TOLERANCE_DEG = 0.2
WIDTH, HEIGHT = 1700, 2200


def make_score_page(seed: int = 7) -> Image.Image:
    """A white page of ten five-line staves with bar lines and filled note heads."""
    rng = np.random.default_rng(seed)
    page = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(page)
    bar_xs = [100, 480, 860, 1240, 1600]
    for system in range(10):
        top = 100 + 200 * system
        for line in range(5):
            y = top + 12 * line
            draw.rectangle([100, y, 1600, y + int(rng.integers(1, 3)) - 1], fill=0)
        for x in bar_xs:
            draw.rectangle([x, top, x + 1, top + 48], fill=0)
        for _ in range(24):
            cx = int(rng.integers(120, 1580))
            cy = top + 6 * int(rng.integers(-2, 11))
            draw.ellipse([cx - 8, cy - 6, cx + 8, cy + 6], fill=0)
    return page


def make_tilted_score_page(angle_deg: float, seed: int = 11) -> Image.Image:
    """A page drawn already tilted: every line end is placed with trigonometry, no Image.rotate.

    The tilt is counter-clockwise positive about the page centre, so a line that is level on the
    page runs up to the right for a positive angle.
    """
    width, height = 1200, 1600
    rng = np.random.default_rng(seed)
    cx, cy = width / 2, height / 2
    cos, sin = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))

    def tilt(x: float, y: float) -> tuple[float, float]:
        dx, dy = x - cx, y - cy
        return cx + dx * cos + dy * sin, cy - dx * sin + dy * cos

    page = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(page)
    for system in range(8):
        top = 100 + 200 * system
        for line in range(5):
            y = top + 12 * line
            draw.line([tilt(100, y), tilt(1100, y)], fill=0, width=int(rng.integers(1, 3)))
        for x in (100, 400, 700, 1100):
            draw.line([tilt(x, top), tilt(x, top + 48)], fill=0, width=2)
        for _ in range(12):
            nx, ny = tilt(int(rng.integers(120, 1080)), top + 6 * int(rng.integers(-2, 11)))
            draw.ellipse([nx - 8, ny - 6, nx + 8, ny + 6], fill=0)
    return page


@pytest.fixture(scope="module")
def page() -> Image.Image:
    return make_score_page()


def rotated(page: Image.Image, angle: float) -> Image.Image:
    """Rotate counter-clockwise by `angle` degrees onto white, like a crooked scan."""
    return page.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=255)


@pytest.mark.parametrize("truth", [1.3, -0.7, 2.5, 0.0])
def test_estimate_skew_matches_the_rotation_applied(page: Image.Image, truth: float) -> None:
    # Counter-clockwise positive, the same sign as Image.rotate.
    estimate = estimate_skew_deg(rotated(page, truth))
    assert estimate == pytest.approx(truth, abs=TOLERANCE_DEG)


@pytest.mark.parametrize("truth", [1.3, -0.7, 2.5, 0.0])
def test_deskew_levels_the_page_and_keeps_its_size(page: Image.Image, truth: float) -> None:
    crooked = rotated(page, truth)
    fixed, applied = deskew(crooked)
    assert fixed.size == crooked.size
    assert estimate_skew_deg(fixed) == pytest.approx(0.0, abs=TOLERANCE_DEG)
    # The angle applied is the rotation handed to Image.rotate: the negative of the skew.
    assert applied == pytest.approx(-truth, abs=TOLERANCE_DEG)


def test_deskew_accepts_an_rgb_page(page: Image.Image) -> None:
    crooked = rotated(page, 1.3).convert("RGB")
    fixed, applied = deskew(crooked)
    assert fixed.mode == "RGB"
    assert fixed.size == crooked.size
    assert applied == pytest.approx(-1.3, abs=TOLERANCE_DEG)
    assert estimate_skew_deg(fixed) == pytest.approx(0.0, abs=TOLERANCE_DEG)
    # The rotation fills the exposed corners with white, not black.
    assert fixed.getpixel((0, 0)) == (255, 255, 255)


def test_blank_page_has_no_skew() -> None:
    blank = Image.new("L", (800, 1000), 255)
    assert estimate_skew_deg(blank) == 0.0
    fixed, applied = deskew(blank)
    assert applied == 0.0
    assert fixed.size == blank.size


def test_estimate_stays_within_max_angle(page: Image.Image) -> None:
    estimate = estimate_skew_deg(rotated(page, 6.0), max_angle=3.0)
    assert -3.0 <= estimate <= 3.0


def test_non_positive_search_settings_are_rejected(page: Image.Image) -> None:
    with pytest.raises(ValueError):
        estimate_skew_deg(page, step=0.0)
    with pytest.raises(ValueError):
        estimate_skew_deg(page, max_angle=-1.0)


@pytest.mark.parametrize("truth", [1.7, -1.1])
def test_page_drawn_tilted_is_estimated_and_levelled(truth: float) -> None:
    # Independent of Image.rotate: the tilt comes from trigonometry on the line endpoints.
    tilted = make_tilted_score_page(truth)
    assert estimate_skew_deg(tilted) == pytest.approx(truth, abs=TOLERANCE_DEG)
    fixed, applied = deskew(tilted)
    assert applied == pytest.approx(-truth, abs=TOLERANCE_DEG)
    assert fixed.size == tilted.size
    assert estimate_skew_deg(fixed) == pytest.approx(0.0, abs=TOLERANCE_DEG)
