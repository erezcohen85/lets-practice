from typing import Any

# The plan rules, decided in one pure place. The database holds the plans and the usage
# (`service_plan_state`); this module only says which limit, if any, an action runs into. The
# browser has the same rules in frontend/src/domain/planLimits.ts (`allowed`). A null limit means
# no limit; the admin is never limited.

# The `plans` columns minus id, name and position, in the contract's order.
LIMIT_KEYS: tuple[str, ...] = (
    "pieces_created_max",
    "pieces_stored_max",
    "parts_per_piece_max",
    "pages_per_part_max",
    "recording_minutes_max",
    "advanced_reading",
    "advanced_reading_parts_per_month",
    "split_pdf",
    "suggest_name",
    "shared_pieces_max",
    "members_per_piece",
    "members_per_part",
    "read_again_per_part_max",
    "realign_per_piece_max",
    "new_pieces_per_day",
    "new_pieces_paused",
)

# What a refused job stores in jobs.error; the browser turns it into the plan sentence.
JOB_ERROR_PREFIX = "plan_limit:"


class PlanRefused(Exception):
    """A plan limit stopped the work. `str(error)` is what a refused job stores in jobs.error."""

    def __init__(self, limit: str) -> None:
        super().__init__(f"{JOB_ERROR_PREFIX}{limit}")
        self.limit = limit


def _over(limit: Any, used: float) -> bool:
    """True when `used` is more than the count limit allows (no limit: never)."""
    return limit is not None and used > limit


def decide(state: dict[str, Any], action: str, **facts: Any) -> str | None:
    """The limit key `action` runs into under `state` (the plan state JSON), or None if allowed.

    Actions and their facts: "add_parts" (parts_after: the parts the piece would have),
    "split_pdf", "advanced_reading" (parts: how many parts will be read), "suggest_name",
    "recording" (seconds), "pages" (pages: one part's page count), "realign".
    """
    if action not in _ACTIONS:
        raise ValueError(f"no such action: {action}")
    if state.get("is_admin"):
        return None
    return _ACTIONS[action](state["plan"], state, facts)


def _add_parts(plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]) -> str | None:
    if _over(plan.get("parts_per_piece_max"), facts["parts_after"]):
        return "parts_per_piece_max"
    return None


def _split_pdf(plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]) -> str | None:
    return None if plan.get("split_pdf") else "split_pdf"


def _suggest_name(plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]) -> str | None:
    return None if plan.get("suggest_name") else "suggest_name"


def _advanced_reading(
    plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]
) -> str | None:
    if not plan.get("advanced_reading"):
        return "advanced_reading"
    used = state.get("usage", {}).get("advanced_reading_parts_this_month", 0)
    if _over(plan.get("advanced_reading_parts_per_month"), used + facts["parts"]):
        return "advanced_reading_parts_per_month"
    return None


def _recording(plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]) -> str | None:
    minutes = plan.get("recording_minutes_max")
    if minutes is not None and facts["seconds"] > minutes * 60:
        return "recording_minutes_max"
    return None


def _pages(plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]) -> str | None:
    if _over(plan.get("pages_per_part_max"), facts["pages"]):
        return "pages_per_part_max"
    return None


def _realign(plan: dict[str, Any], state: dict[str, Any], facts: dict[str, Any]) -> str | None:
    piece = state.get("piece")
    limit = plan.get("realign_per_piece_max")
    if piece is not None and limit is not None and piece["realigns"] >= limit:
        return "realign_per_piece_max"
    return None


_ACTIONS = {
    "add_parts": _add_parts,
    "split_pdf": _split_pdf,
    "advanced_reading": _advanced_reading,
    "suggest_name": _suggest_name,
    "recording": _recording,
    "pages": _pages,
    "realign": _realign,
}
