import React from "react";
import type { Subagent } from "../api/types";
import {
  buildSubagentHeat,
  type SubagentHeatCell,
  type SubagentHeatMetric,
} from "./sessionAnalytics";
import LoadingBar from "../components/LoadingBar";

interface Props {
  subagents: Subagent[];
  wide?: boolean;
  firstEventIds?: Map<string, number>;
  onSelectSubagent?: (agentId: string) => void;
  loading?: boolean;
}

function plural(value: number, singular: string): string {
  return `${value.toLocaleString()} ${singular}${value === 1 ? "" : "s"}`;
}

function formatSpan(seconds: number | null): string {
  if (seconds === null) return "Unknown span";
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatCost(cell: SubagentHeatCell): string {
  if (!cell.costAvailable) return "Pricing unavailable";
  if (cell.unpricedModels.length > 0) {
    const models = cell.unpricedModels.join(", ");
    return cell.apiEquivalentUsd > 0
      ? `$${cell.apiEquivalentUsd.toFixed(2)} priced; ${models} unpriced`
      : `Unpriced: ${models}`;
  }
  return `$${cell.apiEquivalentUsd.toFixed(2)} direct cost`;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

const HEAT_METRICS: Array<{ value: SubagentHeatMetric; label: string; scale: string }> = [
  { value: "events", label: "Events", scale: "Relative event volume" },
  { value: "errors", label: "Errors", scale: "Relative observed errors" },
  { value: "span", label: "Elapsed span", scale: "Relative elapsed span" },
  { value: "cost", label: "Cost", scale: "Relative estimated API-equivalent cost" },
];

export default function SubagentHeatTile({
  subagents,
  wide,
  firstEventIds,
  onSelectSubagent,
  loading,
}: Props) {
  const [heatMetric, setHeatMetric] = React.useState<SubagentHeatMetric>("events");
  const model = React.useMemo(() => buildSubagentHeat(subagents, heatMetric), [heatMetric, subagents]);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const selected = model.cells.find((cell) => cell.agentId === selectedAgentId) ?? null;
  const activeMetric = HEAT_METRICS.find((metric) => metric.value === heatMetric) ?? HEAT_METRICS[0];

  React.useEffect(() => {
    if (selectedAgentId && !model.cells.some((cell) => cell.agentId === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [model.cells, selectedAgentId]);

  return (
    <section className={`tile session-tile${wide ? " tile-full" : ""}`}>
      <div className="session-visual-heading subagent-heat-heading">
        <h2>Subagents - {model.count}</h2>
        {model.count > 0 && (
          <div className="heat-metric-control" role="radiogroup" aria-label="Heatmap metric">
            <span className="heat-metric-label">Color by</span>
            {HEAT_METRICS.map((metric) => (
              <button
                key={metric.value}
                type="button"
                role="radio"
                aria-checked={heatMetric === metric.value}
                onClick={() => setHeatMetric(metric.value)}
              >
                {metric.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {loading ? (
        <div className="session-tile-empty"><LoadingBar size="tile" /></div>
      ) : model.cells.length === 0 ? (
        <div className="session-tile-empty">No subagent activity</div>
      ) : (
        <div className="agent-heat">
          <div className="heat-grid" role="group" aria-label={`Subagents by ${activeMetric.scale.toLowerCase()}`}>
            {model.cells.map((cell) => {
              const type = cell.agentType || "Unknown";
              const cost = formatCost(cell);
              const isSelected = selectedAgentId === cell.agentId;
              const title = [
                `${cell.label} · ${type}`,
                plural(cell.events, "event"),
                plural(cell.inputTokens + cell.outputTokens, "token"),
                cost,
                plural(cell.errorCount, "error"),
                formatSpan(cell.spanSeconds),
              ].join(" · ");
              return (
                <button
                  key={cell.id}
                  type="button"
                  className={`heat-cell lvl-${cell.level}${isSelected ? " is-selected" : ""}`}
                  aria-label={`Select ${cell.label} ${type} subagent`}
                  aria-pressed={isSelected}
                  data-heat-value={cell.heatValue ?? "unavailable"}
                  title={title}
                  onClick={() => setSelectedAgentId((current) => current === cell.agentId ? null : cell.agentId)}
                >
                  {cell.label}
                  {isSelected && <span className="heat-selection-marker" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="heat-scale" aria-hidden="true">
            <span>{activeMetric.scale}</span>
            <i className="lvl-1" />
            <i className="lvl-2" />
            <i className="lvl-3" />
            <span>Higher</span>
          </div>
          {selected ? (
            <section
              className="subagent-detail-panel"
              role="region"
              aria-label={`${selected.label} subagent details`}
            >
              <div className="subagent-detail-heading">
                <span>
                  <b>{selected.label}</b>
                  <strong>{selected.agentType || "Unknown"}</strong>
                  {selected.name && <small>{selected.name}</small>}
                </span>
                <em>Observed subagent receipts</em>
              </div>
              <div className="subagent-detail-metrics">
                <span><small>Activity</small><b>{plural(selected.events, "event")}</b></span>
                <span><small>Tokens</small><b>{plural(selected.inputTokens + selected.outputTokens, "token")}</b></span>
                <span><small>API-equivalent</small><b>{formatCost(selected)}</b></span>
                <span className={selected.errorCount > 0 ? "has-error" : ""}>
                  <small>Errors</small><b>{plural(selected.errorCount, "error")}</b>
                </span>
                <span><small>Span</small><b>{formatSpan(selected.spanSeconds)}</b></span>
              </div>
              <div className="subagent-detail-footer">
                <small>{formatTimestamp(selected.firstTs)} · {formatTimestamp(selected.lastTs)}</small>
                <button
                  type="button"
                  disabled={firstEventIds?.get(selected.agentId) === undefined || !onSelectSubagent}
                  aria-label={`Inspect ${selected.label} first event`}
                  onClick={() => onSelectSubagent?.(selected.agentId)}
                >
                  Inspect first event
                </button>
              </div>
            </section>
          ) : (
            <section className="subagent-detail-panel is-empty" aria-label="Subagent details">
              <span>Select an agent to inspect its receipts</span>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
