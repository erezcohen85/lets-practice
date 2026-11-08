"""Turn a too-large request away before anything of it is parsed.

The routes read their body only after the caller is known (see `app.main.job_body`), but a body
that is read at all must have a size: without this a signed-in caller could make the processor
hold a body of any size in memory. A body over MAX_BODY_BYTES is answered 413, by its
Content-Length (nothing is read) or, for a chunked body, by counting what arrives. It sits inside
CORS, so the browser can read the 413. Nothing of the body is logged.

A real body is a few dozen bytes (a piece id), or a timing: the largest sample's whole map is under
200 KB, and the bar limit (5,000 played bars) keeps one far below this.
"""

from typing import Any

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 1_000_000
TOO_LARGE = "That request is too large."


async def _too_large(scope: Scope, receive: Receive, send: Send) -> None:
    await JSONResponse({"detail": TOO_LARGE}, status_code=413)(scope, receive, send)


class BodyLimitMiddleware:
    """Pure ASGI, so a body is never buffered by the middleware itself."""

    def __init__(self, app: ASGIApp, *, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self._max = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self._max:
            await _too_large(scope, receive, send)
            return

        # A chunked body has no length to look at: count it as it arrives. Past the limit the 413
        # goes out at once, the app is told the client is gone, and what it then sends is dropped.
        received = 0
        rejected = False

        async def counted() -> Message:
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self._max:
                    rejected = True
                    await _too_large(scope, receive, send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded(message: Any) -> None:
            if not rejected:
                await send(message)

        await self.app(scope, counted, guarded)
