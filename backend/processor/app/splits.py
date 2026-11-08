import base64
import hashlib
import io
import json
from typing import Any

from PIL import Image

from app import staging
from app.pipeline.pdf_pages import MAX_PDF_BYTES
from app.pipeline.pdf_split import (
    MAX_PAGES,
    PageHeaderReader,
    PdfSplitError,
    page_thumbnails,
    write_part_pdf,
)
from app.pipeline.split_plan import (
    EXPIRED,
    FULL_SCORE,
    KeptPart,
    count_pages,
    parse_kept_parts,
    propose_split,
)
from app.storage import Storage

# Splitting one PDF that holds several parts, online. The browser puts the PDF in Storage under
# its own folder (app/staging.py); `propose` reads its page headers and answers with the parts it
# proposes and a small picture of every page; `cut` writes one PDF per part the user kept into
# the piece's own folder, `{owner}/{piece}/parts/{part id}.pdf`, and returns what the browser
# needs to add the part rows (the browser inserts them with its own login, as for any part). The
# owner is the verified caller and the piece was checked to be theirs by the route: nothing here
# takes a path from the caller.

_MB = 1024 * 1024
_BAD_ID = "Every part needs a new id of its own."
THUMB_QUALITY = 70  # WebP, grayscale: a sheet of music stays readable at 320 px, at ~20 KB a page


class SplitRefused(ValueError):
    """The split cannot go on; the message is one plain sentence. `expired`: the PDF is gone."""

    def __init__(self, message: str, expired: bool = False) -> None:
        super().__init__(message)
        self.expired = expired


class SplitService:
    """Splitting behind Storage and a page header reader (None without an API key)."""

    def __init__(self, storage: Storage, reader: PageHeaderReader | None) -> None:
        self._storage, self._reader = storage, reader

    def propose(self, user_id: str, staged_id: str) -> dict[str, Any]:
        """Read the staged PDF and keep a note of it for `cut`. SplitRefused for any problem."""
        staging.sweep(self._storage, user_id)
        pdf = self._staged_pdf(user_id, staged_id)
        _check_batch(pdf)
        try:
            proposal = propose_split(pdf, self._reader)
            thumbs = page_thumbnails(pdf)
        except PdfSplitError as error:
            raise SplitRefused(str(error)) from None
        note = {"pageCount": proposal.page_count, "fullScore": proposal.full_score}
        self._storage.upload(
            staging.meta_path(user_id, staged_id), json.dumps(note).encode(), "application/json"
        )
        return {
            "splitId": staged_id,
            "pageCount": proposal.page_count,
            "fullScore": proposal.full_score,
            "parts": [
                {"name": p.name, "fromPage": p.first_page, "toPage": p.last_page}
                for p in proposal.parts
            ],
            "pages": [
                {
                    "page": number,
                    "partName": header.part_name,
                    "printedPage": header.printed_page,
                    "fullScore": header.full_score,
                    "thumb": _data_url(thumb),
                }
                for number, (header, thumb) in enumerate(
                    zip(proposal.headers, thumbs, strict=True), start=1
                )
            ],
            "costUsd": round(proposal.cost_usd, 6),
            "note": proposal.note,
        }

    def cut(
        self, owner_id: str, piece_id: str, staged_id: str, parts: object
    ) -> list[dict[str, Any]]:
        """Write the kept parts into the piece's folder and use the staged PDF up.

        `parts` is the list the client sent: each entry has an `id` (a new UUID the browser made
        for the part row), and the fields `parse_kept_parts` reads. Returns, in order, each
        part's id and the SHA-256 of its PDF. Nothing is left behind when one fails.
        """
        note = self._note(owner_id, staged_id)
        if note["fullScore"]:
            raise SplitRefused(FULL_SCORE)
        entries = _entries(parts, int(note["pageCount"]))
        source = self._staged_pdf(owner_id, staged_id)
        written: list[str] = []
        made: list[dict[str, Any]] = []
        try:
            for kept, part_id in entries:
                data = write_part_pdf(source, kept.first, kept.last, kept.skip)
                path = f"{owner_id}/{piece_id}/parts/{part_id}.pdf"
                written.append(path)
                self._storage.upload(path, data, "application/pdf")
                made.append({"id": part_id, "sha256": hashlib.sha256(data).hexdigest()})
        except PdfSplitError as error:  # the staged file no longer matches its note
            self._storage.delete(written)
            raise SplitRefused(str(error)) from None
        except BaseException:
            self._storage.delete(written)
            raise
        staging.discard(self._storage, owner_id, staged_id)
        return made

    def _staged_pdf(self, user_id: str, staged_id: str) -> bytes:
        try:
            return self._storage.download(staging.pdf_path(user_id, staged_id))
        except (FileNotFoundError, ValueError):
            raise SplitRefused(EXPIRED, expired=True) from None

    def _note(self, user_id: str, staged_id: str) -> dict[str, Any]:
        try:
            note = json.loads(self._storage.download(staging.meta_path(user_id, staged_id)))
            if not isinstance(note.get("pageCount"), int):
                raise ValueError
            return {"pageCount": note["pageCount"], "fullScore": bool(note.get("fullScore"))}
        except (FileNotFoundError, ValueError, AttributeError):
            raise SplitRefused(EXPIRED, expired=True) from None


def _entries(parts: object, page_count: int) -> list[tuple[KeptPart, str]]:
    """The parts to keep, checked, each with the id the browser chose for its row."""
    try:
        kept = parse_kept_parts(parts, page_count)
    except PdfSplitError as error:
        raise SplitRefused(str(error)) from None
    raw = parts if isinstance(parts, list) else []
    ids = [item.get("id") for item in raw]
    for part_id in ids:
        if not isinstance(part_id, str) or not staging.is_staged_id(part_id):
            raise SplitRefused(_BAD_ID)
    if len(set(ids)) != len(ids):
        raise SplitRefused(_BAD_ID)
    return list(zip(kept, ids, strict=True))


def _check_batch(pdf: bytes) -> None:
    if len(pdf) > MAX_PDF_BYTES:
        raise SplitRefused(f"This PDF is larger than {MAX_PDF_BYTES // _MB} MB.")
    if not pdf.startswith(b"%PDF"):
        raise SplitRefused("This file is not a PDF.")
    try:
        pages = count_pages(pdf)
    except PdfSplitError as error:
        raise SplitRefused(str(error)) from None
    if pages == 0:
        raise SplitRefused("This PDF has no pages.")
    if pages > MAX_PAGES:
        raise SplitRefused(f"This PDF has more than {MAX_PAGES} pages.")


def _data_url(png: bytes) -> str:
    with Image.open(io.BytesIO(png)) as image:
        out = io.BytesIO()
        image.convert("L").save(out, format="WEBP", quality=THUMB_QUALITY)
    return "data:image/webp;base64," + base64.standard_b64encode(out.getvalue()).decode()
