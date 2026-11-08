"""The Advanced Reading tick as a job reads it: score_files.box_check turns the box check on for
that part, and what the check finds is saved on the part (TickedBoxCheck, with_box_check)."""

from pathlib import Path

from app.db import InMemoryDatabase
from app.pipeline.box_check import FakeBoxJudge
from app.pipeline.models import JobKind, JobStatus
from app.pipeline.orchestrator import process_piece
from app.pipeline.real_stages import (
    NO_JUDGE,
    BoxCheckingOmr,
    RealOmrStage,
    TickedBoxCheck,
    with_box_check,
)
from app.pipeline.stages import Stages
from tests.test_box_check_stage import PDF_PATH, Inner, part_read, pdf, reply, world
from tests.test_real_stages import OWNER, PART, PIECE, World


def db_with_part(ticked: bool) -> InMemoryDatabase:
    db = InMemoryDatabase()
    db.add_piece("piece", "owner")
    db.add_score_file("piece", "flute", PDF_PATH, name="Flute", box_check=ticked)
    return db


def ticked_stage(db: InMemoryDatabase, storage, judge: FakeBoxJudge | None) -> TickedBoxCheck:
    make = (
        None
        if judge is None
        else lambda inner, part_id: BoxCheckingOmr(inner, storage, judge, {part_id}, db)
    )
    return TickedBoxCheck(Inner(), db, make)


def row(db: InMemoryDatabase) -> dict:
    return db.list_score_files("piece")[0]


def test_a_part_without_the_tick_is_read_and_not_checked() -> None:
    storage, score_file, rendered = world(pdf())
    db = db_with_part(False)
    judge = FakeBoxJudge([])

    read = ticked_stage(db, storage, judge).read({**score_file, **row(db)}, rendered)

    assert read == part_read()
    assert judge.calls == [] and db.get_box_flags("flute") == []


def test_a_part_with_the_tick_is_checked_and_its_flags_are_saved() -> None:
    storage, score_file, rendered = world(pdf())
    db = db_with_part(True)
    judge = FakeBoxJudge([reply("ok", "two_bars")])

    read = ticked_stage(db, storage, judge).read({**score_file, **row(db)}, rendered)

    assert len(judge.calls) == 1
    assert [(f["bar"], f["verdict"]) for f in db.get_box_flags("flute")] == [(2, "two_bars")]
    assert read.boxes == part_read().boxes
    assert read.cost_usd > part_read().cost_usd  # the check's cost joins the part's


def test_a_check_that_finds_nothing_saves_an_empty_list() -> None:
    storage, score_file, rendered = world(pdf())
    db = db_with_part(True)
    db.set_box_flags("flute", [])
    judge = FakeBoxJudge([reply("ok", "ok")])

    ticked_stage(db, storage, judge).read({**score_file, **row(db)}, rendered)

    assert db.get_box_flags("flute") == []


def test_a_pdf_from_notation_software_saves_no_flags_and_says_it_was_skipped() -> None:
    storage, score_file, rendered = world(pdf("MuseScore 4", "Flute"))
    db = db_with_part(True)

    read = ticked_stage(db, storage, FakeBoxJudge([])).read({**score_file, **row(db)}, rendered)

    assert "notation software" in read.warnings[-1]
    assert db.get_box_flags("flute") == []


def test_without_a_judge_a_ticked_part_is_read_and_the_job_says_it_was_not_checked() -> None:
    storage, score_file, rendered = world(pdf())
    db = db_with_part(True)

    read = ticked_stage(db, storage, None).read({**score_file, **row(db)}, rendered)

    assert read.boxes == part_read().boxes
    assert read.warnings[-1] == NO_JUDGE


def test_with_box_check_wraps_only_the_omr_stage() -> None:
    storage, _, _ = world(pdf())
    db = db_with_part(True)
    omr = RealOmrStage(db, storage, None, None, None)  # type: ignore[arg-type]
    stages = Stages(audio=object(), pages=object(), omr=omr, downbeats=object())  # type: ignore[arg-type]

    wrapped = with_box_check(stages, db, storage, FakeBoxJudge([]))

    assert isinstance(wrapped.omr, TickedBoxCheck)
    assert wrapped.audio is stages.audio and wrapped.pages is stages.pages


def test_a_whole_job_saves_the_flags_of_the_part_that_was_ticked(tmp_path: Path) -> None:
    world = World(tmp_path)
    world.db._score_files[PIECE][0]["box_check"] = True  # the browser saved the tick
    world.db.set_plan(OWNER, "creator")  # Advanced Reading is checked at job time
    judge = FakeBoxJudge([reply("ok", "ok", "two_bars", "ok"), reply("ok", "ok", "ok", "ok")])
    stages = with_box_check(world.stages, world.db, world.storage, judge)

    job = world.run(process_piece, JobKind.PROCESS_PIECE, stages)

    assert job.status == JobStatus.DONE
    assert len(judge.calls) == 2  # one a line
    # The two lines may be judged in either order, so the flagged bar is the third box of either.
    flags = world.db.get_box_flags(PART)
    assert [f["verdict"] for f in flags] == ["two_bars"]
    assert flags[0]["bar"] in (3, 7)


def test_a_whole_job_without_the_tick_never_asks_the_judge(tmp_path: Path) -> None:
    world = World(tmp_path)
    judge = FakeBoxJudge([])
    stages = with_box_check(world.stages, world.db, world.storage, judge)

    job = world.run(process_piece, JobKind.PROCESS_PIECE, stages)

    assert job.status == JobStatus.DONE
    assert judge.calls == []
