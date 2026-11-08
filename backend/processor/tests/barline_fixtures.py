"""A synthetic page for the bar-line tests: one staff, bar lines and stems drawn as ink."""

import numpy as np

from app.pipeline.barlines import Staff

WIDTH, HEIGHT = 1000, 600
TOP, SPACE = 100, 20  # first staff line and the gap between lines, in px


def staff_at(top: int = TOP) -> Staff:
    return Staff(
        top=np.array([[50.0, top], [950.0, top]]),
        bottom=np.array([[50.0, top + 4 * SPACE], [950.0, top + 4 * SPACE]]),
    )


def blank_page() -> np.ndarray:
    return np.zeros((HEIGHT, WIDTH), dtype=bool)


def draw_staff(page: np.ndarray, top: int = TOP) -> None:
    for k in range(5):
        y = top + k * SPACE
        page[y - 1 : y + 2, 50:951] = True


def draw_bar(
    page: np.ndarray,
    x: int,
    top: int = TOP,
    y0: int | None = None,
    y1: int | None = None,
    width: int = 3,
) -> None:
    y0 = top if y0 is None else y0
    y1 = top + 4 * SPACE if y1 is None else y1
    page[y0 : y1 + 1, x - width // 2 : x + width // 2 + 1] = True


def draw_notehead(page: np.ndarray, x: int, y: int, side: int = -1) -> None:
    """A solid notehead beside a stem at x: 25 px wide, 18 px tall."""
    cols = slice(x - 25, x + 1) if side < 0 else slice(x, x + 26)
    page[y - 9 : y + 10, cols] = True


def draw_accidental(page: np.ndarray, x: int, y: int) -> None:
    """A sharp-like sign 16 px wide (0.8 spaces) and 30 px tall: left edge at x, centred on y."""
    for col in (x + 3, x + 12):
        page[y - 15 : y + 16, col : col + 2] = True
    for row in (y - 8, y + 4):
        page[row : row + 6, x : x + 16] = True


def draw_hollow_notehead(page: np.ndarray, x: int, y: int) -> None:
    """A whole note: a ring 26 px wide and 18 px tall (1.3 spaces) centred on (x, y), 5 px thick."""
    rows, cols = np.ogrid[y - 9 : y + 10, x - 13 : x + 14]
    outer = ((cols - x) / 13.0) ** 2 + ((rows - y) / 9.0) ** 2 <= 1
    inner = ((cols - x) / 8.0) ** 2 + ((rows - y) / 4.0) ** 2 <= 1
    page[y - 9 : y + 10, x - 13 : x + 14] |= outer & ~inner


def draw_multi_rest(page: np.ndarray, x0: int, x1: int, y: int) -> None:
    """A multi-measure rest: a thick horizontal bar from x0 to x1, 10 px tall, centred on y."""
    page[y - 5 : y + 5, x0 : x1 + 1] = True


def page_with(*bars: int) -> np.ndarray:
    page = blank_page()
    draw_staff(page)
    for x in bars:
        draw_bar(page, x)
    return page
