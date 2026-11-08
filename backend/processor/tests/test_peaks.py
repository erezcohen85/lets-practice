import json
import math

import numpy as np
import pytest

from app.pipeline.peaks import build_peaks


def sine(seconds: float, sample_rate: int, amplitude: float, freq: float = 220.0) -> np.ndarray:
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    return amplitude * np.sin(2 * np.pi * freq * t)


def test_sine_half_amplitude_gives_about_64_per_bucket() -> None:
    peaks = build_peaks(sine(1.0, 22050, 0.5), 22050, 256)
    assert peaks["length"] == math.ceil(22050 / 256)
    assert len(peaks["data"]) == peaks["length"]
    # the last bucket is partial (22050 is not a multiple of 256): skip it in the amplitude check
    assert all(abs(v - 64) <= 2 for v in peaks["data"][:-1])


def test_output_has_exactly_the_documented_keys_and_values() -> None:
    peaks = build_peaks(sine(0.5, 22050, 0.5), 22050, 256)
    assert set(peaks) == {
        "version",
        "channels",
        "sample_rate",
        "samples_per_pixel",
        "bits",
        "length",
        "data",
    }
    assert peaks["version"] == 2
    assert peaks["channels"] == 1
    assert peaks["bits"] == 8
    assert peaks["sample_rate"] == 22050
    assert peaks["samples_per_pixel"] == 256


def test_samples_per_pixel_defaults_to_256_and_is_echoed() -> None:
    samples = sine(1.0, 8000, 0.5)
    default = build_peaks(samples, 8000)
    assert default["samples_per_pixel"] == 256
    assert default["length"] == math.ceil(8000 / 256)
    coarse = build_peaks(samples, 8000, samples_per_pixel=1000)
    assert coarse["samples_per_pixel"] == 1000
    assert coarse["length"] == 8


def test_silence_gives_zeros() -> None:
    peaks = build_peaks(np.zeros(22050), 22050, 256)
    assert peaks["length"] == math.ceil(22050 / 256)
    assert peaks["data"] == [0] * peaks["length"]


def test_two_dimensional_input_raises() -> None:
    stereo = np.zeros((2, 22050))
    with pytest.raises(ValueError):
        build_peaks(stereo, 22050)


def test_empty_input_gives_length_zero() -> None:
    peaks = build_peaks(np.array([], dtype=np.float64), 22050)
    assert peaks["length"] == 0
    assert peaks["data"] == []


def test_data_is_one_sided_absolute_value_scaled_to_127() -> None:
    samples = np.zeros(4 * 8)
    samples[3] = -1.0  # bucket 0: full-scale negative sample counts by its magnitude
    samples[8 + 2] = 0.5  # bucket 1
    samples[16 + 5] = -0.25  # bucket 2
    peaks = build_peaks(samples, 8000, samples_per_pixel=8)
    assert peaks["data"] == [127, 64, 32, 0]


def test_values_are_clipped_to_0_127() -> None:
    peaks = build_peaks(np.array([2.0, -3.0, 0.0, 0.0]), 8000, samples_per_pixel=2)
    assert peaks["data"] == [127, 0]


def test_partial_last_bucket_uses_only_its_own_samples() -> None:
    samples = np.concatenate([np.full(8, 1.0), np.full(3, 0.5)])
    peaks = build_peaks(samples, 8000, samples_per_pixel=8)
    assert peaks["length"] == 2
    assert peaks["data"] == [127, 64]


def test_data_values_are_plain_ints_and_json_serialisable() -> None:
    rng = np.random.default_rng(7)
    peaks = build_peaks(rng.uniform(-1, 1, 5000), 22050, 256)
    assert all(type(v) is int and 0 <= v <= 127 for v in peaks["data"])
    assert type(peaks["length"]) is int
    assert json.loads(json.dumps(peaks)) == peaks


def test_float32_input_is_accepted() -> None:
    peaks = build_peaks(sine(0.25, 22050, 0.5).astype(np.float32), 22050, 256)
    assert peaks["length"] == math.ceil(5512 / 256)
    assert all(abs(v - 64) <= 2 for v in peaks["data"][:-1])


def test_samples_per_pixel_below_one_raises() -> None:
    with pytest.raises(ValueError):
        build_peaks(np.zeros(100), 22050, samples_per_pixel=0)
