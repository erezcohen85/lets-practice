import logging
import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any

import httpx

from app.pipeline.storage_paths import plain_object_name, plain_prefix
from app.storage import StoredObject

# Supabase over plain HTTP with the service key, which bypasses row-level security: every caller
# has already checked who is asking. httpx is the only client, so tests pass a MockTransport and
# never touch the network. The bodies of refusals are never kept: they can hold row values, and
# these errors can reach a log.

BUCKET = "pieces"

# httpx logs every request's full URL, query included, at INFO. Filters in a query can hold private
# values (an email, an id), so that logger never goes below WARNING, whatever the root does.
logging.getLogger("httpx").setLevel(logging.WARNING)

_RAISED = re.compile(r"sample:[a-z_]+")
_NOT_FOUND_CODES = ("NoSuchKey", "not_found")
_LIST_PAGE = 1000
_DELETE_BATCH = 100
_TIMEOUT = httpx.Timeout(30.0, read=120.0, write=120.0)


class RestError(Exception):
    """Supabase refused a call. The text holds only the status and Postgres's error code."""

    def __init__(self, status: int, code: str | None, reason: str | None = None) -> None:
        super().__init__(f"Supabase answered {status} ({code or 'no code'})")
        self.status = status
        self.code = code
        # Only a message this project raised on purpose ("sample:already"), never free text: it is
        # not part of the error's text, so it cannot reach a log.
        self.reason = reason


def _raise_for(response: httpx.Response) -> None:
    if response.is_success:
        return
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        raise RestError(response.status_code, None)
    message = body.get("message")
    reason = message if isinstance(message, str) and _RAISED.fullmatch(message) else None
    raise RestError(response.status_code, body.get("code"), reason)


def _require_filter(params: dict[str, str]) -> None:
    """Without a filter PostgREST would change or remove every row, and this key skips RLS."""
    if not params:
        raise ValueError("An update or delete needs at least one filter.")


class SupabaseRest:
    """PostgREST with the service key."""

    def __init__(self, url: str, key: str, transport: httpx.BaseTransport | None = None) -> None:
        # Checked first and never quoted: a key with a stray newline would otherwise be echoed
        # whole by the HTTP library's own error, and that error can reach a log.
        if not key or any(not 33 <= ord(char) <= 126 for char in key):
            raise ValueError("The Supabase key holds characters a request header cannot carry.")
        headers = {"apikey": key}
        # A secret key (sb_secret_...) goes on apikey only, as Supabase's docs say. A legacy
        # service_role key is a JWT and is also sent as a bearer.
        if not key.startswith("sb_"):
            headers["Authorization"] = f"Bearer {key}"
        # Private: its headers hold the key in the clear. Redirects stay off, because httpx would
        # carry `apikey` (not on its sensitive-header list) to whatever host answered.
        self._client = httpx.Client(
            base_url=url.rstrip("/"),
            headers=headers,
            timeout=_TIMEOUT,
            transport=transport,
            follow_redirects=False,
        )

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        response = self._client.get(f"/rest/v1/{table}", params=params)
        _raise_for(response)
        return response.json()

    def select_all(
        self,
        table: str,
        params: dict[str, str],
        page_size: int = 500,
        max_rows: int = 1_000_000,
    ) -> list[dict[str, Any]]:
        """Every row that matches, read page by page.

        A project answers at most Max Rows (1000 by default) whatever limit is asked, so one read
        of a big table is cut short without an error. This reads until a page comes back empty,
        which is right whatever the cap is. `order` is required: without it the pages of one
        query may overlap or skip rows. `max_rows` stops a server that ignores the offset.
        """
        if "order" not in params:
            raise ValueError("Reading in pages needs an order.")
        rows: list[dict[str, Any]] = []
        while True:
            page = self.select(table, {**params, "limit": str(page_size), "offset": str(len(rows))})
            if not page:
                return rows
            rows.extend(page)
            if len(rows) > max_rows:
                raise RuntimeError("The read did not end; the server may ignore the offset.")

    def insert(self, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        response = self._client.post(
            f"/rest/v1/{table}", json=rows, headers={"Prefer": "return=representation"}
        )
        _raise_for(response)
        return response.json()

    def update(
        self, table: str, params: dict[str, str], values: dict[str, Any]
    ) -> list[dict[str, Any]]:
        _require_filter(params)
        response = self._client.patch(
            f"/rest/v1/{table}",
            params=params,
            json=values,
            headers={"Prefer": "return=representation"},
        )
        _raise_for(response)
        return response.json()

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
        response = self._client.post(
            f"/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        _raise_for(response)

    def delete(self, table: str, params: dict[str, str]) -> None:
        _require_filter(params)
        _raise_for(self._client.delete(f"/rest/v1/{table}", params=params))

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        response = self._client.post(f"/rest/v1/rpc/{name}", json=args)
        _raise_for(response)
        return response.json() if response.content else None


class SupabaseStorage:
    """The pieces bucket with the service key."""

    def __init__(self, rest: SupabaseRest) -> None:
        self._client = rest._client

    def download(self, path: str) -> bytes:
        response = self._client.get(f"/storage/v1/object/{BUCKET}/{plain_object_name(path)}")
        if response.status_code == 404 or _says_not_found(response):
            raise FileNotFoundError(path)
        _raise_for(response)
        return response.content

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        response = self._client.post(
            f"/storage/v1/object/{BUCKET}/{plain_object_name(path)}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "true"},
        )
        _raise_for(response)

    def list_objects(self, folder: str) -> list[StoredObject]:
        found: list[StoredObject] = []
        while True:
            response = self._client.post(
                f"/storage/v1/object/list/{BUCKET}",
                json={
                    "prefix": plain_prefix(folder),
                    "limit": _LIST_PAGE,
                    "offset": len(found),
                    "sortBy": {"column": "name", "order": "asc"},
                },
            )
            _raise_for(response)
            page = response.json()
            # a folder is listed with no id and no times; only files count
            found.extend(
                StoredObject(item["name"], datetime.fromisoformat(item["created_at"]))
                for item in page
                if item.get("id") and item.get("created_at")
            )
            if len(page) < _LIST_PAGE:
                return found

    def copy(self, source: str, destination: str) -> None:
        # the keys go in a JSON body, not a URL: validated here, sent as they are (not quoted)
        plain_object_name(source)
        plain_object_name(destination)
        response = self._client.post(
            "/storage/v1/object/copy",
            json={"bucketId": BUCKET, "sourceKey": source, "destinationKey": destination},
        )
        _raise_for(response)

    def delete(self, paths: Sequence[str]) -> None:
        names = list(paths)
        for name in names:
            plain_object_name(name)  # refused before any request goes out
        for start in range(0, len(names), _DELETE_BATCH):
            response = self._client.request(
                "DELETE",
                f"/storage/v1/object/{BUCKET}",
                json={"prefixes": names[start : start + _DELETE_BATCH]},
            )
            _raise_for(response)


def _says_not_found(response: httpx.Response) -> bool:
    """Storage has answered a missing object with 400 and a 404 or a not-found code in the body."""
    if response.status_code != 400:
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    if not isinstance(body, dict):
        return False
    status = str(body.get("statusCode") or body.get("httpStatusCode"))
    return (
        status == "404"
        or body.get("code") in _NOT_FOUND_CODES
        or body.get("error") in (_NOT_FOUND_CODES)
    )
