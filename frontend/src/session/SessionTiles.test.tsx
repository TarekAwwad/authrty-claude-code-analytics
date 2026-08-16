import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionCard, Subagent, ToolActivity } from "../api/types";
import SessionInsightStrip from "./SessionInsightStrip";
import ToolUsageTile from "./ToolUsageTile";
import SubagentHeatTile from "./SubagentHeatTile";

const baseSession: SessionCard = {
  id: 1, project_id: 1, project_name: "ccfr", session_id: "s-1", title: "Debug loop",
  first_ts: "2026-06-03T10:00:00Z", last_ts: "2026-06-03T10:22:00Z", cwd: "~/p/ccfr",
  version: "1.2.3", entrypoint: "$ claude", git_branch: "feat/cost-analytics",
  event_count: 50, turn_count: 4, tool_call_count: 10, subagent_count: 2, error_count: 3,
  system_count: 3, persisted_output_count: 0, input_tokens: 1000, output_tokens: 500,
  duration_seconds: 1320, max_agent_events: 100,
  finding_count: 1, top_finding_title: null, top_finding_basis: null,
  cost_usd: 0.48, cost_available: true,
};

describe("SessionInsightStrip", () => {
  it("renders evidence-based headline facts without risk or loop scores", () => {
    render(<SessionInsightStrip session={baseSession} />);
    expect(screen.getByText("Estimated API-equivalent cost")).toBeInTheDocument();
    expect(screen.getByText("$0.48")).toBeInTheDocument();
    expect(screen.getByText("Turns")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Session span")).toBeInTheDocument();
    expect(screen.getByText("22 min")).toBeInTheDocument();
    expect(screen.getByText("Observed errors")).toBeInTheDocument();
    expect(screen.queryByText("Max loop")).not.toBeInTheDocument();
    expect(screen.queryByText("Risk score")).not.toBeInTheDocument();
  });
});

describe("ToolUsageTile", () => {
  it("visualizes receipt-derived calls, errors, and result sizes without a raw table or tool cost", () => {
    const activity: ToolActivity[] = [
      {
        tool_name: "Read",
        call_count: 3,
        error_count: 1,
        observed_result_bytes: 2048,
        persisted_result_bytes: 8192,
      },
      {
        tool_name: "Bash",
        call_count: 1,
        error_count: 0,
        observed_result_bytes: 128,
        persisted_result_bytes: 0,
      },
    ];
    const { container } = render(<ToolUsageTile activity={activity} />);

    expect(screen.getByRole("heading", { name: "Tool activity" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const legend = screen.getByRole("group", { name: "Tool activity legend" });
    expect(legend).toHaveTextContent("Successful calls");
    expect(legend).toHaveTextContent("Errors");
    expect(container.querySelectorAll(".tool-activity-bar")).toHaveLength(2);
    expect(screen.getByText("Read")).toBeInTheDocument();
    const readRow = screen.getByText("Read").closest(".tool-activity-row");
    expect(readRow).toHaveTextContent("3 calls");
    expect(readRow).toHaveTextContent("1 error");
    const readBar = readRow?.querySelector(".tool-activity-bar");
    expect(readBar).toHaveAttribute("role", "img");
    expect(readBar).toHaveAttribute("aria-label", "3 calls: 2 successful, 1 error");
    expect(readBar?.querySelector(".tool-activity-bar-success")).toHaveStyle({ width: "66.66666666666667%" });
    expect(readBar?.querySelector(".tool-activity-bar-error")).toHaveStyle({ width: "33.33333333333333%" });
    expect(readBar?.querySelector(".tool-activity-bar-success")).toBeEmptyDOMElement();
    expect(readBar?.querySelector(".tool-activity-bar-error")).toBeEmptyDOMElement();
    const bashRow = screen.getByText("Bash").closest(".tool-activity-row");
    expect(bashRow).toHaveTextContent("1 call");
    expect(bashRow).toHaveTextContent("0 errors");
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("8.0 KB")).toBeInTheDocument();
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
  });

  it("pins erroring tools and aggregates the long tail", () => {
    const activity: ToolActivity[] = [
      { tool_name: "Read", call_count: 30, error_count: 0, observed_result_bytes: 3000, persisted_result_bytes: 0 },
      { tool_name: "Bash", call_count: 20, error_count: 0, observed_result_bytes: 2000, persisted_result_bytes: 0 },
      { tool_name: "Write", call_count: 10, error_count: 0, observed_result_bytes: 1000, persisted_result_bytes: 0 },
      { tool_name: "Glob", call_count: 9, error_count: 0, observed_result_bytes: 900, persisted_result_bytes: 0 },
      { tool_name: "Grep", call_count: 8, error_count: 0, observed_result_bytes: 800, persisted_result_bytes: 0 },
      { tool_name: "Agent", call_count: 7, error_count: 0, observed_result_bytes: 700, persisted_result_bytes: 0 },
      { tool_name: "WebFetch", call_count: 6, error_count: 0, observed_result_bytes: 600, persisted_result_bytes: 0 },
      { tool_name: "Notebook", call_count: 5, error_count: 0, observed_result_bytes: 500, persisted_result_bytes: 0 },
      { tool_name: "RareTool", call_count: 1, error_count: 1, observed_result_bytes: 100, persisted_result_bytes: 0 },
    ];

    render(<ToolUsageTile activity={activity} />);

    expect(screen.getByText("RareTool")).toBeInTheDocument();
    expect(screen.getByText("Other · 2 tools")).toBeInTheDocument();
    expect(screen.queryByText("WebFetch")).not.toBeInTheDocument();
    expect(screen.queryByText("Notebook")).not.toBeInTheDocument();
  });

  it("shows an empty state with no tool calls", () => {
    render(<ToolUsageTile activity={[]} />);
    expect(screen.getByText("No tool calls")).toBeInTheDocument();
  });
});

describe("SubagentHeatTile", () => {
  it("shows a compact heatmap and reveals receipts below the grid on selection", () => {
    const subagents: Subagent[] = [
      {
        id: 1, agent_id: "a1", agent_type: "Explore", description: null, name: "Researcher", tool_use_id: "tool-1",
        event_count: 180, first_ts: "2026-06-03T10:10:00Z", last_ts: "2026-06-03T10:20:00Z",
        input_tokens: 1000, output_tokens: 250, error_count: 2, api_equivalent_usd: 0.5,
        cost_available: true, unpriced_models: ["custom-model"],
      },
      {
        id: 2, agent_id: "a2", agent_type: "Plan", description: null, name: null, tool_use_id: "tool-2",
        event_count: 60, first_ts: "2026-06-03T10:00:00Z", last_ts: "2026-06-03T10:05:00Z",
        input_tokens: 1200, output_tokens: 300, error_count: 1, api_equivalent_usd: 1.25,
        cost_available: true, unpriced_models: [],
      },
    ];
    const firstEventIds = new Map([["a1", 52], ["a2", 42]]);
    const onSelectSubagent = vi.fn();

    const { container } = render(
      <SubagentHeatTile
        subagents={subagents}
        firstEventIds={firstEventIds}
        onSelectSubagent={onSelectSubagent}
      />,
    );

    expect(screen.getByRole("heading", { name: "Subagents - 2" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".heat-cell")).toHaveLength(2);
    expect(container.querySelector(".heat-cell.lvl-3")).not.toBeNull();
    expect(container.querySelector(".heat-cell.lvl-2")).not.toBeNull();
    expect(container.querySelector(".subagent-activity-lane")).toBeNull();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.queryByText("240 recorded events")).not.toBeInTheDocument();
    const metricControl = screen.getByRole("radiogroup", { name: "Heatmap metric" });
    expect(screen.getByRole("heading", { name: "Subagents - 2" }).closest(".session-visual-heading"))
      .toContainElement(metricControl);
    expect(screen.getByText("Select an agent to inspect its receipts")).toBeInTheDocument();
    expect(screen.queryByText("1,500 tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("$1.25 direct cost")).not.toBeInTheDocument();

    const lane = screen.getByRole("button", { name: "Select A1 Plan subagent" });
    fireEvent.click(lane);

    expect(lane).toHaveAttribute("aria-pressed", "true");
    expect(lane.querySelector(".heat-selection-marker")).not.toBeNull();
    expect(container.querySelectorAll(".heat-selection-marker")).toHaveLength(1);
    expect(onSelectSubagent).not.toHaveBeenCalled();
    const details = screen.getByRole("region", { name: "A1 subagent details" });
    expect(details).toHaveTextContent("Observed subagent receipts");
    expect(screen.getByText("1,500 tokens")).toBeInTheDocument();
    expect(screen.getByText("$1.25 direct cost")).toBeInTheDocument();
    expect(screen.getByText("1 error")).toBeInTheDocument();
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(container.querySelector(".agent-heat")?.lastElementChild).toBe(details);

    fireEvent.click(screen.getByRole("button", { name: "Inspect A1 first event" }));
    expect(onSelectSubagent).toHaveBeenCalledWith("a2");

    fireEvent.click(screen.getByRole("button", { name: "Select A2 Explore subagent" }));
    expect(screen.getByText("$0.50 priced; custom-model unpriced")).toBeInTheDocument();
  });

  it("keeps large agent sets compact without recreating timeline lanes", () => {
    const subagents: Subagent[] = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      agent_id: `agent-${index + 1}`,
      agent_type: "Explore",
      description: null,
      name: null,
      tool_use_id: null,
      event_count: 1,
      first_ts: `2026-06-03T10:${String(index).padStart(2, "0")}:00Z`,
      last_ts: `2026-06-03T10:${String(index).padStart(2, "0")}:30Z`,
      input_tokens: 10,
      output_tokens: 5,
      error_count: 0,
      api_equivalent_usd: 0.01,
      cost_available: true,
      unpriced_models: [],
    }));

    const { container } = render(<SubagentHeatTile subagents={subagents} />);

    expect(container.querySelectorAll(".heat-cell")).toHaveLength(20);
    expect(container.querySelector(".subagent-lanes-viewport")).toBeNull();
    expect(container.querySelector(".subagent-activity-bin")).toBeNull();
  });

  it("recalculates heat by events, errors, elapsed span, or cost", () => {
    const subagents: Subagent[] = [
      {
        id: 1, agent_id: "a1", agent_type: "Explore", description: null, name: null, tool_use_id: null,
        event_count: 100, first_ts: "2026-06-03T10:00:00Z", last_ts: "2026-06-03T10:10:00Z",
        input_tokens: 100, output_tokens: 10, error_count: 0, api_equivalent_usd: 0.1,
        cost_available: true, unpriced_models: [],
      },
      {
        id: 2, agent_id: "a2", agent_type: "Plan", description: null, name: null, tool_use_id: null,
        event_count: 10, first_ts: "2026-06-03T10:00:00Z", last_ts: "2026-06-03T10:01:00Z",
        input_tokens: 100, output_tokens: 10, error_count: 5, api_equivalent_usd: 2,
        cost_available: true, unpriced_models: [],
      },
    ];

    render(<SubagentHeatTile subagents={subagents} />);
    const a1 = screen.getByRole("button", { name: "Select A1 Explore subagent" });
    const a2 = screen.getByRole("button", { name: "Select A2 Plan subagent" });

    expect(screen.getByRole("radiogroup", { name: "Heatmap metric" })).toHaveTextContent("Color by");
    expect(screen.getByRole("radio", { name: "Events" })).toHaveAttribute("aria-checked", "true");
    expect(a1).toHaveClass("lvl-3");
    expect(a2).toHaveClass("lvl-1");

    fireEvent.click(screen.getByRole("radio", { name: "Errors" }));
    expect(a1).toHaveClass("lvl-0");
    expect(a2).toHaveClass("lvl-3");

    fireEvent.click(screen.getByRole("radio", { name: "Elapsed span" }));
    expect(a1).toHaveClass("lvl-3");
    expect(a2).toHaveClass("lvl-1");

    fireEvent.click(screen.getByRole("radio", { name: "Cost" }));
    expect(a1).toHaveClass("lvl-1");
    expect(a2).toHaveClass("lvl-3");
    expect(screen.getByText("Relative estimated API-equivalent cost")).toBeInTheDocument();
  });

  it("handles zero-subagent and fully unpriced states explicitly", () => {
    const { rerender } = render(<SubagentHeatTile subagents={[]} />);
    expect(screen.getByText("No subagent activity")).toBeInTheDocument();

    rerender(
      <SubagentHeatTile
        subagents={[{
          id: 3, agent_id: "a3", agent_type: null, description: null, name: null, tool_use_id: null,
          event_count: 1, first_ts: null, last_ts: null, input_tokens: 100, output_tokens: 10,
          error_count: 0, api_equivalent_usd: 0, cost_available: true, unpriced_models: ["unknown-model"],
        }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select A1 Unknown subagent" }));
    expect(screen.getByText("Unpriced: unknown-model")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Cost" }));
    expect(screen.getByRole("button", { name: "Select A1 Unknown subagent" }))
      .toHaveAttribute("data-heat-value", "unavailable");
    expect(screen.getByRole("button", { name: "Select A1 Unknown subagent" })).toHaveClass("lvl-0");
  });
});
