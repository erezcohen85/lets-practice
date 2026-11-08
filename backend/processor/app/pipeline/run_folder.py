import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    ValidationError,
    field_validator,
    model_serializer,
    model_validator,
)

from app.pipeline.models import NOTE_VALUES

# The run folder that local mode reads and writes: `local-run.json` (what run_piece.py made) and
# `map.confirmed.json` (every map the editor saved) and `names.json` (the names the user gave to
# parts and to the recording, read over the pipeline's). The models use the camelCase names of
# frontend/src/domain/types.ts, so the JSON is the frontend's own shape; the Python models in
# models.py are snake_case and are not used here.

RUN_NAME = "local-run.json"
CONFIRMED_NAME = "map.confirmed.json"
PREV_NAME = "map.confirmed.prev.json"
NAMES_NAME = "names.json"
VERSION = 1
MAX_PART_NAME = 80  # as score_files.name is held in the app
MAX_RECORDING_NAME = 120  # audio_sources.name (migration 0005)
MAX_PIECE_TITLE = 200  # pieces.title has no limit; this one stops a pasted page

Seconds = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Pixels = Annotated[float, Field(allow_inf_nan=False)]
Size = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class RunFolderError(ValueError):
    """A run folder or a map is unusable; the message is one plain sentence."""


class _Map(BaseModel):
    """A layer of the map: exactly the frontend's keys and types, nothing else."""

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class PlayOrderRow(_Map):
    from_: int = Field(alias="from", ge=0)  # 0 = the pickup
    to: int = Field(ge=0)

    @model_validator(mode="after")
    def _end_not_before_start(self) -> Self:
        if self.to < self.from_:
            raise ValueError(f"play-order row {self.from_}-{self.to} runs backwards")
        return self


class MeterChange(_Map):
    fromBar: int = Field(ge=1)
    numerator: int = Field(ge=1)
    denominator: int

    @field_validator("denominator")
    @classmethod
    def _denominator_is_a_note_value(cls, value: int) -> int:
        if value not in NOTE_VALUES:
            raise ValueError(f"denominator must be one of {NOTE_VALUES}, got {value}")
        return value


class BarMark(_Map):
    """A mark of the recording's timing, shared by every part; a part's rests are in its layer."""

    bar: int = Field(ge=0)
    kind: Literal["fermata", "rit"]


class UncertainLine(_Map):
    timeSec: Seconds
    confidence: float = Field(ge=0, le=1)


class ReviewFlag(_Map):
    kind: Literal[
        "crowded",
        "stretched",
        "beat-count",
        "weak-downbeat",
        "other-downbeat",
        "pickup",
        "skipped-repeat",
        "pulse",
    ]
    severity: Literal[0, 1, 2]
    expected: Size
    found: Size
    factor: Size | None
    explainedBy: Literal["fermata", "rit"] | None
    uncertainLine: UncertainLine | None


class Locator(_Map):
    bar: int = Field(ge=0)
    passIndex: int = Field(ge=0)
    timeSec: Seconds
    confirmed: bool
    flags: list[ReviewFlag] | None = None
    checked: bool | None = None


class ShortBar(_Map):
    """A bar shorter than its meter: `units` notes of its denominator (bar 0 is a pickup).

    `unnumbered`: a pickup in the middle of the piece with no number of its own (the app labels it
    p7). The bar keeps its whole number here; the alignment ignores the flag. Absent unless set.
    """

    bar: int = Field(ge=0)
    units: int = Field(ge=1)
    unnumbered: bool | None = None


class TimingLayer(_Map):
    barCount: int = Field(ge=0)  # the printed bars, 1..barCount; a pickup (bar 0) is extra
    playOrder: list[PlayOrderRow]
    meters: list[MeterChange]
    marks: list[BarMark]
    locators: list[Locator]
    shortBars: list[ShortBar] | None = None  # None: a map made before short bars existed

    @property
    def has_pickup(self) -> bool:
        return any(short.bar == 0 for short in self.shortBars or [])

    @model_validator(mode="after")
    def _everything_is_inside_the_piece(self) -> Self:
        first = 0 if self.has_pickup else 1
        for row in self.playOrder:
            if row.to > self.barCount:
                raise ValueError(
                    f"play-order row {row.from_}-{row.to} ends after bar {self.barCount}"
                )
            if row.from_ < first:
                raise ValueError(f"play-order row {row.from_}-{row.to} starts at bar 0, a pickup")
        for item in (*self.meters, *self.marks, *self.locators):
            bar = item.fromBar if isinstance(item, MeterChange) else item.bar
            if bar > self.barCount:
                raise ValueError(f"bar {bar} is after the last bar, {self.barCount}")
            if bar < first:
                raise ValueError("bar 0 needs a pickup in shortBars")
        self._short_bars_fit_their_meters()
        seen: set[tuple[int, int]] = set()
        for locator in self.locators:
            key = (locator.bar, locator.passIndex)
            if key in seen:
                raise ValueError(f"bar {locator.bar} pass {locator.passIndex} has two locators")
            seen.add(key)
        return self

    def _short_bars_fit_their_meters(self) -> None:
        seen: set[int] = set()
        meters = sorted(self.meters, key=lambda change: change.fromBar)
        for short in self.shortBars or []:
            if short.bar > self.barCount:
                raise ValueError(f"short bar {short.bar} is after the last bar, {self.barCount}")
            if short.bar in seen:
                raise ValueError(f"bar {short.bar} has two lengths")
            seen.add(short.bar)
            in_force = [change for change in meters if change.fromBar <= short.bar]
            meter = in_force[-1] if in_force else (meters[0] if meters else None)
            if meter is not None and short.units >= meter.numerator:
                raise ValueError(
                    f"short bar {short.bar} holds {short.units} beats, which is not shorter than "
                    f"{meter.numerator}/{meter.denominator}"
                )


class BarBox(_Map):
    bar: int = Field(ge=0)
    pageIndex: int = Field(ge=0)
    x: Pixels
    y: Pixels
    w: Size
    h: Size


FlagVerdict = Literal[
    "signature_inside",
    "starts_late",
    "ends_early",
    "ends_late",
    "two_bars",
    "not_a_bar",
    "read_moved",
    "read_count",
]


class BoxEdges(_Map):
    """A box's left edge and width as they were before Advanced Reading moved it."""

    x: Pixels
    w: Size


class BoxFlag(_Map):
    """A bar box the box check found wrong (Decisions 2026-11-03): the bar it is the box of, what
    is wrong with it, the model's own words, and for a line start the left edge to suggest.

    Advanced Reading adds two verdicts: `read_moved` (it moved this box; `previous` holds the
    edges to put back) and `read_count` (it changed the number of bars of the line that starts
    here). A flag without `previous` is written without the key, as before it existed."""

    bar: int = Field(ge=0)
    verdict: FlagVerdict
    note: str
    suggestedX: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None = None  # image px
    previous: BoxEdges | None = None

    @model_serializer(mode="wrap")
    def _leave_out_no_previous(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if data.get("previous") is None:
            data.pop("previous", None)
        return data


class PageLayer(_Map):
    partId: str = Field(min_length=1)
    bars: list[BarBox]
    rests: list[int]  # the bars this part rests, sorted; each bar of a multi-rest is one
    # the box check's flags; a layer without any is written without the key, as before it existed
    boxFlags: list[BoxFlag] = Field(default_factory=list)

    @model_validator(mode="after")
    def _flags_are_on_boxes(self) -> Self:
        bars = {box.bar for box in self.bars}
        for flag in self.boxFlags:
            if flag.bar not in bars:
                raise ValueError(f"a box flag on bar {flag.bar} of {self.partId} has no box")
        return self

    @model_serializer(mode="wrap")
    def _leave_out_no_flags(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if not data.get("boxFlags"):
            data.pop("boxFlags", None)
        return data


def _bars(items: object) -> list[int]:
    """The ints of a list; anything else is left for the validation to refuse."""
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, int) and not isinstance(item, bool)]


def without_rests(timing: object) -> tuple[object, list[int]]:
    """The timing without the `rest` marks an older map kept in it, and the bars they were on.

    A rest mark whose bar is no number stays, so that the validation refuses it as before.
    """
    if not isinstance(timing, dict) or not isinstance(timing.get("marks"), list):
        return timing, []
    moved: list[int] = []
    kept = []
    for mark in timing["marks"]:
        is_rest = isinstance(mark, dict) and mark.get("kind") == "rest"
        if is_rest and _bars([mark.get("bar")]):
            moved.append(mark["bar"])
        else:
            kept.append(mark)
    return {**timing, "marks": kept}, moved


def with_rests_on_parts(data: object) -> object:
    """A map as an older version wrote it, in today's shape.

    Rests used to be marks of the shared timing. They belong to a part now, and an older map
    cannot say which part they were read from, so every part gets them (union with any rests it
    has already); a page layer with no rests reads as having none. The next save writes the new
    shape. Anything that is not a map is returned as it is, for the validation to refuse.
    """
    if not isinstance(data, dict):
        return data
    timing, moved = without_rests(data.get("timing"))
    pages = data.get("pages")
    if isinstance(pages, dict):
        pages = {
            key: _with_rests(layer, moved) if isinstance(layer, dict) else layer
            for key, layer in pages.items()
        }
    return (
        {**data, "timing": timing, "pages": pages}
        if "pages" in data
        else {**data, "timing": timing}
    )


def _with_rests(layer: dict[str, Any], moved: list[int]) -> dict[str, Any]:
    if "rests" not in layer:
        return {**layer, "rests": sorted(set(moved))}
    own = layer["rests"]
    if not moved or not isinstance(own, list) or len(_bars(own)) != len(own):
        return layer  # nothing to add, or not a list of bars (the validation refuses that)
    return {**layer, "rests": sorted({*own, *moved})}


def _rests_are_inside_the_piece(timing: TimingLayer, pages: Mapping[str, PageLayer]) -> None:
    """Rests are sorted, once each, and on a bar the part has: bar 0 only with a pickup. A part
    may have a bar more than the piece (Add bar line on its score alone), so the last box counts."""
    first = 0 if timing.has_pickup else 1
    for key, layer in pages.items():
        last = max([timing.barCount, *(box.bar for box in layer.bars)])
        if layer.rests != sorted(set(layer.rests)):
            raise ValueError(f"the rests of {key} must be in order, each bar once")
        for bar in layer.rests:
            if bar < first:
                raise ValueError(f"a rest on bar {bar} of {key} needs a pickup in shortBars")
            if bar > last:
                raise ValueError(f"a rest on bar {bar} of {key} is after the last bar, {last}")


class ConfirmedMap(BaseModel):
    """map.confirmed.json; a body without version and savedAt (the editor's) is accepted too."""

    model_config = ConfigDict(extra="ignore", strict=True)

    version: Literal[1] = VERSION
    savedAt: str | None = None
    structureSetAt: str | None = None  # the "Set the piece structure" step's Confirm (2026-11-03)
    timing: TimingLayer
    pages: dict[str, PageLayer]

    @model_validator(mode="before")
    @classmethod
    def _older_map(cls, data: object) -> object:
        return with_rests_on_parts(data)

    @model_validator(mode="after")
    def _pages_belong_to_their_part(self) -> Self:
        if not self.timing.has_pickup and any(
            box.bar == 0 for layer in self.pages.values() for box in layer.bars
        ):
            raise ValueError("a box on bar 0 needs a pickup in shortBars")
        # Boxes are not held to the timing's bar count: the editor's Add bar line renumbers one
        # part's boxes and leaves the shared timing alone, and the Review Queue shows the gap.
        for key, layer in self.pages.items():
            if layer.partId != key:
                raise ValueError(f"the page layer of {key} says it belongs to {layer.partId}")
        _rests_are_inside_the_piece(self.timing, self.pages)
        return self


def _relative(path: str) -> str:
    """A path inside the run folder: relative, forward slashes, no `..`."""
    parts = PurePosixPath(path).parts
    if not path or "\\" in path or "\0" in path or path.startswith("/") or ".." in parts:
        raise ValueError("must be a path inside the run folder")
    return path


class _Run(BaseModel):
    """local-run.json is written by another program that may add keys, so extras are ignored."""

    model_config = ConfigDict(extra="ignore")


class RunPiece(_Run):
    id: str = Field(min_length=1)
    title: str
    createdAt: str
    countInBars: int = Field(ge=0, le=4)
    durationSec: float = Field(gt=0, allow_inf_nan=False)


class FileRecording(_Run):
    kind: Literal["file"]
    name: str


class YoutubeRecording(_Run):
    """Only so a run folder made before the music rule (Decision 2026-11-06) still reads."""

    kind: Literal["youtube"]
    url: str


class RunPart(_Run):
    id: str = Field(min_length=1)
    name: str
    nameSource: Literal["read", "user", "file"] = "file"
    position: int = Field(ge=0)
    pageCount: int = Field(ge=0)


class RunPageImage(_Run):
    pageIndex: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    file: str

    _inside = field_validator("file")(_relative)


class Alignment(_Run):
    """What a re-align needs beyond the timing: the frame rate of the activations."""

    fps: float = Field(gt=0, allow_inf_nan=False)


class RunBeat(_Run):
    """One beat Beat This found: its time, and how likely it is the first beat of a bar."""

    t: Seconds
    downbeat: float = Field(ge=0, le=1)


class LocalRun(_Run):
    version: Literal[1]
    piece: RunPiece
    recording: Annotated[FileRecording | YoutubeRecording, Field(discriminator="kind")]
    audio: str
    recordingName: str | None = None
    peaks: list[Annotated[int, Field(ge=0, le=127)]]
    parts: list[RunPart]
    pageImages: dict[str, list[RunPageImage]]
    timing: TimingLayer
    pages: dict[str, PageLayer]
    alignment: Alignment | None = None
    activations: str | None = None
    beats: list[RunBeat] | None = None  # None: a run made before the beats were kept

    @model_validator(mode="before")
    @classmethod
    def _older_run(cls, data: object) -> object:
        return with_rests_on_parts(data)

    @model_validator(mode="after")
    def _rests_fit_the_piece(self) -> Self:
        _rests_are_inside_the_piece(self.timing, self.pages)
        return self

    _audio_inside = field_validator("audio")(_relative)

    @field_validator("activations")
    @classmethod
    def _activations_inside(cls, value: str | None) -> str | None:
        return None if value is None else _relative(value)


@dataclass(frozen=True)
class RunRead:
    """A run as the app shows it: `timing` and `pages` are the confirmed map when there is one."""

    run: LocalRun
    timing: TimingLayer
    pages: dict[str, PageLayer]
    confirmed_at: str | None
    structure_set_at: str | None = None


def _problem(error: ValidationError) -> str:
    first = error.errors()[0]
    where = ".".join(str(part) for part in first["loc"])
    return f"{where}: {first['msg']}" if where else first["msg"]


def _load(path: Path, name: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RunFolderError(f"There is no {name} in this folder.") from None
    except (OSError, ValueError):
        raise RunFolderError(f"{name} is not readable JSON.") from None


def read_run_file(folder: Path) -> LocalRun:
    data = _load(folder / RUN_NAME, RUN_NAME)
    if isinstance(data, dict) and isinstance(data.get("alignment"), dict):
        if data["alignment"].get("ritBars"):  # rit. spans used to be kept here, not as marks
            raise RunFolderError(
                f"{RUN_NAME} keeps its rit. marks outside the timing; run run_piece.py again."
            )
    try:
        run = LocalRun.model_validate(data)
    except ValidationError as error:
        raise RunFolderError(f"{RUN_NAME} is not a valid run: {_problem(error)}.") from None
    return _with_names(run, read_names(folder))


@dataclass(frozen=True)
class Names:
    """What the user called the parts (by part id), the recording and the piece; None = none."""

    parts: dict[str, str]
    recording: str | None
    title: str | None = None


def _with_names(run: LocalRun, names: Names) -> LocalRun:
    """The run with the user's names over the pipeline's."""
    if not names.parts and names.recording is None and names.title is None:
        return run
    parts = [
        part.model_copy(update={"name": names.parts[part.id], "nameSource": "user"})
        if part.id in names.parts
        else part
        for part in run.parts
    ]
    update: dict[str, Any] = {"parts": parts}
    if names.recording is not None:
        update["recordingName"] = names.recording
    if names.title is not None:
        update["piece"] = run.piece.model_copy(update={"title": names.title})
    return run.model_copy(update=update)


def _name(value: object, longest: int) -> str | None:
    """The trimmed name, or None when it is not text of 1 to `longest` characters."""
    if not isinstance(value, str):
        return None
    name = value.strip()
    return name if 0 < len(name) <= longest else None


def read_names(folder: Path) -> Names:
    """The names in names.json; a missing file, or an entry that is no name, counts as none."""
    try:
        data = json.loads((folder / NAMES_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Names({}, None)
    if not isinstance(data, dict):
        return Names({}, None)
    given = data.get("parts")
    parts = {}
    for key, value in (given if isinstance(given, dict) else {}).items():
        if (name := _name(value, MAX_PART_NAME)) is not None:
            parts[key] = name
    return Names(
        parts,
        _name(data.get("recording"), MAX_RECORDING_NAME),
        _name(data.get("title"), MAX_PIECE_TITLE),
    )


def save_names(folder: Path, data: object) -> Names:
    """Add the names in `data` ({parts: {id: name}, recording: name, title: name}, each optional)
    to names.json.

    A name that is not 1 to 80 characters (120 for the recording, 200 for the title), or a part
    the run does not have, refuses the whole request and nothing is written. The file is swapped
    in whole; the run itself (local-run.json, the PDFs, piece.json) is never opened for writing.
    """
    if not isinstance(data, dict):
        raise RunFolderError("The names must be a JSON object with parts and recording.")
    known = {part.id for part in read_run_file(folder).parts}
    new_parts: dict[str, str] = {}
    given = data.get("parts", {})
    if not isinstance(given, dict):
        raise RunFolderError("The part names must be an object of names by part.")
    for part_id, value in given.items():
        if part_id not in known:
            raise RunFolderError("That part is not in this run.")
        if (name := _name(value, MAX_PART_NAME)) is None:
            raise RunFolderError(f"A part name must be 1 to {MAX_PART_NAME} characters.")
        new_parts[part_id] = name
    recording = None
    if data.get("recording") is not None:
        recording = _name(data["recording"], MAX_RECORDING_NAME)
        if recording is None:
            raise RunFolderError(
                f"The recording name must be 1 to {MAX_RECORDING_NAME} characters."
            )
    title = None
    if data.get("title") is not None:
        title = _name(data["title"], MAX_PIECE_TITLE)
        if title is None:
            raise RunFolderError(f"The piece title must be 1 to {MAX_PIECE_TITLE} characters.")
    before = read_names(folder)
    names = Names(
        {**before.parts, **new_parts}, recording or before.recording, title or before.title
    )
    _write_names(folder, names)
    return names


def forget_part_name(folder: Path, part_id: str) -> None:
    """Drop the name the user gave to a part that is deleted; a part with none changes nothing."""
    before = read_names(folder)
    if part_id in before.parts:
        parts = {key: name for key, name in before.parts.items() if key != part_id}
        _write_names(folder, Names(parts, before.recording, before.title))


def _write_names(folder: Path, names: Names) -> None:
    document: dict[str, Any] = {"parts": names.parts, "recording": names.recording}
    if names.title is not None:  # the key is there only once the piece has been renamed
        document["title"] = names.title
    text = json.dumps(document, ensure_ascii=False, indent=1)
    temp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", dir=folder, prefix=".names-", suffix=".tmp", encoding="utf-8", delete=False
        ) as handle:
            temp = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, folder / NAMES_NAME)
    except OSError:
        raise RunFolderError("The names could not be saved to the run folder.") from None
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def read_run(folder: Path) -> RunRead:
    """The run in `folder`, with the confirmed map when the editor has saved one."""
    run = read_run_file(folder)
    confirmed = folder / CONFIRMED_NAME
    if not confirmed.exists():
        return RunRead(run, run.timing, run.pages, None)
    try:
        saved = ConfirmedMap.model_validate(_load(confirmed, CONFIRMED_NAME))
    except (RunFolderError, ValidationError):
        raise RunFolderError(
            f"{CONFIRMED_NAME} is damaged; {PREV_NAME} holds the save before it."
        ) from None
    return RunRead(run, saved.timing, saved.pages, saved.savedAt, saved.structureSetAt)


def _parsed_map(data: object) -> ConfirmedMap:
    if not isinstance(data, dict):
        raise RunFolderError("The map must be a JSON object with timing and pages.")
    try:
        return ConfirmedMap.model_validate(data)
    except ValidationError as error:
        raise RunFolderError(f"The map is not valid: {_problem(error)}.") from None


def parse_map(data: object) -> tuple[TimingLayer, dict[str, PageLayer]]:
    """Validate a map as the editor sends it: {timing, pages}."""
    parsed = _parsed_map(data)
    return parsed.timing, parsed.pages


class _Keep:
    """write_confirmed's default: the structure flag already in the file stays as it is."""


KEEP = _Keep()


def map_structure_set_at(data: object) -> str | None | _Keep:
    """The structure flag a map body sends; KEEP when it does not say."""
    if isinstance(data, dict) and "structureSetAt" in data:
        return _parsed_map(data).structureSetAt
    return KEEP


class _TimingBody(BaseModel):
    """What the editor sends to re-align: {timing}, the timing it is showing."""

    model_config = ConfigDict(extra="ignore", strict=True)

    timing: TimingLayer

    @model_validator(mode="before")
    @classmethod
    def _older_timing(cls, data: object) -> object:
        """A re-align does not use rests, so the ones an older timing holds are dropped."""
        if isinstance(data, dict) and "timing" in data:
            return {**data, "timing": without_rests(data["timing"])[0]}
        return data


def parse_timing(data: object) -> TimingLayer:
    """Validate the timing sent for a re-align, as strictly as a save."""
    if not isinstance(data, dict):
        raise RunFolderError("The body must be a JSON object with a timing.")
    try:
        return _TimingBody.model_validate(data).timing
    except ValidationError as error:
        raise RunFolderError(f"The timing is not valid: {_problem(error)}.") from None


def _saved_structure_set_at(folder: Path) -> str | None:
    try:
        saved = ConfirmedMap.model_validate(_load(folder / CONFIRMED_NAME, CONFIRMED_NAME))
        return saved.structureSetAt
    except (RunFolderError, ValidationError):
        return None


def write_confirmed(
    folder: Path,
    timing: TimingLayer,
    pages: Mapping[str, PageLayer],
    structure_set_at: str | None | _Keep = KEEP,
) -> str:
    """Save the map as map.confirmed.json and return the time it was saved.

    `structure_set_at` is when the piece's structure was set; by default the value already in the
    file is kept, so a realign, an added part or a deleted part never drops it.

    The map is validated again (a bad one is refused and nothing is written), then written to a
    temp file in the folder and swapped in, so a crash never leaves half a file. The save before
    is kept as map.confirmed.prev.json.
    """
    timing, pages = parse_map(
        {
            "timing": timing.model_dump(by_alias=True, exclude_unset=True),
            "pages": {key: layer.model_dump(by_alias=True) for key, layer in pages.items()},
        }
    )
    known = {part.id for part in read_run_file(folder).parts}
    for part_id in pages:
        if part_id not in known:
            raise RunFolderError(
                f"The map has pages for {part_id}, which is not a part of this run."
            )
    saved_at = datetime.now(UTC).isoformat()
    if isinstance(structure_set_at, _Keep):
        confirmed = folder / CONFIRMED_NAME
        structure_set_at = _saved_structure_set_at(folder) if confirmed.exists() else None
    fields: dict[str, Any] = {"version": VERSION, "savedAt": saved_at, "timing": timing}
    if structure_set_at is not None:
        fields["structureSetAt"] = structure_set_at
    saved = ConfirmedMap(**fields, pages=dict(pages))
    text = json.dumps(
        saved.model_dump(by_alias=True, exclude_unset=True),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    _swap_in(folder, text)
    return saved_at


def _swap_in(folder: Path, text: str) -> None:
    temps: list[Path] = []
    try:
        with tempfile.NamedTemporaryFile(
            "w", dir=folder, prefix=".map-", suffix=".tmp", encoding="utf-8", delete=False
        ) as handle:
            temps.append(Path(handle.name))
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        confirmed = folder / CONFIRMED_NAME
        if confirmed.exists():
            prev = temps[0].with_name(".prev-" + temps[0].name)
            temps.append(prev)
            shutil.copyfile(confirmed, prev)
            os.replace(prev, folder / PREV_NAME)
        os.replace(temps[0], confirmed)
    except OSError:
        raise RunFolderError("The map could not be saved to the run folder.") from None
    finally:
        for temp in temps:
            temp.unlink(missing_ok=True)


def inside_folder(folder: Path, relative: str) -> Path:
    """The file at `relative` under `folder`; a path that leaves the folder is refused."""
    try:
        _relative(relative)
    except ValueError:
        raise RunFolderError("That path is not inside the run folder.") from None
    root = folder.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise RunFolderError("That path is not inside the run folder.")
    return path
