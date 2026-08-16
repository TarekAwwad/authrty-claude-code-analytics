from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Pin the webui dir to an absent path: on a machine with built SPA assets
    # the catch-all would otherwise answer /redoc with the app shell.
    monkeypatch.setenv("CCFR_WEBUI_DIR", str(tmp_path / "no-webui"))
    monkeypatch.setenv("CCFR_DB_PATH", str(tmp_path / "docs.sqlite3"))
    monkeypatch.setenv("CCFR_DATA_DIR", str(tmp_path / "data"))
    from ccfr.main import create_app

    with TestClient(create_app()) as client:
        yield client


def test_redoc_is_disabled(client):
    # ReDoc is unused and its stock page pulls JavaScript from a CDN; the
    # route must not exist at all.
    assert client.get("/redoc").status_code == 404


def test_docs_page_references_no_external_hosts(client):
    # The docs page runs in the API's own unauthenticated origin, so any
    # third-party script it loads could read local session data. Every
    # resource reference must be relative.
    resp = client.get("/docs")
    assert resp.status_code == 200
    assert "swagger-ui" in resp.text.lower()
    assert "https://" not in resp.text
    assert "http://" not in resp.text


def test_docs_page_assets_are_served_locally(client):
    page = client.get("/docs").text
    for path in (
        "/docs-assets/swagger-ui-bundle.js",
        "/docs-assets/swagger-ui.css",
        "/docs-assets/favicon-32x32.png",
    ):
        assert path in page
        resp = client.get(path)
        assert resp.status_code == 200
        assert len(resp.content) > 0


def test_docs_are_not_shadowed_by_spa_fallback(tmp_path, monkeypatch):
    webui = tmp_path / "webui"
    webui.mkdir()
    (webui / "index.html").write_text(
        "<!doctype html><title>Demo SPA</title>", encoding="utf-8"
    )
    monkeypatch.setenv("CCFR_WEBUI_DIR", str(webui))
    monkeypatch.setenv("CCFR_DB_PATH", str(tmp_path / "docs-spa.sqlite3"))
    monkeypatch.setenv("CCFR_DATA_DIR", str(tmp_path / "data"))
    from ccfr.main import create_app

    with TestClient(create_app()) as client:
        page = client.get("/docs")
        assert page.status_code == 200
        assert "swagger-ui" in page.text.lower()
        assert "Demo SPA" not in page.text
        asset = client.get("/docs-assets/swagger-ui-bundle.js")
        assert asset.status_code == 200
        assert "Demo SPA" not in asset.text
