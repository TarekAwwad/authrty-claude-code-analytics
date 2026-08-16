import React from "react";
import type { LimitEraEntry } from "../../api/types";
import {
  basisLabel,
  eraHitLevel,
  formatLimitTick,
  formatLimitValue,
  type LimitBasis,
} from "./limitMath";
import { useChartTooltip } from "../context/chartTooltip";

const FALLBACK_W = 560;
const STRIP_H = 26;
const PAD = 10; // keeps edge dots inside the strip

function edgeShift(index: number, count: number): string {
  if (index === 0) return "translateX(0)";
  if (index === count - 1) return "translateX(-100%)";
  return "translateX(-50%)";
}

// The per-plan metrics live here (one row per era, not one card per era, so
// any number of plans scales). Only the parts an era actually has are shown.
function eraSummary(era: LimitEraEntry, basis: LimitBasis): string {
  const hits = era.session_hit_count;
  const hitLevel = eraHitLevel(era, basis);
  const parts = [`sample: ${hits} recorded session hit${hits === 1 ? "" : "s"}`];
  if (hitLevel.median != null) {
    parts.push(`median ${formatLimitValue(hitLevel.median, basis)}`);
  }
  if (hitLevel.min != null && hitLevel.max != null) {
    parts.push(
      `range ${formatLimitValue(hitLevel.min, basis)}–${formatLimitValue(hitLevel.max, basis)}`,
    );
  }
  if (hitLevel.percentile != null) {
    parts.push(
      `Observed hit-level percentile p${Math.round(hitLevel.percentile * 100)}`
      + ` (inferred from ${era.window_count} reconstructed windows)`,
    );
  }
  return parts.join(" · ");
}

// Per era: usage-at-hit dots, the min-max band, and a median marker, plus the
// observed hit-level percentile among reconstructed windows.
// Rendered in measured pixel space so markers keep their shape at any width;
// all eras share one scale for the selected basis and the axis at the bottom.
export default function CapZones({ eras, basis }: {
  eras: LimitEraEntry[];
  basis: LimitBasis;
}) {
  const { ref, show, hide, tooltip } = useChartTooltip<HTMLDivElement>();
  const [width, setWidth] = React.useState(FALLBACK_W);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = (next: number) => {
      const rounded = Math.max(280, Math.round(next));
      setWidth((current) => (current === rounded ? current : rounded));
    };
    if (node.clientWidth) update(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) update(entries[0].contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  const zoned = eras.filter((e) => eraHitLevel(e, basis).values.length > 0);
  if (zoned.length === 0) {
    return (
      <div className="empty-state">
        No recorded session-limit hit was found in the available logs.
      </div>
    );
  }
  const max = Math.max(0, ...zoned.map((e) => eraHitLevel(e, basis).max ?? 0));
  const scaleMax = Math.max(1e-9, max);
  const px = (v: number) => PAD + (v / scaleMax) * (width - 2 * PAD);
  // Hits measured at zero usage (a pool filled elsewhere, or no price table)
  // leave max at 0, where the three ticks would land on top of each other.
  const ticks = max > 0 ? [0, max / 2, max] : [0];

  return (
    <div className="limit-zones chart-tooltip-host" ref={ref}>
      {zoned.map((era) => {
        const hitLevel = eraHitLevel(era, basis);
        return (
        <div key={era.era || "all"} className="limit-zone-row">
          <div className="limit-zone-head">
            <strong>{era.era || "All usage"}</strong>
            <span>{eraSummary(era, basis)}</span>
          </div>
          <svg width={width} height={STRIP_H} className="limit-zone-strip" role="img"
               aria-label={`${era.era || "All usage"} observed hit levels by ${basisLabel(basis)}`}>
            {ticks.map((t) => (
              <line key={t} className="limit-zone-grid"
                    x1={px(t)} y1={3} x2={px(t)} y2={STRIP_H - 3} />
            ))}
            <rect x={PAD} y={STRIP_H / 2 - 2} width={Math.max(0, width - 2 * PAD)}
                  height={4} rx={2} className="lane-track" />
            {hitLevel.min != null && hitLevel.max != null && (
              <rect x={px(hitLevel.min)} y={STRIP_H / 2 - 5}
                    width={Math.max(2, px(hitLevel.max) - px(hitLevel.min))}
                    height={10} rx={5} className="limit-zone-band" />
            )}
            {hitLevel.values.map((v, i) => (
              <circle key={i} cx={px(v)} cy={STRIP_H / 2} r={5}
                      className="limit-zone-dot"
                      onMouseMove={(e) => show(e, formatLimitValue(v, basis), ["visible usage at recorded hit"])}
                      onMouseLeave={hide} />
            ))}
            {hitLevel.median != null && (
              <rect x={px(hitLevel.median) - 1} y={2} width={2} height={STRIP_H - 4}
                    className="limit-zone-median" />
            )}
          </svg>
        </div>
        );
      })}
      <div className="limit-zone-axis" aria-hidden={true}>
        {ticks.map((t, i) => (
          // Edge labels anchor inward: a token label ("49.7M tok") is wide
          // enough to leave the strip if it stays centred on its tick.
          <span key={t} style={{ left: px(t), transform: edgeShift(i, ticks.length) }}>
            {formatLimitTick(t, basis)}
          </span>
        ))}
      </div>
      <div className="chip-legend card-bottom-legend limit-legend">
        <span><i className="is-hit-dot" />visible usage at recorded hit</span>
        <span><i className="is-band" />observed min–max range</span>
        <span><i className="is-median" />median hit level</span>
        <em>{`x-axis: window usage, ${basisLabel(basis)}`}</em>
      </div>
      {tooltip}
    </div>
  );
}
