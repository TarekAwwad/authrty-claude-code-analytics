"""HTTP request guards for the unauthenticated local API."""

from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


MAX_API_REQUEST_BYTES = 50 * 1024 * 1024
_STATE_CHANGING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class _RequestBodyTooLarge(Exception):
    pass


def _origin_key(value: str) -> tuple[str, str, int] | None:
    """Return a normalized (scheme, host, port) tuple for an HTTP origin."""
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    scheme = parsed.scheme.lower()
    if (
        scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        return None
    if port is None:
        port = 443 if scheme == "https" else 80
    return scheme, parsed.hostname.lower().rstrip("."), port


def _origin_is_allowed(
    origin: str,
    *,
    configured_origins: frozenset[str],
    scope: Scope,
    host: str,
) -> bool:
    if "*" in configured_origins or origin.rstrip("/") in configured_origins:
        return True
    request_origin = _origin_key(f"{scope.get('scheme', 'http')}://{host}")
    return request_origin is not None and _origin_key(origin) == request_origin


class LocalRequestGuardMiddleware:
    """Reject browser-forged mutations and cap API request bodies.

    Browser requests carry Origin and/or Fetch Metadata headers. Non-browser
    clients commonly carry neither, so they remain usable for local automation.
    Host validation remains a separate outer guard against DNS rebinding.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        allowed_origins: Iterable[str],
        max_api_request_bytes: int = MAX_API_REQUEST_BYTES,
    ) -> None:
        self.app = app
        self.allowed_origins = frozenset(origin.rstrip("/") for origin in allowed_origins)
        self.max_api_request_bytes = max_api_request_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        method = str(scope.get("method", "GET")).upper()
        if method in _STATE_CHANGING_METHODS:
            origin = headers.get("origin")
            fetch_site = headers.get("sec-fetch-site", "").lower()
            host = headers.get("host", "")
            if origin and not _origin_is_allowed(
                origin,
                configured_origins=self.allowed_origins,
                scope=scope,
                host=host,
            ):
                await self._reject(scope, receive, send, 403, "Cross-origin state change rejected")
                return
            if not origin and fetch_site == "cross-site":
                await self._reject(scope, receive, send, 403, "Cross-site state change rejected")
                return

        is_api_request = str(scope.get("path", "")).startswith("/api/")
        if not is_api_request:
            await self.app(scope, receive, send)
            return

        content_length = headers.get("content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await self._reject(scope, receive, send, 400, "Invalid Content-Length")
                return
            if declared_length < 0:
                await self._reject(scope, receive, send, 400, "Invalid Content-Length")
                return
            if declared_length > self.max_api_request_bytes:
                await self._reject(scope, receive, send, 413, "API request body is too large")
                return

        received_bytes = 0

        async def limited_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > self.max_api_request_bytes:
                    raise _RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _RequestBodyTooLarge:
            await self._reject(scope, receive, send, 413, "API request body is too large")

    @staticmethod
    async def _reject(
        scope: Scope,
        receive: Receive,
        send: Send,
        status_code: int,
        detail: str,
    ) -> None:
        await JSONResponse({"detail": detail}, status_code=status_code)(scope, receive, send)
