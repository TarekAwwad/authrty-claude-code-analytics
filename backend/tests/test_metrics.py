from __future__ import annotations

from ccfr.analysis.metrics import same_tool_streaks
from ccfr.analysis.trace import build_trace


def test_same_tool_streaks_returns_neutral_presentation_metadata() -> None:
    spans = [
        {"event_id": 1, "lane": "main", "kind": "tool_call", "tool_name": "Read"},
        {"event_id": 2, "lane": "main", "kind": "tool_result", "tool_name": None},
        {"event_id": 3, "lane": "main", "kind": "tool_call", "tool_name": "Read"},
        {"event_id": 4, "lane": "main", "kind": "tool_result", "tool_name": None},
        {"event_id": 5, "lane": "main", "kind": "tool_call", "tool_name": "Read"},
        {"event_id": 6, "lane": "main", "kind": "tool_call", "tool_name": "Bash"},
    ]

    streaks = same_tool_streaks(spans)

    assert streaks == {
        1: {
            "streak_id": "main-tool-streak-1",
            "tool_name": "Read",
            "position": 1,
            "count": 3,
            "start_event_id": 1,
            "end_event_id": 5,
        },
        3: {
            "streak_id": "main-tool-streak-1",
            "tool_name": "Read",
            "position": 2,
            "count": 3,
            "start_event_id": 1,
            "end_event_id": 5,
        },
        5: {
            "streak_id": "main-tool-streak-1",
            "tool_name": "Read",
            "position": 3,
            "count": 3,
            "start_event_id": 1,
            "end_event_id": 5,
        },
    }


def test_three_read_calls_can_group_visually_without_becoming_a_finding() -> None:
    rows = [
        {"event_id": 1, "kind": "user_turn", "timestamp": "t0", "tool_name": None,
         "tool_use_id": None, "agent_id": None, "is_sidechain": False},
        {"event_id": 2, "kind": "tool_call", "timestamp": "t1", "tool_name": "Read",
         "tool_use_id": "u1", "agent_id": None, "is_sidechain": False},
        {"event_id": 3, "kind": "tool_call", "timestamp": "t2", "tool_name": "Read",
         "tool_use_id": "u2", "agent_id": None, "is_sidechain": False},
        {"event_id": 4, "kind": "tool_call", "timestamp": "t3", "tool_name": "Read",
         "tool_use_id": "u3", "agent_id": None, "is_sidechain": False},
        {"event_id": 5, "kind": "subagent_event", "timestamp": "t4", "tool_name": None,
         "tool_use_id": None, "agent_id": "a1", "is_sidechain": True},
    ]
    result_ts = {"u1": "t1b"}
    trace = build_trace(session_id=7, rows=rows, result_ts_by_use_id=result_ts)

    assert trace["session_id"] == 7
    assert trace["first_ts"] == "t0" and trace["last_ts"] == "t4"
    lane_ids = [lane["lane_id"] for lane in trace["lanes"]]
    assert lane_ids == ["main", "a1"]
    spans = {s["event_id"]: s for s in trace["spans"]}
    assert spans[2]["end_ts"] == "t1b"          # paired tool cycle
    assert spans[2]["tool_name"] == "Read"
    assert spans[3]["end_ts"] is None           # unpaired
    assert spans[2]["same_tool_streak"]["streak_id"] == "main-tool-streak-1"
    assert spans[3]["same_tool_streak"]["position"] == 2
    assert spans[4]["same_tool_streak"]["count"] == 3
    assert spans[4]["same_tool_streak"]["start_event_id"] == 2
    assert spans[4]["same_tool_streak"]["end_event_id"] == 4
    assert spans[1]["same_tool_streak"] is None
    assert spans[5]["lane"] == "a1"
    forbidden = {
        "is_loop",
        "loop_run_id",
        "loop_position",
        "loop_count",
        "loop_start_event_id",
        "loop_end_event_id",
        "risk",
        "finding",
    }
    assert all(forbidden.isdisjoint(span) for span in trace["spans"])
