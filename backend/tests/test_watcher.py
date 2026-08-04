from __future__ import annotations

from pathlib import Path

import pytest
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver

import ccfr.ingest.watcher as watcher_mod
from ccfr.ingest.watcher import LogWatcher, _DebouncedImportHandler


class _FakeEvent:
    def __init__(self, is_directory: bool) -> None:
        self.is_directory = is_directory


def test_start_noops_when_source_root_missing(tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist"
    watcher = LogWatcher(source_root=missing)

    watcher.start()

    assert watcher._started is False
    watcher.stop()  # must not raise on a watcher that never started


def test_start_and_stop_lifecycle(tmp_path: Path) -> None:
    watcher = LogWatcher(source_root=tmp_path)

    watcher.start()
    assert watcher._started is True

    watcher.stop()
    assert watcher._started is False


def test_uses_polling_observer_in_docker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(watcher_mod, "is_docker", lambda: True)

    watcher = LogWatcher(source_root=tmp_path)

    assert isinstance(watcher._observer, PollingObserver)


def test_uses_native_observer_outside_docker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(watcher_mod, "is_docker", lambda: False)

    watcher = LogWatcher(source_root=tmp_path)

    assert isinstance(watcher._observer, Observer)


def test_on_any_event_ignores_directory_events(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    armed = []
    handler = _DebouncedImportHandler(tmp_path)
    monkeypatch.setattr(handler, "_arm", lambda: armed.append(True))

    handler.on_any_event(_FakeEvent(is_directory=True))

    assert armed == []


def test_on_any_event_arms_for_file_events(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    armed = []
    handler = _DebouncedImportHandler(tmp_path)
    monkeypatch.setattr(handler, "_arm", lambda: armed.append(True))

    handler.on_any_event(_FakeEvent(is_directory=False))

    assert armed == [True]


def test_arm_debounces_rapid_events(tmp_path: Path) -> None:
    handler = _DebouncedImportHandler(tmp_path)

    handler._arm()
    first_timer = handler._timer
    handler._arm()
    second_timer = handler._timer

    # Re-arming cancels the previous timer and schedules a fresh one, so a
    # burst of writes coalesces into a single eventual import.
    assert first_timer is not None
    assert second_timer is not None
    assert first_timer is not second_timer

    handler.cancel_pending()
    assert handler._timer is None


def test_run_import_invokes_import_all_new(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []
    fake_conn = object()
    monkeypatch.setattr(watcher_mod, "connect", lambda _path: fake_conn)
    monkeypatch.setattr(
        watcher_mod, "import_all_new", lambda conn, source_root: calls.append((conn, source_root))
    )

    handler = _DebouncedImportHandler(tmp_path)
    handler._run_import()

    assert calls == [(fake_conn, tmp_path)]


def test_run_import_swallows_exceptions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(watcher_mod, "connect", lambda _path: object())

    def boom(conn, source_root):
        raise RuntimeError("partial write mid-import")

    monkeypatch.setattr(watcher_mod, "import_all_new", boom)

    handler = _DebouncedImportHandler(tmp_path)
    handler._run_import()  # must not raise -- the watcher thread has to survive this
