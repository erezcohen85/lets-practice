import json
from typing import Any

import httpx
import pytest

from app.db import Database
from app.jobs import INTERRUPTED, InMemoryJobStore, JobBusy, JobStore
from app.pipeline.models import (
    BarBox,
    BarMark,
    FailedPart,
    JobKind,
    JobStatus,
    Locator,
    MeterChange,
    PlayOrderRow,
    ReviewFlag,
    ShortBar,
    UncertainLine,
)
from app.pipeline.run_folder import BoxFlag
from app.supabase_db import SupabaseDatabase, SupabaseJobStore
from app.supabase_rest import RestError, SupabaseRest

PIECE = "00000000-0000-4000-8000-0000000000f1"
PART = "00000000-0000-4000-8000-0000000000f2"


class Script:
    """Answers by method and path; keeps every request.

    A list answer is served the way PostgREST pages it: a request with an offset past the end gets
    an empty page, so a read that pages until an empty page ends.
    """

    def __init__(self, answers: dict[tuple[str, str], Any] | None = None) -> None:
        self.answers = answers or {}
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.get((request.method, request.url.path), [])
        if isinstance(answer, httpx.Response):
            return answer
        if isinstance(answer, list) and request.method == "GET":
            start = int(request.url.params.get("offset", "0"))
            limit = int(request.url.params.get("limit", len(answer) or 1))
            answer = answer[start : start + limit]
        return httpx.Response(200, json=answer)

    def body(self, index: int = -1) -> Any:
        return json.loads(self.requests[index].content)


def rest(script: Script) -> SupabaseRest:
    return SupabaseRest("https://p.example", "sb_secret_x", transport=httpx.MockTransport(script))


def test_they_meet_the_protocols() -> None:
    assert isinstance(SupabaseDatabase(rest(Script())), Database)
    assert isinstance(SupabaseJobStore(rest(Script())), JobStore)


def test_an_owner_read_and_a_malformed_id() -> None:
    script = Script({("GET", "/rest/v1/pieces"): [{"owner_id": "u"}]})
    db = SupabaseDatabase(rest(script))
    assert db.get_piece_owner(PIECE) == "u"
    assert script.requests[0].url.params["id"] == f"eq.{PIECE}"
    sent = len(script.requests)
    assert db.get_piece_owner("not-a-uuid") is None  # PostgREST would answer 400
    assert len(script.requests) == sent


STATE = {
    "is_admin": False,
    "plan": {"id": "trial", "name": "Trial", "position": 0, "pages_per_part_max": 20},
    "usage": {"pieces_created": 1},
    "piece": None,
}


def test_plan_state_asks_the_database_for_the_user_and_the_piece() -> None:
    script = Script({("POST", "/rest/v1/rpc/service_plan_state"): STATE})
    assert SupabaseDatabase(rest(script)).plan_state("u", PIECE) == STATE
    assert script.body() == {"target": "u", "target_piece": PIECE}


def test_plan_state_without_a_piece_sends_null() -> None:
    script = Script({("POST", "/rest/v1/rpc/service_plan_state"): STATE})
    SupabaseDatabase(rest(script)).plan_state("u")
    assert script.body() == {"target": "u", "target_piece": None}


def test_plan_state_that_is_not_a_plan_state_is_an_error_not_a_pass() -> None:
    for answer in (None, True, [], {"plan": None}):
        script = Script({("POST", "/rest/v1/rpc/service_plan_state"): answer})
        with pytest.raises(ValueError, match="not a plan state"):
            SupabaseDatabase(rest(script)).plan_state("u")


def test_record_usage_sends_every_argument_null_ones_too() -> None:
    script = Script({("POST", "/rest/v1/rpc/service_record_usage"): None})
    db = SupabaseDatabase(rest(script))
    db.record_usage("u", "advanced_reading_part", PIECE, PART, 2)
    assert script.body() == {
        "target": "u",
        "usage_kind": "advanced_reading_part",
        "target_piece": PIECE,
        "target_part": PART,
        "n": 2,
    }
    db.record_usage("u", "realign", PIECE, None)
    assert script.body() == {
        "target": "u",
        "usage_kind": "realign",
        "target_piece": PIECE,
        "target_part": None,
        "n": 1,
    }


def test_void_piece_created_calls_the_service_function() -> None:
    script = Script({("POST", "/rest/v1/rpc/service_void_piece_created"): None})
    SupabaseDatabase(rest(script)).void_piece_created(PIECE)
    assert script.requests[-1].url.path == "/rest/v1/rpc/service_void_piece_created"
    assert script.body() == {"target_piece": PIECE}


def test_delete_piece_deletes_the_pieces_row_by_id() -> None:
    script = Script({("DELETE", "/rest/v1/pieces"): None})
    SupabaseDatabase(rest(script)).delete_piece(PIECE)
    request = script.requests[-1]
    assert (request.method, request.url.path) == ("DELETE", "/rest/v1/pieces")
    assert request.url.params["id"] == f"eq.{PIECE}"


def test_delete_piece_of_a_name_that_is_not_a_uuid_sends_nothing() -> None:
    script = Script()
    SupabaseDatabase(rest(script)).delete_piece("not-a-uuid")
    assert script.requests == []


def test_use_advanced_reading_calls_one_function_and_returns_the_limit_or_none() -> None:
    path = "/rest/v1/rpc/service_use_advanced_reading"
    script = Script({("POST", path): None})
    db = SupabaseDatabase(rest(script))
    assert db.use_advanced_reading("u", PIECE, [PART]) is None
    assert script.body() == {"target": "u", "target_piece": PIECE, "target_parts": [PART]}
    script = Script({("POST", path): "advanced_reading_parts_per_month"})
    refused = SupabaseDatabase(rest(script)).use_advanced_reading("u", PIECE, [PART])
    assert refused == "advanced_reading_parts_per_month"


def test_claim_piece_calls_one_function_and_returns_the_limit_or_none() -> None:
    path = "/rest/v1/rpc/service_claim_piece"
    script = Script({("POST", path): None})
    assert SupabaseDatabase(rest(script)).claim_piece(PIECE) is None
    assert script.body() == {"target_piece": PIECE}
    script = Script({("POST", path): "pieces_created_max"})
    assert SupabaseDatabase(rest(script)).claim_piece(PIECE) == "pieces_created_max"


def test_structure_round_trip_with_the_column_shapes() -> None:
    script = Script()
    db = SupabaseDatabase(rest(script))
    db.save_structure(
        PIECE,
        [PlayOrderRow(start=0, end=8)],
        [MeterChange(from_bar=1, numerator=6, denominator=8)],
        [BarMark(bar=2, kind="fermata")],
        [ShortBar(bar=0, units=1)],
    )
    sent = script.requests[-1]
    assert sent.url.params["on_conflict"] == "piece_id"
    assert script.body() == [
        {
            "piece_id": PIECE,
            "bar_count": 8,
            "rows": [{"from": 0, "to": 8}],
            "meters": [{"from_bar": 1, "numerator": 6, "denominator": 8}],
            "marks": [{"bar": 2, "kind": "fermata"}],
            "short_bars": [{"bar": 0, "units": 1}],
        }
    ]
    script.answers[("GET", "/rest/v1/play_order")] = script.body()
    rows, meters, marks = db.get_structure(PIECE)
    assert (rows[0].start, rows[0].end) == (0, 8)
    assert meters[0].from_bar == 1
    assert marks[0].kind == "fermata"
    assert db.get_short_bars(PIECE) == [ShortBar(bar=0, units=1)]


def test_a_pickup_with_no_number_is_stored_and_read_with_its_flag() -> None:
    script = Script()
    db = SupabaseDatabase(rest(script))
    db.save_structure(
        PIECE,
        [PlayOrderRow(start=1, end=8)],
        [MeterChange(from_bar=1, numerator=4, denominator=4)],
        [],
        [ShortBar(bar=0, units=1), ShortBar(bar=5, units=2, unnumbered=True)],
    )

    sent = script.body()
    assert sent[0]["short_bars"] == [
        {"bar": 0, "units": 1},
        {"bar": 5, "units": 2, "unnumbered": True},
    ]

    script.answers[("GET", "/rest/v1/play_order")] = [
        {
            "piece_id": PIECE,
            "bar_count": 8,
            "rows": [{"from": 1, "to": 8}],
            "meters": [],
            "marks": [],
            "short_bars": sent[0]["short_bars"],
        }
    ]
    assert db.get_short_bars(PIECE) == [
        ShortBar(bar=0, units=1),
        ShortBar(bar=5, units=2, unnumbered=True),
    ]


def test_an_unsaved_structure_is_empty() -> None:
    db = SupabaseDatabase(rest(Script()))
    assert db.get_structure(PIECE) == ([], [], [])
    assert db.get_short_bars(PIECE) == []


def test_locators_keep_flags_in_snake_case_both_ways() -> None:
    flag = ReviewFlag(
        kind="crowded",
        severity=1,
        expected=2.0,
        found=1.0,
        factor=0.5,
        uncertain_line=UncertainLine(time_sec=3.0, confidence=0.4),
    )
    locator = Locator(bar=0, pass_index=1, time_sec=2.5, flags=[flag], checked=True)
    script = Script()
    db = SupabaseDatabase(rest(script))
    db.replace_unconfirmed_locators(PIECE, [locator])
    assert script.requests[-1].url.path == "/rest/v1/rpc/service_replace_unconfirmed_locators"
    sent = script.body()["new_locators"][0]
    assert sent["bar_number"] == 0
    assert sent["pass_index"] == 1
    assert sent["flags"][0]["uncertain_line"] == {"time_sec": 3.0, "confidence": 0.4}
    script.answers[("GET", "/rest/v1/locators")] = [sent]
    assert db.get_locators(PIECE) == [locator]


def test_locators_are_read_in_pages_so_a_long_piece_is_not_cut_short() -> None:
    rows = [
        {
            "bar_number": bar,
            "pass_index": 0,
            "time_sec": float(bar),
            "confirmed": False,
            "flags": [],
            "checked": False,
        }
        for bar in range(1, 1201)
    ]
    script = Script({("GET", "/rest/v1/locators"): rows})
    found = SupabaseDatabase(rest(script)).get_locators(PIECE)
    assert [item.bar for item in found] == list(range(1, 1201))
    assert all("order" in request.url.params for request in script.requests)
    assert len(script.requests) > 1


def test_a_collision_with_a_confirmed_locator_is_a_value_error_as_on_the_fake() -> None:
    conflict = httpx.Response(409, json={"code": "23505"})
    script = Script({("POST", "/rest/v1/rpc/service_replace_unconfirmed_locators"): conflict})
    with pytest.raises(ValueError, match="confirmed"):
        SupabaseDatabase(rest(script)).replace_unconfirmed_locators(PIECE, [])


def test_another_refusal_replacing_locators_passes_through() -> None:
    refusal = httpx.Response(400, json={"code": "22004"})
    script = Script({("POST", "/rest/v1/rpc/service_replace_unconfirmed_locators"): refusal})
    with pytest.raises(RestError):
        SupabaseDatabase(rest(script)).replace_unconfirmed_locators(PIECE, [])


def test_a_page_layer_goes_as_one_call() -> None:
    script = Script()
    SupabaseDatabase(rest(script)).save_page_layer(
        PART,
        [{"page_index": 0, "image_path": "a", "width": 5, "height": 6}],
        [BarBox(bar=0, page_index=0, x=1, y=2, w=3, h=4)],
        [4, 3, 3],
    )
    assert script.requests[-1].url.path == "/rest/v1/rpc/service_save_page_layer"
    body = script.body()
    assert body["target_part"] == PART
    assert body["new_rests"] == [3, 4]
    assert body["new_bars"] == [
        {"bar_number": 0, "page_index": 0, "x": 1.0, "y": 2.0, "w": 3.0, "h": 4.0}
    ]


def test_unrendered_parts_are_those_with_no_page_rows() -> None:
    rows = [
        {"id": "a", "position": 0, "score_pages": [{"id": "p"}]},
        {"id": "b", "position": 1, "score_pages": []},
    ]
    script = Script({("GET", "/rest/v1/score_files"): rows})
    unrendered = SupabaseDatabase(rest(script)).list_unrendered_score_files(PIECE)
    assert [row["id"] for row in unrendered] == ["b"]
    assert "score_pages" not in unrendered[0]


def test_a_rename_of_a_part_that_is_gone_is_a_key_error_as_on_the_fake() -> None:
    script = Script({("PATCH", "/rest/v1/score_files"): []})
    with pytest.raises(KeyError):
        SupabaseDatabase(rest(script)).set_part_name(PART, "Flute")
    script.answers[("PATCH", "/rest/v1/score_files")] = [{"id": PART}]
    SupabaseDatabase(rest(script)).set_part_name(PART, "Flute", "user")
    assert script.body() == {"name": "Flute", "name_source": "user"}


def test_the_recording_is_updated_by_piece_and_a_missing_one_is_a_key_error() -> None:
    script = Script({("PATCH", "/rest/v1/audio_sources"): [{"id": "a"}]})
    db = SupabaseDatabase(rest(script))
    db.set_audio_stored(PIECE, "o/p/audio.m4a", 12.5)
    assert script.requests[-1].url.params["piece_id"] == f"eq.{PIECE}"
    assert script.body() == {"stored_path": "o/p/audio.m4a", "duration": 12.5}
    db.set_audio_name(PIECE, "Take 2")
    assert script.body() == {"name": "Take 2"}
    script.answers[("PATCH", "/rest/v1/audio_sources")] = []
    with pytest.raises(KeyError):
        db.set_audio_name(PIECE, "x")
    with pytest.raises(KeyError):
        db.set_audio_stored(PIECE, "x", 1.0)


def test_a_job_starts_queued_and_a_second_one_on_the_piece_is_busy() -> None:
    row = {
        "id": "j",
        "piece_id": PIECE,
        "kind": "realign",
        "status": "queued",
        "progress": 0,
        "error": None,
        "warnings": [],
        "cost_usd": None,
        "failed_parts": [],
    }
    script = Script({("POST", "/rest/v1/jobs"): [row]})
    job = SupabaseJobStore(rest(script)).create(PIECE, JobKind.REALIGN)
    assert (job.id, job.status) == ("j", JobStatus.QUEUED)
    busy = Script({("POST", "/rest/v1/jobs"): httpx.Response(409, json={"code": "23505"})})
    with pytest.raises(JobBusy):
        SupabaseJobStore(rest(busy)).create(PIECE, JobKind.REALIGN)


def test_another_refusal_on_create_is_not_busy() -> None:
    script = Script({("POST", "/rest/v1/jobs"): httpx.Response(403, json={"code": "42501"})})
    with pytest.raises(RestError):
        SupabaseJobStore(rest(script)).create(PIECE, JobKind.REALIGN)


def test_an_update_writes_the_given_fields_and_the_time() -> None:
    row = {"id": "j", "piece_id": PIECE, "kind": "realign", "status": "done", "progress": 1}
    script = Script({("PATCH", "/rest/v1/jobs"): [row]})
    SupabaseJobStore(rest(script)).update(
        "j",
        status=JobStatus.DONE,
        progress=1.0,
        warnings=["w"],
        cost_usd=0.5,
        failed_parts=[FailedPart(id="a", name="A", error="e")],
    )
    body = script.body()
    assert body["status"] == "done"
    assert body["failed_parts"] == [{"id": "a", "name": "A", "error": "e"}]
    assert "updated_at" in body


def test_a_progress_outside_zero_to_one_is_refused_before_any_request() -> None:
    script = Script()
    store = SupabaseJobStore(rest(script))
    for bad in (-0.1, 1.5, float("nan")):
        with pytest.raises(ValueError, match="progress"):
            store.update("j", progress=bad)
    assert script.requests == []


def test_a_status_change_cannot_leave_an_ended_job() -> None:
    # A job marked failed by a restart must stay failed: the old process's last write finds no row.
    script = Script({("PATCH", "/rest/v1/jobs"): []})
    with pytest.raises(KeyError):
        SupabaseJobStore(rest(script)).update("j", status=JobStatus.DONE)
    assert script.requests[-1].url.params["status"] == "in.(queued,running)"


def test_a_progress_only_update_does_not_filter_on_status() -> None:
    row = {"id": "j", "piece_id": PIECE, "kind": "realign", "status": "running", "progress": 0.5}
    script = Script({("PATCH", "/rest/v1/jobs"): [row]})
    SupabaseJobStore(rest(script)).update("j", progress=0.5)
    assert "status" not in script.requests[-1].url.params


def test_a_job_is_read_by_id_and_a_malformed_id_is_none() -> None:
    row = {"id": PIECE, "piece_id": PART, "kind": "add-parts", "status": "error", "progress": 1}
    script = Script({("GET", "/rest/v1/jobs"): [row]})
    store = SupabaseJobStore(rest(script))
    job = store.get(PIECE)
    assert job is not None
    assert (job.kind, job.status, job.cost_usd, job.warnings) == (
        JobKind.ADD_PARTS,
        JobStatus.ERROR,
        0.0,
        [],
    )
    sent = len(script.requests)
    assert store.get("not-a-uuid") is None
    assert len(script.requests) == sent


def test_after_a_restart_every_unfinished_job_ends_as_failed() -> None:
    rows = [{"id": "a"}, {"id": "b"}]
    script = Script({("PATCH", "/rest/v1/jobs"): rows})
    assert SupabaseJobStore(rest(script)).fail_interrupted() == 2
    assert script.requests[-1].url.params["status"] == "in.(queued,running)"
    assert script.body()["status"] == "error"
    assert script.body()["error"] == INTERRUPTED


def test_the_in_memory_store_does_the_same() -> None:
    jobs = InMemoryJobStore()
    job = jobs.create("p", JobKind.REALIGN)
    with pytest.raises(JobBusy):
        jobs.create("p", JobKind.REALIGN)
    jobs.create("other", JobKind.REALIGN)
    assert jobs.fail_interrupted() == 2
    ended = jobs.get(job.id)
    assert ended is not None
    assert ended.status == JobStatus.ERROR
    assert ended.error == INTERRUPTED
    jobs.create("p", JobKind.REALIGN)


def test_the_active_job_of_a_piece_comes_with_its_last_update() -> None:
    row = {
        "id": "j",
        "piece_id": PIECE,
        "kind": "realign",
        "status": "running",
        "progress": 0.5,
        "updated_at": "2026-11-05T10:00:00.123456+00:00",
    }
    script = Script({("GET", "/rest/v1/jobs"): [row]})
    active = SupabaseJobStore(rest(script)).active_job(PIECE)
    assert active is not None
    assert active.job.id == "j"
    assert active.updated_at.isoformat() == "2026-11-05T10:00:00.123456+00:00"
    params = script.requests[-1].url.params
    assert params["piece_id"] == f"eq.{PIECE}"
    assert params["status"] == "in.(queued,running)"
    assert "updated_at" in params["select"]


def test_no_active_job_is_none() -> None:
    assert SupabaseJobStore(rest(Script({("GET", "/rest/v1/jobs"): []}))).active_job(PIECE) is None


def test_the_in_memory_store_reports_the_active_job_and_when_it_last_changed() -> None:
    from datetime import UTC, datetime, timedelta

    now = [datetime(2026, 11, 5, 10, 0, tzinfo=UTC)]
    jobs = InMemoryJobStore(clock=lambda: now[0])
    job = jobs.create("p", JobKind.REALIGN)
    now[0] += timedelta(minutes=3)
    jobs.update(job.id, progress=0.5)  # a progress write counts as an update
    active = jobs.active_job("p")
    assert active is not None and active.updated_at == now[0]
    jobs.update(job.id, status=JobStatus.ERROR)
    assert jobs.active_job("p") is None


def test_box_flags_are_written_as_the_browser_reads_them() -> None:
    script = Script({("PATCH", "/rest/v1/score_files"): [{"id": PART}]})
    db = SupabaseDatabase(rest(script))

    db.set_box_flags(PART, [BoxFlag(bar=3, verdict="two_bars", note="two", suggestedX=12.5)])

    assert script.requests[-1].url.params["id"] == f"eq.{PART}"
    assert script.body() == {
        "box_flags": [{"bar": 3, "verdict": "two_bars", "note": "two", "suggestedX": 12.5}]
    }
    script.answers[("PATCH", "/rest/v1/score_files")] = []
    with pytest.raises(KeyError):
        db.set_box_flags(PART, [])
