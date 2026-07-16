import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getContextEconomics } from "../../api/client";
import type { ContextArchetype, ContextFinding, Project } from "../../api/types";
import TaxMeterHero from "./TaxMeterHero";
import ArchetypeBrief from "./ArchetypeBrief";
import FindingsPanel from "./FindingsPanel";
import SessionDrilldown from "./SessionDrilldown";
import LoadingBar from "../../components/LoadingBar";

interface Props {
  projects: Project[];
  onOpenSession: (sessionId: number, eventId?: number | null) => void;
}

export { formatUsd, formatTokens } from "../formatting";

export function findingKey(finding: ContextFinding): string {
  return `${finding.session_id}:${finding.entry_turn}:${finding.label}`;
}

export default function ContextEconomics({ projects, onOpenSession }: Props) {
  const [projectId, setProjectId] = React.useState<number | null>(null);
  // Hierarchy: archetype (kind of opportunity, tabs) → finding (which session/event,
  // list) → investigator (the evidence). Both selections fall back to the
  // first available entry so the board always shows evidence.
  const [archetypeKey, setArchetypeKey] = React.useState<string | null>(null);
  const [selectedFindingKey, setSelectedFindingKey] = React.useState<string | null>(null);
  const query = useQuery({
    queryKey: ["context-economics", projectId],
    queryFn: () => getContextEconomics({ projectId }),
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (query.isPending) {
    return (
      <main className="discover-page">
        <div className="discover-page-inner">
          <div className="loading-view"><LoadingBar caption="Analyzing context economics…" /></div>
        </div>
      </main>
    );
  }
  if (query.isError || !query.data) {
    return (
      <main className="discover-page">
        <div className="discover-page-inner">
          <div className="empty-state panel-error">
            <strong>Failed to load</strong>
            <span>Context economics could not be loaded.</span>
          </div>
        </div>
      </main>
    );
  }
  const { meta, archetypes } = query.data;
  if (meta.sessions_analyzed === 0) {
    return (
      <main className="discover-page">
        <div className="discover-page-inner">
          <div className="empty-state">No imported sessions with usage data available.</div>
        </div>
      </main>
    );
  }

  const supported = archetypes.filter((a: ContextArchetype) => a.meets_support);
  const activeArchetype = supported.find((a) => a.key === archetypeKey) ?? supported[0] ?? null;
  const findings = activeArchetype?.findings ?? [];
  const activeFinding = findings.find((f) => findingKey(f) === selectedFindingKey)
    ?? findings[0]
    ?? null;

  const selectArchetype = (key: string) => {
    setArchetypeKey(key);
    setSelectedFindingKey(null);
  };

  return (
    <main className="discover-page">
      <div className="discover-page-inner">
        <div className="discover-toolbar" aria-label="Context economics controls">
          <div className="cost-filterbar discover-filterbar">
            <select
              aria-label="Project"
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </div>
        </div>

        {meta.costs_partial ? (
          <p className="tile-note">
            Pricing is partial — dollar estimates exclude unpriced models: {meta.unpriced_models.join(", ")}.
            Percentage breakdowns are hidden.
          </p>
        ) : !meta.cost_available ? (
          <p className="tile-note">
            Price table unavailable — estimated context opportunity is shown in tokens only.
          </p>
        ) : null}

        <TaxMeterHero
          meta={meta}
          archetypes={archetypes}
          selectedKey={activeArchetype?.key ?? null}
          onSelectArchetype={selectArchetype}
        />

        {activeArchetype ? (
          <div className="context-board">
            <div className="context-side">
              <ArchetypeBrief
                archetype={activeArchetype}
                costAvailable={meta.cost_available}
                costsPartial={meta.costs_partial}
              />
              <FindingsPanel
                archetype={activeArchetype}
                costAvailable={meta.cost_available}
                costsPartial={meta.costs_partial}
                activeFindingKey={activeFinding ? findingKey(activeFinding) : null}
                onSelectFinding={(finding) => setSelectedFindingKey(findingKey(finding))}
              />
            </div>
            {activeFinding && (
              <div className="archetype-detail">
                <SessionDrilldown
                  sessionId={activeFinding.session_id}
                  sessionTitle={activeFinding.session_title ?? "Untitled session"}
                  finding={activeFinding}
                  onOpenSession={onOpenSession}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            No supported context opportunities were detected for this selection.
          </div>
        )}
      </div>
    </main>
  );
}
