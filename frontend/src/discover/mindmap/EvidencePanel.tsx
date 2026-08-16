import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getUsageMapEvidence, type UsageMapFilters } from "../../api/client";
import type { UsagePhase } from "../../api/types";
import { formatUsd } from "../formatting";
import type { MapNode } from "./forceModel";
import LoadingBar from "../../components/LoadingBar";

interface Props {
  node: MapNode;
  phases: UsagePhase[];
  filters: UsageMapFilters;
  costAvailable: boolean;
  onOpenSession: (sessionId: number, eventId?: number | null) => void;
  /** Optional previous-period activity share per phase key. */
  previousShares?: Record<string, number>;
}

/** Floating evidence card with the classification rule and linked receipts. */
export default function EvidencePanel({
  node, phases, filters, costAvailable, onOpenSession, previousShares,
}: Props) {
  const [receiptsOpenFor, setReceiptsOpenFor] = React.useState<string | null>(null);
  const receiptsOpen = receiptsOpenFor === node.id;
  const query = useQuery({
    queryKey: ["usage-map-evidence", node.id, filters.projectId ?? null,
               filters.dateFrom ?? null, filters.dateTo ?? null],
    queryFn: () => getUsageMapEvidence(node.id, filters),
    enabled: node.kind !== "center" && !node.grouped,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (node.kind === "center") return null;

  const cardClass = ["mindmap-evidence", `is-${node.kind}`].join(" ");

  if (node.grouped) {
    return (
      <aside className={cardClass}>
        <h3><i aria-hidden="true" />{node.label}</h3>
        <ul className="mindmap-evidence-grouped">
          {node.grouped.map((leaf) => (
            <li key={leaf.key}>
              {leaf.label} — {leaf.activity_count} observed activities
            </li>
          ))}
        </ul>
      </aside>
    );
  }
  if (query.isPending) {
    return (
      <aside className={cardClass}>
        <div className="mindmap-evidence-rule">
          <LoadingBar caption="Loading evidence…" />
        </div>
      </aside>
    );
  }
  if (query.isError || !query.data) {
    return (
      <aside className={`${cardClass} panel-error`}>
        <p className="mindmap-evidence-rule">Evidence could not be loaded.</p>
      </aside>
    );
  }

  const { label, rule, activity_count, sessions } = query.data;
  const phase = phases.find((candidate) => candidate.key === node.phaseKey);
  const habit = node.habitKey
    ? phase?.habits.find((candidate) => candidate.key === node.habitKey)
    : undefined;
  const tool = node.toolKey
    ? phase?.tools.find((candidate) => candidate.key === node.toolKey)
    : undefined;
  const previous = node.kind === "phase" && node.phaseKey
    ? previousShares?.[node.phaseKey]
    : undefined;
  const receiptCountLabel = `${sessions.length} receipt${sessions.length === 1 ? "" : "s"}`;
  const receiptPanelId = `mindmap-receipts-${node.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <aside className={cardClass}>
      <h3><i aria-hidden="true" />{label}</h3>
      <p className="mindmap-evidence-rule">{rule}</p>
      <div className="mindmap-evidence-bar">
        <i style={{ width: `${Math.max(3, node.share * 100)}%` }} />
      </div>
      <div className="mindmap-evidence-row">
        <span>Share of observed activity</span><b>{Math.round(node.share * 100)}%</b>
      </div>
      {previous !== undefined && (
        <div className="mindmap-evidence-row">
          <span>Previous period</span><b>{Math.round(previous * 100)}%</b>
        </div>
      )}
      <div className="mindmap-evidence-row">
        <span>Observed activities</span><b>{activity_count}</b>
      </div>
      {node.kind === "phase" && phase && (
        <>
          <div className="mindmap-evidence-row">
            <span>Tool calls</span><b>{phase.tool_count}</b>
          </div>
          {phase.text_assistant_step_count > 0 && (
            <div className="mindmap-evidence-row">
              <span>Text-only assistant steps</span>
              <b>{phase.text_assistant_step_count}</b>
            </div>
          )}
          <div className="mindmap-evidence-row">
            <span>Sessions</span><b>{phase.session_count}</b>
          </div>
        </>
      )}
      {node.kind === "habit" && habit && (
        <div className="mindmap-evidence-row">
          <span>Pattern observations</span><b>{habit.activity_count}</b>
        </div>
      )}
      {node.kind === "tool" && tool && (
        <div className="mindmap-evidence-row">
          <span>Calls</span><b>{tool.activity_count}</b>
        </div>
      )}

      <div className="mindmap-evidence-receipts">
        {sessions.length === 0 ? (
          <p>No receipts in this window.</p>
        ) : (
          <>
            <button type="button" className="mindmap-evidence-receipts-toggle"
                    aria-expanded={receiptsOpen} aria-controls={receiptPanelId}
                    onClick={() => setReceiptsOpenFor(receiptsOpen ? null : node.id)}>
              <span aria-hidden="true" className="mindmap-receipts-chevron">›</span>
              {receiptsOpen ? "Hide" : "View"} {receiptCountLabel}
            </button>
            {receiptsOpen && (
              <div id={receiptPanelId} className="mindmap-evidence-receipts-content">
          <ul>
            {sessions.map((session) => (
              <li key={session.session_id}>
                <button type="button" className="link-button"
                        onClick={() => onOpenSession(session.session_id, null)}>
                  {session.title || `Session ${session.session_id}`}
                </button>
                <span>{session.activity_count} observed activities</span>
                {costAvailable && (
                  <span>
                    Session cost in selected window {formatUsd(session.session_cost_usd)}
                  </span>
                )}
                {session.exemplar_event_ids.length > 0 && (
                  <span className="mindmap-evidence-events">
                    {session.exemplar_event_ids.map((eventId) => (
                      <button key={eventId} type="button" className="link-button"
                              onClick={() => onOpenSession(session.session_id, eventId)}>
                        Event {eventId}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
