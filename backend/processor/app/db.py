import copy
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

from app.pipeline.models import BarBox, BarMark, Locator, MeterChange, PlayOrderRow, ShortBar
from app.pipeline.plan_limits import decide
from app.pipeline.run_folder import BoxFlag
from app.pipeline.sample_piece import SampleAlready, SampleNoMaster, SampleState

# The processor's view of Postgres. Phase 9 adds a Supabase implementation behind this Protocol;
# tests and the fake-backed server use InMemoryDatabase. Row dicts use the column names of
# backend/supabase/migrations/0001_init.sql.

Structure = tuple[list[PlayOrderRow], list[MeterChange], list[BarMark]]


@runtime_checkable
class Database(Protocol):
    """Everything the processor reads and writes in Postgres."""

    def get_piece_owner(self, piece_id: str) -> str | None:
        """Return the owner's user id, or None when the piece does not exist."""
        ...

    def plan_state(self, user_id: str, piece_id: str | None = None) -> dict[str, Any]:
        """The user's plan, usage and (when `piece_id` is the user's piece) that piece's counts,
        as public.service_plan_state decides it in migration 0015. The JSON shape is
        `my_plan()`'s: {"is_admin", "plan", "usage", "piece"}."""
        ...

    def record_usage(
        self, user_id: str, kind: str, piece_id: str | None, part_id: str | None, n: int = 1
    ) -> None:
        """Record `n` usage events of `kind` ("advanced_reading_part", "read_again", "realign",
        "piece_created") for the user, with the plan the user is on now."""
        ...

    def void_piece_created(self, piece_id: str) -> None:
        """Give the piece's creation back: its piece_created event no longer counts."""
        ...

    def claim_piece(self, piece_id: str) -> str | None:
        """Count a piece again whose creation was given back after a job-time refusal, as
        public.service_claim_piece decides it (migration 0017): None when its created event is not
        voided (nothing to do) or is cleared because pieces made ever and, for an event of today,
        the plan-wide daily cap have room; else the limit key ("pieces_created_max" or
        "new_pieces_per_day") with the event left voided. The admin is never refused."""
        ...

    def delete_piece(self, piece_id: str) -> None:
        """Delete the piece row and everything that hangs on it (parts, pages, map, jobs). Its
        usage events stay: a deleted piece is still a piece made. Not an error for a piece that is
        already gone. The files in Storage are the caller's to delete."""
        ...

    def use_advanced_reading(self, user_id: str, piece_id: str, part_ids: list[str]) -> str | None:
        """Check the owner's plan for reading `part_ids` with Advanced Reading AND record one
        advanced_reading_part event for each, as one step that sees every other job's record
        (public.service_use_advanced_reading, migration 0017). Returns None when recorded, else the
        limit key that refused ("advanced_reading" or "advanced_reading_parts_per_month"), with
        nothing recorded. An empty list is None."""
        ...

    def sample_state(self, user_id: str) -> SampleState:
        """Whether the account was given the sample, whether there is a master, whether the user
        owns it, and whether the plan has room for one more piece (service_sample_state)."""
        ...

    def copy_sample_piece(self, user_id: str, new_piece_id: str) -> list[tuple[str, str]]:
        """Copy the master's rows into the user's account as `new_piece_id`, once, and return
        every (master path, new path) pair of files for the caller to copy in Storage. Raises
        SampleAlready (the account was given or skipped before) or SampleNoMaster."""
        ...

    def mark_sample(self, user_id: str, given: bool) -> None:
        """Record that the account was given the sample, or skipped; it is not asked again."""
        ...

    def unmark_sample(self, user_id: str) -> None:
        """Forget the mark, so the account is asked again (after a copy that failed)."""
        ...

    def get_structure(self, piece_id: str) -> Structure:
        """Return the piece's play-order rows, meter changes and marks (empty when unsaved)."""
        ...

    def save_structure(
        self,
        piece_id: str,
        rows: list[PlayOrderRow],
        meters: list[MeterChange],
        marks: list[BarMark],
        short_bars: list[ShortBar] | None = None,
    ) -> None:
        """Replace the piece's structure (the play_order row).

        `short_bars` are the bars shorter than their meter, bar 0 being a pickup. Phase 9 stores
        them in the timing layer next to the play order (a column of play_order or a table).
        """
        ...

    def get_short_bars(self, piece_id: str) -> list[ShortBar]:
        """Return the piece's short bars, in bar order (empty when it has none)."""
        ...

    def get_locators(self, piece_id: str) -> list[Locator]:
        """Return every locator of the piece, confirmed or not."""
        ...

    def replace_unconfirmed_locators(self, piece_id: str, locators: list[Locator]) -> None:
        """Delete the unconfirmed locators and insert these; confirmed rows are never touched."""
        ...

    def save_page_layer(
        self,
        score_file_id: str,
        pages: list[dict[str, Any]],
        bars: list[BarBox],
        rests: list[int] | None = None,
    ) -> None:
        """Replace a part's score_pages rows, bar boxes and rests (the bars it does not play).

        Rests are a part's own: a multi-rest of the flute is not one of the oboe. Phase 9 stores
        them with the part's page layer (an int[] column of score_files or a table).
        """
        ...

    def get_rests(self, score_file_id: str) -> list[int]:
        """Return a part's rests, in bar order (empty when it has none)."""
        ...

    def list_score_files(self, piece_id: str) -> list[dict[str, Any]]:
        """Return the piece's score_files rows in hub order."""
        ...

    def list_unrendered_score_files(self, piece_id: str) -> list[dict[str, Any]]:
        """Return the piece's score_files rows that have no score_pages yet, in hub order."""
        ...

    def set_part_name(self, score_file_id: str, name: str, source: str = "read") -> None:
        """Name a part and say where the name came from: "read" (the instrument the vision read
        found in its header), "file" (made from the PDF's file name) or "user"."""
        ...

    def set_box_flags(self, score_file_id: str, flags: list[BoxFlag]) -> None:
        """Replace the bar boxes the box check found wrong on a part (none: the check found no
        fault). Stored as score_files.box_flags, in the shape the browser reads."""
        ...

    def get_audio_source(self, piece_id: str) -> dict[str, Any] | None:
        """Return the piece's audio_sources row, or None."""
        ...

    def set_audio_stored(self, piece_id: str, stored_path: str, duration_sec: float) -> None:
        """Record where the playback copy of the recording is and how long the recording is."""
        ...

    def set_audio_name(self, piece_id: str, name: str) -> None:
        """Name the recording (the video's title, until the user renames it)."""
        ...


# The three plans of migration 0015, as seeded (None: no limit). Plans are fixed at three.
_TRIAL: dict[str, Any] = {
    "id": "trial",
    "name": "Trial",
    "position": 0,
    "pieces_created_max": 3,
    "pieces_stored_max": 3,
    "parts_per_piece_max": 1,
    "pages_per_part_max": 20,
    "recording_minutes_max": 10,
    "advanced_reading": False,
    "advanced_reading_parts_per_month": 0,
    "split_pdf": False,
    "suggest_name": True,
    "shared_pieces_max": 1,
    "members_per_piece": 30,
    "members_per_part": 10,
    "read_again_per_part_max": 2,
    "realign_per_piece_max": 5,
    "new_pieces_per_day": 20,
    "new_pieces_paused": False,
}
PLANS: dict[str, dict[str, Any]] = {
    "trial": _TRIAL,
    "creator": {
        **_TRIAL,
        "id": "creator",
        "name": "Creator",
        "position": 1,
        "pieces_created_max": None,
        "pieces_stored_max": 50,
        "parts_per_piece_max": None,
        "pages_per_part_max": 100,
        "recording_minutes_max": 20,
        "advanced_reading": True,
        "advanced_reading_parts_per_month": 30,
        "split_pdf": True,
        "shared_pieces_max": None,
        "read_again_per_part_max": 10,
        "realign_per_piece_max": None,
        "new_pieces_per_day": None,
    },
    "unlimited": {
        **_TRIAL,
        "id": "unlimited",
        "name": "Unlimited",
        "position": 2,
        "pieces_created_max": None,
        "pieces_stored_max": None,
        "parts_per_piece_max": None,
        "pages_per_part_max": 100,
        "recording_minutes_max": 20,
        "advanced_reading": True,
        "advanced_reading_parts_per_month": None,
        "split_pdf": True,
        "shared_pieces_max": None,
        "read_again_per_part_max": None,
        "realign_per_piece_max": None,
        "new_pieces_per_day": None,
    },
}


class InMemoryDatabase:
    """A Database held in dicts; every value in and out is a copy."""

    def __init__(self) -> None:
        self._owners: dict[str, str] = {}
        self._structures: dict[str, Structure] = {}
        self._short_bars: dict[str, list[ShortBar]] = {}
        self._locators: dict[str, dict[tuple[int, int], Locator]] = {}
        self._pages: dict[str, list[dict[str, Any]]] = {}
        self._bars: dict[str, list[BarBox]] = {}
        self._rests: dict[str, list[int]] = {}
        self._box_flags: dict[str, list[dict[str, Any]]] = {}
        self._score_files: dict[str, list[dict[str, Any]]] = {}
        self._audio_sources: dict[str, dict[str, Any]] = {}
        self._admins: set[str] = set()
        self._plans: dict[str, dict[str, Any]] = copy.deepcopy(PLANS)
        self._user_plans: dict[str, str] = {}  # user id -> plan id; a user not here is on Trial
        self._events: list[dict[str, Any]] = []  # the usage_events rows
        self._sample_master: str | None = None  # the master piece id (None: no sample)
        self._sample_credits: list[dict[str, Any]] = []  # sample_piece.credits
        self._sample_marks: dict[str, bool] = {}  # user id -> given (True) or skipped (False)
        self._piece_credits: dict[str, list[dict[str, Any]]] = {}  # pieces.sample_credits

    # --- Database ---------------------------------------------------------------------------

    def get_piece_owner(self, piece_id: str) -> str | None:
        return self._owners.get(piece_id)

    def plan_state(self, user_id: str, piece_id: str | None = None) -> dict[str, Any]:
        return self._state(user_id, piece_id)

    def _state(self, user_id: str, piece_id: str | None = None) -> dict[str, Any]:
        is_admin = user_id in self._admins
        plan = self._plans["unlimited" if is_admin else self._user_plans.get(user_id, "trial")]
        mine = [event for event in self._events if event["user_id"] == user_id]
        now = datetime.now(UTC)
        counted = [e for e in mine if e["kind"] == "piece_created" and e["voided_at"] is None]
        reading = [
            e
            for e in mine
            if e["kind"] == "advanced_reading_part"
            and (e["at"].year, e["at"].month) == (now.year, now.month)
        ]
        on_plan_today = [
            e
            for e in self._events
            if e["kind"] == "piece_created"
            and e["voided_at"] is None
            and e["plan_id"] == plan["id"]
            and not e["is_sample"]
            and e["at"].date() == now.date()
        ]
        piece: dict[str, Any] | None = None
        if piece_id is not None and self._owners.get(piece_id) == user_id:
            of_piece = [e for e in mine if e["piece_id"] == piece_id]
            read_again: dict[str, int] = {}
            for event in of_piece:
                if event["kind"] == "read_again" and event["part_id"] is not None:
                    read_again[event["part_id"]] = read_again.get(event["part_id"], 0) + 1
            piece = {
                "id": piece_id,
                "parts": len(self._score_files.get(piece_id, [])),
                "realigns": sum(1 for e in of_piece if e["kind"] == "realign"),
                "read_again_by_part": read_again,
            }
        return {
            "is_admin": is_admin,
            "plan": copy.deepcopy(plan),
            "usage": {
                "pieces_created": len(counted),
                "pieces_stored": sum(1 for owner in self._owners.values() if owner == user_id),
                "shared_pieces": 0,  # the processor never shares; the fake has no links
                "advanced_reading_parts_this_month": len(reading),
                "new_pieces_today_on_plan": len(on_plan_today),
            },
            "piece": piece,
        }

    def record_usage(
        self, user_id: str, kind: str, piece_id: str | None, part_id: str | None, n: int = 1
    ) -> None:
        for _ in range(n):
            self._log_event(user_id, kind, piece_id, part_id)

    def void_piece_created(self, piece_id: str) -> None:
        for event in self._events:
            if event["kind"] == "piece_created" and event["piece_id"] == piece_id:
                event["voided_at"] = event["voided_at"] or datetime.now(UTC)

    def claim_piece(self, piece_id: str) -> str | None:
        owner_id = self._owners.get(piece_id)
        events = [
            e for e in self._events if e["kind"] == "piece_created" and e["piece_id"] == piece_id
        ]
        if owner_id is None or not events or any(e["voided_at"] is None for e in events):
            return None
        event = events[-1]
        state = self._state(owner_id)
        if not state["is_admin"]:
            plan, usage = state["plan"], state["usage"]
            per_day = plan["new_pieces_per_day"]
            if (
                per_day is not None
                and event["at"].date() == datetime.now(UTC).date()
                and usage["new_pieces_today_on_plan"] >= per_day
            ):
                return "new_pieces_per_day"
            if (
                plan["pieces_created_max"] is not None
                and usage["pieces_created"] >= plan["pieces_created_max"]
            ):
                return "pieces_created_max"
        event["voided_at"] = None
        return None

    def delete_piece(self, piece_id: str) -> None:
        for row in self._score_files.pop(piece_id, []):
            self._pages.pop(row["id"], None)
            self._bars.pop(row["id"], None)
            self._rests.pop(row["id"], None)
            self._box_flags.pop(row["id"], None)
        for table in (self._owners, self._structures, self._short_bars, self._locators):
            table.pop(piece_id, None)
        self._audio_sources.pop(piece_id, None)
        self._piece_credits.pop(piece_id, None)

    def use_advanced_reading(self, user_id: str, piece_id: str, part_ids: list[str]) -> str | None:
        if not part_ids:
            return None
        # Read from the data, not through plan_state: the one step must see every record so far.
        limit = decide(self._state(user_id, piece_id), "advanced_reading", parts=len(part_ids))
        if limit is not None:
            return limit
        for part_id in part_ids:
            self._log_event(user_id, "advanced_reading_part", piece_id, part_id)
        return None

    def _log_event(
        self,
        user_id: str,
        kind: str,
        piece_id: str | None,
        part_id: str | None,
        is_sample: bool = False,
    ) -> None:
        self._events.append(
            {
                "user_id": user_id,
                "kind": kind,
                "plan_id": self._state(user_id)["plan"]["id"],
                "piece_id": piece_id,
                "part_id": part_id,
                "at": datetime.now(UTC),
                "voided_at": None,
                "is_sample": is_sample,
            }
        )

    def sample_state(self, user_id: str) -> SampleState:
        plan = self.plan_state(user_id)
        limits, usage = plan["plan"], plan["usage"]
        master = self._sample_master if self._sample_master in self._owners else None
        created_max, stored_max = limits["pieces_created_max"], limits["pieces_stored_max"]
        return SampleState(
            given_at="given" if user_id in self._sample_marks else None,
            has_master=master is not None,
            is_master_owner=master is not None and self._owners[master] == user_id,
            room=plan["is_admin"]
            or (
                (created_max is None or usage["pieces_created"] < created_max)
                and (stored_max is None or usage["pieces_stored"] < stored_max)
            ),
        )

    def copy_sample_piece(self, user_id: str, new_piece_id: str) -> list[tuple[str, str]]:
        """Like service_copy_sample_piece (0016): rows copied with their paths moved into the
        user's folder, the creation counted but marked as the sample's."""
        if user_id in self._sample_marks:
            raise SampleAlready()
        master = self._sample_master
        if master is None or master not in self._owners:
            raise SampleNoMaster()
        old = f"{self._owners[master]}/{master}/"
        new = f"{user_id}/{new_piece_id}/"

        def moved(path: str | None) -> str | None:
            if path is None:
                return None
            if not path.startswith(old):
                raise ValueError("sample:path_outside")
            return new + path[len(old) :]

        files: set[str] = set()

        def move(path: str) -> str:
            files.add(path)
            result = moved(path)
            assert result is not None
            return result

        self._owners[new_piece_id] = user_id
        self._log_event(user_id, "piece_created", new_piece_id, None, is_sample=True)
        self._piece_credits[new_piece_id] = copy.deepcopy(self._sample_credits)
        for row in sorted(self._score_files.get(master, []), key=lambda r: r["position"]):
            copied = copy.deepcopy(row)
            copied.update(id=str(uuid.uuid4()), piece_id=new_piece_id)
            copied["storage_path"] = move(row["storage_path"])
            self._score_files.setdefault(new_piece_id, []).append(copied)
            pages = copy.deepcopy(self._pages.get(row["id"], []))
            for page in pages:
                page["image_path"] = move(page["image_path"])
            self.save_page_layer(copied["id"], pages, self._bars.get(row["id"], []))
            self._rests[copied["id"]] = list(self._rests.get(row["id"], []))
            self._box_flags[copied["id"]] = copy.deepcopy(self._box_flags.get(row["id"], []))
        source = self._audio_sources.get(master)
        if source is not None:
            audio = copy.deepcopy(source)
            audio["id"] = f"audio-{new_piece_id}"
            audio["piece_id"] = new_piece_id
            if audio["kind"] == "file":
                audio["url_or_path"] = move(source["url_or_path"])
            if source["stored_path"] is not None:
                audio["stored_path"] = move(source["stored_path"])
            self._audio_sources[new_piece_id] = audio
        if master in self._structures:
            rows, meters, marks = self._structures[master]
            self.save_structure(new_piece_id, rows, meters, marks, self._short_bars.get(master))
        self._locators[new_piece_id] = {
            key: locator.model_copy(deep=True)
            for key, locator in self._locators.get(master, {}).items()
        }
        self._sample_marks[user_id] = True
        return [(path, moved(path) or "") for path in sorted(files)]

    def mark_sample(self, user_id: str, given: bool) -> None:
        self._sample_marks[user_id] = given

    def unmark_sample(self, user_id: str) -> None:
        self._sample_marks.pop(user_id, None)

    def get_structure(self, piece_id: str) -> Structure:
        rows, meters, marks = self._structures.get(piece_id, ([], [], []))
        return _copy_structure(rows, meters, marks)

    def save_structure(
        self,
        piece_id: str,
        rows: list[PlayOrderRow],
        meters: list[MeterChange],
        marks: list[BarMark],
        short_bars: list[ShortBar] | None = None,
    ) -> None:
        self._structures[piece_id] = _copy_structure(rows, meters, marks)
        self._short_bars[piece_id] = sorted(short_bars or [], key=lambda short: short.bar)

    def get_short_bars(self, piece_id: str) -> list[ShortBar]:
        return [short.model_copy() for short in self._short_bars.get(piece_id, [])]

    def get_locators(self, piece_id: str) -> list[Locator]:
        stored = self._locators.get(piece_id, {})
        return [stored[key].model_copy(deep=True) for key in sorted(stored)]

    def replace_unconfirmed_locators(self, piece_id: str, locators: list[Locator]) -> None:
        stored = self._locators.get(piece_id, {})
        seen: set[tuple[int, int]] = set()
        for locator in locators:
            key = (locator.bar, locator.pass_index)
            if key in seen:
                raise ValueError(
                    f"locator for bar {locator.bar} pass {locator.pass_index} given twice"
                )
            seen.add(key)
            if key in stored and stored[key].confirmed:
                raise ValueError(
                    f"bar {locator.bar} pass {locator.pass_index} already has a confirmed locator"
                )
        kept = {key: item for key, item in stored.items() if item.confirmed}
        for locator in locators:
            kept[(locator.bar, locator.pass_index)] = locator.model_copy(deep=True)
        self._locators[piece_id] = kept

    def save_page_layer(
        self,
        score_file_id: str,
        pages: list[dict[str, Any]],
        bars: list[BarBox],
        rests: list[int] | None = None,
    ) -> None:
        self._pages[score_file_id] = copy.deepcopy(pages)
        self._bars[score_file_id] = [bar.model_copy() for bar in bars]
        self._rests[score_file_id] = sorted(set(rests or []))

    def get_rests(self, score_file_id: str) -> list[int]:
        return list(self._rests.get(score_file_id, []))

    def list_score_files(self, piece_id: str) -> list[dict[str, Any]]:
        files = sorted(self._score_files.get(piece_id, []), key=lambda f: f["position"])
        return copy.deepcopy(files)

    def list_unrendered_score_files(self, piece_id: str) -> list[dict[str, Any]]:
        return [row for row in self.list_score_files(piece_id) if not self._pages.get(row["id"])]

    def set_part_name(self, score_file_id: str, name: str, source: str = "read") -> None:
        for files in self._score_files.values():
            for row in files:
                if row["id"] == score_file_id:
                    row["name"] = name
                    row["name_source"] = source
                    return
        raise KeyError(score_file_id)

    def set_box_flags(self, score_file_id: str, flags: list[BoxFlag]) -> None:
        for files in self._score_files.values():
            for row in files:
                if row["id"] == score_file_id:
                    self._box_flags[score_file_id] = [flag.model_dump() for flag in flags]
                    return
        raise KeyError(score_file_id)

    def get_audio_source(self, piece_id: str) -> dict[str, Any] | None:
        source = self._audio_sources.get(piece_id)
        return copy.deepcopy(source) if source is not None else None

    def set_audio_stored(self, piece_id: str, stored_path: str, duration_sec: float) -> None:
        source = self._audio_sources[piece_id]  # KeyError when the piece has no recording
        source["stored_path"] = stored_path
        source["duration"] = duration_sec

    def set_audio_name(self, piece_id: str, name: str) -> None:
        self._audio_sources[piece_id]["name"] = name  # KeyError when the piece has no recording

    # --- test helpers (fake only) -----------------------------------------------------------

    def add_piece(self, piece_id: str, owner_id: str) -> None:
        """Create a piece owned by owner_id; like the database trigger, it logs the owner's
        piece_created event."""
        self._owners[piece_id] = owner_id
        self._log_event(owner_id, "piece_created", piece_id, None)

    def pieces_of(self, user_id: str) -> list[str]:
        """The ids of the pieces the user owns, in the order they were made."""
        return [piece for piece, owner in self._owners.items() if owner == user_id]

    def set_sample_master(self, piece_id: str, credits: list[dict[str, Any]]) -> None:
        """Make `piece_id` the sample master, with its credits (as the setting script does)."""
        self._sample_master = piece_id
        self._sample_credits = copy.deepcopy(credits)

    def clear_sample_master(self) -> None:
        """Stop new copies; copies already made stay."""
        self._sample_master = None
        self._sample_credits = []

    def sample_given_of(self, user_id: str) -> bool | None:
        """True: given the sample; False: skipped; None: not marked."""
        return self._sample_marks.get(user_id)

    def sample_credits_of(self, piece_id: str) -> list[dict[str, Any]] | None:
        """The credits kept on a sample copy (pieces.sample_credits); None for any other piece."""
        credits = self._piece_credits.get(piece_id)
        return copy.deepcopy(credits) if credits is not None else None

    def add_admin(self, user_id: str) -> None:
        """Make the user an admin, who is never limited."""
        self._admins.add(user_id)

    def set_plan(self, user_id: str, plan_id: str) -> None:
        """Put the user on a plan ("trial", "creator" or "unlimited"). Users start on Trial."""
        if plan_id not in self._plans:
            raise KeyError(plan_id)
        self._user_plans[user_id] = plan_id

    def set_plan_limits(self, plan_id: str, **values: Any) -> None:
        """Change columns of a plan (any LIMIT_KEYS name; None: no limit)."""
        plan = self._plans[plan_id]
        for key in values:
            if key not in plan or key in ("id", "name", "position"):
                raise KeyError(key)
        plan.update(values)

    def usage_of(self, user_id: str) -> dict[str, int]:
        """The usage block of the user's plan state (pieces created, stored, and so on)."""
        usage: dict[str, int] = self.plan_state(user_id)["usage"]
        return usage

    def events_of(
        self, user_id: str | None = None, kind: str | None = None
    ) -> list[dict[str, Any]]:
        """Copies of the usage events, voided ones included, optionally of one user or kind."""
        return [
            copy.deepcopy(event)
            for event in self._events
            if (user_id is None or event["user_id"] == user_id)
            and (kind is None or event["kind"] == kind)
        ]

    def add_score_file(
        self,
        piece_id: str,
        score_file_id: str,
        storage_path: str,
        *,
        name: str = "Part",
        position: int = 0,
        sha256: str = "",
        page_count: int = 1,
        name_source: str | None = None,
        box_check: bool = False,
    ) -> dict[str, Any]:
        """Add a part's score_files row and return a copy of it.

        A part added with a name has the user's name; with none, its name will come from the
        read, or from the file name.
        """
        row: dict[str, Any] = {
            "id": score_file_id,
            "piece_id": piece_id,
            "storage_path": storage_path,
            "sha256": sha256,
            "page_count": page_count,
            "name": name,
            "name_source": name_source or ("user" if name else "file"),
            "position": position,
            "box_check": box_check,
        }
        self._score_files.setdefault(piece_id, []).append(row)
        return copy.deepcopy(row)

    def set_audio_source(
        self,
        piece_id: str,
        kind: str,
        url_or_path: str,
        duration: float | None = None,
        name: str | None = None,
    ) -> None:
        """Set the piece's recording (kind "file"; an old row may say "youtube") and its name."""
        self._audio_sources[piece_id] = {
            "id": f"audio-{piece_id}",
            "piece_id": piece_id,
            "kind": kind,
            "url_or_path": url_or_path,
            "duration": duration,
            "stored_path": None,
            "name": name,
        }

    def add_locators(self, piece_id: str, locators: list[Locator]) -> None:
        """Insert locators as they are, confirmed or not; a repeated (bar, pass) is a ValueError."""
        stored = self._locators.setdefault(piece_id, {})
        keys = [(item.bar, item.pass_index) for item in locators]
        if len(set(keys)) != len(keys) or any(key in stored for key in keys):
            raise ValueError("a locator for this bar and pass already exists")
        for key, locator in zip(keys, locators, strict=True):
            stored[key] = locator.model_copy(deep=True)

    def get_box_flags(self, score_file_id: str) -> list[dict[str, Any]]:
        """Return what set_box_flags stored for a part (empty when nothing was)."""
        return copy.deepcopy(self._box_flags.get(score_file_id, []))

    def get_page_layer(self, score_file_id: str) -> tuple[list[dict[str, Any]], list[BarBox]]:
        """Return what save_page_layer stored for a part (empty when nothing was saved)."""
        pages = copy.deepcopy(self._pages.get(score_file_id, []))
        bars = [bar.model_copy() for bar in self._bars.get(score_file_id, [])]
        return pages, bars


def _copy_structure(
    rows: list[PlayOrderRow], meters: list[MeterChange], marks: list[BarMark]
) -> Structure:
    return (
        [row.model_copy() for row in rows],
        [meter.model_copy() for meter in meters],
        [mark.model_copy() for mark in marks],
    )
