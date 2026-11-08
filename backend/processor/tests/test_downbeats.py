import numpy as np
import pytest

from app.pipeline.downbeats import pick_downbeat_peaks
from tests.synthetic import add_noise, bar_times, bump_curve

FPS = 50.0


def curve_with(heights_at: dict[float, float], duration: float = 10.0) -> np.ndarray:
    """Sum of bumps of the given heights at the given times."""
    curve = np.zeros(int(round(duration * FPS)))
    for t, h in heights_at.items():
        curve += bump_curve([t], duration, FPS, height=h)
    return curve


# --- pick_downbeat_peaks ---------------------------------------------------------------------


def test_finds_every_bump_of_a_clean_curve_within_one_frame() -> None:
    truth = bar_times([1.0] * 30, sec_per_whole=2.0, start=0.5)
    curve = bump_curve(truth, duration_sec=65.0, fps=FPS)
    found = pick_downbeat_peaks(curve, FPS)
    assert len(found) == len(truth)
    assert all(abs(f - t) <= 1 / FPS for f, t in zip(found, truth, strict=True))


def test_times_are_frame_index_over_fps() -> None:
    activation = np.zeros(500)
    activation[[100, 250, 400]] = 1.0
    assert pick_downbeat_peaks(activation, 50.0) == [2.0, 5.0, 8.0]
    assert pick_downbeat_peaks(activation, 100.0) == [1.0, 2.5, 4.0]


def test_returns_ascending_python_floats() -> None:
    rng = np.random.default_rng(3)
    truth = bar_times([1.0, 1.0, 0.75, 1.0, 0.75, 1.0], sec_per_whole=2.0, start=0.4)
    curve = add_noise(bump_curve(truth, 15.0, FPS), rng, 0.05)
    found = pick_downbeat_peaks(curve, FPS)
    assert found == sorted(found)
    assert len(found) >= 1
    assert all(type(t) is float for t in found)


def test_ignores_bumps_under_the_threshold() -> None:
    curve = curve_with({1.0: 0.2, 3.0: 0.9, 5.0: 0.29, 7.0: 0.5})
    found = pick_downbeat_peaks(curve, FPS, threshold=0.3)
    assert found == pytest.approx([3.0, 7.0], abs=1 / FPS)


def test_a_peak_exactly_at_the_threshold_is_kept() -> None:
    activation = np.zeros(100)
    activation[40] = 0.3
    activation[80] = 0.299
    assert pick_downbeat_peaks(activation, FPS, threshold=0.3) == [40 / FPS]


def test_close_peaks_keep_the_higher_one() -> None:
    first_higher = curve_with({2.0: 0.9, 2.2: 0.6, 6.0: 0.7})
    assert pick_downbeat_peaks(first_higher, FPS, min_distance_sec=0.4) == pytest.approx(
        [2.0, 6.0], abs=1 / FPS
    )
    second_higher = curve_with({2.0: 0.6, 2.2: 0.9, 6.0: 0.7})
    assert pick_downbeat_peaks(second_higher, FPS, min_distance_sec=0.4) == pytest.approx(
        [2.2, 6.0], abs=1 / FPS
    )


def test_equal_close_peaks_keep_the_earlier_one() -> None:
    activation = np.zeros(200)
    activation[[50, 60]] = 0.8
    assert pick_downbeat_peaks(activation, FPS, min_distance_sec=0.4) == [50 / FPS]


def test_a_suppressed_peak_does_not_suppress_its_other_neighbour() -> None:
    # 0.9 at 1.0 s wins over 0.8 at 1.3 s; the 0.7 at 1.6 s is 0.6 s from the winner, so it stays
    activation = np.zeros(200)
    activation[[50, 65, 80]] = [0.9, 0.8, 0.7]
    assert pick_downbeat_peaks(activation, FPS, min_distance_sec=0.4) == [1.0, 1.6]


def test_peaks_exactly_min_distance_apart_are_both_kept() -> None:
    activation = np.zeros(200)
    activation[[50, 70]] = [0.9, 0.8]  # 20 frames = 0.4 s apart
    assert pick_downbeat_peaks(activation, FPS, min_distance_sec=0.4) == [1.0, 1.4]


def test_a_flat_topped_peak_counts_once_at_its_first_frame() -> None:
    activation = np.zeros(100)
    activation[30:34] = 0.7
    assert pick_downbeat_peaks(activation, FPS) == [30 / FPS]


def test_a_plateau_that_keeps_rising_is_not_a_peak() -> None:
    activation = np.zeros(100)
    activation[30:33] = 0.5
    activation[33] = 0.9
    assert pick_downbeat_peaks(activation, FPS) == [33 / FPS]


def test_peaks_at_the_first_and_last_frame_are_found() -> None:
    activation = np.zeros(100)
    activation[0] = 0.8
    activation[99] = 0.7
    assert pick_downbeat_peaks(activation, FPS, min_distance_sec=0.4) == [0.0, 99 / FPS]


def test_empty_activation_gives_no_peaks() -> None:
    assert pick_downbeat_peaks(np.array([]), FPS) == []


def test_all_zero_activation_gives_no_peaks() -> None:
    assert pick_downbeat_peaks(np.zeros(500), FPS) == []


def test_two_dimensional_activation_raises() -> None:
    with pytest.raises(ValueError):
        pick_downbeat_peaks(np.zeros((2, 100)), FPS)


def test_non_positive_fps_raises() -> None:
    with pytest.raises(ValueError):
        pick_downbeat_peaks(np.zeros(100), 0.0)


# --- tests/synthetic.py helpers ------------------------------------------------------------


def test_bump_curve_has_the_right_length_and_peaks_at_each_time() -> None:
    curve = bump_curve([1.0, 3.0], duration_sec=5.0, fps=50.0, height=0.6)
    assert curve.shape == (250,)
    assert curve[50] == pytest.approx(0.6)
    assert curve[150] == pytest.approx(0.6)
    assert curve.max() == pytest.approx(0.6)
    assert curve[0] < 1e-6  # far from every bump


def test_bump_curve_width_sets_the_gaussian_spread() -> None:
    curve = bump_curve([2.0], duration_sec=4.0, fps=100.0, width_sec=0.05)
    # one sigma away the Gaussian is exp(-1/2) of its peak
    assert curve[200 + 5] == pytest.approx(np.exp(-0.5))


def test_bump_curve_without_bumps_is_all_zero() -> None:
    assert not bump_curve([], duration_sec=2.0, fps=50.0).any()


def test_bump_curve_sums_overlapping_bumps() -> None:
    curve = bump_curve([1.0, 1.0], duration_sec=2.0, fps=50.0, height=0.4)
    assert curve[50] == pytest.approx(0.8)


def test_add_noise_is_repeatable_with_the_same_seed_and_leaves_the_input_alone() -> None:
    curve = bump_curve([1.0], duration_sec=3.0)
    before = curve.copy()
    a = add_noise(curve, np.random.default_rng(11), 0.1)
    b = add_noise(curve, np.random.default_rng(11), 0.1)
    assert np.array_equal(a, b)
    assert np.array_equal(curve, before)
    assert not np.array_equal(a, curve)


def test_add_noise_keeps_the_curve_non_negative_and_level_zero_changes_nothing() -> None:
    curve = np.zeros(1000)
    noisy = add_noise(curve, np.random.default_rng(5), 0.2)
    assert noisy.min() >= 0.0
    assert noisy.max() > 0.0
    assert np.array_equal(add_noise(curve + 0.3, np.random.default_rng(5), 0.0), curve + 0.3)


def test_bar_times_accumulates_bar_lengths_from_the_start() -> None:
    assert bar_times([1.0, 1.0, 0.75, 0.75], sec_per_whole=2.0) == pytest.approx(
        [0.5, 2.5, 4.5, 6.0]
    )
    assert bar_times([1.0, 0.5], sec_per_whole=2.0, start=0.0) == pytest.approx([0.0, 2.0])


def test_bar_times_gives_one_time_per_bar_and_nothing_for_no_bars() -> None:
    assert len(bar_times([1.0] * 12, sec_per_whole=2.0)) == 12
    assert bar_times([], sec_per_whole=2.0) == []
