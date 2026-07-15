from __future__ import annotations

from ccfr.analysis.sequence_features import (
    EventFeatures,
    Feature,
    _build_slices,
    _command_family,
    _error_class,
)


def test_feature_classifiers_cover_structural_tool_shapes() -> None:
    assert _command_family("uv run pytest tests/unit") == "test"
    assert _command_family("uv run ruff check .") == "lint_typecheck"
    assert _command_family("git status --short") == "git"
    assert _command_family("python scripts/check.py") == "script"

    assert _error_class("Permission to use Bash has been denied") == "permission_denied"
    assert _error_class("Denied by user") == "user_rejected"
    assert _error_class("<tool_use_error>File has not been read yet</tool_use_error>") == "edit_without_read"
    assert _error_class("File has been modified since read") == "file_changed"
    assert _error_class("ModuleNotFoundError: No module named x") == "missing_module"
    assert _error_class("Cancelled: parallel tool call Bash(...) errored") == "parallel_cancel"


def test_sequence_slicing_builds_session_sidechain_and_non_overlapping_turns() -> None:
    events = [
        EventFeatures(
            event_id=1,
            session_id=7,
            timestamp="2026-01-01T00:00:00Z",
            is_sidechain=False,
            agent_id=None,
            role="user",
            features=[Feature(1, "TEXT:user", "text")],
        ),
        EventFeatures(
            event_id=2,
            session_id=7,
            timestamp="2026-01-01T00:00:03Z",
            is_sidechain=False,
            agent_id=None,
            role="assistant",
            features=[Feature(2, "CALL:Bash:test", "tool_call")],
        ),
        EventFeatures(
            event_id=3,
            session_id=7,
            timestamp="2026-01-01T00:00:04Z",
            is_sidechain=False,
            agent_id=None,
            role="user",
            features=[Feature(3, "RESULT:error:exit1", "tool_result")],
        ),
        EventFeatures(
            event_id=4,
            session_id=7,
            timestamp="2026-01-01T00:00:05Z",
            is_sidechain=True,
            agent_id="agent-a",
            role="assistant",
            features=[Feature(4, "RESULT:error:missing_module", "tool_result")],
        ),
    ]

    slices = _build_slices({7: events})
    by_kind = {(item.kind, item.lane): item for item in slices}
    turns = [item for item in slices if item.kind == "turn"]

    assert ("session_main", "main") in by_kind
    assert ("sidechain", "agent-a") in by_kind
    assert len(turns) == 2
    assert {event.event_id for turn in turns for event in turn.events} == {1, 2, 3}
    assert sum(len(turn.events) for turn in turns) == 3
    assert by_kind[("session_main", "main")].outcome == "error"


def test_sequence_outcomes_are_receipt_based_not_cost_or_size_scores() -> None:
    many_features = [
        Feature(1, f"CALL:inspect:Read:{index}", "tool_call")
        for index in range(150)
    ]
    event = EventFeatures(
        event_id=1,
        session_id=7,
        timestamp="2026-01-01T00:00:00Z",
        is_sidechain=False,
        agent_id=None,
        role="assistant",
        features=many_features,
    )

    slices = _build_slices({7: [event]})

    assert slices[0].outcome == "clean"
