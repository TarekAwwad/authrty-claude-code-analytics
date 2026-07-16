import type { LimitEraEntry, LimitHitEntry, LimitWindowEntry } from "../../api/types";
import { formatTokens as formatTokenCount, formatUsd } from "../formatting";

export type LimitBasis = "cost" | "tokens";

export function formatResetInterval(minutes: number): string {
  if (!minutes) return "0h";
  const hours = minutes / 60;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

// A measured value the user reads (tooltip, hit detail, era summary): keeps
// cents, because a cheap window is not a free one.
export function formatLimitValue(
  value: number | null | undefined,
  basis: LimitBasis,
): string {
  if (value == null) return "n/a";
  if (value === 0) return basis === "cost" ? "$0" : "0 tok";
  return basis === "cost" ? formatUsd(value) : formatTokenCount(value);
}

// An axis tick: rounded hard, because these sit in a narrow gutter and are
// read against the plot, not quoted.
export function formatLimitTick(value: number, basis: LimitBasis): string {
  if (basis === "tokens") return formatTokenCount(Math.round(value));
  if (value === 0) return "$0";
  return `$${value >= 10 ? Math.round(value) : value.toFixed(1)}`;
}

export interface EraRate {
  hitCount: number;
  weeks: number;
  perWeek: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hits per calendar week of each plan's tenure (the span of its windows in
 * the logs). Tenure is floored at one week so a young corpus reports what
 * actually happened instead of extrapolating a single day into a wild rate.
 */
export function eraRates(
  windows: LimitWindowEntry[],
  hits: LimitHitEntry[],
): Map<string, EraRate> {
  const spans = new Map<string, { from: number; to: number }>();
  windows.forEach((w) => {
    const from = Date.parse(w.start);
    const to = Date.parse(w.end);
    const current = spans.get(w.era);
    if (!current) spans.set(w.era, { from, to });
    else {
      current.from = Math.min(current.from, from);
      current.to = Math.max(current.to, to);
    }
  });
  const counts = new Map<string, number>();
  hits.forEach((h) => {
    if (h.window_index == null) return;
    const window = windows[h.window_index];
    if (!window) return;
    counts.set(window.era, (counts.get(window.era) ?? 0) + 1);
  });
  const rates = new Map<string, EraRate>();
  spans.forEach((span, era) => {
    const weeks = Math.max((span.to - span.from) / WEEK_MS, 1);
    const hitCount = counts.get(era) ?? 0;
    rates.set(era, { hitCount, weeks, perWeek: hitCount / weeks });
  });
  return rates;
}

/** How the selected basis names itself in legends and aria-labels. */
export function basisLabel(basis: LimitBasis): string {
  return basis === "cost" ? "API-equivalent cost" : "token volume";
}

export interface EraHitLevel {
  values: number[];
  median: number | null;
  min: number | null;
  max: number | null;
  percentile: number | null;
}

/**
 * The era's observed hit levels on the selected basis. The backend sends both bases side
 * by side; picking between them belongs here, not in every chart.
 */
export function eraHitLevel(era: LimitEraEntry, basis: LimitBasis): EraHitLevel {
  if (basis === "cost") {
    return {
      values: era.usage_at_hit_usd,
      median: era.hit_level_median_usd,
      min: era.hit_level_min_usd,
      max: era.hit_level_max_usd,
      percentile: era.hit_level_percentile,
    };
  }
  return {
    values: era.usage_at_hit_tokens,
    median: era.hit_level_median_tokens,
    min: era.hit_level_min_tokens,
    max: era.hit_level_max_tokens,
    percentile: era.hit_level_percentile_tokens,
  };
}

/** The window usage a single hit was measured at, on the selected basis. */
export function hitUsage(hit: LimitHitEntry, basis: LimitBasis): number | null {
  return basis === "cost" ? hit.usage_at_hit : hit.usage_at_hit_tokens;
}
