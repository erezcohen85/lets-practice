from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import numpy as np

# Beat and downbeat detection. Beat This (a neural beat tracker) sits behind BeatModel; its
# adapter needs torch, which only the `beat` extra installs, so it is imported on first use.

_MODEL_FPS = 50.0  # frames per second of the Beat This logits
_CHECKPOINT = "final0"  # the checkpoint the PoC measured; the weights download once to ~/.cache


class BeatModelError(ValueError):
    """Beat detection failed for a reason worth showing the user as it is."""


@dataclass(frozen=True)
class BeatActivations:
    """Frame-level beat and downbeat logits, as Beat This gives them (positive = likely)."""

    beat_logits: np.ndarray
    downbeat_logits: np.ndarray
    fps: float

    def __post_init__(self) -> None:
        if self.beat_logits.ndim != 1 or self.downbeat_logits.ndim != 1:
            raise ValueError("logits must be 1-D")
        if self.beat_logits.shape != self.downbeat_logits.shape:
            raise ValueError("beat and downbeat logits must have the same length")
        if self.fps <= 0:
            raise ValueError("fps must be positive")


@dataclass(frozen=True)
class BeatTrack:
    """Detected beat and downbeat times in seconds; every downbeat is also a beat."""

    beats: list[float]
    downbeats: list[float]


@runtime_checkable
class BeatModel(Protocol):
    """Find the beats of a recording."""

    def activations(self, wav: Path) -> BeatActivations:
        """The frame-level logits for the recording."""
        ...

    def beats(self, wav: Path) -> BeatTrack:
        """The beat and downbeat times picked from those logits."""
        ...


class FakeBeatModel:
    """Returns the activations and track it was built with, whatever the file."""

    def __init__(self, activations: BeatActivations, track: BeatTrack) -> None:
        self._activations = activations
        self._track = track

    def activations(self, wav: Path) -> BeatActivations:
        return self._activations

    def beats(self, wav: Path) -> BeatTrack:
        return self._track


class BeatThisModel:
    """Beat This on the CPU. Needs the `beat` extra (torch); the model loads on first use."""

    def __init__(self) -> None:
        self._frames: Any = None
        self._last: tuple[tuple[str, int, int], BeatActivations] | None = None

    def activations(self, wav: Path) -> BeatActivations:
        # one analysis takes about a minute on a CPU, so beats() after activations() reuses it
        stat = wav.stat() if wav.exists() else None
        key = (str(wav), stat.st_mtime_ns, stat.st_size) if stat else None
        if key and self._last and self._last[0] == key:
            return self._last[1]
        found = self._analyse(wav)
        if key:
            self._last = (key, found)
        return found

    def beats(self, wav: Path) -> BeatTrack:
        found = self.activations(wav)
        try:
            import torch
            from beat_this.model.postprocessor import Postprocessor  # lazy: pulls in torch

            beats, downbeats = Postprocessor(type="minimal", fps=int(found.fps))(
                torch.tensor(found.beat_logits), torch.tensor(found.downbeat_logits)
            )
        except ImportError:
            raise _not_installed() from None
        except Exception:
            raise BeatModelError("Beat This could not analyse the recording.") from None
        return BeatTrack([float(t) for t in beats], [float(t) for t in downbeats])

    def _analyse(self, wav: Path) -> BeatActivations:
        try:
            from beat_this.inference import Audio2Frames  # lazy: pulls in torch
            from beat_this.preprocessing import load_audio
        except ImportError:
            raise _not_installed() from None
        try:
            if self._frames is None:
                self._frames = Audio2Frames(checkpoint_path=_CHECKPOINT, device="cpu")
            signal, sample_rate = load_audio(str(wav))
            beat, downbeat = (x.cpu().numpy() for x in self._frames(signal, sample_rate))
        except Exception:
            raise BeatModelError("Beat This could not analyse the recording.") from None
        return BeatActivations(
            np.asarray(beat, dtype=np.float64), np.asarray(downbeat, dtype=np.float64), _MODEL_FPS
        )


def _not_installed() -> BeatModelError:
    return BeatModelError("Beat This is not installed (uv sync --extra beat).")
