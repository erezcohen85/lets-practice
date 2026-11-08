from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Mirrors frontend/src/domain/types.ts. Bar numbers run 1..N in page order, with bar 0 for a pickup
# (anacrusis) before bar 1; pass_index is 0-based, times are recording seconds.

NOTE_VALUES = (1, 2, 4, 8, 16, 32)


class PlayOrderRow(BaseModel):
    """Bars start..end inclusive, played in order; JSON uses "from" and "to"."""

    model_config = ConfigDict(populate_by_name=True, frozen=True)

    start: int = Field(alias="from", ge=0)
    end: int = Field(alias="to", ge=0)

    @model_validator(mode="after")
    def _end_not_before_start(self) -> Self:
        if self.end < self.start:
            raise ValueError(f"play-order row {self.start}-{self.end} runs backwards")
        return self


class PlaySlot(BaseModel):
    """One bar in the expanded play order; position is 0-based."""

    position: int
    bar: int
    pass_index: int


class Meter(BaseModel):
    """A time signature."""

    numerator: int = Field(ge=1)
    denominator: int

    @field_validator("denominator")
    @classmethod
    def _denominator_is_a_note_value(cls, value: int) -> int:
        if value not in NOTE_VALUES:
            raise ValueError(f"denominator must be one of {NOTE_VALUES}, got {value}")
        return value


class MeterChange(Meter):
    """A meter that applies from from_bar until the next change."""

    from_bar: int


class ShortBar(BaseModel):
    """A bar shorter than its meter: `units` notes of the meter's denominator (bar 0 = a pickup).

    `unnumbered` marks a pickup in the middle of the piece that takes no number of its own (the app
    labels it p7). The bar keeps its whole number here, and the alignment treats it as any short
    bar; the flag only travels with it. Never set by detection.
    """

    model_config = ConfigDict(frozen=True)

    bar: int = Field(ge=0)
    units: int = Field(ge=1)
    unnumbered: bool = False


class BarBox(BaseModel):
    """A bar's box on a page image, in that image's pixels."""

    bar: int
    page_index: int
    x: float
    y: float
    w: float
    h: float


FlagKind = Literal[
    "crowded",
    "stretched",
    "beat-count",
    "weak-downbeat",
    "other-downbeat",
    "pickup",
    "skipped-repeat",
    "pulse",
]


class UncertainLine(BaseModel):
    """A bar line the score explains but the audio is unsure of."""

    time_sec: float
    confidence: float  # downbeat probability 0..1


class ReviewFlag(BaseModel):
    """Something odd about a bar's timing; severity 0 means the score explains it."""

    kind: FlagKind
    severity: Literal[0, 1, 2]
    # crowded/stretched: bar length (s); beat-count: notated beats; weak: threshold;
    # other-downbeat: the downbeat probability of the chosen bars; skipped-repeat: slots as written;
    # pulse: the score's beats per bar, the mean over the slots of the order of play
    expected: float
    # bar length (s); beats heard; downbeat probability; for other-downbeat that of the other bars;
    # skipped-repeat: slots as played; pulse: the beats the recording gives a bar, not rounded
    found: float
    # found / expected for crowded, stretched, other-downbeat and pulse, else None
    factor: float | None
    explained_by: Literal["fermata", "rit"] | None = None
    # explained, but a bar line is weak; for other-downbeat, where the other reading puts the bar
    uncertain_line: UncertainLine | None = None


class Locator(BaseModel):
    """A downbeat in the recording for one (bar, pass); confirmed locators are fixed anchors."""

    bar: int
    pass_index: int
    time_sec: float
    confirmed: bool = False
    flags: list[ReviewFlag] = []
    checked: bool = False


class BarMark(BaseModel):
    """A mark of the recording's timing on one bar, shared by every part: a fermata, or a bar of a
    rit. / rall. / accel. span. A part's rests are its own, kept with its page layer."""

    bar: int = Field(ge=0)
    kind: Literal["fermata", "rit"]


class JobKind(StrEnum):
    """What a processing job does."""

    PROCESS_PIECE = "process-piece"
    REALIGN = "realign"
    ADD_PARTS = "add-parts"


class JobStatus(StrEnum):
    """Where a processing job is in its life."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class FailedPart(BaseModel):
    """A part a job could not read: its score_files id, its name and the reason, one sentence."""

    id: str
    name: str
    error: str


class Job(BaseModel):
    """A processing job for one piece."""

    id: str
    piece_id: str
    kind: JobKind
    status: JobStatus
    progress: float = Field(ge=0, le=1)
    error: str | None = None
    # what a finished job tells the user; the jobs table has no column for these yet (Phase 9)
    warnings: list[str] = []
    cost_usd: float = 0.0
    # the parts left out because they could not be read; the others were read and saved
    failed_parts: list[FailedPart] = []


# The most bars, and the most played bars (bars times passes), any piece may have. The largest
# sample piece has 126; the limit is far above any real score and stops a number from the network
# or a saved map from costing minutes and gigabytes.
MAX_SLOTS = 5_000
TOO_LARGE = "The piece is too large to work on: it has more than {} bars or played bars."


def check_size(bar_count: int, slots: int) -> None:
    """Raise ValueError, in a sentence, when the bars or the played bars pass MAX_SLOTS."""
    if bar_count > MAX_SLOTS or slots > MAX_SLOTS:
        raise ValueError(TOO_LARGE.format(MAX_SLOTS))


def expand_play_order(rows: list[PlayOrderRow], bar_count: int) -> list[PlaySlot]:
    """Walk the rows in order and return one slot per played bar, counting repeat passes."""
    check_size(bar_count, sum(max(0, row.end - row.start + 1) for row in rows))
    if bar_count < 1:
        raise ValueError(f"bar_count must be an integer of at least 1, got {bar_count}")
    passes: dict[int, int] = {}
    slots: list[PlaySlot] = []
    for row in rows:
        if row.end > bar_count:
            raise ValueError(
                f"play-order row {row.start}-{row.end} must end at or before bar {bar_count}"
            )
        for bar in range(row.start, row.end + 1):
            pass_index = passes.get(bar, 0)
            passes[bar] = pass_index + 1
            slots.append(PlaySlot(position=len(slots), bar=bar, pass_index=pass_index))
    return slots
