import React from "react";
import { AlertTriangle, Braces, Link2 } from "lucide-react";
import type { EventDetail, SessionCard, SessionFinding, Subagent } from "../api/types";
import type { SameToolStreakContext } from "../trace/loopContext";
import { sameToolStreakExplanation } from "../trace/loopContext";
import { Blurred } from "../shell/Blurred";
import LoadingBar from "../components/LoadingBar";

interface Props {
  session: SessionCard;
  event: EventDetail | undefined;
  sameToolStreakContext?: SameToolStreakContext;
  subagents: Subagent[];
  findings?: SessionFinding[];
  loading: boolean;
  onSelectEvent?: (eventId: number) => void;
}

type Tab = "event" | "subagents" | "findings";

function formatCategory(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function InspectorPanel({ event, sameToolStreakContext, subagents, findings = [], loading, onSelectEvent }: Props) {
  const [tab, setTab] = React.useState<Tab>("event");
  const openEvidenceEvent = (eventId: number) => {
    if (!onSelectEvent) return;
    onSelectEvent(eventId);
    setTab("event");
  };

  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs">
        <button className={tab === "event" ? "on" : ""} onClick={() => setTab("event")}>Event</button>
        <button className={tab === "subagents" ? "on" : ""} onClick={() => setTab("subagents")}>Subagents</button>
        <button className={tab === "findings" ? "on" : ""} onClick={() => setTab("findings")}>Findings</button>
        {loading && <span className="inspector-tabs-loading"><LoadingBar size="inline" /></span>}
      </div>

      <Blurred as="div">
      {tab === "event" && (
        <section className="inspect-section">
          {!event && <p className="muted">Select a timeline item or trace span.</p>}
          {event && (
            <>
              <h3>Selected event</h3>
              <dl>
                <dt>Type</dt><dd><span className="kind-tag">{event.type}</span></dd>
                <dt>Role</dt><dd>{event.role || "none"}</dd>
                <dt>Time</dt><dd>{event.timestamp ? new Date(event.timestamp).toLocaleString() : "unknown"}</dd>
              </dl>
              {sameToolStreakContext && (
                <div className="streak-evidence-panel">
                  <p>Same-tool streak</p>
                  <dl>
                    <dt>Observed</dt><dd>{sameToolStreakExplanation(sameToolStreakContext)}</dd>
                    <dt>Tool</dt><dd>{sameToolStreakContext.toolName}</dd>
                    <dt>Position</dt><dd>{sameToolStreakContext.position} of {sameToolStreakContext.count}</dd>
                  </dl>
                </div>
              )}
              {event.text_preview && <p className="event-preview">{event.text_preview}</p>}
              {event.tool_calls.length > 0 && <Evidence title="Tool Calls" rows={event.tool_calls} />}
              {event.tool_results.length > 0 && <Evidence title="Tool Results" rows={event.tool_results} />}
              {event.related_event_ids.length > 0 && (
                <div className="related">
                  <Link2 size={14} />
                  <span>Related events</span>
                  <div className="related-event-links">
                    {event.related_event_ids.map((eventId) => (
                      <button
                        key={eventId}
                        type="button"
                        disabled={!onSelectEvent}
                        onClick={() => onSelectEvent?.(eventId)}
                      >
                        Related event {eventId}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <details className="raw-json inspector-advanced">
                <summary><Braces size={14} /> Advanced</summary>
                <dl>
                  <dt>Source</dt><dd>{event.source_path}</dd>
                  <dt>Line</dt><dd>{event.line_no}</dd>
                  <dt>Agent</dt><dd>{event.agent_id || "parent session"}</dd>
                </dl>
                {event.raw_json && <pre>{JSON.stringify(event.raw_json, null, 2)}</pre>}
              </details>
            </>
          )}
        </section>
      )}

      {tab === "subagents" && (
        <section className="inspect-section">
          <h3>Subagents · {subagents.length}</h3>
          {subagents.length === 0 ? (
            <p className="muted">No subagents recorded.</p>
          ) : (
            <div className="subagent-list">
              {subagents.slice(0, 12).map((agent) => (
                <details key={agent.id}>
                  <summary>
                    <span>{agent.agent_type || "Agent"}</span>
                    <b>{agent.event_count}</b>
                  </summary>
                  <p>{agent.description || agent.name || agent.agent_id}</p>
                  <small>{agent.agent_id}</small>
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "findings" && (
        <section className="inspect-section">
          <h3>Findings · {findings.length}</h3>
          {findings.length === 0 ? (
            <p className="muted">No supported findings detected.</p>
          ) : (
            <div className="finding-list">
              {findings.map((finding) => (
                <article key={finding.id} className="finding-card">
                  <div className="finding-card-head">
                    <span>{formatCategory(finding.category)}</span>
                    <b>Basis: {formatCategory(finding.basis)}</b>
                  </div>
                  <h4>{finding.title}</h4>
                  <p>{finding.explanation}</p>
                  {finding.evidence_event_ids.length > 0 && (
                    <div className="finding-jumps" aria-label={`Evidence for ${finding.title}`}>
                      {finding.evidence_event_ids.map((eventId) => (
                        <button
                          key={eventId}
                          type="button"
                          disabled={!onSelectEvent}
                          onClick={() => openEvidenceEvent(eventId)}
                        >
                          Evidence event {eventId}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      </Blurred>
    </aside>
  );
}

function Evidence({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <details className="evidence" open>
      <summary><AlertTriangle size={14} /> {title}</summary>
      {rows.map((row, index) => (
        <pre key={index}>{JSON.stringify(row, null, 2)}</pre>
      ))}
    </details>
  );
}

export default InspectorPanel;
