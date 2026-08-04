from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ccfr.api.deps import get_db
from ccfr.main import create_app
from tests.test_limits import HIT_TEXT, _add_limit_hit, _make_conn


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("ccfr.main.database_path", lambda: tmp_path / "startup.sqlite3")
    conn = _make_conn()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: conn
    with TestClient(app) as c:
        yield c
    conn.close()


def test_recent_limit_hits_returns_hit_in_default_window(client: TestClient) -> None:
    conn = client.app.dependency_overrides[get_db]()
    recent_ts = datetime.now(timezone.utc).isoformat()
    _add_limit_hit(conn, 1, recent_ts, HIT_TEXT)

    resp = client.get("/api/alerts/limit-hits")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["hits"]) == 1
    assert body["hits"][0]["session_titles"] == ["Session One"]
    assert "checked_at" in body


def test_recent_limit_hits_excludes_hits_outside_default_window(client: TestClient) -> None:
    conn = client.app.dependency_overrides[get_db]()
    _add_limit_hit(conn, 1, "2020-01-01T00:00:00Z", HIT_TEXT)

    resp = client.get("/api/alerts/limit-hits")

    assert resp.status_code == 200
    assert resp.json()["hits"] == []


def test_recent_limit_hits_honors_explicit_since(client: TestClient) -> None:
    conn = client.app.dependency_overrides[get_db]()
    _add_limit_hit(conn, 1, "2026-07-03T09:40:00Z", HIT_TEXT)

    before = client.get("/api/alerts/limit-hits", params={"since": "2026-07-01"})
    after = client.get("/api/alerts/limit-hits", params={"since": "2026-07-04"})

    assert len(before.json()["hits"]) == 1
    assert after.json()["hits"] == []


def test_recent_limit_hits_empty_corpus(client: TestClient) -> None:
    resp = client.get("/api/alerts/limit-hits")

    assert resp.status_code == 200
    assert resp.json()["hits"] == []
