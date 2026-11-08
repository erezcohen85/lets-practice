import base64
import os
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

import anthropic
from pydantic import BaseModel, Field, ValidationError

# Reads the structure of a part (lines, measures, multi-rests, meters, fermatas, tempo words,
# repeats, the part's name) from one picture per line, with a vision model. The PoC's bake-off
# (Decisions 2026-10-27/28) found Claude Haiku 5.5 reading 126 bars 20/20. The model sits behind
# ScoreReader; FakeScoreReader stands in for it in unit tests. What a reading means (bars, meters,
# play order) is structure.py's job.

MODEL = "claude-haiku-5-5"
EFFORT = "high"
MAX_TOKENS = 64000
# A call holds at most this many pictures: with all 11 lines of a piano part in one call, Haiku
# returned 13 or 14 lines, with 6 or fewer it returned one for each (tried on 5, 4, 6 and 6 + 5).
MAX_PICTURES = 6
TIMEOUT_SEC = 1200  # a long JSON answer after thinking; overrides the SDK's 10-minute guard

# $ per million tokens (input, output), Claude API, 2026-10
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}

PROMPT = """You are reading an instrumental part (sheet music) to find its structure, not its
notes. Above are the lines (systems) of the part, in order. Each picture is ONE line cut from its
page at full width, after a caption such as "page 1, line 3". A picture may show a little of the
line above or below at its top and bottom edges: that is not part of the line, ignore it.
Return exactly one entry in "lines" for each picture, in the same order, with the page from its
caption. A line may hold two staves joined by a brace (a piano part, treble and bass): that is
still ONE line, with one list of measures, and a bar line runs through both staves. For each line
report:
- the bar number printed at its start, if one is printed (small number above the clef, or a
  boxed rehearsal number that sits on its first bar); null if none is printed;
- every measure in the line, left to right. A measure is the space between two bar lines: count
  the bar lines that run through the whole staff (a double bar line or a repeat sign is one bar
  line). A stem, a beam, a rest or a note inside a measure does not end it. Do not merge two
  measures into one and do not split one in two. A multi-measure rest (thick horizontal bar with
  a number such as "2" above it) is ONE printed measure: set multi_rest_bars to that number; a
  half rest or a whole rest is not one. Boxed rehearsal numbers and letters are labels, not bar
  lines.
- first_measure_beats, about the first measure of the line only: 0 when it is as long as the
  time signature says. When it is shorter (a pickup at the start of the piece, or an incomplete
  bar), the number of notes it holds, counted in the note value of the time signature's lower
  number: in 6/8 a single eighth note is 1, in 4/4 a single quarter note is 1, in 3/4 two quarter
  notes are 2. null if you cannot tell.
For each measure: a time signature printed at its start; the beats (1-based) where a fermata
sits (a small arc over a dot, above or below the staff; look at every measure, the last ones at
the right edge too); tempo or character words that start in it (e.g. "rall.", "rit.",
"A tempo", "Tempo I", "poco rall.", "molto rall.", "Joyous!", "Smooth") - not dynamics, not
rehearsal numbers, not "div."; and any repeat signs, volta brackets or navigation marks
(D.C., D.S., Coda, Fine).
When a caption says "this line has N measures", it does: report exactly N measures for that
line, and put each mark on the measure it belongs to.
Also report "part_name": the instrument name printed in the part's header (usually above the
first line), in standard English instrument naming, for example "Clarinet in B♭ 1" or
"Violin II"; null if no picture shows one.
Put anything you are unsure about in "doubts"."""


class ScoreReaderError(ValueError):
    """The score could not be read; the message is one sentence a user may read."""


_NO_KEY = "Reading the score's structure needs an Anthropic API key; set ANTHROPIC_API_KEY."
_KEY_REFUSED = "The Anthropic API refused the Anthropic API key; check ANTHROPIC_API_KEY."
_UNREACHABLE = "The Anthropic API could not be reached to read the score; try again later."
_API_ERROR = "The Anthropic API returned an error while reading the score; try again later."
_DECLINED = "The score reader declined to read this part."
_NOT_THE_SCHEMA = "The score reader's reply did not fit the expected format."


class ReadMeasure(BaseModel):
    multi_rest_bars: int = Field(ge=1, description="1 for a normal measure, N for an N-bar rest")
    time_signature: str | None = Field(description='e.g. "3/4" if printed at its start')
    fermata_beats: list[int]
    text: list[str]
    repeat: Literal["none", "start", "end", "both"]
    volta: int | None
    navigation: str | None = Field(description="D.C., D.S., To Coda, Coda, Fine, or null")


class ReadLine(BaseModel):
    page: int
    printed_start_number: int | None
    measures: list[ReadMeasure]
    first_measure_beats: int | None = Field(
        default=None,
        description="0 if the first measure is a full bar; else the notes of the time "
        "signature's lower number it holds; null if unknown",
    )


class Reading(BaseModel):
    part_name: str | None = Field(description='the instrument in the header, e.g. "Violin II"')
    lines: list[ReadLine]
    doubts: list[str]


@dataclass(frozen=True)
class LinePicture:
    """One line of the part as a PNG. The label ("page 1, line 3") is always sent; a caption is
    added after it, e.g. the re-read caption that tells the model how many measures the line has."""

    label: str
    png: bytes
    caption: str | None = None


@dataclass(frozen=True)
class ReaderResult:
    """What the reader saw, which model saw it and what the look cost."""

    reading: Reading
    cost_usd: float
    model: str


@runtime_checkable
class ScoreReader(Protocol):
    """Read the structure of a part from pictures of its lines."""

    def read(self, pictures: list[LinePicture]) -> ReaderResult:
        """Return one ReadLine per picture, in order; raise ScoreReaderError if that fails."""
        ...


def reread_caption(count: int, first_bar: int) -> str:
    """The caption of a line shown again: what the page says about its measures."""
    noun = "measure" if count == 1 else "measures"
    return f"this line has {count} {noun} (bars {first_bar}-{first_bar + count - 1})"


class ClaudeScoreReader:
    """ScoreReader over the Anthropic Messages API: a call holds up to MAX_PICTURES pictures.

    The client is made from ANTHROPIC_API_KEY on the first read, so building a reader needs no key.
    """

    def __init__(self, client: Any = None, model: str = MODEL) -> None:
        self._client = client
        self._model = model

    def read(self, pictures: list[LinePicture]) -> ReaderResult:
        client = self._client_or_new()
        readings = [
            self._read_chunk(client, pictures[start : start + MAX_PICTURES])
            for start in range(0, len(pictures), MAX_PICTURES)
        ]
        names = [r.reading.part_name for r in readings if r.reading.part_name]
        reading = Reading(
            part_name=names[0] if names else None,
            lines=[line for r in readings for line in r.reading.lines],
            doubts=[doubt for r in readings for doubt in r.reading.doubts],
        )
        return ReaderResult(reading, sum(r.cost_usd for r in readings), self._model)

    def _read_chunk(self, client: Any, pictures: list[LinePicture]) -> ReaderResult:
        try:
            response = client.messages.parse(
                model=self._model,
                max_tokens=MAX_TOKENS,
                timeout=TIMEOUT_SEC,
                output_config={"effort": EFFORT},
                messages=[{"role": "user", "content": _content(pictures)}],
                output_format=Reading,
            )
        except anthropic.AuthenticationError as err:
            raise ScoreReaderError(_KEY_REFUSED) from err
        except anthropic.APIConnectionError as err:
            raise ScoreReaderError(_UNREACHABLE) from err
        except anthropic.APIError as err:
            raise ScoreReaderError(_API_ERROR) from err
        except ValidationError as err:
            raise ScoreReaderError(_NOT_THE_SCHEMA) from err
        if response.stop_reason == "refusal":
            raise ScoreReaderError(_DECLINED)
        reading = response.parsed_output
        if reading is None:
            raise ScoreReaderError(_NOT_THE_SCHEMA)
        if len(reading.lines) != len(pictures):
            raise ScoreReaderError(
                f"The score reader returned {len(reading.lines)} lines for "
                f"{len(pictures)} pictures."
            )
        return ReaderResult(reading, _cost(self._model, response.usage), self._model)

    def _client_or_new(self) -> Any:
        if self._client is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                raise ScoreReaderError(_NO_KEY)
            self._client = anthropic.Anthropic()
        return self._client


def _content(pictures: list[LinePicture]) -> list[dict[str, Any]]:
    """Each picture after its caption, then the prompt."""
    content: list[dict[str, Any]] = []
    for picture in pictures:
        caption = (
            picture.label if picture.caption is None else f"{picture.label}: {picture.caption}"
        )
        data = base64.standard_b64encode(picture.png).decode()
        content.append({"type": "text", "text": caption})
        content.append(
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
        )
    content.append({"type": "text", "text": PROMPT})
    return content


def _cost(model: str, usage: Any) -> float:
    price_in, price_out = PRICES.get(model, (0.0, 0.0))
    return (usage.input_tokens * price_in + usage.output_tokens * price_out) / 1e6


class FakeScoreReader:
    """ScoreReader that answers with the given readings in call order and records its calls."""

    def __init__(self, readings: list[Reading], cost_usd: float = 0.0) -> None:
        self._readings = list(readings)
        self._cost_usd = cost_usd
        self.calls: list[list[LinePicture]] = []

    def read(self, pictures: list[LinePicture]) -> ReaderResult:
        self.calls.append(pictures)
        if len(self.calls) > len(self._readings):
            raise AssertionError("FakeScoreReader has no more readings to give")
        return ReaderResult(self._readings[len(self.calls) - 1], self._cost_usd, "fake")
