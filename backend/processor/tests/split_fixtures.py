"""Generated PDFs that hold several parts one after another, for the tests of pdf_split."""

from dataclasses import dataclass

import pymupdf

PAGE_WIDTH, PAGE_HEIGHT = 595.0, 842.0


@dataclass(frozen=True)
class Page:
    """What a generated page shows: the part named in its header, the printed number, the staves."""

    name: str | None = None
    printed: int | None = None
    instruments: tuple[str, ...] = ()  # the labels of a full score's staves, one per staff


def pdf_of(*pages: Page) -> bytes:
    """A PDF with one page per `Page`: a header, a printed page number and a few staff lines."""
    document = pymupdf.open()
    for number, page in enumerate(pages, start=1):
        sheet = document.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
        if page.name:
            sheet.insert_text((60, 50), page.name, fontsize=20)
        if page.printed is not None:
            sheet.insert_text((520, 30), str(page.printed), fontsize=10)
        sheet.insert_text((60, 800), f"sheet {number}", fontsize=8)
        _staves(sheet, page.instruments or ("",))
    data = document.tobytes()
    document.close()
    return data


def _staves(sheet: pymupdf.Page, labels: tuple[str, ...]) -> None:
    """One five-line staff for each label, stacked from the top third's start downwards."""
    top = 120.0
    for label in labels:
        for line in range(5):
            y = top + line * 7
            sheet.draw_line((60, y), (540, y), width=0.6)
        if label:
            sheet.insert_text((10, top + 20), label, fontsize=7)
        top += 60


def three_parts() -> bytes:
    """Flute (2 pages), Oboe (1 page), Clarinet in B♭ 2 (3 pages), page numbers restart at 1."""
    return pdf_of(
        Page("Flute", 1),
        Page(None, 2),
        Page("Oboe", 1),
        Page("Clarinet in Bb 2", 1),
        Page(None, 2),
        Page(None, 3),
    )


def two_copies() -> bytes:
    """The same part twice in a row: its name again, and the page number back at 1."""
    return pdf_of(Page("Violin", 1), Page(None, 2), Page("Violin", 1), Page(None, 2))


def full_score() -> bytes:
    """Every page holds several instruments' staves."""
    instruments = ("Flute", "Oboe", "Clarinet", "Horn")
    return pdf_of(*(Page(None, n, instruments) for n in (1, 2, 3)))
