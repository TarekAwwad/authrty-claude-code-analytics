from __future__ import annotations

import logging
import threading
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver

from ccfr.config import database_path, import_root, is_docker
from ccfr.ingest.importer import import_all_new
from ccfr.storage import connect


logger = logging.getLogger(__name__)

DEBOUNCE_SECONDS = 2.0


class _DebouncedImportHandler(FileSystemEventHandler):
    """Coalesces bursty filesystem events into one incremental import.

    Claude Code writes session JSONL incrementally, so a single turn can
    produce several rapid writes. Debouncing avoids re-running the importer
    (which hashes every file in a changed project) once per write.
    """

    def __init__(self, source_root: Path) -> None:
        self._source_root = source_root
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self._arm()

    def _arm(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(DEBOUNCE_SECONDS, self._run_import)
            self._timer.daemon = True
            self._timer.start()

    def cancel_pending(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def _run_import(self) -> None:
        try:
            conn = connect(database_path())
            try:
                import_all_new(conn, self._source_root)
            finally:
                conn.close()
        except Exception:
            # A partial write mid-import, or a transient filesystem hiccup, must
            # not kill the watcher thread -- the next debounced cycle picks up
            # whatever settled.
            logger.exception("live import failed")


class LogWatcher:
    """Watches CCFR_IMPORT_ROOT and incrementally imports new/changed sessions.

    Runs for the life of the app process (started/stopped from the FastAPI
    lifespan) -- the first persistent background component in this app. Every
    other long-running operation here is request-scoped; see
    api/import_progress.py for the polling equivalent used by the manual
    "Import" flow.
    """

    def __init__(self, source_root: Path | None = None) -> None:
        self._source_root = source_root or import_root()
        self._handler = _DebouncedImportHandler(self._source_root)
        # watchdog's native OS-event observer can miss events over Docker
        # Desktop's bind-mounted volumes on macOS (gRPC-FUSE/virtiofs don't
        # reliably forward inotify), so poll instead when running in a
        # container; the native Observer elsewhere is instant and cheap.
        self._observer = PollingObserver() if is_docker() else Observer()
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        if not self._source_root.is_dir():
            logger.warning(
                "live watcher: import root %s does not exist, not watching", self._source_root
            )
            return
        self._observer.schedule(self._handler, str(self._source_root), recursive=True)
        self._observer.start()
        self._started = True

    def stop(self) -> None:
        if not self._started:
            return
        self._handler.cancel_pending()
        self._observer.stop()
        self._observer.join(timeout=5.0)
        self._started = False
