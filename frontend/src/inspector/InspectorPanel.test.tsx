import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InspectorPanel from "./InspectorPanel";
import type { EventDetail, SessionCard, SessionFinding, Subagent } from "../api/types";

const session = { event_count: 10, tool_call_count: 2, subagent_count: 1, error_count: 0, system_count: 0,
  session_id: "s1", title: "Sess" } as unknown as SessionCard;

const event = { type: "tool_call", role: "assistant", timestamp: "2026-01-01T00:00:00Z",
  source_path: "x.jsonl", line_no: 5, agent_id: null, text_preview: "hi",
  tool_calls: [], tool_results: [], related_event_ids: [7, 9], raw_json: { a: 1 } } as unknown as EventDetail;

const subagents = [{ id: 1, agent_type: "explore", event_count: 12, description: "find things", name: null, agent_id: "ag1" }] as unknown as Subagent[];
const findings = [{
  id: 1,
  session_id: 1,
  detector_key: "repeated_identical_failure",
  basis: "observed",
  category: "execution_failure",
  title: "Repeated identical failure",
  explanation: "The same command failed twice with the same error.",
  recommendation: "Inspect the first failure before retrying again.",
  start_event_id: 10,
  end_event_id: 12,
  evidence_event_ids: [10, 12],
  evidence: { event_ids: [10, 12], tool_name: "Bash" },
}] satisfies SessionFinding[];

describe("InspectorPanel tabs", () => {
  it("shows the Event tab by default and switches to Subagents", () => {
    render(<InspectorPanel session={session} event={event} subagents={subagents} loading={false} />);

    expect(screen.getByText("tool_call")).toBeInTheDocument();
    expect(screen.queryByText("find things")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Subagents" }));

    expect(screen.getByText("find things")).toBeInTheDocument();
    expect(screen.queryByText("tool_call")).not.toBeInTheDocument();
  });

  it("shows retrospective evidence without stale recommendations", () => {
    const onSelectEvent = vi.fn();
    render(
      <InspectorPanel
        session={session}
        event={event}
        subagents={subagents}
        findings={findings}
        loading={false}
        onSelectEvent={onSelectEvent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Findings" }));

    expect(screen.getByText("Repeated identical failure")).toBeInTheDocument();
    expect(screen.getByText("Basis: Observed")).toBeInTheDocument();
    expect(screen.queryByText("Recommended next step")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect the first failure before retrying again.")).not.toBeInTheDocument();
    expect(screen.queryByText(/score 4\.2/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lift/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/support/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Evidence event 10" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Evidence event 12" }));
    expect(onSelectEvent).toHaveBeenCalledWith(12);
    expect(screen.getByText("tool_call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Event" })).toHaveClass("on");
  });

  it("links related evidence and keeps source metadata and raw JSON in Advanced", () => {
    const onSelectEvent = vi.fn();
    render(
      <InspectorPanel
        session={session}
        event={event}
        subagents={subagents}
        loading={false}
        onSelectEvent={onSelectEvent}
      />,
    );

    const advanced = screen.getByText("Advanced").closest("details");
    expect(advanced).not.toHaveAttribute("open");
    expect(advanced).toHaveTextContent("x.jsonl");
    expect(advanced).toHaveTextContent('"a": 1');

    fireEvent.click(screen.getByRole("button", { name: "Related event 9" }));
    expect(onSelectEvent).toHaveBeenCalledWith(9);
  });

  it("uses neutral same-tool streak wording and a score-free empty finding state", () => {
    render(
      <InspectorPanel
        session={session}
        event={event}
        subagents={subagents}
        sameToolStreakContext={{
          eventId: 7,
          runId: "run-1",
          toolName: "Read",
          position: 2,
          count: 3,
          startEventId: 5,
          endEventId: 9,
        }}
        loading={false}
      />,
    );

    expect(screen.getByText("Same-tool streak")).toBeInTheDocument();
    expect(screen.getByText(/Read appears 3 times consecutively/)).toBeInTheDocument();
    expect(screen.queryByText(/loop evidence/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    expect(screen.getByText("No supported findings detected.")).toBeInTheDocument();
    expect(screen.queryByText(/risk pattern/i)).not.toBeInTheDocument();
  });
});
