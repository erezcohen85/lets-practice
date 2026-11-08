import base64
import io
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from PIL import Image, ImageDraw

from app.pipeline.score_reader import (
    MAX_PICTURES,
    MODEL,
    PRICES,
    PROMPT,
    ClaudeScoreReader,
    FakeScoreReader,
    LinePicture,
    ReaderResult,
    Reading,
    ScoreReader,
    ScoreReaderError,
    reread_caption,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> Reading:
    return Reading.model_validate_json((FIXTURES / name).read_text(encoding="utf-8"))


TWO_LINES = load("reading_two_lines.json")
REREAD = load("reading_reread_line.json")
PICTURES = [
    LinePicture("page 1, line 1", b"\x89PNG one"),
    LinePicture("page 1, line 2", b"\x89PNG two"),
]


class FakeClient:
    """Records the arguments of messages.parse and answers with a canned reply."""

    def __init__(
        self,
        parsed: Reading | None = TWO_LINES,
        stop_reason: str = "end_turn",
        error: Exception | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.messages = self
        self._parsed, self._stop_reason, self._error = parsed, stop_reason, error

    def parse(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return SimpleNamespace(
            stop_reason=self._stop_reason,
            usage=SimpleNamespace(input_tokens=10_000, output_tokens=2_000),
            parsed_output=self._parsed,
            content=[SimpleNamespace(type="text", text="no json here")],
        )


def reader(client: FakeClient) -> ClaudeScoreReader:
    return ClaudeScoreReader(client=client)


# ---------------------------------------------------------------- the schema and the prompt


def test_a_reading_fixture_parses_with_the_part_name_and_the_doubts():
    assert TWO_LINES.part_name == "Clarinet in B♭ 1"
    assert [len(line.measures) for line in TWO_LINES.lines] == [4, 3]
    assert TWO_LINES.lines[1].measures[0].multi_rest_bars == 2
    assert TWO_LINES.doubts == ["line 2: the rest may be a 3-bar rest"]


def test_the_prompt_asks_for_one_entry_per_picture_the_hinted_count_and_the_part_name():
    assert "exactly one entry" in PROMPT
    assert "this line has N measures" in PROMPT
    assert "two staves joined by a brace" in PROMPT  # a piano line is one entry, not two
    assert "part_name" in PROMPT and "Clarinet in B♭ 1" in PROMPT


def test_the_reply_schema_has_part_name_and_the_reading_fields():
    schema = Reading.model_json_schema()
    assert set(schema["required"]) == {"part_name", "lines", "doubts"}


# ---------------------------------------------------------------- the re-read caption


def test_reread_caption_names_the_count_and_the_bars():
    assert reread_caption(5, 31) == "this line has 5 measures (bars 31-35)"
    assert reread_caption(1, 7) == "this line has 1 measure (bars 7-7)"


# ---------------------------------------------------------------- the request


def test_every_picture_is_sent_after_its_caption_and_the_prompt_comes_last():
    client = FakeClient()
    reader(client).read(PICTURES)
    (call,) = client.calls
    (message,) = call["messages"]
    assert message["role"] == "user"
    content = message["content"]
    assert [block["type"] for block in content] == ["text", "image", "text", "image", "text"]
    assert [content[0]["text"], content[2]["text"]] == ["page 1, line 1", "page 1, line 2"]
    assert content[-1] == {"type": "text", "text": PROMPT}


def test_a_picture_is_a_base64_png_block():
    client = FakeClient()
    reader(client).read(PICTURES)
    image = client.calls[0]["messages"][0]["content"][1]
    assert image == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": base64.standard_b64encode(b"\x89PNG one").decode(),
        },
    }


def test_a_re_read_picture_keeps_its_label_and_adds_the_count_caption():
    client = FakeClient(parsed=REREAD)
    picture = LinePicture("page 2, line 3", b"png", caption=reread_caption(4, 31))
    reader(client).read([picture])
    text = client.calls[0]["messages"][0]["content"][0]["text"]
    assert text == "page 2, line 3: this line has 4 measures (bars 31-34)"


def test_the_request_uses_the_model_the_effort_the_schema_and_a_long_timeout():
    client = FakeClient()
    reader(client).read(PICTURES)
    call = client.calls[0]
    assert call["model"] == MODEL == "claude-haiku-5-5"
    assert call["output_config"] == {"effort": "high"}
    assert call["output_format"] is Reading
    assert call["max_tokens"] == 64000 and call["timeout"] == 1200


def test_the_model_can_be_chosen():
    client = FakeClient()
    ClaudeScoreReader(client=client, model="claude-sonnet-5-5").read(PICTURES)
    assert client.calls[0]["model"] == "claude-sonnet-5-5"


# ---------------------------------------------------------------- the reply


def test_it_returns_the_reading_the_model_and_what_it_cost():
    result = reader(FakeClient()).read(PICTURES)
    assert isinstance(result, ReaderResult)
    assert result.reading == TWO_LINES
    assert result.model == "claude-haiku-5-5"
    pin, pout = PRICES["claude-haiku-5-5"]
    assert result.cost_usd == pytest.approx((10_000 * pin + 2_000 * pout) / 1e6)
    assert result.cost_usd == pytest.approx(0.002)  # Haiku 5.5: $0.10 / $0.50 per million


def test_a_model_without_a_price_costs_nothing_to_report():
    result = ClaudeScoreReader(client=FakeClient(), model="claude-unpriced").read(PICTURES)
    assert result.cost_usd == 0.0


def test_the_claude_adapter_and_the_fake_are_score_readers():
    assert isinstance(reader(FakeClient()), ScoreReader)
    assert isinstance(FakeScoreReader([TWO_LINES]), ScoreReader)


# ---------------------------------------------------------------- long parts, a few pictures a call


class ChunkClient(FakeClient):
    """Answers every call with one blank line per picture it was sent, as a good reader does."""

    def parse(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        pictures = sum(b["type"] == "image" for b in kwargs["messages"][0]["content"])
        line = TWO_LINES.lines[0]
        name = None if len(self.calls) == 1 else "Piano"
        reading = Reading(
            part_name=name, lines=[line] * pictures, doubts=[f"call {len(self.calls)}"]
        )
        return SimpleNamespace(
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=10_000, output_tokens=2_000),
            parsed_output=reading,
            content=[],
        )


def many(count: int) -> list[LinePicture]:
    return [LinePicture(f"page 1, line {i + 1}", b"png") for i in range(count)]


def test_a_long_part_is_read_a_few_pictures_at_a_time():
    # Haiku 5.5 returned 14 lines for the 11 piano lines of one part, but 6 for 6 and 5 for 5
    client = ChunkClient()
    result = reader(client).read(many(MAX_PICTURES * 2 + 1))
    sizes = [sum(b["type"] == "image" for b in c["messages"][0]["content"]) for c in client.calls]
    assert sizes == [MAX_PICTURES, MAX_PICTURES, 1]
    assert len(result.reading.lines) == MAX_PICTURES * 2 + 1


def test_the_chunks_are_one_reading_with_the_first_part_name_every_doubt_and_the_summed_cost():
    client = ChunkClient()
    result = reader(client).read(many(MAX_PICTURES + 1))
    assert result.reading.part_name == "Piano"
    assert result.reading.doubts == ["call 1", "call 2"]
    assert result.cost_usd == pytest.approx(2 * 0.002)


def test_the_labels_of_a_chunk_are_the_labels_of_its_pictures():
    client = ChunkClient()
    reader(client).read(many(MAX_PICTURES + 2))
    second = client.calls[1]["messages"][0]["content"]
    assert [b["text"] for b in second if b["type"] == "text"][:2] == [
        f"page 1, line {MAX_PICTURES + 1}",
        f"page 1, line {MAX_PICTURES + 2}",
    ]


def test_a_chunk_that_returns_the_wrong_number_of_lines_is_the_error():
    with pytest.raises(ScoreReaderError, match="returned 2 lines for 1 pictures"):
        reader(FakeClient()).read(many(1))


# ---------------------------------------------------------------- the errors


def test_no_key_is_an_error_naming_the_variable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ScoreReaderError, match="ANTHROPIC_API_KEY") as caught:
        ClaudeScoreReader().read(PICTURES)
    assert str(caught.value) == (
        "Reading the score's structure needs an Anthropic API key; set ANTHROPIC_API_KEY."
    )


def test_the_client_is_made_from_the_environment_only_when_asked_to_read(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    made: list[Any] = []

    def make_client() -> FakeClient:
        made.append(1)
        return FakeClient()

    monkeypatch.setattr(anthropic, "Anthropic", make_client)
    score_reader = ClaudeScoreReader()
    assert made == []
    score_reader.read(PICTURES)
    score_reader.read(PICTURES)
    assert made == [1]


def test_an_api_error_is_a_plain_sentence():
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    error = anthropic.APIConnectionError(request=request)
    with pytest.raises(ScoreReaderError, match="could not be reached") as caught:
        reader(FakeClient(error=error)).read(PICTURES)
    assert caught.value.__cause__ is error


def test_a_refused_key_is_its_own_sentence():
    response = httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com"))
    error = anthropic.AuthenticationError("bad key", response=response, body=None)
    with pytest.raises(ScoreReaderError, match="refused the Anthropic API key"):
        reader(FakeClient(error=error)).read(PICTURES)


def test_a_refusal_is_an_error():
    with pytest.raises(ScoreReaderError, match="declined"):
        reader(FakeClient(stop_reason="refusal")).read(PICTURES)


def test_a_reply_that_does_not_fit_the_schema_is_an_error():
    with pytest.raises(ScoreReaderError, match="did not fit"):
        reader(FakeClient(parsed=None)).read(PICTURES)


def test_a_reply_that_fails_validation_is_an_error():
    try:
        Reading.model_validate({"lines": "not a list"})
    except Exception as error:  # noqa: BLE001
        failure = error
    with pytest.raises(ScoreReaderError, match="did not fit"):
        reader(FakeClient(error=failure)).read(PICTURES)


def test_a_reply_with_the_wrong_number_of_lines_is_an_error():
    with pytest.raises(ScoreReaderError, match="2 lines for 3 pictures"):
        reader(FakeClient()).read([*PICTURES, LinePicture("page 2, line 1", b"png")])


# ---------------------------------------------------------------- the fake


def test_the_fake_answers_in_call_order_and_records_the_pictures():
    fake = FakeScoreReader([TWO_LINES, REREAD], cost_usd=0.01)
    first = fake.read(PICTURES)
    second = fake.read(PICTURES[1:])
    assert (first.reading, second.reading) == (TWO_LINES, REREAD)
    assert first.cost_usd == 0.01 and first.model == "fake"
    assert fake.calls == [PICTURES, PICTURES[1:]]


def test_the_fake_says_so_when_it_runs_out_of_readings():
    fake = FakeScoreReader([TWO_LINES])
    fake.read(PICTURES)
    with pytest.raises(AssertionError, match="no more readings"):
        fake.read(PICTURES)


# ---------------------------------------------------------------- the real model


def _line_picture(label: str, signature: str | None) -> LinePicture:
    """A five-line staff with two bar lines, as a PNG; a printed signature before the first."""
    image = Image.new("L", (900, 160), 255)
    draw = ImageDraw.Draw(image)
    for i in range(5):
        draw.line([(20, 50 + i * 12), (880, 50 + i * 12)], fill=0, width=2)
    for x in (20, 460, 880):
        draw.line([(x, 50), (x, 98)], fill=0, width=3)
    if signature:
        draw.text((40, 56), signature, fill=0)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return LinePicture(label, buffer.getvalue())


@pytest.mark.real
def test_the_real_model_reads_two_tiny_line_pictures():
    pictures = [_line_picture("page 1, line 1", "4/4"), _line_picture("page 1, line 2", None)]
    result = ClaudeScoreReader().read(pictures)
    print(f"\nscore reader: {result.model}, ${result.cost_usd:.4f}, {result.reading}")
    assert len(result.reading.lines) == 2
    assert result.cost_usd > 0
