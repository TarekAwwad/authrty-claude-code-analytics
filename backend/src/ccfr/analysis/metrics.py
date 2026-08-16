from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any, TypedDict


class SameToolStreak(TypedDict):
    streak_id: str
    tool_name: str
    position: int
    count: int
    start_event_id: int
    end_event_id: int


def same_tool_streaks(
    spans: Iterable[Mapping[str, Any]],
    *,
    min_run: int = 3,
) -> dict[int, SameToolStreak]:
    """Return neutral display metadata for consecutive same-tool calls per lane."""
    calls_by_lane: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for span in spans:
        if span.get("kind") != "tool_call":
            continue
        calls_by_lane[str(span.get("lane") or "main")].append(span)

    contexts: dict[int, SameToolStreak] = {}
    for lane, calls in calls_by_lane.items():
        start = 0
        streak_number = 0
        while start < len(calls):
            tool_name = calls[start].get("tool_name")
            if not tool_name:
                start += 1
                continue
            end = start + 1
            while end < len(calls) and calls[end].get("tool_name") == tool_name:
                end += 1
            count = end - start
            if count >= min_run:
                streak_number += 1
                event_ids = [int(call["event_id"]) for call in calls[start:end]]
                streak_id = f"{lane}-tool-streak-{streak_number}"
                for position, event_id in enumerate(event_ids, start=1):
                    contexts[event_id] = {
                        "streak_id": streak_id,
                        "tool_name": str(tool_name),
                        "position": position,
                        "count": count,
                        "start_event_id": event_ids[0],
                        "end_event_id": event_ids[-1],
                    }
            start = end
    return contexts
