import logging

from app.safe_log import log_failure

# What an error may tell the user. Members can read jobs.error and the job's warnings under RLS, and
# the text of an exception the app did not write can hold an address, a path or a row (final review
# M-2). So only the app's own sentences go through; anything else becomes a generic one and its
# detail goes to the server's log, scrubbed.

MAX_MESSAGE_CHARS = 200
UNKNOWN = "something went wrong on the server."
_log = logging.getLogger("uvicorn.error")


def user_sentence(error: Exception, own: tuple[type[Exception], ...] = ()) -> str:
    """The error's message on one line, trimmed, when the app wrote it; else a generic sentence.

    `own` lists the error types whose messages are sentences the app wrote. The stages also raise
    plain `ValueError` with sentences, so exactly that type counts as written by the app; its
    subclasses (a JSON or pydantic error) can quote their input and do not.
    """
    if not (isinstance(error, own) or type(error) is ValueError):
        log_failure(_log, "job stage failed", error)
        return UNKNOWN
    detail = " ".join(str(error).split()) or type(error).__name__
    if len(detail) > MAX_MESSAGE_CHARS:
        detail = detail[: MAX_MESSAGE_CHARS - 3] + "..."
    return detail
