from dataclasses import dataclass

import numpy as np

# Synthetic downbeat activations for the alignment tests: Gaussian bumps at known times, plus noise.


def bump_curve(
    times_sec: list[float],
    duration_sec: float,
    fps: float = 50.0,
    height: float = 1.0,
    width_sec: float = 0.03,
) -> np.ndarray:
    """Sum of Gaussian bumps (peak `height`, sigma `width_sec`) at `times_sec`, one value/frame."""
    frame_times = np.arange(round(duration_sec * fps)) / fps
    curve = np.zeros(frame_times.shape)
    for t in times_sec:
        curve += height * np.exp(-0.5 * ((frame_times - t) / width_sec) ** 2)
    return curve


def add_noise(curve: np.ndarray, rng: np.random.Generator, level: float) -> np.ndarray:
    """A copy of `curve` plus Gaussian noise of standard deviation `level`, floored at zero."""
    return np.maximum(curve + rng.normal(0.0, level, curve.shape), 0.0)


def bar_times(bar_lengths: list[float], sec_per_whole: float, start: float = 0.5) -> list[float]:
    """Downbeat time of each bar; bar lengths are in whole notes (4/4 is 1.0, 3/4 is 0.75)."""
    times: list[float] = []
    t = start
    for length in bar_lengths:
        times.append(t)
        t += length * sec_per_whole
    return times


def logit_curves(
    beat_times_sec: list[float],
    downbeat_times_sec: list[float],
    duration_sec: float,
    fps: float = 50.0,
    peak: float = 6.0,
    floor: float = -6.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Beat and downbeat logits as Beat This gives them: `peak` at the given times, else `floor`."""
    frames = round(duration_sec * fps)
    curves = []
    for times in (beat_times_sec, downbeat_times_sec):
        logits = np.full(frames, floor)
        logits[np.clip(np.rint(np.asarray(times) * fps).astype(int), 0, frames - 1)] = peak
        curves.append(logits)
    return curves[0], curves[1]


@dataclass(frozen=True)
class JitteredPiece:
    """Beats and logits of a long 4/4 piece with held fermata bars and slowing rit. bars."""

    beats: np.ndarray
    beat_logits: np.ndarray
    downbeat_logits: np.ndarray
    starts: list[float]  # true start of every slot
    fermatas: set[int]
    rits: set[int]


def jittered_piece(slots: int, seed: int = 1, every: int = 90) -> JitteredPiece:
    """`slots` bars of 4 beats at 120 BPM with 4 ms of jitter on every beat.

    Every `every` slots (from slot 40) a fermata bar is held 2 s longer with one extra beat heard
    in the hold, and the two bars before it slow down a little (the rit. slots).
    """
    rng = np.random.default_rng(seed)
    fermatas = set(range(40, slots, every))
    rits = {slot for f in fermatas for slot in (f - 2, f - 1)}
    beats: list[float] = []
    starts: list[float] = []
    t = 1.0
    for slot in range(slots):
        starts.append(t)
        period = 0.5 * (1.0 + 0.04 * (slot % 5)) if slot in rits else 0.5
        beats += [t + k * period + rng.normal(0.0, 0.004) for k in range(4)]
        t += 4 * period
        if slot in fermatas:
            beats.append(t + 0.9)
            t += 2.0
    beat_logits, downbeat_logits = logit_curves(beats, starts, t + 3.0)
    return JitteredPiece(np.array(beats), beat_logits, downbeat_logits, starts, fermatas, rits)
