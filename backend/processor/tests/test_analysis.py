import io

import numpy as np
import pytest

from app.pipeline.analysis import Analysis, analysis_path, load_analysis, save_analysis
from app.pipeline.stages import Heard
from app.storage import InMemoryStorage

OWNER, PIECE = "user-1", "piece-1"


def an_analysis() -> Analysis:
    frames = np.linspace(-6.0, 6.0, 500)
    return Analysis(
        duration_sec=10.0,
        heard=Heard(frames, frames[::-1].copy(), 50.0, [0.5, 1.0, 1.5]),
    )


def test_the_analysis_lives_next_to_the_piece_s_other_files() -> None:
    assert analysis_path(OWNER, PIECE) == "user-1/piece-1/beats.npz"


def test_an_analysis_saved_comes_back_exactly() -> None:
    storage = InMemoryStorage()
    saved = an_analysis()

    save_analysis(storage, OWNER, PIECE, saved)
    loaded = load_analysis(storage, OWNER, PIECE)

    assert loaded is not None
    assert loaded.duration_sec == saved.duration_sec
    assert loaded.heard.fps == saved.heard.fps
    assert loaded.heard.beats == saved.heard.beats
    assert np.array_equal(loaded.heard.beat_logits, saved.heard.beat_logits)
    assert np.array_equal(loaded.heard.downbeat_logits, saved.heard.downbeat_logits)


def test_the_file_holds_the_arrays_a_run_folder_calls_activations() -> None:
    storage = InMemoryStorage()

    save_analysis(storage, OWNER, PIECE, an_analysis())

    with np.load(io.BytesIO(storage.download(analysis_path(OWNER, PIECE)))) as data:
        assert {"beat_logits", "downbeat_logits", "beats"} <= set(data.files)


def test_a_piece_without_an_analysis_has_none() -> None:
    assert load_analysis(InMemoryStorage(), OWNER, PIECE) is None


@pytest.mark.parametrize("junk", [b"", b"not a zip", b"PK\x03\x04broken"])
def test_an_unreadable_analysis_counts_as_none(junk: bytes) -> None:
    storage = InMemoryStorage()
    storage.upload(analysis_path(OWNER, PIECE), junk, "application/octet-stream")

    assert load_analysis(storage, OWNER, PIECE) is None


def test_an_analysis_missing_an_array_counts_as_none() -> None:
    buffer = io.BytesIO()
    np.savez(buffer, beat_logits=np.zeros(3))
    storage = InMemoryStorage()
    storage.upload(analysis_path(OWNER, PIECE), buffer.getvalue(), "application/octet-stream")

    assert load_analysis(storage, OWNER, PIECE) is None
