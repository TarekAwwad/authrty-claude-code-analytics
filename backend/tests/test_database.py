from __future__ import annotations

import json
import sqlite3

import pytest

from ccfr.storage import init_db, reset_db


def test_init_db_migrates_legacy_message_cost_columns() -> None:
    conn = sqlite3.connect(":memory:")
    conn.execute(
        """
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL,
            role TEXT,
            model TEXT,
            stop_reason TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            text_preview TEXT
        )
        """
    )
    conn.execute(
        "INSERT INTO messages(event_id, role, model, input_tokens, output_tokens) VALUES (1, 'assistant', 'm', 123, 45)"
    )

    init_db(conn)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
    assert {"base_input_tokens", "cache_5m_tokens", "cache_1h_tokens", "cache_read_tokens"} <= columns
    assert conn.execute("SELECT base_input_tokens FROM messages").fetchone()[0] == 123


def test_init_db_creates_analytics_indexes() -> None:
    conn = sqlite3.connect(":memory:")
    init_db(conn)

    project_indexes = {row[1] for row in conn.execute("PRAGMA index_list(projects)").fetchall()}
    event_indexes = {row[1] for row in conn.execute("PRAGMA index_list(events)").fetchall()}
    message_indexes = {row[1] for row in conn.execute("PRAGMA index_list(messages)").fetchall()}
    tool_call_indexes = {row[1] for row in conn.execute("PRAGMA index_list(tool_calls)").fetchall()}
    persisted_indexes = {row[1] for row in conn.execute("PRAGMA index_list(persisted_outputs)").fetchall()}
    edge_indexes = {row[1] for row in conn.execute("PRAGMA index_list(event_edges)").fetchall()}

    assert {"idx_projects_export_name"} <= project_indexes
    assert {
        "idx_events_session_id",
        "idx_events_timestamp_session",
        "idx_events_session_uuid",
        "idx_events_session_parent_uuid",
    } <= event_indexes
    assert {"idx_messages_event", "idx_messages_role_event"} <= message_indexes
    assert {"idx_tool_calls_event", "idx_tool_calls_session", "idx_tool_calls_session_use"} <= tool_call_indexes
    tool_result_indexes = {row[1] for row in conn.execute("PRAGMA index_list(tool_results)").fetchall()}
    assert {"idx_tool_results_event", "idx_tool_results_session_use"} <= tool_result_indexes
    assert {"idx_persisted_outputs_session"} <= persisted_indexes
    assert {"idx_event_edges_session", "idx_event_edges_source", "idx_event_edges_target"} <= edge_indexes


def test_init_db_and_reset_cover_team_bundle_tables() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
    assert {"team_bundles", "team_bundle_sessions"} <= tables

    cur = conn.execute(
        """
        INSERT INTO team_bundles(
            bundle_id, profile, schema_version, member_id, generated_at,
            app_version, imported_at, source_path, session_count
        )
        VALUES ('bundle', 'team_strict', 1, 'member', '2026-06-18', '0.1.0',
                '2026-06-18T00:00:00Z', 'bundle.json', 1)
        """
    )
    conn.execute(
        """
        INSERT INTO team_bundle_sessions(
            team_bundle_id, member_id, project_id, session_id, provider
        )
        VALUES (?, 'member', 'pid', 'sid', 'claude')
        """,
        (cur.lastrowid,),
    )

    reset_db(conn)

    assert conn.execute("SELECT COUNT(*) FROM team_bundles").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM team_bundle_sessions").fetchone()[0] == 0


def test_init_db_creates_tokens_by_model_column() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(team_bundle_sessions)").fetchall()}
    assert "tokens_by_model_json" in columns


def test_migrate_db_adds_tokens_by_model_to_legacy_team_table() -> None:
    from ccfr.storage.database import migrate_db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # A database created before per-model tokens: messages exists (the message
    # migration needs it), team_bundle_sessions lacks the new column.
    conn.executescript(
        """
        CREATE TABLE messages (id INTEGER PRIMARY KEY, input_tokens INTEGER DEFAULT 0);
        CREATE TABLE team_bundle_sessions (id INTEGER PRIMARY KEY, session_id TEXT);
        """
    )

    migrate_db(conn)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(team_bundle_sessions)").fetchall()}
    assert "tokens_by_model_json" in columns


def test_migrate_adds_and_backfills_file_ext_on_legacy_tool_calls():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # Legacy shape: tool_calls without file_ext, holding an already-imported Read call.
    conn.execute(
        """
        CREATE TABLE tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            tool_use_id TEXT,
            tool_name TEXT,
            input_preview TEXT,
            raw_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "INSERT INTO tool_calls(event_id, session_id, tool_use_id, tool_name, input_preview, raw_json)"
        " VALUES (1, 1, 't1', 'Read', 'preview', ?)",
        (json.dumps({"type": "tool_use", "name": "Read", "input": {"file_path": "src/App.TSX"}}),),
    )
    init_db(conn)

    row = conn.execute("SELECT file_ext FROM tool_calls").fetchone()
    assert row["file_ext"] == "tsx"


def test_migrate_adds_team_privacy_level_columns():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    bundle_cols = {r[1] for r in conn.execute("PRAGMA table_info(team_bundles)")}
    session_cols = {r[1] for r in conn.execute("PRAGMA table_info(team_bundle_sessions)")}
    assert "member_name" in bundle_cols
    assert {"project_name", "tools_json", "file_types_json"} <= session_cols


def _insert_session(conn: sqlite3.Connection, external_id: str = "session-a") -> int:
    import_id = conn.execute(
        "INSERT INTO imports(source_path, imported_at, status) VALUES ('/fixture', '2026-01-01', 'completed')"
    ).lastrowid
    project_id = conn.execute(
        "INSERT INTO projects(import_id, export_name) VALUES (?, ?)",
        (import_id, f"project-{external_id}"),
    ).lastrowid
    return int(
        conn.execute(
            "INSERT INTO sessions(project_id, session_id) VALUES (?, ?)",
            (project_id, external_id),
        ).lastrowid
    )


def _insert_tool_receipt(
    conn: sqlite3.Connection,
    session_id: int,
    ordinal: int,
    *,
    output: str,
    is_error: bool,
) -> None:
    tool_use_id = f"tool-{ordinal}"
    call_event_id = conn.execute(
        """
        INSERT INTO events(session_id, source_path, line_no, type, raw_json)
        VALUES (?, 'fixture.jsonl', ?, 'assistant', '{}')
        """,
        (session_id, ordinal * 2 - 1),
    ).lastrowid
    call_json = json.dumps(
        {"type": "tool_use", "id": tool_use_id, "name": "Bash", "input": {"command": "pytest -q"}}
    )
    conn.execute(
        """
        INSERT INTO tool_calls(event_id, session_id, tool_use_id, tool_name, input_preview, raw_json)
        VALUES (?, ?, ?, 'Bash', ?, ?)
        """,
        (call_event_id, session_id, tool_use_id, '{"command":"pytest -q"}', call_json),
    )
    result_event_id = conn.execute(
        """
        INSERT INTO events(session_id, source_path, line_no, type, raw_json)
        VALUES (?, 'fixture.jsonl', ?, 'user', '{}')
        """,
        (session_id, ordinal * 2),
    ).lastrowid
    result_json = json.dumps(
        {"type": "tool_result", "tool_use_id": tool_use_id, "is_error": is_error, "content": output}
    )
    conn.execute(
        """
        INSERT INTO tool_results(event_id, session_id, tool_use_id, is_error, output_preview, raw_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (result_event_id, session_id, tool_use_id, int(is_error), output, result_json),
    )


def test_init_db_creates_exact_session_findings_schema_and_basis_constraint() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)

    columns = [
        (row["name"], row["type"], row["notnull"], row["dflt_value"], row["pk"])
        for row in conn.execute("PRAGMA table_info(session_findings)")
    ]
    assert columns == [
        ("id", "INTEGER", 0, None, 1),
        ("session_id", "INTEGER", 1, None, 0),
        ("finding_key", "TEXT", 1, None, 0),
        ("detector_key", "TEXT", 1, None, 0),
        ("basis", "TEXT", 1, None, 0),
        ("category", "TEXT", 1, None, 0),
        ("title", "TEXT", 1, None, 0),
        ("explanation", "TEXT", 1, None, 0),
        ("recommendation", "TEXT", 0, None, 0),
        ("start_event_id", "INTEGER", 0, None, 0),
        ("end_event_id", "INTEGER", 0, None, 0),
        ("evidence_json", "TEXT", 1, "'{}'", 0),
    ]
    indexes = {row["name"] for row in conn.execute("PRAGMA index_list(session_findings)")}
    assert {"idx_session_findings_session", "idx_session_findings_detector"} <= indexes
    foreign_keys = {
        (row["from"], row["table"], row["to"], row["on_delete"])
        for row in conn.execute("PRAGMA foreign_key_list(session_findings)")
    }
    assert foreign_keys == {
        ("session_id", "sessions", "id", "CASCADE"),
        ("start_event_id", "events", "id", "SET NULL"),
        ("end_event_id", "events", "id", "SET NULL"),
    }
    metadata_columns = {row["name"] for row in conn.execute("PRAGMA table_info(analysis_metadata)")}
    assert metadata_columns == {"name", "version"}
    assert conn.execute(
        "SELECT version FROM analysis_metadata WHERE name = 'session_findings'"
    ).fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM session_findings").fetchone()[0] == 0

    session_id = _insert_session(conn)
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        conn.execute(
            """
            INSERT INTO session_findings(
                session_id, finding_key, detector_key, basis, category, title, explanation
            ) VALUES (?, 'invalid', 'fixture', 'guessed', 'fixture', 'Fixture', 'Fixture')
            """,
            (session_id,),
        )


def test_init_db_backfills_existing_cache_once_even_when_later_receipts_change() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    session_id = _insert_session(conn)
    _insert_tool_receipt(conn, session_id, 1, output="same failure", is_error=True)
    _insert_tool_receipt(conn, session_id, 2, output="same failure", is_error=True)
    conn.execute("DELETE FROM analysis_metadata WHERE name = 'session_findings'")
    conn.commit()

    init_db(conn)

    assert conn.execute(
        "SELECT version FROM analysis_metadata WHERE name = 'session_findings'"
    ).fetchone()[0] == 1
    assert [row[0] for row in conn.execute("SELECT detector_key FROM session_findings")] == [
        "repeated_identical_failure"
    ]

    _insert_tool_receipt(conn, session_id, 3, output="command timed out after 30 seconds", is_error=True)
    conn.commit()
    init_db(conn)

    assert [row[0] for row in conn.execute("SELECT detector_key FROM session_findings")] == [
        "repeated_identical_failure"
    ]


def test_init_db_rolls_back_backfill_and_metadata_together(monkeypatch: pytest.MonkeyPatch) -> None:
    import ccfr.analysis.session_findings as session_findings

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    session_id = _insert_session(conn)
    conn.execute("DELETE FROM analysis_metadata WHERE name = 'session_findings'")
    conn.commit()

    def broken_backfill(conn_: sqlite3.Connection, session_ids=None) -> None:
        conn_.execute(
            """
            INSERT INTO session_findings(
                session_id, finding_key, detector_key, basis, category, title, explanation
            ) VALUES (?, 'sentinel', 'fixture', 'observed', 'fixture', 'Fixture', 'Fixture')
            """,
            (session_id,),
        )
        raise RuntimeError("backfill failed")

    monkeypatch.setattr(session_findings, "rebuild_session_findings", broken_backfill)

    with pytest.raises(RuntimeError, match="backfill failed"):
        init_db(conn)

    assert conn.execute("SELECT COUNT(*) FROM session_findings").fetchone()[0] == 0
    assert conn.execute(
        "SELECT COUNT(*) FROM analysis_metadata WHERE name = 'session_findings'"
    ).fetchone()[0] == 0
