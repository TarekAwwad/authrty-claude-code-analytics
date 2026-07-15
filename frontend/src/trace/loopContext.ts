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

function fallbackRunId(span: TraceSpan): string {
  return `${span.lane}-${span.tool_name ?? "tool"}-${span.loop_start_event_id ?? span.event_id}`;
}

export function contextForSameToolStreakSpan(span: TraceSpan): SameToolStreakContext | null {
  if (!span.is_loop) return null;
  const count = span.loop_count ?? 0;
  const position = span.loop_position ?? 0;
  if (count < 1 || position < 1) return null;

  return {
    eventId: span.event_id,
    runId: span.loop_run_id ?? fallbackRunId(span),
    toolName: span.tool_name ?? "tool",
    position,
    count,
    startEventId: span.loop_start_event_id ?? span.event_id,
    endEventId: span.loop_end_event_id ?? span.event_id,
  };
}

export function buildSameToolStreakContextMap(spans: TraceSpan[]): Map<number, SameToolStreakContext> {
  const contexts = new Map<number, SameToolStreakContext>();
  for (const span of spans) {
    const context = contextForSameToolStreakSpan(span);
    if (context) {
      contexts.set(span.event_id, context);
    }
  }
  return contexts;
}

export function sameToolStreakExplanation(context: SameToolStreakContext): string {
  return `${context.toolName} appears ${context.count} times consecutively on the main thread; this event is ${context.position} of ${context.count} in events ${context.startEventId}-${context.endEventId}.`;
}
