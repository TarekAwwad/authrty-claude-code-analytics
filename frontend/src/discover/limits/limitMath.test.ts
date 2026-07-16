import { describe, expect, it } from "vitest";
import type { LimitEraEntry, LimitHitEntry, LimitWindowEntry } from "../../api/types";
import * as limitMath from "./limitMath";
import {
  eraHitLevel,
  eraRates,
  formatLimitTick,
  formatLimitValue,
  formatResetInterval,
} from "./limitMath";

function win(start: string, end: string, era: string, hit = false): LimitWindowEntry {
  return { start, end, value_usd: 10, tokens: 1, era, hit_kinds: hit ? ["session"] : [] };
}

function hit(windowIndex: number | null): LimitHitEntry {
  return {
    ts: "2026-07-01T01:00:00Z", kind: "session", reset_at: null,
    minutes_until_reset: null, usage_at_hit: null, usage_at_hit_tokens: null,
    occurrence_count: 1,
    window_index: windowIndex, session_ids: [], session_titles: [],
  };
}

function era(overrides: Partial<LimitEraEntry>): LimitEraEntry {
  return {
    era: "Pro", window_count: 10, session_hit_count: 2, minutes_until_reset: 60,
    hit_level_median_usd: 10, hit_level_min_usd: 8, hit_level_max_usd: 12,
    hit_level_median_tokens: 1000, hit_level_min_tokens: 800, hit_level_max_tokens: 1200,
    hit_level_percentile: 0.7, hit_level_percentile_tokens: 0.95,
    usage_at_hit_usd: [8, 12], usage_at_hit_tokens: [800, 1200], ...overrides,
  };
}

describe("formatLimitValue and formatLimitTick", () => {
  it("keeps cents on measured values so a cheap window is not a free one", () => {
    expect(formatLimitValue(0.04, "cost")).toBe("$0.04");
    expect(formatLimitValue(2.47, "cost")).toBe("$2.47");
    expect(formatLimitValue(0, "cost")).toBe("$0");
    expect(formatLimitValue(null, "cost")).toBe("n/a");
    expect(formatLimitValue(900_000, "tokens")).toBe("900k tok");
  });

  it("rounds axis ticks, which sit in a narrow gutter", () => {
    expect(formatLimitTick(52.5, "cost")).toBe("$53");
    expect(formatLimitTick(2.47, "cost")).toBe("$2.5");
    expect(formatLimitTick(0, "cost")).toBe("$0");
    expect(formatLimitTick(333.25, "tokens")).toBe("333 tok");
    expect(formatLimitTick(2_300_000, "tokens")).toBe("2.3M tok");
  });
});

describe("eraRates", () => {
  it("floors tenure at one week and counts hits per era", () => {
    const windows = [
      win("2026-07-01T00:00:00Z", "2026-07-01T05:00:00Z", "Pro", true),
      win("2026-07-02T00:00:00Z", "2026-07-02T05:00:00Z", "Pro"),
    ];
    const rates = eraRates(windows, [hit(0)]);
    expect(rates.get("Pro")).toMatchObject({ hitCount: 1, weeks: 1, perWeek: 1 });
  });

  it("uses real tenure once past a week and skips unattached hits", () => {
    const windows = [
      win("2026-06-01T00:00:00Z", "2026-06-01T05:00:00Z", "Pro", true),
      win("2026-06-15T00:00:00Z", "2026-06-15T05:00:00Z", "Pro", true),
    ];
    const rates = eraRates(windows, [hit(0), hit(1), hit(null)]);
    expect(rates.get("Pro")!.weeks).toBeGreaterThan(2);
    expect(rates.get("Pro")!.hitCount).toBe(2);
    expect(rates.get("Pro")!.perWeek).toBeCloseTo(1, 1);
  });
});

describe("eraHitLevel and reset formatting", () => {
  it("selects matching observed fields for each basis", () => {
    expect(eraHitLevel(era({}), "cost")).toEqual({
      values: [8, 12], median: 10, min: 8, max: 12, percentile: 0.7,
    });
    expect(eraHitLevel(era({}), "tokens")).toEqual({
      values: [800, 1200], median: 1000, min: 800, max: 1200, percentile: 0.95,
    });
  });

  it("formats the reset-minus-hit interval neutrally", () => {
    expect(formatResetInterval(49.3)).toBe("0.8h");
    expect(formatResetInterval(0)).toBe("0h");
  });
});

describe("automatic verdict removal", () => {
  it("does not export a plan-fit verdict builder", () => {
    expect(limitMath).not.toHaveProperty("buildVerdict");
  });
});
