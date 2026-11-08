"""box_check.py, stage 2: moving a flagged line start's left edge by the page's pixels.

Synthetic bands only: white, five staff lines, and black blocks standing for a clef, a
signature and notes.
"""

import numpy as np
import pytest

from app.pipeline.box_check import column_ink, ink_blocks, opening_edges, staff_rows

SPACE = 10.0  # staff space in px


def band(*blocks: tuple[int, int], width: int = 200, height: int = 50) -> np.ndarray:
    """A grey band (255 white), staff lines every SPACE px, solid blocks (x0, x1) on the staff."""
    pixels = np.full((height, width), 255, dtype=np.uint8)
    for row in (5, 15, 25, 35, 45):
        pixels[row, :] = 0
    for x0, x1 in blocks:
        pixels[8:42, x0:x1] = 0
    return pixels


def test_rows_dark_over_most_of_the_width_and_their_neighbours_are_staff_lines() -> None:
    assert staff_rows(band((20, 40))) == [r + d for r in (5, 15, 25, 35, 45) for d in (-1, 0, 1)]


def test_column_ink_leaves_the_staff_lines_out() -> None:
    ink = column_ink(band((20, 40)))
    assert ink[10] == 0 and ink[30] > 0


def test_blocks_closer_than_the_small_gap_join() -> None:
    ink = column_ink(band((20, 30), (32, 40), (80, 90)))
    assert ink_blocks(ink, SPACE) == [(20, 40), (80, 90)]


def test_the_signature_ends_where_a_gap_of_a_staff_space_opens() -> None:
    # clef 20-40, key signature 46-56 (gap 0.6 spaces), first note 80-90 (gap 2.4 spaces)
    ink = column_ink(band((20, 40), (46, 56), (80, 90)))

    edges = opening_edges(ink, left=15, space=SPACE)

    assert edges is not None
    assert edges.after_signature == pytest.approx(56 + 0.5 * SPACE)
    assert edges.before_first_note == pytest.approx(80 - 0.5 * SPACE)


def test_ink_left_of_the_box_does_not_count() -> None:
    ink = column_ink(band((0, 10), (20, 40), (80, 90)))

    edges = opening_edges(ink, left=15, space=SPACE)

    assert edges is not None and edges.after_signature == pytest.approx(45)


def test_with_no_gap_after_the_first_block_there_is_no_edge() -> None:
    ink = column_ink(band((20, 190)))
    assert opening_edges(ink, left=15, space=SPACE) is None


def test_the_faint_rows_beside_a_scanned_staff_line_are_left_out_too() -> None:
    pixels = band((20, 40), (80, 90))
    for row in (4, 6, 14, 16, 24, 26, 34, 36, 44, 46):
        pixels[row, ::3] = 0  # a third of the row dark: the grey edge of a thick line

    ink = column_ink(pixels)

    assert ink_blocks(ink, SPACE) == [(20, 40), (80, 90)]
