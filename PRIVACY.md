# Privacy and Data Handling

Check Your Agent is intended to run locally against Claude Code
`.claude/projects` exports. It does not need external services to index,
inspect, or analyze exports.

## What Data May Be Present

Claude Code exports and the derived SQLite cache can contain:

- Prompts and conversation text.
- Assistant responses and reasoning text when present in the export.
- Local file paths, project names, branch names, and working directories.
- Tool inputs and outputs.
- Shell commands and command output.
- Code snippets, diffs, logs, and error messages.
- Credentials or tokens accidentally pasted by users.

Treat raw exports, `.ccfr-data/`, SQLite files, screenshots, logs, and raw event
inspector output as private data.

## Local Storage

Default local paths resolve from the repository root:

```text
CCFR_IMPORT_ROOT=<repo>/Data
CCFR_DB_PATH=<repo>/.ccfr-data/ccfr.sqlite3
CCFR_TEAM_BUNDLE_ROOT=<repo>/.ccfr-data/team-bundles
```

Those are source-checkout defaults. Installed `uvx`/`pipx` runs store the
database, settings, and team-bundle directory under `~/.checkyouragent/` unless
`CCFR_DATA_DIR` is set. The installed server uses `~/.claude/projects` as its
import root when that directory exists, otherwise `./Data`; `--import-root` and
`CCFR_IMPORT_ROOT` override it.

Additional local files may be created under:

```text
.ccfr-data/settings.json
.ccfr-data/team-bundles/exports/
TeamBundles/
```

The app reads raw exports from `CCFR_IMPORT_ROOT` and stores a rebuildable index
in SQLite. The index includes compacted raw JSON and previews for local
inspection. Derived findings and evidence receipts may also repeat normalized
tool arguments or failure details. The SQLite cache is therefore not
content-free.

`settings.json` stores historical-pricing and privacy-mode settings, plan
history, team export preferences and sequence state, a random pseudonymous
member ID, and the private salt used to hash project and session IDs. The salt
is not included in team bundles.

**Reset local data** clears and recreates the local import and analysis tables.
It preserves `settings.json` and imported team bundle records. Team data has a
separate per-member removal control in Team Import, and the Team reset API can
clear all imported team bundle records while preserving the local session
cache. Neither operation deletes the original Claude Code export or any
exported team bundle JSON files on disk.

Deleting the SQLite file removes both the local derived cache and imported team
bundle records. It still does not delete the original exports, `settings.json`,
or exported team bundle JSON files.

## Team Bundles

Current exports use bundle schema v3. The exporter is designed to emit one
allowlisted metadata record per selected session rather than conversation
content.

Structural bundles include:

- A random pseudonymous member ID and salted, pseudonymous project and session
  IDs.
- Provider and bucketed model families.
- Intended date-only first/last timing and session duration.
- Exact token counts and cache breakdowns, including counts by bucketed model
  family.
- Observed turn, tool-call, subagent, error, system-event, persisted-output, and
  stop-reason counts.
- Bucketed subagent types and their event counts.

Team-level bundles include the same quantitative session metadata, but replace
pseudonymous project IDs with editable project labels and add the member name,
real tool and MCP server names with call counts, real subagent type names, and
file extensions with counts.

The schema-v3 allowlist is designed to omit prompts, assistant text, reasoning,
titles, raw JSON, previews, paths, working directories, branches, file names,
shell commands, and tool input/output. Models remain bucketed at both levels.
Schema v3 also omits the retired risk categories, inferred patterns,
loop/max-repeat fields, and tool/result event sequences. Legacy schema v1 and
v2 bundles can still be imported, but those retired fields are stripped before
current persistence.

Pseudonymous IDs are stable across exports from the same installation, and
exact token counts, date-only timing, and session durations can still be
distinctive. Team-level names, project labels, tools, subagent types, and file
extensions are intentionally visible to recipients. Share either level only
through channels where its disclosure is acceptable.

Date fields must use canonical ISO calendar dates (`YYYY-MM-DD`). Team bundle
imports reject more than 50,000 sessions, sequence and counter values are
bounded to signed 64-bit integers, and the API rejects request bodies larger
than 50 MiB. These limits reduce accidental or malicious resource exhaustion;
they do not make bundle contents trustworthy. Preview bundles before sharing
and import them only from sources you trust.

## Network Behavior

The backend is an unauthenticated local FastAPI service for the frontend. Keep
it bound to `127.0.0.1` for normal use. Do not expose it to a LAN or the public
internet unless you add separate authentication and access controls.

Browser-origin controls are not authentication. State-changing requests from
browsers must be same-origin or use a configured allowed origin, and cross-site
Fetch Metadata is rejected. Non-browser clients that omit browser origin
headers remain supported, so any process with local access should still be
treated as trusted. Keep the service on loopback and stop it when it is not in
use.

The project is intended to avoid telemetry and external API calls. The retired
standalone contribution workflow and its API routes have been removed. Team
bundle export writes JSON locally; the app does not upload bundles for you.

## Do Not Commit

Never commit sensitive or generated local data:

```text
Data/
TeamBundles/
.ccfr-data/
*.sqlite3
*.sqlite3-*
.env
*.log
node_modules/
dist/
build/
```

## Sharing Issues and Screenshots

Before sharing issues, pull requests, logs, screenshots, or sample data:

- Remove prompts, credentials, private file paths, project names, branch names,
  shell commands, and code that is not yours to share.
- Prefer minimal synthetic examples.
- Redact raw JSON carefully; nested tool fields can contain sensitive values.
- Avoid screenshots of the raw JSON inspector unless every visible value is
  safe to publish.
- Remember that privacy mode blurs UI text for display. It does not sanitize
  exported screenshots automatically.
