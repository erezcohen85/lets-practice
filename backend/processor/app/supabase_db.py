import math
import uuid
from datetime import UTC, datetime
from typing import Any

from app.jobs import INTERRUPTED, ActiveJob, JobBusy
from app.pipeline.models import (
    BarBox,
    BarMark,
    FailedPart,
    Job,
    JobKind,
    JobStatus,
    Locator,
    MeterChange,
    PlayOrderRow,
    ReviewFlag,
    ShortBar,
)
from app.pipeline.run_folder import BoxFlag
from app.pipeline.sample_piece import SampleAlready, SampleNoMaster, SampleState
from app.supabase_rest import RestError, SupabaseRest

# The real Database and JobStore, with the service key: every caller has already checked who asks.
# Row dicts use the column names of backend/supabase/migrations/. Writes that replace several rows
# go through the service_ functions of migration 0009, so each is one transaction.
#
# Paths read here (score_files.storage_path, audio_sources.url_or_path and stored_path) are written
# by the owner and are handed back as they are: a caller that feeds one to Storage goes through
# require_piece_path first (app/pipeline/storage_paths.py).

_UNIQUE_VIOLATION = "23505"
_ACTIVE = "in.(queued,running)"
_JOB_COLUMNS = "id,piece_id,kind,status,progress,error,warnings,cost_usd,failed_parts"


def _is_uuid(text: str) -> bool:
    try:
        uuid.UUID(text)
    except ValueError:
        return False
    return True


def _eq(value: str) -> str:
    return f"eq.{value}"


def _locator_row(locator: Locator) -> dict[str, Any]:
    return {
        "bar_number": locator.bar,
        "pass_index": locator.pass_index,
        "time_sec": locator.time_sec,
        "confirmed": locator.confirmed,
        "flags": [flag.model_dump() for flag in locator.flags],
        "checked": locator.checked,
    }


def _locator_from(row: dict[str, Any]) -> Locator:
    return Locator(
        bar=row["bar_number"],
        pass_index=row["pass_index"],
        time_sec=row["time_sec"],
        confirmed=row["confirmed"],
        flags=[ReviewFlag.model_validate(flag) for flag in row["flags"]],
        checked=row["checked"],
    )


class SupabaseDatabase:
    """The processor's view of Postgres."""

    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    def get_piece_owner(self, piece_id: str) -> str | None:
        if not _is_uuid(piece_id):
            return None  # PostgREST would answer 400 to a filter that is not a uuid
        rows = self._rest.select("pieces", {"id": _eq(piece_id), "select": "owner_id"})
        return rows[0]["owner_id"] if rows else None

    def plan_state(self, user_id: str, piece_id: str | None = None) -> dict[str, Any]:
        # service_plan_state resolves the plan from auth.users and a confirmed email; the JWT's
        # claims play no part. A piece that is not the user's gives "piece": null.
        state = self._rest.rpc(
            "service_plan_state",
            {"target": user_id, "target_piece": piece_id},
        )
        if not isinstance(state, dict) or not isinstance(state.get("plan"), dict):
            raise ValueError("service_plan_state answered something that is not a plan state")
        return state

    def record_usage(
        self, user_id: str, kind: str, piece_id: str | None, part_id: str | None, n: int = 1
    ) -> None:
        # every argument is sent, null included: only n has a default in the function
        self._rest.rpc(
            "service_record_usage",
            {
                "target": user_id,
                "usage_kind": kind,
                "target_piece": piece_id,
                "target_part": part_id,
                "n": n,
            },
        )

    def void_piece_created(self, piece_id: str) -> None:
        self._rest.rpc("service_void_piece_created", {"target_piece": piece_id})

    def claim_piece(self, piece_id: str) -> str | None:
        refused = self._rest.rpc("service_claim_piece", {"target_piece": piece_id})
        return refused if isinstance(refused, str) else None

    def delete_piece(self, piece_id: str) -> None:
        if not _is_uuid(piece_id):
            return  # no such piece; PostgREST would answer 400 to a filter that is not a uuid
        self._rest.delete("pieces", {"id": _eq(piece_id)})  # parts, pages, map and jobs cascade

    def use_advanced_reading(self, user_id: str, piece_id: str, part_ids: list[str]) -> str | None:
        refused = self._rest.rpc(
            "service_use_advanced_reading",
            {"target": user_id, "target_piece": piece_id, "target_parts": part_ids},
        )
        return refused if isinstance(refused, str) else None

    def sample_state(self, user_id: str) -> SampleState:
        state = self._rest.rpc("service_sample_state", {"target": user_id})
        if not isinstance(state, dict) or not isinstance(state.get("has_master"), bool):
            raise ValueError("service_sample_state answered something that is not a sample state")
        return SampleState(
            given_at=state.get("given_at"),
            has_master=state["has_master"],
            is_master_owner=bool(state.get("is_master_owner")),
            room=bool(state.get("room")),
        )

    def copy_sample_piece(self, user_id: str, new_piece_id: str) -> list[tuple[str, str]]:
        try:
            answer = self._rest.rpc(
                "service_copy_sample_piece", {"target": user_id, "new_piece": new_piece_id}
            )
        except RestError as error:
            if error.reason == "sample:already":
                raise SampleAlready() from None
            if error.reason == "sample:no_master":
                raise SampleNoMaster() from None
            raise
        if not isinstance(answer, dict) or not isinstance(answer.get("files"), list):
            raise ValueError("service_copy_sample_piece answered something that is not a copy")
        return [(pair["from"], pair["to"]) for pair in answer["files"]]

    def mark_sample(self, user_id: str, given: bool) -> None:
        self._rest.rpc("service_mark_sample", {"target": user_id, "was_given": given})

    def unmark_sample(self, user_id: str) -> None:
        self._rest.rpc("service_unmark_sample", {"target": user_id})

    def _play_order(self, piece_id: str) -> dict[str, Any] | None:
        rows = self._rest.select("play_order", {"piece_id": _eq(piece_id), "select": "*"})
        return rows[0] if rows else None

    def get_structure(
        self, piece_id: str
    ) -> tuple[list[PlayOrderRow], list[MeterChange], list[BarMark]]:
        row = self._play_order(piece_id)
        if row is None:
            return [], [], []
        return (
            [PlayOrderRow.model_validate(item) for item in row["rows"]],
            [MeterChange.model_validate(item) for item in row["meters"]],
            [BarMark.model_validate(item) for item in row["marks"]],
        )

    def save_structure(
        self,
        piece_id: str,
        rows: list[PlayOrderRow],
        meters: list[MeterChange],
        marks: list[BarMark],
        short_bars: list[ShortBar] | None = None,
    ) -> None:
        self._rest.upsert(
            "play_order",
            [
                {
                    "piece_id": piece_id,
                    "bar_count": max((row.end for row in rows), default=0),
                    "rows": [row.model_dump(by_alias=True) for row in rows],
                    "meters": [meter.model_dump() for meter in meters],
                    "marks": [mark.model_dump() for mark in marks],
                    # `unnumbered` is stored only when set: other maps keep their shape
                    "short_bars": [
                        short.model_dump(exclude_defaults=True) for short in short_bars or []
                    ],
                }
            ],
            "piece_id",
        )

    def get_short_bars(self, piece_id: str) -> list[ShortBar]:
        row = self._play_order(piece_id)
        return [ShortBar.model_validate(item) for item in row["short_bars"]] if row else []

    def get_locators(self, piece_id: str) -> list[Locator]:
        # Read in pages: a long piece with repeats can pass the rows one answer may hold.
        rows = self._rest.select_all(
            "locators", {"piece_id": _eq(piece_id), "select": "*", "order": "bar_number,pass_index"}
        )
        return [_locator_from(row) for row in rows]

    def replace_unconfirmed_locators(self, piece_id: str, locators: list[Locator]) -> None:
        try:
            self._rest.rpc(
                "service_replace_unconfirmed_locators",
                {"target_piece": piece_id, "new_locators": [_locator_row(i) for i in locators]},
            )
        except RestError as error:
            if error.code == _UNIQUE_VIOLATION:
                # The table's unique key: a confirmed locator on the bar and pass, or a bar and
                # pass given twice. The fake raises ValueError for both.
                raise ValueError(
                    "a bar and pass already has a confirmed locator, or was given twice"
                ) from None
            raise

    def save_page_layer(
        self,
        score_file_id: str,
        pages: list[dict[str, Any]],
        bars: list[BarBox],
        rests: list[int] | None = None,
    ) -> None:
        self._rest.rpc(
            "service_save_page_layer",
            {
                "target_part": score_file_id,
                "new_pages": pages,
                "new_bars": [
                    {
                        "bar_number": box.bar,
                        "page_index": box.page_index,
                        "x": box.x,
                        "y": box.y,
                        "w": box.w,
                        "h": box.h,
                    }
                    for box in bars
                ],
                "new_rests": sorted(set(rests or [])),
            },
        )

    def get_rests(self, score_file_id: str) -> list[int]:
        rows = self._rest.select("score_files", {"id": _eq(score_file_id), "select": "rests"})
        return list(rows[0]["rests"]) if rows else []

    def list_score_files(self, piece_id: str) -> list[dict[str, Any]]:
        return self._rest.select(
            "score_files", {"piece_id": _eq(piece_id), "select": "*", "order": "position"}
        )

    def list_unrendered_score_files(self, piece_id: str) -> list[dict[str, Any]]:
        rows = self._rest.select(
            "score_files",
            {"piece_id": _eq(piece_id), "select": "*,score_pages(id)", "order": "position"},
        )
        return [
            {key: value for key, value in row.items() if key != "score_pages"}
            for row in rows
            if not row["score_pages"]
        ]

    def set_part_name(self, score_file_id: str, name: str, source: str = "read") -> None:
        changed = self._rest.update(
            "score_files", {"id": _eq(score_file_id)}, {"name": name, "name_source": source}
        )
        if not changed:
            raise KeyError(score_file_id)

    def set_box_flags(self, score_file_id: str, flags: list[BoxFlag]) -> None:
        changed = self._rest.update(
            "score_files",
            {"id": _eq(score_file_id)},
            {"box_flags": [flag.model_dump() for flag in flags]},
        )
        if not changed:
            raise KeyError(score_file_id)

    def get_audio_source(self, piece_id: str) -> dict[str, Any] | None:
        rows = self._rest.select(
            "audio_sources", {"piece_id": _eq(piece_id), "select": "*", "limit": "1"}
        )
        return rows[0] if rows else None

    def set_audio_stored(self, piece_id: str, stored_path: str, duration_sec: float) -> None:
        changed = self._rest.update(
            "audio_sources",
            {"piece_id": _eq(piece_id)},
            {"stored_path": stored_path, "duration": duration_sec},
        )
        if not changed:
            raise KeyError(piece_id)

    def set_audio_name(self, piece_id: str, name: str) -> None:
        changed = self._rest.update("audio_sources", {"piece_id": _eq(piece_id)}, {"name": name})
        if not changed:
            raise KeyError(piece_id)


def _job_from(row: dict[str, Any]) -> Job:
    return Job(
        id=row["id"],
        piece_id=row["piece_id"],
        kind=JobKind(row["kind"]),
        status=JobStatus(row["status"]),
        progress=row["progress"],
        error=row.get("error"),
        warnings=row.get("warnings") or [],
        cost_usd=float(row.get("cost_usd") or 0),
        failed_parts=[FailedPart.model_validate(item) for item in row.get("failed_parts") or []],
    )


def _now() -> str:
    return datetime.now(UTC).isoformat()


class SupabaseJobStore:
    """The jobs table; the browser polls the same rows."""

    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    def create(self, piece_id: str, kind: JobKind) -> Job:
        try:
            rows = self._rest.insert("jobs", [{"piece_id": piece_id, "kind": kind.value}])
        except RestError as error:
            if error.code == _UNIQUE_VIOLATION:
                raise JobBusy(piece_id) from None
            raise
        return _job_from(rows[0])

    def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: float | None = None,
        error: str | None = None,
        warnings: list[str] | None = None,
        cost_usd: float | None = None,
        failed_parts: list[FailedPart] | None = None,
    ) -> Job:
        if progress is not None and not (math.isfinite(progress) and 0 <= progress <= 1):
            raise ValueError(f"progress must be between 0 and 1, got {progress}")
        values: dict[str, Any] = {"updated_at": _now()}
        if status is not None:
            values["status"] = status.value
        if progress is not None:
            values["progress"] = progress
        if error is not None:
            values["error"] = error
        if warnings is not None:
            values["warnings"] = warnings
        if cost_usd is not None:
            values["cost_usd"] = cost_usd
        if failed_parts is not None:
            values["failed_parts"] = [part.model_dump() for part in failed_parts]
        params = {"id": _eq(job_id)}
        if status is not None:
            # A status write only lands on a job that has not ended. Unlike the fake, which raises
            # ValueError for it, this finds no row and raises KeyError, the same as an unknown id.
            # It is also what keeps a job that a restart marked failed from being marked done by
            # the old process's last write.
            params["status"] = _ACTIVE
        rows = self._rest.update("jobs", params, values)
        if not rows:
            raise KeyError(job_id)
        return _job_from(rows[0])

    def get(self, job_id: str) -> Job | None:
        if not _is_uuid(job_id):
            return None
        rows = self._rest.select("jobs", {"id": _eq(job_id), "select": _JOB_COLUMNS})
        return _job_from(rows[0]) if rows else None

    def active_job(self, piece_id: str) -> ActiveJob | None:
        rows = self._rest.select(
            "jobs",
            {
                "piece_id": _eq(piece_id),
                "status": _ACTIVE,
                "select": f"{_JOB_COLUMNS},updated_at",
                "order": "updated_at.desc",
                "limit": "1",
            },
        )
        if not rows:
            return None
        return ActiveJob(_job_from(rows[0]), datetime.fromisoformat(rows[0]["updated_at"]))

    def fail_interrupted(self) -> int:
        rows = self._rest.update(
            "jobs",
            {"status": _ACTIVE},
            {"status": JobStatus.ERROR.value, "error": INTERRUPTED, "updated_at": _now()},
        )
        return len(rows)
