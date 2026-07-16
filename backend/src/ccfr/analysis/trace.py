from __future__ import annotations

from typing import Any

from ccfr.analysis.metrics import same_tool_streaks


def build_trace(
    *,
    session_id: int,
    rows: list[dict[str, Any]],
    result_ts_by_use_id: dict[str, str],
) -> dict[str, Any]:
    """Build a lane/span trace from chronological event rows.

    Each row needs: event_id, kind, timestamp, tool_name, tool_use_id, agent_id, is_sidechain.
    `result_ts_by_use_id` maps a tool_use_id to its tool_result timestamp (span end).
    """
    spans: list[dict[str, Any]] = []
    lanes: list[dict[str, Any]] = []
    seen_lanes: set[str] = set()

    timestamps = [r["timestamp"] for r in rows if r["timestamp"]]
    first_ts = timestamps[0] if timestamps else None
    last_ts = timestamps[-1] if timestamps else None

    for row in rows:
        lane_id = row["agent_id"] if (row["is_sidechain"] and row["agent_id"]) else "main"
        if lane_id not in seen_lanes:
            seen_lanes.add(lane_id)
            lanes.append({
                "lane_id": lane_id,
                "label": "main thread" if lane_id == "main" else lane_id,
                "kind": "main" if lane_id == "main" else "subagent",
            })
        tool_use_id = row.get("tool_use_id")
        end_ts = (
            result_ts_by_use_id.get(tool_use_id)
            if row["kind"] == "tool_call" and tool_use_id
            else None
        )
        spans.append({
            "id": f"span-{row['event_id']}",
            "event_id": row["event_id"],
            "lane": lane_id,
            "kind": row["kind"],
            "input_tokens": int(row.get("input_tokens") or 0),
            "output_tokens": int(row.get("output_tokens") or 0),
            "model": row.get("model"),
            "start_ts": row["timestamp"],
            "end_ts": end_ts,
            "tool_use_id": tool_use_id,
            "tool_name": row.get("tool_name"),
        })

    streaks = same_tool_streaks(spans)
    for span in spans:
        span["same_tool_streak"] = streaks.get(int(span["event_id"]))

    return {
        "session_id": session_id,
        "first_ts": first_ts,
        "last_ts": last_ts,
        "lanes": lanes,
        "spans": spans,
    }
