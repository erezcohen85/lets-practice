import base64
import io
import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

import anthropic
import pymupdf
from PIL import Image

from app.pipeline.score_reader import MODEL, PRICES

# Suggests a title for a piece ("Title (Composer)") from what the upload already tells: the
# audio file's name and the top of the first page of the first part. One call to Claude Haiku (the
# model the score reader uses) behind NameSuggester; FakeNameSuggester stands in for it in unit
# tests. Without a key, or when the call fails, suggest_name falls back to the tidied file name and
# says why in a sentence.

MAX_TOKENS = 200
TIMEOUT_SEC = 60
STRIP_FRACTION = 0.22  # the title and composer sit in the top fifth of the first page
STRIP_MAX_WIDTH = 900
PDF_DPI = 100
MAX_NAME = 120

PROMPT = """Suggest the title of a piece of music for a practice library. Above are what its
upload tells: the name of the audio file, and a picture of the top
of the first page of its sheet music (title, composer). Reply with ONE line and nothing else:
"Title (Composer)" when the composer is known, or just "Title". Use the printed title and
composer from the page when it shows them, in their usual spelling, not the video's decoration
("live", "HD", channel names). No quotes, no explanation."""

_NO_KEY = "There is no Anthropic API key."
_KEY_REFUSED = "The Anthropic API refused the Anthropic API key."
_UNREACHABLE = "The Anthropic API could not be reached; try again later."
_API_ERROR = "The Anthropic API returned an error; try again later."
_NO_NAME = "The Anthropic API gave no name."
_NOTHING = "There was no title or file name to use."


class NameSuggesterError(ValueError):
    """No name could be suggested; the message is one sentence a user may read."""


@dataclass(frozen=True)
class NameClues:
    """What the upload tells: any may be missing. `strip_png` is the top of page 1."""

    audio_name: str | None
    strip_png: bytes | None


@dataclass(frozen=True)
class SuggestedName:
    name: str
    cost_usd: float
    model: str


@dataclass(frozen=True)
class Suggestion:
    """The answer the user sees: `fallback` says no model made it, and `note` says why."""

    name: str
    source: Literal["claude", "fallback"]
    note: str | None
    cost_usd: float = 0.0


@runtime_checkable
class NameSuggester(Protocol):
    """Suggest a title from the clues of an upload."""

    def suggest(self, clues: NameClues) -> SuggestedName:
        """Return a one-line name; raise NameSuggesterError if that fails."""
        ...


class ClaudeNameSuggester:
    """NameSuggester over the Anthropic Messages API: one call.

    The client is made from ANTHROPIC_API_KEY on the first call, so building one needs no key.
    """

    def __init__(self, client: Any = None, model: str = MODEL) -> None:
        self._client = client
        self._model = model

    def suggest(self, clues: NameClues) -> SuggestedName:
        client = self._client_or_new()
        try:
            response = client.messages.create(
                model=self._model,
                max_tokens=MAX_TOKENS,
                timeout=TIMEOUT_SEC,
                # Haiku thinks by default and its thinking can use up the few tokens a name needs
                thinking={"type": "disabled"},
                messages=[{"role": "user", "content": _content(clues)}],
            )
        except anthropic.AuthenticationError as err:
            raise NameSuggesterError(_KEY_REFUSED) from err
        except anthropic.APIConnectionError as err:
            raise NameSuggesterError(_UNREACHABLE) from err
        except anthropic.APIError as err:
            raise NameSuggesterError(_API_ERROR) from err
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        name = _one_line(text)
        if not name:
            raise NameSuggesterError(_NO_NAME)
        return SuggestedName(name, _cost(self._model, response.usage), self._model)

    def _client_or_new(self) -> Any:
        if self._client is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                raise NameSuggesterError(_NO_KEY)
            self._client = anthropic.Anthropic()
        return self._client


class FakeNameSuggester:
    """NameSuggester that answers with the given name and records the clues it was given."""

    def __init__(self, name: str, cost_usd: float = 0.0) -> None:
        self._name, self._cost_usd = name, cost_usd
        self.calls: list[NameClues] = []

    def suggest(self, clues: NameClues) -> SuggestedName:
        self.calls.append(clues)
        return SuggestedName(self._name, self._cost_usd, "fake")


def suggest_name(clues: NameClues, suggester: NameSuggester | None) -> Suggestion:
    """The model's name, or (no suggester, or it failed) the tidied file name."""
    reason = _NO_KEY
    if suggester is not None:
        try:
            made = suggester.suggest(clues)
        except NameSuggesterError as error:
            reason = str(error)
        else:
            return Suggestion(made.name, "claude", None, made.cost_usd)
    tidy = clean_file_name(clues.audio_name or "")
    if tidy:
        return Suggestion(
            tidy[:MAX_NAME], "fallback", f"{reason} Used the audio file's name instead."
        )
    return Suggestion("", "fallback", f"{reason} {_NOTHING}")


def clean_file_name(file_name: str) -> str:
    """ "Los_Banditos-2019.mp3" becomes "Los Banditos 2019": a file name read as words."""
    stem = re.sub(r"(?<=.)\.[A-Za-z0-9]{1,5}$", "", file_name.strip())
    return " ".join(re.sub(r"[_-]", " ", stem).split())


def top_strip(page: Image.Image, fraction: float = STRIP_FRACTION) -> bytes:
    """The top of a page image as a small PNG: where the title and composer are."""
    gray = page.convert("L")
    height = max(1, round(gray.height * fraction))
    strip = gray.crop((0, 0, gray.width, height))
    if strip.width > STRIP_MAX_WIDTH:
        scale = STRIP_MAX_WIDTH / strip.width
        size = (STRIP_MAX_WIDTH, max(1, round(strip.height * scale)))
        strip = strip.resize(size, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    strip.save(out, format="PNG", optimize=True)
    return out.getvalue()


def pdf_top_strip(pdf: bytes) -> bytes | None:
    """The top strip of a PDF's first page, or None when the PDF cannot be read."""
    try:
        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            pixmap = document[0].get_pixmap(dpi=PDF_DPI, colorspace=pymupdf.csGRAY)
            page = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    except (RuntimeError, ValueError, IndexError):  # pymupdf's file errors are RuntimeErrors
        return None
    return top_strip(page)


def _content(clues: NameClues) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    if clues.audio_name:
        content.append({"type": "text", "text": f"Audio file name: {clues.audio_name}"})
    if clues.strip_png:
        data = base64.standard_b64encode(clues.strip_png).decode()
        content.append({"type": "text", "text": "Top of the first page of the sheet music:"})
        content.append(
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
        )
    content.append({"type": "text", "text": PROMPT})
    return content


def _one_line(reply: str) -> str:
    """The first line of the reply without quotes or a leading "Title:"."""
    line = next((line.strip() for line in reply.splitlines() if line.strip()), "")
    line = re.sub(r"^(suggested\s+)?(title|name)\s*:\s*", "", line, flags=re.IGNORECASE)
    return line.strip(" \"'“”‘’")[:MAX_NAME].strip()


def _cost(model: str, usage: Any) -> float:
    price_in, price_out = PRICES.get(model, (0.0, 0.0))
    return (usage.input_tokens * price_in + usage.output_tokens * price_out) / 1e6
