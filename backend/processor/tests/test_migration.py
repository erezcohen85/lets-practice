"""Checks on `backend/supabase/migrations/0001_init.sql`.

There is no database in this environment. The first half reads the SQL as text with simple regexes
(task 3.1 and 3.2); the last section parses the file with pglast and checks row-level security from
the parse tree (task 3.3).
"""

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import pglast
import pytest
from pglast import ast, enums
from pglast.visitors import Visitor

MIGRATION = Path(__file__).resolve().parents[2] / "supabase/migrations/0001_init.sql"

TABLES = {
    "profiles",
    "pieces",
    "score_files",
    "score_pages",
    "bars",
    "audio_sources",
    "play_order",
    "locators",
    "jobs",
}

# Every column that references another table: (table, column) -> referenced table.
FOREIGN_KEYS = {
    ("profiles", "id"): "auth.users",
    ("pieces", "owner_id"): "auth.users",
    ("score_files", "piece_id"): "public.pieces",
    ("score_pages", "score_file_id"): "public.score_files",
    ("bars", "score_file_id"): "public.score_files",
    ("audio_sources", "piece_id"): "public.pieces",
    ("play_order", "piece_id"): "public.pieces",
    ("locators", "piece_id"): "public.pieces",
    ("jobs", "piece_id"): "public.pieces",
}

CONSTRAINT_WORDS = ("unique", "constraint", "primary", "foreign", "check", "exclude")


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _body_after(text: str, open_index: int) -> str:
    """The text between the parenthesis at `open_index` and its matching close."""
    depth = 0
    for index in range(open_index, len(text)):
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : index]
    raise AssertionError("unbalanced parentheses in the migration")


def _split_top_level(body: str) -> list[str]:
    items: list[str] = []
    depth = 0
    current: list[str] = []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            items.append("".join(current))
            current = []
        else:
            current.append(char)
    items.append("".join(current))
    return [" ".join(item.split()) for item in items if item.strip()]


def _check_clauses(definition: str) -> list[str]:
    clauses = []
    for match in re.finditer(r"\bcheck\s*\(", definition):
        clauses.append(" ".join(_body_after(definition, match.end() - 1).split()))
    return clauses


@pytest.fixture(scope="module")
def sql() -> str:
    assert MIGRATION.is_file(), f"missing migration: {MIGRATION}"
    return _strip_comments(MIGRATION.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def tables(sql: str) -> dict[str, list[str]]:
    """Table name -> its top-level definitions (columns and table constraints)."""
    found: dict[str, list[str]] = {}
    for match in re.finditer(r"create\s+table\s+public\.(\w+)\s*\(", sql):
        found[match.group(1)] = _split_top_level(_body_after(sql, match.end() - 1))
    return found


@pytest.fixture(scope="module")
def columns(tables: dict[str, list[str]]) -> dict[str, dict[str, str]]:
    """Table name -> {column name: full column definition}."""
    result: dict[str, dict[str, str]] = {}
    for table, items in tables.items():
        result[table] = {
            item.split()[0]: item
            for item in items
            if item.split()[0].lower() not in CONSTRAINT_WORDS
        }
    return result


def test_migration_file_exists() -> None:
    assert MIGRATION.is_file()


def test_creates_exactly_the_nine_tables(sql: str, tables: dict[str, list[str]]) -> None:
    assert set(tables) == TABLES
    assert len(tables) == len(TABLES)
    # Every table is spelled `create table public.<name>`: no unqualified or extra statement.
    assert len(re.findall(r"\bcreate\s+table\b", sql)) == len(TABLES)


def test_row_level_security_section_comes_last() -> None:
    text = MIGRATION.read_text(encoding="utf-8")
    marker = "-- Row-level security (task 3.2)"
    assert marker in text
    before, after = text.split(marker, 1)
    # Task 3.1 stops at the marker: nothing of the security layer is above it...
    for word in ("row level security", "create policy", "create trigger", "create function"):
        assert word not in _strip_comments(before), f"{word!r} belongs under the marker"
    assert "storage." not in _strip_comments(before)
    # ...and task 3.2 fills everything below it.
    assert "enable row level security" in _strip_comments(after)
    assert "create policy" in _strip_comments(after)


def test_no_naive_timestamps_and_no_uppercase_keywords(sql: str) -> None:
    assert not re.search(r"\btimestamp\b", sql), "use timestamptz"
    assert not re.search(r"\b(CREATE|TABLE|INDEX|REFERENCES|NOT NULL|DEFAULT)\b", sql)


def test_every_table_but_profiles_has_a_uuid_primary_key(
    columns: dict[str, dict[str, str]],
) -> None:
    for table in TABLES - {"profiles"}:
        definition = columns[table]["id"]
        assert re.fullmatch(r"id uuid primary key default gen_random_uuid\(\)", definition), (
            f"{table}.id: {definition}"
        )
    assert re.search(r"id uuid primary key references auth\.users", columns["profiles"]["id"])


def test_foreign_key_columns_are_the_expected_ones(
    columns: dict[str, dict[str, str]],
) -> None:
    found = {}
    for table, cols in columns.items():
        for name, definition in cols.items():
            match = re.search(r"\breferences\s+([\w.]+)", definition)
            if match:
                found[(table, name)] = match.group(1)
    assert found == FOREIGN_KEYS


def test_every_foreign_key_cascades_on_delete(columns: dict[str, dict[str, str]]) -> None:
    for table, column in FOREIGN_KEYS:
        definition = columns[table][column]
        assert re.search(r"\bon delete cascade\b", definition), f"{table}.{column}: {definition}"


def test_every_foreign_key_column_has_a_create_index(
    sql: str, columns: dict[str, dict[str, str]]
) -> None:
    indexed = set()
    for match in re.finditer(
        r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+public\.(\w+)"
        r"\s*(?:using\s+\w+\s*)?\(\s*(\w+)",
        sql,
    ):
        indexed.add((match.group(1), match.group(2)))
    for table, column in FOREIGN_KEYS:
        if "primary key" in columns[table][column]:
            continue  # the primary key already has an index (profiles.id)
        assert (table, column) in indexed, f"no create index on {table}.{column}"


def test_every_create_index_targets_a_known_table_and_column(
    sql: str, columns: dict[str, dict[str, str]]
) -> None:
    indexes = re.findall(
        r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+public\.(\w+)"
        r"\s*(?:using\s+\w+\s*)?\(([^)]*)\)",
        sql,
    )
    assert indexes
    names = [name for name, _, _ in indexes]
    assert len(names) == len(set(names)), "duplicate index names"
    for _, table, column_list in indexes:
        assert table in TABLES
        for column in (part.strip().split()[0] for part in column_list.split(",")):
            assert column in columns[table], f"{table} has no column {column}"


def test_locators_are_unique_per_piece_bar_and_pass(tables: dict[str, list[str]]) -> None:
    uniques = [
        re.sub(r"\s+", "", item.lower())
        for item in tables["locators"]
        if item.lower().startswith("unique")
    ]
    assert "unique(piece_id,bar_number,pass_index)" in uniques


def test_locators_columns(columns: dict[str, dict[str, str]]) -> None:
    cols = columns["locators"]
    assert set(cols) == {"id", "piece_id", "pass_index", "bar_number", "time_sec", "confirmed"}
    assert "integer not null" in cols["pass_index"]
    assert any(re.fullmatch(r"pass_index\s*>=\s*0", c) for c in _check_clauses(cols["pass_index"]))
    assert any(re.fullmatch(r"bar_number\s*>=\s*1", c) for c in _check_clauses(cols["bar_number"]))
    assert "double precision not null" in cols["time_sec"]
    assert any(re.fullmatch(r"time_sec\s*>=\s*0", c) for c in _check_clauses(cols["time_sec"]))
    assert re.search(r"boolean not null default false", cols["confirmed"])


def test_jobs_check_kind_status_and_progress(columns: dict[str, dict[str, str]]) -> None:
    cols = columns["jobs"]
    assert set(cols) == {
        "id",
        "piece_id",
        "kind",
        "status",
        "progress",
        "error",
        "created_at",
        "updated_at",
    }

    def literals(column: str) -> set[str]:
        clauses = [c for c in _check_clauses(cols[column]) if re.match(rf"{column}\s+in\b", c)]
        assert len(clauses) == 1, f"jobs.{column} needs one `check ({column} in (...))`"
        return set(re.findall(r"'([^']+)'", clauses[0]))

    assert literals("kind") == {"process-piece", "realign"}
    assert literals("status") == {"queued", "running", "done", "error"}
    assert re.search(r"\bdefault 'queued'", cols["status"])
    assert re.search(r"\bnot null\b", cols["kind"]) and re.search(r"\bnot null\b", cols["status"])

    assert re.search(r"\breal not null default 0\b", cols["progress"])
    assert any(
        re.fullmatch(r"progress\s+between\s+0\s+and\s+1", c)
        for c in _check_clauses(cols["progress"])
    )
    for column in ("created_at", "updated_at"):
        assert re.search(r"timestamptz not null default now\(\)", cols[column])


def test_play_order_piece_id_is_unique(sql: str, columns: dict[str, dict[str, str]]) -> None:
    inline = re.search(r"\bunique\b", columns["play_order"]["piece_id"])
    unique_index = re.search(
        r"create\s+unique\s+index\s+\w+\s+on\s+public\.play_order\s*\(\s*piece_id\s*\)", sql
    )
    assert inline or unique_index


def test_play_order_holds_rows_meters_and_marks(columns: dict[str, dict[str, str]]) -> None:
    cols = columns["play_order"]
    assert set(cols) == {"id", "piece_id", "rows", "meters", "marks"}
    for column in ("rows", "meters", "marks"):
        assert re.search(r"jsonb not null default '\[\]'", cols[column]), cols[column]


def test_pieces_owner_id_defaults_to_auth_uid(columns: dict[str, dict[str, str]]) -> None:
    cols = columns["pieces"]
    assert set(cols) == {"id", "owner_id", "title", "count_in_bars", "created_at"}
    assert re.search(r"\buuid not null default auth\.uid\(\)", cols["owner_id"])
    assert re.search(r"\breferences auth\.users\b", cols["owner_id"])
    assert "text not null" in cols["title"]
    assert "timestamptz not null default now()" in cols["created_at"]


def test_pieces_remember_the_count_in_length(columns: dict[str, dict[str, str]]) -> None:
    """Decisions 2026-10-29: the count-in length is stored per piece, 0 = off, default 1 bar."""
    definition = columns["pieces"]["count_in_bars"]
    assert re.search(r"\bsmallint not null default 1\b", definition), definition
    assert _check_clauses(definition) == ["count_in_bars between 0 and 4"]


def test_profiles_columns(columns: dict[str, dict[str, str]]) -> None:
    cols = columns["profiles"]
    assert set(cols) == {"id", "accepted_terms_at", "settings"}
    assert "timestamptz" in cols["accepted_terms_at"]
    assert re.search(r"jsonb not null default '\{\}'", cols["settings"])


def test_score_files_carry_the_part_columns(columns: dict[str, dict[str, str]]) -> None:
    cols = columns["score_files"]
    assert set(cols) == {
        "id",
        "piece_id",
        "storage_path",
        "sha256",
        "page_count",
        "name",
        "position",
    }
    assert "text not null" in cols["name"]
    assert re.search(r"integer not null default 0", cols["position"])


def test_score_pages_and_bars_are_unique_per_file(tables: dict[str, list[str]]) -> None:
    def uniques(table: str) -> list[str]:
        return [
            re.sub(r"\s+", "", item.lower())
            for item in tables[table]
            if item.lower().startswith("unique")
        ]

    assert "unique(score_file_id,page_index)" in uniques("score_pages")
    assert "unique(score_file_id,bar_number)" in uniques("bars")


def test_bars_columns(columns: dict[str, dict[str, str]]) -> None:
    assert set(columns["bars"]) == {
        "id",
        "score_file_id",
        "bar_number",
        "page_index",
        "x",
        "y",
        "w",
        "h",
        "time_sig",
    }
    assert set(columns["score_pages"]) == {
        "id",
        "score_file_id",
        "page_index",
        "image_path",
        "width",
        "height",
    }


def test_audio_sources_kind_still_allows_old_youtube_rows(
    columns: dict[str, dict[str, str]],
) -> None:
    cols = columns["audio_sources"]
    assert set(cols) == {"id", "piece_id", "kind", "url_or_path", "duration"}
    clauses = [c for c in _check_clauses(cols["kind"]) if re.match(r"kind\s+in\b", c)]
    assert len(clauses) == 1
    assert set(re.findall(r"'([^']+)'", clauses[0])) == {"youtube", "file"}
    assert "text not null" in cols["url_or_path"]


# --- Row-level security (task 3.2) ---------------------------------------------------------

COMMANDS = {"select", "insert", "update", "delete"}
# Direct children of `pieces` that the owner may fully manage.
PIECE_CHILDREN = {"score_files", "audio_sources", "play_order", "locators"}
# Children of `score_files`: ownership runs through score_files to pieces.
FILE_CHILDREN = {"score_pages", "bars"}
EXPECTED_COMMANDS = {
    "profiles": {"select", "insert", "update"},
    "jobs": {"select"},  # the processor writes jobs with the server key, which bypasses RLS
    "pieces": COMMANDS,
    **{table: COMMANDS for table in PIECE_CHILDREN | FILE_CHILDREN},
}
WRAPPED_UID = r"\(select auth\.uid\(\)\)"


@dataclass(frozen=True)
class Policy:
    name: str
    table: str  # as written: "public.pieces" or "storage.objects"
    command: str | None
    roles: str | None
    using: str | None
    check: str | None
    text: str  # the whole statement, whitespace collapsed


def _squash(expression: str) -> str:
    """Collapse whitespace and drop the space inside parentheses, for stable matching."""
    one_line = " ".join(expression.split())
    return re.sub(r"\s+\)", ")", re.sub(r"\(\s+", "(", one_line))


def _clause(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    return _squash(_body_after(text, match.end() - 1)) if match else None


@pytest.fixture(scope="module")
def policies(sql: str) -> list[Policy]:
    found = []
    for match in re.finditer(r"\bcreate\s+policy\s+(\w+)\s+on\s+([\w.]+)([^;]*);", sql):
        rest = match.group(3)
        header = re.split(r"\b(?:using|with\s+check)\b", rest, maxsplit=1)[0]
        command = re.search(r"\bfor\s+(\w+)", header)
        roles = re.search(r"\bto\s+(\w+(?:\s*,\s*\w+)*)", header)
        found.append(
            Policy(
                name=match.group(1),
                table=match.group(2),
                command=command.group(1) if command else None,
                roles=_squash(roles.group(1)) if roles else None,
                using=_clause(rest, r"\busing\s*\("),
                check=_clause(rest, r"\bwith\s+check\s*\("),
                text=_squash(match.group(0)),
            )
        )
    return found


def _on(policies: list[Policy], table: str) -> list[Policy]:
    return [policy for policy in policies if policy.table == table]


def _expressions(policy: Policy) -> list[str]:
    return [expression for expression in (policy.using, policy.check) if expression]


@pytest.fixture(scope="module")
def storage_policies(policies: list[Policy]) -> list[Policy]:
    return _on(policies, "storage.objects")


def test_every_table_has_row_level_security_enabled(sql: str) -> None:
    enabled = re.findall(r"\balter\s+table\s+([\w.]+)\s+enable\s+row\s+level\s+security\b", sql)
    assert sorted(enabled) == sorted(f"public.{table}" for table in TABLES)
    # Every enable statement is complete: no other spelling slipped in.
    assert len(re.findall(r"\benable\s+row\s+level\s+security\b", sql)) == len(TABLES)


def test_every_table_has_at_least_one_policy(policies: list[Policy]) -> None:
    for table in TABLES:
        assert _on(policies, f"public.{table}"), f"no create policy on public.{table}"


def test_policies_only_target_the_nine_tables_and_storage_objects(policies: list[Policy]) -> None:
    allowed = {f"public.{table}" for table in TABLES} | {"storage.objects"}
    assert policies
    assert {policy.table for policy in policies} <= allowed
    assert len(re.findall(r"\bcreate\s+policy\b", " ".join(p.text for p in policies))) == len(
        policies
    )


def test_each_table_has_exactly_the_planned_commands(policies: list[Policy]) -> None:
    assert set(EXPECTED_COMMANDS) == TABLES
    for table, commands in EXPECTED_COMMANDS.items():
        found = [policy.command for policy in _on(policies, f"public.{table}")]
        assert sorted(found, key=str) == sorted(commands), f"{table}: {found}"  # one per command


def test_policy_names_are_unique_per_table(policies: list[Policy]) -> None:
    pairs = [(policy.table, policy.name) for policy in policies]
    assert pairs
    assert len(pairs) == len(set(pairs))


def test_jobs_has_a_select_policy_and_no_write_policy(sql: str, policies: list[Policy]) -> None:
    jobs = _on(policies, "public.jobs")
    assert [policy.command for policy in jobs] == ["select"]
    assert not re.search(r"\bon\s+public\.jobs\s+for\s+(insert|update|delete|all)\b", sql)


def test_every_policy_is_for_one_command_never_all(policies: list[Policy]) -> None:
    assert policies
    for policy in policies:
        assert policy.command in COMMANDS, f"{policy.name}: for {policy.command}"


def test_using_and_with_check_match_the_command(policies: list[Policy]) -> None:
    assert policies
    for policy in policies:
        if policy.command in ("select", "delete"):
            assert policy.using and not policy.check, policy.name
        elif policy.command == "insert":
            assert policy.check and not policy.using, policy.name
        else:  # update needs both: which rows may be edited, and what they may become
            assert policy.using and policy.check, policy.name


def test_every_policy_names_to_authenticated(policies: list[Policy]) -> None:
    assert policies
    for policy in policies:
        assert policy.roles == "authenticated", f"{policy.name}: to {policy.roles}"


def test_no_policy_uses_a_bare_auth_uid(policies: list[Policy]) -> None:
    assert policies
    for policy in policies:
        wrapped_removed = re.sub(rf"(?i){WRAPPED_UID}", "", policy.text.replace("( ", "("))
        assert not re.search(r"\bauth\.uid\s*\(", wrapped_removed), (
            f"{policy.name} uses auth.uid() outside (select auth.uid()): {policy.text}"
        )


def test_every_policy_compares_against_the_wrapped_auth_uid(policies: list[Policy]) -> None:
    assert policies
    for policy in policies:
        for expression in _expressions(policy):
            assert re.search(WRAPPED_UID, expression), f"{policy.name}: {expression}"


def test_profiles_policies_match_the_row_id_to_the_user(policies: list[Policy]) -> None:
    assert _on(policies, "public.profiles")
    for policy in _on(policies, "public.profiles"):
        for expression in _expressions(policy):
            assert re.fullmatch(rf"id = {WRAPPED_UID}", expression), f"{policy.name}: {expression}"


def test_pieces_policies_match_the_owner_to_the_user(policies: list[Policy]) -> None:
    assert _on(policies, "public.pieces")
    for policy in _on(policies, "public.pieces"):
        for expression in _expressions(policy):
            assert re.fullmatch(rf"owner_id = {WRAPPED_UID}", expression), (
                f"{policy.name}: {expression}"
            )


def test_children_of_pieces_check_ownership_through_pieces(policies: list[Policy]) -> None:
    for table in PIECE_CHILDREN | {"jobs"}:
        assert _on(policies, f"public.{table}"), table
        for policy in _on(policies, f"public.{table}"):
            for expression in _expressions(policy):
                assert re.fullmatch(
                    r"exists\s*\(select 1 from public\.pieces (?:as )?p "
                    rf"where p\.id = {table}\.piece_id and p\.owner_id = {WRAPPED_UID}\)",
                    expression,
                ), f"{policy.name}: {expression}"


def test_grandchildren_check_ownership_through_score_files_and_pieces(
    policies: list[Policy],
) -> None:
    for table in FILE_CHILDREN:
        assert _on(policies, f"public.{table}"), table
        for policy in _on(policies, f"public.{table}"):
            for expression in _expressions(policy):
                assert re.fullmatch(
                    r"exists\s*\(select 1 from public\.score_files (?:as )?f "
                    r"join public\.pieces (?:as )?p on p\.id = f\.piece_id "
                    rf"where f\.id = {table}\.score_file_id and p\.owner_id = {WRAPPED_UID}\)",
                    expression,
                ), f"{policy.name}: {expression}"


def test_the_pieces_storage_bucket_is_created_private(sql: str) -> None:
    match = re.search(
        r"\binsert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)"
        r"\s*on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing\s*;",
        sql,
    )
    assert match, (
        "missing: insert into storage.buckets (...) values (...) on conflict (id) do nothing"
    )
    names = [name.strip() for name in match.group(1).split(",")]
    values = [value.strip() for value in match.group(2).split(",")]
    assert dict(zip(names, values, strict=True)) == {
        "id": "'pieces'",
        "name": "'pieces'",
        "public": "false",
    }
    assert len(re.findall(r"\binsert\s+into\s+storage\.buckets\b", sql)) == 1


def test_four_storage_policies_confine_each_user_to_their_own_folder(
    storage_policies: list[Policy],
) -> None:
    assert sorted(policy.command for policy in storage_policies) == sorted(COMMANDS)
    for policy in storage_policies:
        for expression in _expressions(policy):
            assert re.fullmatch(
                r"bucket_id = 'pieces' and "
                rf"\(storage\.foldername\(name\)\)\[1\] = {WRAPPED_UID}::text",
                expression,
            ), f"{policy.name}: {expression}"


def _function(sql: str, name: str) -> tuple[str, str]:
    """(header, body) of `create function <name>() ... as $$ body $$;`"""
    match = re.search(
        rf"\bcreate\s+(?:or\s+replace\s+)?function\s+{re.escape(name)}\s*\(\s*\)(.*?)\$\$(.*?)\$\$\s*;",
        sql,
        re.DOTALL,
    )
    assert match, f"missing function {name}"
    return _squash(match.group(1)), _squash(match.group(2))


def test_handle_new_user_is_a_hardened_security_definer_trigger_function(sql: str) -> None:
    header, body = _function(sql, "public.handle_new_user")
    assert re.search(r"\breturns trigger\b", header)
    assert re.search(r"\blanguage plpgsql\b", header)
    assert re.search(r"\bsecurity definer\b", header)
    assert re.search(r"\bset search_path = ''", header)
    # Fully qualified names only, because the search path is empty.
    assert re.search(r"\binsert into public\.profiles \(id\) values \(new\.id\)", body)
    assert re.search(r"\breturn new\b", body)


def test_every_security_definer_function_pins_an_empty_search_path(sql: str) -> None:
    definers = list(
        re.finditer(r"\bcreate\s+(?:or\s+replace\s+)?function\b(.*?)\$\$", sql, re.DOTALL)
    )
    assert definers
    for match in definers:
        header = _squash(match.group(1))
        if "security definer" in header:
            assert re.search(r"\bset search_path = ''", header), header


def test_a_trigger_creates_the_profile_for_each_new_user(sql: str) -> None:
    triggers = [_squash(m.group(0)) for m in re.finditer(r"\bcreate\s+trigger\b[^;]*;", sql)]
    assert triggers == [
        "create trigger on_auth_user_created after insert on auth.users "
        "for each row execute function public.handle_new_user();"
    ]


# ---------------------------------------------------------------------------------------------
# Parse-tree checks (task 3.3): the same migration read by the real Postgres parser (pglast), so
# the row-level security rules are checked on statements, not on text.


def _read_migration() -> str:
    assert MIGRATION.is_file(), f"missing migration: {MIGRATION}"
    return MIGRATION.read_text(encoding="utf-8")


class _Mentions(Visitor):
    """Collects the string constants and function names inside one expression."""

    def __init__(self) -> None:
        super().__init__()
        self.strings: set[str] = set()
        self.functions: set[str] = set()

    def visit_A_Const(self, ancestors: object, node: ast.A_Const) -> None:
        if isinstance(node.val, ast.String):
            self.strings.add(node.val.sval)

    def visit_FuncCall(self, ancestors: object, node: ast.FuncCall) -> None:
        self.functions.add(".".join(part.sval for part in node.funcname))


@dataclass(frozen=True)
class Expr:
    """What a policy expression mentions, read from its parse tree."""

    strings: frozenset[str]
    functions: frozenset[str]


def _mentions(node: ast.Node) -> Expr:
    visitor = _Mentions()
    visitor(node)
    return Expr(frozenset(visitor.strings), frozenset(visitor.functions))


@dataclass(frozen=True)
class TreePolicy:
    """One `create policy` statement."""

    name: str
    table: str  # schema-qualified, as written: "public.pieces" or "storage.objects"
    command: str  # select, insert, update, delete or all
    roles: tuple[str, ...]
    permissive: bool
    expressions: tuple[Expr, ...]  # USING and WITH CHECK, whichever are present


def _qualified(relation: ast.RangeVar) -> str:
    return f"{relation.schemaname}.{relation.relname}" if relation.schemaname else relation.relname


@dataclass
class Facts:
    """Row-level security facts collected from the statements of a migration."""

    created: set[str] = field(default_factory=set)  # tables from CREATE TABLE
    unqualified: set[str] = field(default_factory=set)  # created without a schema name
    rls_enabled: set[str] = field(default_factory=set)  # enabled and not disabled again
    policies: list[TreePolicy] = field(default_factory=list)
    bucket_rows: list[dict[str, object]] = field(
        default_factory=list
    )  # insert into storage.buckets

    @property
    def policy_tables(self) -> set[str]:
        return {policy.table for policy in self.policies}

    def policies_on(self, table: str) -> list[TreePolicy]:
        return [policy for policy in self.policies if policy.table == table]

    def rls_gaps(self) -> dict[str, set[str]]:
        """Created tables without row-level security, and created tables without any policy."""
        return {
            "no_rls": self.created - self.rls_enabled,
            "no_policy": self.created - self.policy_tables,
        }


def _constant(node: ast.Node) -> object:
    assert isinstance(node, ast.A_Const), f"expected a constant, got {type(node).__name__}"
    value = node.val
    for attribute in ("sval", "boolval", "ival", "fval"):
        if hasattr(value, attribute):
            return getattr(value, attribute)
    raise AssertionError(f"unsupported constant {value!r}")


def collect_facts(sql: str) -> Facts:
    """Walk the statements in order; later statements can undo earlier ones (DISABLE)."""
    facts = Facts()
    for raw in pglast.parse_sql(sql):
        statement = raw.stmt
        if isinstance(statement, ast.CreateStmt):
            name = _qualified(statement.relation)
            facts.created.add(name)
            if not statement.relation.schemaname:
                facts.unqualified.add(name)
        elif isinstance(statement, ast.AlterTableStmt):
            if statement.objtype != enums.ObjectType.OBJECT_TABLE:
                continue
            name = _qualified(statement.relation)
            for command in statement.cmds:
                if command.subtype == enums.AlterTableType.AT_EnableRowSecurity:
                    facts.rls_enabled.add(name)
                elif command.subtype == enums.AlterTableType.AT_DisableRowSecurity:
                    facts.rls_enabled.discard(name)
        elif isinstance(statement, ast.CreatePolicyStmt):
            facts.policies.append(
                TreePolicy(
                    name=statement.policy_name,
                    table=_qualified(statement.table),
                    command=statement.cmd_name,
                    roles=tuple(role.rolename for role in statement.roles or ()),
                    permissive=bool(statement.permissive),
                    expressions=tuple(
                        _mentions(expression)
                        for expression in (statement.qual, statement.with_check)
                        if expression is not None
                    ),
                )
            )
        elif isinstance(statement, ast.InsertStmt):
            if _qualified(statement.relation) == "storage.buckets":
                names = [target.name for target in statement.cols]
                for row in statement.selectStmt.valuesLists:
                    values = [_constant(value) for value in row]
                    facts.bucket_rows.append(dict(zip(names, values, strict=True)))
    return facts


@pytest.fixture(scope="module")
def facts() -> Facts:
    return collect_facts(_read_migration())


def test_the_whole_migration_parses_with_pglast() -> None:
    statements = pglast.parse_sql(_read_migration())
    assert len(statements) > 0
    # The last statement is the trigger: parsing did not stop early at a Supabase-specific line.
    assert isinstance(statements[-1].stmt, ast.CreateTrigStmt)


def test_the_migration_holds_only_statement_kinds_the_checks_understand() -> None:
    # A DROP POLICY, a DISABLE ROW LEVEL SECURITY of another table kind, a GRANT or an ALTER
    # POLICY would change the picture below; if one appears, extend collect_facts first.
    kinds = {type(statement.stmt).__name__ for statement in pglast.parse_sql(_read_migration())}
    assert kinds == {
        "CreateStmt",
        "IndexStmt",
        "AlterTableStmt",
        "CreatePolicyStmt",
        "InsertStmt",
        "CreateFunctionStmt",
        "CreateTrigStmt",
    }


def test_tree_creates_exactly_the_nine_tables_schema_qualified(facts: Facts) -> None:
    assert facts.created == {f"public.{table}" for table in TABLES}
    assert facts.unqualified == set()


def test_tree_every_created_table_has_row_level_security_enabled(facts: Facts) -> None:
    assert facts.rls_enabled == facts.created
    assert facts.rls_gaps() == {"no_rls": set(), "no_policy": set()}


def test_tree_every_created_table_has_at_least_one_policy(facts: Facts) -> None:
    for table in facts.created:
        assert facts.policies_on(table), f"no policy on {table}"
    assert facts.policy_tables - facts.created == {"storage.objects"}


def test_tree_every_policy_is_for_the_authenticated_role_only(facts: Facts) -> None:
    assert facts.policies
    for policy in facts.policies:
        assert policy.roles == ("authenticated",), policy.name
        assert policy.permissive, policy.name


def test_tree_storage_policies_target_storage_objects_for_the_pieces_bucket(
    facts: Facts,
) -> None:
    storage = [policy for policy in facts.policies if policy.table.startswith("storage.")]
    assert {policy.table for policy in storage} == {"storage.objects"}
    assert sorted(policy.command for policy in storage) == sorted(COMMANDS)
    for policy in storage:
        # Each expression of the policy mentions the bucket and the owner folder.
        assert policy.expressions
        for expression in policy.expressions:
            assert "pieces" in expression.strings, policy.name
            assert "storage.foldername" in expression.functions, policy.name
            assert "auth.uid" in expression.functions, policy.name


def test_tree_the_pieces_bucket_row_is_inserted_private(facts: Facts) -> None:
    assert facts.bucket_rows == [{"id": "pieces", "name": "pieces", "public": False}]


def test_tree_gap_detector_flags_a_table_without_rls_or_policy() -> None:
    sql = _read_migration()
    no_rls = sql.replace("alter table public.jobs enable row level security;", "")
    assert collect_facts(no_rls).rls_gaps() == {"no_rls": {"public.jobs"}, "no_policy": set()}
    no_policy = re.sub(r"create policy jobs_select_own[^;]*;", "", sql)
    assert "jobs_select_own" not in no_policy
    assert collect_facts(no_policy).rls_gaps() == {"no_rls": set(), "no_policy": {"public.jobs"}}


def test_tree_gap_detector_sees_a_later_disable_and_an_unqualified_table() -> None:
    sql = _read_migration() + "\nalter table public.pieces disable row level security;\n"
    assert collect_facts(sql).rls_gaps()["no_rls"] == {"public.pieces"}
    extra = _read_migration() + "\ncreate table extra (id int);\n"
    found = collect_facts(extra)
    assert found.unqualified == {"extra"}
    assert "extra" in found.rls_gaps()["no_rls"]


# ---------------------------------------------------------------------------------------------
# Migration 0002 (task 6.1): review state on the locators. Columns only: the policies of 0001
# keep covering them.

MIGRATION_0002 = Path(__file__).resolve().parents[2] / "supabase/migrations/0002_review_state.sql"


@pytest.fixture(scope="module")
def statements_0002() -> list[ast.Node]:
    assert MIGRATION_0002.is_file(), f"missing migration: {MIGRATION_0002}"
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0002.read_text(encoding="utf-8"))]


def test_0002_is_one_alter_table_of_public_locators(statements_0002: list[ast.Node]) -> None:
    assert len(statements_0002) == 1
    statement = statements_0002[0]
    assert isinstance(statement, ast.AlterTableStmt)
    assert statement.objtype == enums.ObjectType.OBJECT_TABLE
    assert _qualified(statement.relation) == "public.locators"


def test_0002_adds_exactly_flags_and_checked(statements_0002: list[ast.Node]) -> None:
    statement = statements_0002[0]
    assert all(c.subtype == enums.AlterTableType.AT_AddColumn for c in statement.cmds)
    assert [c.def_.colname for c in statement.cmds] == ["flags", "checked"]


def _column_0002(statements: list[ast.Node], name: str) -> ast.ColumnDef:
    return next(c.def_ for c in statements[0].cmds if c.def_.colname == name)


def _constraints(column: ast.ColumnDef) -> dict[enums.ConstrType, ast.Constraint]:
    return {constraint.contype: constraint for constraint in column.constraints}


def test_0002_flags_is_a_not_null_jsonb_array_defaulting_to_empty(
    statements_0002: list[ast.Node],
) -> None:
    column = _column_0002(statements_0002, "flags")
    assert [part.sval for part in column.typeName.names] == ["jsonb"]
    constraints = _constraints(column)
    assert set(constraints) == {
        enums.ConstrType.CONSTR_NOTNULL,
        enums.ConstrType.CONSTR_DEFAULT,
        enums.ConstrType.CONSTR_CHECK,
    }
    default = constraints[enums.ConstrType.CONSTR_DEFAULT].raw_expr
    assert isinstance(default, ast.TypeCast)
    assert _constant(default.arg) == "[]"
    check = _mentions(constraints[enums.ConstrType.CONSTR_CHECK].raw_expr)
    assert check.functions == {"jsonb_typeof"}
    assert check.strings == {"array"}


def test_0002_checked_is_a_not_null_boolean_defaulting_to_false(
    statements_0002: list[ast.Node],
) -> None:
    column = _column_0002(statements_0002, "checked")
    assert [part.sval for part in column.typeName.names] == ["pg_catalog", "bool"]  # boolean
    constraints = _constraints(column)
    assert set(constraints) == {
        enums.ConstrType.CONSTR_NOTNULL,
        enums.ConstrType.CONSTR_DEFAULT,
    }
    assert _constant(constraints[enums.ConstrType.CONSTR_DEFAULT].raw_expr) is False


def test_0002_creates_no_table_policy_or_index() -> None:
    facts = collect_facts(MIGRATION_0002.read_text(encoding="utf-8"))
    assert facts.created == set()
    assert facts.policies == []
    assert facts.rls_enabled == set()
    text = _strip_comments(MIGRATION_0002.read_text(encoding="utf-8")).lower()
    for word in ("create ", "policy", "drop ", "grant "):
        assert word not in text, word


# ---------------------------------------------------------------------------------------------
# Migration 0003 (task 7.5): what a piece remembers of Practice. Two columns on pieces: the
# policies of 0001 keep covering it.

MIGRATION_0003 = (
    Path(__file__).resolve().parents[2] / "supabase/migrations/0003_practice_memory.sql"
)


@pytest.fixture(scope="module")
def statements_0003() -> list[ast.Node]:
    assert MIGRATION_0003.is_file(), f"missing migration: {MIGRATION_0003}"
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0003.read_text(encoding="utf-8"))]


def test_0003_is_alter_tables_of_public_pieces_then_public_jobs(
    statements_0003: list[ast.Node],
) -> None:
    assert len(statements_0003) == 3
    for statement in statements_0003:
        assert isinstance(statement, ast.AlterTableStmt)
        assert statement.objtype == enums.ObjectType.OBJECT_TABLE
    assert [_qualified(statement.relation) for statement in statements_0003] == [
        "public.pieces",
        "public.pieces",
        "public.jobs",
    ]


def test_0003_adds_exactly_practice_and_last_part_id(statements_0003: list[ast.Node]) -> None:
    for statement in statements_0003[:2]:
        assert all(c.subtype == enums.AlterTableType.AT_AddColumn for c in statement.cmds)
    assert [c.def_.colname for s in statements_0003[:2] for c in s.cmds] == [
        "practice",
        "last_part_id",
    ]


def test_0003_replaces_the_jobs_kind_check_with_one_that_adds_add_parts(
    statements_0003: list[ast.Node],
) -> None:
    drop, add = statements_0003[2].cmds
    assert drop.subtype == enums.AlterTableType.AT_DropConstraint
    assert drop.name == "jobs_kind_check"  # the name Postgres gives the inline check of 0001
    assert add.subtype == enums.AlterTableType.AT_AddConstraint
    constraint = add.def_
    assert constraint.contype == enums.ConstrType.CONSTR_CHECK
    assert constraint.conname == "jobs_kind_check"
    mentioned = _mentions(constraint.raw_expr)
    assert mentioned.strings == {"process-piece", "realign", "add-parts"}


def test_0003_last_part_id_is_a_nullable_uuid_that_clears_when_the_part_goes(
    statements_0003: list[ast.Node],
) -> None:
    column = statements_0003[1].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["uuid"]
    constraints = _constraints(column)
    assert set(constraints) == {enums.ConstrType.CONSTR_FOREIGN}
    reference = constraints[enums.ConstrType.CONSTR_FOREIGN]
    assert _qualified(reference.pktable) == "public.score_files"
    assert [attribute.sval for attribute in reference.pk_attrs] == ["id"]
    assert reference.fk_del_action == "n"  # on delete set null


def test_0003_practice_is_a_not_null_jsonb_object_defaulting_to_empty(
    statements_0003: list[ast.Node],
) -> None:
    column = statements_0003[0].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["jsonb"]
    constraints = _constraints(column)
    assert set(constraints) == {
        enums.ConstrType.CONSTR_NOTNULL,
        enums.ConstrType.CONSTR_DEFAULT,
        enums.ConstrType.CONSTR_CHECK,
    }
    default = constraints[enums.ConstrType.CONSTR_DEFAULT].raw_expr
    assert isinstance(default, ast.TypeCast)
    assert _constant(default.arg) == "{}"
    check = _mentions(constraints[enums.ConstrType.CONSTR_CHECK].raw_expr)
    assert check.functions == {"jsonb_typeof"}
    assert check.strings == {"object"}


def test_0003_creates_no_table_policy_or_index() -> None:
    facts = collect_facts(MIGRATION_0003.read_text(encoding="utf-8"))
    assert facts.created == set()
    assert facts.policies == []
    assert facts.rls_enabled == set()
    text = _strip_comments(MIGRATION_0003.read_text(encoding="utf-8")).lower()
    for word in ("create ", "policy", "grant "):
        assert word not in text, word
    assert text.count("drop ") == 1  # the one old jobs check


# ---------------------------------------------------------------------------------------------
# Migration 0004 (task 8.7): what a finished job tells the user, and where the playback copy of
# the recording is. Columns only: the policies of 0001 keep covering them.

MIGRATION_0004 = Path(__file__).resolve().parents[2] / "supabase/migrations/0004_job_report.sql"


@pytest.fixture(scope="module")
def statements_0004() -> list[ast.Node]:
    assert MIGRATION_0004.is_file(), f"missing migration: {MIGRATION_0004}"
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0004.read_text(encoding="utf-8"))]


def test_0004_is_alter_tables_of_public_jobs_then_public_audio_sources(
    statements_0004: list[ast.Node],
) -> None:
    assert len(statements_0004) == 2
    for statement in statements_0004:
        assert isinstance(statement, ast.AlterTableStmt)
        assert statement.objtype == enums.ObjectType.OBJECT_TABLE
        assert all(c.subtype == enums.AlterTableType.AT_AddColumn for c in statement.cmds)
    assert [_qualified(statement.relation) for statement in statements_0004] == [
        "public.jobs",
        "public.audio_sources",
    ]


def test_0004_adds_exactly_warnings_cost_usd_and_stored_path(
    statements_0004: list[ast.Node],
) -> None:
    assert [c.def_.colname for c in statements_0004[0].cmds] == ["warnings", "cost_usd"]
    assert [c.def_.colname for c in statements_0004[1].cmds] == ["stored_path"]


def test_0004_warnings_is_a_not_null_jsonb_array_defaulting_to_empty(
    statements_0004: list[ast.Node],
) -> None:
    column = statements_0004[0].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["jsonb"]
    constraints = _constraints(column)
    assert set(constraints) == {
        enums.ConstrType.CONSTR_NOTNULL,
        enums.ConstrType.CONSTR_DEFAULT,
        enums.ConstrType.CONSTR_CHECK,
    }
    default = constraints[enums.ConstrType.CONSTR_DEFAULT].raw_expr
    assert isinstance(default, ast.TypeCast)
    assert _constant(default.arg) == "[]"
    check = _mentions(constraints[enums.ConstrType.CONSTR_CHECK].raw_expr)
    assert check.functions == {"jsonb_typeof"}
    assert check.strings == {"array"}


def test_0004_cost_usd_is_a_plain_nullable_numeric(statements_0004: list[ast.Node]) -> None:
    column = statements_0004[0].cmds[1].def_
    assert [part.sval for part in column.typeName.names] == ["pg_catalog", "numeric"]
    assert not column.constraints


def test_0004_stored_path_is_a_plain_nullable_text(statements_0004: list[ast.Node]) -> None:
    column = statements_0004[1].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["text"]
    assert not column.constraints


def test_0004_creates_no_table_policy_or_index() -> None:
    facts = collect_facts(MIGRATION_0004.read_text(encoding="utf-8"))
    assert facts.created == set()
    assert facts.policies == []
    assert facts.rls_enabled == set()
    text = _strip_comments(MIGRATION_0004.read_text(encoding="utf-8")).lower()
    for word in ("create ", "policy", "drop ", "grant "):
        assert word not in text, word


# ---------------------------------------------------------------------------------------------
# Migration 0005 (task 8.10): where a part's name came from, and the recording's name. Columns
# only: the score_files and audio_sources policies of 0001 already cover them.

MIGRATION_0005 = Path(__file__).resolve().parents[2] / "supabase/migrations/0005_names.sql"


@pytest.fixture(scope="module")
def statements_0005() -> list[ast.Node]:
    assert MIGRATION_0005.is_file(), f"missing migration: {MIGRATION_0005}"
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0005.read_text(encoding="utf-8"))]


def test_0005_is_alter_tables_of_public_score_files_then_public_audio_sources(
    statements_0005: list[ast.Node],
) -> None:
    assert len(statements_0005) == 2
    for statement in statements_0005:
        assert isinstance(statement, ast.AlterTableStmt)
        assert all(c.subtype == enums.AlterTableType.AT_AddColumn for c in statement.cmds)
    assert [_qualified(statement.relation) for statement in statements_0005] == [
        "public.score_files",
        "public.audio_sources",
    ]


def test_0005_adds_exactly_name_source_and_name(statements_0005: list[ast.Node]) -> None:
    assert [c.def_.colname for c in statements_0005[0].cmds] == ["name_source"]
    assert [c.def_.colname for c in statements_0005[1].cmds] == ["name"]


def test_0005_name_source_is_a_not_null_text_defaulting_to_file_with_three_values(
    statements_0005: list[ast.Node],
) -> None:
    column = statements_0005[0].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["text"]
    constraints = _constraints(column)
    assert set(constraints) == {
        enums.ConstrType.CONSTR_NOTNULL,
        enums.ConstrType.CONSTR_DEFAULT,
        enums.ConstrType.CONSTR_CHECK,
    }
    assert _constant(constraints[enums.ConstrType.CONSTR_DEFAULT].raw_expr) == "file"
    assert _mentions(constraints[enums.ConstrType.CONSTR_CHECK].raw_expr).strings == {
        "read",
        "user",
        "file",
    }


def test_0005_recording_name_is_nullable_text_of_one_to_120_characters(
    statements_0005: list[ast.Node],
) -> None:
    column = statements_0005[1].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["text"]
    constraints = _constraints(column)
    assert set(constraints) == {enums.ConstrType.CONSTR_CHECK}
    check = _mentions(constraints[enums.ConstrType.CONSTR_CHECK].raw_expr)
    assert check.functions == {"char_length"}


def test_0005_creates_no_table_policy_or_index() -> None:
    facts = collect_facts(MIGRATION_0005.read_text(encoding="utf-8"))
    assert facts.created == set()
    assert facts.policies == []
    assert facts.rls_enabled == set()
    text = _strip_comments(MIGRATION_0005.read_text(encoding="utf-8")).lower()
    for word in ("create ", "policy", "drop ", "grant "):
        assert word not in text, word


# ---------------------------------------------------------------------------------------------
# Migration 0006 (task 8.15): the parts a job could not read, each with its reason. A column
# only: the jobs policies of 0001 already cover it.

MIGRATION_0006 = (
    Path(__file__).resolve().parents[2] / "supabase/migrations/0006_job_failed_parts.sql"
)


@pytest.fixture(scope="module")
def statements_0006() -> list[ast.Node]:
    assert MIGRATION_0006.is_file(), f"missing migration: {MIGRATION_0006}"
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0006.read_text(encoding="utf-8"))]


def test_0006_adds_failed_parts_to_public_jobs_only(statements_0006: list[ast.Node]) -> None:
    assert len(statements_0006) == 1
    statement = statements_0006[0]
    assert isinstance(statement, ast.AlterTableStmt)
    assert _qualified(statement.relation) == "public.jobs"
    assert [c.subtype for c in statement.cmds] == [enums.AlterTableType.AT_AddColumn]
    assert [c.def_.colname for c in statement.cmds] == ["failed_parts"]


def test_0006_failed_parts_is_a_not_null_jsonb_array_defaulting_to_empty(
    statements_0006: list[ast.Node],
) -> None:
    column = statements_0006[0].cmds[0].def_
    assert [part.sval for part in column.typeName.names] == ["jsonb"]
    constraints = _constraints(column)
    assert set(constraints) == {
        enums.ConstrType.CONSTR_NOTNULL,
        enums.ConstrType.CONSTR_DEFAULT,
        enums.ConstrType.CONSTR_CHECK,
    }
    default = constraints[enums.ConstrType.CONSTR_DEFAULT].raw_expr
    assert isinstance(default, ast.TypeCast)
    assert _constant(default.arg) == "[]"
    check = _mentions(constraints[enums.ConstrType.CONSTR_CHECK].raw_expr)
    assert check.functions == {"jsonb_typeof"}
    assert check.strings == {"array"}


def test_0006_creates_no_table_policy_or_index() -> None:
    facts = collect_facts(MIGRATION_0006.read_text(encoding="utf-8"))
    assert facts.created == set()
    assert facts.policies == []
    assert facts.rls_enabled == set()
    text = _strip_comments(MIGRATION_0006.read_text(encoding="utf-8")).lower()
    for word in ("create ", "policy", "drop ", "grant "):
        assert word not in text, word


# --- 0007_login_sharing.sql ---------------------------------------------------------------------

MIGRATION_0007 = Path(__file__).resolve().parents[2] / "supabase/migrations/0007_login_sharing.sql"
NEW_TABLES_0007 = {"admins", "creator_emails", "piece_shares", "piece_members", "piece_practice"}
NO_POLICY_TABLES_0007 = {"admins", "creator_emails"}
ADMIN_FUNCTIONS_0007 = {"list_creators", "add_creator", "remove_creator"}


@pytest.fixture(scope="module")
def statements_0007() -> list[ast.Node]:
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0007.read_text(encoding="utf-8"))]


def _functions_0007(statements: list[ast.Node]) -> dict[str, ast.CreateFunctionStmt]:
    found = {}
    for stmt in statements:
        if isinstance(stmt, ast.CreateFunctionStmt):
            found[stmt.funcname[-1].sval] = stmt
    return found


def _option(stmt: ast.CreateFunctionStmt, name: str) -> ast.DefElem | None:
    for option in stmt.options or ():
        if option.defname == name:
            return option
    return None


def test_0007_every_new_table_has_rls(statements_0007: list[ast.Node]) -> None:
    enabled = {
        stmt.relation.relname
        for stmt in statements_0007
        if isinstance(stmt, ast.AlterTableStmt)
        and any(cmd.subtype == enums.AlterTableType.AT_EnableRowSecurity for cmd in stmt.cmds)
    }
    assert NEW_TABLES_0007 <= enabled


def test_0007_policies_are_where_the_spec_says(statements_0007: list[ast.Node]) -> None:
    policies = [stmt for stmt in statements_0007 if isinstance(stmt, ast.CreatePolicyStmt)]
    tables = {policy.table.relname for policy in policies}
    assert not tables & NO_POLICY_TABLES_0007
    assert NEW_TABLES_0007 - NO_POLICY_TABLES_0007 <= tables
    # "all" covers insert too, so it is forbidden as well.
    assert not [
        p
        for p in policies
        if p.table.relname == "piece_members" and p.cmd_name in ("insert", "all")
    ]


def test_0007_member_policies_only_add_reading(statements_0007: list[ast.Node]) -> None:
    for policy in statements_0007:
        if isinstance(policy, ast.CreatePolicyStmt) and policy.policy_name.endswith("_member"):
            assert policy.cmd_name == "select", policy.policy_name


def test_0007_security_definer_functions_have_an_empty_search_path(
    statements_0007: list[ast.Node],
) -> None:
    definers = [
        (name, stmt)
        for name, stmt in _functions_0007(statements_0007).items()
        if _option(stmt, "security") is not None and _option(stmt, "security").arg.boolval
    ]
    assert len(definers) >= 13
    for name, stmt in definers:
        setter = _option(stmt, "set")
        assert setter is not None, name
        assert setter.arg.name == "search_path", name
        assert [arg.val.sval for arg in setter.arg.args] == [""], name


def test_0007_admin_functions_check_is_admin(statements_0007: list[ast.Node]) -> None:
    for name in ADMIN_FUNCTIONS_0007:
        body = _option(_functions_0007(statements_0007)[name], "as").arg[0].sval
        assert "public.is_admin()" in body, name
        assert "insufficient_privilege" in body, name


def test_0007_every_definer_function_is_revoked_from_public_and_anon() -> None:
    sql = MIGRATION_0007.read_text(encoding="utf-8")
    names = re.findall(r"create (?:or replace )?function public\.(\w+)\(", sql)
    for name in set(names):
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon", sql
        ), name


def test_0007_tokens_have_at_least_128_bits() -> None:
    sql = MIGRATION_0007.read_text(encoding="utf-8")
    assert "extensions.gen_random_bytes(18)" in sql


# --- 0008_size_limits.sql -----------------------------------------------------------------------
# Three check constraints on columns a signed-in stranger can write (final review I-3). Constraints
# only: no table, policy, grant or index.

MIGRATION_0008 = Path(__file__).resolve().parents[2] / "supabase/migrations/0008_size_limits.sql"
LIMITS_0008 = {
    ("public.profiles", "profiles_settings_size", "settings"): 16384,
    ("public.profiles", "profiles_accepted_terms_version_size", "accepted_terms_version"): 32,
    ("public.piece_practice", "piece_practice_practice_size", "practice"): 65536,
}


@pytest.fixture(scope="module")
def statements_0008() -> list[ast.Node]:
    assert MIGRATION_0008.is_file(), f"missing migration: {MIGRATION_0008}"
    return [raw.stmt for raw in pglast.parse_sql(MIGRATION_0008.read_text(encoding="utf-8"))]


def _limits_0008(statements: list[ast.Node]) -> dict[tuple[str, str, str], int]:
    """Each added check, as (table, constraint name, column) -> the limit on its octet_length."""
    found: dict[tuple[str, str, str], int] = {}
    for statement in statements:
        assert isinstance(statement, ast.AlterTableStmt)
        for command in statement.cmds:
            assert command.subtype == enums.AlterTableType.AT_AddConstraint
            constraint = command.def_
            assert constraint.contype == enums.ConstrType.CONSTR_CHECK
            comparison = constraint.raw_expr
            assert isinstance(comparison, ast.A_Expr)
            assert [name.sval for name in comparison.name] == ["<="]
            assert _mentions(comparison.lexpr).functions == {"octet_length"}
            columns = {ref.fields[-1].sval for ref in _column_refs(comparison.lexpr)}
            assert len(columns) == 1
            key = (_qualified(statement.relation), constraint.conname, columns.pop())
            found[key] = comparison.rexpr.val.ival
    return found


def _column_refs(node: ast.Node) -> list[ast.ColumnRef]:
    refs: list[ast.ColumnRef] = []

    class _Refs(Visitor):
        def visit_ColumnRef(self, ancestors: object, found: ast.ColumnRef) -> None:
            refs.append(found)

    _Refs()(node)
    return refs


def test_0008_adds_exactly_the_three_size_checks_with_the_agreed_limits(
    statements_0008: list[ast.Node],
) -> None:
    assert _limits_0008(statements_0008) == LIMITS_0008


def test_0008_counts_bytes_not_characters(statements_0008: list[ast.Node]) -> None:
    # char_length would let a multibyte string through at a fraction of the limit's cost in bytes.
    for statement in statements_0008:
        for command in statement.cmds:
            assert _mentions(command.def_.raw_expr).functions == {"octet_length"}


def test_0008_creates_no_table_policy_grant_or_index() -> None:
    sql = MIGRATION_0008.read_text(encoding="utf-8")
    facts = collect_facts(sql)
    assert facts.created == set()
    assert facts.policies == []
    assert facts.rls_enabled == set()
    text = _strip_comments(sql).lower()
    for word in ("create ", "policy", "drop ", "grant ", "revoke "):
        assert word not in text, word


# --- 0015_plans.sql -----------------------------------------------------------------------------
# Plans and usage limits. The behaviour is proved against a real Postgres in
# frontend/src/test/migration0015.test.ts; these are text checks of the file's shape.

MIGRATION_0015 = Path(__file__).resolve().parents[2] / "supabase/migrations/0015_plans.sql"
NEW_TABLES_0015 = {"plans", "plan_emails", "usage_events", "trial_ledger"}
ADMIN_FUNCTIONS_0015 = {"admin_overview", "save_admin_changes"}
SERVICE_FUNCTIONS_0015 = {
    "service_plan_state",
    "service_record_usage",
    "service_void_piece_created",
    "service_is_creator",
}
# Run by a policy as the signed-in role, so the role needs the grant (each decides for the caller).
POLICY_HELPERS_0015 = {"can_create_piece", "can_add_part", "can_upload_object"}


@pytest.fixture(scope="module")
def sql_0015() -> str:
    assert MIGRATION_0015.is_file(), f"missing migration: {MIGRATION_0015}"
    return MIGRATION_0015.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def statements_0015(sql_0015: str) -> list[ast.Node]:
    return [raw.stmt for raw in pglast.parse_sql(sql_0015)]


def _created_functions_0015(statements: list[ast.Node]) -> dict[str, ast.CreateFunctionStmt]:
    return _functions_0007(statements)


def test_0015_the_four_tables_have_rls_and_no_policy(
    statements_0015: list[ast.Node], sql_0015: str
) -> None:
    facts = collect_facts(sql_0015)
    assert {name.removeprefix("public.") for name in facts.created} == NEW_TABLES_0015
    assert {name.removeprefix("public.") for name in facts.rls_enabled} >= NEW_TABLES_0015
    policy_tables = {
        policy.table.relname
        for policy in statements_0015
        if isinstance(policy, ast.CreatePolicyStmt)
    }
    assert not policy_tables & NEW_TABLES_0015


def test_0015_grants_no_table_privilege_to_anon_or_authenticated(sql_0015: str) -> None:
    text = _strip_comments(sql_0015).lower()
    for statement in re.findall(r"grant\s[^;]*;", text):
        assert not re.search(
            r"\son\s+(table\s+)?public\.(plans|plan_emails|usage_events|trial_ledger)", statement
        ), statement
    assert re.search(
        r"revoke all on public\.plans, public\.plan_emails, public\.usage_events, "
        r"public\.trial_ledger from public, anon, authenticated;",
        text,
    )


def test_0015_every_function_pins_an_empty_search_path(statements_0015: list[ast.Node]) -> None:
    functions = _created_functions_0015(statements_0015)
    assert len(functions) == 19
    for name, stmt in functions.items():
        setter = _option(stmt, "set")
        assert setter is not None, name
        assert setter.arg.name == "search_path", name
        assert [arg.val.sval for arg in setter.arg.args] == [""], name


def test_0015_every_function_is_revoked_from_public_and_anon(sql_0015: str) -> None:
    names = set(re.findall(r"create (?:or replace )?function public\.(\w+)\(", sql_0015))
    for name in names:
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon", sql_0015
        ), name


def test_0015_service_functions_go_to_service_role_only(sql_0015: str) -> None:
    for name in SERVICE_FUNCTIONS_0015:
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon, authenticated;",
            sql_0015,
        ), name
        assert re.search(
            rf"grant execute on function public\.{name}\([^)]*\) to service_role;", sql_0015
        ), name
        assert not re.search(
            rf"grant execute on function public\.{name}\([^)]*\) to [^;]*authenticated", sql_0015
        ), name


def test_0015_only_the_app_calls_and_policy_helpers_go_to_authenticated(sql_0015: str) -> None:
    granted = set(
        re.findall(r"grant execute on function public\.(\w+)\([^)]*\) to authenticated;", sql_0015)
    )
    assert granted == {
        "my_plan",
        "set_share_enabled",
        "delete_account",
        "admin_overview",
        "save_admin_changes",
        "is_creator",
        *POLICY_HELPERS_0015,
    }
    # The internal helpers are closed to authenticated too.
    for name in (
        "plan_row_of",
        "plan_state_of",
        "email_hash",
        "log_piece_created",
        "require_advanced_reading",
        "piece_member_limit",
    ):
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon, authenticated;",
            sql_0015,
        ), name


def test_0015_admin_functions_check_is_admin(statements_0015: list[ast.Node]) -> None:
    functions = _created_functions_0015(statements_0015)
    for name in ADMIN_FUNCTIONS_0015:
        body = _option(functions[name], "as").arg[0].sval
        assert "public.is_admin()" in body, name
        assert "insufficient_privilege" in body, name


def test_0015_the_policies_ask_the_plan_and_wrap_auth_uid(statements_0015: list[ast.Node]) -> None:
    policies = {
        stmt.policy_name: stmt for stmt in statements_0015 if isinstance(stmt, ast.CreatePolicyStmt)
    }
    assert set(policies) == {
        "pieces_insert_own",
        "score_files_insert_own",
        "pieces_objects_insert_own",
    }
    for name, helper in (
        ("pieces_insert_own", "can_create_piece"),
        ("score_files_insert_own", "can_add_part"),
        ("pieces_objects_insert_own", "can_upload_object"),
    ):
        policy = policies[name]
        assert policy.cmd_name == "insert"
        assert [role.rolename for role in policy.roles] == ["authenticated"]
        assert f"public.{helper}" in _mentions(policy.with_check).functions


def test_0015_policies_never_use_a_bare_auth_uid(sql_0015: str) -> None:
    for block in re.findall(r"create policy [^;]*;", _strip_comments(sql_0015)):
        assert "auth.uid()" not in re.sub(r"\(select auth\.uid\(\)\)", "", block), block


def test_0015_drops_the_creator_list_and_nothing_else(sql_0015: str) -> None:
    text = _strip_comments(sql_0015).lower()
    drops = re.findall(r"drop (function|table|policy|trigger)\s+(?:if exists\s+)?([\w.]+)", text)
    assert sorted(drops) == sorted(
        [
            ("policy", "pieces_insert_own"),
            ("policy", "score_files_insert_own"),
            ("policy", "pieces_objects_insert_own"),
            ("function", "public.list_creators"),
            ("function", "public.add_creator"),
            ("function", "public.remove_creator"),
            ("function", "public.set_creator_limits"),
            ("table", "public.creator_emails"),
        ]
    )


def test_0015_stored_search_paths_never_name_a_schema_in_a_policy(sql_0015: str) -> None:
    # The policies reach the helpers with their full names.
    text = _strip_comments(sql_0015)
    for helper in POLICY_HELPERS_0015:
        assert f"public.{helper}(" in text, helper


# --- 0016_sample_piece.sql ----------------------------------------------------------------------
# One sample piece per account. The behaviour is proved against a real Postgres in
# frontend/src/test/migration0016.test.ts; these are text checks of the file's shape.

MIGRATION_0016 = Path(__file__).resolve().parents[2] / "supabase/migrations/0016_sample_piece.sql"
SERVICE_FUNCTIONS_0016 = {
    "service_sample_state",
    "service_copy_sample_piece",
    "service_mark_sample",
    "service_unmark_sample",
    "service_set_sample_piece",
    "service_clear_sample_piece",
}


@pytest.fixture(scope="module")
def sql_0016() -> str:
    assert MIGRATION_0016.is_file(), f"missing migration: {MIGRATION_0016}"
    return MIGRATION_0016.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def statements_0016(sql_0016: str) -> list[ast.Node]:
    return [raw.stmt for raw in pglast.parse_sql(sql_0016)]


def test_0016_sample_piece_has_rls_no_policy_and_is_revoked_from_anon_and_authenticated(
    statements_0016: list[ast.Node], sql_0016: str
) -> None:
    facts = collect_facts(sql_0016)
    assert {name.removeprefix("public.") for name in facts.created} == {"sample_piece"}
    assert {name.removeprefix("public.") for name in facts.rls_enabled} == {"sample_piece"}
    assert not [stmt for stmt in statements_0016 if isinstance(stmt, ast.CreatePolicyStmt)]
    text = _strip_comments(sql_0016).lower()
    assert re.search(r"revoke all on public\.sample_piece from public, anon, authenticated;", text)
    for statement in re.findall(r"grant\s[^;]*;", text):
        assert not re.search(r"\son\s+(table\s+)?public\.sample_piece", statement), statement


def test_0016_every_function_pins_an_empty_search_path(statements_0016: list[ast.Node]) -> None:
    functions = _functions_0007(statements_0016)
    assert set(functions) == {
        "plan_state_of",
        "admin_overview",
        "sample_path",
        "sample_credits",
        "protect_sample_of",
        *SERVICE_FUNCTIONS_0016,
    }
    for name, stmt in functions.items():
        setter = _option(stmt, "set")
        assert setter is not None, name
        assert setter.arg.name == "search_path", name
        assert [arg.val.sval for arg in setter.arg.args] == [""], name


def test_0016_every_function_is_revoked_from_public_and_anon(sql_0016: str) -> None:
    names = set(re.findall(r"create (?:or replace )?function public\.(\w+)\(", sql_0016))
    for name in names:
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon", sql_0016
        ), name


def test_0016_service_functions_go_to_service_role_only(sql_0016: str) -> None:
    for name in SERVICE_FUNCTIONS_0016:
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon, authenticated;",
            sql_0016,
        ), name
        assert re.search(
            rf"grant execute on function public\.{name}\([^)]*\) to service_role;", sql_0016
        ), name
        assert not re.search(
            rf"grant execute on function public\.{name}\([^)]*\) to [^;]*authenticated", sql_0016
        ), name
    # The path helper is internal: nobody but the functions that call it runs it.
    assert re.search(
        r"revoke all on function public\.sample_path\([^)]*\) from public, anon, authenticated;",
        sql_0016,
    )


def test_0016_only_sample_credits_is_new_to_authenticated(sql_0016: str) -> None:
    granted = set(
        re.findall(r"grant execute on function public\.(\w+)\([^)]*\) to authenticated;", sql_0016)
    )
    # admin_overview is only restated (its grant is the one of 0015).
    assert granted == {"sample_credits", "admin_overview"}


def test_0016_sample_of_is_guarded_by_a_trigger_and_pieces_grants_are_untouched(
    statements_0016: list[ast.Node], sql_0016: str
) -> None:
    triggers = [stmt for stmt in statements_0016 if isinstance(stmt, ast.CreateTrigStmt)]
    assert [t.trigname for t in triggers] == ["pieces_protect_sample_of"]
    assert triggers[0].relation.relname == "pieces"
    body = _option(_functions_0007(statements_0016)["protect_sample_of"], "as").arg[0].sval
    assert "auth.uid()" in body and "pg_trigger_depth() = 1" in body
    assert "insufficient_privilege" in body
    # A column cannot be taken out of the table-wide grant of 0009; the migration does not try.
    text = _strip_comments(sql_0016).lower()
    assert not re.search(r"(grant|revoke)\s[^;]*on public\.pieces", text)


def test_0016_the_daily_cap_skips_the_sample_in_both_counts(sql_0016: str) -> None:
    text = _strip_comments(sql_0016)
    assert "and not e.is_sample" in text  # plan_state_of
    assert "and not v.is_sample" in text  # admin_overview


def test_0016_the_copy_locks_the_profile_row_first(statements_0016: list[ast.Node]) -> None:
    body = _option(_functions_0007(statements_0016)["service_copy_sample_piece"], "as").arg[0].sval
    assert body.index("for update") < body.index("sample:already") < body.index("sample:no_master")
    assert (
        "sample:path_outside"
        in _option(_functions_0007(statements_0016)["sample_path"], "as").arg[0].sval
    )


def test_0016_drops_nothing(sql_0016: str) -> None:
    text = _strip_comments(sql_0016).lower()
    assert not re.findall(r"\bdrop\s+(function|table|policy|trigger|column)\b", text)


# --- 0017_plans_fixes.sql -----------------------------------------------------------------------
# The fixes of the final review, which 0015 (already applied) could not take. The behaviour is
# proved against a real Postgres in frontend/src/test/migration0015.test.ts and
# migration0017.test.ts; these are text checks of the file's shape.

MIGRATION_0017 = Path(__file__).resolve().parents[2] / "supabase/migrations/0017_plans_fixes.sql"
SERVICE_FUNCTIONS_0017 = {"service_use_advanced_reading", "service_claim_piece"}
LIMIT_TRIGGERS_0017 = {"enforce_piece_limits", "enforce_part_limits"}


@pytest.fixture(scope="module")
def sql_0017() -> str:
    assert MIGRATION_0017.is_file(), f"missing migration: {MIGRATION_0017}"
    return MIGRATION_0017.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def statements_0017(sql_0017: str) -> list[ast.Node]:
    return [raw.stmt for raw in pglast.parse_sql(sql_0017)]


def test_0017_the_applied_0015_is_untouched(sql_0017: str) -> None:
    # 0015 was applied on Dev as commit 21f309a: its text must not change.
    digest = hashlib.sha256(MIGRATION_0015.read_bytes()).hexdigest()
    assert digest == "d100db69ef307ae63e9bde717d3be9df5a4554cd532b1441c31908ea5012f588"


def test_0017_private_settings_is_closed_and_holds_a_generated_pepper(
    statements_0017: list[ast.Node], sql_0017: str
) -> None:
    facts = collect_facts(sql_0017)
    assert {name.removeprefix("public.") for name in facts.created} == {"private_settings"}
    assert "public.private_settings" in {name for name in facts.rls_enabled}
    assert not [s for s in statements_0017 if isinstance(s, ast.CreatePolicyStmt)] or all(
        s.table.relname != "private_settings"
        for s in statements_0017
        if isinstance(s, ast.CreatePolicyStmt)
    )
    text = _strip_comments(sql_0017).lower()
    revoke = "revoke all on public.private_settings from public, anon, authenticated, service_role;"
    assert revoke in text
    assert "'trial_ledger_pepper'" in text
    assert "gen_random_uuid()" in text and "pgcrypto" not in text  # no extension needed


def test_0017_email_hash_is_keyed_and_internal(
    statements_0017: list[ast.Node], sql_0017: str
) -> None:
    body = _option(_functions_0007(statements_0017)["email_hash"], "as").arg[0].sval
    assert "private_settings" in body and "trial_ledger_pepper" in body
    assert "lower(trim(address))" in body
    text = _strip_comments(sql_0017).lower()
    head = re.search(r"function public\.email_hash\(address text\).*?as \$\$", text, re.S).group(0)
    assert "security definer" in head and "immutable" not in head
    assert re.search(
        r"revoke all on function public\.email_hash\(text\) from public, anon, authenticated;", text
    )


def test_0017_every_function_pins_an_empty_search_path(statements_0017: list[ast.Node]) -> None:
    functions = _functions_0007(statements_0017)
    assert set(functions) == {
        "email_hash",
        "enforce_piece_limits",
        "enforce_part_limits",
        "set_share_enabled",
        "admin_overview",
        "service_use_advanced_reading",
        "service_claim_piece",
    }
    for name, stmt in functions.items():
        setter = _option(stmt, "set")
        assert setter is not None, name
        assert setter.arg.name == "search_path", name
        assert [arg.val.sval for arg in setter.arg.args] == [""], name


def test_0017_service_functions_go_to_service_role_only(sql_0017: str) -> None:
    for name in SERVICE_FUNCTIONS_0017:
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon, authenticated;",
            sql_0017,
        ), name
        assert re.search(
            rf"grant execute on function public\.{name}\([^)]*\) to service_role;", sql_0017
        ), name
        assert not re.search(
            rf"grant execute on function public\.{name}\([^)]*\) to [^;]*authenticated", sql_0017
        ), name
    for name in LIMIT_TRIGGERS_0017:
        assert re.search(
            rf"revoke all on function public\.{name}\([^)]*\) from public, anon, authenticated;",
            sql_0017,
        ), name


def test_0017_only_the_two_app_calls_it_restates_go_to_authenticated(sql_0017: str) -> None:
    granted = set(
        re.findall(r"grant execute on function public\.(\w+)\([^)]*\) to authenticated;", sql_0017)
    )
    assert granted == {"set_share_enabled", "admin_overview"}


def test_0017_the_limit_triggers_run_before_insert_and_are_volatile_definers(
    statements_0017: list[ast.Node], sql_0017: str
) -> None:
    functions = _functions_0007(statements_0017)
    text = _strip_comments(sql_0017).lower()
    for name in LIMIT_TRIGGERS_0017:
        body = _option(functions[name], "as").arg[0].sval
        head = re.search(rf"function public\.{name}\(\).*?as \$\$", text, re.S).group(0)
        assert "stable" not in head and "security definer" in head, name
        assert "pg_advisory_xact_lock" in body or "for no key update" in body, name
    assert re.search(r"create trigger \w+\s+before insert on public\.pieces", text)
    assert re.search(
        r"create trigger \w+\s+before insert or update of piece_id on public\.score_files", text
    )


def test_0017_the_piece_limits_leave_the_sample_out_of_the_daily_cap(sql_0017: str) -> None:
    text = _strip_comments(sql_0017)
    assert text.count("not e.is_sample") == 2  # enforce_piece_limits and service_claim_piece
    assert "not ev.is_sample" in text  # a voided sample's claim skips the daily cap
    assert "not v.is_sample" in text  # admin_overview, as 0016


def test_0017_replaces_the_policies_and_drops_exactly_the_old_helpers(sql_0017: str) -> None:
    text = _strip_comments(sql_0017).lower()
    drops = re.findall(r"drop (function|table|policy|trigger)\s+(?:if exists\s+)?([\w.]+)", text)
    assert sorted(drops) == sorted(
        [
            ("policy", "pieces_insert_own"),
            ("policy", "score_files_insert_own"),
            ("trigger", "pieces_log_created"),
            ("function", "public.log_piece_created"),
            ("function", "public.can_create_piece"),
            ("function", "public.can_add_part"),
        ]
    )
    # The policies are dropped before the helpers they called.
    assert text.index("drop policy pieces_insert_own") < text.index(
        "drop function public.can_create_piece"
    )
    for block in re.findall(r"create policy [^;]*;", text):
        assert "auth.uid()" not in re.sub(r"\(select auth\.uid\(\)\)", "", block), block
        assert "can_" not in block, block


def test_0017_the_admin_overview_keeps_the_sample_handling_and_adds_the_assigned_plan(
    sql_0017: str,
) -> None:
    text = _strip_comments(sql_0017)
    assert "e.plan_id as assigned_plan_id" in text
    assert "and not v.is_sample" in text
