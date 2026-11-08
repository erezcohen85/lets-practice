import base64
import os
import threading
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal, NamedTuple, Protocol

import anthropic
from PIL import Image
from pydantic import BaseModel, ValidationError

from app.pipeline.box_check import (
    SAME_PX,
    Crop,
    Line,
    Place,
    _list_of,
    _png,
    cost_usd,
    crop_of,
    draw_line,
    lines_of,
    places_of,
    staff_space,
)
from app.pipeline.run_folder import BarBox, BoxEdges, BoxFlag, FlagVerdict

# Advanced Reading (Decisions 2026-11-07, docs/plans/2026-11-07-advanced-reader-judge.md): three
# readings of each line of a scanned part propose better bar boxes, a judge model accepts or
# rejects each proposal, and the accepted ones are applied. The readings are the bar reader
# test's variant R1 (docs/BAR_READER_TEST.md): Haiku twice and Opus once, each asked for the
# edges of every bar of the line. This file holds what the product uses: the readers and the
# judge (protocols, fakes, the Claude ones), the proposals, applying them and the flags.

WORKERS = 6  # lines read, and proposals judged, at once
AGREE_SPACES = 0.5  # both Haiku readings of a box lie within this of each other ...
DIFFER_SPACES = 1.0  # ... and their mean lies more than this from our box: a move is proposed
KEEP_SPACES = 1.0  # a count proposal keeps our bar line when the readings' lies within this ...
START_KEEP_SPACES = 4.0  # ... and our line start within this: the readers are weak after the clef
MOVE_MARGIN_SPACES = 3  # a move's pictures reach this far beyond the box on each side
MOVE_TARGET_WIDTH = 900  # px, about: the pictures of a move are scaled up to this width
MOVE_MAX_SCALE = 4
MOVED_EPS = 1e-6  # an edge that differs by more than this px has moved

HAIKU = "claude-haiku-5-5"
OPUS = "claude-opus-5-5"
READER_TIMEOUT_SEC = 300
JUDGE_TIMEOUT_SEC = 180
JUDGE_MAX_TOKENS = 8000
HAIKU_MAX_TOKENS = 16000

Edges = list[tuple[float, float]]


class ReadAgainError(ValueError):
    """A reading or a judgement could not be had; the message is one sentence a user may read."""


# ---------------------------------------------------------------- the prompts

# The reader's prompt is the bar reader test's R1 prompt, byte for byte: the test's cached answers
# are found by a hash of it (spikes/bar_reader.py cache_key), and the spike imports it from here.
COMMON = """This picture is ONE line (system) of an instrumental part, cut from its page at full \
width. A bar (measure) is the space between two bar lines. A multi-measure rest (a thick \
horizontal bar with a number above it) is ONE box for all the bars it holds. A double bar or a \
repeat sign is one bar line. The first bar of the line begins where its music begins, just after \
the clef, key signature and time signature (not at the clef); the last bar ends at the line's \
last bar line. Courtesy signatures after a line's last bar line are not a bar."""

READER_PROMPT = (
    COMMON
    + """
List every bar of the line, left to right, as a box in "boxes": "left" and "right" are the x of \
the bar's left and right edge as a fraction of the picture's width (0 is the left edge of the \
picture, 1 its right edge), to three decimals; "bars" is 1, or the number of bars a multi-measure \
rest holds. Neighbouring boxes share the bar line between them."""
)

BOX_DEFINITION = """A box is one bar (measure), from the bar line that starts it to the bar line \
that ends it. The first bar of a line starts just after the clef, key signature and time \
signature, where its music begins. A multi-measure rest (a thick horizontal bar with a number \
above it) is one box for all its bars. A double bar or a repeat sign is one bar line. Courtesy \
signatures after a line's last bar line are not a bar."""

ANSWER_NOTE = """Answer "A" or "B", or "neither" if neither is right. In "note", say in a few \
words what decided it."""

COUNT_PROMPT = (
    """Three pictures of ONE line (system) of an instrumental part, cut from its page at full \
width. The first has nothing drawn on it. The second (A) and the third (B) have coloured \
rectangles on it, numbered in the white strip above them, that mark where a program thinks the \
bars are; A and B split the line into bars differently.
"""
    + BOX_DEFINITION
    + """
Which drawing has exactly one rectangle for each box, its edges on the bar lines? An edge up to \
half a staff space off is still right. """
    + ANSWER_NOTE
)

MOVE_FIRST = """This box is the first box of its line: its left edge belongs just after the clef, \
key signature and time signature, its right edge on the bar line that ends it."""
MOVE_NOT_FIRST = """This box is not the first of its line: both its edges belong on bar lines."""

MOVE_PROMPT = (
    """Three pictures of the same part of ONE line of an instrumental part, enlarged. The first \
has nothing drawn on it. The second (A) and the third (B) each have one coloured rectangle on \
it, in a different place; the rectangle is meant to be one box.
"""
    + BOX_DEFINITION
    + """
{place}
Which rectangle sits exactly on its box, edge to edge? An edge up to half a staff space off is \
still right. """
    + ANSWER_NOTE
)

_NO_KEY = "Advanced Reading needs an Anthropic API key; set ANTHROPIC_API_KEY."
_KEY_REFUSED = "The Anthropic API refused the Anthropic API key; check ANTHROPIC_API_KEY."
_UNREACHABLE = "The Anthropic API could not be reached for Advanced Reading; try again later."
_API_ERROR = "The Anthropic API returned an error during Advanced Reading; try again later."
_DECLINED = "The Advanced Reading model declined to look at this line."
_RAN_OUT = "The Advanced Reading model ran out of room before it finished this line."
_NOT_THE_SCHEMA = "The Advanced Reading model's reply did not fit the expected format."


# ---------------------------------------------------------------- the readers


class ReaderRun(NamedTuple):
    model: str
    effort: str
    run: int


# Haiku twice (the runs vote together) and Opus once (it votes on the count only).
READER_RUNS: tuple[ReaderRun, ...] = (
    ReaderRun(HAIKU, "high", 1),
    ReaderRun(HAIKU, "high", 2),
    ReaderRun(OPUS, "medium", 1),
)
# The bar reader test's ceiling for Haiku; Opus gets less because the test's one dear part came
# from a single long call. A reading that hits its ceiling is missing, not cut short.
MAX_TOKENS = {HAIKU: HAIKU_MAX_TOKENS, OPUS: 4000}


@dataclass(frozen=True)
class ReaderRequest:
    model: str
    effort: str
    run: int
    picture: bytes  # the line's clean picture, a PNG
    prompt: str
    max_tokens: int


class ReaderBox(BaseModel):
    left: float
    right: float
    bars: int


class ReaderAnswer(BaseModel):
    boxes: list[ReaderBox]


@dataclass(frozen=True)
class ReaderReply:
    answer: ReaderAnswer
    cost_usd: float


class LineReader(Protocol):
    def read(self, request: ReaderRequest) -> ReaderReply: ...


class FakeLineReader:
    """A LineReader for tests. `by_run` answers a request by (model, run): with one reply every
    time, with a list of replies in call order, or with a function of the request; a reply that is
    an exception is raised. A request `by_run` has no answer for takes the next of `replies`;
    with none left the fake raises ReadAgainError. Every request is recorded."""

    def __init__(
        self, by_run: Mapping[tuple[str, int], Any] | None = None, replies: Sequence[Any] = ()
    ) -> None:
        self._by_run = {
            key: list(value) if isinstance(value, list) else value
            for key, value in (by_run or {}).items()
        }
        self._replies = list(replies)
        self._lock = threading.Lock()
        self.calls: list[ReaderRequest] = []

    def read(self, request: ReaderRequest) -> ReaderReply:
        key = (request.model, request.run)
        with self._lock:
            self.calls.append(request)
            held = self._by_run.get(key)
            if isinstance(held, list):
                answer = held.pop(0) if held else None
            elif held is not None:
                answer = held
            else:
                answer = self._replies.pop(0) if self._replies else None
        if answer is None:
            raise ReadAgainError(f"The fake reader has no answer for {key}.")
        if callable(answer):
            answer = answer(request)
        if isinstance(answer, Exception):
            raise answer
        return answer  # type: ignore[no-any-return]


# ---------------------------------------------------------------- the judge


@dataclass(frozen=True)
class JudgeRequest:
    model: str
    effort: str
    kind: Literal["count", "move", "line"]
    pictures: list[bytes]  # PNGs: the clean picture, then A, then B
    prompt: str


class JudgeChoice(BaseModel):
    choice: Literal["A", "B", "neither"]
    note: str


@dataclass(frozen=True)
class JudgeReply:
    answer: JudgeChoice
    cost_usd: float


class ProposalJudge(Protocol):
    def judge(self, request: JudgeRequest) -> JudgeReply: ...


class FakeProposalJudge:
    """A ProposalJudge for tests: it answers from a list in call order, or from a function of the
    request; a reply that is an exception is raised. Every request is recorded."""

    def __init__(self, answers: Sequence[Any] | Callable[[JudgeRequest], Any]) -> None:
        self._answers = answers if callable(answers) else list(answers)
        self._lock = threading.Lock()
        self.calls: list[JudgeRequest] = []

    def judge(self, request: JudgeRequest) -> JudgeReply:
        with self._lock:
            self.calls.append(request)
            if callable(self._answers):
                answer: Any = self._answers
            else:
                answer = self._answers.pop(0)
        if callable(answer):
            answer = answer(request)
        if isinstance(answer, Exception):
            raise answer
        return answer  # type: ignore[no-any-return]


# ---------------------------------------------------------------- the Claude ones


class _ClaudeCaller:
    """What the Claude reader and the Claude judge share: the lazily made client and one call that
    maps every failure to a ReadAgainError. The client is made from ANTHROPIC_API_KEY on the first
    call, so building one needs no key."""

    def __init__(self, client: Any = None) -> None:
        self._client = client
        self._lock = threading.Lock()

    def _ask(
        self,
        *,
        model: str,
        effort: str,
        max_tokens: int,
        timeout: int,
        pictures: Sequence[bytes],
        text: str,
        schema: type[BaseModel],
    ) -> tuple[Any, float]:
        client = self._client_or_new()
        content: list[dict[str, Any]] = []
        for picture in pictures:
            data = base64.standard_b64encode(picture).decode()
            source = {"type": "base64", "media_type": "image/png", "data": data}
            content.append({"type": "image", "source": source})
        content.append({"type": "text", "text": text})
        try:
            response = client.messages.parse(
                model=model,
                max_tokens=max_tokens,
                timeout=timeout,
                output_config={"effort": effort},
                messages=[{"role": "user", "content": content}],
                output_format=schema,
            )
        except anthropic.AuthenticationError as err:
            raise ReadAgainError(_KEY_REFUSED) from err
        except anthropic.APIConnectionError as err:
            raise ReadAgainError(_UNREACHABLE) from err
        except anthropic.APIError as err:
            raise ReadAgainError(_API_ERROR) from err
        except ValidationError as err:
            raise ReadAgainError(_NOT_THE_SCHEMA) from err
        if response.stop_reason == "refusal":
            raise ReadAgainError(_DECLINED)
        if response.stop_reason == "max_tokens":
            raise ReadAgainError(_RAN_OUT)
        parsed = response.parsed_output
        if parsed is None:
            raise ReadAgainError(_NOT_THE_SCHEMA)
        usage = response.usage
        return parsed, cost_usd(model, usage.input_tokens, usage.output_tokens)

    def _client_or_new(self) -> Any:
        with self._lock:
            if self._client is None:
                if not os.environ.get("ANTHROPIC_API_KEY"):
                    raise ReadAgainError(_NO_KEY)
                self._client = anthropic.Anthropic()
            return self._client


class ClaudeLineReader(_ClaudeCaller):
    """LineReader over the Anthropic Messages API. No temperature and no thinking setting is sent:
    Haiku 5.5 and Sonnet 5.5 refuse a temperature other than their default."""

    def read(self, request: ReaderRequest) -> ReaderReply:
        answer, cost = self._ask(
            model=request.model,
            effort=request.effort,
            max_tokens=request.max_tokens,
            timeout=READER_TIMEOUT_SEC,
            pictures=[request.picture],
            text=request.prompt,
            schema=ReaderAnswer,
        )
        return ReaderReply(answer, cost)


class ClaudeProposalJudge(_ClaudeCaller):
    """ProposalJudge over the Anthropic Messages API (the same calls as the line reader)."""

    def judge(self, request: JudgeRequest) -> JudgeReply:
        answer, cost = self._ask(
            model=request.model,
            effort=request.effort,
            max_tokens=JUDGE_MAX_TOKENS,
            timeout=JUDGE_TIMEOUT_SEC,
            pictures=request.pictures,
            text=request.prompt,
            schema=JudgeChoice,
        )
        return JudgeReply(answer, cost)


# ---------------------------------------------------------------- the vote and the merge


def merge_by_agreement(
    pipeline: Edges,
    first: Edges,
    second: Edges,
    space: float,
    agree: float = AGREE_SPACES,
    differ: float = DIFFER_SPACES,
) -> Edges:
    """The pipeline's boxes, except each box both readings place within `agree` staff spaces of
    each other (every edge) and more than `differ` spaces from the pipeline's: that one becomes
    the mean of the two readings. Readings with another box count than the pipeline's change
    nothing."""
    if not (len(pipeline) == len(first) == len(second)):
        return list(pipeline)
    merged: Edges = []
    for ours, a, b in zip(pipeline, first, second, strict=True):
        together = max(abs(a[0] - b[0]), abs(a[1] - b[1])) <= agree * space
        mean = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        away = max(abs(mean[0] - ours[0]), abs(mean[1] - ours[1])) > differ * space
        merged.append(mean if together and away else ours)
    return merged


def replace_on_count_vote(
    pipeline: Edges, first: Edges, second: Edges, voters: Sequence[Edges] = ()
) -> Edges:
    """The pipeline's line, except when both readings (and every voter, who votes on the count
    only) hold the same number of boxes and it is not the pipeline's: then the mean of the two
    readings, box by box."""
    counts = {len(first), len(second), *(len(v) for v in voters)}
    if len(counts) != 1 or len(first) == len(pipeline) or not first:
        return list(pipeline)
    return [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(first, second, strict=True)]


def compose_count(ours: Edges, voted: Edges, space: float, keep: float = KEEP_SPACES) -> Edges:
    """The readings' boxes (`voted`, left to right) with our edges kept where they agree.

    A bar line the readings place within `keep` staff spaces of one of our interior bar lines is
    ours, the nearest of them; boxes that touched in `voted` keep touching, and edges that did not
    are each treated on their own. The first box starts at our line start when the readings' lies
    within START_KEEP_SPACES of it, the last ends at our line end when the readings' lies within
    `keep` (ours may run on to a courtesy signature that is no bar). A box left with no width by
    this keeps the readings' edges, and so do its neighbours' edges next to it. `voted` may also be
    a whole line of as many boxes as ours (a line proposal), composed the same way.
    """
    limit = keep * space
    interior = [right for _, right in ours[:-1]] + [left for left, _ in ours[1:]]

    def nearest(x: float) -> float | None:
        best = min(interior, key=lambda bar_line: abs(bar_line - x), default=None)
        return best if best is not None and abs(best - x) <= limit else None

    composed = [[left, right] for left, right in voted]
    for i in range(len(voted) - 1):
        right, left = voted[i][1], voted[i + 1][0]
        if abs(right - left) <= SAME_PX:
            bar_line = nearest((right + left) / 2)
            if bar_line is not None:
                composed[i][1] = composed[i + 1][0] = bar_line
        else:
            for box, side, edge in ((i, 1, right), (i + 1, 0, left)):
                bar_line = nearest(edge)
                composed[box][side] = edge if bar_line is None else bar_line
    if abs(voted[0][0] - ours[0][0]) <= START_KEEP_SPACES * space:
        composed[0][0] = ours[0][0]
    if abs(voted[-1][1] - ours[-1][1]) <= limit:
        composed[-1][1] = ours[-1][1]
    while True:
        empty = next((i for i, (left, right) in enumerate(composed) if right <= left), None)
        if empty is None:
            return [(left, right) for left, right in composed]
        composed[empty] = list(voted[empty])
        if empty > 0:
            composed[empty - 1][1] = voted[empty - 1][1]
        if empty < len(voted) - 1:
            composed[empty + 1][0] = voted[empty + 1][0]


# ---------------------------------------------------------------- the recipe and the result


@dataclass(frozen=True)
class Recipe:
    """How proposals are judged and applied (one frozen value, chosen at the gate of the plan)."""

    judge_model: str | None = "claude-sonnet-5-5"  # None: no judge, every proposal accepted
    judge_effort: str = "high"
    edge_wise: bool = False  # a move changes only the edge that is over the limit
    snap: bool = True  # a moved edge takes the neighbour's touching edge with it
    apply_moves: bool = True  # False: an accepted move becomes a flag with a suggested edge
    opus_vote: bool = True  # False: no Opus is asked; two Haiku readings alone propose a count
    line_moves: bool = False  # True: a line's two or more moves are one proposal, judged whole
    lone_moves: Literal["judge", "drop"] = "judge"  # one move on a line: judged in zoom or ignored
    # a count proposal keeps our line start, line end and any bar line the readings agree with
    keep_our_edges: bool = False
    # a line proposal is composed the same way before the judge sees it (what still differs from
    # ours is what moves; none left: no proposal, one left: a lone move)
    keep_lines: bool = False
    keep_spaces: float = KEEP_SPACES  # within this many staff spaces an edge is ours


# Frozen at the gate on the dev set, Los Banditos (docs/READER_JUDGE_TEST.md). Opus is worth more as
# the judge than as a third reader: it accepted all 10 right count changes and all 8 shifted lines
# and refused all 5 wrong count changes, at a quarter of the cost. A lone move is dropped, because
# 9 of the 11 that mattered were reader mistakes. A proposal keeps our edges where they agree with
# the readings: this came after the first hold-out run, whose Opus notes said "the right bars, but
# its first box starts at the clef", so the pieces that showed it are no clean test of it.
RECIPE = Recipe(
    judge_model=OPUS,
    judge_effort="medium",
    opus_vote=False,
    line_moves=True,
    lone_moves="drop",
    keep_our_edges=True,
    keep_lines=True,
    keep_spaces=1.5,
)


@dataclass(frozen=True)
class LineChange:
    """One line whose bar count changed, for the structure."""

    old_first: int  # the line's bars in the first read's numbers
    old_last: int
    new_bars: int  # how many bars the line holds now
    # (offset from the line's first bar, length) of each multi-rest on the new line
    rest_runs: list[tuple[int, int]]


@dataclass(frozen=True)
class ReadAgain:
    boxes: list[BarBox]
    flags: list[BoxFlag]
    changes: list[LineChange]
    warnings: list[str]
    cost_usd: float
    log: list[dict[str, Any]]  # one entry per proposal, for the evaluation and the job log


# ---------------------------------------------------------------- readings to proposals

Span = tuple[float, float, int]  # left and right as page x, and the bars the box holds


def _spans(answer: ReaderAnswer, crop: Crop) -> list[Span]:
    """The reading's boxes as page x, left to right; empty boxes dropped."""
    x0, _, x1, _ = crop
    spans = [(x0 + b.left * (x1 - x0), x0 + b.right * (x1 - x0), b.bars) for b in answer.boxes]
    return sorted(s for s in spans if s[1] > s[0])


def edges_of(answer: ReaderAnswer, crop: Crop) -> Edges:
    """A reading's boxes as page x edges (fractions of the crop's width), left to right."""
    return [(left, right) for left, right, _ in _spans(answer, crop)]


@dataclass
class _Proposal:
    kind: Literal["count", "move", "line"]
    line: int  # index of the line
    box: int | None  # a move: index of the place in the line
    ours: Edges  # a count or a line: the line's boxes; a move: the one box
    proposed: Edges
    bars: list[int]  # a count: the bars each new box holds
    letter: str  # which picture of the judge's request the proposal is: "A" or "B"
    boxes: list[int] = field(default_factory=list)  # a move or a line: the places that move
    dropped: str | None = None  # why it cannot be applied, when it cannot
    ignored: bool = False  # dropped by the recipe's choice, not because something is wrong
    reply: JudgeReply | None = None
    error: str | None = None  # why the judge could not say
    accepted: bool = False
    applied: bool = False
    applied_boxes: list[int] = field(default_factory=list)  # the moved places that were applied


def _edges_of_line(line: Line) -> Edges:
    return [(p.x, p.right) for p in line.places]


def _fits(left: float, right: float, width: float) -> bool:
    return right > left and left >= 0 and right <= width


def _bars_of_new_boxes(
    line: Line, proposed: Edges, first: list[Span], second: list[Span]
) -> list[int]:
    """The bars each new box holds: those of an old multi-rest place whose middle lies inside it,
    else the number both Haiku readings give it, else one."""
    claimed: set[int] = set()
    bars: list[int] = []
    for i, (left, right) in enumerate(proposed):
        held = None
        for k, place in enumerate(line.places):
            middle = place.x + place.w / 2
            if len(place.bars) > 1 and k not in claimed and left <= middle <= right:
                claimed.add(k)
                held = len(place.bars)
                break
        if held is None:
            held = first[i][2] if first[i][2] == second[i][2] else 1
        bars.append(max(1, held))
    return bars


def _letter_of(line: Line) -> str:
    """The proposal is B on a line whose first bar is even, else A, so position tells nothing."""
    return "B" if line.places[0].bars[0] % 2 == 0 else "A"


def _wanted(
    ours: tuple[float, float], mean: tuple[float, float], space: float, recipe: Recipe
) -> tuple[float, float]:
    """A move's edges: the readings' mean, or with `edge_wise` only the edge over the limit."""
    if not recipe.edge_wise:
        return mean
    limit = DIFFER_SPACES * space
    return (
        mean[0] if abs(mean[0] - ours[0]) > limit else ours[0],
        mean[1] if abs(mean[1] - ours[1]) > limit else ours[1],
    )


NOT_FIT = "The new box did not fit the page."
LONE_MOVE = "A lone move on its line, ignored by the recipe."


def _proposals_for(
    index: int,
    line: Line,
    crop: Crop,
    page_width: float,
    readings: list[ReaderReply | None],
    recipe: Recipe,
) -> list[_Proposal]:
    """What the readings of one line propose: a count (the readings that vote hold the same
    number of boxes and it is not ours) or, otherwise, the moves of the boxes both Haiku readings
    agree on. Without the Opus vote only the two Haiku readings vote on the count."""
    one, two, opus = readings
    if one is None or two is None:
        return []
    spans_one, spans_two = _spans(one.answer, crop), _spans(two.answer, crop)
    first = [(left, right) for left, right, _ in spans_one]
    second = [(left, right) for left, right, _ in spans_two]
    ours = _edges_of_line(line)
    letter = _letter_of(line)
    if not recipe.opus_vote:
        voted = replace_on_count_vote(ours, first, second)
    elif opus is not None:
        voted = replace_on_count_vote(ours, first, second, voters=[edges_of(opus.answer, crop)])
    else:
        voted = ours  # an Opus reading is missing: no count proposal on this line
    if len(voted) != len(ours):
        if recipe.keep_our_edges:
            voted = compose_count(ours, voted, staff_space(line.places[0]), recipe.keep_spaces)
        bars = _bars_of_new_boxes(line, voted, spans_one, spans_two)
        proposal = _Proposal("count", index, None, ours, voted, bars, letter)
        if not all(_fits(left, right, page_width) for left, right in voted):
            proposal.dropped = "The new boxes did not fit the page."
        return [proposal]
    space = staff_space(line.places[0])
    merged = merge_by_agreement(ours, first, second, space)
    moves = {
        box: _wanted(mine, mean, space, recipe)
        for box, (mine, mean) in enumerate(zip(ours, merged, strict=True))
        if mean != mine
    }
    return _proposals_of_moves(index, ours, moves, page_width, letter, recipe, space)


def _move_of(
    index: int, ours: Edges, box: int, edges: tuple[float, float], letter: str
) -> _Proposal:
    return _Proposal("move", index, box, [ours[box]], [edges], [], letter, boxes=[box])


def _proposals_of_moves(
    index: int,
    ours: Edges,
    moves: dict[int, tuple[float, float]],
    page_width: float,
    letter: str,
    recipe: Recipe,
    space: float,
) -> list[_Proposal]:
    """One zoom proposal for each move, except that a line with one move may have it ignored
    (`lone_moves="drop"`) and a line with two or more may have them judged as one whole line
    (`line_moves`). A move that would leave a box empty or off the page is dropped on its own."""
    if not moves:
        return []
    if len(moves) == 1 and recipe.lone_moves == "drop":
        [(box, edges)] = moves.items()
        lone = _move_of(index, ours, box, edges, letter)
        lone.dropped, lone.ignored = LONE_MOVE, True
        return [lone]
    if not (recipe.line_moves and len(moves) >= 2):
        proposals = [_move_of(index, ours, box, edges, letter) for box, edges in moves.items()]
        for proposal in proposals:
            if not _fits(*proposal.proposed[0], page_width):
                proposal.dropped = NOT_FIT
        return proposals
    final, lost = _settle(ours, moves, recipe.snap, page_width)
    proposals = [_move_of(index, ours, box, moves[box], letter) for box in sorted(lost)]
    for proposal in proposals:
        proposal.dropped = NOT_FIT
    kept = [box for box in moves if box not in lost]
    if kept and recipe.keep_lines:
        proposals += _composed_line(index, ours, final, kept, page_width, letter, recipe, space)
    elif kept:
        whole = _Proposal("line", index, None, ours, final, [], letter, boxes=kept)
        proposals.append(whole)
    return proposals


COMPOSED_AWAY = "Every edge it moved is one of ours, kept by the recipe."


def _composed_line(
    index: int,
    ours: Edges,
    final: Edges,
    kept: list[int],
    page_width: float,
    letter: str,
    recipe: Recipe,
    space: float,
) -> list[_Proposal]:
    """The whole-line proposal `final` composed against our line (compose_count), so that an edge
    of ours the readings only drifted from stays ours. What still differs from ours is what
    moves: nothing, and there is no proposal (it is logged, as the readings made it, and not
    judged); one box, and it is a lone move, which `lone_moves` decides; else a line proposal
    drawn from the composed edges."""
    composed = compose_count(ours, final, space, recipe.keep_spaces)
    moved = [
        k
        for k, (mine, new) in enumerate(zip(ours, composed, strict=True))
        if max(abs(mine[0] - new[0]), abs(mine[1] - new[1])) > MOVED_EPS
    ]
    if not moved:
        whole = _Proposal("line", index, None, ours, final, [], letter, boxes=kept)
        whole.dropped, whole.ignored = COMPOSED_AWAY, True
        return [whole]
    if len(moved) == 1:
        [box] = moved
        lone = _move_of(index, ours, box, composed[box], letter)
        if recipe.lone_moves == "drop":
            lone.dropped, lone.ignored = LONE_MOVE, True
        elif not _fits(*composed[box], page_width):
            lone.dropped = NOT_FIT
        return [lone]
    return [_Proposal("line", index, None, ours, composed, [], letter, boxes=moved)]


# ---------------------------------------------------------------- the judge's pictures


def _line_of(line: Line, edges: Edges, bars: list[int]) -> Line:
    """The line as `edges` would draw it, on the first place's rows."""
    first = line.places[0]
    places = [
        Place(line.page, left, first.y, right - left, first.h, [bar])
        for (left, right), bar in zip(edges, bars, strict=True)
    ]
    return Line(line.page, places)


def _count_pictures(page: Image.Image, line: Line, proposal: _Proposal) -> list[bytes]:
    crop = crop_of(line, page.size)
    clean = _png(draw_line(page, line, crop, boxes=False))
    ours = _png(draw_line(page, line, crop))
    theirs_line = _line_of(line, proposal.proposed, list(range(len(proposal.proposed))))
    theirs = _png(draw_line(page, theirs_line, crop))
    return [clean, theirs, ours] if proposal.letter == "A" else [clean, ours, theirs]


def _move_pictures(page: Image.Image, line: Line, proposal: _Proposal) -> list[bytes]:
    """The clean picture and the box as ours and as proposed, each cut to the box plus
    MOVE_MARGIN_SPACES staff spaces on each side and scaled up by a whole number."""
    assert proposal.box is not None
    place = line.places[proposal.box]
    (ours_left, ours_right), (new_left, new_right) = proposal.ours[0], proposal.proposed[0]
    margin = MOVE_MARGIN_SPACES * staff_space(place)
    x0 = max(0, round(min(ours_left, new_left) - margin))
    x1 = min(page.width, round(max(ours_right, new_right) + margin))
    _, y0, _, y1 = crop_of(line, page.size)
    factor = max(1, min(MOVE_MAX_SCALE, round(MOVE_TARGET_WIDTH / (x1 - x0))))
    size = ((x1 - x0) * factor, (y1 - y0) * factor)
    piece = page.convert("RGB").crop((x0, y0, x1, y1)).resize(size, Image.Resampling.LANCZOS)
    crop = (0, 0, size[0], size[1])

    def drawn(left: float, right: float, *, boxes: bool = True) -> bytes:
        box = Place(
            line.page, (left - x0) * factor, (place.y - y0) * factor,
            (right - left) * factor, place.h * factor, place.bars,
        )  # fmt: skip
        return _png(draw_line(piece, Line(line.page, [box]), crop, boxes=boxes))

    clean = drawn(ours_left, ours_right, boxes=False)
    ours, theirs = drawn(ours_left, ours_right), drawn(new_left, new_right)
    return [clean, theirs, ours] if proposal.letter == "A" else [clean, ours, theirs]


def _judge_request(
    page: Image.Image, line: Line, proposal: _Proposal, recipe: Recipe
) -> JudgeRequest:
    assert recipe.judge_model is not None
    if proposal.kind in ("count", "line"):
        pictures, prompt = _count_pictures(page, line, proposal), COUNT_PROMPT
    else:
        pictures = _move_pictures(page, line, proposal)
        place = MOVE_FIRST if proposal.box == 0 else MOVE_NOT_FIRST
        prompt = MOVE_PROMPT.format(place=place)
    return JudgeRequest(recipe.judge_model, recipe.judge_effort, proposal.kind, pictures, prompt)


# ---------------------------------------------------------------- applying


def _final_edges(ours: Edges, moves: Mapping[int, tuple[float, float]], snap: bool) -> Edges:
    """The line's edges with the accepted moves in. With `snap`, two boxes that touched keep
    touching: a moved edge takes the other with it, two moved edges meet at their mean."""
    final = [list(edge) for edge in ours]
    for box, (left, right) in moves.items():
        final[box] = [left, right]
    if snap:
        for i in range(len(ours) - 1):
            if abs(ours[i][1] - ours[i + 1][0]) > SAME_PX:
                continue
            right_moved = abs(final[i][1] - ours[i][1]) > MOVED_EPS
            left_moved = abs(final[i + 1][0] - ours[i + 1][0]) > MOVED_EPS
            if right_moved and left_moved:
                final[i][1] = final[i + 1][0] = (final[i][1] + final[i + 1][0]) / 2
            elif right_moved:
                final[i + 1][0] = final[i][1]
            elif left_moved:
                final[i][1] = final[i + 1][0]
    return [(left, right) for left, right in final]


def _settle(
    ours: Edges, moves: dict[int, tuple[float, float]], snap: bool, width: float
) -> tuple[Edges, set[int]]:
    """The line's final edges, and the moves dropped because a box (a neighbour's too, through
    snapping) would end up empty or off the page."""
    active = dict(moves)
    dropped: set[int] = set()
    while True:
        final = _final_edges(ours, active, snap)
        bad = [k for k, edge in enumerate(final) if edge != ours[k] and not _fits(*edge, width)]
        if not bad:
            return final, dropped
        culprit = next((k for k in (bad[0], bad[0] - 1, bad[0] + 1) if k in active), None)
        if culprit is None:  # cannot happen: only a move changes an edge
            return list(ours), set(active)
        del active[culprit]
        dropped.add(culprit)


def _verdict_of(
    ours: tuple[float, float], new: tuple[float, float], space: float, first: bool
) -> FlagVerdict:
    """The flag that stands for a move the fallback does not apply, by the edge over the limit."""
    limit = DIFFER_SPACES * space
    left, right = new[0] - ours[0], new[1] - ours[1]
    if left < -limit:
        return "starts_late"
    if abs(right) > limit:
        return "ends_early" if right > 0 else "ends_late"
    return "signature_inside" if first else "ends_late"


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


@dataclass
class _Built:
    """The boxes, flags and changes made so far, and how far the bar numbers have shifted."""

    boxes: list[BarBox]
    flags: list[BoxFlag]
    changes: list[LineChange]
    shift: int = 0


def _apply_count(line: Line, proposal: _Proposal, built: _Built) -> None:
    """Replace the line's boxes by the proposed ones, renumbered; the lines after it shift."""
    first = line.places[0]
    old_first = first.bars[0]
    bar = old_first + built.shift
    offset = 0
    runs: list[tuple[int, int]] = []
    for (left, right), held in zip(proposal.proposed, proposal.bars, strict=True):
        for _ in range(held):
            box = BarBox(
                bar=bar, pageIndex=first.page, x=left, y=first.y, w=right - left, h=first.h
            )
            built.boxes.append(box)
            bar += 1
        if held > 1:
            runs.append((offset, held))
        offset += held
    old_count = sum(len(place.bars) for place in line.places)
    built.changes.append(LineChange(old_first, line.places[-1].bars[-1], offset, runs))
    note = (
        f"Advanced Reading read {_plural(offset, 'bar')} on this line; "
        f"the first read had {old_count}."
    )
    built.flags.append(BoxFlag(bar=old_first + built.shift, verdict="read_count", note=note))
    built.shift += offset - old_count
    proposal.applied = True


# What a flag says: our sentence only. The judge's words, which speak of pictures A and B the user
# never sees, stay in the log for the evaluation.
MOVED_NOTE = "Advanced Reading moved this bar."
PLACED_NOTE = "Advanced Reading placed this bar elsewhere."


def _edges_for(proposal: _Proposal, box: int) -> tuple[float, float]:
    """Where an accepted move or line proposal puts one of its boxes."""
    return proposal.proposed[0] if proposal.kind == "move" else proposal.proposed[box]


def _apply_moves(
    line: Line,
    owners: dict[int, _Proposal],
    by_bar: Mapping[int, BarBox],
    recipe: Recipe,
    width: float,
    built: _Built,
) -> list[str]:
    """Keep the line's boxes, with the moves in (or, with `apply_moves` off, flags for them).
    `owners` maps each place that moves to the accepted proposal it belongs to (a move, or a line
    proposal that owns several places). Returns the reasons of the moves dropped; a proposal
    whose moves are all dropped is itself dropped, one with some left stands."""
    ours = _edges_of_line(line)
    final, dropped = ours, set[int]()
    if recipe.apply_moves and owners:
        wanted = {box: _edges_for(proposal, box) for box, proposal in owners.items()}
        final, dropped = _settle(ours, wanted, recipe.snap, width)
    reasons: list[str] = []
    space = staff_space(line.places[0])
    for k, place in enumerate(line.places):
        changed = final[k] != ours[k]
        for bar in place.bars:
            box = by_bar[bar]
            update: dict[str, Any] = {"bar": bar + built.shift} if built.shift else {}
            if changed:
                update |= {"x": final[k][0], "w": final[k][1] - final[k][0]}
            built.boxes.append(box.model_copy(update=update) if update else box)
        proposal = owners.get(k)
        if proposal is None:
            continue
        if k in dropped:
            reasons.append(NOT_FIT)
        elif recipe.apply_moves:
            proposal.applied_boxes.append(k)
            flag = BoxFlag(
                bar=place.bars[0] + built.shift,
                verdict="read_moved",
                note=MOVED_NOTE,
                previous=BoxEdges(x=place.x, w=place.w),
            )
            built.flags.append(flag)
        else:
            new = _edges_for(proposal, k)
            left_over = abs(new[0] - ours[k][0]) > DIFFER_SPACES * space
            built.flags.append(
                BoxFlag(
                    bar=place.bars[0] + built.shift,
                    verdict=_verdict_of(ours[k], new, space, k == 0),
                    note=PLACED_NOTE,
                    suggestedX=round(new[0], 1) if k == 0 and left_over else None,
                )
            )
    for proposal in {id(p): p for p in owners.values()}.values():
        proposal.applied = bool(proposal.applied_boxes)
        if recipe.apply_moves and not proposal.applied:
            proposal.dropped = NOT_FIT
    return reasons


class _Problems:
    """What to tell the user: one sentence for each lead and reason, with the lines it hit."""

    def __init__(self) -> None:
        self._found: dict[tuple[str, str], set[int]] = {}

    def add(self, lead: str, reason: str, line_number: int) -> None:
        self._found.setdefault((lead, reason), set()).add(line_number)

    def sentences(self) -> list[str]:
        ordered = sorted(self._found.items(), key=lambda item: min(item[1]))
        return [
            f"{lead} line{'s' if len(numbers) > 1 else ''} {_list_of(sorted(numbers))}. {reason}"
            for (lead, reason), numbers in ordered
        ]


LEAD_READ = "Advanced Reading did not get every reading of"
LEAD_JUDGE = "Advanced Reading could not judge"
LEAD_KEPT = "Advanced Reading kept the first read of"
LEAD_SKIPPED = "Advanced Reading skipped"


def read_again(
    boxes: Sequence[BarBox],
    page_images: Mapping[int, Image.Image],
    reader: LineReader,
    judge: ProposalJudge | None,
    *,
    recipe: Recipe = RECIPE,
    workers: int = WORKERS,
) -> ReadAgain:
    """Read each line of a part's boxes again (Haiku twice, Opus once), turn the readings into
    proposals, ask the judge about each, and apply the accepted ones.

    A line whose page is missing, or whose reading or judgement fails, keeps its boxes and adds a
    warning; nothing here fails the part. Lines are handled at once but the boxes, flags,
    warnings and log come in line order.
    """
    if recipe.judge_model is not None and judge is None:
        raise ReadAgainError("Advanced Reading needs a judge for this recipe.")
    lines = lines_of(places_of(boxes))
    problems = _Problems()
    cost = 0.0

    crops: dict[int, Crop] = {}
    jobs: list[tuple[int, int, ReaderRequest]] = []
    for index, line in enumerate(lines):
        page = page_images.get(line.page)
        if page is None:
            problems.add(LEAD_SKIPPED, f"Page {line.page + 1} has no picture.", index + 1)
            continue
        crops[index] = crop_of(line, page.size)
        picture = _png(draw_line(page, line, crops[index], boxes=False))
        for slot, (model, effort, run) in enumerate(READER_RUNS):
            if model == OPUS and not recipe.opus_vote:
                continue
            max_tokens = MAX_TOKENS.get(model, HAIKU_MAX_TOKENS)
            jobs.append(
                (index, slot, ReaderRequest(model, effort, run, picture, READER_PROMPT, max_tokens))
            )

    def read(job: tuple[int, int, ReaderRequest]) -> tuple[ReaderReply | None, str | None]:
        try:
            return reader.read(job[2]), None
        except ReadAgainError as error:
            return None, str(error)

    with ThreadPoolExecutor(max(1, min(workers, len(jobs) or 1))) as pool:
        outcomes = list(pool.map(read, jobs))
    readings: dict[int, list[ReaderReply | None]] = {i: [None] * len(READER_RUNS) for i in crops}
    for (index, slot, _), (reply, error) in zip(jobs, outcomes, strict=True):
        readings[index][slot] = reply
        cost += reply.cost_usd if reply else 0.0
        if error is not None:
            problems.add(LEAD_READ, error, index + 1)

    proposals: list[_Proposal] = []
    for index in sorted(readings):
        line, width = lines[index], page_images[lines[index].page].width
        for proposal in _proposals_for(index, line, crops[index], width, readings[index], recipe):
            if proposal.dropped is not None and not proposal.ignored:
                problems.add(LEAD_KEPT, proposal.dropped, index + 1)
            proposals.append(proposal)

    askable = [p for p in proposals if p.dropped is None]
    if recipe.judge_model is None or judge is None:
        for proposal in askable:
            proposal.accepted = True  # no judge: the 2026-11-04 method, every proposal stands
    else:

        def ask(proposal: _Proposal) -> tuple[JudgeReply | None, str | None]:
            line = lines[proposal.line]
            try:
                request = _judge_request(page_images[line.page], line, proposal, recipe)
                return judge.judge(request), None
            except ReadAgainError as error:
                return None, str(error)

        with ThreadPoolExecutor(max(1, min(workers, len(askable) or 1))) as pool:
            answers = list(pool.map(ask, askable))
        for proposal, (reply, error) in zip(askable, answers, strict=True):
            proposal.reply, proposal.error = reply, error
            proposal.accepted = reply is not None and reply.answer.choice == proposal.letter
            cost += reply.cost_usd if reply else 0.0
            if error is not None:
                problems.add(LEAD_JUDGE, error, proposal.line + 1)

    by_bar = {box.bar: box for box in boxes}
    built = _Built([], [], [])
    for index, line in enumerate(lines):
        accepted = [p for p in proposals if p.line == index and p.accepted]
        count = next((p for p in accepted if p.kind == "count"), None)
        if count is not None:
            _apply_count(line, count, built)
            continue
        owners: dict[int, _Proposal] = {}
        for proposal in accepted:
            if proposal.kind == "move" and proposal.box is not None:
                owners[proposal.box] = proposal
            elif proposal.kind == "line":
                owners.update({box: proposal for box in proposal.boxes})
        width = page_images[line.page].width if line.page in page_images else 0.0
        for reason in _apply_moves(line, owners, by_bar, recipe, width, built):
            problems.add(LEAD_KEPT, reason, index + 1)
    built.boxes.sort(key=lambda box: box.bar)
    built.flags.sort(key=lambda flag: flag.bar)
    log = [_log_entry(proposal, lines) for proposal in proposals]
    return ReadAgain(built.boxes, built.flags, built.changes, problems.sentences(), cost, log)


def _log_entry(proposal: _Proposal, lines: list[Line]) -> dict[str, Any]:
    """One proposal for the evaluation and the job log. `changed_boxes` are the boxes (from 1) the
    proposal would change, a neighbour dragged along included; `applied_boxes` those of the boxes
    it moves that were applied."""
    line = lines[proposal.line]
    changed: list[int] | None = None
    if proposal.kind == "move":
        changed = [box + 1 for box in proposal.boxes]
    elif proposal.kind == "line":
        pairs = zip(proposal.ours, proposal.proposed, strict=True)
        differ = [
            k
            for k, (mine, new) in enumerate(pairs)
            if max(abs(mine[0] - new[0]), abs(mine[1] - new[1])) > MOVED_EPS
        ]
        changed = [k + 1 for k in differ]
    places = line.places if changed is None else [line.places[number - 1] for number in changed]
    reply = proposal.reply
    return {
        "line": proposal.line + 1,
        "kind": proposal.kind,
        "bars": [bar for place in places for bar in place.bars],
        "box": None if proposal.box is None else proposal.box + 1,
        "changed_boxes": changed,
        "applied_boxes": None if changed is None else [k + 1 for k in proposal.applied_boxes],
        "proposal": proposal.letter,
        "choice": reply.answer.choice if reply else None,
        "note": reply.answer.note if reply else "",
        "accepted": proposal.accepted,
        "applied": proposal.applied,
        "dropped": proposal.dropped,
        "error": proposal.error,
        "ours": list(proposal.ours),
        "proposed": list(proposal.proposed),
    }


# ---------------------------------------------------------------- the flags


def merge_flags(read: Sequence[BoxFlag], check: Sequence[BoxFlag]) -> list[BoxFlag]:
    """The flags of the read and of the box check, one for each bar. A bar with both keeps the
    check's verdict and suggested edge, the read's note first and then the check's, and the edges
    to put back from the read."""
    read_by: dict[int, BoxFlag] = {}
    for flag in read:
        read_by.setdefault(flag.bar, flag)
    check_by: dict[int, BoxFlag] = {}
    for flag in check:
        check_by.setdefault(flag.bar, flag)
    merged: list[BoxFlag] = []
    for bar in sorted(read_by.keys() | check_by.keys()):
        first, second = read_by.get(bar), check_by.get(bar)
        if first is not None and second is not None:
            notes = [note for note in (first.note.strip(), second.note.strip()) if note]
            flag = BoxFlag(
                bar=bar,
                verdict=second.verdict,
                note=" ".join(notes),
                suggestedX=second.suggestedX,
                previous=first.previous,
            )
        else:
            flag = first if first is not None else check_by[bar]
        merged.append(flag)
    return merged
