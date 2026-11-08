import json
from dataclasses import dataclass

import pymupdf

from app.pipeline.pdf_split import (
    PageHeader,
    PageHeaderReader,
    PagesRead,
    PdfSplitError,
    ProposedPart,
    check_range,
    group_pages,
    is_full_score,
    page_runs,
    read_headers,
)
from app.pipeline.run_folder import MAX_PART_NAME

# What splitting one PDF into parts needs that does not depend on where the PDF is kept: reading
# its page headers into a proposal, the sentence for what could not be read, and the check of the
# parts a user kept. The local server (spikes/local_split.py, a staging folder) and the online
# routes (app/splits.py, Supabase Storage) both use it, so the two accept and refuse the same
# splits in the same sentences. The number of parts is not limited (Erez, 2026-11-06): the PDF's
# 120 pages and 50 MB are, and a part has at least one page.

EXPIRED = "This split has expired: choose the PDF again."
FULL_SCORE = "Full scores (all parts on one page) are not supported yet: upload the parts."
_COULD_NOT_READ = (
    "The page headers could not be read, so the pages are one part: split them by hand."
)
_NO_NAMES = "No part names were found in the page headers."
_BAD_LIST = "The parts to keep are not a JSON list."
_BAD_ENTRY = "Every part needs a name and whole page numbers (fromPage and toPage)."
_BAD_NAME = f"Every part needs a name of 1 to {MAX_PART_NAME} characters."
_BAD_SKIP = "The skipped pages of a part must be a list of page numbers inside that part."


@dataclass(frozen=True)
class Proposal:
    """What reading a PDF's page headers made of it."""

    page_count: int
    full_score: bool
    parts: list[ProposedPart]
    headers: list[PageHeader]
    cost_usd: float
    note: str | None


@dataclass(frozen=True)
class KeptPart:
    """A part the user kept: its name, its pages (1-based, inclusive) and the pages left out."""

    name: str
    first: int
    last: int
    skip: list[int]


def count_pages(pdf: bytes) -> int:
    """The pages of a PDF; a PdfSplitError for a file that is not one."""
    try:
        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            return len(document)
    except Exception:  # PyMuPDF raises its own types for a damaged file
        raise PdfSplitError("This file could not be read as a PDF.") from None


def propose_split(pdf: bytes, reader: PageHeaderReader | None) -> Proposal:
    """Read the page headers (no reader: the pages are one part) and group them."""
    page_count = count_pages(pdf)
    read = _read(pdf, page_count, reader)
    return Proposal(
        page_count=page_count,
        full_score=is_full_score(read.headers),
        parts=group_pages(read.headers),
        headers=read.headers,
        cost_usd=read.cost_usd,
        note=_note(read, reader is None),
    )


def parse_kept_parts(keep: object, page_count: int) -> list[KeptPart]:
    """The parts to keep from the JSON the client sent (text, or the list itself), checked.

    Raises a PdfSplitError with one plain sentence. No count is refused here: only names, page
    numbers, order and the pages left out.
    """
    if isinstance(keep, str):
        try:
            raw = json.loads(keep)
        except ValueError:
            raw = None
    else:
        raw = keep
    if not isinstance(raw, list):
        raise PdfSplitError(_BAD_LIST)
    if not raw:
        raise PdfSplitError("Keep at least one part.")
    entries: list[KeptPart] = []
    for item in raw:
        if not isinstance(item, dict):
            raise PdfSplitError(_BAD_ENTRY)
        name, first, last = item.get("name"), item.get("fromPage"), item.get("toPage")
        if not isinstance(name, str) or not all(_is_int(n) for n in (first, last)):
            raise PdfSplitError(_BAD_ENTRY)
        name = " ".join(name.split())
        if not 1 <= len(name) <= MAX_PART_NAME:
            raise PdfSplitError(_BAD_NAME)
        skip = item.get("skipPages", [])
        if not isinstance(skip, list) or not all(_is_int(n) for n in skip):
            raise PdfSplitError(_BAD_SKIP)
        check_range(first, last, page_count)
        page_runs(first, last, skip)  # the skipped pages are inside, and some page stays
        entries.append(KeptPart(name, first, last, sorted(set(skip))))
    pairs = zip(entries, entries[1:], strict=False)
    if any(later.first <= earlier.last for earlier, later in pairs):
        raise PdfSplitError("The parts must be in page order and must not overlap.")
    return entries


def range_text(first: int, last: int, skip: list[int]) -> str:
    """The pages in a file name: 1-3, or 1-3, 5 when page 4 is left out (a lone page is just 5)."""
    if not skip:
        return f"{first}-{last}"
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in page_runs(first, last, skip))


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _read(pdf: bytes, page_count: int, reader: PageHeaderReader | None) -> PagesRead:
    if reader is None:
        return PagesRead([PageHeader(None, None, False)] * page_count, 0.0, page_count)
    return read_headers(pdf, reader)


def _note(read: PagesRead, no_reader: bool) -> str | None:
    pages = len(read.headers)
    if no_reader or read.failed == pages:
        return _COULD_NOT_READ
    if read.failed:
        many = read.failed > 1
        return (
            f"The header{'s' if many else ''} of {read.failed} page{'s' if many else ''} could "
            f"not be read; {'they are' if many else 'it is'} taken to continue the part before "
            f"{'them' if many else 'it'}."
        )
    if all(header.part_name is None for header in read.headers):
        return _NO_NAMES
    return None
