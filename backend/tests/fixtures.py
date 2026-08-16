from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ALPHA_SESSION_ID = "11111111-1111-1111-1111-111111111111"
ALPHA_SECOND_SESSION_ID = "22222222-2222-2222-2222-222222222222"
BETA_SESSION_ID = "33333333-3333-3333-3333-333333333333"

TEAM_BUNDLE_SENTINELS = [
    "SECRET_PROMPT_abc",
    "SECRET_TOKEN_xyz",
    "SECRET_OUTPUT_qqq",
    "SECRET_OUTPUT_rrr",
    "SECRET_MODEL_zzz",
    "mcp__SECRETSERVER__deploy",
    "/Users/real/secret/path",
    "feature/SECRET_BRANCH",
    "9.9.9",
]

SANITIZED_EXPORT_COUNTS = {
    "project_count": 2,
    "session_count": 3,
    "event_count": 20,
    "subagent_count": 1,
    "persisted_output_count": 1,
    "tool_call_count": 6,
    "sidechain_event_count": 3,
}


def sanitized_export(tmp_path: Path) -> Path:
    """Create a compact Claude Code export tree with no private source data."""
    root = tmp_path / "sanitized-claude-export"
    root.mkdir()
    _write_alpha_project(root / "d--Alpha")
    _write_beta_project(root / "d--Beta")
    return root


def sentinel_export(tmp_path: Path) -> Path:
    """Create one session whose content fields carry privacy sentinels."""
    root = tmp_path / "sentinel-export"
    project = root / "d--Secret"
    session_id = "44444444-4444-4444-4444-444444444444"
    project.mkdir(parents=True)
    rows = [
        {
            "type": "system",
            "uuid": "sys",
            "timestamp": "2026-02-01T08:00:00Z",
            "cwd": "/Users/real/secret/path",
            "version": "9.9.9",
            "entrypoint": "claude",
            "gitBranch": "feature/SECRET_BRANCH",
        },
        {
            "type": "user",
            "uuid": "u1",
            "timestamp": "2026-02-01T08:00:01Z",
            "message": {
                "role": "user",
                "content": "SECRET_PROMPT_abc do the thing",
            },
        },
        {
            "type": "assistant",
            "uuid": "a1",
            "parentUuid": "u1",
            "timestamp": "2026-02-01T08:00:02Z",
            "message": {
                "id": "m1",
                "role": "assistant",
                "model": "SECRET_MODEL_zzz",
                "stop_reason": "tool_use",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "t1",
                        "name": "Bash",
                        "input": {"command": "git push --force SECRET_TOKEN_xyz"},
                    },
                    {
                        "type": "tool_use",
                        "id": "t2",
                        "name": "mcp__SECRETSERVER__deploy",
                        "input": {"target": "/Users/real/secret/path"},
                    },
                ],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        },
        {
            "type": "user",
            "uuid": "u2",
            "parentUuid": "a1",
            "timestamp": "2026-02-01T08:00:03Z",
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "t1",
                        "is_error": True,
                        "content": "Permission denied SECRET_OUTPUT_qqq",
                    },
                    {
                        "type": "tool_result",
                        "tool_use_id": "t2",
                        "content": "deployed SECRET_OUTPUT_rrr",
                    },
                ],
            },
        },
    ]
    (project / f"{session_id}.jsonl").write_text(
        "\n".join(json.dumps(row) for row in rows), encoding="utf-8"
    )
    return root


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, separators=(",", ":")) for row in rows),
        encoding="utf-8",
    )


def _write_alpha_project(project: Path) -> None:
    project.mkdir(parents=True)
    session_dir = project / ALPHA_SESSION_ID
    (session_dir / "tool-results").mkdir(parents=True)
    (session_dir / "subagents").mkdir()
    (project / "memory").mkdir()

    persisted_path = f"{project.name}/{ALPHA_SESSION_ID}/tool-results/pytest-output.txt"
    (session_dir / "tool-results" / "pytest-output.txt").write_text(
        "pytest started\nModuleNotFoundError: No module named fixture_support\n",
        encoding="utf-8",
    )
    (session_dir / "subagents" / "agent-reviewer.meta.json").write_text(
        json.dumps(
            {
                "agentType": "general-purpose",
                "description": "Explore delegated risk-pattern evidence in sanitized data.",
                "name": "Reviewer",
                "toolUseId": "tool-agent-alpha",
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    _write_jsonl(
        session_dir / "subagents" / "agent-reviewer.jsonl",
        [
            {
                "type": "user",
                "uuid": "sub-user-1",
                "timestamp": "2026-01-03T09:00:10Z",
                "message": {"role": "user", "content": "Run focused verification."},
            },
            {
                "type": "assistant",
                "uuid": "sub-assistant-1",
                "parentUuid": "sub-user-1",
                "timestamp": "2026-01-03T09:00:11Z",
                "message": {
                    "id": "msg-sub-1",
                    "role": "assistant",
                    "model": "claude-sonnet-4-6",
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tool-sub-bash",
                            "name": "Bash",
                            "input": {"command": "uv run pytest tests/test_fixture.py"},
                        }
                    ],
                    "usage": {"input_tokens": 12, "output_tokens": 8},
                },
            },
            {
                "type": "user",
                "uuid": "sub-user-2",
                "parentUuid": "sub-assistant-1",
                "timestamp": "2026-01-03T09:00:12Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-sub-bash",
                            "is_error": True,
                            "content": "ModuleNotFoundError: No module named fixture_support",
                        }
                    ],
                },
            },
        ],
    )
    (project / "memory" / "risk-log.md").write_text(
        "\n".join(
            [
                "---",
                "name: Explore Findings",
                "type: note",
                "description: Sanitized memory markdown for repository search.",
                f"originSessionId: {ALPHA_SESSION_ID}",
                "---",
                "Explore cached-token behavior and persisted tool output links.",
            ]
        ),
        encoding="utf-8",
    )

    _write_jsonl(
        project / f"{ALPHA_SESSION_ID}.jsonl",
        [
            {
                "type": "system",
                "uuid": "alpha-system",
                "timestamp": "2026-01-03T09:00:00Z",
                "cwd": "/workspace/alpha",
                "version": "1.0.0",
                "entrypoint": "claude",
                "gitBranch": "main",
            },
            {
                "type": "user",
                "uuid": "alpha-user-1",
                "timestamp": "2026-01-03T09:00:01Z",
                "message": {"role": "user", "content": "Explore sanitized repository state."},
            },
            {
                "type": "assistant",
                "uuid": "alpha-assistant-read-1",
                "parentUuid": "alpha-user-1",
                "timestamp": "2026-01-03T09:00:02Z",
                "message": {
                    "id": "msg-alpha-read-1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "stop_reason": "tool_use",
                    "content": [
                        {"type": "text", "text": "Explore files before changing anything."},
                        {
                            "type": "tool_use",
                            "id": "tool-read-alpha-1",
                            "name": "Read",
                            "input": {"file_path": "backend/src/ccfr/ingest/importer.py"},
                        },
                    ],
                    "usage": {
                        "input_tokens": 50,
                        "cache_creation_input_tokens": 80_000,
                        "cache_read_input_tokens": 60_000,
                        "output_tokens": 300,
                    },
                },
            },
            {
                "type": "user",
                "uuid": "alpha-user-read-1",
                "parentUuid": "alpha-assistant-read-1",
                "timestamp": "2026-01-03T09:00:03Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-read-alpha-1",
                            "content": "Read importer.py successfully.",
                        }
                    ],
                },
            },
            {
                "type": "assistant",
                "uuid": "alpha-assistant-read-2",
                "parentUuid": "alpha-user-read-1",
                "timestamp": "2026-01-03T09:00:04Z",
                "message": {
                    "id": "msg-alpha-read-2",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tool-read-alpha-2",
                            "name": "Read",
                            "input": {"file_path": "backend/src/ccfr/api/repository.py"},
                        }
                    ],
                    "usage": {"input_tokens": 20, "output_tokens": 12},
                },
            },
            {
                "type": "user",
                "uuid": "alpha-user-read-2",
                "parentUuid": "alpha-assistant-read-2",
                "timestamp": "2026-01-03T09:00:05Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-read-alpha-2",
                            "content": "Read repository.py successfully.",
                        }
                    ],
                },
            },
            {
                "type": "assistant",
                "uuid": "alpha-assistant-read-3",
                "parentUuid": "alpha-user-read-2",
                "timestamp": "2026-01-03T09:00:06Z",
                "message": {
                    "id": "msg-alpha-read-3",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tool-read-alpha-3",
                            "name": "Read",
                            "input": {"file_path": "backend/src/ccfr/analysis/risk_patterns.py"},
                        }
                    ],
                    "usage": {"input_tokens": 20, "output_tokens": 12},
                },
            },
            {
                "type": "user",
                "uuid": "alpha-user-read-3",
                "parentUuid": "alpha-assistant-read-3",
                "timestamp": "2026-01-03T09:00:07Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-read-alpha-3",
                            "content": "Read risk_patterns.py successfully.",
                        }
                    ],
                },
            },
            {
                "type": "assistant",
                "uuid": "alpha-assistant-bash",
                "parentUuid": "alpha-user-read-3",
                "timestamp": "2026-01-03T09:00:08Z",
                "message": {
                    "id": "msg-alpha-bash",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tool-bash-alpha",
                            "name": "Bash",
                            "input": {"command": "uv run pytest tests/test_fixture.py"},
                        }
                    ],
                    "usage": {"input_tokens": 30, "output_tokens": 10},
                },
            },
            {
                "type": "user",
                "uuid": "alpha-user-bash",
                "parentUuid": "alpha-assistant-bash",
                "timestamp": "2026-01-03T09:00:09Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-bash-alpha",
                            "is_error": True,
                            "content": (
                                f"Full output saved to: {persisted_path}\n"
                                "ModuleNotFoundError: No module named fixture_support"
                            ),
                        }
                    ],
                },
            },
            {
                "type": "assistant",
                "uuid": "alpha-assistant-agent",
                "parentUuid": "alpha-user-bash",
                "timestamp": "2026-01-03T09:00:10Z",
                "message": {
                    "id": "msg-alpha-agent",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tool-agent-alpha",
                            "name": "Agent",
                            "input": {
                                "subagent_type": "general-purpose",
                                "prompt": "Explore delegated risk evidence.",
                            },
                        }
                    ],
                    "usage": {"input_tokens": 30, "output_tokens": 10},
                },
            },
            {
                "type": "user",
                "uuid": "alpha-user-agent",
                "parentUuid": "alpha-assistant-agent",
                "timestamp": "2026-01-03T09:00:11Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool-agent-alpha",
                            "content": "Delegated reviewer reported the failing verification.",
                        }
                    ],
                },
            },
        ],
    )

    _write_jsonl(
        project / f"{ALPHA_SECOND_SESSION_ID}.jsonl",
        [
            {
                "type": "user",
                "uuid": "alpha-second-user",
                "timestamp": "2026-01-02T10:00:00Z",
                "message": {"role": "user", "content": "Summarize sanitized memory."},
            },
            {
                "type": "assistant",
                "uuid": "alpha-second-assistant",
                "parentUuid": "alpha-second-user",
                "timestamp": "2026-01-02T10:00:01Z",
                "message": {
                    "id": "msg-alpha-second",
                    "role": "assistant",
                    "model": "claude-sonnet-4-6",
                    "content": [{"type": "text", "text": "Summary complete."}],
                    "usage": {"input_tokens": 25, "output_tokens": 15},
                },
            },
        ],
    )


def _write_beta_project(project: Path) -> None:
    project.mkdir(parents=True)
    (project / "memory").mkdir()
    (project / "memory" / "handoff.md").write_text(
        "\n".join(
            [
                "---",
                "name: Beta Handoff",
                "type: note",
                "description: Sanitized second project memory.",
                f"originSessionId: {BETA_SESSION_ID}",
                "---",
                "Beta project confirms cross-project import coverage.",
            ]
        ),
        encoding="utf-8",
    )
    _write_jsonl(
        project / f"{BETA_SESSION_ID}.jsonl",
        [
            {
                "type": "system",
                "uuid": "beta-system",
                "timestamp": "2026-01-01T08:00:00Z",
                "cwd": "/workspace/beta",
                "version": "1.0.0",
                "entrypoint": "claude",
                "gitBranch": "main",
            },
            {
                "type": "user",
                "uuid": "beta-user",
                "parentUuid": "beta-system",
                "timestamp": "2026-01-01T08:00:01Z",
                "message": {"role": "user", "content": "Compare repository usage across projects."},
            },
            {
                "type": "assistant",
                "uuid": "beta-assistant",
                "parentUuid": "beta-user",
                "timestamp": "2026-01-01T08:00:02Z",
                "message": {
                    "id": "msg-beta",
                    "role": "assistant",
                    "model": "claude-haiku-4-5",
                    "content": [{"type": "text", "text": "Cross-project comparison complete."}],
                    "usage": {"input_tokens": 18, "output_tokens": 9},
                },
            },
        ],
    )
