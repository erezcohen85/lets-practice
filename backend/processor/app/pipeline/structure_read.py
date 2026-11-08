from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from app.pipeline.audiveris import OmrBook, OmrEngine
from app.pipeline.bar_boxes import BoxAudit, PageTarget, map_boxes
from app.pipeline.consensus import (
    Choice,
    Evidence,
    StructureAudit,
    choose_counts,
    disputed_lines,
    line_counts,
    structure_audit,
)
from app.pipeline.line_crops import LineCrop, line_crops
from app.pipeline.models import BarBox, MeterChange, PlayOrderRow
from app.pipeline.omr import (
    OmrLine,
    OmrMeasure,
    omr_lines,
    parse_omr_sheet,
    parse_omr_systems,
    read_omr_ink,
)
from app.pipeline.pickup import (
    audiveris_vote,
    decide_pickup,
    first_measure,
    number_vote,
    reader_vote,
    renumbered,
    renumbered_boxes,
    short_bars_in_the_middle,
)
from app.pipeline.play_order import STRAIGHT_THROUGH
from app.pipeline.score_reader import (
    LinePicture,
    Reading,
    ReadLine,
    ScoreReader,
    ScoreReaderError,
    reread_caption,
)
from app.pipeline.sentences import user_sentence
from app.pipeline.structure import (
    PieceStructure,
    bars_of,
    blank_measure,
    merge_reading,
    number_warnings,
    structure_from_reading,
)

if TYPE_CHECKING:
    from app.pipeline.stages import RenderedPart

# The hybrid structure read of one part, end to end: Audiveris finds the systems, the score
# reader (Claude vision) reads each line's marks, and the measures of every line are decided by
# the reader, Audiveris and the page's own bar lines together (consensus.py). The result is the
# part's bar boxes on the stored page images and what the score says about the piece (meters,
# repeats, fermatas, rests, rit. spans). Without the reader the read falls back to Audiveris and
# the page pixels alone: it finds the bars, the printed meters and the repeat signs, and says so.
#
# Audiveris numbers its sheets by PDF page, from 1, so sheet N is our page N - 1. A page it
# skipped has no sheet: it has no lines and no ink, and a warning says so. Every page index here
# is ours (0-based), the one `RenderedPart` and the stored images use.

_NO_VISION = "The score's structure was read without the vision model"
_CHECK = "check repeats, fermatas and rests."
NO_KEY_WARNING = f"{_NO_VISION} (no Anthropic key); {_CHECK}"
# the sentences that name a bar of the first read; structure_shift.py renames the bar when
# Advanced Reading changes the bar count of a line before it
SHORT_BAR_NOTE = "Bar {bar} holds {units} of the notes of its meter; it is set as a short bar."
UNSURE_LINE = (
    "Page {page}, the line from bar {bar}: the bar lines could not be checked against the page; "
    "check its boxes."
)
_FALLBACK_WARNING = f"{_NO_VISION}; {_CHECK}"


class StructureReadError(ValueError):
    """A part whose bars cannot be found; the message is one sentence for the job."""


@dataclass(frozen=True)
class PartAudits:
    """What the checks did: the measure count of every line, and the bar lines of every line."""

    structure: StructureAudit
    boxes: BoxAudit


@dataclass(frozen=True)
class PartRead:
    """One part as read: its bar boxes, what its score says, and what to tell the user.

    `structure` is the part's own reading. The reading most parts agree on sets the timing; a
    later part is checked against it (`part_problems`). `part_name` is the instrument the reader
    found in the header, None without the reader or when no name is printed.
    """

    boxes: list[BarBox]
    structure: PieceStructure
    audits: PartAudits
    cost_usd: float
    warnings: list[str]
    part_name: str | None


# ---------------------------------------------------------------- the pages


def _omr_lines(book: OmrBook, rendered: "RenderedPart") -> tuple[list[OmrLine], list[str]]:
    """Every system of the part in reading order, and a warning for each page with no sheet."""
    pages, geometries, found = [], [], set()
    for xml, number in zip(book.sheets, book.sheet_numbers, strict=True):
        index = number - 1
        if not 0 <= index < len(rendered.pages):
            raise StructureReadError("The score reader found a page that is not in the PDF.")
        pages.append(parse_omr_sheet(xml, index))
        geometries.append(parse_omr_systems(xml, index))
        found.add(index)
    lines = omr_lines(pages, geometries)
    if not lines:
        raise StructureReadError("No staves were found in the score.")
    skipped = [
        f"The score reader found no music on page {index + 1}; its bars are missing."
        for index in range(len(rendered.pages))
        if index not in found
    ]
    return lines, skipped


def _ink(book: OmrBook) -> dict[int, np.ndarray]:
    """The page images Audiveris worked from, keyed by our page index."""
    return {number - 1: image for number, image in read_omr_ink(book.omr_path).items()}


def _targets(rendered: "RenderedPart") -> dict[int, PageTarget]:
    return {
        index: PageTarget(page.width, page.height, angle)
        for index, (page, angle) in enumerate(zip(rendered.pages, rendered.angles_deg, strict=True))
    }


# ---------------------------------------------------------------- the readings


@dataclass(frozen=True)
class _FirstLook:
    """The reader's first reading of the part, the crops it saw, and what it cost."""

    reading: Reading
    crops: list[LineCrop]
    cost_usd: float


def _look(reader: ScoreReader, lines: list[OmrLine], ink: dict[int, np.ndarray]) -> _FirstLook:
    """One picture per line to the reader; its reading must hold one line for each."""
    crops = line_crops(lines, ink)
    result = reader.read([LinePicture(crop.label, crop.png) for crop in crops])
    if len(result.reading.lines) != len(crops):
        raise ScoreReaderError(
            f"The score reader returned {len(result.reading.lines)} lines for {len(crops)} "
            "pictures."
        )
    # the reader is told pages count from 1; the line keeps the page it was cut from
    read_lines = [
        line.model_copy(update={"page": crop.page + 1})
        for line, crop in zip(result.reading.lines, crops, strict=True)
    ]
    return _FirstLook(
        result.reading.model_copy(update={"lines": read_lines}), crops, result.cost_usd
    )


def _signature(measure: OmrMeasure) -> str | None:
    meter = measure.time_signature
    return None if meter is None else f"{meter.numerator}/{meter.denominator}"


def _repeat(measure: OmrMeasure) -> str:
    if measure.repeat_start and measure.repeat_end:
        return "both"
    if measure.repeat_start:
        return "start"
    return "end" if measure.repeat_end else "none"


def _audiveris_reading(lines: list[OmrLine], seen: list[tuple[int | None, int | None]]) -> Reading:
    """What Audiveris alone says: a measure per column with its printed meter and repeat sign.

    The reading has as many measures per line as Audiveris or the page counted, and takes each
    measure's signs from the column in the same place (by order, so a column merged away by the
    consensus can shift them; the warning asks the user to check).
    """
    out: list[ReadLine] = []
    for line, (audiveris, pixels) in zip(lines, seen, strict=True):
        count = next((c for c in (audiveris, pixels) if c is not None), 1)
        columns = line.system.measures
        measures = [
            blank_measure().model_copy(
                update={
                    "time_signature": _signature(columns[k]),
                    "repeat": _repeat(columns[k]),
                }
            )
            if k < len(columns)
            else blank_measure()
            for k in range(count)
        ]
        out.append(ReadLine(page=line.page + 1, printed_start_number=None, measures=measures))
    _carry_courtesy_meters(lines, out)
    return Reading(part_name=None, lines=out, doubts=[])


def _carry_courtesy_meters(lines: list[OmrLine], out: list[ReadLine]) -> None:
    """A time signature printed as a courtesy at the end of a line, in a column that got no
    measure (bar_boxes.trim_courtesy), is the meter of the next line's first measure, unless that
    one prints its own."""
    for k, (line, read) in enumerate(zip(lines[:-1], out[:-1], strict=True)):
        columns = line.system.measures
        if len(columns) != len(read.measures) + 1 or columns[-1].duration != 0:
            continue  # only the last column, in which Audiveris found no music, was left out
        courtesy = _signature(columns[-1])
        following = out[k + 1].measures
        if courtesy is not None and following and following[0].time_signature is None:
            following[0] = following[0].model_copy(update={"time_signature": courtesy})


def _evidence(
    lines: list[OmrLine], seen: list[tuple[int | None, int | None]], reading: Reading
) -> list[Evidence]:
    """What the reading, Audiveris and the page each say about the measures of every line."""
    return [
        Evidence(
            number,
            line.page,
            len(read.measures),
            audiveris,
            pixels,
            read.printed_start_number,
            bars_of(read.measures) - len(read.measures),
        )
        for number, (line, (audiveris, pixels), read) in enumerate(
            zip(lines, seen, reading.lines, strict=True), start=1
        )
    ]


def _reread(
    reader: ScoreReader,
    crops: list[LineCrop],
    evidence: list[Evidence],
    choices: list[Choice],
    disputed: list[int],
) -> tuple[dict[int, ReadLine], list[str], float]:
    """The disputed lines shown to the reader once more, with the count the page gives them.

    Returns each line's second reading by its index, the doubts it voiced and the cost.
    """
    first_bars, bar = [], 1
    for e, c in zip(evidence, choices, strict=True):
        first_bars.append(bar)
        bar += c.count + e.rests
    pictures = [
        LinePicture(
            crops[i].label,
            crops[i].png,
            reread_caption(choices[i].count, first_bars[i]),
        )
        for i in disputed
    ]
    result = reader.read(pictures)
    if len(result.reading.lines) != len(pictures):
        raise ScoreReaderError(
            f"The score reader returned {len(result.reading.lines)} lines for {len(pictures)} "
            "pictures."
        )
    rereads = dict(zip(disputed, result.reading.lines, strict=True))
    return rereads, result.reading.doubts, result.cost_usd


# ---------------------------------------------------------------- the part


def read_part(
    pdf: Path,
    rendered: "RenderedPart",
    engine: OmrEngine,
    reader: ScoreReader | None,
    work_dir: Path,
) -> PartRead:
    """Read one part's PDF: its bar boxes on the stored images and its structure.

    `rendered` is the part's stored page images (their sizes and levelling angles map Audiveris'
    pixels onto them). With no `reader`, or when it fails, the structure comes from Audiveris and
    the page pixels alone and a warning says so; the job does not fail on the reader.
    """
    book = engine.run(pdf, work_dir)
    lines, warnings = _omr_lines(book, rendered)
    ink = _ink(book)
    seen = [line_counts(line, ink.get(line.page)) for line in lines]

    cost, look = 0.0, None
    if reader is None:
        warnings.append(NO_KEY_WARNING)
    else:
        try:
            look = _look(reader, lines, ink)
            cost = look.cost_usd
        except (ScoreReaderError, ValueError) as error:  # ValueError: a page with no image
            warnings += [user_sentence(error, (ScoreReaderError,)), _FALLBACK_WARNING]

    first = look.reading if look else _audiveris_reading(lines, seen)
    evidence = _evidence(lines, seen, first)
    choices = choose_counts(evidence)

    rereads: dict[int, ReadLine] = {}
    doubts = list(first.doubts)
    disputed = disputed_lines(evidence, choices) if look else []
    if look and disputed:
        try:
            rereads, again, extra = _reread(reader, look.crops, evidence, choices, disputed)
            doubts += again
            cost += extra
        except ScoreReaderError as error:  # keep the first reading; its marks go by order
            warnings += [str(error), "The disputed lines were not read again; check their marks."]

    final, merged = merge_reading(first, [c.count for c in choices], rereads)
    final = final.model_copy(update={"doubts": doubts})
    structure = structure_from_reading(final)

    spans = [[m.multi_rest_bars for m in line.measures] for line in final.lines]
    box_map = map_boxes(lines, spans, ink, _targets(rendered))
    audit = structure_audit(
        evidence,
        choices,
        {i: len(line.measures) for i, line in rereads.items()},
        [bars_of(line.measures) for line in final.lines],
    )
    structure, boxes, notes = _with_the_pickup(structure, box_map.boxes, lines, final, bool(look))
    warnings += [*structure.warnings, *merged, *number_warnings(final), *_unsure(box_map.audit)]
    warnings += notes
    return PartRead(
        boxes=boxes,
        structure=structure,
        audits=PartAudits(audit, box_map.audit),
        cost_usd=cost,
        warnings=warnings,
        part_name=final.part_name,
    )


def _with_the_pickup(
    structure: PieceStructure,
    boxes: list[BarBox],
    lines: list[OmrLine],
    final: Reading,
    reader_looked: bool,
) -> tuple[PieceStructure, list[BarBox], list[str]]:
    """The structure and boxes with the bars Audiveris found short, and with a pickup made bar 0
    (every number one down) when the readings of the first measure say so."""
    short = short_bars_in_the_middle(_columns_by_bar(lines, final), structure.meters)
    structure = replace(structure, short_bars=short)
    notes = [SHORT_BAR_NOTE.format(bar=bar, units=units) for bar, units in short.items()]
    if structure.bar_count < 2:
        return structure, boxes, notes
    votes = [
        audiveris_vote(first_measure(lines), structure.meters[0]),
        reader_vote(final.lines[0] if reader_looked and final.lines else None),
        number_vote(final.lines),
    ]
    found = decide_pickup(votes)
    if found.units is None:
        return structure, boxes, notes
    moved = renumbered(structure, -1)
    moved = replace(
        moved, short_bars={0: found.units, **moved.short_bars}, pickup_sources=found.sources
    )
    return moved, renumbered_boxes(boxes, -1), notes


def _columns_by_bar(lines: list[OmrLine], final: Reading) -> list[tuple[int, OmrMeasure]]:
    """Audiveris' column of every bar after the first, where a line has as many columns as
    measures (a line whose columns were merged or split cannot be matched by order)."""
    pairs: list[tuple[int, OmrMeasure]] = []
    bar = 1
    for omr, read in zip(lines, final.lines, strict=True):
        columns = omr.system.measures
        for k, measure in enumerate(read.measures):
            if len(columns) == len(read.measures) and measure.multi_rest_bars == 1 and bar > 1:
                pairs.append((bar, columns[k]))
            bar += measure.multi_rest_bars
    return pairs


def _unsure(audit: BoxAudit) -> list[str]:
    """A warning for every line whose bar lines the page could not confirm."""
    return [
        UNSURE_LINE.format(page=line.page + 1, bar=line.bar)
        for line in audit.lines
        if line.confidence == "uncertain"
    ]


# ---------------------------------------------------------------- the parts of a piece


def _meter_text(meters: list[MeterChange]) -> str:
    return ", ".join(f"{m.numerator}/{m.denominator} from bar {m.from_bar}" for m in meters)


def _most_common(
    items: Sequence[PieceStructure], key: Callable[[PieceStructure], object]
) -> object:
    """The value of `key` most of `items` have; on a tie, the one that comes first."""
    votes = Counter(key(item) for item in items)
    # Counter keeps first-seen order, and max returns the first of equals.
    return max(votes, key=lambda value: votes[value])


def _gave_up_on_the_marks(structure: PieceStructure) -> bool:
    return any(warning.endswith(STRAIGHT_THROUGH) for warning in structure.warnings)


def _order_of(structure: PieceStructure) -> tuple[tuple[int, int], ...]:
    return tuple((row.start, row.end) for row in structure.play_order)


def _meters_of(structure: PieceStructure) -> tuple[tuple[int, int, int], ...]:
    return tuple((m.from_bar, m.numerator, m.denominator) for m in structure.meters)


def elect_piece_structure(parts: list[PieceStructure]) -> PieceStructure:
    """The part whose reading the piece takes: the one most parts agree with, so one misread part
    does not set the timing for all (Sousa's Flutes, 2026-11-06).

    The parts vote on the bar count, then those vote on the play order, then those on the meters.
    One part's whole reading is taken, so its bar numbers, marks and short bars fit each other. A
    part that could not follow its repeat signs has no vote on the play order, unless none could:
    its straight through is a fallback, not a reading. A tie goes to the part that comes first, so
    parts that agree, or two that differ, leave the first part as the piece.
    """
    count = _most_common(parts, lambda part: part.bar_count)
    voters = [part for part in parts if part.bar_count == count]
    voters = [part for part in voters if not _gave_up_on_the_marks(part)] or voters
    order = _most_common(voters, _order_of)
    voters = [part for part in voters if _order_of(part) == order]
    meters = _most_common(voters, _meters_of)
    return next(part for part in voters if _meters_of(part) == meters)


def agree_on_pickup(parts: list[PartRead], piece: PieceStructure | None = None) -> list[PartRead]:
    """The parts with the piece's answer to "is there a pickup": the first part's, or the
    stored structure of a piece that is given (parts added to a piece that has its timing).

    A later part that read the other answer, and whose bars are one more or fewer to match,
    has its numbers moved to the first part's: a pickup the first part found is made bar 0 in
    the others, and a pickup only a later part found is made bar 1 again. A part whose bar
    count still differs is left for part_problems to report.
    """
    if not parts:
        return parts
    reference = piece or parts[0].structure
    pickup = reference.short_bars.get(0)
    agreed = [] if piece else [parts[0]]
    for part in parts[0 if piece else 1 :]:
        own = part.structure
        if (
            pickup is not None
            and 0 not in own.short_bars
            and own.bar_count == reference.bar_count + 1
        ):
            moved = renumbered(own, -1)
            moved = replace(
                moved,
                short_bars={0: pickup, **moved.short_bars},
                pickup_sources=reference.pickup_sources,
            )
            part = replace(part, structure=moved, boxes=renumbered_boxes(part.boxes, -1))
        elif pickup is None and 0 in own.short_bars and own.bar_count + 1 == reference.bar_count:
            part = replace(
                part, structure=renumbered(own, 1), boxes=renumbered_boxes(part.boxes, 1)
            )
        elif pickup is None and 0 in own.short_bars and own.bar_count == reference.bar_count:
            part = _without_pickup(part)
        agreed.append(part)
    return agreed


def _without_pickup(part: PartRead) -> PartRead:
    """A part that read a pickup in front of as many bars as the piece, which has none: its bar
    0 is left out (the piece's timing has no slot for it) and a warning says so."""
    own = part.structure
    structure = replace(
        own,
        short_bars={bar: units for bar, units in own.short_bars.items() if bar != 0},
        pickup_sources=0,
        bar_marks=[mark for mark in own.bar_marks if mark.bar != 0],
        rests=[bar for bar in own.rests if bar != 0],
        tempo_text={bar: text for bar, text in own.tempo_text.items() if bar != 0},
        play_order=[
            PlayOrderRow(start=max(row.start, 1), end=row.end)
            for row in own.play_order
            if row.end >= 1
        ],
    )
    warning = "a pickup bar was read that the piece does not have; its box was left out."
    return replace(
        part,
        structure=structure,
        boxes=[box for box in part.boxes if box.bar != 0],
        warnings=[*part.warnings, warning],
    )


def part_problems(
    name: str, part: PartRead, bar_count: int, meters: list[MeterChange]
) -> list[str]:
    """What is wrong with a part that is read against the piece's shared timing.

    The piece's bar count and meters are those most parts agree on. A part that reads another number
    of bars, or other meters, is a problem of that part (Decision 2026-10-28), not a failed job.
    """
    found = []
    if part.structure.bar_count != bar_count:
        found.append(
            f"{name} has {part.structure.bar_count} bars but the piece has {bar_count}; "
            "check its bar lines."
        )
    if part.structure.meters != meters:
        found.append(
            f"{name} has the meters {_meter_text(part.structure.meters)} but the piece has "
            f"{_meter_text(meters)}; check them."
        )
    return found
