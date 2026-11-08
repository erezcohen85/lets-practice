import json
import logging

import httpx
import pytest

from app.pipeline.storage_paths import plain_object_name
from app.storage import Storage
from app.supabase_rest import RestError, SupabaseRest, SupabaseStorage

URL = "https://project.supabase.example"


def rest_with(handler, key: str = "sb_secret_abc") -> SupabaseRest:
    return SupabaseRest(URL, key, transport=httpx.MockTransport(handler))


def test_a_secret_key_goes_only_on_the_apikey_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    rest_with(handler).select("pieces", {"select": "id"})
    assert seen[0].headers["apikey"] == "sb_secret_abc"
    assert "authorization" not in seen[0].headers


def test_a_legacy_service_role_jwt_also_goes_as_a_bearer() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    rest_with(handler, key="eyJhbGciOi").select("pieces", {"select": "id"})
    assert seen[0].headers["authorization"] == "Bearer eyJhbGciOi"


def test_select_sends_the_filters_and_returns_rows() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/pieces"
        assert request.url.params["id"] == "eq.abc"
        return httpx.Response(200, json=[{"owner_id": "u"}])

    assert rest_with(handler).select("pieces", {"id": "eq.abc", "select": "owner_id"}) == [
        {"owner_id": "u"}
    ]


def test_a_refusal_is_a_rest_error_with_no_key_or_body_in_its_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"code": "23505", "message": "private row text"})

    with pytest.raises(RestError) as raised:
        rest_with(handler).insert("jobs", [{"piece_id": "p"}])
    assert raised.value.status == 409
    assert raised.value.code == "23505"
    assert "private" not in str(raised.value)
    assert "sb_secret" not in str(raised.value)


def test_rpc_posts_the_arguments() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/service_is_creator"
        assert json.loads(request.content) == {"target": "u"}
        return httpx.Response(200, json=True)

    assert rest_with(handler).rpc("service_is_creator", {"target": "u"}) is True


def test_storage_meets_the_protocol_and_uploads_with_upsert() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"Key": "x"})

    storage = SupabaseStorage(rest_with(handler))
    assert isinstance(storage, Storage)
    storage.upload("u/p/a b.pdf", b"bytes", "application/pdf")
    assert seen[0].method == "POST"
    assert seen[0].url.raw_path == b"/storage/v1/object/pieces/u/p/a%20b.pdf"
    assert seen[0].headers["x-upsert"] == "true"
    assert seen[0].headers["content-type"] == "application/pdf"
    assert seen[0].content == b"bytes"


def test_storage_downloads_bytes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"pdf")

    assert SupabaseStorage(rest_with(handler)).download("u/p/a.pdf") == b"pdf"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, json={"message": "Object not found"}),
        httpx.Response(400, json={"statusCode": "404", "error": "not_found", "message": "x"}),
        httpx.Response(400, json={"httpStatusCode": 404, "message": "x"}),
        httpx.Response(400, json={"code": "NoSuchKey", "message": "x"}),
        httpx.Response(400, json={"code": "not_found", "message": "x"}),
    ],
)
def test_a_missing_file_is_file_not_found_either_way_storage_says_it(
    response: httpx.Response,
) -> None:
    storage = SupabaseStorage(rest_with(lambda request: response))
    with pytest.raises(FileNotFoundError):
        storage.download("u/p/a.pdf")


def test_another_storage_failure_is_not_file_not_found() -> None:
    storage = SupabaseStorage(rest_with(lambda request: httpx.Response(500, json={})))
    with pytest.raises(RestError):
        storage.download("u/p/a.pdf")


@pytest.mark.parametrize(
    "path",
    [
        "/u/p/a.pdf",
        "u/p/../a.pdf",
        "u/p/./a.pdf",
        "u//a.pdf",
        "u/p/a.pdf/",
        "u/p/%2e%2e/a.pdf",
        "u/p/a?x=1",
        "u/p/a#x",
        "u\\p\\a.pdf",
        "u/p/a\n.pdf",
        "",
    ],
)
def test_an_object_name_is_refused_before_any_request(path: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may go out")

    storage = SupabaseStorage(rest_with(handler))
    with pytest.raises(ValueError):
        storage.download(path)
    with pytest.raises(ValueError):
        storage.upload(path, b"x", "application/pdf")
    with pytest.raises(ValueError):
        plain_object_name(path)


def test_a_plain_name_is_quoted_segment_by_segment() -> None:
    assert plain_object_name("u/p/a b.pdf") == "u/p/a%20b.pdf"


# --- a malformed key is refused without being quoted ---------------------------------------


@pytest.mark.parametrize("key", ["", "sb_secret_LE\nAK", "sb_secret LEAK", "sb_secret_é", "sb\x7f"])
def test_a_key_a_header_cannot_carry_is_refused_without_quoting_it(key: str) -> None:
    with pytest.raises(ValueError) as raised:
        SupabaseRest(URL, key)
    message = str(raised.value)
    assert "sb_secret" not in message
    assert "LEAK" not in message
    assert "AK" not in message


# --- logging, redirects, privacy -------------------------------------------------------------


def test_the_httpx_logger_never_prints_urls() -> None:
    # httpx logs the full URL of each request at INFO; a filter can hold an email.
    # its own level, not the root's
    assert logging.getLogger("httpx").level == logging.WARNING


def test_a_redirect_is_a_rest_error_and_is_not_followed() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(302, headers={"Location": "https://elsewhere.example/x"})

    with pytest.raises(RestError) as raised:
        rest_with(handler).select("pieces", {"select": "id"})
    assert raised.value.status == 302
    assert len(seen) == 1


def test_the_client_is_not_public() -> None:
    rest = rest_with(lambda request: httpx.Response(200, json=[]))
    assert not hasattr(rest, "client")


# --- update, upsert, delete --------------------------------------------------------------------


def test_update_patches_the_filtered_rows_and_returns_them() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"id": "j", "status": "done"}])

    rows = rest_with(handler).update("jobs", {"id": "eq.j"}, {"status": "done"})
    assert rows == [{"id": "j", "status": "done"}]
    assert seen[0].method == "PATCH"
    assert seen[0].url.path == "/rest/v1/jobs"
    assert seen[0].url.params["id"] == "eq.j"
    assert json.loads(seen[0].content) == {"status": "done"}
    assert seen[0].headers["prefer"] == "return=representation"


def test_upsert_merges_on_the_conflict_columns() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201)

    rest_with(handler).upsert("play_order", [{"piece_id": "p"}], "piece_id")
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/rest/v1/play_order"
    assert seen[0].url.params["on_conflict"] == "piece_id"
    assert seen[0].headers["prefer"] == "resolution=merge-duplicates,return=minimal"
    assert json.loads(seen[0].content) == [{"piece_id": "p"}]


def test_delete_sends_the_filters() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    rest_with(handler).delete("locators", {"piece_id": "eq.p"})
    assert seen[0].method == "DELETE"
    assert seen[0].url.params["piece_id"] == "eq.p"


def test_update_and_delete_refuse_to_run_without_a_filter() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may go out")

    rest = rest_with(handler)
    with pytest.raises(ValueError):
        rest.update("jobs", {}, {"status": "done"})
    with pytest.raises(ValueError):
        rest.delete("jobs", {})


def test_a_transport_error_is_not_swallowed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(httpx.ConnectError):
        rest_with(handler).select("pieces", {"select": "id"})


def test_a_name_with_a_delete_character_is_refused() -> None:
    with pytest.raises(ValueError):
        plain_object_name("u/p/a\x7f.pdf")


def _paged_server(total: int, cap: int):
    """A PostgREST that holds `total` rows and never answers more than `cap` (its Max Rows)."""
    rows = [{"n": n} for n in range(total)]
    asked: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        asked.append(params)
        start = int(params.get("offset", "0"))
        size = min(int(params.get("limit", str(cap))), cap)
        return httpx.Response(200, json=rows[start : start + size])

    return handler, rows, asked


def test_select_all_reads_every_row_past_the_servers_max_rows() -> None:
    handler, rows, asked = _paged_server(total=1484, cap=1000)
    got = rest_with(handler).select_all("bars", {"select": "n", "order": "n"})
    assert got == rows
    assert all(int(params["limit"]) <= 500 for params in asked)


def test_select_all_still_ends_when_the_server_caps_below_the_page_size() -> None:
    handler, rows, _ = _paged_server(total=250, cap=100)
    assert rest_with(handler).select_all("bars", {"select": "n", "order": "n"}) == rows


def test_select_all_of_nothing_is_an_empty_list() -> None:
    handler, _, asked = _paged_server(total=0, cap=1000)
    assert rest_with(handler).select_all("bars", {"select": "n", "order": "n"}) == []
    assert len(asked) == 1


def test_select_all_needs_an_order_so_the_pages_do_not_overlap() -> None:
    handler, _, asked = _paged_server(total=3, cap=1000)
    with pytest.raises(ValueError, match="order"):
        rest_with(handler).select_all("bars", {"select": "n"})
    assert asked == []


def test_select_all_gives_up_on_a_server_that_ignores_the_offset() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"n": 1}])

    with pytest.raises(RuntimeError, match="did not end"):
        rest_with(handler).select_all("bars", {"select": "n", "order": "n"}, max_rows=5000)


def test_storage_lists_the_files_of_a_folder_and_skips_sub_folders() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json=[
                {"name": "a.pdf", "id": "1", "created_at": "2026-11-05T10:00:00.000Z"},
                {"name": "sub", "id": None, "created_at": None},
            ],
        )

    found = SupabaseStorage(rest_with(handler)).list_objects("u/staging")

    assert [(item.name, item.created_at.isoformat()) for item in found] == [
        ("a.pdf", "2026-11-05T10:00:00+00:00")
    ]
    assert seen[0].url.path == "/storage/v1/object/list/pieces"
    assert json.loads(seen[0].content)["prefix"] == "u/staging"


def test_storage_lists_page_by_page_until_a_short_page() -> None:
    pages = [
        [
            {"name": f"{n}.pdf", "id": str(n), "created_at": "2026-11-05T10:00:00Z"}
            for n in range(1000)
        ],
        [{"name": "last.pdf", "id": "x", "created_at": "2026-11-05T10:00:00Z"}],
    ]
    offsets: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        offset = json.loads(request.content)["offset"]
        offsets.append(offset)
        return httpx.Response(200, json=pages[0 if offset == 0 else 1])

    found = SupabaseStorage(rest_with(handler)).list_objects("u/staging")

    assert len(found) == 1001 and offsets == [0, 1000]


def test_storage_deletes_files_by_name_in_batches() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    paths = [f"u/staging/{n}.pdf" for n in range(250)]
    SupabaseStorage(rest_with(handler)).delete(paths)

    assert [r.method for r in seen] == ["DELETE"] * 3
    assert seen[0].url.path == "/storage/v1/object/pieces"
    assert [len(json.loads(r.content)["prefixes"]) for r in seen] == [100, 100, 50]


def test_storage_refuses_a_name_that_could_leave_its_folder_before_any_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may go out")

    storage = SupabaseStorage(rest_with(handler))
    with pytest.raises(ValueError):
        storage.delete(["u/../other/a.pdf"])
    with pytest.raises(ValueError):
        storage.list_objects("u/%2e%2e")
