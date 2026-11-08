from dataclasses import dataclass
from statistics import mean, median


@dataclass(frozen=True)
class MatchResult:
    """Outcome of matching predicted events to truth events one-to-one."""

    recall: float
    precision: float
    matched: int
    truth: int
    predicted: int


@dataclass(frozen=True)
class TimingSummary:
    """Spread of absolute timing errors in milliseconds."""

    median_ms: float
    mean_ms: float
    within_50ms: float
    within_100ms: float
    n: int


def _ratio(matched: int, total: int, both_empty: bool) -> float:
    """matched / total; with no items the score is 1.0 only if both lists are empty, else 0.0."""
    if total == 0:
        return 1.0 if both_empty else 0.0
    return matched / total


def match_events(truth: list[float], predicted: list[float], tolerance: float) -> MatchResult:
    """Match events one-to-one within tolerance (inclusive), greedy by smallest distance first.

    Ties go to the earlier truth, then the earlier prediction; each event is used at most once.
    recall = matched / len(truth), precision = matched / len(predicted). When a list is empty its
    ratio is 1.0 only if both lists are empty (nothing to find, nothing predicted), else 0.0.
    """
    if tolerance < 0:
        raise ValueError(f"tolerance must not be negative, got {tolerance}")
    pairs = sorted(
        (abs(t - p), ti, pi)
        for ti, t in enumerate(truth)
        for pi, p in enumerate(predicted)
        if abs(t - p) <= tolerance
    )
    used_truth: set[int] = set()
    used_predicted: set[int] = set()
    for _, ti, pi in pairs:
        if ti not in used_truth and pi not in used_predicted:
            used_truth.add(ti)
            used_predicted.add(pi)
    matched = len(used_truth)
    both_empty = not truth and not predicted
    return MatchResult(
        recall=_ratio(matched, len(truth), both_empty),
        precision=_ratio(matched, len(predicted), both_empty),
        matched=matched,
        truth=len(truth),
        predicted=len(predicted),
    )


def timing_errors_ms(truth_sec: list[float], predicted_sec: list[float]) -> list[float]:
    """Absolute differences in milliseconds between same-index pairs; lengths must match."""
    if len(truth_sec) != len(predicted_sec):
        raise ValueError(
            f"need equal lengths, got {len(truth_sec)} truth and {len(predicted_sec)} predicted"
        )
    return [abs(t - p) * 1000.0 for t, p in zip(truth_sec, predicted_sec, strict=True)]


def summarize_timing(errors_ms: list[float]) -> TimingSummary:
    """Median, mean and the fractions within 50 ms and 100 ms (inclusive); empty raises."""
    if not errors_ms:
        raise ValueError("cannot summarize an empty list of timing errors")
    n = len(errors_ms)
    return TimingSummary(
        median_ms=float(median(errors_ms)),
        mean_ms=float(mean(errors_ms)),
        within_50ms=sum(e <= 50.0 for e in errors_ms) / n,
        within_100ms=sum(e <= 100.0 for e in errors_ms) / n,
        n=n,
    )


def bar_line_recall(
    truth_x: list[float], predicted_x: list[float], tolerance_px: float
) -> MatchResult:
    """Match predicted bar-line x positions to truth within tolerance_px."""
    return match_events(truth_x, predicted_x, tolerance_px)
