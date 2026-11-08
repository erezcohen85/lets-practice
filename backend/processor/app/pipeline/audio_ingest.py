import json
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import numpy as np

from app.pipeline.peaks import build_peaks
from app.storage import Storage

# Turns an uploaded recording into what the rest of the pipeline needs: a mono WAV for
# beat detection, a seek-accurate AAC file for playback (Decision 2026-10-27: the PoC's VBR
# mp3 played up to 0.66 s off after seeks, so every recording is re-encoded), and waveform
# peaks. FFmpeg sits behind AudioTool; FakeAudioTool stands in for it in unit tests.

MIN_SEC = 20
MAX_SEC = 20 * 60
WAV_RATE = 22050
PEAKS_PER_SECOND = 40
STORED_CONTENT_TYPE = "audio/mp4"

# What a recording may be called. Must equal RECORDING_SUFFIXES in
# frontend/src/lib/supabase/uploads.ts (uploads.test.ts holds the two together). This is a cheap
# first refusal and nothing more: FFmpeg chooses its reader from the content, not the name, so
# the guard is the two options below.
RECORDING_SUFFIXES = frozenset({".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"})
# FFmpeg opens a local file or a pipe, never an address (a playlist inside an upload would otherwise
# have it fetch from inside the server, final review M-14), and reads only these containers: a
# renamed concat list or HLS playlist is refused as "Format not on whitelist", not read as a list
# of other local files (I-2). The names are demuxer names; one matches if it is any of the names
# the demuxer goes by, so "mov" is mp4/m4a, "matroska" is webm, and
# "ogg" is ogg and opus. Both options exist in FFmpeg 5.1 (the Debian image) and 6.1: see
# libavformat/options_table.h, demux.c (avformat_open_input) and libavutil/avstring.c
# (av_match_list) in n5.1.9.
_LOCAL_ONLY = [
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    "mp3,mov,aac,wav,flac,ogg,matroska",
]

_PROBE_TIMEOUT = 30
_CONVERT_TIMEOUT = 300


class AudioIngestError(ValueError):
    """A recording we cannot use; the message is one sentence a user may read."""


NOT_AUDIO = "This file is not a recording we can read."
_TOO_SHORT = f"The recording is shorter than {MIN_SEC} seconds."
_TOO_LONG = f"The recording is longer than {MAX_SEC // 60} minutes."
_NO_FFMPEG = "The audio converter is not available on the server."
_CONVERT_FAILED = "We could not convert this recording."
_CONVERT_TIMED_OUT = "Converting this recording took too long."


@dataclass(frozen=True)
class AudioProbe:
    """What ffprobe says about a file; codec is None when it holds no audio stream."""

    duration_sec: float
    sample_rate: int
    channels: int
    codec: str | None


@dataclass(frozen=True)
class IngestedAudio:
    """A recording after ingest: the WAV kept for beat detection, the stored copy, the peaks."""

    wav_path: Path
    stored_path: str  # path in the pieces bucket
    duration_sec: float
    peaks: dict[str, Any]


@runtime_checkable
class AudioTool(Protocol):
    """Probe, decode and encode audio files."""

    def probe(self, path: Path) -> AudioProbe:
        """Describe the file; a file with no audio stream gets codec None."""
        ...

    def to_wav(self, src: Path, out: Path, rate: int = WAV_RATE, mono: bool = True) -> None:
        """Decode to 16-bit PCM WAV."""
        ...

    def encode_store(self, src: Path, out: Path) -> None:
        """Write the playback copy: AAC in .m4a, mono, 128 kb/s constant bitrate."""
        ...


class FfmpegTool:
    """AudioTool over the ffprobe and ffmpeg command-line programs."""

    def __init__(self, ffprobe: str = "ffprobe", ffmpeg: str = "ffmpeg") -> None:
        self._ffprobe = ffprobe
        self._ffmpeg = ffmpeg

    def probe(self, path: Path) -> AudioProbe:
        result = self._run(
            [
                self._ffprobe,
                *_LOCAL_ONLY,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                str(path),
            ],  # fmt: skip
            _PROBE_TIMEOUT,
        )
        if result.returncode != 0:
            return AudioProbe(0.0, 0, 0, None)  # ffprobe could not make sense of the file
        info = json.loads(result.stdout or b"{}")
        audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
        if audio is None:
            return AudioProbe(0.0, 0, 0, None)
        duration = audio.get("duration") or info.get("format", {}).get("duration") or 0
        return AudioProbe(
            duration_sec=float(duration),
            sample_rate=int(audio.get("sample_rate") or 0),
            channels=int(audio.get("channels") or 0),
            codec=audio.get("codec_name"),
        )

    def to_wav(self, src: Path, out: Path, rate: int = WAV_RATE, mono: bool = True) -> None:
        args = [self._ffmpeg, "-nostdin", "-y", "-v", "error", *_LOCAL_ONLY, "-i", str(src), "-vn"]
        args += ["-ar", str(rate), "-ac", "1" if mono else "2", "-c:a", "pcm_s16le", str(out)]
        self._convert(args)

    def encode_store(self, src: Path, out: Path) -> None:
        # The native aac encoder is constant bitrate when given -b:a and no -q:a; faststart puts
        # the index first so the browser can seek before the whole file has arrived.
        args = [self._ffmpeg, "-nostdin", "-y", "-v", "error", *_LOCAL_ONLY, "-i", str(src), "-vn"]
        args += ["-c:a", "aac", "-b:a", "128k", "-ac", "1", "-movflags", "+faststart", str(out)]
        self._convert(args)

    def _convert(self, args: list[str]) -> None:
        if self._run(args, _CONVERT_TIMEOUT).returncode != 0:
            raise AudioIngestError(_CONVERT_FAILED)

    def _run(self, args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
        try:
            return subprocess.run(args, capture_output=True, timeout=timeout)
        except FileNotFoundError:
            raise AudioIngestError(_NO_FFMPEG) from None
        except subprocess.TimeoutExpired:
            raise AudioIngestError(_CONVERT_TIMED_OUT) from None


class FakeAudioTool:
    """AudioTool with a scripted probe; it writes a tone WAV and a placeholder .m4a."""

    def __init__(
        self,
        probe: AudioProbe,
        wav_seconds: float | None = None,
        error: AudioIngestError | None = None,
    ) -> None:
        self._probe = probe
        self._wav_seconds = wav_seconds
        self._error = error
        self.probed: list[Path] = []  # the files probe() was asked about, in order

    def probe(self, path: Path) -> AudioProbe:
        self.probed.append(path)
        return self._probe

    def to_wav(self, src: Path, out: Path, rate: int = WAV_RATE, mono: bool = True) -> None:
        if self._error:
            raise self._error
        seconds = self._probe.duration_sec if self._wav_seconds is None else self._wav_seconds
        t = np.arange(round(seconds * rate)) / rate
        _write_wav(out, 0.5 * np.sin(2 * np.pi * 220 * t), rate)

    def encode_store(self, src: Path, out: Path) -> None:
        if self._error:
            raise self._error
        out.write_bytes(b"fake m4a")


def ingest_file(
    source: Path,
    user_id: str,
    piece_id: str,
    storage: Storage,
    tool: AudioTool,
    work_dir: Path,
) -> IngestedAudio:
    """Check the recording, decode it to a WAV, store the playback copy and measure the peaks."""
    probe = tool.probe(source)
    if probe.codec is None:
        raise AudioIngestError(NOT_AUDIO)
    if probe.duration_sec < MIN_SEC:
        raise AudioIngestError(_TOO_SHORT)
    if probe.duration_sec > MAX_SEC:
        raise AudioIngestError(_TOO_LONG)

    work_dir.mkdir(parents=True, exist_ok=True)
    wav_path, m4a_path = work_dir / "audio.wav", work_dir / "audio.m4a"
    tool.to_wav(source, wav_path)
    tool.encode_store(source, m4a_path)

    stored_path = f"{user_id}/{piece_id}/audio.m4a"
    storage.upload(stored_path, m4a_path.read_bytes(), STORED_CONTENT_TYPE)

    samples, rate = _read_wav(wav_path)
    peaks = build_peaks(samples, rate, samples_per_pixel=round(rate / PEAKS_PER_SECOND))
    # The WAV's length is exact; the container header of an mp3 or m4a can be a little off.
    return IngestedAudio(wav_path, stored_path, samples.size / rate, peaks)


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    """The mono 16-bit WAV as floats in -1..1, and its sample rate."""
    with wave.open(str(path), "rb") as wav:
        rate, frames = wav.getframerate(), wav.readframes(wav.getnframes())
    return np.frombuffer(frames, dtype="<i2").astype(np.float64) / 32768, rate


def _write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    data = np.clip(np.rint(samples * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(data.tobytes())
