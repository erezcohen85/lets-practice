import logging
import re
from datetime import UTC, datetime, timedelta

from app.storage import Storage

# Where a PDF waits between the browser's upload and the call that uses it (a split, a suggested
# name). The browser writes it under its own folder in Storage, `{user_id}/staging/{id}.pdf`, with
# its own login, and the processor reads it with the id from the route and the user id from the
# verified token: a route never takes a path from the caller, so no one can point it at another
# user's folder. Nothing waits on the processor's own disk (a redeploy clears that disk); what a
# redeploy never loses is also what a user never finishes, so every use sweeps the caller's staged
# files that are a day old.

STALE_AFTER = timedelta(days=1)
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_log = logging.getLogger("uvicorn.error")


def is_staged_id(value: str) -> bool:
    """True for a lower-case UUID, the only shape a staged id may have."""
    return _UUID.fullmatch(value) is not None


def pdf_path(user_id: str, staged_id: str) -> str:
    """The staged PDF of this user; ValueError for an id that is not a UUID."""
    return f"{user_id}/staging/{_checked(staged_id)}.pdf"


def meta_path(user_id: str, staged_id: str) -> str:
    """The note kept beside a staged split's PDF (its page count and whether it is a full score)."""
    return f"{user_id}/staging/{_checked(staged_id)}.json"


def discard(storage: Storage, user_id: str, staged_id: str) -> None:
    """Remove a staged PDF and its note. Best effort: a failure is logged and never raised."""
    try:
        storage.delete([pdf_path(user_id, staged_id), meta_path(user_id, staged_id)])
    except Exception as error:
        _log.warning("could not remove a staged file (%s)", type(error).__name__)


def sweep(storage: Storage, user_id: str, now: datetime | None = None) -> None:
    """Remove this user's staged files older than a day. Best effort, like `discard`."""
    try:
        limit = (now or datetime.now(UTC)) - STALE_AFTER
        stale = [
            f"{user_id}/staging/{item.name}"
            for item in storage.list_objects(f"{user_id}/staging")
            if item.created_at < limit
        ]
        if stale:
            storage.delete(stale)
    except Exception as error:
        _log.warning("could not sweep staged files (%s)", type(error).__name__)


def _checked(staged_id: str) -> str:
    if not is_staged_id(staged_id):
        raise ValueError("not a staged id")
    return staged_id
