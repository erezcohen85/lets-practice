import logging
import uuid

from app.db import Database
from app.pipeline.sample_piece import Outcome, SampleAlready, SampleNoMaster, decide
from app.storage import Storage

# Giving an account the sample piece. The database copies the rows (one transaction) and names the
# files; this copies the files inside Storage. If a file cannot be copied, everything made is taken
# back, the piece's creation included (or every retry would use up one of a Trial account's
# pieces), and the account is asked again next time. The log never holds a path or an id.

_log = logging.getLogger("uvicorn.error")


class SampleCopyFailed(Exception):
    """A file of the sample could not be copied; nothing of the copy is left."""


class SamplePieceService:
    """Claiming the sample piece over the database and Storage."""

    def __init__(self, db: Database, storage: Storage) -> None:
        self._db = db
        self._storage = storage

    def claim(self, user_id: str) -> Outcome:
        return self.claim_piece(user_id)[0]

    def claim_piece(self, user_id: str) -> tuple[Outcome, str | None]:
        """The outcome and, when the sample was given, the id of the new piece."""
        step = decide(self._db.sample_state(user_id))
        if step == "already":
            return "already", None
        if step == "no_master":
            return "skipped", None  # not marked: asked again once a sample is set
        if step == "skip":
            self._db.mark_sample(user_id, given=False)
            return "skipped", None
        piece_id = str(uuid.uuid4())
        try:
            files = self._db.copy_sample_piece(user_id, piece_id)
        except SampleAlready:
            return "already", None
        except SampleNoMaster:
            return "skipped", None  # the master went between the state and the copy: not marked
        done: list[str] = []
        try:
            for source, destination in files:
                self._storage.copy(source, destination)
                done.append(destination)
        except Exception as error:
            _log.warning(
                "sample piece: a file copy failed after %d of %d (%s); taking the copy back",
                len(done),
                len(files),
                type(error).__name__,
            )
            self._take_back(user_id, piece_id, done)
            raise SampleCopyFailed() from error
        return "given", piece_id

    def _take_back(self, user_id: str, piece_id: str, copied: list[str]) -> None:
        """Undo a failed copy. The database goes first and every step runs whatever the others
        did: Storage is the likely reason the copy failed, so deleting its files may fail too, and
        an orphan file under a deleted piece's folder is harmless."""
        steps = (
            ("void", lambda: self._db.void_piece_created(piece_id)),  # before the rows go
            ("delete piece", lambda: self._db.delete_piece(piece_id)),
            ("unmark", lambda: self._db.unmark_sample(user_id)),
            ("delete files", lambda: self._storage.delete(copied)),
        )
        for name, step in steps:
            try:
                step()
            except Exception as error:
                _log.warning(
                    "sample piece: clean-up step '%s' failed (%s); %d files copied",
                    name,
                    type(error).__name__,
                    len(copied),
                )
