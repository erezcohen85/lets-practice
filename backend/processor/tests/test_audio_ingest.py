import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

from app.pipeline.audio_ingest import (
    MAX_SEC,
    MIN_SEC,
    RECORDING_SUFFIXES,
    AudioIngestError,
    AudioProbe,
    AudioTool,
    FakeAudioTool,
    FfmpegTool,
    ingest_file,
)
from app.storage import InMemoryStorage

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg is not installed",
)

USER, PIECE = "user-1", "piece-1"
STORED_PATH = f"{USER}/{PIECE}/audio.m4a"


def _probe(duration_sec: float = 30.0, codec: str | None = "mp3") -> AudioProbe:
    return AudioProbe(duration_sec=duration_sec, sample_rate=44100, channels=2, codec=codec)


def _ingest(tool: AudioTool, tmp_path: Path, storage: InMemoryStorage | None = None):
    source = tmp_path / "upload.bin"
    source.write_bytes(b"original upload")
    return ingest_file(source, USER, PIECE, storage or InMemoryStorage(), tool, tmp_path / "work")


def test_fake_tool_satisfies_the_protocol() -> None:
    assert isinstance(FakeAudioTool(_probe()), AudioTool)
    assert isinstance(FfmpegTool(), AudioTool)


def test_ingest_stores_the_recording_and_returns_peaks(tmp_path: Path) -> None:
    storage = InMemoryStorage()
    result = _ingest(FakeAudioTool(_probe(30.0)), tmp_path, storage)

    assert result.stored_path == STORED_PATH
    assert storage.paths() == [STORED_PATH]
    assert storage.content_type(STORED_PATH) == "audio/mp4"
    assert result.wav_path.is_file()
    assert result.duration_sec == pytest.approx(30.0, abs=0.01)
    assert result.peaks["sample_rate"] == 22050
    assert result.peaks["samples_per_pixel"] == round(22050 / 40)
    assert abs(result.peaks["length"] - 40 * 30) <= 1


def test_the_original_upload_is_left_alone(tmp_path: Path) -> None:
    _ingest(FakeAudioTool(_probe()), tmp_path)
    assert (tmp_path / "upload.bin").read_bytes() == b"original upload"


def test_duration_comes_from_the_wav_not_the_container_header(tmp_path: Path) -> None:
    tool = FakeAudioTool(_probe(30.0), wav_seconds=29.5)
    assert _ingest(tool, tmp_path).duration_sec == pytest.approx(29.5, abs=0.01)


def test_a_file_without_audio_is_refused(tmp_path: Path) -> None:
    storage = InMemoryStorage()
    with pytest.raises(AudioIngestError, match="not a recording we can read") as err:
        _ingest(FakeAudioTool(_probe(codec=None)), tmp_path, storage)
    assert str(err.value) == "This file is not a recording we can read."
    assert storage.paths() == []


def test_a_recording_shorter_than_the_floor_is_refused(tmp_path: Path) -> None:
    assert MIN_SEC == 20
    with pytest.raises(AudioIngestError, match="shorter than 20 seconds"):
        _ingest(FakeAudioTool(_probe(MIN_SEC - 0.5)), tmp_path)


def test_a_recording_longer_than_the_ceiling_is_refused(tmp_path: Path) -> None:
    assert MAX_SEC == 20 * 60
    with pytest.raises(AudioIngestError, match="longer than 20 minutes"):
        _ingest(FakeAudioTool(_probe(MAX_SEC + 1)), tmp_path)


def test_the_limits_themselves_are_allowed(tmp_path: Path) -> None:
    assert _ingest(FakeAudioTool(_probe(MIN_SEC)), tmp_path).duration_sec == pytest.approx(MIN_SEC)


def test_a_tool_failure_reaches_the_caller_as_an_ingest_error(tmp_path: Path) -> None:
    tool = FakeAudioTool(_probe(), error=AudioIngestError("We could not convert this recording."))
    with pytest.raises(AudioIngestError, match="could not convert"):
        _ingest(tool, tmp_path)


def test_ingest_error_is_a_value_error() -> None:
    assert issubclass(AudioIngestError, ValueError)


# --- the real FFmpeg, on a generated tone ---------------------------------------------------

SOURCE_RATE = 44100
CLICKS_SEC = [1.0, 2.5, 7.25, 24.0]


def _write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    data = np.clip(np.rint(samples * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(data.tobytes())


def _tone_with_clicks(seconds: float) -> np.ndarray:
    """A quiet 220 Hz tone with a 4 ms burst of 3 kHz at each of CLICKS_SEC."""
    t = np.arange(round(seconds * SOURCE_RATE)) / SOURCE_RATE
    audio = 0.1 * np.sin(2 * np.pi * 220 * t)
    burst = np.arange(round(0.004 * SOURCE_RATE)) / SOURCE_RATE
    for at in CLICKS_SEC:
        start = round(at * SOURCE_RATE)
        audio[start : start + burst.size] = 0.9 * np.sin(2 * np.pi * 3000 * burst + 0.5 * np.pi)
    return audio


def _decode(path: Path, *args: str) -> np.ndarray:
    """Decode with the real ffmpeg to 22050 Hz mono floats; `args` go before the input."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", *args, "-i", str(path)]
        + ["-ac", "1", "-ar", "22050", "-f", "s16le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(out, dtype="<i2").astype(np.float64) / 32768


@pytest.fixture
def ingested_tone(tmp_path: Path):
    source = tmp_path / "tone.wav"
    _write_wav(source, _tone_with_clicks(25.0), SOURCE_RATE)
    storage = InMemoryStorage()
    result = ingest_file(source, USER, PIECE, storage, FfmpegTool(), tmp_path / "work")
    stored = tmp_path / "stored.m4a"
    stored.write_bytes(storage.download(STORED_PATH))
    return result, stored, storage


@needs_ffmpeg
def test_real_ffmpeg_stored_file_is_cbr_aac_mono_of_the_right_length(ingested_tone) -> None:
    result, stored, storage = ingested_tone
    probe = FfmpegTool().probe(stored)
    assert probe.codec == "aac"
    assert probe.channels == 1
    assert probe.duration_sec == pytest.approx(25.0, abs=0.05)
    assert result.duration_sec == pytest.approx(25.0, abs=0.05)
    assert storage.content_type(STORED_PATH) == "audio/mp4"

    streams = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(stored)],
            capture_output=True,
            check=True,
        ).stdout
    )["streams"]
    assert int(streams[0]["bit_rate"]) == pytest.approx(128_000, rel=0.05)


@needs_ffmpeg
def test_real_ffmpeg_wav_is_22050_mono_16_bit(ingested_tone) -> None:
    result, _, _ = ingested_tone
    with wave.open(str(result.wav_path), "rb") as wav:
        assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (22050, 1, 2)


@needs_ffmpeg
def test_real_ffmpeg_peaks_run_at_forty_per_second(ingested_tone) -> None:
    result, _, _ = ingested_tone
    assert abs(result.peaks["length"] - round(40 * result.duration_sec)) <= 1
    assert max(result.peaks["data"]) > 100  # the clicks are in there


@needs_ffmpeg
def test_real_ffmpeg_seeking_the_stored_file_lands_on_the_click(ingested_tone) -> None:
    _, stored, _ = ingested_tone
    decoded = _decode(stored, "-ss", "2.0")
    first_click = int(np.argmax(np.abs(decoded) > 0.4))
    expected = round((2.5 - 2.0) * 22050)
    assert abs(first_click - expected) <= round(0.005 * 22050)


@needs_ffmpeg
def test_real_ffmpeg_clicks_sit_at_the_same_time_with_and_without_a_seek(ingested_tone) -> None:
    _, stored, _ = ingested_tone
    whole = _decode(stored)
    seeked = _decode(stored, "-ss", "7.0")
    from_whole = int(np.argmax(np.abs(whole[round(7.0 * 22050) :]) > 0.4))
    from_seek = int(np.argmax(np.abs(seeked) > 0.4))
    assert abs(from_whole - from_seek) <= round(0.005 * 22050)
    assert abs(from_seek - round(0.25 * 22050)) <= round(0.005 * 22050)


@needs_ffmpeg
def test_real_ffmpeg_refuses_a_text_file(tmp_path: Path) -> None:
    source = tmp_path / "notes.txt"
    source.write_text("this is not audio\n" * 50)
    with pytest.raises(AudioIngestError, match="not a recording we can read"):
        ingest_file(source, USER, PIECE, InMemoryStorage(), FfmpegTool(), tmp_path / "work")


@needs_ffmpeg
def test_real_ffmpeg_refuses_a_five_second_tone(tmp_path: Path) -> None:
    source = tmp_path / "short.wav"
    _write_wav(
        source,
        0.3 * np.sin(2 * np.pi * 440 * np.arange(5 * SOURCE_RATE) / SOURCE_RATE),
        SOURCE_RATE,
    )
    with pytest.raises(AudioIngestError, match="shorter than 20 seconds"):
        ingest_file(source, USER, PIECE, InMemoryStorage(), FfmpegTool(), tmp_path / "work")


def test_a_missing_ffmpeg_binary_is_one_plain_sentence(tmp_path: Path) -> None:
    tool = FfmpegTool(ffprobe="no-such-ffprobe", ffmpeg="no-such-ffmpeg")
    source = tmp_path / "a.wav"
    source.write_bytes(b"x")
    with pytest.raises(AudioIngestError, match="audio converter"):
        tool.probe(source)
    with pytest.raises(AudioIngestError, match="audio converter"):
        tool.to_wav(source, tmp_path / "o.wav")
    with pytest.raises(AudioIngestError, match="audio converter"):
        tool.encode_store(source, tmp_path / "o.m4a")


@pytest.mark.parametrize("call", ["probe", "to_wav", "encode_store"])
def test_ffmpeg_reads_only_local_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, call: str
) -> None:
    """A playlist or URL inside an upload must not make FFmpeg fetch anything (M-14)."""
    seen: list[list[str]] = []

    def run(args: list[str], **_: object) -> subprocess.CompletedProcess[bytes]:
        seen.append(args)
        return subprocess.CompletedProcess(args, 1, b"", b"")

    monkeypatch.setattr(subprocess, "run", run)
    tool = FfmpegTool()
    source = tmp_path / "a.mp3"
    try:
        if call == "probe":
            tool.probe(source)
        else:
            getattr(tool, call)(source, tmp_path / "out")
    except AudioIngestError:
        pass
    assert len(seen) == 1
    args = seen[0]
    at = args.index("-protocol_whitelist")
    assert args[at + 1] == "file,pipe"
    assert at < args.index(str(source))  # an option applies to the input that follows it


def test_the_recording_suffixes_are_the_audio_a_browser_may_upload() -> None:
    assert RECORDING_SUFFIXES == {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"}


# --- the real FFmpeg is given only audio it can name -----------------------------------------
# The suffix check is a cheap first refusal. What holds against a file with the wrong name is
# FfmpegTool: it reads local files only, and only the container formats a recording may be in
# (final review I-2: FFmpeg picks its reader from the content, so a renamed concat list or playlist
# would otherwise be read).


def _make_audio(tmp_path: Path, name: str, *codec_args: str) -> Path:
    """A 2 s tone written by the real ffmpeg; the test skips if this ffmpeg lacks the encoder."""
    path = tmp_path / name
    made = subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440"]
        + ["-t", "2", *codec_args, str(path)],
        capture_output=True,
    )
    if made.returncode != 0:
        pytest.skip(f"this ffmpeg cannot write {name}: {made.stderr.decode()[:80]}")
    return path


@needs_ffmpeg
@pytest.mark.parametrize(
    ("name", "codec"),
    [
        ("a.mp3", ["-c:a", "libmp3lame"]),
        ("a.m4a", ["-c:a", "aac"]),
        ("a.aac", ["-c:a", "aac", "-f", "adts"]),
        ("a.wav", ["-c:a", "pcm_s16le"]),
        ("a.flac", ["-c:a", "flac"]),
        ("a.ogg", ["-c:a", "libvorbis"]),
        ("a.opus", ["-c:a", "libopus"]),
        # containers a recording may also come in
        ("a.webm", ["-c:a", "libopus"]),
        ("a.mp4", ["-c:a", "aac"]),
    ],
)
def test_every_allowed_recording_format_still_reads(
    tmp_path: Path, name: str, codec: list[str]
) -> None:
    source = _make_audio(tmp_path, name, *codec)
    tool = FfmpegTool()

    assert tool.probe(source).codec is not None
    tool.to_wav(source, tmp_path / "out.wav")
    tool.encode_store(source, tmp_path / "out.m4a")
    assert (tmp_path / "out.wav").stat().st_size > 1000
    assert (tmp_path / "out.m4a").stat().st_size > 1000


def _renamed(tmp_path: Path, kind: str, name: str) -> Path:
    """A concat list or an HLS playlist that names a real audio file beside it, saved as `name`."""
    sibling = _make_audio(tmp_path, "inside.wav", "-c:a", "pcm_s16le")
    if kind == "ffconcat":
        text = f"ffconcat version 1.0\nfile {sibling.name}\n"
    else:
        text = (
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n"
            f"#EXTINF:2.0,\n{sibling}\n#EXT-X-ENDLIST\n"
        )
    path = tmp_path / name
    path.write_text(text)
    return path


@needs_ffmpeg
@pytest.mark.parametrize(
    ("kind", "name"),
    [
        ("ffconcat", "recording.mp3"),
        ("ffconcat", "recording.wav"),
        ("hls", "recording.m3u8"),
        ("hls", "recording.mp3"),
    ],
)
def test_a_renamed_list_is_not_read_even_when_it_names_a_real_audio_file(
    tmp_path: Path, kind: str, name: str
) -> None:
    source = _renamed(tmp_path, kind, name)
    tool = FfmpegTool()

    assert tool.probe(source).codec is None
    with pytest.raises(AudioIngestError):
        tool.to_wav(source, tmp_path / "out.wav")
    with pytest.raises(AudioIngestError):
        tool.encode_store(source, tmp_path / "out.m4a")
    assert not (tmp_path / "out.wav").exists()
    assert not (tmp_path / "out.m4a").exists()


def test_ffmpeg_is_given_the_container_formats_a_recording_may_be_in(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    seen: list[list[str]] = []

    def run(args: list[str], **_: object) -> subprocess.CompletedProcess[bytes]:
        seen.append(args)
        return subprocess.CompletedProcess(args, 1, b"", b"")

    monkeypatch.setattr(subprocess, "run", run)
    tool, source = FfmpegTool(), tmp_path / "a.mp3"
    tool.probe(source)
    for call in (tool.to_wav, tool.encode_store):
        with pytest.raises(AudioIngestError):
            call(source, tmp_path / "out")

    assert len(seen) == 3
    for args in seen:
        at = args.index("-format_whitelist")
        assert set(args[at + 1].split(",")) == {
            "mp3",
            "mov",
            "aac",
            "wav",
            "flac",
            "ogg",
            "matroska",
        }
        assert at < args.index(str(source))
