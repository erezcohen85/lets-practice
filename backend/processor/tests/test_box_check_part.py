"""box_check.py: check_part and the Claude judge (task 8.19), on fakes and synthetic pages.

The page is a white picture with staff lines and black blocks; the judge is a fake; the Anthropic
client is a stand-in that records its arguments. Nothing opens a socket.
"""

import io
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from PIL import Image, ImageDraw

from app.pipeline.box_check import (
    CLEAN_NOTE,
    MODEL,
    BoxAnswer,
    BoxCheckError,
    ClaudeBoxJudge,
    FakeBoxJudge,
    JudgeAnswer,
    JudgeRequest,
    LineAnswer,
    check_part,
)
from app.pipeline.run_folder import BarBox

SPACE = 15  # a box is 5 spaces high: the staff and half a space above and below
H = 75.0


def box(bar: int, x: float, w: float, y: float = 100.0, page: int = 0) -> BarBox:
    return BarBox(bar=bar, pageIndex=page, x=x, y=y, w=w, h=H)


def page(*blocks: tuple[int, int, int], size: tuple[int, int] = (800, 400)) -> Image.Image:
    """A white page with five staff lines in each band of 75 px at y=100 and y=250, and black
    blocks (x0, x1, y) standing for a clef, a signature and notes: each 40 px high."""
    image = Image.new("L", size, 255)
    pen = ImageDraw.Draw(image)
    for top in (100, 250):
        for row in range(5):
            y = top + 7 + row * SPACE
            pen.line((0, y, size[0], y), fill=0, width=1)
    for x0, x1, y in blocks:
        pen.rectangle((x0, y + 15, x1 - 1, y + 55), fill=0)
    return image


def answer(*verdicts: str, notes: dict[int, str] | None = None, cost: float = 0.002) -> JudgeAnswer:
    items = [
        BoxAnswer(box=i + 1, verdict=v, note=(notes or {}).get(i + 1, ""))
        for i, v in enumerate(verdicts)
    ]
    return JudgeAnswer(LineAnswer(boxes=items, first_note_x=None), 4000, 300, 1.0, cost_usd=cost)


class ByCount:
    """A judge that answers every request from the number of boxes it holds (thread safe)."""

    def __init__(self, replies: dict[int, JudgeAnswer | Exception]) -> None:
        self._replies = replies

    def judge(self, request: JudgeRequest) -> JudgeAnswer:
        reply = self._replies[request.count]
        if isinstance(reply, Exception):
            raise reply
        return reply


def png_size(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


# ---------------------------------------------------------------- asking


def test_each_line_is_asked_once_with_the_clean_picture_then_the_boxed_one() -> None:
    boxes = [box(1, 50, 300), box(2, 350, 300), box(3, 50, 300, y=250)]
    fake = FakeBoxJudge([answer("ok", "ok"), answer("ok")])

    check_part(boxes, {0: page()}, fake, workers=1)

    assert [c.count for c in fake.calls] == [2, 1]
    assert {(c.model, c.variant) for c in fake.calls} == {(MODEL, "B")}
    clean, boxed = fake.calls[0].pictures
    assert png_size(clean) == png_size(boxed)
    assert clean != boxed


def test_the_model_is_haiku() -> None:
    assert MODEL == "claude-haiku-5-5"


def test_a_page_the_part_does_not_have_is_skipped_with_a_warning() -> None:
    fake = FakeBoxJudge([])

    result = check_part([box(1, 50, 300, page=3)], {0: page()}, fake, workers=1)

    assert result.flags == [] and fake.calls == []
    assert result.warnings and "Page 4" in result.warnings[0]


# ---------------------------------------------------------------- flags


def test_every_verdict_but_ok_or_missing_is_a_flag_on_the_first_bar_of_its_box() -> None:
    boxes = [box(1, 50, 200), box(2, 250, 200), box(3, 450, 100), box(4, 450, 100)]
    boxes += [box(5, 550, 200)]
    fake = FakeBoxJudge(
        [
            answer("ok", "two_bars", "ends_early", notes={2: "a bar line inside", 3: "short"}),
        ]
    )

    result = check_part(boxes, {0: page()}, fake, workers=1)

    # boxes 3 and 4 share one place (a multi-rest), so the line has four boxes; the answer holds
    # three verdicts and the fourth box is "missing", which is not a flag
    assert [(f.bar, f.verdict, f.note, f.suggestedX) for f in result.flags] == [
        (2, "two_bars", "a bar line inside", None),
        (3, "ends_early", "short", None),
    ]


def test_the_flags_of_all_lines_come_in_line_order_even_when_asked_at_once() -> None:
    boxes = [box(1, 50, 300), box(2, 350, 300), box(3, 50, 300, y=250)]
    judge = ByCount({2: answer("ok", "ends_late"), 1: answer("not_a_bar")})

    result = check_part(boxes, {0: page()}, judge, workers=4)

    assert [(f.bar, f.verdict) for f in result.flags] == [(2, "ends_late"), (3, "not_a_bar")]


def test_the_cost_is_the_sum_of_the_calls() -> None:
    boxes = [box(1, 50, 300), box(2, 50, 300, y=250)]
    fake = FakeBoxJudge([answer("ok", cost=0.003), answer("ok", cost=0.004)])

    result = check_part(boxes, {0: page()}, fake, workers=1)

    assert result.cost_usd == pytest.approx(0.007)


def test_a_part_with_no_boxes_asks_nothing() -> None:
    fake = FakeBoxJudge([])
    assert check_part([], {}, fake).flags == []
    assert fake.calls == []


# ---------------------------------------------------------------- the suggested edge


def opening_page() -> Image.Image:
    """A clef at x 55-80 and a key signature at 85-100, then the first note at x 160-175."""
    return page((55, 80, 100), (85, 100, 100), (160, 175, 100))


def test_a_signature_in_the_first_box_gets_the_edge_after_the_signature() -> None:
    fake = FakeBoxJudge([answer("signature_inside", "ok")])

    result = check_part([box(1, 50, 300), box(2, 350, 300)], {0: opening_page()}, fake, workers=1)

    # the opening ends at x=100; the edge sits half a staff space (7.5 px) after it
    assert result.flags[0].suggestedX == pytest.approx(107.5, abs=1.0)


def test_a_box_that_starts_late_gets_an_edge_too() -> None:
    fake = FakeBoxJudge([answer("starts_late")])

    result = check_part([box(1, 50, 300)], {0: opening_page()}, fake, workers=1)

    assert result.flags[0].suggestedX == pytest.approx(107.5, abs=1.0)


@pytest.mark.parametrize("verdict", ["ends_early", "ends_late", "two_bars", "not_a_bar"])
def test_other_verdicts_get_no_edge(verdict: str) -> None:
    result = check_part(
        [box(1, 50, 300)], {0: opening_page()}, FakeBoxJudge([answer(verdict)]), workers=1
    )
    assert result.flags[0].suggestedX is None


def test_a_box_that_is_not_the_first_of_its_line_gets_no_edge() -> None:
    fake = FakeBoxJudge([answer("ok", "signature_inside")])

    result = check_part([box(1, 50, 300), box(2, 350, 300)], {0: opening_page()}, fake, workers=1)

    assert result.flags[0].suggestedX is None


def test_an_edge_too_near_the_right_side_of_the_box_is_not_suggested() -> None:
    # a box 50 px wide ends at 100: the edge at 107.5 is past it
    fake = FakeBoxJudge([answer("signature_inside")])

    result = check_part([box(1, 50, 50)], {0: opening_page()}, fake, workers=1)

    assert result.flags[0].suggestedX is None


def test_no_ink_after_the_opening_gives_no_edge() -> None:
    fake = FakeBoxJudge([answer("starts_late")])

    result = check_part([box(1, 50, 300)], {0: page()}, fake, workers=1)

    assert result.flags[0].suggestedX is None


# ---------------------------------------------------------------- a call that fails


def test_a_line_whose_call_fails_gives_no_flags_and_a_warning_and_the_others_go_on() -> None:
    boxes = [box(1, 50, 300), box(2, 350, 300), box(3, 50, 300, y=250)]
    judge = ByCount(
        {2: BoxCheckError("The box check could not reach the API."), 1: answer("two_bars")}
    )

    result = check_part(boxes, {0: page()}, judge, workers=1)

    assert [(f.bar, f.verdict) for f in result.flags] == [(3, "two_bars")]
    assert len(result.warnings) == 1
    assert "line 1" in result.warnings[0] and "could not reach" in result.warnings[0]


def test_the_same_failure_on_several_lines_is_one_warning() -> None:
    boxes = [box(1, 50, 300), box(2, 50, 300, y=250)]
    problem = BoxCheckError("The box check needs an Anthropic API key; set ANTHROPIC_API_KEY.")
    judge = ByCount({1: problem})

    result = check_part(boxes, {0: page()}, judge, workers=1)

    assert result.flags == []
    assert len(result.warnings) == 1
    assert "lines 1 and 2" in result.warnings[0] and "ANTHROPIC_API_KEY" in result.warnings[0]


# ---------------------------------------------------------------- the Claude judge


class FakeClient:
    """Records the arguments of messages.parse and answers with a canned reply."""

    def __init__(
        self,
        parsed: LineAnswer | None = None,
        stop_reason: str = "end_turn",
        error: Exception | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.messages = self
        self._parsed = parsed or LineAnswer(
            boxes=[BoxAnswer(box=1, verdict="ok", note="")], first_note_x=None
        )
        self._stop_reason, self._error = stop_reason, error

    def parse(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return SimpleNamespace(
            stop_reason=self._stop_reason,
            usage=SimpleNamespace(input_tokens=10_000, output_tokens=1_000),
            parsed_output=self._parsed,
        )


REQUEST = JudgeRequest(MODEL, "B", 1, [b"clean", b"boxed"], 1)


def test_the_judge_sends_both_pictures_then_the_prompt_with_the_clean_note() -> None:
    client = FakeClient()

    result = ClaudeBoxJudge(client=client).judge(REQUEST)

    call = client.calls[0]
    assert call["model"] == MODEL and call["output_config"] == {"effort": "high"}
    content = call["messages"][0]["content"]
    assert [b["type"] for b in content] == ["image", "image", "text"]
    assert "numbered 1 to 1" in content[2]["text"] and CLEAN_NOTE in content[2]["text"]
    assert result.answer.boxes[0].verdict == "ok"
    assert result.input_tokens == 10_000 and result.cost_usd == pytest.approx(0.0015)


def test_the_client_is_made_from_the_environment_only_when_first_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    made: list[int] = []

    def make_client() -> FakeClient:
        made.append(1)
        return FakeClient()

    monkeypatch.setattr(anthropic, "Anthropic", make_client)
    judge = ClaudeBoxJudge()
    assert made == []
    judge.judge(REQUEST)
    judge.judge(REQUEST)
    assert made == [1]


def test_no_key_is_an_error_naming_the_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(BoxCheckError, match="ANTHROPIC_API_KEY"):
        ClaudeBoxJudge().judge(REQUEST)


def test_an_api_error_is_a_plain_sentence() -> None:
    error = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))

    with pytest.raises(BoxCheckError, match="could not be reached") as caught:
        ClaudeBoxJudge(client=FakeClient(error=error)).judge(REQUEST)

    assert caught.value.__cause__ is error


def test_a_refused_key_is_its_own_sentence() -> None:
    response = httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com"))
    error = anthropic.AuthenticationError("bad key", response=response, body=None)

    with pytest.raises(BoxCheckError, match="refused the Anthropic API key"):
        ClaudeBoxJudge(client=FakeClient(error=error)).judge(REQUEST)


def test_a_refusal_or_a_reply_that_does_not_fit_is_an_error() -> None:
    with pytest.raises(BoxCheckError, match="declined"):
        ClaudeBoxJudge(client=FakeClient(stop_reason="refusal")).judge(REQUEST)
    broken = FakeClient()
    broken._parsed = None  # type: ignore[assignment]
    with pytest.raises(BoxCheckError, match="did not fit"):
        ClaudeBoxJudge(client=broken).judge(REQUEST)
