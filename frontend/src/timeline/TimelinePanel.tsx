import React from "react";
import { Bot, User, Wrench, AlertTriangle } from "lucide-react";
import type { TimelineItem } from "../api/types";
import { groupTurns } from "../trace/useTurns";
import type { Turn } from "../trace/useTurns";
import type { SameToolStreakContext } from "../trace/loopContext";
import { sameToolStreakExplanation } from "../trace/loopContext";
import { isErrorItem } from "../session/sessionAnalytics";
import { Blurred } from "../shell/Blurred";

interface Props {
  items: TimelineItem[];
  selectedEventId: number | null;
  sameToolStreakContexts?: Map<number, SameToolStreakContext>;
  onSelect: (eventId: number) => void;
}

const COLLAPSE_THRESHOLD = 5;
const COLLAPSED_VISIBLE = 3;

function TimelinePanel({
  items,
  selectedEventId,
  sameToolStreakContexts,
  onSelect,
}: Props) {
  const selectedButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const timelineListRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (selectedEventId === null) return;
    const selected = selectedButtonRef.current;
    const list = timelineListRef.current;
    if (!selected || !list) return;
    const selectedRect = selected.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (selectedRect.top < listRect.top) {
      list.scrollTop -= listRect.top - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom) {
      list.scrollTop += selectedRect.bottom - listRect.bottom;
    }
  }, [selectedEventId]);

  const turns = React.useMemo(() => groupTurns(items), [items]);

  return (
    <aside className="timeline-panel">
      <div className="panel-header">
        <h2>Event Timeline</h2>
      </div>
      <div ref={timelineListRef} className="timeline-list">
        {turns.map((turn) => (
          <TurnGroup
            key={turn.id}
            turn={turn}
            sameToolStreakContexts={sameToolStreakContexts}
            selectedEventId={selectedEventId}
            selectedButtonRef={selectedButtonRef}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}

function TurnGroup({
  turn,
  sameToolStreakContexts,
  selectedEventId,
  selectedButtonRef,
  onSelect,
}: {
  turn: Turn;
  sameToolStreakContexts?: Map<number, SameToolStreakContext>;
  selectedEventId: number | null;
  selectedButtonRef: React.MutableRefObject<HTMLButtonElement | null>;
  onSelect: (eventId: number) => void;
}) {
  // A turn starts expanded when it has few events, or contains an error/streak.
  const hasAttention = React.useMemo(
    () => turn.items.some((item) => isErrorItem(item) || sameToolStreakContexts?.has(item.event_id)),
    [turn.items, sameToolStreakContexts],
  );
  const collapsible = turn.items.length > COLLAPSE_THRESHOLD && !hasAttention;
  const [expanded, setExpanded] = React.useState(!collapsible);

  // Auto-expand when the active selection lands on a hidden event in this group.
  const selectedInGroup =
    selectedEventId !== null && turn.items.some((item) => item.event_id === selectedEventId);
  React.useEffect(() => {
    if (selectedInGroup) setExpanded(true);
  }, [selectedInGroup]);

  const visible = collapsible && !expanded ? turn.items.slice(0, COLLAPSED_VISIBLE) : turn.items;
  const hiddenCount = turn.items.length - visible.length;

  return (
    <details open className="turn-group">
      <summary><Blurred>{turn.title}</Blurred></summary>
      <ol>
        {visible.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            sameToolStreakContext={sameToolStreakContexts?.get(item.event_id)}
            selected={selectedEventId === item.event_id}
            selectedButtonRef={selectedButtonRef}
            onSelect={onSelect}
          />
        ))}
      </ol>
      {hiddenCount > 0 && (
        <button type="button" className="turn-show-more" onClick={() => setExpanded(true)}>
          show {hiddenCount} more
        </button>
      )}
    </details>
  );
}

function TimelineRow({
  item,
  sameToolStreakContext,
  selected,
  selectedButtonRef,
  onSelect,
}: {
  item: TimelineItem;
  sameToolStreakContext?: SameToolStreakContext;
  selected: boolean;
  selectedButtonRef: React.MutableRefObject<HTMLButtonElement | null>;
  onSelect: (eventId: number) => void;
}) {
  return (
    <li>
      <button
        ref={selected ? selectedButtonRef : null}
        className={`${selected ? "selected " : ""}kind-${item.kind}`}
        onClick={() => onSelect(item.event_id)}
      >
        {iconForItem(item)}
        <span>
          <strong><Blurred>{item.title}</Blurred></strong>
          {sameToolStreakContext && (
            <span className="timeline-streak-badge" title={sameToolStreakExplanation(sameToolStreakContext)}>
              Same-tool streak {sameToolStreakContext.position}/{sameToolStreakContext.count}
            </span>
          )}
          <small>{item.timestamp ? new Date(item.timestamp).toLocaleString() : item.event_type}</small>
          {item.preview && <em><Blurred>{item.preview}</Blurred></em>}
        </span>
      </button>
    </li>
  );
}

function iconForItem(item: TimelineItem) {
  if (item.kind === "user_turn") return <User size={15} />;
  if (item.kind === "tool_call" || item.kind === "tool_result") return <Wrench size={15} />;
  if (item.kind === "subagent_event") return <Bot size={15} />;
  if (item.kind === "system") return <AlertTriangle size={15} />;
  return <Bot size={15} />;
}

export default TimelinePanel;
