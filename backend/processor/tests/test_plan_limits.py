import re
from pathlib import Path

import pytest

from app.pipeline.plan_limits import LIMIT_KEYS, PlanRefused, decide

# The 16 limit keys of the plans contract, in its order (the `plans` columns minus id, name and
# position). The frontend's PLAN_LIMITS lists the same keys; a later task compares both with
# migration 0015.
EXPECTED_KEYS = (
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

TRIAL = {
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


def state(
    plan: dict | None = None,
    *,
    admin: bool = False,
    reading_used: int = 0,
    realigns: int | None = 0,
    **limits: object,
) -> dict:
    return {
        "is_admin": admin,
        "plan": {**(plan or TRIAL), **limits},
        "usage": {
            "pieces_created": 0,
            "pieces_stored": 0,
            "shared_pieces": 0,
            "advanced_reading_parts_this_month": reading_used,
            "new_pieces_today_on_plan": 0,
        },
        "piece": (
            None
            if realigns is None
            else {"id": "p", "parts": 1, "realigns": realigns, "read_again_by_part": {}}
        ),
    }


def test_the_keys_are_the_contracts_sixteen_in_order() -> None:
    assert LIMIT_KEYS == EXPECTED_KEYS
    assert len(set(LIMIT_KEYS)) == 16


def test_a_refusal_carries_its_key_and_the_stored_text() -> None:
    refused = PlanRefused("pages_per_part_max")
    assert refused.limit == "pages_per_part_max"
    assert str(refused) == "plan_limit:pages_per_part_max"


def test_an_unknown_action_is_a_programming_error() -> None:
    with pytest.raises(ValueError, match="no such action"):
        decide(state(), "teleport")


# --- add_parts: parts_per_piece_max against parts_after ----------------------------------------


def test_add_parts_at_the_limit_is_allowed_and_one_over_is_refused() -> None:
    assert decide(state(), "add_parts", parts_after=1) is None
    assert decide(state(), "add_parts", parts_after=2) == "parts_per_piece_max"


def test_add_parts_with_no_limit_is_allowed() -> None:
    assert decide(state(parts_per_piece_max=None), "add_parts", parts_after=99) is None


# --- split_pdf, suggest_name: switches ---------------------------------------------------------


def test_split_pdf_is_a_switch() -> None:
    assert decide(state(), "split_pdf") == "split_pdf"
    assert decide(state(split_pdf=True), "split_pdf") is None


def test_suggest_name_is_a_switch() -> None:
    assert decide(state(), "suggest_name") is None
    assert decide(state(suggest_name=False), "suggest_name") == "suggest_name"


# --- advanced_reading: the switch, then this month's parts -------------------------------------


def test_advanced_reading_checks_the_switch_first() -> None:
    assert decide(state(), "advanced_reading", parts=1) == "advanced_reading"
    # off wins even when the monthly count would also be over
    assert decide(state(reading_used=99), "advanced_reading", parts=1) == "advanced_reading"


def test_advanced_reading_counts_this_months_parts() -> None:
    on = {"advanced_reading": True, "advanced_reading_parts_per_month": 30}
    assert decide(state(reading_used=27, **on), "advanced_reading", parts=3) is None
    assert (
        decide(state(reading_used=27, **on), "advanced_reading", parts=4)
        == "advanced_reading_parts_per_month"
    )
    assert (
        decide(state(reading_used=30, **on), "advanced_reading", parts=1)
        == "advanced_reading_parts_per_month"
    )


def test_advanced_reading_with_no_monthly_limit_is_allowed() -> None:
    free = state(advanced_reading=True, advanced_reading_parts_per_month=None, reading_used=500)
    assert decide(free, "advanced_reading", parts=50) is None


# --- recording: recording_minutes_max * 60 against the seconds ---------------------------------


def test_recording_ten_minutes_is_allowed_and_one_second_over_is_refused() -> None:
    assert decide(state(), "recording", seconds=600) is None
    assert decide(state(), "recording", seconds=601) == "recording_minutes_max"
    assert decide(state(recording_minutes_max=None), "recording", seconds=100000) is None


# --- pages: pages_per_part_max against the part's page count -----------------------------------


def test_pages_twenty_is_allowed_and_twenty_one_is_refused() -> None:
    assert decide(state(), "pages", pages=20) is None
    assert decide(state(), "pages", pages=21) == "pages_per_part_max"
    assert decide(state(pages_per_part_max=None), "pages", pages=500) is None


# --- realign: realign_per_piece_max against this piece's realigns -------------------------------


def test_realign_counts_the_pieces_realigns() -> None:
    assert decide(state(realigns=4), "realign") is None
    assert decide(state(realigns=5), "realign") == "realign_per_piece_max"
    assert decide(state(realigns=50, realign_per_piece_max=None), "realign") is None


def test_realign_without_a_piece_block_is_allowed() -> None:
    assert decide(state(realigns=None), "realign") is None


# --- the admin and nulls -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("action", "facts"),
    [
        ("add_parts", {"parts_after": 50}),
        ("split_pdf", {}),
        ("advanced_reading", {"parts": 50}),
        ("suggest_name", {}),
        ("recording", {"seconds": 99999}),
        ("pages", {"pages": 500}),
        ("realign", {}),
    ],
)
def test_the_admin_is_never_refused(action: str, facts: dict) -> None:
    locked = state(
        admin=True,
        suggest_name=False,
        parts_per_piece_max=0,
        pages_per_part_max=1,
        recording_minutes_max=1,
        realign_per_piece_max=0,
        realigns=9,
    )
    assert decide(locked, action, **facts) is None


def test_a_state_with_every_limit_null_allows_everything() -> None:
    nulls = {key: None for key in LIMIT_KEYS if key not in ("suggest_name",)}
    nulls.update(advanced_reading=True, split_pdf=True, suggest_name=True)
    open_state = state(realigns=1000, reading_used=1000, **nulls)
    assert decide(open_state, "add_parts", parts_after=9) is None
    assert decide(open_state, "split_pdf") is None
    assert decide(open_state, "advanced_reading", parts=9) is None
    assert decide(open_state, "suggest_name") is None
    assert decide(open_state, "recording", seconds=10**6) is None
    assert decide(open_state, "pages", pages=10**4) is None
    assert decide(open_state, "realign") is None


MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def create_table_columns(sql: str) -> list[str]:
    """Column names of `create table public.plans`, in order (comments dropped)."""
    start = re.search(r"create table public\.plans\s*\(", sql)
    assert start, "no create table public.plans"
    body, depth = "", 1
    for char in strip_comments(sql[start.end() :]):
        depth += (char == "(") - (char == ")")
        if depth == 0:
            break
        body += char
    parts, level, current = [], 0, ""
    for char in body:
        level += (char == "(") - (char == ")")
        if char == "," and level == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)
    return [part.split()[0] for part in parts if part.strip()]


def plans_columns_after(migrations: list[str]) -> list[str]:
    """The columns of public.plans once every migration (the SQL texts, in order) has run: the
    create table, then each later `alter table public.plans add / drop / rename column`."""
    columns: list[str] = []
    alter = re.compile(
        r"alter\s+table\s+(?:if\s+exists\s+)?public\.plans\s+(.*?);", re.IGNORECASE | re.DOTALL
    )
    for sql in migrations:
        if re.search(r"create table public\.plans\s*\(", sql):
            columns = create_table_columns(sql)
        for statement in alter.findall(strip_comments(sql)):
            for action in re.split(
                r",\s*(?=add\s|drop\s|rename\s|alter\s)", statement, flags=re.IGNORECASE
            ):
                added = re.match(
                    r"add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?\"?(\w+)\"?",
                    action.strip(),
                    re.IGNORECASE,
                )
                dropped = re.match(
                    r"drop\s+column\s+(?:if\s+exists\s+)?\"?(\w+)\"?", action.strip(), re.IGNORECASE
                )
                renamed = re.match(
                    r"rename\s+(?:column\s+)?\"?(\w+)\"?\s+to\s+\"?(\w+)\"?",
                    action.strip(),
                    re.IGNORECASE,
                )
                if renamed:
                    columns = [renamed.group(2) if c == renamed.group(1) else c for c in columns]
                elif dropped:
                    columns = [c for c in columns if c != dropped.group(1)]
                elif added and added.group(1).lower() not in (
                    "constraint",
                    "primary",
                    "foreign",
                    "unique",
                    "check",
                ):
                    columns.append(added.group(1))
    return columns


def all_migrations() -> list[str]:
    return [path.read_text() for path in sorted(MIGRATIONS.glob("*.sql"))]


def test_the_column_reader_follows_later_migrations():
    base = (
        "create table public.plans (id text primary key, name text, position integer, "
        "a_max integer check (a_max >= 0), b boolean not null default false);"
    )
    later = [
        "-- adds one\nalter table public.plans add column foo_max integer check (foo_max >= 0);",
        "alter table public.plans drop column a_max, "
        "add column if not exists bar boolean not null default false;",
        "alter table public.plans rename column b to b2;",
        "alter table public.plans add constraint plans_name_len check (char_length(name) > 0);",
    ]
    assert plans_columns_after([base]) == ["id", "name", "position", "a_max", "b"]
    assert plans_columns_after([base, *later]) == ["id", "name", "position", "b2", "foo_max", "bar"]


def test_limit_keys_are_the_plans_columns_minus_id_name_and_position():
    columns = plans_columns_after(all_migrations())
    assert columns[:3] == ["id", "name", "position"]
    assert list(LIMIT_KEYS) == [c for c in columns if c not in ("id", "name", "position")]


def test_a_later_migration_that_adds_a_column_makes_the_cross_check_fail():
    """The point of reading every migration: a 0016 adding foo_max must not stay green."""
    columns = plans_columns_after(
        [*all_migrations(), "alter table public.plans add column foo_max integer;"]
    )
    assert list(LIMIT_KEYS) != [c for c in columns if c not in ("id", "name", "position")]
