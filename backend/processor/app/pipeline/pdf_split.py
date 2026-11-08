import base64
import json
import logging
import os
import re
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Protocol, runtime_checkable

import anthropic
import pymupdf
from PIL import Image

from app.pipeline.name_suggester import PDF_DPI, top_strip
from app.pipeline.score_reader import MODEL, PRICES

# Splits one PDF that holds several parts, printed one after another, into its parts. Claude Haiku
# (the model the score reader uses) reads the top of every page, one call each, behind
# PageHeaderReader (FakePageHeaderReader stands in for it in tests): the part named in the
# header, the page number printed, and whether the page is a full score. group_pages turns those
# answers into proposed parts and write_part_pdf copies a part's pages into a PDF of its own,
# without rendering them again. A full score (every part on each system) is only recognised here;
# what to do with it is the caller's.

MAX_PAGES = 120  # the number of parts is not limited (Erez, 2026-11-06)
MAX_TOKENS = 200
TIMEOUT_SEC = 60
# A third of the page: the header and the title block of a first page, and the first system under
# it, whose left edge shows whether it holds one instrument's staff or several instruments'.
STRIP_FRACTION = 1 / 3
READ_WORKERS = 6  # calls in flight at once: 120 pages one at a time would take minutes
# A page picture is shown at 320 px beside its tile while the pointer rests on the tile, so it is
# rendered at twice that for a retina screen; the 72 px tile uses the same file.
THUMB_WIDTH = 640

PROMPT = """Above is the top third of one page of printed sheet music: the header and the first
system. It belongs to a PDF that may hold several instrumental parts one after another. Reply with
JSON and nothing else, with exactly these keys:
- "part_name": the instrument or part this page is for, as printed in its header, e.g. "Flute",
  "Clarinet in B♭ 2", "Trombone 1" ("Violin I" stays "Violin I"). Not the title of the piece or the
  composer. null if the page names no part.
- "printed_page": the page number printed on the page, as an integer, or null if none is printed.
- "full_score": true if the first system holds staves of several different instruments (a
  conductor's score, with an instrument label at the left of each staff); false for a single part.
Example: {"part_name": "Flute", "printed_page": 1, "full_score": false}"""

LOG = logging.getLogger("uvicorn.error")

_NO_KEY = "There is no Anthropic API key."
_KEY_REFUSED = "The Anthropic API refused the Anthropic API key."
_UNREACHABLE = "The Anthropic API could not be reached; try again later."
_API_ERROR = "The Anthropic API returned an error; try again later."


class PdfSplitError(ValueError):
    """The PDF cannot be split; the message is one plain sentence for the user."""


class PageHeaderError(ValueError):
    """A header could not be read; `unavailable` says none can be (no key, or it was refused)."""

    def __init__(self, message: str, unavailable: bool = False) -> None:
        super().__init__(message)
        self.unavailable = unavailable


@dataclass(frozen=True)
class PageHeader:
    """What the top of a page says: the part named, the number printed, a full score or not."""

    part_name: str | None
    printed_page: int | None
    full_score: bool


@dataclass(frozen=True)
class HeaderRead:
    header: PageHeader
    cost_usd: float


@dataclass(frozen=True)
class ProposedPart:
    """A part found in the PDF: its name and its pages, 1-based and inclusive."""

    name: str
    first_page: int
    last_page: int


@dataclass(frozen=True)
class PagesRead:
    """The headers of every page in order (an unread page has an empty one) and what it cost."""

    headers: list[PageHeader]
    cost_usd: float
    failed: int  # pages whose header could not be read


@runtime_checkable
class PageHeaderReader(Protocol):
    """Read the header of one page from a PNG of the top third of it."""

    def read(self, page: int, strip_png: bytes) -> HeaderRead:
        """Return what the page says (`page` is 1-based); raise PageHeaderError if that fails."""
        ...


class ClaudePageHeaderReader:
    """PageHeaderReader over the Anthropic Messages API: one call a page.

    The client is made from ANTHROPIC_API_KEY on the first read, so building one needs no key.
    """

    def __init__(self, client: Any = None, model: str = MODEL) -> None:
        self._client = client
        self._model = model

    def read(self, page: int, strip_png: bytes) -> HeaderRead:
        client = self._client_or_new()
        data = base64.standard_b64encode(strip_png).decode()
        content = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": data},
            },
            {"type": "text", "text": PROMPT},
        ]
        try:
            response = client.messages.create(
                model=self._model,
                max_tokens=MAX_TOKENS,
                timeout=TIMEOUT_SEC,
                # Haiku thinks by default, and its thinking can use up the few tokens an answer
                # of one line of JSON needs (seen on a real page: the JSON was cut off).
                thinking={"type": "disabled"},
                messages=[{"role": "user", "content": content}],
            )
        except anthropic.AuthenticationError as err:
            raise PageHeaderError(_KEY_REFUSED, unavailable=True) from err
        except anthropic.APIConnectionError as err:
            raise PageHeaderError(_UNREACHABLE) from err
        except anthropic.APIError as err:
            raise PageHeaderError(_API_ERROR) from err
        reply = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        header = _parse_header(page, reply)
        return HeaderRead(header, _cost(self._model, response.usage))

    def _client_or_new(self) -> Any:
        if self._client is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                raise PageHeaderError(_NO_KEY, unavailable=True)
            self._client = anthropic.Anthropic()
        return self._client


class FakePageHeaderReader:
    """PageHeaderReader that answers from a dict by page number and records its calls.

    A page with no answer, or an exception as its answer, fails. With `unavailable` every call
    fails the way a missing key does.
    """

    def __init__(
        self,
        answers: dict[int, PageHeader | PageHeaderError],
        cost_usd: float = 0.0,
        unavailable: bool = False,
    ) -> None:
        self._answers, self._cost_usd, self._unavailable = answers, cost_usd, unavailable
        self.calls: list[SimpleNamespace] = []

    def read(self, page: int, strip_png: bytes) -> HeaderRead:
        self.calls.append(SimpleNamespace(page=page, png=strip_png))
        if self._unavailable:
            raise PageHeaderError(_NO_KEY, unavailable=True)
        answer = self._answers.get(page)
        if answer is None:
            raise PageHeaderError(f"The fake has no answer for page {page}.")
        if isinstance(answer, PageHeaderError):
            raise answer
        return HeaderRead(answer, self._cost_usd)


def read_headers(pdf: bytes, reader: PageHeaderReader) -> PagesRead:
    """Read the header of every page. A page that cannot be read counts as one with no header."""
    strips = _page_strips(pdf)
    stop = threading.Event()  # set when no page can be read, so the rest are not tried

    def ask(page: int) -> HeaderRead | None:
        if stop.is_set():
            return None
        try:
            return reader.read(page, strips[page - 1])
        except PageHeaderError as error:
            if error.unavailable:
                stop.set()
            return None

    with ThreadPoolExecutor(max_workers=READ_WORKERS) as pool:
        answers = list(pool.map(ask, range(1, len(strips) + 1)))
    blank = PageHeader(None, None, False)
    read = PagesRead(
        headers=[a.header if a else blank for a in answers],
        cost_usd=sum(a.cost_usd for a in answers if a),
        failed=sum(1 for a in answers if a is None),
    )
    LOG.info(
        "Read the headers of %d pages (%d failed) for $%.6f.",
        len(answers),
        read.failed,
        read.cost_usd,
    )
    return read


def group_pages(headers: Sequence[PageHeader]) -> list[ProposedPart]:
    """The parts the pages make: a new name starts a part, a page without one continues it.

    The same name starts a new part only where the printed number starts over (page 1, or lower
    than the page before): two copies of one part. Pages before the first name are "Part 1".
    """
    parts: list[list[Any]] = []  # [name, first page, last page]
    placeholder = False  # the open part is the nameless one at the start
    unnamed = 0
    last_printed: int | None = None
    for page, header in enumerate(headers, start=1):
        name = " ".join((header.part_name or "").split()) or None
        if not parts:
            if name is None:
                unnamed += 1
            parts.append([name or f"Part {unnamed}", page, page])
            placeholder = name is None
        elif name is not None and (
            placeholder
            or _key(name) != _key(parts[-1][0])
            or (page > parts[-1][1] and _starts_over(header.printed_page, last_printed))
        ):
            parts.append([name, page, page])
            placeholder = False
        else:
            parts[-1][2] = page
        if header.printed_page is not None:
            last_printed = header.printed_page
    return [ProposedPart(*part) for part in parts]


def is_full_score(headers: Sequence[PageHeader]) -> bool:
    """True when more than half of the pages hold the staves of several instruments."""
    return sum(1 for header in headers if header.full_score) * 2 > len(headers)


def write_part_pdf(pdf: bytes, first: int, last: int, skip_pages: Sequence[int] = ()) -> bytes:
    """A PDF of pages `first` to `last` (1-based, inclusive) less `skip_pages`, as they are."""
    try:
        with pymupdf.open(stream=pdf, filetype="pdf") as source:
            check_range(first, last, len(source))
            runs = page_runs(first, last, skip_pages)
            with pymupdf.open() as part:
                for run_first, run_last in runs:
                    part.insert_pdf(source, from_page=run_first - 1, to_page=run_last - 1)
                return part.tobytes(garbage=3, deflate=True)
    except RuntimeError:  # pymupdf's file errors are RuntimeErrors
        raise PdfSplitError("This file could not be read as a PDF.") from None


def page_runs(first: int, last: int, skip_pages: Sequence[int] = ()) -> list[tuple[int, int]]:
    """The pages `first` to `last` that stay, as (from, to) runs: 1-6 without 4 is [(1, 3), (5, 6)].

    Raises a PdfSplitError when a skipped page is outside the range or no page stays.
    """
    skipped = set(skip_pages)
    if any(page < first or page > last for page in skipped):
        raise PdfSplitError(
            f"The skipped pages must be inside the part's pages ({first} to {last})."
        )
    kept = [page for page in range(first, last + 1) if page not in skipped]
    if not kept:
        raise PdfSplitError("A part needs at least one page that is not skipped.")
    runs: list[tuple[int, int]] = []
    for page in kept:
        if runs and runs[-1][1] == page - 1:
            runs[-1] = (runs[-1][0], page)
        else:
            runs.append((page, page))
    return runs


def check_range(first: int, last: int, page_count: int) -> None:
    """Raise a PdfSplitError unless pages `first` to `last` are inside a PDF of `page_count`."""
    if not 1 <= first <= last <= page_count:
        raise PdfSplitError(
            f"The pages {first} to {last} are not inside this PDF of {page_count} pages."
        )


def page_thumbnails(pdf: bytes, width: int = THUMB_WIDTH) -> list[bytes]:
    """A grayscale PNG of every page, `width` px wide."""
    thumbs = []
    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        for page in document:
            scale = width / page.rect.width
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY)
            thumbs.append(pixmap.tobytes("png"))
    return thumbs


def _page_strips(pdf: bytes) -> list[bytes]:
    """The top third of every page as a PNG. Rendered one after another: PyMuPDF is not threaded."""
    strips = []
    try:
        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            if len(document) > MAX_PAGES:
                raise PdfSplitError(f"This PDF has more than {MAX_PAGES} pages.")
            for page in document:
                pixmap = page.get_pixmap(dpi=PDF_DPI, colorspace=pymupdf.csGRAY)
                image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
                strips.append(top_strip(image, STRIP_FRACTION))
    except RuntimeError:  # pymupdf's file errors are RuntimeErrors
        raise PdfSplitError("This file could not be read as a PDF.") from None
    return strips


def _key(name: str) -> str:
    return name.casefold()


def _starts_over(printed: int | None, before: int | None) -> bool:
    return printed == 1 or (printed is not None and before is not None and printed < before)


def _parse_header(page: int, reply: str) -> PageHeader:
    """The header in the model's JSON reply; anything else is a PageHeaderError."""
    bad = PageHeaderError(f"The reply for page {page} was not the header asked for.")
    found = re.search(r"\{.*\}", reply, flags=re.DOTALL)
    if found is None:
        raise bad
    try:
        data = json.loads(found.group())
    except ValueError:
        raise bad from None
    if not isinstance(data, dict) or not {"part_name", "printed_page", "full_score"} <= data.keys():
        raise bad
    name, printed, full = data["part_name"], data["printed_page"], data["full_score"]
    if not (name is None or isinstance(name, str)) or not isinstance(full, bool):
        raise bad
    if not (printed is None or (isinstance(printed, int) and not isinstance(printed, bool))):
        raise bad
    return PageHeader((name or "").strip() or None, printed, full)


def _cost(model: str, usage: Any) -> float:
    price_in, price_out = PRICES.get(model, (0.0, 0.0))
    return (usage.input_tokens * price_in + usage.output_tokens * price_out) / 1e6
