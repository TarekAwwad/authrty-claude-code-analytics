import React from "react";
import { AlertTriangle, Network, Search } from "lucide-react";
import type { Project, SessionCard } from "../api/types";
import { Blurred } from "../shell/Blurred";
import LoadingBar from "../components/LoadingBar";

interface Props {
  projects: Project[];
  sessions: SessionCard[];
  loading: boolean;
  onOpenSession: (session: SessionCard) => void;
}

type SortKey = "first_ts" | "cost_usd" | "error_count" | "finding_count" | "event_count" | "subagent_count";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "first_ts", label: "Newest first" },
  { key: "cost_usd", label: "Highest estimated API-equivalent cost" },
  { key: "error_count", label: "Most observed errors" },
  { key: "finding_count", label: "Supported finding" },
  { key: "event_count", label: "Highest event volume" },
  { key: "subagent_count", label: "Most subagents" },
];

function sortValue(session: SessionCard, sortKey: SortKey): number {
  if (sortKey === "first_ts") {
    const timestamp = session.first_ts ? Date.parse(session.first_ts) : Number.NaN;
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
  return session[sortKey] as number;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatSessionStart(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatBasis(value: SessionCard["top_finding_basis"]): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function supportedFinding(session: SessionCard): { title: string; detail: string; tone: "finding" | "calm" } {
  if (session.finding_count > 0) {
    const basis = formatBasis(session.top_finding_basis);
    const count = `${session.finding_count} finding${session.finding_count === 1 ? "" : "s"}`;
    return {
      title: session.top_finding_title || "Supported finding detected",
      detail: basis ? `${basis} · ${count}` : count,
      tone: "finding",
    };
  }
  return { title: "No supported finding detected", detail: "", tone: "calm" };
}

function TriageBoard({ projects, sessions, loading, onOpenSession }: Props) {
  const [query, setQuery] = React.useState("");
  const [projectId, setProjectId] = React.useState<number | "all">("all");
  const [onlyErrors, setOnlyErrors] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>("first_ts");

  const activeProjectId = React.useMemo<number | "all">(() => {
    if (projectId === "all") return projectId;
    return projects.some((project) => project.id === projectId) ? projectId : (projects[0]?.id ?? "all");
  }, [projectId, projects]);

  const rows = React.useMemo(() => {
    const filtered = sessions.filter((session) => {
      if (activeProjectId !== "all" && session.project_id !== activeProjectId) return false;
      if (onlyErrors && session.error_count === 0) return false;
      if (query) {
        const hay = `${session.title ?? ""} ${session.session_id} ${session.cwd ?? ""} ${session.project_name}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
  }, [sessions, activeProjectId, onlyErrors, query, sortKey]);

  const projectLabel = activeProjectId === "all"
    ? "All projects"
    : projects.find((project) => project.id === activeProjectId)?.display_name ?? "Project";
  const totalCost = rows.reduce((sum, session) => sum + session.cost_usd, 0);
  const costAvailable = rows.some((session) => session.cost_available);
  const observedErrorCount = rows.reduce((sum, session) => sum + session.error_count, 0);

  const header = (key: SortKey, label: string) => (
    <th
      onClick={() => setSortKey(key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSortKey(key);
        }
      }}
      tabIndex={0}
      aria-sort={sortKey === key ? "descending" : "none"}
      className={sortKey === key ? "sorted" : ""}
    >
      {label}
    </th>
  );

  return (
    <main className="page triage-page">
      <section className="cost-filterbar triage-toolbar" aria-label="Triage controls">
        <label className="searchbox">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions" />
        </label>
        <select
          aria-label="Project"
          value={activeProjectId}
          onChange={(e) => setProjectId(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All projects</option>
          {projects.map((project) => <option value={project.id} key={project.id}>{project.display_name}</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          <span>Errors only</span>
        </label>
        <select
          aria-label="Sort sessions"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </section>

      <section className="card triage-card">
        <div className="triage-project-summary" aria-label="Project cost summary">
          <span className="tps-project"><Blurred>{projectLabel}</Blurred></span>
          <span className="tps-sessions">{rows.length.toLocaleString()} sessions</span>
          <span className="tps-cost">
            {costAvailable ? <>Total cost <b>{formatUsd(totalCost)}</b></> : "Cost unavailable"}
          </span>
        </div>
        <div className="triage-table-wrap">
          {loading ? (
            <div className="empty-state"><LoadingBar caption="Loading sessions…" /></div>
          ) : rows.length === 0 ? (
            <div className="empty-state">No sessions match the current filters.</div>
          ) : (
            <table className="triage-table">
              <thead>
                <tr>
                  <th>Session</th>
                  {header("first_ts", "Started")}
                  {header("finding_count", "Supported finding")}
                  <th>Impact</th>
                  {header("cost_usd", "Cost")}
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {rows.map((session) => {
                  const finding = supportedFinding(session);
                  return (
                    <tr
                      key={session.id}
                      onClick={() => onOpenSession(session)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpenSession(session);
                      }}
                      tabIndex={0}
                      className="triage-row"
                    >
                      <td>
                        <div className="tr-name"><Blurred>{session.title || session.session_id.slice(0, 8)}</Blurred></div>
                        <div className="tr-sub"><Blurred>{session.project_name}{session.title ? ` · ${session.session_id.slice(0, 8)}` : ""}</Blurred></div>
                      </td>
                      <td className="cell-started">
                        {session.first_ts ? (
                          <time dateTime={session.first_ts}>{formatSessionStart(session.first_ts)}</time>
                        ) : "—"}
                      </td>
                      <td className={`cell-issue issue-${finding.tone}`}>
                        <span className="finding-cell">
                          <Blurred>{finding.title}</Blurred>
                        </span>
                        {finding.detail && <small>{finding.detail}</small>}
                      </td>
                      <td className="cell-impact">
                        <div className="impact-stack" aria-label="Session impact">
                          {session.error_count > 0 && <span className="impact-chip err">{session.error_count} errors</span>}
                          {session.subagent_count > 0 && (
                            <span className="impact-chip neutral">
                              {session.subagent_count} subagent{session.subagent_count === 1 ? "" : "s"}
                            </span>
                          )}
                          <span className="impact-chip neutral">{session.event_count.toLocaleString()} events</span>
                        </div>
                        <div className="vol-dur">{Math.round(session.duration_seconds / 60)} min</div>
                      </td>
                      <td className={session.cost_available && session.cost_usd > 0 ? "cell-cost" : "cell-muted"}>
                        {session.cost_available ? formatUsd(session.cost_usd) : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="triage-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSession(session);
                          }}
                        >
                          Investigate
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="map-footer">
        <span><Network size={16} /> {rows.length.toLocaleString()} sessions</span>
        <span>
          <AlertTriangle size={16} /> {observedErrorCount.toLocaleString()} observed error{observedErrorCount === 1 ? "" : "s"}
        </span>
      </section>
    </main>
  );
}

export default TriageBoard;
