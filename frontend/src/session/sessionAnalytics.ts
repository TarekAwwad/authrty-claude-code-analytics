// Pure helpers that derive the session analytics tiles from already-fetched
// query data (timeline items, trace spans, subagents). No network access.
import type { Subagent, TimelineItem } from "../api/types";
import type { LoopContext } from "../trace/loopContext";

export function isErrorItem(item: TimelineItem): boolean {
  return item.is_error === true;
}

function toMs(ts: string | null): number | null {
  if (!ts) return null;
  const value = Date.parse(ts);
  return Number.isNaN(value) ? null : value;
}

function timestampBounds(stamps: Array<number | null>): { min: number | null; max: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  for (const stamp of stamps) {
    if (stamp === null) continue;
    min = min === null ? stamp : Math.min(min, stamp);
    max = max === null ? stamp : Math.max(max, stamp);
  }
  return { min, max };
}

export interface DensityBucket {
  index: number;
  count: number;
  hasError: boolean;
  hasLoop: boolean;
}

export interface DensityModel {
  buckets: DensityBucket[];
  total: number;
  maxCount: number;
  durationMinutes: number;
}

// Bucket timeline events evenly across the session timespan. Falls back to
// even index spacing when timestamps are missing.
export function buildDensity(
  items: TimelineItem[],
  loopContexts: Map<number, LoopContext> | undefined,
  bucketCount = 32,
): DensityModel {
  const buckets: DensityBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    count: 0,
    hasError: false,
    hasLoop: false,
  }));
  if (items.length === 0) {
    return { buckets, total: 0, maxCount: 0, durationMinutes: 0 };
  }

  const stamps = items.map((item) => toMs(item.timestamp));
  const { min: minMs, max: maxMs } = timestampBounds(stamps);
  const span = minMs !== null && maxMs !== null ? maxMs - minMs : 0;

  const bucketFor = (index: number): number => {
    const stamp = stamps[index];
    if (minMs !== null && maxMs !== null && span > 0 && stamp !== null) {
      return Math.min(bucketCount - 1, Math.floor(((stamp - minMs) / span) * bucketCount));
    }
    // No usable timestamps: spread events evenly by position.
    return Math.min(bucketCount - 1, Math.floor((index / items.length) * bucketCount));
  };

  items.forEach((item, index) => {
    const bucket = buckets[bucketFor(index)];
    bucket.count += 1;
    if (isErrorItem(item)) bucket.hasError = true;
    if (loopContexts?.has(item.event_id)) bucket.hasLoop = true;
  });

  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 0);
  return {
    buckets,
    total: items.length,
    maxCount,
    durationMinutes: span > 0 ? span / 60000 : 0,
  };
}

export interface SubagentHeatCell {
  id: string;
  label: string;
  agentId: string;
  agentType: string | null;
  name: string | null;
  description: string | null;
  toolUseId: string | null;
  firstTs: string | null;
  lastTs: string | null;
  events: number;
  inputTokens: number;
  outputTokens: number;
  errorCount: number;
  apiEquivalentUsd: number;
  costAvailable: boolean;
  unpricedModels: string[];
  spanSeconds: number | null;
  heatValue: number | null;
  level: 0 | 1 | 2 | 3;
}

export interface SubagentHeatModel {
  count: number;
  totalEvents: number;
  cells: SubagentHeatCell[];
}

export type SubagentHeatMetric = "events" | "errors" | "span" | "cost";

function heatLevel(value: number | null, max: number): 0 | 1 | 2 | 3 {
  if (value === null || max <= 0 || value <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 0.66) return 3;
  if (ratio >= 0.33) return 2;
  return 1;
}

export function buildSubagentHeat(
  subagents: Subagent[],
  metric: SubagentHeatMetric = "events",
): SubagentHeatModel {
  const sorted = [...subagents].sort((a, b) => {
    const aStart = toMs(a.first_ts);
    const bStart = toMs(b.first_ts);
    if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
    if (aStart !== null && bStart === null) return -1;
    if (aStart === null && bStart !== null) return 1;
    return a.agent_id.localeCompare(b.agent_id);
  });
  const totalEvents = sorted.reduce((sum, agent) => sum + agent.event_count, 0);
  const rows = sorted.map((agent) => {
    const first = toMs(agent.first_ts);
    const last = toMs(agent.last_ts);
    const spanSeconds = first !== null && last !== null && last >= first
      ? Math.round((last - first) / 1000)
      : null;
    const heatValue = metric === "events"
      ? agent.event_count
      : metric === "errors"
        ? agent.error_count
        : metric === "span"
          ? spanSeconds
          : !agent.cost_available || (agent.unpriced_models.length > 0 && agent.api_equivalent_usd <= 0)
            ? null
            : agent.api_equivalent_usd;
    return { agent, spanSeconds, heatValue };
  });
  const maxValue = Math.max(...rows.map((row) => row.heatValue ?? 0), 0);
  const cells: SubagentHeatCell[] = rows.map(({ agent, spanSeconds, heatValue }, index) => {
    return {
      id: agent.agent_id,
      label: `A${index + 1}`,
      agentId: agent.agent_id,
      agentType: agent.agent_type,
      name: agent.name,
      description: agent.description,
      toolUseId: agent.tool_use_id,
      firstTs: agent.first_ts,
      lastTs: agent.last_ts,
      events: agent.event_count,
      inputTokens: agent.input_tokens,
      outputTokens: agent.output_tokens,
      errorCount: agent.error_count,
      apiEquivalentUsd: agent.api_equivalent_usd,
      costAvailable: agent.cost_available,
      unpricedModels: agent.unpriced_models,
      spanSeconds,
      heatValue,
      level: heatLevel(heatValue, maxValue),
    };
  });
  return { count: subagents.length, totalEvents, cells };
}

// Cache hit %: cache-read tokens over all input tokens. Trace spans do not
// carry cache-read counts, so this is sourced from the session cost aggregate
// (trace.cost.tokens). Returns null when no input tokens are known.
export function cacheHitPct(tokens: {
  base_input: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
} | null | undefined): number | null {
  if (!tokens) return null;
  const input =
    tokens.base_input + tokens.cache_write_5m + tokens.cache_write_1h + tokens.cache_read;
  if (input <= 0) return null;
  return Math.round((tokens.cache_read / input) * 100);
}
