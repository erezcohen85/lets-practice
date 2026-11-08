"""BoxCheckingOmr (the box check as a step of the read) and pdf_kind_of, on fakes."""

import io
from dataclasses import replace
from typing import Any

import pymupdf
import pytest
from PIL import Image, ImageDraw

from app.db import InMemoryDatabase
from app.pipeline.bar_boxes import BoxAudit
from app.pipeline.box_check import (
    BoxAnswer,
    BoxCheckError,
    FakeBoxJudge,
    JudgeAnswer,
    LineAnswer,
    pdf_kind_of,
)
from app.pipeline.consensus import StructureAudit
from app.pipeline.models import BarBox
from app.pipeline.real_stages import BoxCheckingOmr
from app.pipeline.stages import PageImage, RenderedPart
from app.pipeline.structure import PieceStructure
from app.pipeline.structure_read import PartAudits, PartRead
from app.storage import InMemoryStorage

PDF_PATH = "owner/piece/parts/flute.pdf"
IMAGE_PATH = "owner/piece/pages/flute-0.png"


def piece_db() -> InMemoryDatabase:
    db = InMemoryDatabase()
    db.add_piece("piece", "owner")
    return db


def pdf(creator: str = "", text: str = "") -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    if text:
        page.insert_text((72, 72), text)
    document.set_metadata({"creator": creator, "producer": ""})
    return bytes(document.tobytes())


def png() -> bytes:
    image = Image.new("L", (800, 400), 255)
    pen = ImageDraw.Draw(image)
    for row in range(5):
        pen.line((0, 107 + 15 * row, 800, 107 + 15 * row), fill=0)
    data = io.BytesIO()
    image.save(data, format="PNG")
    return data.getvalue()


def part_read() -> PartRead:
    structure = PieceStructure(2, [], [], [], {}, None, [], [])
    boxes = [
        BarBox(bar=1, page_index=0, x=50, y=100, w=300, h=75),
        BarBox(bar=2, page_index=0, x=350, y=100, w=300, h=75),
    ]
    return PartRead(
        boxes, structure, PartAudits(StructureAudit([]), BoxAudit()), 0.01, ["old"], None
    )


class Inner:
    def __init__(self) -> None:
        self.calls = 0

    def read(self, score_file: dict[str, Any], rendered: RenderedPart) -> PartRead:
        self.calls += 1
        return part_read()


def world(pdf_bytes: bytes) -> tuple[InMemoryStorage, dict[str, Any], RenderedPart]:
    storage = InMemoryStorage()
    storage.upload(PDF_PATH, pdf_bytes, "application/pdf")
    storage.upload(IMAGE_PATH, png(), "image/png")
    score_file = {"id": "flute", "piece_id": "piece", "storage_path": PDF_PATH, "name": "Flute"}
    return storage, score_file, RenderedPart([PageImage(0, 800, 400, IMAGE_PATH)], [0.0], [200])


def reply(*verdicts: str) -> JudgeAnswer:
    boxes = [BoxAnswer(box=i + 1, verdict=v, note="seen") for i, v in enumerate(verdicts)]
    return JudgeAnswer(LineAnswer(boxes=boxes, first_note_x=None), 4000, 300, 1.0, cost_usd=0.008)


# ---------------------------------------------------------------- the kind of a PDF


def test_a_pdf_from_notation_software_is_a_notation_pdf() -> None:
    assert pdf_kind_of(pdf("Sibelius version 7.1.3", "Flute")) == "notation"


def test_a_pdf_with_no_text_on_page_one_is_a_scan() -> None:
    assert pdf_kind_of(pdf()) == "scan"


def test_a_pdf_with_text_from_another_program_is_unknown() -> None:
    assert pdf_kind_of(pdf("Word", "Flute")) == "unknown"


def test_bytes_that_are_no_pdf_are_unknown() -> None:
    assert pdf_kind_of(b"%PDF-1.7 fake") == "unknown"


# ---------------------------------------------------------------- the stage


def test_a_part_not_asked_for_is_read_and_not_checked() -> None:
    storage, score_file, rendered = world(pdf())
    judge = FakeBoxJudge([])
    stage = BoxCheckingOmr(Inner(), storage, judge, set(), piece_db())

    read = stage.read(score_file, rendered)

    assert read == part_read() and judge.calls == [] and stage.flags == {}


def test_a_part_asked_for_is_checked_after_its_boxes_are_read() -> None:
    storage, score_file, rendered = world(pdf())
    judge = FakeBoxJudge([reply("ok", "two_bars")])
    stage = BoxCheckingOmr(Inner(), storage, judge, {"flute"}, piece_db())

    read = stage.read(score_file, rendered)

    assert [(f.bar, f.verdict) for f in stage.flags["flute"]] == [(2, "two_bars")]
    assert read.boxes == part_read().boxes
    assert read.cost_usd == pytest.approx(0.01 + 0.008)
    assert read.warnings == ["old"]


def test_a_scan_with_no_flags_leaves_an_empty_list_so_the_part_counts_as_checked() -> None:
    storage, score_file, rendered = world(pdf())
    stage = BoxCheckingOmr(
        Inner(), storage, FakeBoxJudge([reply("ok", "ok")]), {"flute"}, piece_db()
    )

    stage.read(score_file, rendered)

    assert stage.flags == {"flute": []}


def test_a_pdf_from_notation_software_is_skipped_with_a_sentence() -> None:
    storage, score_file, rendered = world(pdf("MuseScore 4", "Flute"))
    judge = FakeBoxJudge([])
    stage = BoxCheckingOmr(Inner(), storage, judge, {"flute"}, piece_db())

    read = stage.read(score_file, rendered)

    assert judge.calls == [] and stage.flags == {}
    assert read.cost_usd == 0.01
    assert read.warnings[0] == "old"
    assert "notation software" in read.warnings[1]


def test_a_failed_line_is_a_warning_and_the_part_is_still_read() -> None:
    class Failing:
        def judge(self, request: Any) -> JudgeAnswer:
            raise BoxCheckError("The Anthropic API could not be reached for the box check.")

    storage, score_file, rendered = world(pdf())
    stage = BoxCheckingOmr(Inner(), storage, Failing(), {"flute"}, piece_db())

    read = stage.read(score_file, rendered)

    assert stage.flags == {"flute": []}
    assert any("could not be reached" in w for w in read.warnings)
    assert replace(read, warnings=["old"]).boxes == part_read().boxes


def test_a_missing_page_image_is_a_warning_not_a_failed_read() -> None:
    storage, score_file, _ = world(pdf())
    rendered = RenderedPart([PageImage(0, 800, 400, "nowhere.png")], [0.0], [200])
    stage = BoxCheckingOmr(Inner(), storage, FakeBoxJudge([]), {"flute"}, piece_db())

    read = stage.read(score_file, rendered)

    assert any("box check" in w.lower() for w in read.warnings)
    assert stage.flags == {}


def test_a_file_error_in_the_check_does_not_put_its_text_in_the_warnings() -> None:
    storage, score_file, _ = world(pdf())
    rendered = RenderedPart([PageImage(0, 800, 400, "nowhere/secret.png")], [0.0], [200])
    stage = BoxCheckingOmr(Inner(), storage, FakeBoxJudge([]), {"flute"}, piece_db())

    read = stage.read(score_file, rendered)

    assert any("box check" in w.lower() for w in read.warnings)
    assert not any("secret" in w for w in read.warnings)  # raw text can hold a path or a row


def test_a_part_path_outside_the_piece_folder_is_a_warning_and_is_not_downloaded() -> None:
    class Watched(InMemoryStorage):
        def __init__(self) -> None:
            super().__init__()
            self.downloads: list[str] = []

        def download(self, path: str) -> bytes:
            self.downloads.append(path)
            return super().download(path)

    storage = Watched()
    foreign = "other/piece-9/flute.pdf"
    storage.upload(foreign, pdf(), "application/pdf")
    score_file = {"id": "flute", "piece_id": "piece", "storage_path": foreign, "name": "Flute"}
    rendered = RenderedPart([PageImage(0, 800, 400, IMAGE_PATH)], [0.0], [200])
    judge = FakeBoxJudge([])
    stage = BoxCheckingOmr(Inner(), storage, judge, {"flute"}, piece_db())

    read = stage.read(score_file, rendered)

    assert any("not in this piece's folder" in w for w in read.warnings)
    assert storage.downloads == [] and judge.calls == [] and stage.flags == {}
