from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

import numpy as np

from app.pipeline.bar_boxes import BoxAudit
from app.pipeline.consensus import StructureAudit
from app.pipeline.models import Meter
from app.pipeline.omr import OmrMeasure, OmrPage, OmrSystem, to_bar_boxes
from app.pipeline.peaks import build_peaks
from app.pipeline.play_order import propose_play_order
from app.pipeline.structure import PieceStructure
from app.pipeline.structure_read import PartAudits, PartRead
from app.settings import get_settings

if TYPE_CHECKING:
    from app.deps import Services

# The four things the orchestrator asks of the outside world, behind these Protocols. The real
# stages (FFmpeg, PDF rendering, Audiveris with the vision read, Beat This) are in
# real_stages.py; the fakes below make a tiny synthetic piece for tests and the fake-backed
# server. default_stages() picks between them.


@dataclass(frozen=True)
class AudioResult:
    """The recording after ingest: waveform peaks JSON and its length in seconds."""

    peaks: dict[str, Any]
    duration_sec: float
    wav_path: Path | None = None  # the mono WAV beat detection listens to; the fakes have none


@dataclass(frozen=True)
class PageImage:
    """One rendered score page: its image file in storage and its size in pixels."""

    page_index: int
    width: int
    height: int
    image_path: str


@dataclass(frozen=True)
class RenderedPart:
    """A part's stored page images. angles_deg[i] is the angle applied to Image.rotate to level
    page i (the negative of its skew), so later stages can map an unrotated read onto the image.
    """

    pages: list[PageImage]
    angles_deg: list[float]
    dpi: list[int]


@dataclass(frozen=True)
class Heard:
    """What the downbeat stage heard: Beat This' frame logits and the beats it picked."""

    beat_logits: np.ndarray
    downbeat_logits: np.ndarray
    fps: float
    beats: list[float]

    @property
    def downbeat_probability(self) -> np.ndarray:
        """The downbeat logits as probabilities, the curve the review flags read."""
        return 1.0 / (1.0 + np.exp(-self.downbeat_logits))


@runtime_checkable
class AudioStage(Protocol):
    """Fetch and convert the piece's recording."""

    def ingest(self, piece_id: str) -> AudioResult:
        """Read the piece's audio source and return its peaks and duration."""
        ...


@runtime_checkable
class PagesStage(Protocol):
    """Render a part's PDF to page images."""

    def page_count(self, score_file: dict[str, Any]) -> int:
        """The number of pages of the score_files row's PDF, without rendering any (the plan's
        page limit is checked on it before anything is rendered or read)."""
        ...

    def render(self, score_file: dict[str, Any]) -> RenderedPart:
        """Return the stored image of every page of the score_files row, in page order."""
        ...


@runtime_checkable
class OmrStage(Protocol):
    """Read bars, meters and signs from a rendered part."""

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        """Return the part's bar boxes on the rendered pages and what its score says."""
        ...


@runtime_checkable
class DownbeatStage(Protocol):
    """Listen to the recording for its beats and downbeats."""

    def listen(self, audio: AudioResult) -> Heard:
        """Return the beat and downbeat logits and the time of every detected beat."""
        ...


def _nothing() -> None:
    """The fakes leave nothing behind."""


@dataclass(frozen=True)
class Stages:
    """The four stages of one job (made per job), and how to clear what they left behind."""

    audio: AudioStage
    pages: PagesStage
    omr: OmrStage
    downbeats: DownbeatStage
    clean_up: Callable[[], None] = _nothing


# --- fakes: a synthetic piece of 8 bars of 4/4, two systems of four on one page ------------------

FAKE_BARS = 8
FAKE_BARS_PER_SYSTEM = 4
FAKE_BAR_SEC = 2.0
FAKE_BEATS_PER_BAR = 4  # the numerator of the fake piece's 4/4
FAKE_FIRST_DOWNBEAT_SEC = 0.5
FAKE_DURATION_SEC = 18.0
FAKE_FPS = 50.0
FAKE_SAMPLE_RATE = 8000
FAKE_PAGE_SIZE = (850, 1100)
_LOGIT = 6.0


class FakeAudioStage:
    """A short synthetic tone, so the peaks have something to show."""

    def ingest(self, piece_id: str) -> AudioResult:
        t = np.arange(round(FAKE_DURATION_SEC * FAKE_SAMPLE_RATE)) / FAKE_SAMPLE_RATE
        samples = 0.5 * np.sin(2 * np.pi * 220.0 * t)
        return AudioResult(
            peaks=build_peaks(samples, FAKE_SAMPLE_RATE), duration_sec=FAKE_DURATION_SEC
        )


class FakePagesStage:
    """One page image path per part; nothing is rendered. `pages` is what page_count says."""

    def __init__(self, pages: int = 1) -> None:
        self.pages = pages

    def page_count(self, score_file: dict[str, Any]) -> int:
        return self.pages

    def render(self, score_file: dict[str, Any]) -> RenderedPart:
        width, height = FAKE_PAGE_SIZE
        path = f"fake/{score_file.get('id', 'part')}/page-0.webp"
        page = PageImage(page_index=0, width=width, height=height, image_path=path)
        return RenderedPart(pages=[page], angles_deg=[0.0], dpi=[200])


class FakeOmrStage:
    """Two systems of four equal measures; 4/4 is printed on the first."""

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        if not rendered.pages:
            raise ValueError("no page images to read")
        page = rendered.pages[0]
        margin = page.width * 0.06
        measure_width = (page.width - 2 * margin) / FAKE_BARS_PER_SYSTEM
        systems: list[OmrSystem] = []
        for system_index in range(FAKE_BARS // FAKE_BARS_PER_SYSTEM):
            top = page.height * (0.1 + 0.4 * system_index)
            measures = [
                OmrMeasure(
                    left=margin + measure_width * i,
                    right=margin + measure_width * (i + 1),
                    time_signature=(
                        Meter(numerator=4, denominator=4) if system_index == 0 and i == 0 else None
                    ),
                )
                for i in range(FAKE_BARS_PER_SYSTEM)
            ]
            systems.append(OmrSystem(top=top, bottom=top + page.height * 0.08, measures=measures))
        omr_page = OmrPage(
            page_index=page.page_index,
            image_width=page.width,
            image_height=page.height,
            systems=systems,
        )
        sizes = {page.page_index: (page.width, page.height)}
        boxes, meters, marks = to_bar_boxes([omr_page], sizes)
        proposal = propose_play_order(marks, len(boxes))
        structure = PieceStructure(
            bar_count=len(boxes),
            meters=meters,
            marks=marks,
            bar_marks=[],
            tempo_text={},
            part_name=None,
            play_order=proposal.rows,
            warnings=list(proposal.warnings),
        )
        audits = PartAudits(StructureAudit([]), BoxAudit())
        return PartRead(boxes, structure, audits, 0.0, [], None)


class FakeDownbeatStage:
    """A clean piece: a beat every FAKE_BAR_SEC / FAKE_BEATS_PER_BAR, a downbeat every bar."""

    def listen(self, audio: AudioResult) -> Heard:
        frames = round(audio.duration_sec * FAKE_FPS)
        beats = [
            FAKE_FIRST_DOWNBEAT_SEC + (bar + beat / FAKE_BEATS_PER_BAR) * FAKE_BAR_SEC
            for bar in range(FAKE_BARS)
            for beat in range(FAKE_BEATS_PER_BAR)
        ]
        downbeats = beats[::FAKE_BEATS_PER_BAR]
        return Heard(
            beat_logits=_logits(beats, frames),
            downbeat_logits=_logits(downbeats, frames),
            fps=FAKE_FPS,
            beats=beats,
        )


def _logits(times: list[float], frames: int) -> np.ndarray:
    """Logits as Beat This gives them: strongly positive at the given times, negative elsewhere."""
    logits = np.full(frames, -_LOGIT)
    logits[np.clip(np.rint(np.asarray(times) * FAKE_FPS).astype(int), 0, frames - 1)] = _LOGIT
    return logits


def default_stages(services: "Services | None" = None) -> Stages:
    """The real stages when the services are real and USE_FAKES is off, else the fakes.

    Real services (Supabase, Phase 9) are what the real tools make sense for; with the in-memory
    services there is nothing to read, so the fakes run. The real stages check their tools here
    and raise one sentence naming the one that is missing.
    """
    settings = get_settings()
    if services is None or settings.use_fakes or not settings.has_supabase:
        return Stages(
            audio=FakeAudioStage(),
            pages=FakePagesStage(),
            omr=FakeOmrStage(),
            downbeats=FakeDownbeatStage(),
        )
    from app.pipeline.real_stages import (  # lazy: imports this module
        real_stages,
        real_tools,
        with_box_check,
    )

    tools = real_tools(settings)
    stages = real_stages(services.db, services.storage, tools)
    return with_box_check(stages, services.db, services.storage, tools.box_judge, tools.advanced)
