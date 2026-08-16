import React from "react";
import type { ToolActivity } from "../api/types";
import LoadingBar from "../components/LoadingBar";

interface Props {
  activity: ToolActivity[];
  loading?: boolean;
}

interface DisplayActivity extends ToolActivity {
  aggregate_count?: number;
}

const TOP_TOOL_COUNT = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(value: number, singular: string): string {
  return `${value.toLocaleString()} ${singular}${value === 1 ? "" : "s"}`;
}

function buildDisplayActivity(activity: ToolActivity[]): DisplayActivity[] {
  const sorted = [...activity].sort(
    (a, b) => b.call_count - a.call_count || a.tool_name.localeCompare(b.tool_name),
  );
  const visibleNames = new Set(sorted.slice(0, TOP_TOOL_COUNT).map((row) => row.tool_name));
  for (const row of sorted) {
    if (row.error_count > 0) visibleNames.add(row.tool_name);
  }
  const visible = sorted.filter((row) => visibleNames.has(row.tool_name));
  const remainder = sorted.filter((row) => !visibleNames.has(row.tool_name));
  if (remainder.length === 0) return visible;
  const total = (field: keyof ToolActivity) => remainder.reduce((sum, row) => sum + Number(row[field]), 0);
  return [
    ...visible,
    {
      tool_name: "Other",
      call_count: total("call_count"),
      error_count: total("error_count"),
      observed_result_bytes: total("observed_result_bytes"),
      persisted_result_bytes: total("persisted_result_bytes"),
      aggregate_count: remainder.length,
    },
  ];
}

export default function ToolUsageTile({ activity, loading }: Props) {
  const rows = React.useMemo(() => buildDisplayActivity(activity), [activity]);
  const maxCalls = Math.max(...rows.map((row) => row.call_count), 0);

  return (
    <section className="tile session-tile">
      <div className="session-visual-heading tool-activity-heading">
        <h2>Tool activity</h2>
        {activity.length > 0 && (
          <div className="tool-activity-legend" role="group" aria-label="Tool activity legend">
            <span><i className="tool-activity-key-success" />Successful calls</span>
            <span><i className="tool-activity-key-error" />Errors</span>
          </div>
        )}
      </div>
      {loading ? (
        <div className="session-tile-empty"><LoadingBar size="tile" /></div>
      ) : rows.length === 0 ? (
        <div className="session-tile-empty">No tool calls</div>
      ) : (
        <div className="tool-activity-list" role="list" aria-label="Tool activity by observed call count">
          {rows.map((row) => {
            const label = row.aggregate_count
              ? `Other · ${row.aggregate_count.toLocaleString()} tools`
              : row.tool_name;
            const width = maxCalls > 0 ? Math.max(4, (row.call_count / maxCalls) * 100) : 0;
            const errorCalls = Math.min(row.error_count, row.call_count);
            const successfulCalls = Math.max(row.call_count - errorCalls, 0);
            const errorShare = row.call_count > 0 ? (errorCalls / row.call_count) * 100 : 0;
            const successShare = 100 - errorShare;
            const title = [
              label,
              plural(row.call_count, "call"),
              plural(row.error_count, "error"),
              `${formatBytes(row.observed_result_bytes)} observed`,
              `${formatBytes(row.persisted_result_bytes)} persisted`,
            ].join(" · ");
            return (
              <div className="tool-activity-row" role="listitem" key={row.tool_name} title={title}>
                <div className="tool-activity-label">
                  <b>{label}</b>
                  <span className="tool-activity-counts">
                    <span>{plural(row.call_count, "call")}</span>
                    <span className="tool-activity-error-count" data-has-errors={row.error_count > 0}>
                      {plural(row.error_count, "error")}
                    </span>
                  </span>
                </div>
                <div className="tool-activity-track">
                  <span
                    className="tool-activity-bar"
                    style={{ width: `${width}%` }}
                    role="img"
                    aria-label={`${plural(row.call_count, "call")}: ${successfulCalls.toLocaleString()} successful, ${plural(row.error_count, "error")}`}
                  >
                    {successfulCalls > 0 && (
                      <i aria-hidden="true" className="tool-activity-bar-success" style={{ width: `${successShare}%` }} />
                    )}
                    {row.error_count > 0 && (
                      <i aria-hidden="true" className="tool-activity-bar-error" style={{ width: `${errorShare}%` }} />
                    )}
                  </span>
                </div>
                <div className="tool-activity-receipts">
                  <span><small>Observed</small><b>{formatBytes(row.observed_result_bytes)}</b></span>
                  <span><small>Persisted</small><b>{formatBytes(row.persisted_result_bytes)}</b></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
