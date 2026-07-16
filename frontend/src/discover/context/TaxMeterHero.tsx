import React from "react";
import type { ContextArchetype, ContextEconomicsMeta, ContextTrendBucket } from "../../api/types";
import { formatTokens, formatUsd } from "./ContextEconomics";

export const ARCHETYPE_COLORS: Record<string, string> = {
  rereads: "var(--info)",
  oversized: "var(--warning)",
  late_compaction: "var(--success)",
  stale_continuation: "var(--subagent)",
};

function TrendSparkline({
  trend,
  lowerBound,
}: {
  trend: ContextTrendBucket[];
  lowerBound: boolean;
}) {
  if (trend.length < 2) return null;
  const width = 160;
  const height = 40;
  const max = Math.max(...trend.map((bucket) => bucket.total_usd), 1e-9);
  const barWidth = width / trend.length;
  const prefix = lowerBound ? "≥" : "";

  return (
    <div className="opportunity-meter-trend">
      <span>Weekly · estimated opportunity</span>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Weekly estimated context opportunity"
      >
        {trend.map((bucket, index) => {
          const totalHeight = (bucket.total_usd / max) * height;
          const opportunityHeight = (bucket.avoidable_usd / max) * height;
          return (
            <g key={bucket.week_start}>
              <rect
                x={index * barWidth + 1}
                width={Math.max(1, barWidth - 2)}
                y={height - totalHeight}
                height={totalHeight}
                className="trend-recorded-cost"
              />
              <rect
                x={index * barWidth + 1}
                width={Math.max(1, barWidth - 2)}
                y={height - opportunityHeight}
                height={opportunityHeight}
                className="trend-opportunity"
              >
                <title>
                  week of {bucket.week_start}: {prefix}{formatUsd(bucket.avoidable_usd)} estimated
                  opportunity from {prefix}{formatUsd(bucket.total_usd)} recorded estimated cost
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function TaxMeterHero({
  meta,
  archetypes,
  selectedKey,
  onSelectArchetype,
}: {
  meta: ContextEconomicsMeta;
  archetypes: ContextArchetype[];
  selectedKey?: string | null;
  onSelectArchetype?: (key: string) => void;
}) {
  const total = Math.max(meta.recorded_api_equivalent_usd, 1e-9);
  const supported = archetypes.filter((archetype) =>
    archetype.meets_support
    && (meta.cost_available ? archetype.savings_usd > 0 : archetype.savings_tokens > 0));
  const opportunityPercent = meta.recorded_api_equivalent_usd > 0
    ? Math.round((meta.opportunity_usd / meta.recorded_api_equivalent_usd) * 100)
    : 0;
  const supportedUsd = supported.reduce((sum, archetype) => sum + archetype.savings_usd, 0);
  const segmentScale = supportedUsd > 0 ? meta.opportunity_usd / supportedUsd : 0;
  const supportedTokens = supported.reduce((sum, archetype) => sum + archetype.savings_tokens, 0);
  const lowerBoundPrefix = meta.costs_partial ? "≥" : "";

  return (
    <section className="opportunity-meter-hero">
      {meta.cost_available ? (
        <>
          <div className="opportunity-meter-stats">
            <div className="opportunity-meter-stat is-opportunity">
              <span>Estimated context opportunity</span>
              <strong>
                {lowerBoundPrefix}{formatUsd(meta.opportunity_usd)}{" "}
                {!meta.costs_partial && <em>({opportunityPercent}%)</em>}
              </strong>
              <small className="opportunity-meter-token-note">
                ≈ {formatTokens(meta.opportunity_tokens)} modeled opportunity
              </small>
            </div>
            <div className="opportunity-meter-stat">
              <span>Recorded estimated API-equivalent cost</span>
              <strong>{lowerBoundPrefix}{formatUsd(meta.recorded_api_equivalent_usd)}</strong>
            </div>
            <div className="opportunity-meter-stat">
              <span>Cost not attributed to detected opportunities</span>
              <strong>{formatUsd(meta.unattributed_usd)}</strong>
            </div>
            <TrendSparkline trend={meta.trend ?? []} lowerBound={meta.costs_partial} />
          </div>
          {!meta.costs_partial && (
            <div
              className="opportunity-meter-bar"
              role="group"
              aria-label={`Estimated context opportunity breakdown: ${formatUsd(meta.opportunity_usd)} of ${formatUsd(meta.recorded_api_equivalent_usd)}`}
            >
              <i
                className="opportunity-meter-unattributed"
                style={{ width: `${(meta.unattributed_usd / total) * 100}%` }}
                title={`Cost not attributed to detected opportunities ${formatUsd(meta.unattributed_usd)}`}
              />
              {supported.map((archetype) => (
                <button
                  key={archetype.key}
                  type="button"
                  className="opportunity-meter-segment"
                  style={{
                    width: `${(archetype.savings_usd * segmentScale / total) * 100}%`,
                    background: ARCHETYPE_COLORS[archetype.key],
                  }}
                  title={`${archetype.title} ${formatUsd(archetype.savings_usd)} — inspect findings`}
                  aria-label={`${archetype.title}: ${formatUsd(archetype.savings_usd)}`}
                  onClick={() => onSelectArchetype?.(archetype.key)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="opportunity-meter-stats">
            <div className="opportunity-meter-stat is-opportunity">
              <span>Estimated context opportunity</span>
              <strong>{formatTokens(meta.opportunity_tokens)}</strong>
            </div>
          </div>
          {supportedTokens > 0 && (
            <div
              className="opportunity-meter-bar"
              role="group"
              aria-label={`Estimated context opportunity breakdown: ${formatTokens(supportedTokens)}`}
            >
              {supported.map((archetype) => (
                <button
                  key={archetype.key}
                  type="button"
                  className="opportunity-meter-segment"
                  style={{
                    width: `${(archetype.savings_tokens / supportedTokens) * 100}%`,
                    background: ARCHETYPE_COLORS[archetype.key],
                  }}
                  title={`${archetype.title} ${formatTokens(archetype.savings_tokens)} — inspect findings`}
                  aria-label={`${archetype.title}: ${formatTokens(archetype.savings_tokens)}`}
                  onClick={() => onSelectArchetype?.(archetype.key)}
                />
              ))}
            </div>
          )}
        </>
      )}
      <div className="opportunity-meter-legend">
        {archetypes.map((archetype) => {
          const gated = !archetype.meets_support;
          return (
            <button
              key={archetype.key}
              type="button"
              className={`opportunity-meter-legend-item${selectedKey === archetype.key ? " is-active" : ""}`}
              style={{ "--archetype-color": ARCHETYPE_COLORS[archetype.key] } as React.CSSProperties}
              disabled={gated}
              title={gated
                ? `Needs more evidence — ${archetype.findings_count} of ${meta.min_support} findings`
                : undefined}
              onClick={() => onSelectArchetype?.(archetype.key)}
            >
              <i style={{ background: ARCHETYPE_COLORS[archetype.key] }} />
              {archetype.title}
              <b>
                {gated
                  ? `${archetype.findings_count}/${meta.min_support}`
                  : meta.cost_available
                    ? `${lowerBoundPrefix}${formatUsd(archetype.savings_usd)}`
                    : formatTokens(archetype.savings_tokens)}
              </b>
            </button>
          );
        })}
        {meta.cost_available && (
          <span className="opportunity-meter-legend-item is-static">
            <i className="opportunity-meter-unattributed-swatch" />
            Cost not attributed to detected opportunities
            <b>{formatUsd(meta.unattributed_usd)}</b>
          </span>
        )}
      </div>
    </section>
  );
}
