import importlib.util
import io
import shutil
import tempfile
import uuid
from collections.abc import Callable, Collection
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from PIL import Image

from app.db import Database
from app.pipeline.audio_ingest import (
    NOT_AUDIO,
    RECORDING_SUFFIXES,
    AudioIngestError,
    AudioTool,
    FfmpegTool,
    ingest_file,
)
from app.pipeline.audiveris import (
    AudiverisEngine,
    OmrEngine,
    OmrError,
    audiveris_home,
    java_installed,
)
from app.pipeline.beats import BeatModel, BeatModelError, BeatThisModel
from app.pipeline.box_check import BoxCheckError, BoxJudge, ClaudeBoxJudge, check_part, pdf_kind_of
from app.pipeline.models import BarBox
from app.pipeline.pdf_pages import PdfRenderer, PyMuPdfRenderer, render_part
from app.pipeline.read_again import (
    ClaudeLineReader,
    ClaudeProposalJudge,
    LineReader,
    ProposalJudge,
    ReadAgain,
    ReadAgainError,
    merge_flags,
    read_again,
)
from app.pipeline.run_folder import BarBox as RunBarBox
from app.pipeline.run_folder import BoxFlag
from app.pipeline.score_reader import ClaudeScoreReader, ScoreReader
from app.pipeline.sentences import user_sentence
from app.pipeline.stages import (
    AudioResult,
    Heard,
    OmrStage,
    RenderedPart,
    Stages,
)
from app.pipeline.storage_paths import require_piece_path
from app.pipeline.structure_read import PartRead, read_part
from app.pipeline.structure_shift import structure_after, warnings_after
from app.settings import Settings
from app.storage import Storage

# The four stages with the real tools: FFmpeg for the recording, PyMuPDF for the pages,
# Audiveris with the vision read for the bars and the structure, Beat This for the beats. Each is a
# thin adapter over a tested core in app/pipeline/ and takes its tools, the database or storage and
# a scratch folder, so the tests run them on fakes. The stages are made per job and each job has a
# scratch folder of its own, so two jobs on one piece never share files; `clean_up` removes it when
# the job ends. A part with the Advanced Reading tick goes through one more step after the read,
# BoxCheckingOmr: its lines are read again, a judge accepts or refuses what the readings propose,
# the accepted changes move the boxes (and the structure follows when a line's bar count changes),
# and the box check looks at the result. Every change is a flag the user can undo.

MIN_BEATS = 8  # fewer than this and the recording is not music Beat This can use
NO_KEY_NOTICE = (
    "No Anthropic API key is set: scores are read without the vision model "
    "(Audiveris and the page only)."
)


@dataclass(frozen=True)
class AdvancedReaders:
    """What Advanced Reading asks: the model that reads each line again, and the one that judges
    what the readings propose (app/pipeline/read_again.py)."""

    reader: LineReader
    judge: ProposalJudge


def advanced_readers(settings: Settings) -> AdvancedReaders | None:
    """The Claude readers when there is an Anthropic key, else None (Advanced Reading is off)."""
    if not settings.anthropic_api_key:
        return None
    return AdvancedReaders(ClaudeLineReader(), ClaudeProposalJudge())


@dataclass(frozen=True)
class Tools:
    """The external tools the real stages use."""

    audio: AudioTool
    renderer: PdfRenderer
    engine: OmrEngine
    reader: ScoreReader | None  # None without an Anthropic key
    beats: BeatModel
    box_judge: BoxJudge | None = None  # None without an Anthropic key: a ticked part is not checked
    advanced: AdvancedReaders | None = None  # None: a ticked part is checked, not read again


def missing_tool() -> str | None:
    """One sentence naming the first tool the real stages need that is not there, or None."""
    for binary, name in (("ffmpeg", "FFmpeg"), ("ffprobe", "FFmpeg (ffprobe)")):
        if shutil.which(binary) is None:
            return f"{name} is not installed on the server."
    if not java_installed():
        return "Java is not installed on the server (Audiveris needs it)."
    try:
        audiveris_home()
    except OmrError as error:
        return str(error)
    if importlib.util.find_spec("beat_this") is None:
        return "Beat This is not installed (uv sync --extra beat)."
    return None


def real_tools(settings: Settings) -> Tools:
    """The real tools, after checking that they are installed."""
    if missing := missing_tool():
        raise RuntimeError(missing)
    reader = ClaudeScoreReader() if settings.anthropic_api_key else None
    judge = ClaudeBoxJudge() if settings.anthropic_api_key else None
    return Tools(
        audio=FfmpegTool(),
        renderer=PyMuPdfRenderer(),
        engine=AudiverisEngine(),
        reader=reader,
        beats=BeatThisModel(),
        box_judge=judge,
        advanced=advanced_readers(settings),
    )


def startup_notes(settings: Settings) -> list[str]:
    """What the server says at startup when it runs the real stages: none when it runs fakes.

    Raises a RuntimeError naming the missing setting or tool, so the server never starts half-able.
    """
    if settings.use_fakes or not settings.has_supabase:
        return []
    if missing_settings := settings.missing_for_real_services():
        raise RuntimeError(f"{' and '.join(missing_settings)} must be set for the real services.")
    if missing := missing_tool():
        raise RuntimeError(missing)
    return [] if settings.anthropic_api_key else [NO_KEY_NOTICE]


def _scratch(root: Path | None) -> Path:
    return root or Path(tempfile.gettempdir()) / "lets-practice"


LINK_NO_LONGER_FETCHED = (
    "This piece's recording was a link, and links are no longer fetched. "
    "Add the recording as a file."
)


def _owner(db: Database, piece_id: str) -> str:
    owner_id = db.get_piece_owner(piece_id)
    if owner_id is None:
        raise ValueError("the piece no longer exists")
    return owner_id


def _part_path(db: Database, score_file: dict[str, Any]) -> str:
    """The part's stored PDF path, refused unless it is inside the piece's own folder.

    The path is written by the owner, and the processor reads it with the service key.
    """
    piece_id = score_file["piece_id"]
    return require_piece_path(score_file["storage_path"], _owner(db, piece_id), piece_id)


def _local_pdf(db: Database, storage: Storage, score_file: dict[str, Any], scratch: Path) -> Path:
    """The part's PDF as a file in the scratch folder (Audiveris reads files), fetched once."""
    stored = _part_path(db, score_file)  # checked even when the file is already in scratch
    path = scratch / score_file["piece_id"] / "parts" / score_file["id"] / "part.pdf"
    if not path.exists():
        try:
            data = storage.download(stored)
        except FileNotFoundError:
            raise ValueError("The score PDF is missing from storage.") from None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path


class RealAudioStage:
    """Fetch the piece's recording (an uploaded file) and ingest it."""

    def __init__(self, db: Database, storage: Storage, tool: AudioTool, scratch: Path) -> None:
        self._db, self._storage = db, storage
        self._tool, self._scratch = tool, scratch

    def ingest(self, piece_id: str) -> AudioResult:
        owner_id = _owner(self._db, piece_id)
        source = self._db.get_audio_source(piece_id)
        if source is None:
            raise ValueError("The piece has no recording.")
        if source["kind"] != "file":
            # An old row from before the music rule (Decision 2026-11-06) may say "youtube". The
            # app no longer downloads, so such a piece needs its recording added as a file.
            raise AudioIngestError(LINK_NO_LONGER_FETCHED)
        folder = self._scratch / piece_id / "audio"
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        recording = require_piece_path(source["url_or_path"], owner_id, piece_id)
        # A first, cheap refusal; what FFmpeg may open is limited in FfmpegTool itself.
        if Path(recording).suffix.lower() not in RECORDING_SUFFIXES:
            raise AudioIngestError(NOT_AUDIO)
        try:
            data = self._storage.download(recording)
        except FileNotFoundError:
            raise ValueError("The recording file is missing from storage.") from None
        upload = folder / f"upload{Path(recording).suffix}"
        upload.write_bytes(data)
        ingested = ingest_file(upload, owner_id, piece_id, self._storage, self._tool, folder)
        self._db.set_audio_stored(piece_id, ingested.stored_path, ingested.duration_sec)
        return AudioResult(ingested.peaks, ingested.duration_sec, ingested.wav_path)


class RealPagesStage:
    """Render a part's PDF to levelled WebP page images in storage."""

    def __init__(
        self, db: Database, storage: Storage, renderer: PdfRenderer, scratch: Path
    ) -> None:
        self._db, self._storage = db, storage
        self._renderer, self._scratch = renderer, scratch

    def page_count(self, score_file: dict[str, Any]) -> int:
        pdf = _local_pdf(self._db, self._storage, score_file, self._scratch)
        return self._renderer.page_count(pdf.read_bytes())

    def render(self, score_file: dict[str, Any]) -> RenderedPart:
        piece_id = score_file["piece_id"]
        pdf = _local_pdf(self._db, self._storage, score_file, self._scratch)
        return render_part(
            pdf.read_bytes(),
            _owner(self._db, piece_id),
            piece_id,
            score_file["id"],
            self._storage,
            self._renderer,
        )


class RealOmrStage:
    """Read a part's bars and structure: Audiveris, and the vision model when there is a key."""

    def __init__(
        self,
        db: Database,
        storage: Storage,
        engine: OmrEngine,
        reader: ScoreReader | None,
        scratch: Path,
    ) -> None:
        self._db, self._storage, self._engine = db, storage, engine
        self._reader, self._scratch = reader, scratch

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        pdf = _local_pdf(self._db, self._storage, score_file, self._scratch)
        return read_part(pdf, rendered, self._engine, self._reader, pdf.parent / "omr")


NOTATION_SKIPPED = "The box check was skipped: this PDF was made by notation software."


def _run_box(box: BarBox) -> RunBarBox:
    return RunBarBox(bar=box.bar, pageIndex=box.page_index, x=box.x, y=box.y, w=box.w, h=box.h)


def _stage_box(box: RunBarBox) -> BarBox:
    return BarBox(bar=box.bar, page_index=box.pageIndex, x=box.x, y=box.y, w=box.w, h=box.h)


def _changed_sentence(again: ReadAgain) -> str | None:
    """One short sentence on what Advanced Reading changed, or None when it changed nothing: the
    boxes it moved, and the bars it added or took away on the lines whose count changed."""
    lines = {entry["line"] for entry in again.log if entry["applied_boxes"]}
    bars = sum(len(entry["applied_boxes"]) for entry in again.log if entry["applied_boxes"])
    for change in again.changes:
        bars += max(1, abs(change.new_bars - (change.old_last - change.old_first + 1)))
    lines_changed = len(lines) + len(again.changes)
    if bars == 0 and lines_changed == 0:
        return None
    return (
        f"Advanced Reading changed {bars} bar{'' if bars == 1 else 's'} "
        f"on {lines_changed} line{'' if lines_changed == 1 else 's'}."
    )


class BoxCheckingOmr:
    """An OmrStage that reads the bar boxes of the parts asked for again and checks them, after the
    inner stage read them (Advanced Reading, Decisions 2026-11-03 and 2026-11-07). The parts that
    are scans go through:

    1. Advanced Reading, when `advanced` is given: each line is read again, a judge accepts or
       refuses what the readings propose, and the accepted proposals move the boxes (or change the
       number of bars of a line, which renumbers the lines after it and brings the part's
       structure along: structure_shift.py). Every change is a flag, a `read_moved` flag with the
       edges to put back or a `read_count` flag.
    2. The box check, on the boxes as they are then.

    The flags of both are kept in `flags`, by part id, one a bar, for whoever writes the page
    layer; the cost and the warnings join the part's. A PDF made by notation software is skipped.
    A step that fails for any reason is a warning, never a failed read: a reading that fails
    leaves the boxes of the first read.
    """

    def __init__(
        self,
        inner: OmrStage,
        storage: Storage,
        judge: BoxJudge,
        parts: Collection[str],
        db: Database,
        advanced: AdvancedReaders | None = None,
    ) -> None:
        self._inner, self._storage, self._judge, self._db = inner, storage, judge, db
        self._advanced = advanced
        self._parts = set(parts)
        self.flags: dict[str, list[BoxFlag]] = {}

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        part = self._inner.read(score_file, rendered)
        part_id = score_file["id"]
        if part_id not in self._parts or not part.boxes:
            return part
        try:
            data = self._storage.download(_part_path(self._db, score_file))
            if pdf_kind_of(data) == "notation":
                return replace(part, warnings=[*part.warnings, NOTATION_SKIPPED])
            images = {}
            for page in rendered.pages:
                image = Image.open(io.BytesIO(self._storage.download(page.image_path)))
                image.load()
                images[page.page_index] = image
        except (BoxCheckError, OSError, ValueError) as error:
            warning = f"The box check could not run: {user_sentence(error, (BoxCheckError,))}"
            return replace(part, warnings=[*part.warnings, warning])
        part, read_flags = self._read_again(part, images)
        try:
            check = check_part([_run_box(b) for b in part.boxes], images, self._judge)
        except (BoxCheckError, OSError, ValueError) as error:
            warning = f"The box check could not run: {user_sentence(error, (BoxCheckError,))}"
            if read_flags:  # what the reading changed is still to be shown
                self.flags[part_id] = read_flags
            return replace(part, warnings=[*part.warnings, warning])
        self.flags[part_id] = merge_flags(read_flags, check.flags)
        return replace(
            part,
            cost_usd=part.cost_usd + check.cost_usd,
            warnings=[*part.warnings, *check.warnings],
        )

    def _read_again(
        self, part: PartRead, images: dict[int, Image.Image]
    ) -> tuple[PartRead, list[BoxFlag]]:
        """The part after Advanced Reading, and its flags; the part as it was, with a warning,
        when the reading cannot run (whatever the reason)."""
        if self._advanced is None:
            return part, []
        try:
            again = read_again(
                [_run_box(b) for b in part.boxes],
                images,
                self._advanced.reader,
                self._advanced.judge,
            )
            structure = structure_after(part.structure, again.changes)
            boxes = [_stage_box(b) for b in again.boxes]
        except Exception as error:  # a reading never fails the part, and says only what is safe
            warning = f"Advanced Reading could not run: {user_sentence(error, (ReadAgainError,))}"
            return replace(part, warnings=[*part.warnings, warning]), []
        said = _changed_sentence(again)
        # the first read's warnings name bars by its numbers, and compare printed numbers with its
        # counts: made good when the reading changed the bars
        first = warnings_after(part.warnings, again.changes) if again.changes else part.warnings
        return (
            replace(
                part,
                boxes=boxes,
                structure=structure,
                cost_usd=part.cost_usd + again.cost_usd,
                warnings=[*first, *again.warnings, *([said] if said else [])],
            ),
            again.flags,
        )


NO_JUDGE = "The box check was skipped: there is no Anthropic API key on the server."

# Makes the box check for one part (the method): given the stage that reads the part, the check.
BoxCheckFactory = Callable[[OmrStage, str], BoxCheckingOmr]


class TickedBoxCheck:
    """An OmrStage for jobs on a database: the parts whose `score_files.box_check` is true (the
    Advanced Reading tick, saved when the part was added) go through the stage that `make`
    builds (BoxCheckingOmr: read again, then checked), and the flags it leaves are saved on the
    part (`score_files.box_flags`). The other parts are read as they are. This is only the
    plumbing of the tick; how a part is read again is BoxCheckingOmr's, and `make` can give
    another method. With no `make` (no API key) a ticked part is read and the job says it was
    not checked.
    """

    def __init__(self, inner: OmrStage, db: Database, make: BoxCheckFactory | None) -> None:
        self._inner, self._db, self._make = inner, db, make

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        if not score_file.get("box_check"):
            return self._inner.read(score_file, rendered)
        if self._make is None:
            part = self._inner.read(score_file, rendered)
            return replace(part, warnings=[*part.warnings, NO_JUDGE])
        part_id = score_file["id"]
        checking = self._make(self._inner, part_id)
        part = checking.read(score_file, rendered)
        found = checking.flags.get(part_id)
        if found is not None:  # the check ran; none found clears what an earlier read left
            self._db.set_box_flags(part_id, found)
        return part


class RealDownbeatStage:
    """Beat This on the recording's WAV."""

    def __init__(self, model: BeatModel) -> None:
        self._model = model

    def listen(self, audio: AudioResult) -> Heard:
        if audio.wav_path is None:
            raise ValueError("The recording was not decoded for beat detection.")
        activations = self._model.activations(audio.wav_path)
        track = self._model.beats(audio.wav_path)
        if len(track.beats) < MIN_BEATS:
            raise BeatModelError(
                f"Only {len(track.beats)} beats were found in the recording; is it music?"
            )
        return Heard(
            activations.beat_logits, activations.downbeat_logits, activations.fps, track.beats
        )


def _clean_up(scratch: Path) -> Callable[[], None]:
    def clean_up() -> None:
        shutil.rmtree(scratch, ignore_errors=True)

    return clean_up


def with_box_check(
    stages: Stages,
    db: Database,
    storage: Storage,
    judge: BoxJudge | None,
    advanced: AdvancedReaders | None = None,
) -> Stages:
    """The stages with the Advanced Reading tick honoured: the parts whose row says `box_check`
    are read again over `advanced` (when given) and checked by BoxCheckingOmr over `judge` (no
    judge: they are read and the job says they were not checked), and what it finds is saved on
    the part."""
    make = (
        None
        if judge is None
        else lambda inner, part_id: BoxCheckingOmr(inner, storage, judge, {part_id}, db, advanced)
    )
    return replace(stages, omr=TickedBoxCheck(stages.omr, db, make))


def real_stages(
    db: Database, storage: Storage, tools: Tools, scratch: Path | None = None
) -> Stages:
    """The four real stages of one job over the given tools.

    The job works in a new folder under `scratch` (default: a folder in the temp dir).
    """
    root = _scratch(scratch) / uuid.uuid4().hex
    return Stages(
        audio=RealAudioStage(db, storage, tools.audio, root),
        pages=RealPagesStage(db, storage, tools.renderer, root),
        omr=RealOmrStage(db, storage, tools.engine, tools.reader, root),
        downbeats=RealDownbeatStage(tools.beats),
        clean_up=_clean_up(root),
    )
