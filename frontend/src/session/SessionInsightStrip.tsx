import type { SessionCard } from "../api/types";

interface Props {
  session: SessionCard;
  costUsd?: number;
  costAvailable?: boolean;
}

function formatSpan(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

// Receipt-backed headline facts. `duration_seconds` is first-to-last event
// span, so the UI labels it as session span rather than active work time.
export default function SessionInsightStrip({ session, costUsd, costAvailable }: Props) {
  const resolvedCost = costUsd ?? session.cost_usd;
  const resolvedCostAvailable = costAvailable ?? session.cost_available;
  return (
    <div className="cost-insight-strip session-insight-strip" aria-label="Session insights">
      <div className="cost-insight">
        <span>Estimated API-equivalent cost</span>
        <b>{resolvedCostAvailable ? `$${resolvedCost.toFixed(2)}` : "Unavailable"}</b>
        <small>priced model receipts</small>
      </div>
      <div className="cost-insight">
        <span>Turns</span>
        <b>{session.turn_count.toLocaleString()}</b>
        <small>user turns observed</small>
      </div>
      <div className="cost-insight">
        <span>Session span</span>
        <b>{formatSpan(session.duration_seconds)}</b>
        <small>first to last event</small>
      </div>
      <div className="cost-insight">
        <span>Observed errors</span>
        <b>{session.error_count.toLocaleString()}</b>
        <small>tool-result errors</small>
      </div>
    </div>
  );
}
