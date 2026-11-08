import io
import zipfile
from dataclasses import dataclass

import numpy as np

from app.pipeline.stages import Heard
from app.storage import Storage

# What listening to a recording gave, kept with the piece so a re-align never listens again
# (Beat This takes about a minute on a CPU). The
# arrays carry the names a run folder calls "activations" (beat_logits, downbeat_logits, beats), so
# local mode reads the same file; the frame rate and the recording's length ride along.

ANALYSIS_NAME = "beats.npz"
_ARRAYS = ("beat_logits", "downbeat_logits", "beats", "fps", "duration_sec")


@dataclass(frozen=True)
class Analysis:
    """The recording's length and what the downbeat stage heard in it."""

    duration_sec: float
    heard: Heard


def analysis_path(owner_id: str, piece_id: str) -> str:
    """Where the piece's analysis is in the pieces bucket."""
    return f"{owner_id}/{piece_id}/{ANALYSIS_NAME}"


def save_analysis(storage: Storage, owner_id: str, piece_id: str, analysis: Analysis) -> None:
    """Store the analysis, replacing the one before."""
    buffer = io.BytesIO()
    np.savez_compressed(
        buffer,
        beat_logits=analysis.heard.beat_logits,
        downbeat_logits=analysis.heard.downbeat_logits,
        beats=np.asarray(analysis.heard.beats, dtype=float),
        fps=np.float64(analysis.heard.fps),
        duration_sec=np.float64(analysis.duration_sec),
    )
    storage.upload(analysis_path(owner_id, piece_id), buffer.getvalue(), "application/octet-stream")


def load_analysis(storage: Storage, owner_id: str, piece_id: str) -> Analysis | None:
    """The piece's stored analysis, or None when there is none or it cannot be read.

    A piece processed before analyses were kept has none; a caller then listens again.
    """
    try:
        data = storage.download(analysis_path(owner_id, piece_id))
    except FileNotFoundError:
        return None
    try:
        with np.load(io.BytesIO(data)) as stored:
            arrays = {name: stored[name] for name in _ARRAYS}
    except (OSError, ValueError, KeyError, EOFError, zipfile.BadZipFile):  # not our npz
        return None
    heard = Heard(
        beat_logits=arrays["beat_logits"],
        downbeat_logits=arrays["downbeat_logits"],
        fps=float(arrays["fps"]),
        beats=[float(t) for t in arrays["beats"]],
    )
    return Analysis(float(arrays["duration_sec"]), heard)


def detected_beats(heard: Heard) -> list[dict[str, float]]:
    """Beat This's beats as {t, downbeat}: the downbeat probability is read at the beat's frame."""
    probability = heard.downbeat_probability
    beats = []
    for time in heard.beats:
        frame = round(time * heard.fps)
        inside = 0 <= frame < len(probability)  # a beat past the last frame has nothing to read
        beats.append(
            {
                "t": round(time, 3),
                "downbeat": round(float(probability[frame]), 3) if inside else 0.0,
            }
        )
    return beats
