"""The Advanced Reading tick as the pipeline runs it (the plan of 2026-11-07, task 3):
BoxCheckingOmr with readers and a judge, the structure after a count change, the flags the read
and the check leave, and the online and local plumbing around it. Fakes and synthetic pages only:
no model is asked and nothing opens a socket."""

import io
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest
from PIL import Image, ImageDraw

import app.pipeline.real_stages as rs
from app.db import InMemoryDatabase
from app.deps import Services
from app.jobs import InMemoryJobStore
from app.pipeline.bar_boxes import BoxAudit
from app.pipeline.box_check import (
    BoxAnswer,
    JudgeAnswer,
    LineAnswer,
    _png,
    crop_of,
    draw_line,
    lines_of,
    places_of,
)
from app.pipeline.box_check import (
    JudgeRequest as CheckRequest,
)
from app.pipeline.consensus import StructureAudit
from app.pipeline.models import BarBox, BarMark, JobKind, JobStatus, MeterChange, PlayOrderRow
from app.pipeline.orchestrator import process_piece
from app.pipeline.play_order import MarkKind, StructureMark, propose_play_order
from app.pipeline.read_again import (
    FakeLineReader,
    FakeProposalJudge,
    JudgeChoice,
    JudgeReply,
    JudgeRequest,
    ReadAgainError,
    ReaderAnswer,
    ReaderBox,
    ReaderReply,
    ReaderRequest,
)
from app.pipeline.real_stages import (
    NOTATION_SKIPPED,
    AdvancedReaders,
    BoxCheckingOmr,
    TickedBoxCheck,
    advanced_readers,
    with_box_check,
)
from app.pipeline.run_folder import BarBox as RunBarBox
from app.pipeline.stages import PageImage, RenderedPart, default_stages
from app.pipeline.structure import PieceStructure
from app.pipeline.structure_read import SHORT_BAR_NOTE, UNSURE_LINE, PartAudits, PartRead
from app.settings import Settings
from app.storage import InMemoryStorage
from tests.test_box_check_stage import IMAGE_PATH, PDF_PATH, pdf, piece_db
from tests.test_real_stages import OWNER, PART, PIECE, World, tools

PAGE_W, PAGE_H = 800, 400
H = 75.0  # a box is five spaces high: the staff and half a space above and below
SPACE = 15.0
READ_COST, JUDGE_COST, CHECK_COST, INNER_COST = 0.01, 0.02, 0.008, 0.01

FOUR = [(50, 250), (250, 450), (450, 650), (650, 750)]
FIVE = [(50, 200), (200, 350), (350, 500), (500, 650), (650, 750)]
SECOND = [(50, 300), (300, 550), (550, 750)]


# ---------------------------------------------------------------- a part and its page


@dataclass
class Spec:
    """One line of the part: where it is, its bars and boxes as the first read made them, and what
    both Haiku readings read of it."""

    y: float
    first_bar: int
    edges: list[tuple[float, float]]
    reads: list[tuple[float, float]]
    reads_bars: list[int] | None = None
    bars: list[int] | None = None  # the bars each of our boxes holds (more than 1: a multi-rest)


def boxes_of(specs: list[Spec]) -> list[BarBox]:
    boxes: list[BarBox] = []
    for spec in specs:
        bar = spec.first_bar
        for i, (left, right) in enumerate(spec.edges):
            for _ in range(1 if spec.bars is None else spec.bars[i]):
                boxes.append(BarBox(bar=bar, page_index=0, x=left, y=spec.y, w=right - left, h=H))
                bar += 1
    return boxes


def run_boxes(boxes: list[BarBox]) -> list[RunBarBox]:
    return [RunBarBox(bar=b.bar, pageIndex=b.page_index, x=b.x, y=b.y, w=b.w, h=b.h) for b in boxes]


def page_image(tops: tuple[int, ...]) -> Image.Image:
    """White, five staff lines at each top, and a black block at a different place in each line so
    that no two lines have the same picture."""
    image = Image.new("L", (PAGE_W, PAGE_H), 255)
    pen = ImageDraw.Draw(image)
    for n, top in enumerate(tops):
        for row in range(5):
            y = top + 7 + row * 15
            pen.line((0, y, PAGE_W, y), fill=0, width=1)
        x = 60 + 120 * n
        pen.rectangle((x, top + 15, x + 29, top + 55), fill=0)
    return image


def png_of(image: Image.Image) -> bytes:
    data = io.BytesIO()
    image.save(data, format="PNG")
    return data.getvalue()


def structure(bar_count: int, **fields: Any) -> PieceStructure:
    marks = fields.pop("marks", [])
    rows = fields.pop("play_order", None) or propose_play_order(marks, bar_count).rows
    return PieceStructure(
        bar_count=bar_count,
        meters=fields.pop("meters", [MeterChange(numerator=4, denominator=4, from_bar=1)]),
        marks=marks,
        bar_marks=fields.pop("bar_marks", []),
        tempo_text=fields.pop("tempo_text", {}),
        part_name=None,
        play_order=rows,
        warnings=["the structure's own warning"],
        **fields,
    )


def part_read(
    specs: list[Spec], bar_count: int, warnings: list[str] | None = None, **fields: Any
) -> PartRead:
    audits = PartAudits(StructureAudit([]), BoxAudit())
    return PartRead(
        boxes_of(specs),
        structure(bar_count, **fields),
        audits,
        INNER_COST,
        ["old"] if warnings is None else warnings,
        None,
    )


class Fixed:
    """An OmrStage that gives the part it was given."""

    def __init__(self, part: PartRead) -> None:
        self.part = part

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        return self.part


class Scene:
    """The stored PDF and page of one part, and readers that read what the specs say."""

    def __init__(
        self,
        specs: list[Spec],
        tops: tuple[int, ...],
        pdf_bytes: bytes | None = None,
    ) -> None:
        self.specs = specs
        self.storage = InMemoryStorage()
        self.storage.upload(PDF_PATH, pdf_bytes or pdf(), "application/pdf")
        image = page_image(tops)
        self.storage.upload(IMAGE_PATH, png_of(image), "image/png")
        self.score_file = {"id": "flute", "piece_id": "piece", "storage_path": PDF_PATH}
        self.rendered = RenderedPart([PageImage(0, PAGE_W, PAGE_H, IMAGE_PATH)], [0.0], [200])
        self.reads: dict[bytes, tuple[list[tuple[float, float]], list[int] | None]] = {}
        self.ours: set[bytes] = set()
        # the stage opens the stored PNG, so the pictures are made from the same pixels
        stored = Image.open(io.BytesIO(png_of(image)))
        stored.load()
        for line, spec in zip(lines_of(places_of(run_boxes(boxes_of(specs)))), specs, strict=True):
            crop = crop_of(line, stored.size)
            self.reads[_png(draw_line(stored, line, crop, boxes=False))] = (
                spec.reads,
                spec.reads_bars,
            )
            self.ours.add(_png(draw_line(stored, line, crop)))
        self.reader = FakeLineReader(
            {
                (model, run): self._reading
                for model, run in (("claude-haiku-5-5", 1), ("claude-haiku-5-5", 2))
            }
        )
        self.judge = FakeProposalJudge(self._choice)

    def _reading(self, request: ReaderRequest) -> ReaderReply:
        edges, bars = self.reads[request.picture]
        boxes = [
            ReaderBox(left=a / PAGE_W, right=b / PAGE_W, bars=1 if bars is None else bars[i])
            for i, (a, b) in enumerate(edges)
        ]
        return ReaderReply(ReaderAnswer(boxes=boxes), READ_COST)

    def _choice(self, request: JudgeRequest) -> JudgeReply:
        """The picture that is not ours (a count or a line proposal is shown whole)."""
        proposal = "B" if request.pictures[1] in self.ours else "A"
        return JudgeReply(JudgeChoice(choice=proposal, note="the bars are right"), JUDGE_COST)

    @property
    def advanced(self) -> AdvancedReaders:
        return AdvancedReaders(self.reader, self.judge)


class ByCount:
    """The box check's judge: every box of a line of n boxes is ok, except the verdicts given."""

    def __init__(self, bad: dict[int, dict[int, str]] | None = None) -> None:
        self.bad = bad or {}
        self.calls: list[CheckRequest] = []

    def judge(self, request: CheckRequest) -> JudgeAnswer:
        self.calls.append(request)
        verdicts = self.bad.get(request.count, {})
        boxes = [
            BoxAnswer(box=n, verdict=verdicts.get(n, "ok"), note="seen")  # type: ignore[arg-type]
            for n in range(1, request.count + 1)
        ]
        return JudgeAnswer(LineAnswer(boxes=boxes, first_note_x=None), 4000, 300, 1.0, CHECK_COST)


def stage(scene: Scene, part: PartRead, judge: Any = None, advanced: bool = True) -> BoxCheckingOmr:
    return BoxCheckingOmr(
        Fixed(part),
        scene.storage,
        judge or ByCount(),
        {"flute"},
        piece_db(),
        scene.advanced if advanced else None,
    )


def numbers(boxes: list[BarBox]) -> list[tuple[int, float, float]]:
    return [(b.bar, round(b.x, 3), round(b.x + b.w, 3)) for b in boxes]


# A part of two lines: the first read found 4 boxes on line 1, the readers read 5.
TWO_LINES = [
    Spec(100.0, 1, FOUR, FIVE),
    Spec(250.0, 5, SECOND, SECOND),
]


# ---------------------------------------------------------------- a count change


def test_an_accepted_count_change_gives_new_boxes_a_new_structure_and_flags() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    first = part_read(
        TWO_LINES,
        7,
        bar_marks=[BarMark(bar=6, kind="fermata")],
        tempo_text={6: "rit."},
        marks=[StructureMark(kind=MarkKind.REPEAT_END, bar=7)],
    )
    checking = stage(scene, first, ByCount({3: {2: "ends_late"}}))

    read = checking.read(scene.score_file, scene.rendered)

    assert numbers(read.boxes) == [
        (1, 50, 200),
        (2, 200, 350),
        (3, 350, 500),
        (4, 500, 650),
        (5, 650, 750),
        (6, 50, 300),
        (7, 300, 550),
        (8, 550, 750),
    ]
    assert read.structure.bar_count == 8 == max(b.bar for b in read.boxes)
    assert [(m.bar, m.kind) for m in read.structure.bar_marks] == [(7, "fermata")]
    assert read.structure.tempo_text == {7: "rit."}
    assert [(m.kind, m.bar) for m in read.structure.marks] == [(MarkKind.REPEAT_END, 8)]
    assert [(r.start, r.end) for r in read.structure.play_order] == [(1, 8), (1, 8)]
    assert read.structure.warnings == ["the structure's own warning"]
    # the read's flag, and the check's on the final boxes (line 2 is now bars 6-8)
    assert [(f.bar, f.verdict) for f in checking.flags["flute"]] == [
        (1, "read_count"),
        (7, "ends_late"),
    ]
    assert read.warnings == ["old", "Advanced Reading changed 1 bar on 1 line."]
    # the inner read, two Haiku readings of each of the two lines, the judge, the check's two lines
    assert read.cost_usd == pytest.approx(INNER_COST + 4 * READ_COST + JUDGE_COST + 2 * CHECK_COST)


def test_the_box_check_looks_at_the_boxes_the_reading_made() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    check = ByCount()

    stage(scene, part_read(TWO_LINES, 7), check).read(scene.score_file, scene.rendered)

    assert sorted(call.count for call in check.calls) == [3, 5]  # line 1 has five boxes now


def test_a_read_flag_and_a_check_flag_on_one_bar_are_one_flag() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    checking = stage(scene, part_read(TWO_LINES, 7), ByCount({5: {1: "starts_late"}}))

    checking.read(scene.score_file, scene.rendered)

    [flag] = checking.flags["flute"]
    assert (flag.bar, flag.verdict) == (1, "starts_late")  # the check's verdict
    assert flag.note.startswith("Advanced Reading read 5 bars on this line;")
    assert flag.note.endswith("seen")


def test_a_judge_that_does_not_choose_the_proposal_leaves_the_read_as_it_was() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    scene.judge = FakeProposalJudge(
        lambda request: JudgeReply(JudgeChoice(choice="neither", note="no"), JUDGE_COST)
    )
    first = part_read(TWO_LINES, 7)
    checking = stage(scene, first)

    read = checking.read(scene.score_file, scene.rendered)

    assert read.boxes == first.boxes and read.structure is first.structure
    assert read.warnings == ["old"]  # nothing changed: nothing to tell
    assert checking.flags == {"flute": []}


def test_readings_that_agree_with_the_first_read_change_nothing_and_cost_their_calls() -> None:
    agreeing = [Spec(100.0, 1, FOUR, FOUR), Spec(250.0, 5, SECOND, SECOND)]
    scene = Scene(agreeing, (100, 250))
    first = part_read(agreeing, 7)

    read = stage(scene, first).read(scene.score_file, scene.rendered)

    assert read.boxes == first.boxes and read.structure is first.structure
    assert read.cost_usd == pytest.approx(INNER_COST + 4 * READ_COST + 2 * CHECK_COST)
    assert read.warnings == ["old"] and scene.judge.calls == []


def test_the_job_sentence_counts_bars_added_and_boxes_moved_over_the_lines_changed() -> None:
    specs = [
        Spec(100.0, 1, FOUR, FIVE),  # a bar more
        Spec(250.0, 5, SECOND, [(50, 300), (300, 500), (500, 750)]),  # two boxes meet 50 px earlier
    ]
    scene = Scene(specs, (100, 250))
    checking = stage(scene, part_read(specs, 7))

    read = checking.read(scene.score_file, scene.rendered)

    assert read.warnings == ["old", "Advanced Reading changed 3 bars on 2 lines."]
    assert [(f.bar, f.verdict) for f in checking.flags["flute"]] == [
        (1, "read_count"),
        (7, "read_moved"),
        (8, "read_moved"),
    ]


def test_a_line_that_gains_two_bars_counts_two() -> None:
    six = [(50, 150), (150, 250), (250, 350), (350, 450), (450, 650), (650, 750)]
    specs = [Spec(100.0, 1, FOUR, six), Spec(250.0, 5, SECOND, SECOND)]
    scene = Scene(specs, (100, 250))

    read = stage(scene, part_read(specs, 7)).read(scene.score_file, scene.rendered)

    assert read.warnings[-1] == "Advanced Reading changed 2 bars on 1 line."
    assert read.structure.bar_count == 9 == max(b.bar for b in read.boxes)


def test_the_warnings_of_the_first_read_follow_the_bars_the_reading_renumbered() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    first_read = [
        "old",
        "Line 2 starts with printed bar number 6, but the lines before it hold 4 bars; check it. "
        "Line 1 may be 1 bar short.",
        UNSURE_LINE.format(page=1, bar=5),
        SHORT_BAR_NOTE.format(bar=7, units=2),
    ]
    part = part_read(TWO_LINES, 7, first_read)

    read = stage(scene, part).read(scene.score_file, scene.rendered)

    # line 1 gained a bar: the printed-number warning describes counts that changed and goes; the
    # bars named after line 1 are one higher
    assert read.warnings == [
        "old",
        UNSURE_LINE.format(page=1, bar=6),
        SHORT_BAR_NOTE.format(bar=8, units=2),
        "Advanced Reading changed 1 bar on 1 line.",
    ]


def test_with_nothing_changed_the_warnings_of_the_first_read_are_all_kept() -> None:
    agreeing = [Spec(100.0, 1, FOUR, FOUR), Spec(250.0, 5, SECOND, SECOND)]
    scene = Scene(agreeing, (100, 250))
    first_read = [
        "Line 2 starts with printed bar number 6, but the lines before it hold 4 bars; check it.",
        UNSURE_LINE.format(page=1, bar=5),
    ]

    read = stage(scene, part_read(agreeing, 7, first_read)).read(scene.score_file, scene.rendered)

    assert read.warnings == first_read


def test_a_reading_that_cannot_run_leaves_the_warnings_of_the_first_read_as_they_were() -> None:
    scene = Scene(TWO_LINES, (100, 250))

    def crash(request: ReaderRequest) -> ReaderReply:
        raise RuntimeError("no")

    scene.reader = FakeLineReader({("claude-haiku-5-5", 1): crash, ("claude-haiku-5-5", 2): crash})
    first_read = [UNSURE_LINE.format(page=1, bar=5)]

    read = stage(scene, part_read(TWO_LINES, 7, first_read)).read(scene.score_file, scene.rendered)

    assert read.warnings[0] == first_read[0]


# ---------------------------------------------------------------- a pickup and a multi-rest


def test_the_structure_follows_a_pickup_and_a_multi_rest_through_two_count_changes() -> None:
    # line 1: the pickup (bar 0) and bars 1-3. Line 2: bars 4-7, the last box a 2-bar rest (6-7).
    # Line 3: bars 8-10. The readers find a fifth box on line 1 and on line 2, whose rest then
    # starts a box later.
    specs = [
        Spec(40.0, 0, [(50, 150), (150, 350), (350, 550), (550, 750)],
             [(50, 150), (150, 300), (300, 450), (450, 600), (600, 750)]),
        Spec(160.0, 4, [(50, 250), (250, 450), (450, 750)],
             [(50, 250), (250, 450), (450, 550), (550, 750)], reads_bars=[1, 1, 1, 1],
             bars=[1, 1, 2]),
        Spec(280.0, 8, [(50, 300), (300, 550), (550, 750)],
             [(50, 300), (300, 550), (550, 750)]),
    ]  # fmt: skip
    scene = Scene(specs, (40, 160, 280))
    first = part_read(
        specs,
        10,
        meters=[
            MeterChange(numerator=4, denominator=4, from_bar=1),
            MeterChange(numerator=3, denominator=4, from_bar=6),
        ],
        marks=[
            StructureMark(kind=MarkKind.REPEAT_START, bar=1),
            StructureMark(kind=MarkKind.REPEAT_END, bar=10),
        ],
        short_bars={0: 1},
        rests=[6, 7],
        pickup_sources=2,
        play_order=[PlayOrderRow(start=0, end=10), PlayOrderRow(start=1, end=10)],
    )

    read = stage(scene, first).read(scene.score_file, scene.rendered)

    bars = [b.bar for b in read.boxes]
    assert bars == list(range(13))  # 0 to 12, one box a bar
    assert read.structure.bar_count == 12 == max(bars)
    assert read.structure.short_bars == {0: 1} and read.structure.pickup_sources == 2
    assert read.structure.rests == [8, 9]
    rest_boxes = [b for b in read.boxes if b.bar in (8, 9)]
    assert len({(b.x, b.y, b.w) for b in rest_boxes}) == 1  # the two bars share one box
    assert [(m.kind, m.bar) for m in read.structure.marks] == [
        (MarkKind.REPEAT_START, 1),
        (MarkKind.REPEAT_END, 12),
    ]
    assert read.structure.meters[1].from_bar == 7
    assert [(r.start, r.end) for r in read.structure.play_order] == [(0, 12), (1, 12)]
    assert read.warnings[-1] == "Advanced Reading changed 2 bars on 2 lines."


# ---------------------------------------------------------------- when it cannot run


def test_a_pdf_from_notation_software_asks_no_reader() -> None:
    scene = Scene(TWO_LINES, (100, 250), pdf("MuseScore 4", "Flute"))
    check = ByCount()

    read = stage(scene, part_read(TWO_LINES, 7), check).read(scene.score_file, scene.rendered)

    assert scene.reader.calls == [] and scene.judge.calls == [] and check.calls == []
    assert read.warnings[-1] == NOTATION_SKIPPED
    assert read.boxes == part_read(TWO_LINES, 7).boxes


def test_a_reader_that_always_fails_leaves_the_first_read_and_says_so() -> None:
    scene = Scene(TWO_LINES, (100, 250))

    def refuse(request: ReaderRequest) -> ReaderReply:
        raise ReadAgainError("The Anthropic API could not be reached for Advanced Reading.")

    scene.reader = FakeLineReader(
        {("claude-haiku-5-5", 1): refuse, ("claude-haiku-5-5", 2): refuse}
    )
    first = part_read(TWO_LINES, 7)
    check = ByCount()
    checking = stage(scene, first, check)

    read = checking.read(scene.score_file, scene.rendered)

    assert read.boxes == first.boxes and read.structure is first.structure
    assert any("could not be reached" in w for w in read.warnings)
    assert len(check.calls) == 2  # the box check still runs
    assert checking.flags == {"flute": []}


def test_any_other_failure_of_the_reading_keeps_the_first_read_with_one_plain_sentence() -> None:
    scene = Scene(TWO_LINES, (100, 250))

    def crash(request: ReaderRequest) -> ReaderReply:
        raise RuntimeError("secret path /home/someone/file")

    scene.reader = FakeLineReader({("claude-haiku-5-5", 1): crash, ("claude-haiku-5-5", 2): crash})
    first = part_read(TWO_LINES, 7)
    check = ByCount({3: {2: "ends_late"}})
    checking = stage(scene, first, check)

    read = checking.read(scene.score_file, scene.rendered)

    assert read.boxes == first.boxes and read.structure is first.structure
    [sentence] = [w for w in read.warnings if w.startswith("Advanced Reading could not run:")]
    assert "secret" not in sentence and sentence.endswith(".")
    assert [(f.bar, f.verdict) for f in checking.flags["flute"]] == [(6, "ends_late")]
    assert read.cost_usd == pytest.approx(INNER_COST + 2 * CHECK_COST)


def test_a_judge_that_fails_keeps_the_boxes_and_says_so() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    scene.judge = FakeProposalJudge(lambda request: ReadAgainError("The judge was out."))
    first = part_read(TWO_LINES, 7)

    read = stage(scene, first).read(scene.score_file, scene.rendered)

    assert read.boxes == first.boxes
    assert any("The judge was out." in w for w in read.warnings)


def test_a_failed_box_check_after_a_reading_keeps_the_reading_and_its_flags() -> None:
    scene = Scene(TWO_LINES, (100, 250))

    class Crash:
        def judge(self, request: CheckRequest) -> JudgeAnswer:
            raise ReadAgainError("not the box check's own error")

    checking = stage(scene, part_read(TWO_LINES, 7), Crash())

    read = checking.read(scene.score_file, scene.rendered)

    assert len(read.boxes) == 8 and read.structure.bar_count == 8
    assert [(f.bar, f.verdict) for f in checking.flags["flute"]] == [(1, "read_count")]


def test_without_readers_the_stage_is_the_box_check_it_was() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    first = part_read(TWO_LINES, 7)

    read = stage(scene, first, advanced=False).read(scene.score_file, scene.rendered)

    assert read.boxes == first.boxes and read.structure is first.structure
    assert scene.reader.calls == [] and read.cost_usd == pytest.approx(INNER_COST + 2 * CHECK_COST)


# ---------------------------------------------------------------- online: the tick and the job


MOVED = [(50, 250), (250, 500), (500, 650), (650, 780)]  # boxes 2 and 4 each end later


def test_the_ticked_part_saves_the_merged_flags_with_the_edges_to_put_back() -> None:
    specs = [Spec(100.0, 1, FOUR, MOVED)]
    scene = Scene(specs, (100,))
    db = InMemoryDatabase()
    db.add_piece("piece", "owner")
    db.add_score_file("piece", "flute", PDF_PATH, name="Flute", box_check=True)
    check = ByCount({4: {1: "starts_late"}})
    make = lambda inner, part_id: BoxCheckingOmr(  # noqa: E731
        inner, scene.storage, check, {part_id}, db, scene.advanced
    )
    ticked = TickedBoxCheck(Fixed(part_read(specs, 4)), db, make)
    row = {**scene.score_file, **db.list_score_files("piece")[0]}

    read = ticked.read(row, scene.rendered)

    flags = db.get_box_flags("flute")
    assert [(f["bar"], f["verdict"]) for f in flags] == [
        (1, "starts_late"),
        (2, "read_moved"),
        (3, "read_moved"),
        (4, "read_moved"),
    ]
    assert flags[1]["previous"] == {"x": 250.0, "w": 200.0}
    assert flags[2]["previous"] == {"x": 450.0, "w": 200.0}
    assert "previous" not in flags[0]  # the check's flag has none
    assert numbers(read.boxes)[1:] == [(2, 250, 500), (3, 500, 650), (4, 650, 780)]


def test_with_box_check_gives_the_readers_to_the_boxes_it_checks() -> None:
    scene = Scene(TWO_LINES, (100, 250))
    db = InMemoryDatabase()
    db.add_piece("piece", "owner")
    db.add_score_file("piece", "flute", PDF_PATH, name="Flute", box_check=True)
    stages = rs.Stages(
        audio=object(),  # type: ignore[arg-type]
        pages=object(),  # type: ignore[arg-type]
        omr=Fixed(part_read(TWO_LINES, 7)),
        downbeats=object(),  # type: ignore[arg-type]
    )

    wrapped = with_box_check(stages, db, scene.storage, ByCount(), scene.advanced)
    row = {**scene.score_file, **db.list_score_files("piece")[0]}
    read = wrapped.omr.read(row, scene.rendered)

    assert isinstance(wrapped.omr, TickedBoxCheck)
    assert len(read.boxes) == 8 and scene.judge.calls  # the readers and the judge ran


def test_the_stages_of_the_server_pass_the_tools_readers_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    readers = AdvancedReaders(FakeLineReader(), FakeProposalJudge([]))
    given: dict[str, Any] = {}

    def keep(stages: Any, db: Any, storage: Any, judge: Any, advanced: Any = None) -> Any:
        given.update(judge=judge, advanced=advanced)
        return stages

    monkeypatch.delenv("USE_FAKES", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setattr(rs, "real_tools", lambda settings: replace(tools(), advanced=readers))
    monkeypatch.setattr(rs, "with_box_check", keep)
    services = Services(InMemoryDatabase(), InMemoryStorage(), InMemoryJobStore())

    default_stages(services)

    assert given["advanced"] is readers


def test_a_key_gives_the_tools_the_real_readers_and_no_key_gives_none() -> None:
    assert advanced_readers(Settings()) is None
    readers = advanced_readers(Settings(anthropic_api_key="k"))
    assert isinstance(readers, AdvancedReaders)
    assert type(readers.reader).__name__ == "ClaudeLineReader"
    assert type(readers.judge).__name__ == "ClaudeProposalJudge"


def test_the_real_tools_carry_the_readers_when_there_is_a_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rs, "missing_tool", lambda: None)

    with_key = rs.real_tools(Settings(anthropic_api_key="k"))
    without = rs.real_tools(Settings())

    assert with_key.advanced is not None and with_key.box_judge is not None
    assert without.advanced is None and without.box_judge is None


def test_a_whole_job_saves_the_moves_the_flags_and_the_final_boxes(tmp_path: Path) -> None:
    world = World(tmp_path)
    world.db._score_files[PIECE][0]["box_check"] = True  # the browser saved the tick
    world.db.set_plan(OWNER, "creator")  # Advanced Reading is checked at job time
    moved = [(50, 275), (275, 540), (540, 725), (725, 950)]  # boxes 2 and 3 meet 40 px later
    reader = FakeLineReader(
        {
            (model, run): lambda request: ReaderReply(
                ReaderAnswer(
                    boxes=[ReaderBox(left=a / 1000, right=b / 1000, bars=1) for a, b in moved]
                ),
                READ_COST,
            )
            for model, run in (("claude-haiku-5-5", 1), ("claude-haiku-5-5", 2))
        }
    )
    # both lines read alike and both start on an odd bar (1 and 5), so the proposal is picture A
    judge = FakeProposalJudge(
        lambda request: JudgeReply(JudgeChoice(choice="A", note="shifted"), JUDGE_COST)
    )
    check = ByCount()
    stages = with_box_check(
        world.stages, world.db, world.storage, check, AdvancedReaders(reader, judge)
    )

    job = world.run(process_piece, JobKind.PROCESS_PIECE, stages)

    assert job.status == JobStatus.DONE
    flags = world.db.get_box_flags(PART)
    assert [(f["bar"], f["verdict"]) for f in flags] == [
        (2, "read_moved"),
        (3, "read_moved"),
        (6, "read_moved"),
        (7, "read_moved"),
    ]
    assert flags[0]["previous"] == {"x": 275.0, "w": 225.0}
    _, saved = world.db.get_page_layer(PART)
    assert [(b.bar, b.x, round(b.w)) for b in saved if b.bar in (2, 3)] == [
        (2, 275.0, 265),
        (3, 540.0, 185),
    ]
    assert "Advanced Reading changed 4 bars on 2 lines." in job.warnings
    assert job.cost_usd >= 4 * READ_COST + 2 * JUDGE_COST
    rows, _, _ = world.db.get_structure(PIECE)
    assert [(row.start, row.end) for row in rows] == [(1, 8)]


def test_a_whole_job_with_a_count_change_saves_one_more_bar_and_a_longer_structure(
    tmp_path: Path,
) -> None:
    world = World(tmp_path)
    world.db._score_files[PIECE][0]["box_check"] = True
    world.db.set_plan(OWNER, "creator")  # Advanced Reading is checked at job time
    stages = with_box_check(
        world.stages,
        world.db,
        world.storage,
        ByCount(),
        AdvancedReaders(FakeLineReader(), FakeProposalJudge([])),  # no answers: nothing changes
    )

    job = world.run(process_piece, JobKind.PROCESS_PIECE, stages)

    assert job.status == JobStatus.DONE  # a reading that cannot run never fails the job
    assert any("Advanced Reading" in w for w in job.warnings)
    assert world.db.get_box_flags(PART) == []
