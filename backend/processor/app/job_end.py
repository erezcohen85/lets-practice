import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from app.pipeline.storage_paths import require_piece_path

if TYPE_CHECKING:
    from app.db import Database
    from app.deps import Services
    from app.jobs import JobStore

# --- the end of a job ---------------------------------------------------------------------------

# The write that ends a job carries what the user waits for (the warnings, the cost, the sentence),
# and one blip of Supabase must not lose it. Tried again over about 30 seconds: the worker can do
# nothing useful while Supabase is down anyway.
_PAUSES = (1.0, 2.0, 4.0, 8.0, 15.0)
FINAL_WRITE_ATTEMPTS = len(_PAUSES) + 1
GENERIC_FAILURE = "Something went wrong on the server. Try again."
_log = logging.getLogger("uvicorn.error")


def pause(seconds: float) -> None:
    """Wait between attempts; a function of its own so a test can skip the wait."""
    time.sleep(seconds)


def _worth_trying_again(error: Exception) -> bool:
    """False when the answer means the row is gone, ended or refused: waiting will not change it."""
    if isinstance(error, (KeyError, ValueError)):
        return False
    status = getattr(error, "status", None)  # RestError
    if isinstance(status, int) and 400 <= status < 500:
        return status in (408, 429)
    return True


def update_final(
    jobs: "JobStore",
    job_id: str,
    sleep: Callable[[float], None] | None = None,
    **fields: Any,
) -> bool:
    """Write a job's end with `fields` (the whole payload each time), trying again after a pause.

    True when the write landed or the job had already ended; False when it never landed, which is
    logged by the job's id and the error's type only (the text of a failed request can hold the
    project's address). A job left that way is ended by the next start's sweep.
    """
    wait = sleep or pause
    for attempt in range(FINAL_WRITE_ATTEMPTS):
        try:
            jobs.update(job_id, **fields)
            return True
        except KeyError:
            return True  # already ended, or ended by a restart: nothing to write
        except Exception as error:
            _log.warning("end of job %s not saved (%s)", job_id, type(error).__name__)
            if not _worth_trying_again(error):
                return False
            if attempt < len(_PAUSES):
                wait(_PAUSES[attempt])
    _log.error("end of job %s could not be saved; a restart will end it", job_id)
    return False


def _never_processed(db: "Database", piece_id: str) -> bool:
    """True when the piece has no play order yet, so it has never been processed. The one test of
    a "first processing" for both gives-back: replacing every part of a processed piece leaves its
    parts unrendered, but not its play order, so that cannot free a slot over and over."""
    play_order, _meters, _marks = db.get_structure(piece_id)
    return not play_order


def void_created(db: "Database", piece_id: str) -> None:
    """Give a piece's creation back after a plan limit refused its FIRST processing at JOB time,
    so a Trial user who chose a file that is too long does not lose one of their pieces. The piece
    stays (the Processing page shows why); the next process-piece claims the slot again
    (`Database.claim_piece`), so a voided piece cannot be processed later for free. Only a piece
    that was never processed (no play order) counts as a first processing: a refusal of a
    re-run (after a downgrade, or with every part replaced) keeps the piece's created event.
    Never raises: the refusal is what the user needs to hear, and a failed void is logged by the
    error's type."""
    try:
        if not _never_processed(db, piece_id):
            return
        db.void_piece_created(piece_id)
    except Exception as error:
        _log.warning("piece %s could not be given back (%s)", piece_id, type(error).__name__)


def _piece_files(services: "Services", piece_id: str, owner_id: str) -> list[str]:
    """Every stored file of the piece that the processor may delete: the paths its rows name and
    what sits in its upload folders, each only if it lies inside `{owner}/{piece}/` (the rows are
    written by the owner, so a path into another user's folder is skipped, never deleted)."""
    rows = services.db.list_score_files(piece_id)
    named: set[str] = {str(row["storage_path"]) for row in rows}
    audio = services.db.get_audio_source(piece_id)
    if audio is not None:
        if audio.get("kind") == "file" and audio.get("url_or_path"):
            named.add(str(audio["url_or_path"]))
        if audio.get("stored_path"):
            named.add(str(audio["stored_path"]))
    # The upload folders, the piece folder itself (the stored recording, the analysis) and each
    # part's page images: a refusal can come after the recording was read.
    root = f"{owner_id}/{piece_id}"
    folders = [f"{root}/parts", f"{root}/upload", root, *(f"{root}/{row['id']}" for row in rows)]
    for base in folders:
        named.update(f"{base}/{stored.name}" for stored in services.storage.list_objects(base))
    inside: list[str] = []
    for path in sorted(named):
        try:
            inside.append(require_piece_path(path, owner_id, piece_id))
        except ValueError:
            continue
    return inside


def give_back_refused_piece(services: "Services", piece_id: str) -> None:
    """After a plan limit refused a piece's FIRST processing at the ROUTE (the browser deletes the
    piece then too): delete the piece (its rows, then its
    files) and only then give its creation back. The slot is lent for a piece that no longer
    exists, so it cannot be processed later (after its files are swapped, say) while uncounted.

    Only a piece that was never processed (no play order) is a first processing: a refusal of a
    re-run (after a downgrade, or with every part replaced) keeps the piece and its created event.
    If the piece cannot be deleted, nothing is given back. Never raises: the refusal is what the
    user needs to hear, and a failed step is logged by the error's type."""
    db = services.db
    try:
        owner_id = db.get_piece_owner(piece_id)
        if owner_id is None:
            return
        if not _never_processed(db, piece_id):
            return
        paths = _piece_files(services, piece_id, owner_id)
        db.delete_piece(piece_id)
    except Exception as error:
        _log.warning("piece %s could not be taken back (%s)", piece_id, type(error).__name__)
        return
    try:
        db.void_piece_created(piece_id)
    except Exception as error:
        _log.warning("piece %s could not be given back (%s)", piece_id, type(error).__name__)
    try:
        if paths:
            services.storage.delete(paths)
    except Exception as error:
        _log.warning("files of piece %s were left behind (%s)", piece_id, type(error).__name__)
