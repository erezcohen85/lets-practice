from dataclasses import dataclass

import numpy as np

from app.pipeline.omr import OmrStaff

# Checks bar lines against the page image Audiveris worked from.
#
# Audiveris finds measure columns ("stacks") from the bar lines it believes in, and it is wrong in
# both directions: a half note's stem becomes a bar line, a real bar line next to a clef is
# missed. The page image settles it. Every staff of the system is looked at between its first
# and fifth line: a bar line is ink all the way down (a stem is not), carries on no further than
# the staff (a stem with a flag or a long tail does), and has no notehead against it.

COVERAGE = 0.95  # share of the rows between the outer staff lines that must be ink
WINDOW = 2  # columns either side of x that count as "at x"
SNAP = 3  # columns either side an Audiveris boundary may sit off its bar line
GROUP = 25  # px: bar lines closer than this are one (double and repeat bar lines)
EDGE = 25  # px: a bar line this close to the end of the line is the end of the line
SCAN_FROM, SCAN_TO = 15, 5  # px inside the first stack's left and the last stack's right
BEYOND = (4, 9)  # rows past the staff that must stay clear of ink
BEYOND_INK = 0.6  # a share of those rows with ink above this is a stem that carries on
HEAVY_RUN = 12  # px: a horizontal ink run this long through x is a notehead or a beam
HEAVY_ROWS = 3  # heavy rows this many (off the staff lines) make a notehead
LINE_HALF = 2.5  # rows around a staff line that are the staff line, not the music
SOLID_SPACES = 1.1  # staff spaces: solid ink this wide is music; an accidental is narrower


@dataclass(eq=False)
class Staff:
    """The first and fifth line of one staff as (x, y) points, sorted by x."""

    top: np.ndarray
    bottom: np.ndarray

    @classmethod
    def from_omr(cls, staff: OmrStaff) -> "Staff":
        return cls(top=np.array(staff.top_line), bottom=np.array(staff.bottom_line))

    def edges(self, x: float) -> tuple[float, float]:
        """The y of the first and fifth line at x."""
        return (
            float(np.interp(x, self.top[:, 0], self.top[:, 1])),
            float(np.interp(x, self.bottom[:, 0], self.bottom[:, 1])),
        )

    def rows(self, x: float) -> tuple[int, int]:
        """The rows of the first and fifth line at x."""
        top, bottom = self.edges(x)
        return round(top), round(bottom)


@dataclass(frozen=True)
class Check:
    """Whether a column is a bar line; `reason` says why not."""

    ok: bool
    coverage: float
    reason: str | None = None


@dataclass(frozen=True)
class BarLine:
    x: int
    coverage: float
    strokes: int = 1  # the strokes it is made of: 2 for a double or thin-thick bar line, 3 a repeat


def _run_lengths(band: np.ndarray) -> np.ndarray:
    """For every ink pixel, the length of the horizontal ink run it sits in (0 elsewhere)."""
    width = band.shape[1]
    index = np.arange(width)[None, :]
    before = np.maximum.accumulate(np.where(~band, index, -1), axis=1)
    after = np.minimum.accumulate(np.where(~band, index, width)[:, ::-1], axis=1)[:, ::-1]
    return np.where(band, after - before - 1, 0)


class LineProbe:
    """The bar-line evidence on the page for one system: its ink and its staves."""

    def __init__(self, ink: np.ndarray, staves: list[Staff]):
        self.ink = ink
        self.staves = staves
        self.first, self.last = staves[0], staves[-1]
        self._band_top = max(0, int(min(s.top[:, 1].min() for s in staves)) - BEYOND[1] - 3)
        bottom = int(max(s.bottom[:, 1].max() for s in staves)) + BEYOND[1] + 4
        self._band = ink[self._band_top : bottom]
        self._runs: np.ndarray | None = None

    def _window(self, rows: slice | np.ndarray, x: int, half: int = WINDOW) -> np.ndarray:
        return self.ink[rows, max(0, x - half) : x + half + 1]

    def coverage(self, x: int) -> float:
        """The lowest, over the staves, share of rows between the outer lines with ink near x."""
        lowest = 1.0
        for staff in self.staves:
            top, bottom = staff.rows(x)
            seen = self._window(slice(top, bottom + 1), x).any(axis=1)
            lowest = min(lowest, float(seen.mean()))
        return lowest

    def _carries_on(self, x: int) -> bool:
        """Ink right above the first staff or below the last one: a stem, flag or beam."""
        top = self.first.rows(x)[0]
        bottom = self.last.rows(x)[1]
        near, far = BEYOND
        above = self._window(slice(top - far, top - near + 1), x, 1).any(axis=1).mean()
        below = self._window(slice(bottom + near, bottom + far + 1), x, 1).any(axis=1).mean()
        return max(above, below) >= BEYOND_INK

    def _notehead_beside(self, x: int, run: int = HEAVY_RUN) -> bool:
        """Ink runs of `run` px through x on rows that are not staff lines: a notehead or a beam."""
        if self._runs is None:
            self._runs = _run_lengths(self._band)
        heavy = 0
        for staff in self.staves:
            top, bottom = staff.rows(x)
            rows = np.arange(top, bottom + 1)
            music = np.ones(len(rows), dtype=bool)
            for k in range(5):  # the five lines are evenly spaced
                music &= np.abs(rows - (top + k * (bottom - top) / 4)) > LINE_HALF
            window = self._runs[rows[music] - self._band_top, max(0, x - WINDOW) : x + WINDOW + 1]
            heavy += int((window.max(axis=1) >= run).sum())
        return heavy >= HEAVY_ROWS

    def staff_height(self, x: float) -> int:
        """The distance in px between the first and the fifth line of the first staff at x."""
        top, bottom = self.first.rows(x)
        return bottom - top

    def solid_between(self, left: int, right: int) -> bool:
        """Is there a notehead, a rest or a beam between the columns `left` and `right`?

        The notehead test of `check`, but with the runs it looks for as wide as SOLID_SPACES staff
        spaces: the sharps, flats and naturals of a key signature have rows as heavy as a bar
        line's notehead test allows, and are not music. A hollow note (whole, half) has no solid
        run and is not seen.
        """
        run = max(HEAVY_RUN, round(SOLID_SPACES * self.staff_height(left) / 4))
        last = min(right, self.ink.shape[1] - 1)
        return any(self._notehead_beside(x, run) for x in range(left, last + 1))

    def check(self, x: int) -> Check:
        """Is the column at x a bar line on every staff of the system?"""
        coverage = self.coverage(x)
        if coverage < COVERAGE:
            return Check(False, coverage, f"coverage {coverage:.2f}")
        if self._carries_on(x):
            return Check(
                False, coverage, f"coverage {coverage:.2f} but it carries on past the staff"
            )
        if self._notehead_beside(x):
            return Check(False, coverage, f"coverage {coverage:.2f} but a notehead sits against it")
        return Check(True, coverage)

    def check_near(self, x: int) -> Check:
        """`check` at x, or at the nearest column within SNAP that passes (else the best seen)."""
        offsets = sorted(range(-SNAP, SNAP + 1), key=abs)
        checks = [self.check(x + offset) for offset in offsets]
        return next((c for c in checks if c.ok), max(checks, key=lambda c: c.coverage))

    def scan(self, left: int, right: int) -> list[BarLine]:
        """The bar lines between `left` and `right`, the two ends of the line.

        Runs of adjacent columns that pass `check` are one bar line each; runs whose centres lie
        less than GROUP px apart (double and repeat bar lines) join into one at their centre, and
        `strokes` counts the runs that made it.
        A bar line within EDGE px of an end of the line is that end, not an inner bar line.
        """
        runs: list[list[int]] = []
        for x in range(left + SCAN_FROM, right - SCAN_TO + 1):
            if not self.check(x).ok:
                continue
            if runs and x == runs[-1][1] + 1:
                runs[-1][1] = x
            else:
                runs.append([x, x])
        groups: list[list[float]] = []  # start, end, centre of the last run, number of runs
        for start, end in runs:
            centre = (start + end) / 2
            if groups and centre - groups[-1][2] < GROUP:
                groups[-1][1:3] = [end, centre]
                groups[-1][3] += 1
            else:
                groups.append([start, end, centre, 1])
        found = []
        for start, end, _, strokes in groups:
            start, end = int(start), int(end)
            centre = (start + end) // 2
            if left + EDGE <= centre <= right - EDGE:
                coverage = max(self.coverage(x) for x in range(start, end + 1))
                found.append(BarLine(centre, coverage, int(strokes)))
        return found
