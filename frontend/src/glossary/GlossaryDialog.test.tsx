import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GlossaryDialog from "./GlossaryDialog";
import { GLOSSARY_TERMS } from "./glossaryTerms";

describe("GlossaryDialog", () => {
  it("renders the default Structure tab with a sample term and its definition", () => {
    render(<GlossaryDialog open onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Glossary" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Subagent")).toBeInTheDocument();
    expect(
      screen.getByText(/secondary agent the main thread spawns/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Memory")).not.toBeInTheDocument();
    expect(screen.queryByText(/memory file/i)).not.toBeInTheDocument();
  });

  it("switches to the Evidence tab and explains the four evidence bases", () => {
    render(<GlossaryDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));

    for (const term of ["Observed", "Estimated", "Inferred", "Associated"]) {
      expect(screen.getByText(term)).toBeInTheDocument();
    }
    expect(screen.getByText(/not a causal conclusion/i)).toBeInTheDocument();
    expect(screen.queryByText("Subagent")).not.toBeInTheDocument();
  });

  it("defines every retained analytical term using current language", () => {
    const terms = new Set(GLOSSARY_TERMS.map((entry) => entry.term));

    for (const term of [
      "Same-tool streak",
      "Estimated context opportunity",
      "Estimated API-equivalent cost",
      "Observed hit-level percentile",
    ]) {
      expect(terms).toContain(term);
    }
  });

  it("does not document removed scores, loop metrics, or cap claims", () => {
    const terms = GLOSSARY_TERMS.map((entry) => entry.term);
    const glossaryCopy = GLOSSARY_TERMS
      .flatMap((entry) => [entry.term, entry.definition, ...(entry.detail ?? [])])
      .join(" ");

    expect(terms).not.toContain("Risk score");
    expect(terms).not.toContain("Max loop");
    expect(terms).not.toContain("Necessary cost");
    expect(glossaryCopy).not.toMatch(/risk(?:y)? pattern|headroom|comfortably dimensioned/i);
  });

  it("shows the Usage Mindmap phase/habit terms on the Workflow tab", () => {
    render(<GlossaryDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Workflow" }));

    // The phase term and its list of the seven phases are shown.
    expect(screen.getByText("Workflow phase")).toBeInTheDocument();
    expect(screen.getByText(/Synthesize/)).toBeInTheDocument();
    // The distinction entry that the per-node tooltips never spell out.
    expect(screen.getByText("Phase vs. habit")).toBeInTheDocument();
    // Evidence-only terms are not rendered in the active panel.
    expect(screen.queryByText("Risk score")).not.toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<GlossaryDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /close glossary/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the dialog emits a native close event (Esc / backdrop)", () => {
    const onClose = vi.fn();
    render(<GlossaryDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /close glossary/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
