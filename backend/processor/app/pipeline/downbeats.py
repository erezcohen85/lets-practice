import numpy as np


def pick_downbeat_peaks(
    activation: np.ndarray,
    fps: float,
    threshold: float = 0.3,
    min_distance_sec: float = 0.4,
) -> list[float]:
    """Raw baseline: local maxima at or above threshold; of two close peaks the higher wins."""
    values = np.asarray(activation, dtype=np.float64)
    if values.ndim != 1:
        raise ValueError(f"activation must be 1-D, got {values.ndim}-D")
    if fps <= 0:
        raise ValueError("fps must be positive")
    frames = _local_maxima(values, threshold)
    # strongest first, ties to the earlier frame; a peak survives unless a stronger one is too close
    min_frames = min_distance_sec * fps - 1e-9
    kept: list[int] = []
    for frame in sorted(frames, key=lambda i: (-values[i], i)):
        if all(abs(frame - other) >= min_frames for other in kept):
            kept.append(frame)
    return [frame / fps for frame in sorted(kept)]


def _local_maxima(values: np.ndarray, threshold: float) -> list[int]:
    """First frame of each peak (flat tops count once); the array edges can hold peaks."""
    n = values.size
    edged = np.concatenate([[-np.inf], values, [-np.inf]])
    starts = np.flatnonzero((values >= threshold) & (values > edged[:-2]) & (values >= edged[2:]))
    peaks = []
    for start in starts:
        end = start
        while end + 1 < n and values[end + 1] == values[start]:
            end += 1
        if end + 1 == n or values[end + 1] < values[start]:
            peaks.append(int(start))
    return peaks
