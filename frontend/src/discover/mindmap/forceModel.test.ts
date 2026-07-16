import { describe, expect, it } from "vitest";
import type { UsageHabit, UsagePhase, UsageTool } from "../../api/types";
import {
  buildForceModel, bubbleMetric, deriveOriginPhases, groupSmallLeaves,
  habitRadius, labelPlate, labelTier, nodeCollisionRadius, phaseNode,
  phaseRadius,
} from "./forceModel";

function habit(key: string, activityCount: number): UsageHabit {
  return { key, phase: "explore", label: key,
           activity_count: activityCount, session_count: 2 };
}

function phase(key: string, share: number, habits: UsageHabit[] = [],
               tools: UsageTool[] = [], split?: Partial<UsagePhase>): UsagePhase {
  const activity = share * 100;
  return { key, label: key[0].toUpperCase() + key.slice(1),
           activity_count: activity, activity_share: share,
           main_activity_count: activity, subagent_activity_count: 0,
           text_assistant_step_count: 0,
           tool_count: 10, session_count: 3, habits, tools, ...split };
}

function tool(key: string, activityCount: number): UsageTool {
  return { key, label: key, activity_count: activityCount, session_count: 2 };
}

describe("labelTier", () => {
  it("maps radius to tier per spec thresholds", () => {
    expect(labelTier(30)).toBe("inside");
    expect(labelTier(29.9)).toBe("split");
    expect(labelTier(22)).toBe("split");
    expect(labelTier(21.9)).toBe("below");
  });
});

describe("bubble label layout", () => {
  it("truncates long labels into a compact plate while preserving short labels", () => {
    expect(labelPlate("Explore")).toEqual({
      text: "Explore",
      width: 56,
    });
    const long = labelPlate("Repeated file re-reads");
    expect(long.text).toBe("Repeated file…");
    expect(long.width).toBeLessThanOrEqual(94);
  });

  it("puts a compact quantitative value in the bubble", () => {
    expect(bubbleMetric({ kind: "phase", sublabel: "52%" })).toBe("52%");
    expect(bubbleMetric({ kind: "tool", sublabel: "1445 calls" })).toBe("1.4k");
    expect(bubbleMetric({ kind: "habit", sublabel: "8 observations" })).toBe("8");
    expect(bubbleMetric({ kind: "habit", sublabel: "" })).toBe("");
  });

  it("reserves collision space for the label plate instead of only the circle", () => {
    const node = phaseNode(phase("explore", 0.01));
    node.label = "Repeated file re-reads";
    expect(nodeCollisionRadius(node)).toBeGreaterThan(node.r + 20);
  });
});

describe("radii", () => {
  it("scales phases as 18 + 34*sqrt(share)", () => {
    expect(phaseRadius(0)).toBeCloseTo(18);
    expect(phaseRadius(0.25)).toBeCloseTo(35);
  });
  it("scales habits as 10 + 20*sqrt(share)", () => {
    expect(habitRadius(0)).toBeCloseTo(10);
    expect(habitRadius(0.04)).toBeCloseTo(14);
  });
});

describe("groupSmallLeaves", () => {
  it("keeps the top 4 by observed activity and groups the rest", () => {
    const habits = [1, 2, 3, 4, 5, 6].map((n) => habit(`h${n}`, n * 10));
    const { visible, grouped } = groupSmallLeaves(habits, 100);
    expect(visible.map((h) => h.key)).toEqual(["h6", "h5", "h4", "h3"]);
    expect(grouped.map((h) => h.key)).toEqual(["h2", "h1"]);
  });
  it("groups patterns below 1% of observed activity", () => {
    const { visible, grouped } = groupSmallLeaves([habit("tiny", 0.5)], 100);
    expect(visible).toHaveLength(0);
    expect(grouped.map((h) => h.key)).toEqual(["tiny"]);
  });
});

describe("phaseNode", () => {
  it("builds a selectable phase node with stable id and exact share label", () => {
    const node = phaseNode(phase("explore", 0.5));
    expect(node.id).toBe("phase:explore");
    expect(node.kind).toBe("phase");
    expect(node.sublabel).toBe("50%");
    expect(node.r).toBeCloseTo(phaseRadius(0.5));
    expect(node.labelTier).toBe(labelTier(node.r));
  });
});

describe("buildForceModel", () => {
  const phases = [
    phase("explore", 0.5, [habit("re-reads", 5)]),
    phase("implement", 0.3),
    phase("plan", 0, []), // inactive: zero share, no habits
  ];

  it("builds a pinned center plus nodes/links for active phases only", () => {
    const model = buildForceModel(phases, { totalActivity: 100 });
    const ids = model.nodes.map((n) => n.id);
    expect(ids).toEqual(["center", "phase:explore", "habit:re-reads@explore", "phase:implement"]);
    const center = model.nodes[0];
    expect(center.fx).toBe(0);
    expect(center.fy).toBe(0);
    expect(center.sublabel).toBe("100 activities");
  });

  it("links scale distance and width with share", () => {
    const model = buildForceModel(phases, { totalActivity: 100 });
    const explore = model.links.find((l) => l.targetId === "phase:explore")!;
    const implement = model.links.find((l) => l.targetId === "phase:implement")!;
    expect(explore.distance).toBeCloseTo(120 + 90 * 0.5);
    expect(explore.width).toBeCloseTo(14 * 0.5);
    expect(implement.distance).toBeCloseTo(120 + 90 * 0.3);
    expect(explore.kind).toBe("structure");
  });

  it("pattern links are neutral and nodes carry observed counts", () => {
    const model = buildForceModel(phases, { totalActivity: 100 });
    const leaf = model.nodes.find((n) => n.id === "habit:re-reads@explore")!;
    expect(leaf.share).toBeCloseTo(0.05);
    expect(leaf.sublabel).toBe("5 observations");
    const link = model.links.find((l) => l.targetId === leaf.id)!;
    expect(link.kind).toBe("structure");
    expect(link.sourceId).toBe("phase:explore");
  });

  it("collapses overflow habits into a grouped leaf", () => {
    const many = phase("explore", 0.5, [1, 2, 3, 4, 5].map((n) => habit(`h${n}`, n * 5)));
    const model = buildForceModel([many], { totalActivity: 100 });
    const other = model.nodes.find((n) => n.id === "habit:other@explore")!;
    expect(other.label).toBe("+1 more");
    expect(other.grouped?.map((h) => h.key)).toEqual(["h1"]);
  });

  it("seeds deterministic non-zero starting positions", () => {
    const a = buildForceModel(phases, { totalActivity: 100 });
    const b = buildForceModel(phases, { totalActivity: 100 });
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(a.nodes[1].x !== 0 || a.nodes[1].y !== 0).toBe(true);
  });

});

describe("buildForceModel tool lens", () => {
  const phases = [
    phase("explore", 0.5, [habit("re-reads", 5)], [tool("Read", 30), tool("Grep", 10)]),
    phase("verify", 0.3, [], [tool("Bash", 30)]),
  ];

  it("hangs tool leaves off phases and omits habit leaves", () => {
    const model = buildForceModel(phases,
      { totalActivity: 100, leafMode: "tools" });
    const ids = model.nodes.map((n) => n.id);
    expect(ids).toContain("tool:Read@explore");
    expect(ids).toContain("tool:Grep@explore");
    expect(ids).toContain("tool:Bash@verify");
    expect(ids.some((id) => id.startsWith("habit:"))).toBe(false);
  });

  it("defaults to the habits lens", () => {
    const model = buildForceModel(phases, { totalActivity: 100 });
    expect(model.nodes.some((n) => n.id === "habit:re-reads@explore")).toBe(true);
    expect(model.nodes.some((n) => n.kind === "tool")).toBe(false);
  });

  it("tool nodes carry observed call counts and neutral structure links", () => {
    const model = buildForceModel(phases,
      { totalActivity: 100, leafMode: "tools" });
    const leaf = model.nodes.find((n) => n.id === "tool:Read@explore")!;
    expect(leaf.kind).toBe("tool");
    expect(leaf.share).toBeCloseTo(0.3);
    expect(leaf.sublabel).toBe("30 calls");
    expect(leaf.toolKey).toBe("Read");
    expect(leaf.phaseKey).toBe("explore");
    const link = model.links.find((l) => l.targetId === leaf.id)!;
    expect(link.kind).toBe("structure");
    expect(link.sourceId).toBe("phase:explore");
  });

  it("collapses overflow tools into a grouped leaf", () => {
    const many = phase("explore", 0.5, [],
      [1, 2, 3, 4, 5].map((n) => tool(`T${n}`, n * 5)));
    const model = buildForceModel([many],
      { totalActivity: 100, leafMode: "tools" });
    const other = model.nodes.find((n) => n.id === "tool:other@explore")!;
    expect(other.label).toBe("+1 more");
    expect(other.grouped?.map((t) => t.key)).toEqual(["T1"]);
  });

  it("keeps a zero-share phase visible in the lens that has leaves for it", () => {
    const zeroShare = phase("operate", 0, [], [tool("Bash", 0)]);
    const tools = buildForceModel([zeroShare],
      { totalActivity: 100, leafMode: "tools" });
    expect(tools.nodes.some((n) => n.id === "phase:operate")).toBe(true);
    expect(tools.nodes.some((n) => n.id === "tool:Bash@operate")).toBe(false); // 0% < 1% floor -> grouped
    expect(tools.nodes.some((n) => n.id === "tool:other@operate")).toBe(true);
    const habits = buildForceModel([zeroShare],
      { totalActivity: 100, leafMode: "habits" });
    expect(habits.nodes.some((n) => n.id === "phase:operate")).toBe(false);
  });
});

describe("deriveOriginPhases", () => {
  const phases: UsagePhase[] = [
    phase("explore", 0.8, [], [], {
      main_activity_count: 20, subagent_activity_count: 60,
    }),
    phase("implement", 0.2, [], [], {
      main_activity_count: 20, subagent_activity_count: 0,
    }),
  ];

  it("returns phases unchanged for 'all'", () => {
    const { phases: out, total } = deriveOriginPhases(phases, "all");
    expect(total).toBe(100);
    expect(out[0].activity_share).toBe(0.8);
  });

  it("rescales to the subagent subset", () => {
    const { phases: out, total } = deriveOriginPhases(phases, "subagent");
    expect(total).toBe(60);             // 60 + 0
    expect(out[0].activity_count).toBe(60);
    expect(out[0].activity_share).toBe(1);
    expect(out[1].activity_share).toBe(0);
    expect(out[0].habits).toEqual([]);  // leaves hidden in split mode
  });

  it("rescales to the main subset", () => {
    const { phases: out, total } = deriveOriginPhases(phases, "main");
    expect(total).toBe(40);             // 20 + 20
    expect(out[0].activity_share).toBe(0.5);
    expect(out[1].activity_share).toBe(0.5);
  });
});
