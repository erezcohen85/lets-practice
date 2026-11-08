import logging

from app import staging
from app.db import Database
from app.pipeline.name_suggester import (
    NameClues,
    NameSuggester,
    Suggestion,
    pdf_top_strip,
    suggest_name,
)
from app.pipeline.storage_paths import require_piece_path
from app.storage import Storage

# "Suggest a name" online: the clues of a piece that exists (its recording's name and the top of
# its first part's first page, read from its own folder) or of the New piece form (the recording
# file's name, and the first PDF the browser staged). The model sits behind NameSuggester (None
# without an API key: the tidied file name is the fallback), as in spikes/local_naming.py.

_log = logging.getLogger("uvicorn.error")


class NameService:
    """Suggesting a name over the database, Storage and a NameSuggester."""

    def __init__(self, db: Database, storage: Storage, suggester: NameSuggester | None) -> None:
        self._db, self._storage, self._suggester = db, storage, suggester

    def for_piece(self, owner_id: str, piece_id: str) -> Suggestion:
        """A name for a piece: from its recording's name and its first part's first page."""
        source = self._db.get_audio_source(piece_id)
        clues = NameClues(
            audio_name=(source or {}).get("name"),
            strip_png=self._first_page_strip(owner_id, piece_id),
        )
        return self._suggest(clues)

    def for_form(
        self, user_id: str, recording_name: str | None, staged_id: str | None
    ) -> Suggestion:
        """A name for a piece that is still a form; the staged PDF is used up."""
        strip = None
        if staged_id is not None:
            try:
                strip = pdf_top_strip(self._storage.download(staging.pdf_path(user_id, staged_id)))
            except (FileNotFoundError, ValueError):
                strip = None  # gone, or never there: the file name has to do
            staging.discard(self._storage, user_id, staged_id)
        staging.sweep(self._storage, user_id)
        return self._suggest(NameClues((recording_name or "").strip() or None, strip))

    def _first_page_strip(self, owner_id: str, piece_id: str) -> bytes | None:
        for row in self._db.list_score_files(piece_id):  # in hub order
            try:
                path = require_piece_path(row["storage_path"], owner_id, piece_id)
                return pdf_top_strip(self._storage.download(path))
            except (FileNotFoundError, ValueError):
                return None
        return None

    def _suggest(self, clues: NameClues) -> Suggestion:
        suggestion = suggest_name(clues, self._suggester)
        if suggestion.source == "claude":
            _log.info("suggest-name: cost $%.4f", suggestion.cost_usd)
        else:
            _log.info("suggest-name: fallback (%s)", suggestion.note)
        return suggestion
