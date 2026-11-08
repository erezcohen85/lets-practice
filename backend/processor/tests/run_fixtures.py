import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from tests.synthetic import logit_curves

# A tiny synthetic run folder in the shape run_piece.py writes (local-run.json), for the run folder
# and local server tests: 8 bars of 4/4, a downbeat every 2 s from 1.0 s, two parts, a page each.

BARS = 8
BAR_SEC = 2.0
FIRST = 1.0
DURATION_SEC = 20.0
AUDIO_BYTES = bytes(range(256)) * 8  # any bytes will do; the server never decodes the audio


def locator(bar: int, confirmed: bool = False, **extra: Any) -> dict[str, Any]:
    return {
        "bar": bar,
        "passIndex": 0,
        "timeSec": FIRST + BAR_SEC * (bar - 1),
        "confirmed": confirmed,
        **extra,
    }


def timing_layer() -> dict[str, Any]:
    return {
        "barCount": BARS,
        "playOrder": [{"from": 1, "to": BARS}],
        "meters": [{"fromBar": 1, "numerator": 4, "denominator": 4}],
        "marks": [],
        "locators": [locator(bar) for bar in range(1, BARS + 1)],
    }


def page_layer(part_id: str, rests: list[int] | None = None) -> dict[str, Any]:
    # Two systems of four bars on a 200 x 100 px page.
    bars = []
    for bar in range(1, BARS + 1):
        x, y = 10.0 + 45 * ((bar - 1) % 4), 5.0 + 50 * ((bar - 1) // 4)
        bars.append({"bar": bar, "pageIndex": 0, "x": x, "y": y, "w": 45.0, "h": 40.0})
    return {"partId": part_id, "bars": bars, "rests": rests or []}


def run_document(with_alignment: bool = False) -> dict[str, Any]:
    document: dict[str, Any] = {
        "version": 1,
        "piece": {
            "id": "piece-a",
            "title": "Synthetic Etude",
            "createdAt": "2026-10-30T10:00:00.000Z",
            "countInBars": 1,
            "durationSec": DURATION_SEC,
        },
        "recording": {"kind": "file", "name": "etude.mp3"},
        "audio": "audio.m4a",
        "peaks": [min(127, i % 128) for i in range(int(DURATION_SEC * 40))],
        "parts": [
            {"id": "part-flute", "name": "Flute", "position": 0, "pageCount": 1},
            {"id": "part-horn", "name": "Horn", "position": 1, "pageCount": 1},
        ],
        "pageImages": {
            part: [
                {"pageIndex": 0, "width": 200, "height": 100, "file": f"pages/{part}/page-0.webp"}
            ]
            for part in ("part-flute", "part-horn")
        },
        "timing": timing_layer(),
        "pages": {part: page_layer(part) for part in ("part-flute", "part-horn")},
    }
    if with_alignment:
        document["alignment"] = {"fps": 50.0}
        document["activations"] = "activations.npz"
    return document


def write_run(folder: Path, with_alignment: bool = False) -> Path:
    """Write the synthetic run into `folder` (created) and return it."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "local-run.json").write_text(json.dumps(run_document(with_alignment)))
    (folder / "audio.m4a").write_bytes(AUDIO_BYTES)
    for part in ("part-flute", "part-horn"):
        (folder / "pages" / part).mkdir(parents=True, exist_ok=True)
        Image.new("L", (200, 100), 255).save(folder / "pages" / part / "page-0.webp")
    if with_alignment:
        downbeats = [FIRST + BAR_SEC * i for i in range(BARS)]
        beats = [FIRST + 0.5 * i for i in range(BARS * 4)]
        beat_logits, downbeat_logits = logit_curves(beats, downbeats, DURATION_SEC)
        np.savez(
            folder / "activations.npz",
            beat_logits=beat_logits,
            downbeat_logits=downbeat_logits,
            beats=np.array(beats),
        )
    return folder
