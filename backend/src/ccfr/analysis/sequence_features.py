from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class Feature:
    event_id: int
    symbol: str
    family: str
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class EventFeatures:
    event_id: int
    session_id: int
    timestamp: str | None
    is_sidechain: bool
    agent_id: str | None
    role: str | None
    features: list[Feature]


@dataclass
class Slice:
    id: int | None
    session_id: int
    kind: str
    lane: str
    events: list[EventFeatures]
    features: list[Feature]
    outcome: str
    duration_seconds: int


def rebuild_sequence_features(
    conn: sqlite3.Connection,
    session_ids: list[int] | None = None,
) -> None:
    """Rebuild structural slices and symbols without inferring risk or quality."""
    _clear_sequence_features(conn, session_ids=session_ids)
    events = _load_event_features(conn, session_ids=session_ids)
    slices = _build_slices(events)
    if slices:
        _insert_slices_and_features(conn, slices)


def _clear_sequence_features(
    conn: sqlite3.Connection,
    session_ids: list[int] | None = None,
) -> None:
    if session_ids is None:
        conn.execute("DELETE FROM event_features")
        conn.execute("DELETE FROM sequence_slices")
        return

    scoped_ids = sorted(set(session_ids))
    if not scoped_ids:
        return
    placeholders = ",".join("?" * len(scoped_ids))
    conn.execute(
        f"DELETE FROM event_features WHERE session_id IN ({placeholders})",
        scoped_ids,
    )
    conn.execute(
        f"DELETE FROM sequence_slices WHERE session_id IN ({placeholders})",
        scoped_ids,
    )


def _load_event_features(
    conn: sqlite3.Connection,
    session_ids: list[int] | None = None,
) -> dict[int, list[EventFeatures]]:
    scoped_ids = sorted(set(session_ids)) if session_ids is not None else None
    session_filter = ""
    session_params: list[int] = []
    if scoped_ids is not None:
        if not scoped_ids:
            return {}
        session_filter = f"WHERE e.session_id IN ({','.join('?' * len(scoped_ids))})"
        session_params = scoped_ids

    rows = conn.execute(
        f"""
        SELECT
            e.id AS event_id,
            e.session_id,
            e.type AS event_type,
            e.timestamp,
            e.is_sidechain,
            e.agent_id,
            e.raw_json,
            m.role,
            m.stop_reason,
            m.text_preview
        FROM events e
        LEFT JOIN messages m ON m.event_id = e.id
        {session_filter}
        ORDER BY e.session_id, COALESCE(e.timestamp, ''), e.id
        """,
        session_params,
    ).fetchall()

    tool_filter = ""
    tool_params: list[int] = []
    if scoped_ids is not None:
        tool_filter = f"WHERE session_id IN ({','.join('?' * len(scoped_ids))})"
        tool_params = scoped_ids

    calls_by_event: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for row in conn.execute(
        f"SELECT event_id, tool_name, input_preview, raw_json FROM tool_calls {tool_filter} ORDER BY id",
        tool_params,
    ).fetchall():
        calls_by_event[int(row["event_id"])].append(row)

    results_by_event: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for row in conn.execute(
        f"SELECT event_id, is_error, output_preview, raw_json FROM tool_results {tool_filter} ORDER BY id",
        tool_params,
    ).fetchall():
        results_by_event[int(row["event_id"])].append(row)

    by_session: dict[int, list[EventFeatures]] = defaultdict(list)
    for row in rows:
        event_id = int(row["event_id"])
        features = _features_for_event(
            row,
            calls_by_event[event_id],
            results_by_event[event_id],
        )
        if not features:
            continue
        event = EventFeatures(
            event_id=event_id,
            session_id=int(row["session_id"]),
            timestamp=row["timestamp"],
            is_sidechain=bool(row["is_sidechain"]),
            agent_id=row["agent_id"],
            role=row["role"],
            features=features,
        )
        by_session[event.session_id].append(event)
    return by_session


def _features_for_event(
    row: sqlite3.Row,
    calls: list[sqlite3.Row],
    results: list[sqlite3.Row],
) -> list[Feature]:
    event_id = int(row["event_id"])
    features: list[Feature] = []
    raw = _loads(row["raw_json"])
    event_type = str(row["event_type"] or "unknown")

    if event_type == "queue-operation":
        operation = str(raw.get("operation") or "unknown")
        features.append(
            Feature(
                event_id,
                f"EVENT:queue:{operation}",
                "event",
                {"operation": operation},
            )
        )
    elif event_type == "attachment":
        attachment = raw.get("attachment") if isinstance(raw.get("attachment"), dict) else {}
        attachment_type = str(attachment.get("type") or "unknown")
        features.append(
            Feature(
                event_id,
                f"EVENT:attachment:{attachment_type}",
                "event",
                {"attachment_type": attachment_type},
            )
        )
    elif event_type in {"system", "mode", "pr-link", "file-history-snapshot"}:
        features.append(
            Feature(event_id, f"EVENT:{event_type}", "event", {"event_type": event_type})
        )

    role = row["role"]
    if role and row["text_preview"]:
        features.append(Feature(event_id, f"TEXT:{role}", "text", {"role": role}))

    for call in calls:
        symbol, family, attributes = _call_symbol(call)
        features.append(Feature(event_id, symbol, family, attributes))

    for result in results:
        symbol, family, attributes = _result_symbol(result)
        features.append(Feature(event_id, symbol, family, attributes))

    stop_reason = row["stop_reason"]
    if stop_reason:
        features.append(
            Feature(
                event_id,
                f"STOP:{stop_reason}",
                "stop",
                {"stop_reason": stop_reason},
            )
        )

    return features


def _call_symbol(row: sqlite3.Row) -> tuple[str, str, dict[str, Any]]:
    tool_name = str(row["tool_name"] or "unknown")
    raw = _loads(row["raw_json"])
    input_obj = raw.get("input") if isinstance(raw.get("input"), dict) else {}
    attributes: dict[str, Any] = {"tool_name": tool_name}
    if isinstance(input_obj, dict):
        attributes["input_keys"] = sorted(str(key) for key in input_obj)
        target = input_obj.get("file_path") or input_obj.get("path")
        if target:
            attributes["target"] = _short(str(target), 180)

    if tool_name in {"Bash", "PowerShell"}:
        command = str(input_obj.get("command") or row["input_preview"] or "")
        family = _command_family(command)
        attributes["command_family"] = family
        attributes["command_preview"] = _short(command, 260)
        return f"CALL:{tool_name}:{family}", "tool_call", attributes

    if tool_name in {"Read", "Grep", "Glob"}:
        return f"CALL:inspect:{tool_name}", "tool_call", attributes
    if tool_name in {"Edit", "Write", "MultiEdit", "NotebookEdit"}:
        return f"CALL:write:{tool_name}", "tool_call", attributes
    if tool_name == "Agent":
        subagent_type = input_obj.get("subagent_type") or input_obj.get("model")
        if subagent_type:
            attributes["subagent_type"] = str(subagent_type)
        return "CALL:Agent", "tool_call", attributes
    return f"CALL:{tool_name}", "tool_call", attributes


def _result_symbol(row: sqlite3.Row) -> tuple[str, str, dict[str, Any]]:
    output = str(row["output_preview"] or "")
    raw = _loads(row["raw_json"])
    if not output and isinstance(raw, dict):
        output = json.dumps(raw, ensure_ascii=False, sort_keys=True)
    is_error = bool(row["is_error"])
    attributes = {
        "is_error": is_error,
        "output_preview": _short(output, 260),
        "error_class": None,
    }
    if not is_error:
        return "RESULT:ok", "tool_result", attributes

    error_class = _error_class(output)
    attributes["error_class"] = error_class
    return f"RESULT:error:{error_class}", "tool_result", attributes


def _command_family(command: str) -> str:
    cmd = command.lower().strip()
    if not cmd:
        return "empty"
    if any(
        token in cmd
        for token in (
            "pytest",
            "vitest",
            "npm test",
            "pnpm test",
            "yarn test",
            "cargo test",
            "go test",
        )
    ):
        return "test"
    if any(
        token in cmd
        for token in ("ruff", "mypy", "eslint", "tsc", "biome", "prettier --check")
    ):
        return "lint_typecheck"
    if any(
        token in cmd
        for token in ("npm run build", "pnpm build", "yarn build", "cargo build", "docker compose")
    ):
        return "build"
    if cmd.startswith("git ") or " git " in cmd:
        return "git"
    if any(
        token in cmd
        for token in ("npm install", "pnpm install", "yarn add", "uv add", "pip install")
    ):
        return "deps"
    if any(token in cmd for token in ("remove-item", " rm ", "rm -", " del ", " rmdir ")):
        return "delete"
    if any(token in cmd for token in ("curl ", "wget ", "invoke-webrequest", "webfetch")):
        return "network"
    if "python" in cmd or "node " in cmd:
        return "script"
    if any(token in cmd for token in ("rg ", "grep ", "findstr", "select-string")):
        return "search"
    if cmd in {"ls", "dir"} or any(token in cmd for token in ("get-childitem", " ls ", " dir ")):
        return "list"
    return "other"


def _error_class(output: str) -> str:
    low = output.lower()
    if "permission to use" in low and "denied" in low:
        return "permission_denied"
    if "denied by user" in low or "rejected" in low:
        return "user_rejected"
    if "file has not been read yet" in low:
        return "edit_without_read"
    if "file has been modified since read" in low:
        return "file_changed"
    if "inputvalidationerror" in low:
        return "validation"
    if "cancelled: parallel tool call" in low:
        return "parallel_cancel"
    if "timed out" in low or "timeout" in low:
        return "timeout"
    if "modulenotfounderror" in low or "module not found" in low:
        return "missing_module"
    if "exit code 126" in low or "exit code 127" in low or "command not found" in low:
        return "missing_command"
    if "exit code 128" in low:
        return "git"
    if "pytest" in low and (" failed" in low or "failures" in low):
        return "test_failure"
    if "exit code 2" in low:
        return "exit2"
    if "exit code 1" in low:
        return "exit1"
    return "unknown"


def _build_slices(events_by_session: dict[int, list[EventFeatures]]) -> list[Slice]:
    slices: list[Slice] = []
    for session_id, events in events_by_session.items():
        main_events = [event for event in events if not event.is_sidechain]
        if main_events:
            slices.append(_make_slice(session_id, "session_main", "main", main_events))
            slices.extend(_turn_slices(session_id, main_events))

        sidechain_by_agent: dict[str, list[EventFeatures]] = defaultdict(list)
        for event in events:
            if event.is_sidechain:
                sidechain_by_agent[event.agent_id or "sidechain"].append(event)
        for agent_id, agent_events in sidechain_by_agent.items():
            if agent_events:
                slices.append(_make_slice(session_id, "sidechain", agent_id, agent_events))
    return [entry for entry in slices if entry.features]


def _turn_slices(session_id: int, main_events: list[EventFeatures]) -> list[Slice]:
    starts = [index for index, event in enumerate(main_events) if event.role == "user"]
    if not starts:
        return []
    slices: list[Slice] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(main_events)
        turn_events = main_events[start:end]
        if turn_events:
            slices.append(_make_slice(session_id, "turn", "main", turn_events))
    return slices


def _make_slice(
    session_id: int,
    kind: str,
    lane: str,
    events: list[EventFeatures],
) -> Slice:
    features = [feature for event in events for feature in event.features]
    return Slice(
        id=None,
        session_id=session_id,
        kind=kind,
        lane=lane,
        events=events,
        features=features,
        outcome=_slice_outcome(features),
        duration_seconds=_duration_seconds(events),
    )


def _slice_outcome(features: list[Feature]) -> str:
    symbols = [feature.symbol for feature in features]
    if any(
        symbol.endswith(":user_rejected") or symbol.endswith(":permission_denied")
        for symbol in symbols
    ):
        return "rejected"
    if any(symbol.startswith("RESULT:error") for symbol in symbols):
        return "error"
    return "clean"


def _duration_seconds(events: list[EventFeatures]) -> int:
    if not events:
        return 0
    timestamps = [_parse_ts(event.timestamp) for event in events if event.timestamp]
    valid_timestamps = [timestamp for timestamp in timestamps if timestamp is not None]
    if len(valid_timestamps) < 2:
        return 0
    return max(
        0,
        round((max(valid_timestamps) - min(valid_timestamps)).total_seconds()),
    )


def _insert_slices_and_features(
    conn: sqlite3.Connection,
    slices: list[Slice],
) -> None:
    for sequence in slices:
        cursor = conn.execute(
            """
            INSERT INTO sequence_slices(
                session_id, kind, lane, start_event_id, end_event_id,
                outcome, length, duration_seconds
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sequence.session_id,
                sequence.kind,
                sequence.lane,
                sequence.events[0].event_id if sequence.events else None,
                sequence.events[-1].event_id if sequence.events else None,
                sequence.outcome,
                len(sequence.features),
                sequence.duration_seconds,
            ),
        )
        sequence.id = int(cursor.lastrowid)
        conn.executemany(
            """
            INSERT INTO event_features(
                event_id, session_id, sequence_slice_id, position,
                symbol, family, attributes_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    feature.event_id,
                    sequence.session_id,
                    sequence.id,
                    position,
                    feature.symbol,
                    feature.family,
                    json.dumps(feature.attributes, ensure_ascii=False, sort_keys=True),
                )
                for position, feature in enumerate(sequence.features)
            ],
        )


def _loads(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _short(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1] + "…"


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
