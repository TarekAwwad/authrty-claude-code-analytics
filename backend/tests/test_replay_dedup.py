"""Resumed/forked sessions replay prior history; those copies must not be re-counted."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from ccfr.api import analytics, repository
from ccfr.ingest import import_export
from ccfr.storage import init_db
from ccfr.storage.database import mark_replay_events


def memory_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def _turn(uuid: str, parent: str | None, minute: int, *, output_tokens: int = 100) -> list[str]:
    """One user turn plus its priced assistant reply, as two JSONL lines."""
    ts = f"2026-01-01T00:{minute:02d}"
    user = {
        "type": "user",
        "uuid": f"u{uuid}",
        "parentUuid": parent,
        "timestamp": f"{ts}:00Z",
        "message": {"role": "user", "content": "hi"},
    }
    assistant = {
        "type": "assistant",
        "uuid": f"a{uuid}",
        "parentUuid": f"u{uuid}",
        "timestamp": f"{ts}:01Z",
        "message": {
            "id": f"msg_{uuid}",
            "role": "assistant",
            "model": "claude-opus-4-8",
            "content": [{"type": "text", "text": "ok"}],
            "usage": {
                "input_tokens": 1000,
                "cache_read_input_tokens": 5000,
                "cache_creation_input_tokens": 200,
                "output_tokens": output_tokens,
            },
        },
    }
    return [json.dumps(user), json.dumps(assistant)]


def _write_session(project: Path, session_id: str, turns: list[str]) -> None:
    project.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    parent: str | None = None
    for turn in turns:
        lines.extend(_turn(turn, parent, len(lines)))
        parent = f"a{turn}"
    (project / f"{session_id}.jsonl").write_text("\n".join(lines), encoding="utf-8")


ORIGINAL = "11111111-1111-1111-1111-111111111111"
RESUMED = "22222222-2222-2222-2222-222222222222"


def _export_with_resume(root: Path) -> Path:
    """Original session with 2 turns; a resume replaying both and adding a third."""
    project = root / "d--Alpha"
    _write_session(project, ORIGINAL, ["1", "2"])
    _write_session(project, RESUMED, ["1", "2", "3"])
    return root


def test_replayed_events_are_flagged_and_originals_are_not(tmp_path: Path) -> None:
    conn = memory_conn()
    import_export(conn, _export_with_resume(tmp_path))

    # 5 turns imported across both files, but only 3 distinct ones.
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 10
    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 0").fetchone()[0] == 6
    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 1").fetchone()[0] == 4

    # The canonical copy is the earliest imported one, so the original session keeps
    # its own events and the resume owns only the turn it added.
    flagged_sessions = {
        r[0]
        for r in conn.execute(
            "SELECT s.session_id FROM events e JOIN sessions s ON s.id = e.session_id"
            " WHERE e.is_replay = 1"
        )
    }
    assert flagged_sessions == {RESUMED}

    # Every uuid survives exactly once.
    dupes = conn.execute(
        "SELECT COUNT(*) FROM (SELECT uuid FROM events WHERE is_replay = 0 AND uuid IS NOT NULL"
        " GROUP BY uuid HAVING COUNT(*) > 1)"
    ).fetchone()[0]
    assert dupes == 0


def test_resumed_session_does_not_inflate_cost(tmp_path: Path) -> None:
    conn = memory_conn()
    import_export(conn, _export_with_resume(tmp_path))

    ids = {
        r["session_id"]: r["id"]
        for r in conn.execute("SELECT id, session_id FROM sessions")
    }
    original = repository.session_cost(conn, ids[ORIGINAL])
    resumed = repository.session_cost(conn, ids[RESUMED])

    # Two turns are attributed to the original and only the new one to the resume,
    # so the pair sums to three turns, not five.
    assert original["usd"] > 0
    assert resumed["usd"] > 0
    assert original["usd"] == round(2 * resumed["usd"], 6)

    cost = analytics.cost_analytics(conn)
    assert cost["meta"]["total_usd"] == round(original["usd"] + resumed["usd"], 6)


def test_events_without_uuid_are_never_flagged(tmp_path: Path) -> None:
    project = tmp_path / "d--Alpha"
    project.mkdir(parents=True)
    line = '{"type":"summary","timestamp":"2026-01-01T00:00:00Z","summary":"s"}'
    (project / f"{ORIGINAL}.jsonl").write_text("\n".join([line, line]), encoding="utf-8")

    conn = memory_conn()
    import_export(conn, tmp_path)

    assert conn.execute("SELECT COUNT(*) FROM events WHERE uuid IS NULL").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 1").fetchone()[0] == 0


def test_same_uuid_in_two_projects_is_not_cross_flagged(tmp_path: Path) -> None:
    _write_session(tmp_path / "d--Alpha", ORIGINAL, ["1"])
    _write_session(tmp_path / "d--Beta", RESUMED, ["1"])

    conn = memory_conn()
    import_export(conn, tmp_path)

    # Same uuids, different projects: both are canonical for their own project.
    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 1").fetchone()[0] == 0


def test_reimport_recomputes_flags(tmp_path: Path) -> None:
    conn = memory_conn()
    import_export(conn, _export_with_resume(tmp_path))
    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 1").fetchone()[0] == 4

    # Drop the resume and re-import: nothing is a replay any more.
    (tmp_path / "d--Alpha" / f"{RESUMED}.jsonl").unlink()
    import_export(conn, tmp_path)

    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 1").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 4


def test_marking_is_idempotent(tmp_path: Path) -> None:
    conn = memory_conn()
    import_export(conn, _export_with_resume(tmp_path))

    before = conn.execute("SELECT id, is_replay FROM events ORDER BY id").fetchall()
    mark_replay_events(conn)
    mark_replay_events(conn)
    after = conn.execute("SELECT id, is_replay FROM events ORDER BY id").fetchall()

    assert [tuple(r) for r in before] == [tuple(r) for r in after]


def test_migration_backfills_existing_database(tmp_path: Path) -> None:
    """A cache built before the column exists gets flagged on open, without re-import."""
    conn = memory_conn()
    import_export(conn, _export_with_resume(tmp_path))

    # Simulate the pre-migration shape: neither the index nor the column exists.
    conn.execute("DROP INDEX idx_events_replay")
    conn.execute("ALTER TABLE events DROP COLUMN is_replay")
    assert "is_replay" not in {
        r[1] for r in conn.execute("PRAGMA table_info(events)").fetchall()
    }

    init_db(conn)  # runs migrate_db

    assert conn.execute("SELECT COUNT(*) FROM events WHERE is_replay = 1").fetchone()[0] == 4
