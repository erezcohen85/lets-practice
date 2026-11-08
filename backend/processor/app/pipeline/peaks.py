import numpy as np


def build_peaks(samples: np.ndarray, sample_rate: int, samples_per_pixel: int = 256) -> dict:
    """One-sided waveform peaks JSON: max |sample| per bucket, scaled so 1.0 is 127."""
    audio = np.asarray(samples, dtype=np.float64)
    if audio.ndim != 1:
        raise ValueError(f"peaks need mono samples (1-D), got {audio.ndim}-D")
    if samples_per_pixel < 1:
        raise ValueError("samples_per_pixel must be at least 1")
    length = -(-audio.size // samples_per_pixel)
    padded = np.zeros(length * samples_per_pixel)
    padded[: audio.size] = np.abs(audio)
    buckets = padded.reshape(length, samples_per_pixel).max(axis=1)
    data = np.clip(np.rint(buckets * 127), 0, 127).astype(int).tolist()
    return {
        "version": 2,
        "channels": 1,
        "sample_rate": sample_rate,
        "samples_per_pixel": samples_per_pixel,
        "bits": 8,
        "length": length,
        "data": data,
    }
