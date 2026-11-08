import time

import numpy as np
import pytest

from app.pipeline.align import (
    ANCHOR_SNAP,
    AlignParams,
    NoAlignmentError,
    align_bars,
    align_downbeats,
    realign,
    realign_bars,
    tempo_limits,
    unused_beat_share,
)
from app.pipeline.downbeats import pick_downbeat_peaks
from app.pipeline.models import Locator
from tests.synthetic import add_noise, bar_times, bump_curve, jittered_piece, logit_curves

FPS = 50.0


def curve_for(truth: list[float], height: float = 1.0, tail_sec: float = 3.0) -> np.ndarray:
    """Clean activation with a bump of `height` at each true downbeat."""
    return bump_curve(truth, truth[-1] + tail_sec, FPS, height=height)


def max_error(found: list[float], truth: list[float]) -> float:
    return max(abs(f - t) for f, t in zip(found, truth, strict=True))


def median_error(found: list[float], truth: list[float]) -> float:
    return float(np.median([abs(f - t) for f, t in zip(found, truth, strict=True)]))


def raw_median_error(raw_peaks: list[float], truth: list[float]) -> float:
    """Each true downbeat's distance to the nearest raw peak, median over the downbeats."""
    peaks = np.asarray(raw_peaks)
    return float(np.median([np.min(np.abs(peaks - t)) for t in truth]))


# --- exactly N, clean curves -------------------------------------------------------------------


def test_clean_curve_gives_exactly_n_times_within_20_ms() -> None:
    lengths = [1.0] * 40  # 40 bars of 4/4 at 2.0 s
    truth = bar_times(lengths, sec_per_whole=2.0, start=0.5)
    found = align_downbeats(curve_for(truth), lengths)
    assert len(found) == 40
    assert max_error(found, truth) <= 0.020
    assert all(b > a for a, b in zip(found, found[1:], strict=False))
    assert all(type(t) is float for t in found)


def test_meter_change_keeps_the_same_pulse_within_20_ms() -> None:
    lengths = [1.0] * 20 + [0.75] * 20  # 4/4 at 2.0 s, then 3/4 at 1.5 s: same pulse
    truth = bar_times(lengths, sec_per_whole=2.0, start=0.5)
    found = align_downbeats(curve_for(truth), lengths)
    assert len(found) == 40
    assert max_error(found, truth) <= 0.020


def test_a_meter_change_is_not_a_tempo_change() -> None:
    # a spurious, stronger bump sits where a 4/4 bar would have ended, 0.5 s after the true first
    # 3/4 bar line; tempo is length / duration, so the true 1.5 s bars are the smooth path
    lengths = [1.0] * 10 + [0.75] * 10
    truth = bar_times(lengths, sec_per_whole=2.0, start=0.5)
    curve = curve_for(truth, height=0.6) + bump_curve([truth[9] + 2.5], truth[-1] + 3.0, FPS, 0.9)
    found = align_downbeats(curve, lengths)
    assert max_error(found, truth) <= 0.020


def test_a_ritardando_is_followed() -> None:
    # bars slow from 2.0 s to 3.0 s; the smooth tempo penalty is small for such gradual change
    lengths = [1.0] * 40
    truth = [0.5]
    for i in range(39):
        truth.append(truth[-1] + 2.0 + i * (1.0 / 39))
    mid_bars = [(truth[i] + truth[i + 1]) / 2 for i in range(0, 39, 3)]
    duration = truth[-1] + 4.0
    curve = bump_curve(truth, duration, FPS, 0.6) + bump_curve(mid_bars, duration, FPS, 0.9)
    found = align_downbeats(add_noise(curve, np.random.default_rng(3), 0.05), lengths)
    assert max_error(found, truth) < 0.05


def test_result_is_deterministic() -> None:
    lengths = [1.0] * 12
    truth = bar_times(lengths, sec_per_whole=2.0)
    curve = add_noise(curve_for(truth), np.random.default_rng(5), 0.05)
    assert align_downbeats(curve, lengths) == align_downbeats(curve, lengths)


def test_no_bars_gives_no_times() -> None:
    assert align_downbeats(np.zeros(100), []) == []


def test_single_bar_is_the_strongest_candidate() -> None:
    curve = bump_curve([1.0], 3.0, FPS, 0.5) + bump_curve([2.0], 3.0, FPS, 0.8)
    assert align_downbeats(curve, [1.0]) == pytest.approx([2.0], abs=1 / FPS)


def test_two_bars_have_no_tempo_term() -> None:
    curve = bump_curve([0.5, 2.5], 5.0, FPS)
    assert align_downbeats(curve, [1.0, 1.0]) == pytest.approx([0.5, 2.5], abs=1 / FPS)


def test_times_are_refined_below_one_frame() -> None:
    # truth halfway between two frames: the parabolic peak estimate lands closer than a frame
    lengths = [1.0] * 6
    truth = bar_times(lengths, sec_per_whole=2.0, start=0.51)
    found = align_downbeats(curve_for(truth), lengths)
    assert max_error(found, truth) < 0.005


# --- noisy curve: the point of the algorithm ---------------------------------------------------


def noisy_case(seed: int = 7) -> tuple[np.ndarray, list[float], list[float]]:
    """40 bars, truth off the frame grid; true bumps 0.6, spurious 0.9 at mid-bar every 3rd bar."""
    lengths = [1.0] * 40
    truth = bar_times(lengths, sec_per_whole=2.013, start=0.513)
    duration = truth[-1] + 3.0
    mid_bars = [(truth[i] + truth[i + 1]) / 2 for i in range(0, 39, 3)]
    curve = bump_curve(truth, duration, FPS, height=0.6)
    curve += bump_curve(mid_bars, duration, FPS, height=0.9)
    return add_noise(curve, np.random.default_rng(seed), 0.05), truth, lengths


def test_noisy_curve_gives_exactly_n_and_beats_raw_peak_picking() -> None:
    curve, truth, lengths = noisy_case()
    raw = pick_downbeat_peaks(curve, FPS)
    assert len(raw) != len(truth)  # the raw picker keeps the spurious mid-bar peaks

    found = align_downbeats(curve, lengths)
    assert len(found) == 40
    assert all(b > a for a, b in zip(found, found[1:], strict=False))
    assert median_error(found, truth) < raw_median_error(raw, truth)
    assert max_error(found, truth) < 0.05  # and no spurious bump took a bar line


def test_noisy_curves_hold_across_seeds() -> None:
    for seed in range(8):
        curve, truth, lengths = noisy_case(seed)
        found = align_downbeats(curve, lengths)
        raw = pick_downbeat_peaks(curve, FPS)
        assert len(found) == 40
        assert max_error(found, truth) < 0.05, f"seed {seed}"
        assert median_error(found, truth) < raw_median_error(raw, truth), f"seed {seed}"


def share_within(errors: list[float], limit: float) -> float:
    return sum(e <= limit for e in errors) / len(errors)


def test_aligned_bar_map_beats_labelling_raw_peaks_in_order() -> None:
    # an audio-only system takes the first N raw peaks as bars 1..N; every spurious peak before
    # a bar shifts all the later labels by one bar, so the score (the meter map) is what fixes it
    curve, truth, lengths = noisy_case()
    raw = pick_downbeat_peaks(curve, FPS)
    assert len(raw) >= len(truth)
    raw_errors = [abs(r - t) for r, t in zip(raw, truth, strict=False)]  # raw[k] labelled bar k
    aligned_errors = [
        abs(a - t) for a, t in zip(align_downbeats(curve, lengths), truth, strict=True)
    ]

    assert max(aligned_errors) < 0.050
    assert float(np.median(raw_errors)) > 0.100
    assert share_within(aligned_errors, 0.100) == 1.0
    assert share_within(raw_errors, 0.100) < 0.5


# --- impossible cases --------------------------------------------------------------------------


def test_fewer_candidates_than_bars_raises() -> None:
    curve = bump_curve([0.5, 2.5, 4.5, 6.5, 8.5], 12.0, FPS)
    with pytest.raises(ValueError, match="no valid"):
        align_downbeats(curve, [1.0] * 10)


def test_no_candidates_at_all_raises() -> None:
    with pytest.raises(ValueError):
        align_downbeats(np.zeros(500), [1.0] * 3)
    with pytest.raises(ValueError):
        align_downbeats(np.zeros(500), [1.0])


def test_candidates_closer_than_the_minimum_bar_raise() -> None:
    curve = bump_curve([1.0, 1.2, 1.4, 1.6, 1.8], 4.0, FPS)  # 0.2 s apart; a bar needs >= 0.4 s
    with pytest.raises(ValueError):
        align_downbeats(curve, [1.0] * 5)


def test_min_bar_is_scaled_by_the_bar_length() -> None:
    # 0.2 s apart is fine for bars of 0.25 whole notes (min 0.1 s) but not for whole-note bars
    curve = bump_curve([1.0, 1.2, 1.4, 1.6], 4.0, FPS)
    assert len(align_downbeats(curve, [0.25] * 4)) == 4
    with pytest.raises(ValueError):
        align_downbeats(curve, [1.0] * 4)


def test_gap_longer_than_the_maximum_bar_raises() -> None:
    curve = bump_curve([1.0, 3.0, 20.0], 25.0, FPS)  # 17 s hole; a bar is at most 8 s
    with pytest.raises(ValueError):
        align_downbeats(curve, [1.0] * 3)
    # a wider limit lets the same curve align
    wide = AlignParams(max_bar_sec=20.0)
    assert len(align_downbeats(curve, [1.0] * 3, wide)) == 3


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan")])
def test_non_positive_bar_length_raises(bad: float) -> None:
    with pytest.raises(ValueError):
        align_downbeats(np.zeros(100), [1.0, bad])


def test_two_dimensional_activation_raises() -> None:
    with pytest.raises(ValueError):
        align_downbeats(np.zeros((2, 100)), [1.0])


# --- candidate threshold -----------------------------------------------------------------------


def test_bumps_under_the_candidate_threshold_are_not_candidates() -> None:
    lengths = [1.0] * 4
    truth = bar_times(lengths, sec_per_whole=2.0)
    curve = curve_for(truth, height=0.04)
    with pytest.raises(ValueError):
        align_downbeats(curve, lengths)
    assert len(align_downbeats(curve, lengths, AlignParams(candidate_threshold=0.01))) == 4


# --- anchors -----------------------------------------------------------------------------------


def test_an_anchor_is_returned_exactly_even_off_a_local_maximum() -> None:
    lengths = [1.0] * 12
    truth = bar_times(lengths, sec_per_whole=2.0)
    anchor = truth[5] + 0.0731  # on the shoulder of the bump, not at a peak
    found = align_downbeats(curve_for(truth), lengths, anchors={5: anchor})
    assert found[5] == anchor
    assert len(found) == 12
    assert all(b > a for a, b in zip(found, found[1:], strict=False))
    assert max_error(found[:5], truth[:5]) <= 0.02
    assert max_error(found[6:], truth[6:]) <= 0.02


def test_an_anchor_in_a_silent_stretch_is_still_a_slot() -> None:
    lengths = [1.0] * 8
    truth = bar_times(lengths, sec_per_whole=2.0)
    curve = bump_curve([t for i, t in enumerate(truth) if i != 4], truth[-1] + 3.0, FPS)
    found = align_downbeats(curve, lengths, anchors={4: truth[4]})
    assert found[4] == truth[4]
    assert max_error(found, truth) <= 0.02


def test_anchors_on_the_clean_curve_leave_the_rest_in_place() -> None:
    lengths = [1.0] * 10
    truth = bar_times(lengths, sec_per_whole=2.0)
    anchors = {0: truth[0], 9: truth[9]}
    found = align_downbeats(curve_for(truth), lengths, anchors=anchors)
    assert found[0] == truth[0] and found[9] == truth[9]
    assert max_error(found, truth) <= 0.02


def test_an_anchor_on_a_spurious_bump_pulls_its_neighbours() -> None:
    lengths = [1.0] * 12
    truth = bar_times(lengths, sec_per_whole=2.0)
    spurious = truth[6] + 0.6
    curve = curve_for(truth, height=0.6) + bump_curve([spurious], truth[-1] + 3.0, FPS, 0.9)
    found = align_downbeats(curve, lengths, anchors={6: spurious})
    assert found[6] == spurious
    assert len(found) == 12
    assert all(b > a for a, b in zip(found, found[1:], strict=False))


def test_anchors_out_of_time_order_raise() -> None:
    lengths = [1.0] * 6
    truth = bar_times(lengths, sec_per_whole=2.0)
    with pytest.raises(ValueError, match="order"):
        align_downbeats(curve_for(truth), lengths, anchors={1: truth[3], 3: truth[1]})


def test_anchor_on_a_slot_that_does_not_exist_raises() -> None:
    lengths = [1.0] * 4
    truth = bar_times(lengths, sec_per_whole=2.0)
    with pytest.raises(ValueError, match="slot"):
        align_downbeats(curve_for(truth), lengths, anchors={4: truth[3]})
    with pytest.raises(ValueError, match="slot"):
        align_downbeats(curve_for(truth), lengths, anchors={-1: truth[0]})


def test_anchors_that_break_the_spacing_limits_raise() -> None:
    lengths = [1.0] * 6
    truth = bar_times(lengths, sec_per_whole=2.0)
    with pytest.raises(ValueError, match="no valid"):
        align_downbeats(curve_for(truth), lengths, anchors={2: truth[2], 3: truth[2] + 0.1})


# --- realign: confirmed locators are fixed anchors ---------------------------------------------


def locator(slot: int, time_sec: float, confirmed: bool = True) -> Locator:
    return Locator(bar=slot + 1, pass_index=0, time_sec=time_sec, confirmed=confirmed)


def by_slot(count: int, confirmed: dict[int, float]) -> list[Locator | None]:
    """`count` slots, a confirmed locator where `confirmed` has a time, no locator elsewhere."""
    return [locator(i, confirmed[i]) if i in confirmed else None for i in range(count)]


def strictly_increasing(times: list[float]) -> bool:
    return all(b > a for a, b in zip(times, times[1:], strict=False))


def test_confirmed_locators_never_move_on_the_clean_curve() -> None:
    lengths = [1.0] * 12
    truth = bar_times(lengths, sec_per_whole=2.0)
    confirmed = {0: truth[0], 4: truth[4] + 0.0314, 11: truth[11] - 0.0577}  # two are off-peak
    found = realign(curve_for(truth), lengths, by_slot(12, confirmed))
    assert len(found) == 12
    assert all(found[slot] == time for slot, time in confirmed.items())  # exact, not approx
    assert all(type(t) is float for t in found)
    assert strictly_increasing(found)
    free = [i for i in range(12) if i not in confirmed]
    assert max_error([found[i] for i in free], [truth[i] for i in free]) <= 0.02


def test_confirmed_locators_never_move_on_the_noisy_curve() -> None:
    curve, truth, lengths = noisy_case()
    confirmed = {3: truth[3], 17: truth[17] + 0.0731, 30: truth[30] - 0.04, 39: truth[39]}
    found = realign(curve, lengths, by_slot(40, confirmed))
    assert len(found) == 40
    assert all(found[slot] == time for slot, time in confirmed.items())
    assert strictly_increasing(found)
    free = [i for i in range(40) if i not in confirmed]
    assert max_error([found[i] for i in free], [truth[i] for i in free]) < 0.05


def test_an_anchor_on_a_spurious_bump_is_kept_and_its_neighbours_are_refit() -> None:
    lengths = [1.0] * 12
    truth = bar_times(lengths, sec_per_whole=2.0)
    spurious = truth[6] + 0.6  # a stronger bump, not a bar line
    curve = curve_for(truth, height=0.6) + bump_curve([spurious], truth[-1] + 3.0, FPS, 0.9)
    unfixed = realign(curve, lengths, [None] * 12)
    assert abs(unfixed[6] - truth[6]) <= 0.02  # unanchored, the true bump wins the slot

    found = realign(curve, lengths, by_slot(12, {6: spurious}))
    assert found[6] == spurious
    assert len(found) == 12
    assert strictly_increasing(found)
    params = AlignParams()
    assert params.min_bar_sec <= spurious - found[5] <= params.max_bar_sec
    assert params.min_bar_sec <= found[7] - spurious <= params.max_bar_sec
    assert abs(found[5] - truth[5]) <= 0.02  # the neighbours are refit onto the true bumps
    assert abs(found[7] - truth[7]) <= 0.02


def test_an_anchor_off_any_peak_is_kept_exactly() -> None:
    lengths = [1.0] * 10
    truth = bar_times(lengths, sec_per_whole=2.0)
    off_peak = truth[3] + 1.0  # mid-bar, where the curve is flat zero
    found = realign(curve_for(truth), lengths, by_slot(10, {3: off_peak}))
    assert found[3] == off_peak
    assert len(found) == 10
    assert strictly_increasing(found)
    params = AlignParams()
    assert params.min_bar_sec <= off_peak - found[2] <= params.max_bar_sec
    assert params.min_bar_sec <= found[4] - off_peak <= params.max_bar_sec


def test_all_confirmed_returns_exactly_their_times() -> None:
    lengths = [1.0] * 8
    truth = bar_times(lengths, sec_per_whole=2.0)
    times = [t + 0.0137 * (i % 3) for i, t in enumerate(truth)]  # off the curve's peaks
    found = realign(curve_for(truth), lengths, by_slot(8, dict(enumerate(times))))
    assert found == times


def test_all_confirmed_does_not_search_for_peaks() -> None:
    # a silent curve has no candidates and these bars are 0.1 s apart (a bar needs >= 0.4 s): the
    # alignment would raise, but with every locator confirmed there is nothing to fit
    times = [1.0, 1.1, 1.2, 1.3]
    found = realign(np.zeros(500), [1.0] * 4, by_slot(4, dict(enumerate(times))))
    assert found == times


def test_no_confirmed_locators_is_the_plain_alignment() -> None:
    curve, _, lengths = noisy_case()
    plain = align_downbeats(curve, lengths)
    assert realign(curve, lengths, [None] * 40) == plain
    unconfirmed = [locator(i, 0.0, confirmed=False) for i in range(40)]
    assert realign(curve, lengths, unconfirmed) == plain


def test_unconfirmed_old_times_are_ignored() -> None:
    curve, truth, lengths = noisy_case()
    confirmed = {5: truth[5], 20: truth[20] + 0.05}
    clean = by_slot(40, confirmed)
    noisy: list[Locator | None] = list(clean)
    for i in (0, 4, 6, 19, 21, 39):  # old, wildly wrong times that are not confirmed
        noisy[i] = locator(i, truth[i] + (37.0 if i % 2 else -9.0), confirmed=False)
    assert realign(curve, lengths, noisy) == realign(curve, lengths, clean)


def test_only_unconfirmed_slots_between_and_around_anchors_are_refit() -> None:
    lengths = [1.0] * 12
    truth = bar_times(lengths, sec_per_whole=2.0)
    old = [t + 0.3 for t in truth]  # an earlier, shifted fit of every slot
    locators = [locator(i, old[i], confirmed=i in (2, 9)) for i in range(12)]
    found = realign(curve_for(truth), lengths, locators)
    assert found[2] == old[2] and found[9] == old[9]  # the user's two fixes survive
    free = [i for i in range(12) if i not in (2, 9)]
    assert max_error([found[i] for i in free], [truth[i] for i in free]) <= 0.02


def test_no_bars_gives_no_times_on_realign() -> None:
    assert realign(np.zeros(100), [], []) == []


@pytest.mark.parametrize("count", [3, 5])
def test_realign_slot_count_must_match_the_bar_lengths(count: int) -> None:
    lengths = [1.0] * 4
    truth = bar_times(lengths, sec_per_whole=2.0)
    with pytest.raises(ValueError, match="slot"):
        realign(curve_for(truth), lengths, [None] * count)


def test_realign_confirmed_anchors_out_of_time_order_raise() -> None:
    lengths = [1.0] * 6
    truth = bar_times(lengths, sec_per_whole=2.0)
    swapped = by_slot(6, {1: truth[3], 3: truth[1]})
    with pytest.raises(ValueError, match="order"):
        realign(curve_for(truth), lengths, swapped)
    every = by_slot(6, dict(enumerate(reversed(truth))))  # all confirmed, backwards
    with pytest.raises(ValueError, match="order"):
        realign(curve_for(truth), lengths, every)


def test_realign_ignores_the_order_of_unconfirmed_times() -> None:
    lengths = [1.0] * 6
    truth = bar_times(lengths, sec_per_whole=2.0)
    curve = curve_for(truth)
    locators: list[Locator | None] = [locator(i, 100.0 - i, confirmed=False) for i in range(6)]
    assert realign(curve, lengths, locators) == align_downbeats(curve, lengths)


def test_realign_confirmed_time_that_is_not_finite_raises() -> None:
    lengths = [1.0] * 3
    truth = bar_times(lengths, sec_per_whole=2.0)
    with pytest.raises(ValueError, match="finite"):
        realign(curve_for(truth), lengths, by_slot(3, {1: float("nan")}))


# --- performance -------------------------------------------------------------------------------


@pytest.mark.slow
def test_200_bars_with_about_2000_candidates_run_in_seconds() -> None:
    lengths = [1.0] * 200
    truth = bar_times(lengths, sec_per_whole=2.0, start=0.5)
    duration = truth[-1] + 3.0
    mid_bars = [t + 1.0 for t in truth[::2]]
    curve = bump_curve(truth, duration, FPS, height=0.6) + bump_curve(mid_bars, duration, FPS, 0.9)
    curve = add_noise(curve, np.random.default_rng(11), 0.04)
    inner = curve[1:-1]
    candidates = int(np.sum((inner > curve[:-2]) & (inner >= curve[2:]) & (inner > 0.05)))
    assert candidates >= 1500  # a meaningful stress, not a clean curve

    started = time.perf_counter()
    found = align_downbeats(curve, lengths)
    elapsed = time.perf_counter() - started

    assert len(found) == 200
    assert max_error(found, truth) < 0.05
    assert elapsed < 10.0


# --- bars from beats and the score (align_bars, realign_bars) -----------------------------------

BEAT = 0.5  # seconds per beat
FIRST = 1.0  # time of beat 1 of slot 0


class BarSignal:
    """Detected beats and Beat This style logits for a run of slots (0-based).

    `per_bar` gives each slot's beat count; beats are `beat` seconds apart and the downbeat logit
    sits on each slot's first beat. `downbeat_late` moves the downbeat logit of the given slots
    that many beats later, as when the audio model hears beat 3 as beat 1. `dropped` removes beats
    by index.
    """

    def __init__(
        self,
        per_bar: list[int],
        downbeat_late: dict[int, int] | None = None,
        dropped: tuple[int, ...] = (),
        beat: float = BEAT,
    ) -> None:
        late = downbeat_late or {}
        grid = FIRST + beat * np.arange(sum(per_bar))
        firsts = np.concatenate([[0], np.cumsum(per_bar)[:-1]])
        self.starts = [float(grid[i]) for i in firsts]  # where the music really starts each slot
        down = [float(grid[i + late.get(slot, 0)]) for slot, i in enumerate(firsts)]
        detected = np.delete(grid, list(dropped))
        self.beats = detected
        self.beat_logits, self.downbeat_logits = logit_curves(
            list(detected), down, float(grid[-1]) + 3.0, FPS
        )

    def align(self, notated: list[int], **rules: object) -> list[float]:
        return align_bars(self.beat_logits, self.downbeat_logits, self.beats, notated, **rules)


def regular(slots: int = 10, per_bar: int = 4) -> tuple[BarSignal, list[int]]:
    return BarSignal([per_bar] * slots), [per_bar] * slots


def test_regular_slots_are_found_with_the_end_of_the_last_one() -> None:
    signal, notated = regular()
    found = signal.align(notated)
    assert len(found) == 11  # a start per slot plus the end of the last slot
    assert found[:-1] == pytest.approx(signal.starts, abs=1 / FPS)
    assert found[-1] == pytest.approx(FIRST + 2.0 * 10, abs=1 / FPS)
    assert all(type(t) is float for t in found)


def test_no_slots_give_no_times() -> None:
    signal, _ = regular()
    assert signal.align([]) == []


def test_a_meter_change_is_followed_by_the_notated_beats() -> None:
    signal = BarSignal([4] * 6 + [3] * 6)
    found = signal.align([4] * 6 + [3] * 6)
    assert found[:-1] == pytest.approx(signal.starts, abs=1 / FPS)


def test_the_comb_prefers_the_bar_whose_inner_beats_are_heard() -> None:
    # a much stronger downbeat logit sits 0.2 s before the true end of slot 0, off the beat grid;
    # the true bar has its three inner beats on detected beats, the decoy bar has none
    signal, notated = regular(3)
    signal.downbeat_logits[round((signal.starts[1] + 0.2) * FPS)] = 11.0
    assert signal.align(notated)[1] == pytest.approx(signal.starts[1], abs=1 / FPS)


def test_a_sudden_tempo_change_costs_more_than_a_slightly_stronger_downbeat() -> None:
    # beats every 0.1 s tell the comb nothing; a downbeat logit 0.5 stronger sits 0.2 s before
    # the true start of slot 1, which would make slots 1 and 2 last 2.2 and 2.0 s after a 1.8 s one
    beats = np.arange(FIRST, 8.0, 0.1)
    truth = [1.0, 3.0, 5.0]
    beat_logits, downbeat_logits = logit_curves(list(beats), truth, 9.0, FPS)
    downbeat_logits[round(2.8 * FPS)] = 6.5
    found = align_bars(beat_logits, downbeat_logits, beats, [4, 4, 4])
    assert found[:3] == pytest.approx(truth, abs=1 / FPS)


def test_the_first_slot_starts_at_the_first_beat_when_every_beat_could_start_it() -> None:
    # 44 beats for 10 slots of 4, and a downbeat logit on every beat: starting late would skip
    # beats before slot 0 (cost 1 each) to save the leftover beats after it (cost 0.5 each)
    grid = FIRST + BEAT * np.arange(44)
    beat_logits, downbeat_logits = logit_curves(list(grid), list(grid), float(grid[-1]) + 3, FPS)
    found = align_bars(beat_logits, downbeat_logits, grid, [4] * 10)
    assert found[0] == pytest.approx(FIRST, abs=1 / FPS)


def test_the_last_slot_takes_the_beats_left_after_it() -> None:
    # the audio has 6 beats in its last bar; the score says 4 and marks it elastic. The two beats
    # left after a 4-beat end cost LEFT_W each, and the stretched end is free for a soft slot
    signal = BarSignal([4] * 9 + [6])
    found = signal.align([4] * 10, soft={9})
    assert found[-1] >= signal.beats[-1] - 0.04  # the slot ends at the last heard beat or later


def test_the_slots_follow_the_audio_where_the_music_slows_down_a_little() -> None:
    beats: list[float] = []
    starts: list[float] = []
    t = FIRST
    for slot in range(8):
        period = BEAT * 1.04**slot  # each bar 4 % longer than the one before
        starts.append(t)
        beats += [t + k * period for k in range(4)]
        t += 4 * period
    beat_logits, downbeat_logits = logit_curves(beats, starts, t + 3.0, FPS)
    found = align_bars(beat_logits, downbeat_logits, np.array(beats), [4] * 8)
    assert found[:8] == pytest.approx(starts, abs=1 / FPS)


# --- anchors and the hard tempo limit ---------------------------------------------------------


def place(anchors: dict[int, float] | None = None, slots: int = 10, **rules: object) -> list[float]:
    signal, notated = regular(slots)
    return signal.align(notated, anchors=anchors or {}, **rules)


def test_an_anchor_forces_its_slot_to_exactly_that_time() -> None:
    found = place({4: 9.5})  # one beat later than the music says
    assert len(found) == 11
    assert found[4] == 9.5
    assert all(b > a for a, b in zip(found, found[1:], strict=False))


def test_an_anchor_near_a_candidate_replaces_it_and_keeps_its_own_time() -> None:
    found = place({4: 9.0 + ANCHOR_SNAP * 0.5})
    assert found[4] == 9.0 + ANCHOR_SNAP * 0.5
    assert len(found) == 11


def test_anchors_on_several_slots_and_on_the_ends_are_all_kept() -> None:
    found = place({0: 1.5, 4: 9.5, 9: 19.5})
    assert [found[i] for i in (0, 4, 9)] == [1.5, 9.5, 19.5]


def test_an_impossible_anchor_raises() -> None:
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        place({2: 90.0})  # far beyond the music; slots 0-1 would be 40 s each
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        place({2: 5.0, 3: 5.2})  # a 4-beat bar cannot last 0.2 s


def test_an_anchor_on_a_slot_that_does_not_exist_raises() -> None:
    with pytest.raises(ValueError, match="slot 10"):
        place({10: 20.0})
    with pytest.raises(ValueError, match="slot -1"):
        place({-1: 1.0})


def test_align_bars_anchors_out_of_time_order_raise() -> None:
    with pytest.raises(ValueError, match="out of time order"):
        place({2: 9.0, 3: 5.0})


@pytest.mark.parametrize(
    ("end", "fits"),
    [(4.6, True), (4.4, False), (5.5, True), (5.8, False)],  # slot 1 lasts 1.6, 1.4, 2.5, 2.8 s
)
def test_an_ordinary_slot_may_change_the_beat_period_by_25_percent_down_or_a_third_up(
    end: float, fits: bool
) -> None:
    anchors = {0: 1.0, 1: 3.0, 2: end}  # slot 0 lasts 2 s (0.5 s a beat)
    if fits:
        assert place(anchors, slots=3)[:3] == [1.0, 3.0, end]
    else:
        with pytest.raises(ValueError, match="anchors cannot be satisfied"):
            place(anchors, slots=3)


def test_a_fermata_slot_may_be_twice_as_slow_as_the_slot_before() -> None:
    anchors = {0: 1.0, 1: 3.0, 2: 7.0}  # slot 1 lasts 4 s: 1 s per beat, twice slot 0's
    assert place(anchors, slots=3, soft={1})[:3] == [1.0, 3.0, 7.0]
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        place(anchors, slots=3)


def test_the_slot_after_a_fermata_may_return_to_any_tempo() -> None:
    anchors = {0: 1.0, 1: 3.0, 2: 5.0, 3: 9.0}  # slot 2 lasts 4 s, twice slot 1's beat period
    assert place(anchors, slots=4, soft={1})[:4] == [1.0, 3.0, 5.0, 9.0]
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        place(anchors, slots=4)


def test_a_rit_slot_may_slow_by_more_than_a_third_but_not_by_more_than_two_thirds() -> None:
    assert place({0: 1.0, 1: 3.0, 2: 6.2}, slots=3, rit={1})[:3] == [1.0, 3.0, 6.2]  # 1.6x
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        place({0: 1.0, 1: 3.0, 2: 6.2}, slots=3)
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        place({0: 1.0, 1: 3.0, 2: 6.8}, slots=3, rit={1})  # 1.8x


def test_a_rit_slot_may_be_entered_with_a_1_7_step_in_the_beat_period() -> None:
    # slot 1 is a rit. bar of 2 s (0.5 s a beat); slot 2 lasts 3.42 s, 1.71 times the beat period
    assert place({0: 1.0, 1: 3.0, 2: 6.42}, slots=3, rit={1})[:3] == [1.0, 3.0, 6.42]


def test_a_rall_ending_may_slow_past_one_and_a_half_seconds_a_beat() -> None:
    # six bars of four beats; the last two slow to 1.65 s a beat, a step of 1.5 each, and the
    # user pins both: the molto rall. ending of a slow piece
    periods = [0.5, 0.5, 0.75, 1.1, 1.65, 1.65]
    beats: list[float] = []
    starts: list[float] = []
    t = FIRST
    for period in periods:
        starts.append(t)
        beats += [t + k * period for k in range(4)]
        t += 4 * period
    beat_logits, downbeat_logits = logit_curves(beats, starts, t + 3.0, FPS)
    found = align_bars(
        beat_logits,
        downbeat_logits,
        np.array(beats),
        [4] * 6,
        soft={5},
        rit={2, 3, 4},
        anchors={4: starts[4], 5: starts[5]},
    )
    assert found[4:6] == [starts[4], starts[5]]


def test_a_fermata_slot_is_found_without_an_anchor_when_the_score_says_it_stretches() -> None:
    # slot 1 is a fermata held for 4 s with two beats heard; slot 2 returns to the old tempo
    firsts = [1.0, 3.0, 7.0, 9.0, 11.0]
    heard = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0]
    beat_logits, downbeat_logits = logit_curves(heard, firsts, 14.0, FPS)
    found = align_bars(beat_logits, downbeat_logits, np.array(heard), [4] * 5, soft={1}, anchors={})
    assert found[:5] == pytest.approx(firsts, abs=1 / FPS)


# --- a pin carries its bar phase -----------------------------------------------------------------


def wrong_phase(anchors: dict[int, float], wrong: range, soft: tuple[int, ...], **signal_args):
    """Each slot's start as beats after its true start, with the downbeat logit 2 beats late in
    the slots of `wrong` (the audio model hears beat 3 as beat 1 there)."""
    slots = 16
    signal = BarSignal([4] * slots, {slot: 2 for slot in wrong}, **signal_args)
    found = signal.align([4] * slots, soft=set(soft), anchors=anchors)
    return [round((t - (FIRST + 2.0 * k)) / BEAT, 2) for k, t in enumerate(found[:-1])]


def test_without_a_pin_the_slots_follow_the_audio_into_the_wrong_phase() -> None:
    late = wrong_phase({}, range(6, 10), (10,))
    assert late[:6] == [0.0] * 6
    assert late[7:11] == [2.0] * 4
    assert late[11:] == [0.0] * 5  # the audio is right again after the fermata slot


def test_a_pinned_slot_carries_its_phase_through_the_slots_up_to_the_next_fermata() -> None:
    assert wrong_phase({5: FIRST + 2.0 * 5}, range(6, 10), (10,)) == [0.0] * 16


def test_the_pin_does_not_carry_past_the_fermata_slot() -> None:
    late = wrong_phase({5: FIRST + 2.0 * 5}, range(6, 14), (10,))
    assert late[:11] == [0.0] * 11  # up to and including the fermata slot
    assert {abs(x) for x in late[11:14]} == {2.0}  # the slot after it takes the audio's phase


def test_a_pin_carries_backwards_too_up_to_the_previous_elastic_slot() -> None:
    # the audio is wrong in slots 2-5; slot 6 is pinned, slot 1 is a fermata slot
    late = wrong_phase({6: FIRST + 2.0 * 6}, range(2, 6), (1,))
    assert late[2:7] == [0.0] * 5  # slot 2, the one after the fermata, may take the audio's phase


def test_a_beat_the_model_missed_does_not_make_the_pin_unsatisfiable() -> None:
    late = wrong_phase({5: FIRST + 2.0 * 5}, range(6, 10), (10,), dropped=(33,))
    assert late[5] == 0.0 and len(late) == 16


# --- bad input ----------------------------------------------------------------------------------


def test_logits_of_different_lengths_raise() -> None:
    with pytest.raises(ValueError, match="same length"):
        align_bars(np.zeros(100), np.zeros(99), np.arange(5.0), [4])


def test_fewer_than_two_beats_raise() -> None:
    with pytest.raises(ValueError, match="no valid alignment"):
        align_bars(np.zeros(100), np.zeros(100), np.array([1.0]), [4])


def test_fps_must_be_positive() -> None:
    with pytest.raises(ValueError, match="fps"):
        align_bars(np.zeros(100), np.zeros(100), np.arange(5.0), [4], fps=0.0)


@pytest.mark.parametrize("bad", [0, -4])
def test_notated_beats_must_be_positive(bad: int) -> None:
    with pytest.raises(ValueError, match="notated"):
        align_bars(np.zeros(100), np.zeros(100), np.arange(5.0), [4, bad])


# --- realign_bars -------------------------------------------------------------------------------


def located(times: dict[int, float], confirmed: set[int], slots: int) -> list[Locator | None]:
    return [
        Locator(bar=i + 1, pass_index=1, time_sec=times[i], confirmed=i in confirmed)
        if i in times
        else None
        for i in range(slots)
    ]


def test_confirmed_slots_come_back_exactly_and_the_rest_are_refit() -> None:
    signal, notated = regular()
    old = {i: t + 0.05 for i, t in enumerate(signal.starts)}  # every old time is a little off
    locators = located(old, {2, 7}, 10)
    found = realign_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, locators
    )
    assert len(found) == 10
    assert found[2] == old[2] and found[7] == old[7]
    assert found[0] == pytest.approx(signal.starts[0], abs=0.03)
    assert found[4] == pytest.approx(signal.starts[4], abs=0.03)


def test_unconfirmed_old_times_are_ignored_by_realign_bars() -> None:
    signal, notated = regular()
    args = (signal.beat_logits, signal.downbeat_logits, signal.beats, notated)
    wrong = located({i: 99.0 - i for i in range(10)}, set(), 10)
    assert realign_bars(*args, [None] * 10) == realign_bars(*args, wrong)


def test_all_confirmed_realign_bars_does_no_search() -> None:
    times = {i: 1.0 + 2.0 * i for i in range(4)}
    found = realign_bars(
        np.zeros(0), np.zeros(0), np.zeros(0), [4] * 4, located(times, {0, 1, 2, 3}, 4)
    )
    assert found == list(times.values())


def test_realign_bars_needs_one_locator_entry_per_slot() -> None:
    signal, notated = regular()
    with pytest.raises(ValueError, match="locators for 10 slots"):
        realign_bars(signal.beat_logits, signal.downbeat_logits, signal.beats, notated, [None] * 9)


def test_confirmed_slots_in_the_wrong_phase_hold_their_neighbours_in_phase() -> None:
    slots = 16
    signal = BarSignal([4] * slots, {slot: 2 for slot in range(6, 10)})
    pin = FIRST + 2.0 * 5
    locators = located({5: pin}, {5}, slots)
    found = realign_bars(
        signal.beat_logits,
        signal.downbeat_logits,
        signal.beats,
        [4] * slots,
        locators,
        soft={10},
    )
    assert found[5] == pin
    assert found[6:10] == pytest.approx([FIRST + 2.0 * k for k in range(6, 10)], abs=1 / FPS)


@pytest.mark.slow
def test_a_five_minute_piece_with_fermatas_and_rits_aligns_in_seconds() -> None:
    piece = jittered_piece(150)
    assert piece.fermatas and piece.rits
    started = time.perf_counter()
    found = align_bars(
        piece.beat_logits,
        piece.downbeat_logits,
        piece.beats,
        [4] * 150,
        soft=piece.fermatas | {149},
        rit=piece.rits,
    )
    elapsed = time.perf_counter() - started
    assert max_error(found[:-1], piece.starts) <= 0.030
    assert elapsed < 10.0


@pytest.mark.slow
def test_126_slots_with_a_meter_map_run_in_seconds() -> None:
    notated = [4] * 44 + [3] * 46 + [4] * 36
    signal = BarSignal(notated)
    started = time.perf_counter()
    found = signal.align(notated)
    elapsed = time.perf_counter() - started
    assert found[:-1] == pytest.approx(signal.starts, abs=1 / FPS)
    assert elapsed < 20.0


# --- tempo limits that follow the recording -------------------------------------------------------


def test_a_fast_recording_keeps_the_fixed_upper_limits() -> None:
    assert tempo_limits(np.arange(40) * 0.3) == pytest.approx((0.15, 1.5, 3.0))  # 200 BPM


def test_a_normal_tempo_keeps_the_fixed_lower_limit_and_widens_the_upper_ones_a_little() -> None:
    assert tempo_limits(np.arange(40) * 0.5) == (0.25, 2.0, 4.0)  # 120 BPM


def test_the_limits_widen_with_a_slow_recording_and_stop_far_outside_music() -> None:
    assert tempo_limits(np.arange(40) * 1.0) == (0.25, 4.0, 8.0)  # 60 BPM
    assert tempo_limits(np.arange(40) * 2.0) == (0.25, 6.0, 12.0)  # 30 BPM
    assert tempo_limits(np.arange(40) * 20.0)[1:] == (6.0, 12.0)
    assert tempo_limits(np.arange(40) * 0.05)[0] == 0.1


def test_a_slow_four_four_aligns() -> None:
    signal = BarSignal([4] * 8, beat=2.0)  # a Largo near 30 BPM, bars of 8 s
    assert signal.align([4] * 8)[:-1] == pytest.approx(signal.starts, abs=1 / FPS)


def test_a_slow_six_eight_aligns() -> None:
    # two dotted quarters of 1.75 s: bars of 3.5 s, over the old 3 s bar of two beats
    signal = BarSignal([2] * 9, beat=1.75)
    assert signal.align([2] * 9)[:-1] == pytest.approx(signal.starts, abs=1 / FPS)


def test_a_slow_six_eight_heard_in_eighths_aligns() -> None:
    # Beat This tracks the eighths (0.583 s) while the score counts two beats of three eighths
    eighths = FIRST + 0.5833 * np.arange(54)
    starts = [float(eighths[i]) for i in range(0, 54, 6)]
    beat_logits, downbeat_logits = logit_curves(
        list(eighths), starts, float(eighths[-1]) + 3.0, FPS
    )
    found = align_bars(beat_logits, downbeat_logits, eighths, [2] * 9)
    assert found[:-1] == pytest.approx(starts, abs=1 / FPS)


def test_a_slow_piece_still_follows_the_tempo_limit_between_slots() -> None:
    signal = BarSignal([4] * 3, beat=2.0)
    with pytest.raises(ValueError, match="anchors cannot be satisfied"):
        # 2 s beats, then a bar whose beat is three times as long
        signal.align([4] * 3, anchors={0: 1.0, 1: 9.0, 2: 33.0})


# --- short bars: a pickup and an incomplete bar mid-piece --------------------------------------


def test_a_pickup_nothing_was_heard_in_is_placed_one_beat_before_bar_1() -> None:
    signal = BarSignal([4] * 8)  # Beat This found nothing before bar 1, which is common
    found = signal.align([1.0] + [4] * 8, short={0})
    assert len(found) == 10
    assert found[0] == pytest.approx(signal.starts[0] - BEAT, abs=1 / FPS)
    assert found[1:9] == pytest.approx(signal.starts, abs=1 / FPS)


def test_a_pickup_shorter_than_a_beat_holds_its_fraction_of_a_beat() -> None:
    # 6/8 felt in two: a pickup of one eighth is a third of a beat
    signal = BarSignal([4] * 8)
    found = signal.align([1 / 3] + [4] * 8, short={0})
    assert found[0] == pytest.approx(signal.starts[0] - BEAT / 3, abs=1 / FPS)


def test_a_pickup_beat_that_was_heard_is_where_the_pickup_starts() -> None:
    # the beat before bar 1 is detected, a little off the exact length of the pickup
    signal = BarSignal([1] + [4] * 8)
    off = signal.starts[0] + 0.05
    beats = np.concatenate([[off], signal.beats[1:]])
    found = align_bars(
        signal.beat_logits, signal.downbeat_logits, beats, [1.0] + [4] * 8, short={0}
    )
    assert found[0] == pytest.approx(off, abs=1 / FPS)
    assert found[1:9] == pytest.approx(signal.starts[1:], abs=1 / FPS)


def test_the_bars_after_a_pickup_are_aligned_as_without_it() -> None:
    signal = BarSignal([4] * 10)
    with_pickup = signal.align([1.0] + [4] * 10, short={0})
    without = signal.align([4] * 10)
    assert with_pickup[1:] == pytest.approx(without, abs=1 / FPS)


def test_a_pickup_slot_can_be_anchored_and_the_rest_is_fit_after_it() -> None:
    signal = BarSignal([4] * 8)
    found = signal.align([1.0] + [4] * 8, short={0}, anchors={0: 0.3})
    assert found[0] == 0.3
    assert found[1:9] == pytest.approx(signal.starts, abs=1 / FPS)


def test_anchors_after_a_pickup_keep_their_slots() -> None:
    signal = BarSignal([4] * 8)
    found = signal.align([1.0] + [4] * 8, short={0}, anchors={3: signal.starts[2]})
    assert found[3] == signal.starts[2]


def test_a_short_bar_in_the_middle_takes_only_its_own_beats() -> None:
    signal = BarSignal([4, 4, 4, 2, 4, 4, 4])
    found = signal.align([4, 4, 4, 2, 4, 4, 4], short={3})
    assert found[:-1] == pytest.approx(signal.starts, abs=1 / FPS)


def test_a_short_slot_still_has_to_fit_the_tempo_of_the_bars_around_it() -> None:
    signal = BarSignal([4] * 8)
    with pytest.raises(ValueError):
        signal.align([4, 4, 4, 0.2, 4, 4, 4, 4], short={3}, anchors={3: signal.starts[3]})


def test_realign_places_an_unconfirmed_pickup_before_the_confirmed_bars() -> None:
    signal = BarSignal([4] * 6)
    notated = [1.0] + [4] * 6
    slots: list[Locator | None] = [None] + [
        Locator(bar=i + 1, pass_index=0, time_sec=t, confirmed=True)
        for i, t in enumerate(signal.starts)
    ]
    found = realign_bars(
        signal.beat_logits, signal.downbeat_logits, signal.beats, notated, slots, short={0}
    )
    assert found[0] == pytest.approx(signal.starts[0] - BEAT, abs=1 / FPS)
    assert found[1:] == signal.starts


# --- a stretch where the recording hears no beat -------------------------------------------------


def blind_bar_signal(
    blind: int = 22, long_bar: float = 3.2, slots: int = 30
) -> tuple[list[float], np.ndarray, np.ndarray, np.ndarray]:
    """Slots of two 1 s beats; slot `blind` lasts `long_bar` s with no beat heard inside it, as
    when a player broadens one bar and Beat This misses the beats there. Returns the true starts,
    the detected beats and the two logit curves."""
    starts: list[float] = []
    beats: list[float] = []
    t = FIRST
    for slot in range(slots):
        starts.append(t)
        if slot == blind:
            beats.append(t)
            t += long_bar
        else:
            beats += [t, t + 1.0]
            t += 2.0
    beat_logits, downbeat_logits = logit_curves(beats, starts, t + 3.0, FPS)
    return starts, np.array(beats), beat_logits, downbeat_logits


def test_a_bar_that_spans_a_stretch_without_beats_may_be_slower_than_the_tempo_limit() -> None:
    # the blind bar's beat period is 1.6 s after 1.0 s ones: 1.6 times, past the 1.33 limit
    starts, beats, beat_logits, downbeat_logits = blind_bar_signal()
    found = align_bars(beat_logits, downbeat_logits, beats, [2] * 30, soft={29})
    assert found[:30] == pytest.approx(starts, abs=1 / FPS)


def test_a_stretch_without_beats_that_holds_two_ordinary_bars_stays_two_bars() -> None:
    # the beats of two bars are missed; the hole is not a slow bar, so the slots keep their length
    starts, beats, beat_logits, downbeat_logits = blind_bar_signal(long_bar=2.0)
    inside = (beats > starts[21] + 0.5) & (beats < starts[23] - 0.5)
    beats = beats[~inside]
    beat_logits, downbeat_logits = logit_curves(list(beats), starts, starts[-1] + 5.0, FPS)
    found = align_bars(beat_logits, downbeat_logits, beats, [2] * 30, soft={29})
    assert found[:30] == pytest.approx(starts, abs=1 / FPS)


def test_a_recording_too_short_for_the_notated_bars_is_no_alignment() -> None:
    beats = np.array([0.5, 1.0, 1.5])
    beat_logits, downbeat_logits = logit_curves(list(beats), [0.5], 2.0, FPS)

    with pytest.raises(NoAlignmentError, match="no chain of slots fits"):
        align_bars(beat_logits, downbeat_logits, beats, [4] * 8, soft={7})


def test_unused_beat_share_counts_the_beats_outside_the_map() -> None:
    beats = np.arange(10.0)

    # 0 and 1 are before the map, 8 and 9 after it; the beats on its edges are inside
    assert unused_beat_share(beats, 2.0, 7.0) == pytest.approx(0.4)


def test_unused_beat_share_of_a_map_over_the_whole_recording_is_zero() -> None:
    assert unused_beat_share(np.arange(10.0), 0.0, 9.0) == 0.0


def test_no_bar_starts_after_the_recording_ends() -> None:
    starts = [0.5 + 2.0 * bar for bar in range(10)]
    beats = np.array([start + k * 0.5 for start in starts for k in range(4)])
    beat_logits, downbeat_logits = logit_curves(list(beats), starts, starts[-1] + 2.5, FPS)

    found = align_bars(beat_logits, downbeat_logits, beats, [4] * 12, soft={11})

    # the last entry is where the last bar ends, which the grid past the end may give
    assert found[-2] < beat_logits.size / FPS
