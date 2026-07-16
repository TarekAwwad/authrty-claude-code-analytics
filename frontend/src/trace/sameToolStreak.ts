import type { TraceSpan } from "../api/types";

export interface SameToolStreakContext {
  eventId: number;
  runId: string;
  toolName: string;
  position: number;
  count: number;
  startEventId: number;
  endEventId: number;
}

export function contextForSameToolStreakSpan(span: TraceSpan): SameToolStreakContext | null {
  const streak = span.same_tool_streak;
  if (!streak || streak.count < 1 || streak.position < 1) return null;

  return {
    eventId: span.event_id,
    runId: streak.streak_id,
    toolName: streak.tool_name,
    position: streak.position,
    count: streak.count,
    startEventId: streak.start_event_id,
    endEventId: streak.end_event_id,
  };
}

export function buildSameToolStreakContextMap(spans: TraceSpan[]): Map<number, SameToolStreakContext> {
  const contexts = new Map<number, SameToolStreakContext>();
  for (const span of spans) {
    const context = contextForSameToolStreakSpan(span);
    if (context) contexts.set(span.event_id, context);
  }
  return contexts;
}

export function sameToolStreakExplanation(context: SameToolStreakContext): string {
  return `${context.toolName} appears ${context.count} times consecutively on the same lane; this event is ${context.position} of ${context.count} in events ${context.startEventId}-${context.endEventId}.`;
}
