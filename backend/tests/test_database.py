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


def test_init_db_has_no_memory_table_and_migrates_legacy_memory_index() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    import_id = conn.execute(
        "INSERT INTO imports(source_path, imported_at, status) VALUES('source', '2026-07-20', 'completed')"
    ).lastrowid
    project_id = conn.execute(
        "INSERT INTO projects(import_id, export_name) VALUES(?, 'd--Legacy')",
        (import_id,),
    ).lastrowid
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            name TEXT,
            text_preview TEXT
        )
        """
    )
    memory_id = conn.execute(
        "INSERT INTO memory_nodes(project_id, path, name, text_preview) VALUES(?, 'memory/note.md', 'note', 'private')",
        (project_id,),
    ).lastrowid
    conn.execute(
        "INSERT INTO search_index(kind, ref_id, project_id, title, body) VALUES('memory', ?, ?, 'note', 'private')",
        (memory_id, project_id),
    )
    conn.commit()

    init_db(conn)

    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "memory_nodes" not in tables
    assert conn.execute(
        "SELECT COUNT(*) FROM search_index WHERE kind = 'memory'"
    ).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 1


def test_init_db_has_no_sequence_cache_and_migrates_legacy_tables() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)

    def sequence_tables() -> set[str]:
        return {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        } & {"sequence_slices", "event_features"}

    assert sequence_tables() == set()

    import_id = conn.execute(
        "INSERT INTO imports(source_path, imported_at, status) VALUES('source', '2026-07-20', 'completed')"
    ).lastrowid
    conn.execute(
        "INSERT INTO projects(import_id, export_name) VALUES(?, 'd--Legacy')",
        (import_id,),
    )
    conn.executescript(
        """
        CREATE TABLE sequence_slices (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL
        );
        CREATE TABLE event_features (
            id INTEGER PRIMARY KEY,
            sequence_slice_id INTEGER NOT NULL
        );
        INSERT INTO sequence_slices(id, session_id) VALUES (1, 1);
        INSERT INTO event_features(id, sequence_slice_id) VALUES (1, 1);
        """
    )
    conn.commit()

    init_db(conn)

    assert sequence_tables() == set()
    assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 1


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


def test_reset_local_data_preserves_team_bundles() -> None:
    from ccfr.storage import database as storage_database

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    local_import_id = conn.execute(
        "INSERT INTO imports(source_path, imported_at, status) VALUES('local', '2026-07-01', 'completed')"
    ).lastrowid
    project_id = conn.execute(
        "INSERT INTO projects(import_id, export_name) VALUES(?, 'd--Local')",
        (local_import_id,),
    ).lastrowid
    conn.execute(
        "INSERT INTO sessions(project_id, session_id) VALUES(?, 'local-session')",
        (project_id,),
    )
    team_bundle_id = conn.execute(
        """
        INSERT INTO team_bundles(
            bundle_id, profile, schema_version, member_id, generated_at,
            app_version, imported_at, source_path, session_count
        ) VALUES ('team-bundle', 'structural', 3, 'member', '2026-07-01',
                  '0.1.0', '2026-07-01T00:00:00Z', 'team.json', 1)
        """
    ).lastrowid
    conn.execute(
        """
        INSERT INTO team_bundle_sessions(
            team_bundle_id, member_id, project_id, session_id, provider
        ) VALUES (?, 'member', 'team-project', 'team-session', 'claude')
        """,
        (team_bundle_id,),
    )

    storage_database.reset_local_data(conn)

    assert conn.execute("SELECT COUNT(*) FROM imports").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM team_bundles").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM team_bundle_sessions").fetchone()[0] == 1


def test_init_db_creates_tokens_by_model_column() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(team_bundle_sessions)").fetchall()}
    assert "tokens_by_model_json" in columns
    assert {"risk_categories_json", "sequence_json"}.isdisjoint(columns)


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


def test_migrate_db_removes_deprecated_team_session_columns_without_losing_core_data() -> None:
    from ccfr.storage.database import migrate_db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    conn.execute("DROP TABLE team_bundle_sessions")
    conn.executescript(
        """
        CREATE TABLE team_bundle_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_bundle_id INTEGER NOT NULL REFERENCES team_bundles(id) ON DELETE CASCADE,
            member_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            project_name TEXT,
            session_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            first_date TEXT,
            last_date TEXT,
            duration_s INTEGER NOT NULL DEFAULT 0,
            models_json TEXT NOT NULL DEFAULT '[]',
            tokens_json TEXT NOT NULL DEFAULT '{}',
            tokens_by_model_json TEXT NOT NULL DEFAULT '{}',
            stats_json TEXT NOT NULL DEFAULT '{}',
            stop_reasons_json TEXT NOT NULL DEFAULT '{}',
            risk_categories_json TEXT NOT NULL DEFAULT '[]',
            subagents_json TEXT NOT NULL DEFAULT '[]',
            tools_json TEXT NOT NULL DEFAULT '[]',
            file_types_json TEXT NOT NULL DEFAULT '[]',
            sequence_json TEXT NOT NULL DEFAULT '[]',
            UNIQUE(team_bundle_id, session_id)
        );
        CREATE INDEX idx_team_bundle_sessions_bundle ON team_bundle_sessions(team_bundle_id);
        CREATE INDEX idx_team_bundle_sessions_member ON team_bundle_sessions(member_id);
        CREATE INDEX idx_team_bundle_sessions_first_date ON team_bundle_sessions(first_date);
        """
    )
    bundle_id = conn.execute(
        """
        INSERT INTO team_bundles(
            bundle_id, profile, schema_version, member_id, generated_at,
            app_version, imported_at, source_path, session_count
        ) VALUES ('legacy-v2', 'structural', 2, 'member', '2026-07-01',
                  '0.1.0', '2026-07-01T00:00:00Z', 'legacy.json', 1)
        """
    ).lastrowid
    conn.execute(
        """
        INSERT INTO team_bundle_sessions(
            team_bundle_id, member_id, project_id, session_id, provider,
            tokens_json, tokens_by_model_json, stats_json, stop_reasons_json,
            risk_categories_json, sequence_json
        ) VALUES (?, 'member', 'project', 'session', 'claude',
                  '{"input":10,"output":2}', '{"opus":{"input":10,"output":2}}',
                  '{"turns":3,"errors":1,"loops":4,"max_repeat":9}',
                  '{"tool_use":2}', '["permission_friction"]',
                  '[{"sym":"CALL:inspect:Read"}]')
        """,
        (bundle_id,),
    )

    migrate_db(conn)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(team_bundle_sessions)")}
    assert {"risk_categories_json", "sequence_json"}.isdisjoint(columns)
    row = conn.execute(
        "SELECT session_id, tokens_json, tokens_by_model_json, stats_json, stop_reasons_json "
        "FROM team_bundle_sessions"
    ).fetchone()
    assert row["session_id"] == "session"
    assert json.loads(row["tokens_json"]) == {"input": 10, "output": 2}
    assert json.loads(row["tokens_by_model_json"])["opus"]["input"] == 10
    assert json.loads(row["stop_reasons_json"]) == {"tool_use": 2}
    assert json.loads(row["stats_json"])["errors"] == 1
    indexes = {row[1] for row in conn.execute("PRAGMA index_list(team_bundle_sessions)")}
    assert {
        "idx_team_bundle_sessions_bundle",
        "idx_team_bundle_sessions_member",
        "idx_team_bundle_sessions_first_date",
    } <= indexes


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
    ).fetchone()[0] == 2
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


def test_init_db_drops_legacy_risk_tables_without_losing_session_findings() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    session_id = _insert_session(conn)
    conn.execute(
        """
        INSERT INTO session_findings(
            session_id, finding_key, detector_key, basis, category, title, explanation
        ) VALUES (?, 'keep-me', 'fixture', 'observed', 'execution', 'Keep me', 'Observed receipt.')
        """,
        (session_id,),
    )
    conn.executescript(
        """
        DROP TABLE IF EXISTS risk_findings;
        DROP TABLE IF EXISTS pattern_hits;
        DROP TABLE IF EXISTS sequence_patterns;
        CREATE TABLE IF NOT EXISTS sequence_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            pattern_json TEXT NOT NULL,
            support INTEGER NOT NULL DEFAULT 0,
            positive_support INTEGER NOT NULL DEFAULT 0,
            negative_support INTEGER NOT NULL DEFAULT 0,
            lift REAL NOT NULL DEFAULT 0,
            score REAL NOT NULL DEFAULT 0,
            label TEXT,
            explanation TEXT
        );
        CREATE TABLE IF NOT EXISTS pattern_hits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_id INTEGER,
            session_id INTEGER,
            sequence_slice_id INTEGER,
            start_event_id INTEGER,
            end_event_id INTEGER,
            evidence_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS risk_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            severity TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            explanation TEXT NOT NULL,
            pattern_id INTEGER,
            start_event_id INTEGER,
            end_event_id INTEGER,
            score REAL NOT NULL DEFAULT 0,
            evidence_json TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO sequence_patterns(kind, pattern_json) VALUES ('legacy', '[]');
        INSERT INTO pattern_hits(pattern_id, session_id, sequence_slice_id) VALUES (1, 1, 1);
        INSERT INTO risk_findings(session_id, severity, category, title, explanation)
        VALUES (1, 'high', 'legacy', 'Legacy', 'Legacy');
        """
    )
    conn.commit()

    init_db(conn)

    tables = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    assert {"sequence_patterns", "pattern_hits", "risk_findings"}.isdisjoint(tables)
    finding = conn.execute(
        "SELECT finding_key, title FROM session_findings WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    assert tuple(finding) == ("keep-me", "Keep me")


def test_init_db_rebuilds_legacy_session_stats_without_loop_columns() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    session_id = _insert_session(conn, "legacy-stats")
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(session_stats)")}
    if "loop_count" not in columns:
        conn.execute("ALTER TABLE session_stats ADD COLUMN loop_count INTEGER NOT NULL DEFAULT 0")
    if "max_repeat" not in columns:
        conn.execute("ALTER TABLE session_stats ADD COLUMN max_repeat INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        """
        INSERT INTO session_stats(
            session_id, event_count, turn_count, tool_call_count, subagent_count,
            error_count, system_count, persisted_output_count, input_tokens,
            output_tokens, loop_count, max_repeat
        ) VALUES (?, 11, 7, 5, 3, 2, 1, 4, 123, 456, 6, 9)
        """,
        (session_id,),
    )
    conn.commit()

    init_db(conn)

    columns = {row["name"] for row in conn.execute("PRAGMA table_info(session_stats)")}
    assert columns == {
        "session_id",
        "event_count",
        "turn_count",
        "tool_call_count",
        "subagent_count",
        "error_count",
        "system_count",
        "persisted_output_count",
        "input_tokens",
        "output_tokens",
    }
    row = conn.execute("SELECT * FROM session_stats WHERE session_id = ?", (session_id,)).fetchone()
    assert dict(row) == {
        "session_id": session_id,
        "event_count": 11,
        "turn_count": 7,
        "tool_call_count": 5,
        "subagent_count": 3,
        "error_count": 2,
        "system_count": 1,
        "persisted_output_count": 4,
        "input_tokens": 123,
        "output_tokens": 456,
    }


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
    ).fetchone()[0] == 2
    assert [row[0] for row in conn.execute("SELECT detector_key FROM session_findings")] == [
        "repeated_identical_failure"
    ]

    _insert_tool_receipt(conn, session_id, 3, output="command timed out after 30 seconds", is_error=True)
    conn.commit()
    init_db(conn)

    assert [row[0] for row in conn.execute("SELECT detector_key FROM session_findings")] == [
        "repeated_identical_failure"
    ]


def test_init_db_refreshes_version_one_findings_without_stale_recommendations() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    session_id = _insert_session(conn)
    _insert_tool_receipt(
        conn,
        session_id,
        1,
        output="command timed out after 30 seconds",
        is_error=True,
    )
    conn.execute(
        """
        INSERT INTO session_findings(
            session_id, finding_key, detector_key, basis, category, title,
            explanation, recommendation
        ) VALUES (?, 'stale', 'timeout', 'observed', 'execution', 'Timed out',
                  'Observed timeout.', 'Retry with a narrower scope.')
        """,
        (session_id,),
    )
    conn.execute(
        "UPDATE analysis_metadata SET version = 1 WHERE name = 'session_findings'"
    )
    conn.commit()

    init_db(conn)

    finding = conn.execute(
        "SELECT detector_key, recommendation FROM session_findings WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    assert tuple(finding) == ("timeout", None)
    assert conn.execute(
        "SELECT version FROM analysis_metadata WHERE name = 'session_findings'"
    ).fetchone()[0] == 2


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
