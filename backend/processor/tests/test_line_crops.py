"""Tests for the line crops: the picture of each system the score reader gets. Synthetic pages."""

import io

import numpy as np
import pytest
from PIL import Image

from app.pipeline.line_crops import CROP_MARGIN, LineCrop, crop_rows, line_crops
from app.pipeline.omr import OmrLine, OmrMeasure, OmrStaff, OmrSystem, OmrSystemGeometry

WIDTH, HEIGHT = 1000, 1600


def level_staff(top: float, height: float = 80) -> OmrStaff:
    return OmrStaff(
        top_line=[(100.0, top), (900.0, top)],
        bottom_line=[(100.0, top + height), (900.0, top + height)],
    )


def line(top: float, page: int = 0, height: float = 80, staves: list[OmrStaff] | None = None):
    staves = [level_staff(top, height)] if staves is None else staves
    bottom = max(s.bottom for s in staves)
    return OmrLine(
        page=page,
        size=(WIDTH, HEIGHT),
        system=OmrSystem(top=top, bottom=bottom, measures=[OmrMeasure(left=100.0, right=900.0)]),
        geometry=OmrSystemGeometry(left=100.0, right=900.0, staves=staves),
    )


def decode(png: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(png)) as image:
        assert image.mode == "L"
        return np.asarray(image) < 128


# ---------------------------------------------------------------- the rows


def test_a_crop_runs_two_and_a_half_staff_heights_above_and_below_the_staff():
    assert CROP_MARGIN == 2.5
    assert crop_rows(line(600), HEIGHT) == (400, 880)  # 600 - 200 .. 680 + 200


def test_the_margin_is_in_staff_heights_so_it_follows_the_scan_resolution():
    assert crop_rows(line(600, height=40), HEIGHT) == (500, 740)  # 600 - 100 .. 640 + 100


def test_a_crop_is_clamped_to_the_page():
    assert crop_rows(line(50), HEIGHT)[0] == 0
    assert crop_rows(line(1500), HEIGHT)[1] == HEIGHT


def test_the_crop_of_a_system_with_two_staves_holds_both_with_the_margin_of_one_staff():
    both = line(600, staves=[level_staff(600), level_staff(800)])
    assert crop_rows(both, HEIGHT) == (400, 1080)  # 600 - 200 .. (800 + 80) + 200


def test_a_tilted_staff_counts_from_its_highest_and_lowest_point():
    tilted = OmrStaff(
        top_line=[(100.0, 600.0), (900.0, 640.0)], bottom_line=[(100.0, 680.0), (900.0, 720.0)]
    )
    assert crop_rows(line(600, staves=[tilted]), HEIGHT) == (600 - 300, 720 + 300)  # height 120


# ---------------------------------------------------------------- the pictures


def test_a_crop_stops_halfway_to_a_neighbouring_system():
    # the staff spans 600..680; the system above ends at 500 and the one below starts at 760
    assert crop_rows(line(600), HEIGHT, above=500, below=760) == (550, 720)


def test_a_neighbour_beyond_the_margin_changes_nothing():
    assert crop_rows(line(600), HEIGHT, above=100, below=1400) == (400, 880)


def test_crops_of_a_crowded_page_do_not_overlap():
    # a piano page: two systems whose margins would run into each other
    page = np.zeros((HEIGHT, WIDTH), dtype=bool)
    first, second = line_crops([line(600, height=60), line(800, height=60)], {0: page})
    assert first.rows[1] <= second.rows[0]
    assert (first.rows[0], second.rows[1]) == (450, 1010)  # the outer margins stay 2.5 heights


def test_the_system_on_another_page_is_not_a_neighbour():
    page = np.zeros((HEIGHT, WIDTH), dtype=bool)
    crops = line_crops([line(600), line(700, page=1)], {0: page, 1: page})
    assert crops[0].rows == (400, 880)


def test_a_crop_is_the_full_page_width_of_the_rows_around_its_system():
    page = np.zeros((HEIGHT, WIDTH), dtype=bool)
    page[640:645, 100:900] = True  # something inside the staff
    page[100:110, :] = True  # outside the crop
    (crop,) = line_crops([line(600)], {0: page})
    assert isinstance(crop, LineCrop)
    assert (crop.page, crop.system_index, crop.rows) == (0, 0, (400, 880))
    assert np.array_equal(decode(crop.png), page[400:880])


def test_the_picture_is_black_ink_on_white():
    page = np.zeros((HEIGHT, WIDTH), dtype=bool)
    page[640, 100] = True
    (crop,) = line_crops([line(600)], {0: page})
    with Image.open(io.BytesIO(crop.png)) as image:
        assert image.format == "PNG"
        assert (image.getpixel((100, 240)), image.getpixel((101, 240))) == (0, 255)


def test_lines_are_numbered_over_the_whole_piece_and_labelled_for_a_person():
    pages = {p: np.zeros((HEIGHT, WIDTH), dtype=bool) for p in (0, 1)}
    lines = [line(300), line(900), line(300, page=1)]
    crops = line_crops(lines, pages)
    assert [(c.page, c.system_index) for c in crops] == [(0, 0), (0, 1), (1, 2)]
    assert [c.label for c in crops] == ["page 1, line 1", "page 1, line 2", "page 2, line 3"]


def test_a_page_without_an_image_is_named():
    with pytest.raises(ValueError, match="page 3"):
        line_crops([line(300, page=2)], {0: np.zeros((HEIGHT, WIDTH), dtype=bool)})
