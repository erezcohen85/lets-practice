import logging
import re
import traceback

# What goes to the server's log about a failure: the exception's type, its message with the shapes
# of secret listed below taken out, and the code lines it passed through (source text, never the
# values in them). Railway's log is read by project members, and the login spec says no email or
# token is written to logs. This is a list of known shapes, not a general secret detector: a new
# kind of secret in a message needs a pattern here.

_KEY_NAMES = (
    r"access_token|refresh_token|id_token|token|apikey|api_key|key|secret|password|"
    r"sig|lsig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|credential"
)
_PATTERNS = (
    (re.compile(r"(?<=://)[^/\s@]+@"), "[removed]@"),  # user:password@host
    (re.compile(r"[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+", re.IGNORECASE), "[email]"),
    (re.compile(r"(?i)\bbearer\s+\S+"), "Bearer [removed]"),
    (re.compile(r"\beyJ[\w-]+\.[\w-]+\.[\w-]+"), "[removed]"),
    (re.compile(r"\bsb_(?:secret|publishable)_\w+"), "[removed]"),
    (re.compile(r"\bsk-ant-[\w-]+"), "[removed]"),
    # query strings and form text: token=abc
    (re.compile(rf"(?i)(?<!\w)({_KEY_NAMES})=[^&\s'\"]+"), r"\1=[removed]"),
    # headers and config text with no quotes: X-Api-Key: abc
    (
        re.compile(
            r"(?i)(?<!\w)((?:x-)?api[-_]?key|access_token|refresh_token|password|secret)(\s*:\s*)[^\s,;'\"}]+"
        ),
        r"\1\2[removed]",
    ),
    (
        re.compile(r"(?i)(authorization['\"]?\s*[:=]\s*['\"]?)basic\s+[^\s'\"]+"),
        r"\1Basic [removed]",
    ),
    (re.compile(r"\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}"), "Basic [removed]"),
    # dict or JSON text: 'access_token': 'abc' or "apikey": "abc"
    (
        re.compile(rf"(?i)(['\"](?:{_KEY_NAMES})['\"]\s*:\s*)(['\"])[^'\"]*\2"),
        r"\1\2[removed]\2",
    ),
)


# The patterns can take quadratic time on a long unbroken run of characters (82 s at 80,000), and
# this runs on the single worker before a job's end is written. A log line needs no more than the
# start of a message, so the text is cut first. The cut drops the unbroken run it falls in, whole:
# a secret split by the cut no longer matches its pattern, and its head must not reach the log.
MESSAGE_LIMIT = 4_000
FRAMES_LIMIT = 20_000
_CUT = "[cut]"
_SPACE = " \t\n\r\f\v"


def _cut_head(text: str, limit: int) -> str:
    head = text[:limit]
    if len(text) <= limit or text[limit] in _SPACE:
        return head if len(text) <= limit else head + " " + _CUT
    last = max(head.rfind(char) for char in _SPACE)
    return (head[: last + 1] if last >= 0 else "") + _CUT


def _cut_tail(text: str, limit: int) -> str:
    """The end of the text, from the first whitespace after the cut: the raising frame stays."""
    if len(text) <= limit:
        return text
    tail = text[-limit:]
    if text[-limit - 1] in _SPACE:
        return _CUT + " " + tail
    first = min((i for i in (tail.find(char) for char in _SPACE) if i >= 0), default=-1)
    return _CUT + " " + (tail[first + 1 :] if first >= 0 else "")


def scrubbed(text: str, limit: int = MESSAGE_LIMIT, keep: str = "head") -> str:
    """The text, cut to about `limit` characters (`keep` its "head" or its "tail"), without the
    shapes of secret listed above."""
    text = _cut_head(text, limit) if keep == "head" else _cut_tail(text, limit)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _message(error: BaseException) -> str:
    try:
        return scrubbed(str(error))
    except Exception:
        return "(the message could not be read)"


def log_failure(logger: logging.Logger, sentence: str, error: BaseException) -> None:
    """Log `sentence`, the error's type and scrubbed message, and the frames it passed through.

    Never raises: an error whose text cannot be made is still logged by its type.
    """
    try:
        frames = scrubbed(
            "".join(traceback.format_tb(error.__traceback__)), FRAMES_LIMIT, keep="tail"
        ).rstrip()
        logger.error("%s: %s: %s\n%s", sentence, type(error).__name__, _message(error), frames)
    except Exception:
        logger.error("%s: %s", sentence, type(error).__name__)
