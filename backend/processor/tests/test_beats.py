import importlib.util
import sys
import types
import wave
from pathlib import Path

import numpy as np
import pytest

from app.pipeline.beats import (
    BeatActivations,
    BeatModel,
    BeatModelError,
    BeatThisModel,
    BeatTrack,
    FakeBeatModel,
)
from tests.synthetic import logit_curves

FPS = 50.0

needs_beat_extra = pytest.mark.skipif(
    importlib.util.find_spec("beat_this") is None,
    reason="Beat This is not installed (run with: uv run --extra beat pytest -m real)",
)


def fake_model() -> FakeBeatModel:
    beats = [1.0 + 0.5 * k for k in range(8)]
    downbeats = beats[::4]
    beat_logits, downbeat_logits = logit_curves(beats, downbeats, 6.0, FPS)
    return FakeBeatModel(
        BeatActivations(beat_logits, downbeat_logits, FPS), BeatTrack(beats, downbeats)
    )


def test_logit_curves_peak_at_the_given_frames() -> None:
    beat, down = logit_curves([0.5, 1.0], [0.5], 2.0, FPS)
    assert beat.shape == down.shape == (100,)
    assert list(np.flatnonzero(beat > 0)) == [25, 50]
    assert list(np.flatnonzero(down > 0)) == [25]
    assert beat.min() < 0


def test_the_fake_and_the_adapter_satisfy_the_protocol() -> None:
    assert isinstance(fake_model(), BeatModel)
    assert isinstance(BeatThisModel(), BeatModel)


def test_the_fake_returns_what_it_was_built_with(tmp_path: Path) -> None:
    model = fake_model()
    wav = tmp_path / "any.wav"
    activations = model.activations(wav)
    assert activations.fps == FPS
    assert activations.beat_logits.shape == activations.downbeat_logits.shape == (300,)
    assert model.beats(wav).downbeats == [1.0, 3.0]
    assert len(model.beats(wav).beats) == 8


def test_activations_must_be_two_equal_length_1d_arrays() -> None:
    with pytest.raises(ValueError, match="same length"):
        BeatActivations(np.zeros(10), np.zeros(11), FPS)
    with pytest.raises(ValueError, match="1-D"):
        BeatActivations(np.zeros((2, 5)), np.zeros((2, 5)), FPS)
    with pytest.raises(ValueError, match="fps"):
        BeatActivations(np.zeros(10), np.zeros(10), 0.0)


def test_without_the_beat_extra_the_adapter_says_how_to_install_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setitem(sys.modules, "beat_this", None)  # makes `import beat_this` fail
    with pytest.raises(
        BeatModelError, match=r"Beat This is not installed \(uv sync --extra beat\)"
    ):
        BeatThisModel().activations(tmp_path / "audio.wav")


def stub_beat_this(monkeypatch: pytest.MonkeyPatch, frames_model: object) -> None:
    """Replace the beat_this package with one whose Audio2Frames is `frames_model`."""
    package = types.ModuleType("beat_this")
    inference = types.ModuleType("beat_this.inference")
    preprocessing = types.ModuleType("beat_this.preprocessing")
    inference.Audio2Frames = lambda **_: frames_model  # type: ignore[attr-defined]
    preprocessing.load_audio = lambda path: (np.zeros(2205), 22050)  # type: ignore[attr-defined]
    package.inference, package.preprocessing = inference, preprocessing  # type: ignore[attr-defined]
    for name, module in (
        ("beat_this", package),
        ("beat_this.inference", inference),
        ("beat_this.preprocessing", preprocessing),
    ):
        monkeypatch.setitem(sys.modules, name, module)


def test_a_failing_run_becomes_the_one_sentence_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def broken(signal: np.ndarray, sample_rate: int) -> None:
        raise RuntimeError("torch exploded: CUDA, tensors, stack traces")

    stub_beat_this(monkeypatch, broken)
    with pytest.raises(BeatModelError) as error:
        BeatThisModel().activations(tmp_path / "audio.wav")
    assert str(error.value) == "Beat This could not analyse the recording."
    assert isinstance(error.value, ValueError)


class _Tensor:
    def __init__(self, values: np.ndarray) -> None:
        self.values = values

    def cpu(self) -> "_Tensor":
        return self

    def numpy(self) -> np.ndarray:
        return self.values


def test_the_adapter_runs_the_model_once_per_recording(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[int] = []

    def frames(signal: np.ndarray, sample_rate: int) -> tuple[_Tensor, _Tensor]:
        calls.append(sample_rate)
        return _Tensor(np.full(100, -1.0, dtype=np.float32)), _Tensor(np.zeros(100, np.float32))

    stub_beat_this(monkeypatch, frames)
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"RIFF")
    model = BeatThisModel()
    first = model.activations(wav)
    assert first.fps == FPS and first.beat_logits.shape == (100,)
    model.activations(wav)
    assert len(calls) == 1
    wav.write_bytes(b"RIFF changed")
    model.activations(wav)
    assert len(calls) == 2


def click_track(
    path: Path, seconds: float = 20.0, bpm: float = 120.0, beats_per_bar: int = 4
) -> np.ndarray:
    """A 22.05 kHz mono WAV of clicks, each bar's first louder and lower. Returns the beat times."""
    rate = 22050
    signal = np.zeros(int(seconds * rate))
    beats = np.arange(0.5, seconds - 0.5, 60.0 / bpm)
    t = np.arange(int(0.05 * rate)) / rate
    for number, beat in enumerate(beats):
        accent = number % beats_per_bar == 0
        tone = np.sin(2 * np.pi * (1000.0 if accent else 1800.0) * t) * np.exp(-t * 80)
        start = int(beat * rate)
        signal[start : start + tone.size] += (0.9 if accent else 0.5) * tone
    pcm = (np.clip(signal, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    return beats


@pytest.mark.real
@needs_beat_extra
def test_beat_this_finds_the_beats_of_a_click_track(tmp_path: Path) -> None:
    wav = tmp_path / "clicks.wav"
    clicks = click_track(wav)
    model = BeatThisModel()
    activations = model.activations(wav)
    track = model.beats(wav)
    assert activations.fps == FPS
    assert activations.beat_logits.shape == activations.downbeat_logits.shape
    assert activations.beat_logits.shape[0] == pytest.approx(20.0 * FPS, abs=2)
    found = np.asarray(track.beats)
    near = [np.min(np.abs(found - c)) <= 0.030 for c in clicks]
    assert np.mean(near) >= 0.8, f"{sum(near)} of {len(clicks)} clicks have a beat within 30 ms"
    assert set(track.downbeats) <= set(track.beats)


@pytest.mark.real
@needs_beat_extra
def test_beat_this_gives_one_sentence_for_a_file_it_cannot_read(tmp_path: Path) -> None:
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"not audio at all")
    with pytest.raises(BeatModelError, match="could not"):
        BeatThisModel().activations(broken)
