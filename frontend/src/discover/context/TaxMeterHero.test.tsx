import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import TaxMeterHero from "./TaxMeterHero";
import type { ContextArchetype, ContextEconomicsMeta } from "../../api/types";

const archetypes: ContextArchetype[] = [
  {
    key: "oversized",
    title: "Oversized tool results",
    description: "",
    recommendation: "",
    meets_support: true,
    findings_count: 3,
    savings_usd: 12,
    savings_tokens: 1_000_000,
    thresholds: [],
    exemplar: null,
    findings: [],
  },
];

function meta(overrides: Partial<ContextEconomicsMeta> = {}): ContextEconomicsMeta {
  return {
    project_id: null,
    min_support: 3,
    recorded_api_equivalent_usd: 100,
    opportunity_usd: 12,
    unattributed_usd: 88,
    opportunity_tokens: 1_000_000,
    cost_available: true,
    costs_partial: false,
    unpriced_models: [],
    sessions_analyzed: 10,
    sessions_skipped: 0,
    trend: [],
    ...overrides,
  };
}

describe("TaxMeterHero opportunity framing", () => {
  it("shows the complete-priced opportunity without claiming token usage share", () => {
    render(<TaxMeterHero meta={meta()} archetypes={archetypes} />);

    expect(screen.getByText("Estimated context opportunity")).toBeInTheDocument();
    expect(screen.getByText("Recorded estimated API-equivalent cost")).toBeInTheDocument();
    expect(screen.getAllByText("Cost not attributed to detected opportunities").length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText(/\$12\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1\.0M tok modeled opportunity/)).toBeInTheDocument();
    expect(screen.getByText(/\(12%\)/)).toBeInTheDocument();
    expect(screen.queryByText(/of your usage/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/of your limit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Necessary$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Avoidable/i)).not.toBeInTheDocument();
  });

  it("hides proportional claims when pricing is partial", () => {
    render(
      <TaxMeterHero
        meta={meta({ costs_partial: true, unpriced_models: ["custom-model"] })}
        archetypes={archetypes}
      />,
    );

    expect(screen.getByText("Estimated context opportunity")).toBeInTheDocument();
    expect(screen.getAllByText("≥$12.00").length).toBeGreaterThan(0);
    expect(screen.getByText("≥$100")).toBeInTheDocument();
    expect(screen.queryByText(/\(12%\)/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /opportunity breakdown/i })).not.toBeInTheDocument();
  });

  it("uses absolute opportunity tokens when pricing is unavailable", () => {
    render(
      <TaxMeterHero
        meta={meta({
          cost_available: false,
          recorded_api_equivalent_usd: 0,
          opportunity_usd: 0,
          unattributed_usd: 0,
          unpriced_models: ["claude-sonnet-4-6"],
        })}
        archetypes={archetypes}
      />,
    );

    expect(screen.getByText("Estimated context opportunity")).toBeInTheDocument();
    expect(screen.getAllByText(/1\.0M tok/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/% of your usage/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /estimated context opportunity breakdown/i }))
      .toBeInTheDocument();
  });
});
