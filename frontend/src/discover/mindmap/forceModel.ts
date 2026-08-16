// Pure graph model for the force-directed usage map. No React, no DOM, no
// physics — everything here is unit-testable (replaces mapGeometry.ts).
//
// Encoding contract: phase geometry is monotonic in conserved observed-activity
// share. Pattern and tool leaves are sized from their recorded counts.
import type { UsageHabit, UsagePhase, UsageTool } from "../../api/types";

export type LabelTier = "inside" | "split" | "below";
export type LeafMode = "habits" | "tools";
export type OriginFilter = "all" | "main" | "subagent";

/**
 * Rescale phases to one origin subset for the map's Origin filter. Leaves are
 * all-origin aggregates, so split views deliberately hide them.
 */
export function deriveOriginPhases(
  phases: UsagePhase[],
  origin: OriginFilter,
): { phases: UsagePhase[]; total: number } {
  const value = (p: UsagePhase): number => origin === "all"
    ? p.activity_count
    : origin === "main" ? p.main_activity_count : p.subagent_activity_count;
  const total = phases.reduce((sum, p) => sum + value(p), 0);
  if (origin === "all") return { phases, total };
  return {
    total,
    phases: phases.map((p) => ({
      ...p,
      activity_count: value(p),
      activity_share: total > 0 ? value(p) / total : 0,
      habits: [],
      tools: [],
    })),
  };
}

/** Minimal shape an overflow leaf needs to list its members. Both UsageHabit
    and UsageTool satisfy it structurally. */
export interface GroupedLeaf {
  key: string;
  label: string;
  activity_count: number;
}

export interface MapNode {
  id: string; // "center" | "phase:<key>" | "habit:<key>@<phase>" | "habit:other@<phase>"
              // | "tool:<name>@<phase>" | "tool:other@<phase>"
  kind: "center" | "phase" | "habit" | "tool";
  label: string;
  sublabel: string;
  r: number;
  share: number;
  labelTier: LabelTier;
  phaseKey?: string;
  habitKey?: string;          // unset on the grouped overflow leaf
  toolKey?: string;           // tool-lens leaves only
  grouped?: GroupedLeaf[];    // members of an overflow leaf
  // d3-force reads and mutates these in place at runtime. Seeded here so the
  // first paint is deterministic.
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface MapLink {
  id: string;
  // d3's forceLink().id() resolves these string endpoints into node objects in
  // place; keep the *Id fields for stable access from rendering code.
  source: string | MapNode;
  target: string | MapNode;
  sourceId: string;
  targetId: string;
  distance: number;
  width: number;
  kind: "structure";
}

export interface ForceModel {
  nodes: MapNode[];
  links: MapLink[];
}

const MAX_LEAVES_PER_PHASE = 4;
const MIN_LEAF_SHARE = 0.01; // of total observed activity; below this -> grouped
const PHASE_SEED_RADIUS = 170;
const LEAF_SEED_RADIUS = 250;
const MAX_LABEL_CHARACTERS = 14;
const LABEL_PLATE_MIN_WIDTH = 48;
const LABEL_PLATE_MAX_WIDTH = 94;

export interface LabelPlate {
  text: string;
  width: number;
}

/**
 * Keep graph labels deliberately short. The complete label remains on the
 * node's accessible name and in the hover tooltip/evidence panel.
 */
export function labelPlate(label: string): LabelPlate {
  const text = label.length > MAX_LABEL_CHARACTERS
    ? `${label.slice(0, MAX_LABEL_CHARACTERS - 1)}…`
    : label;
  return {
    text,
    width: Math.max(
      LABEL_PLATE_MIN_WIDTH,
      Math.min(LABEL_PLATE_MAX_WIDTH, Math.round(20 + text.length * 5.2)),
    ),
  };
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** The quantitative value belongs in the circle; its descriptive label does not. */
export function bubbleMetric(
  node: Pick<MapNode, "kind" | "sublabel">,
): string {
  if (node.kind === "phase") return node.sublabel;
  const match = node.sublabel.match(/^([\d,.]+)/);
  if (!match) return "";
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? compactCount(value) : "";
}

/**
 * d3's circular collision force cannot measure an SVG label plate. Use a
 * conservative envelope that protects both the bubble and its caption.
 */
export function nodeCollisionRadius(node: MapNode): number {
  if (node.kind === "center") return node.r + 12;
  const plate = labelPlate(node.label);
  // The plate starts 6px below the bubble and is 18px tall. Protect its
  // furthest corner, not only its width, so diagonally adjacent captions also
  // remain separate.
  return Math.ceil(Math.hypot(plate.width / 2, node.r + 24) + 3);
}

export function phaseRadius(share: number): number {
  return 18 + 34 * Math.sqrt(share);
}

export function habitRadius(share: number): number {
  return 10 + 20 * Math.sqrt(share);
}

export function labelTier(r: number): LabelTier {
  if (r >= 30) return "inside";
  if (r >= 22) return "split";
  return "below";
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * Visible leaves vs grouped overflow: top MAX_LEAVES_PER_PHASE by observed
 * activity, with leaves below MIN_LEAF_SHARE grouped.
 */
export function groupSmallLeaves<T extends { activity_count: number }>(
  leaves: T[],
  totalActivity: number,
): { visible: T[]; grouped: T[] } {
  const sorted = [...leaves].sort((a, b) => b.activity_count - a.activity_count);
  const visible: T[] = [];
  const grouped: T[] = [];
  for (const leaf of sorted) {
    const share = totalActivity > 0 ? leaf.activity_count / totalActivity : 0;
    const tooSmall = totalActivity > 0 && share < MIN_LEAF_SHARE;
    if (visible.length < MAX_LEAVES_PER_PHASE && !tooSmall) visible.push(leaf);
    else grouped.push(leaf);
  }
  return { visible, grouped };
}

/** Phase node shape shared by the model builder and the page's fallback selection. */
export function phaseNode(phase: UsagePhase): MapNode {
  const r = phaseRadius(phase.activity_share);
  return {
    id: `phase:${phase.key}`, kind: "phase", label: phase.label,
    sublabel: pct(phase.activity_share), r, share: phase.activity_share,
    labelTier: labelTier(r),
    phaseKey: phase.key, x: 0, y: 0,
  };
}

export function buildForceModel(
  phases: UsagePhase[],
  opts: { totalActivity: number; leafMode?: LeafMode },
): ForceModel {
  const leafMode = opts.leafMode ?? "habits";
  const shareTotal = opts.totalActivity;
  const active = phases.filter((p) =>
    p.activity_share > 0
    || (leafMode === "habits" ? p.habits.length > 0 : p.tools.length > 0));
  const nodes: MapNode[] = [{
    id: "center", kind: "center", label: "Observed activity",
    sublabel: `${opts.totalActivity} activities`,
    r: 44, share: 1, labelTier: "inside", x: 0, y: 0, fx: 0, fy: 0,
  }];
  const links: MapLink[] = [];

  active.forEach((phase, i) => {
    // Deterministic seed on a circle so the first paint is stable.
    const angle = (i / active.length) * 2 * Math.PI - Math.PI / 2;
    const node = phaseNode(phase);
    node.x = Math.cos(angle) * PHASE_SEED_RADIUS;
    node.y = Math.sin(angle) * PHASE_SEED_RADIUS;
    nodes.push(node);
    links.push({
      id: `link:${node.id}`, source: "center", target: node.id,
      sourceId: "center", targetId: node.id,
      distance: 120 + 90 * phase.activity_share,
      width: Math.max(1.5, 14 * phase.activity_share), kind: "structure",
    });

    const pushLeaf = (leafNode: MapNode, linkKind: MapLink["kind"]) => {
      nodes.push(leafNode);
      links.push({
        id: `link:${leafNode.id}`, source: node.id, target: leafNode.id,
        sourceId: node.id, targetId: leafNode.id,
        distance: 80, width: Math.max(1.2, 10 * leafNode.share),
        kind: linkKind,
      });
    };
    const seed = (j: number, count: number): { x: number; y: number } => {
      const spread = angle + (j - (count - 1) / 2) * 0.5;
      return { x: Math.cos(spread) * LEAF_SEED_RADIUS,
               y: Math.sin(spread) * LEAF_SEED_RADIUS };
    };

    if (leafMode === "habits") {
      const { visible, grouped } = groupSmallLeaves(phase.habits, shareTotal);
      const leaves: (UsageHabit | null)[] =
        grouped.length > 0 ? [...visible, null] : visible;
      leaves.forEach((leaf, j) => {
        const share = leaf && shareTotal > 0 ? leaf.activity_count / shareTotal : 0;
        const r = leaf ? habitRadius(share) : 10;
        const habitNode: MapNode = leaf
          ? {
              id: `habit:${leaf.key}@${phase.key}`, kind: "habit", label: leaf.label,
              sublabel: `${leaf.activity_count} observations`,
              r, share, labelTier: labelTier(r),
              phaseKey: phase.key, habitKey: leaf.key,
              ...seed(j, leaves.length),
            }
          : {
              id: `habit:other@${phase.key}`, kind: "habit",
              label: `+${grouped.length} more`, sublabel: "",
              r, share: 0, labelTier: labelTier(r), phaseKey: phase.key, grouped,
              ...seed(j, leaves.length),
            };
        pushLeaf(habitNode, "structure");
      });
    } else {
      const { visible, grouped } = groupSmallLeaves(phase.tools, shareTotal);
      const leaves: (UsageTool | null)[] =
        grouped.length > 0 ? [...visible, null] : visible;
      leaves.forEach((leaf, j) => {
        const share = leaf && shareTotal > 0 ? leaf.activity_count / shareTotal : 0;
        const r = leaf ? habitRadius(share) : 10;
        const toolNode: MapNode = leaf
          ? {
              id: `tool:${leaf.key}@${phase.key}`, kind: "tool", label: leaf.label,
              sublabel: `${leaf.activity_count} calls`,
              r, share, labelTier: labelTier(r),
              phaseKey: phase.key, toolKey: leaf.key,
              ...seed(j, leaves.length),
            }
          : {
              id: `tool:other@${phase.key}`, kind: "tool",
              label: `+${grouped.length} more`, sublabel: "",
              r, share: 0, labelTier: labelTier(r), phaseKey: phase.key, grouped,
              ...seed(j, leaves.length),
            };
        pushLeaf(toolNode, "structure");
      });
    }
  });

  return { nodes, links };
}
