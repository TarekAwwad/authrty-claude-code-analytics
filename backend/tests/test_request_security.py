from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from starlette.responses import JSONResponse

from ccfr.api import routes
from ccfr.main import create_app
from ccfr.security import LocalRequestGuardMiddleware, MAX_API_REQUEST_BYTES


def _client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setenv("CCFR_DB_PATH", str(tmp_path / "security.sqlite3"))
    monkeypatch.setenv("CCFR_DATA_DIR", str(tmp_path / "data"))
    return TestClient(create_app())


def test_cross_origin_state_change_is_rejected(monkeypatch, tmp_path) -> None:
    handler_called = False

    def _record_reset(_conn) -> None:
        nonlocal handler_called
        handler_called = True

    monkeypatch.setattr(routes, "reset_team_bundles", _record_reset)
    with _client(monkeypatch, tmp_path) as client:
        response = client.post(
            "/api/team/reset",
            headers={"Origin": "https://evil.example"},
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-origin state change rejected"
    assert handler_called is False


def test_cross_site_fetch_without_origin_is_rejected(monkeypatch, tmp_path) -> None:
    with _client(monkeypatch, tmp_path) as client:
        response = client.post(
            "/api/imports/reset",
            headers={"Sec-Fetch-Site": "cross-site"},
        )

    assert response.status_code == 403


def test_same_origin_and_configured_dev_origins_are_allowed(monkeypatch, tmp_path) -> None:
    with _client(monkeypatch, tmp_path) as client:
        same_origin = client.post(
            "/api/imports/reset",
            headers={"Origin": "http://testserver"},
        )
        configured_docker_origin = client.post(
            "/api/imports/reset",
            headers={"Origin": "http://localhost:5173"},
        )
        configured_vite_origin = client.post(
            "/api/imports/reset",
            headers={"Origin": "http://localhost:5174"},
        )

    assert same_origin.status_code == 200
    assert configured_docker_origin.status_code == 200
    assert configured_vite_origin.status_code == 200


def test_non_browser_client_without_origin_remains_supported(monkeypatch, tmp_path) -> None:
    with _client(monkeypatch, tmp_path) as client:
        response = client.post("/api/imports/reset")

    assert response.status_code == 200


def test_oversized_api_body_is_rejected_before_parsing(monkeypatch, tmp_path) -> None:
    with _client(monkeypatch, tmp_path) as client:
        response = client.post(
            "/api/team/import-bundle",
            content=b"{}",
            headers={"Content-Length": str(MAX_API_REQUEST_BYTES + 1)},
        )

    assert response.status_code == 413


def test_streamed_body_limit_counts_received_bytes() -> None:
    response_messages = []

    async def consume_body(scope, receive, send) -> None:
        await receive()
        await JSONResponse({"ok": True})(scope, receive, send)

    guarded = LocalRequestGuardMiddleware(
        consume_body,
        allowed_origins=[],
        max_api_request_bytes=1,
    )
    request_messages = iter(
        [{"type": "http.request", "body": b"{}", "more_body": False}]
    )

    async def receive():
        return next(request_messages)

    async def send(message) -> None:
        response_messages.append(message)

    asyncio.run(
        guarded(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/test",
                "raw_path": b"/api/test",
                "query_string": b"",
                "headers": [(b"host", b"localhost")],
                "client": ("127.0.0.1", 1),
                "server": ("127.0.0.1", 8000),
            },
            receive,
            send,
        )
    )

    assert response_messages[0]["status"] == 413