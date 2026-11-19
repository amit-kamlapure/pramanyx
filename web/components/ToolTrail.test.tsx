// @vitest-environment jsdom
/**
 * The steps a conversation took, said plainly (2026-11-20): a step that said no reads as "said no" with its reason, apart
 * from a step that failed; each of the Ask panel's own abilities has its plain name.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolTrail } from "./ToolTrail";

describe("the step trail", () => {
  it("names the panel's own steps, and tells a refusal from a failure", () => {
    render(<ToolTrail steps={[
      { index: 1, tool: "change_chart", ok: true, refused: true, detail: "Line width is a whole number from 1 to 6.", resultChars: 0 },
      { index: 2, tool: "run_sql", ok: false, detail: "timeout", resultChars: 0 },
      { index: 3, tool: "explain_dashboard", ok: true, detail: "", resultChars: 0 },
    ]} />);
    fireEvent.click(screen.getByText("3 steps taken"));
    expect(screen.getByText("Proposed a change to how the chart is drawn")).toBeInTheDocument();
    expect(screen.getByText("said no — Line width is a whole number from 1 to 6.")).toBeInTheDocument();
    expect(screen.getByText("Read the dashboard")).toBeInTheDocument();
    expect(screen.getAllByTestId("step-refused")).toHaveLength(1);
    expect(screen.getAllByTestId("step-failed")).toHaveLength(1);
  });
});
