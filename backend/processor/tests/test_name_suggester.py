import io
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pymupdf
import pytest
from PIL import Image

from app.pipeline.name_suggester import (
    MODEL,
    ClaudeNameSuggester,
    FakeNameSuggester,
    NameClues,
    NameSuggester,
    NameSuggesterError,
    SuggestedName,
    clean_file_name,
    pdf_top_strip,
    suggest_name,
    top_strip,
)
from app.pipeline.score_reader import PRICES

PNG = b"\x89PNG strip"


class FakeClient:
    """Records the arguments of messages.create and answers with a canned reply."""

    def __init__(self, text: str = "Etude in C (Anna Berg)", error: Exception | None = None):
        self.calls: list[dict[str, Any]] = []
        self.messages = self
        self._text, self._error = text, error

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return SimpleNamespace(
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1_500, output_tokens=20),
            content=[SimpleNamespace(type="text", text=self._text)],
        )


CLUES = NameClues(audio_name="take3.mp3", strip_png=PNG)


# ---------------------------------------------------------------- the model call


def test_it_asks_haiku_once_with_both_clues():
    client = FakeClient()

    result = ClaudeNameSuggester(client=client).suggest(CLUES)

    assert result == SuggestedName("Etude in C (Anna Berg)", result.cost_usd, MODEL)
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["model"] == MODEL == "claude-haiku-5-5"
    assert call["thinking"] == {"type": "disabled"}  # thinking can use up the few tokens of a name
    content = call["messages"][0]["content"]
    texts = " ".join(block["text"] for block in content if block["type"] == "text")
    assert "YouTube" not in texts
    assert "take3.mp3" in texts
    assert sum(block["type"] == "image" for block in content) == 1


def test_it_costs_what_the_price_table_says():
    price_in, price_out = PRICES[MODEL]

    result = ClaudeNameSuggester(client=FakeClient()).suggest(CLUES)

    assert result.cost_usd == pytest.approx((1_500 * price_in + 20 * price_out) / 1e6)


def test_without_a_strip_no_image_is_sent():
    client = FakeClient()

    ClaudeNameSuggester(client=client).suggest(NameClues(None, None))

    content = client.calls[0]["messages"][0]["content"]
    assert all(block["type"] == "text" for block in content)
    assert "Audio file name:" not in " ".join(block["text"] for block in content)


@pytest.mark.parametrize(
    ("reply", "name"),
    [
        ('"Etude in C (Anna Berg)"', "Etude in C (Anna Berg)"),
        ("  Etude in C\n\nI chose this because...", "Etude in C"),
        ("Title: Etude in C", "Etude in C"),
    ],
)
def test_the_reply_is_tidied_to_one_line_of_name(reply: str, name: str):
    assert ClaudeNameSuggester(client=FakeClient(reply)).suggest(CLUES).name == name


def test_an_empty_reply_is_an_error():
    with pytest.raises(NameSuggesterError, match="no name"):
        ClaudeNameSuggester(client=FakeClient("  ")).suggest(CLUES)


def test_no_key_is_a_plain_sentence(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(NameSuggesterError, match="no Anthropic API key"):
        ClaudeNameSuggester().suggest(CLUES)


def test_an_unreachable_api_is_a_plain_sentence():
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    error = anthropic.APIConnectionError(request=request)
    with pytest.raises(NameSuggesterError, match="could not be reached") as caught:
        ClaudeNameSuggester(client=FakeClient(error=error)).suggest(CLUES)
    assert caught.value.__cause__ is error


def test_a_refused_key_is_its_own_sentence():
    response = httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com"))
    error = anthropic.AuthenticationError("bad key", response=response, body=None)
    with pytest.raises(NameSuggesterError, match="refused the Anthropic API key"):
        ClaudeNameSuggester(client=FakeClient(error=error)).suggest(CLUES)


# ---------------------------------------------------------------- the fallback


def test_the_fake_answers_and_records_its_clues():
    fake = FakeNameSuggester("Etude", cost_usd=0.002)

    assert isinstance(fake, NameSuggester)
    assert fake.suggest(CLUES) == SuggestedName("Etude", 0.002, "fake")
    assert fake.calls == [CLUES]


def test_a_suggestion_from_the_model_says_so():
    suggestion = suggest_name(CLUES, FakeNameSuggester("Etude in C (Anna Berg)", 0.002))

    assert (suggestion.name, suggestion.source, suggestion.note) == (
        "Etude in C (Anna Berg)",
        "claude",
        None,
    )
    assert suggestion.cost_usd == 0.002


def test_without_a_suggester_the_audio_file_name_is_cleaned():
    clues = NameClues("Los_Banditos-2019 final.mp3", PNG)

    suggestion = suggest_name(clues, None)

    assert suggestion.name == "Los Banditos 2019 final"
    assert suggestion.note == "There is no Anthropic API key. Used the audio file's name instead."


def test_a_failed_call_falls_back_with_its_sentence():
    class Failing:
        def suggest(self, clues: NameClues) -> SuggestedName:
            raise NameSuggesterError("The Anthropic API could not be reached; try again later.")

    suggestion = suggest_name(CLUES, Failing())

    assert suggestion.name == "take3"
    assert suggestion.source == "fallback"
    assert suggestion.note == (
        "The Anthropic API could not be reached; try again later. "
        "Used the audio file's name instead."
    )
    assert suggestion.cost_usd == 0.0


def test_with_nothing_to_go_on_the_name_is_empty_and_the_note_says_so():
    suggestion = suggest_name(NameClues(None, PNG), None)

    assert suggestion.name == ""
    assert suggestion.source == "fallback"
    assert (
        suggestion.note == "There is no Anthropic API key. There was no title or file name to use."
    )


@pytest.mark.parametrize(
    ("file_name", "cleaned"),
    [
        ("CCC_clar1_final-v2.mp3", "CCC clar1 final v2"),
        ("Los Banditos 2019.m4a", "Los Banditos 2019"),
        ("noextension", "noextension"),
        ("   ", ""),
    ],
)
def test_clean_file_name(file_name: str, cleaned: str):
    assert clean_file_name(file_name) == cleaned


# ---------------------------------------------------------------- the top strip


def test_the_strip_is_the_top_of_the_page_and_small():
    page = Image.new("L", (2000, 3000), 255)

    strip = Image.open(io.BytesIO(top_strip(page)))

    assert strip.width <= 1000
    assert strip.height < strip.width / 3  # a strip, not the page


def test_a_pdf_gives_the_strip_of_its_first_page():
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((80, 60), "Etude in C", fontsize=24)
    document.new_page()

    strip = Image.open(io.BytesIO(pdf_top_strip(document.tobytes()) or b""))

    assert strip.width > 0
    assert strip.getextrema() != (255, 255)  # the title is in it


def test_a_pdf_that_cannot_be_read_gives_no_strip():
    assert pdf_top_strip(b"not a pdf") is None
