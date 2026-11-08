import base64
import io
import os
import threading
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import anthropic
import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, ValidationError

from app.pipeline.bar_boxes import BOX_MARGIN
from app.pipeline.run_folder import BarBox, BoxFlag
from app.pipeline.score_reader import PRICES

# The box check (Decisions 2026-11-03): a vision model looks at each line of a scanned part with
# our bar boxes drawn on it, and the boxes it finds wrong become Review Queue flags. The test that
# justified it is docs/BOX_CHECK_TEST.md (spikes/box_check*.py scored it). This file holds the parts
# the product uses: lines and pictures, the model's answers, the pixel rule for a suggested edge,
# the judge (a protocol, a fake, the Claude one) and check_part.

SAME_PX = 1.0  # boxes closer than this in every number share one place (a multi-rest's bars)
CROP_SPACES = 2.0  # a line picture reaches this many staff spaces above and below its boxes
LABEL_STRIP = 28  # px of white above the crop where the box numbers go
OUTLINE_PX = 2
COLOURS = [(230, 25, 75), (0, 110, 230)]  # alternating, so neighbours differ

Verdict = Literal[
    "ok", "signature_inside", "starts_late", "ends_early", "ends_late", "two_bars", "not_a_bar"
]
NOTATION_PROGRAMS = ("sibelius", "musescore", "dorico", "finale")


# ---------------------------------------------------------------- places and lines


@dataclass(frozen=True)
class Place:
    """Where one drawn box sits: one bar, or the bars of a multi-rest that share it."""

    page: int
    x: float
    y: float
    w: float
    h: float
    bars: list[int]

    @property
    def right(self) -> float:
        return self.x + self.w


@dataclass(frozen=True)
class Line:
    page: int
    places: list[Place]

    @property
    def top(self) -> float:
        return min(p.y for p in self.places)

    @property
    def bottom(self) -> float:
        return max(p.y + p.h for p in self.places)


def _same(a: BarBox, b: Place) -> bool:
    return a.pageIndex == b.page and all(
        abs(u - v) <= SAME_PX for u, v in ((a.x, b.x), (a.y, b.y), (a.w, b.w), (a.h, b.h))
    )


def places_of(boxes: Sequence[BarBox]) -> list[Place]:
    """The boxes in bar order, the bars that share one place joined."""
    places: list[Place] = []
    for b in sorted(boxes, key=lambda b: b.bar):
        if places and _same(b, places[-1]):
            places[-1].bars.append(b.bar)
        else:
            places.append(Place(b.pageIndex, b.x, b.y, b.w, b.h, [b.bar]))
    return places


def lines_of(places: Sequence[Place]) -> list[Line]:
    """The places grouped into staff lines (same page, the middle of one inside the other)."""
    groups: list[list[Place]] = []
    for p in sorted(places, key=lambda p: (p.page, p.y + p.h / 2, p.x)):
        middle = p.y + p.h / 2
        last = groups[-1] if groups else None
        if last and last[0].page == p.page and last[0].y <= middle <= last[0].y + last[0].h:
            last.append(p)
        else:
            groups.append([p])
    return [Line(g[0].page, sorted(g, key=lambda p: p.x)) for g in groups]


def staff_space(place: Place) -> float:
    """A box is its staff (4 spaces) and BOX_MARGIN spaces above and below it."""
    return place.h / (4 + 2 * BOX_MARGIN)


# ---------------------------------------------------------------- pictures

Crop = tuple[int, int, int, int]


def crop_of(line: Line, page_size: tuple[int, int]) -> Crop:
    """The page's full width, CROP_SPACES staff spaces above and below the line's boxes."""
    width, height = page_size
    margin = CROP_SPACES * staff_space(line.places[0])
    top = max(0, round(line.top - margin))
    bottom = min(height, round(line.bottom + margin))
    return (0, top, width, bottom)


def _font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # an older Pillow without sizes
        return ImageFont.load_default()


def draw_line(page: Image.Image, line: Line, crop: Crop, *, boxes: bool = True) -> Image.Image:
    """The line's crop under a white strip; with `boxes`, each box outlined in alternating colours
    with its number (1, 2 …) in the strip above it."""
    x0, y0, x1, y1 = crop
    picture = Image.new("RGB", (x1 - x0, y1 - y0 + LABEL_STRIP), "white")
    picture.paste(page.convert("RGB").crop(crop), (0, LABEL_STRIP))
    if not boxes:
        return picture
    pen = ImageDraw.Draw(picture)
    font = _font(LABEL_STRIP - 6)
    for i, place in enumerate(line.places):
        colour = COLOURS[i % len(COLOURS)]
        left, top = round(place.x - x0), round(place.y - y0 + LABEL_STRIP)
        right, bottom = round(place.right - x0) - 1, round(place.y + place.h - y0 + LABEL_STRIP) - 1
        pen.rectangle((left, top, right, bottom), outline=colour, width=OUTLINE_PX)
        pen.text((left + 3, 2), str(i + 1), fill=colour, font=font)
    return picture


# ---------------------------------------------------------------- answers


class BoxAnswer(BaseModel):
    box: int
    verdict: Verdict
    note: str


class LineAnswer(BaseModel):
    boxes: list[BoxAnswer]
    first_note_x: float | None  # variant D: where the first note or rest begins, 0-1 of the width


def verdicts_of(answer: LineAnswer, count: int) -> list[str]:
    """One verdict per box 1..count, in order; "missing" where the answer has none."""
    found: dict[int, str] = {}
    for item in answer.boxes:
        if 1 <= item.box <= count:
            found.setdefault(item.box, item.verdict)
    return [found.get(n, "missing") for n in range(1, count + 1)]


def is_flag(verdict: str) -> bool:
    return verdict not in ("ok", "missing")


# ---------------------------------------------------------------- the kind of PDF


def pdf_kind(*, text_chars: int, creator: str, producer: str) -> str:
    """The kind of PDF: "notation" when a notation program wrote it, "scan" with no text on page 1,
    else "unknown"."""
    names = f"{creator} {producer}".lower()
    if any(program in names for program in NOTATION_PROGRAMS):
        return "notation"
    return "scan" if text_chars == 0 else "unknown"


def pdf_kind_of(data: bytes) -> str:
    """pdf_kind of a PDF's bytes (the text of page 1, the creator and producer); "unknown" when
    PyMuPDF cannot open it."""
    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            meta = document.metadata or {}
            chars = len(document[0].get_text().strip())
    except Exception:  # PyMuPDF raises its own types for a damaged file
        return "unknown"
    return pdf_kind(
        text_chars=chars, creator=meta.get("creator") or "", producer=meta.get("producer") or ""
    )


# ---------------------------------------------------------------- the judge and its cache


@dataclass(frozen=True)
class JudgeRequest:
    model: str
    variant: str  # A, B, C or D (see the plan)
    run: int  # 1 or 2: each variant is asked twice, for stability
    pictures: list[bytes]  # PNGs: the boxed line (B: the clean line first)
    count: int  # the boxes drawn on the line


@dataclass(frozen=True)
class JudgeAnswer:
    answer: LineAnswer
    input_tokens: int
    output_tokens: int
    seconds: float
    cost_usd: float = 0.0
    cached: bool = field(default=False, compare=False)


class BoxJudge(Protocol):
    def judge(self, request: JudgeRequest) -> JudgeAnswer: ...


class FakeBoxJudge:
    """A BoxJudge that answers with the given answers in call order and records its calls."""

    def __init__(self, answers: list[JudgeAnswer]) -> None:
        self._answers = list(answers)
        self.calls: list[JudgeRequest] = []

    def judge(self, request: JudgeRequest) -> JudgeAnswer:
        self.calls.append(request)
        return self._answers.pop(0)


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICES.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1e6


# ---------------------------------------------------------------- stage 2: a line start's edge

DARK = 128  # a grey value below this is ink
STAFF_ROW_SHARE = 0.5  # a row dark over this share of the band's width is a staff line
MIN_INK = 2  # px of ink (staff lines left out) that make a column count
JOIN_SPACES = 0.3  # ink blocks closer than this are one glyph
SIGNATURE_SPACES = 1.0  # glyphs closer than this belong to one opening (clef, key, time)
EDGE_SPACES = 0.5  # the new edge sits this far from the ink it is placed by


def staff_rows(band: np.ndarray) -> list[int]:
    """The rows of a grey band (0 black, 255 white) that are staff lines, with the row on each
    side of one (a scanned line is thick and grey at its edges)."""
    dark = (band < DARK).mean(axis=1)
    lines = set(np.nonzero(dark > STAFF_ROW_SHARE)[0].tolist())
    near = {r + d for r in lines for d in (-1, 1)} & set(range(band.shape[0]))
    return sorted(lines | near)


def column_ink(band: np.ndarray) -> list[int]:
    """Per column, the ink pixels of the band outside its staff lines."""
    keep = np.ones(band.shape[0], dtype=bool)
    keep[staff_rows(band)] = False
    return [int(n) for n in (band[keep] < DARK).sum(axis=0)]


def ink_blocks(ink: list[int], space: float) -> list[tuple[int, int]]:
    """Runs of inked columns as (start, end), runs closer than JOIN_SPACES joined."""
    blocks: list[tuple[int, int]] = []
    for x, n in enumerate(ink):
        if n < MIN_INK:
            continue
        if blocks and x - blocks[-1][1] < JOIN_SPACES * space:
            blocks[-1] = (blocks[-1][0], x + 1)
        else:
            blocks.append((x, x + 1))
    return blocks


@dataclass(frozen=True)
class OpeningEdges:
    after_signature: float  # the plan's rule: the opening's last ink plus EDGE_SPACES
    before_first_note: float  # for comparison: the next ink less EDGE_SPACES


def opening_edges(
    ink: list[int], *, left: float, space: float, gap: float = SIGNATURE_SPACES
) -> OpeningEdges | None:
    """Where a line's first box should start: the opening is the ink from `left` on whose glyphs
    are closer than `gap` staff spaces; None when no wider gap follows it."""
    blocks = [b for b in ink_blocks(ink, space) if b[1] > left]
    if not blocks:
        return None
    end = blocks[0][1]
    for start, stop in blocks[1:]:
        if start - end >= gap * space:
            return OpeningEdges(end + EDGE_SPACES * space, start - EDGE_SPACES * space)
        end = stop
    return None


# ---------------------------------------------------------------- the Claude judge

MODEL = "claude-haiku-5-5"
EFFORT = "high"
MAX_TOKENS = 16000
TIMEOUT_SEC = 180
WORKERS = 6  # lines asked at once: a 20-line part takes about half a minute instead of two

PROMPT = """This picture is ONE line (system) of an instrumental part, cut from its page at full \
width. A program drew coloured rectangles on it, numbered 1 to {count} in the white strip above \
them. Each rectangle is meant to hold exactly one bar (measure); a multi-measure rest (a thick bar \
with a number above it) is one rectangle for all its bars.
A right rectangle: its left edge sits at the bar line that starts its bar, or, for the first bar \
of the line, just after the clef, key signature and time signature, where the bar's music begins; \
its right edge sits at the bar line that ends the bar. An edge up to half a staff space off is \
still right.
Give each rectangle exactly one verdict:
- "ok": right as described.
- "signature_inside": a clef, key signature or time signature lies inside it.
- "starts_late": it begins after its bar's first note or rest, cutting off music of its bar.
- "ends_early": it ends before its bar line, leaving music of its bar outside.
- "ends_late": it runs past its bar line into the next bar.
- "two_bars": a bar line runs through its inside, so it holds more than one bar.
- "not_a_bar": it holds no bar (empty staff after the last bar line, a courtesy signature).
"note": a few words on what you see, empty for "ok". Return one entry for each rectangle, 1 to \
{count}, in "boxes". Set "first_note_x" to null."""
CLEAN_NOTE = """The first picture is the same line without rectangles, for comparison; judge the \
rectangles on the second."""
X_NOTE = """Instead of null, set "first_note_x" to where the first note or rest of rectangle 1's \
bar begins, as a fraction of the picture's width (0 is the left edge, 1 the right edge)."""


class BoxCheckError(ValueError):
    """A line could not be checked; the message is one sentence a user may read."""


_NO_KEY = "The box check needs an Anthropic API key; set ANTHROPIC_API_KEY."
_KEY_REFUSED = "The Anthropic API refused the Anthropic API key; check ANTHROPIC_API_KEY."
_UNREACHABLE = "The Anthropic API could not be reached for the box check; try again later."
_API_ERROR = "The Anthropic API returned an error during the box check; try again later."
_DECLINED = "The box check model declined to look at this line."
_NOT_THE_SCHEMA = "The box check model's reply did not fit the expected format."


class ClaudeBoxJudge:
    """BoxJudge over the Anthropic Messages API.

    The client is made from ANTHROPIC_API_KEY on the first call, so building a judge needs no key.
    """

    def __init__(self, client: Any = None) -> None:
        self._client = client
        self._lock = threading.Lock()

    def judge(self, request: JudgeRequest) -> JudgeAnswer:
        client = self._client_or_new()
        content: list[dict[str, Any]] = []
        for picture in request.pictures:
            data = base64.standard_b64encode(picture).decode()
            source = {"type": "base64", "media_type": "image/png", "data": data}
            content.append({"type": "image", "source": source})
        text = PROMPT.format(count=request.count)
        if request.variant == "B":
            text += "\n" + CLEAN_NOTE
        if request.variant == "D":
            text += "\n" + X_NOTE
        content.append({"type": "text", "text": text})
        start = time.monotonic()
        try:
            response = client.messages.parse(
                model=request.model,
                max_tokens=MAX_TOKENS,
                timeout=TIMEOUT_SEC,
                output_config={"effort": EFFORT},
                messages=[{"role": "user", "content": content}],
                output_format=LineAnswer,
            )
        except anthropic.AuthenticationError as err:
            raise BoxCheckError(_KEY_REFUSED) from err
        except anthropic.APIConnectionError as err:
            raise BoxCheckError(_UNREACHABLE) from err
        except anthropic.APIError as err:
            raise BoxCheckError(_API_ERROR) from err
        except ValidationError as err:
            raise BoxCheckError(_NOT_THE_SCHEMA) from err
        seconds = time.monotonic() - start
        if response.stop_reason == "refusal":
            raise BoxCheckError(_DECLINED)
        answer = response.parsed_output
        if answer is None:
            raise BoxCheckError(_NOT_THE_SCHEMA)
        usage = response.usage
        cost = cost_usd(request.model, usage.input_tokens, usage.output_tokens)
        return JudgeAnswer(answer, usage.input_tokens, usage.output_tokens, seconds, cost)

    def _client_or_new(self) -> Any:
        with self._lock:
            if self._client is None:
                if not os.environ.get("ANTHROPIC_API_KEY"):
                    raise BoxCheckError(_NO_KEY)
                self._client = anthropic.Anthropic()
            return self._client


# ---------------------------------------------------------------- checking a part

EDGE_ROOM_SPACES = 2.0  # a suggested edge leaves at least this much of the box on its right
EDGE_VERDICTS = ("signature_inside", "starts_late")


@dataclass(frozen=True)
class PartCheck:
    """What checking a part found: the flags, what to tell the user, what the calls cost."""

    flags: list[BoxFlag]
    warnings: list[str]
    cost_usd: float


@dataclass(frozen=True)
class _LineResult:
    flags: list[BoxFlag]
    cost_usd: float
    problem: str | None = None


def _png(image: Image.Image) -> bytes:
    data = io.BytesIO()
    image.save(data, format="PNG")
    return data.getvalue()


def _notes_of(answer: LineAnswer, count: int) -> dict[int, str]:
    notes: dict[int, str] = {}
    for item in answer.boxes:
        if 1 <= item.box <= count:
            notes.setdefault(item.box, item.note)
    return notes


def _suggested_edge(page: Image.Image, place: Place) -> float | None:
    """The line start's new left edge by the page's pixels (opening_edges), when it fits the box:
    right of the box's left edge and at least EDGE_ROOM_SPACES staff spaces from its right."""
    space = staff_space(place)
    pixels = np.asarray(page.convert("L"))
    band = pixels[round(place.y) : round(place.y + place.h), 0 : round(place.right)]
    edges = opening_edges(column_ink(band), left=place.x, space=space)
    if edges is None:
        return None
    x = edges.after_signature
    return round(x, 1) if place.x < x < place.right - EDGE_ROOM_SPACES * space else None


def _check_line(line: Line, page: Image.Image, judge: BoxJudge) -> _LineResult:
    crop = crop_of(line, page.size)
    clean = _png(draw_line(page, line, crop, boxes=False))
    boxed = _png(draw_line(page, line, crop))
    request = JudgeRequest(MODEL, "B", 1, [clean, boxed], len(line.places))
    try:
        reply = judge.judge(request)
    except BoxCheckError as error:
        return _LineResult([], 0.0, str(error))
    verdicts = verdicts_of(reply.answer, len(line.places))
    notes = _notes_of(reply.answer, len(line.places))
    flags: list[BoxFlag] = []
    for number, (place, verdict) in enumerate(zip(line.places, verdicts, strict=True), start=1):
        if not is_flag(verdict):
            continue
        edge = _suggested_edge(page, place) if number == 1 and verdict in EDGE_VERDICTS else None
        flags.append(
            BoxFlag.model_validate(
                {
                    "bar": place.bars[0],
                    "verdict": verdict,
                    "note": notes.get(number, "").strip(),
                    "suggestedX": edge,
                }
            )
        )
    return _LineResult(flags, reply.cost_usd)


def _list_of(numbers: list[int]) -> str:
    texts = [str(n) for n in numbers]
    return texts[0] if len(texts) == 1 else f"{', '.join(texts[:-1])} and {texts[-1]}"


def check_part(
    boxes: Sequence[BarBox],
    page_images: Mapping[int, Image.Image],
    judge: BoxJudge,
    *,
    workers: int = WORKERS,
) -> PartCheck:
    """Ask the judge about each line of a part's boxes (one request per line: the clean picture,
    then the boxed one) and turn each verdict but "ok" into a flag on the box's first bar.

    A flag on a line's first box carries a suggested left edge when the verdict is a signature
    inside or a late start and the page's pixels give one. A line whose call fails, or whose page
    is missing, gives no flags and a warning; it never fails the check.
    """
    lines = lines_of(places_of(boxes))
    results: list[_LineResult | None] = [None] * len(lines)
    problems: dict[str, list[int]] = {}

    def ask(item: tuple[int, Line]) -> tuple[int, _LineResult]:
        index, line = item
        return index, _check_line(line, page_images[line.page], judge)

    askable: list[tuple[int, Line]] = []
    for index, line in enumerate(lines):
        if line.page in page_images:
            askable.append((index, line))
        else:
            problems.setdefault(f"Page {line.page + 1} has no picture.", []).append(index + 1)
    with ThreadPoolExecutor(max(1, min(workers, len(askable) or 1))) as pool:
        for index, result in pool.map(ask, askable):
            results[index] = result
    for index, result in enumerate(results):
        if result is not None and result.problem is not None:
            problems.setdefault(result.problem, []).append(index + 1)
    flags = [flag for result in results if result for flag in result.flags]
    cost = sum(result.cost_usd for result in results if result)
    warnings = [
        f"The box check skipped line{'s' if len(numbers) > 1 else ''} "
        f"{_list_of(sorted(numbers))}. {reason}"
        for reason, numbers in problems.items()
    ]
    return PartCheck(flags, warnings, cost)
