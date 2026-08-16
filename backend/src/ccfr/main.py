from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from ccfr.api import router
from ccfr.config import allowed_hosts, allowed_origins, app_version, database_path, webui_dir
from ccfr.security import LocalRequestGuardMiddleware
from ccfr.storage import connect, init_db


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    db_path = database_path()
    # The default DB location differs between a source checkout (.ccfr-data/)
    # and an installed wheel (~/.checkyouragent), so say which one was
    # picked -- otherwise switching run modes looks like vanished data.
    print(f"checkyouragent: database at {db_path}")
    conn = connect(db_path)
    try:
        init_db(conn)
    finally:
        conn.close()
    yield


def _mount_webui(app: FastAPI) -> None:
    """Serve the built SPA from ccfr/webui/ when present (packaged wheel / uvx).

    No-op in dev and tests where the assets are absent -- the API still serves.
    The /api routes and OpenAPI docs are registered before this catch-all, so
    they always win; only genuinely unknown paths fall back to the SPA shell.
    """
    root = webui_dir()
    index = root / "index.html"
    if not index.is_file():
        return
    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    root_resolved = root.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith(("api", "assets")):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (root / full_path).resolve()
        within_root = candidate == root_resolved or root_resolved in candidate.parents
        if full_path and within_root and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


def _mount_docs(app: FastAPI) -> None:
    """Serve Swagger UI from assets vendored into the package.

    FastAPI's stock /docs and /redoc pages load their JavaScript from
    cdn.jsdelivr.net. That script runs in the API's own unauthenticated
    origin, so a compromised CDN could read raw session content; it also
    contradicts the product's no-external-services stance. /redoc stays
    disabled (nothing uses it) and /docs is rebuilt on local files.
    """
    assets_dir = Path(__file__).resolve().parent / "docs_assets"
    app.mount("/docs-assets", StaticFiles(directory=assets_dir), name="docs-assets")

    @app.get("/docs", include_in_schema=False)
    def swagger_ui() -> HTMLResponse:
        return get_swagger_ui_html(
            openapi_url=app.openapi_url or "/openapi.json",
            title=f"{app.title} - Swagger UI",
            swagger_js_url="/docs-assets/swagger-ui-bundle.js",
            swagger_css_url="/docs-assets/swagger-ui.css",
            swagger_favicon_url="/docs-assets/favicon-32x32.png",
            # The bundle's default validator badge only skips URLs containing
            # localhost/127.0.0.1, so a non-loopback deployment would send the
            # spec URL to validator.swagger.io.
            swagger_ui_parameters={"validatorUrl": None},
        )


def create_app() -> FastAPI:
    app = FastAPI(
        title="Check Your Agent",
        version=app_version(),
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )
    origins = allowed_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # CORS controls which browsers may read responses; this guard separately
    # rejects cross-origin state changes and oversized API bodies.
    app.add_middleware(LocalRequestGuardMiddleware, allowed_origins=origins)
    # Reject foreign Host headers to defeat DNS rebinding. Added last so it wraps
    # the other middleware and screens the Host before the request guard runs.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts())
    app.include_router(router)
    _mount_docs(app)
    _mount_webui(app)
    return app


app = create_app()
