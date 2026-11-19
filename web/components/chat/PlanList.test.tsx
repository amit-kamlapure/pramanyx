// @vitest-environment jsdom
/** The plan of a request with several parts, above the work: each step in the person's words, ticked as it is done. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlanList } from "@/components/chat/PlanList";

describe("the plan of a request", () => {
  it("says each step and how many are done, and draws nothing for a single question", () => {
    const { container, rerender } = render(<PlanList steps={[
      { text: "Find out why revenue dropped", done: true }, { text: "Draft a monitoring dashboard", done: false },
      { text: "Set an alert for the team", done: false }]} />);
    expect(screen.getByTestId("turn-plan")).toHaveTextContent("The plan · 1 of 3 done");
    expect(screen.getAllByTestId("turn-plan-step").map(s => s.hasAttribute("data-done"))).toEqual([true, false, false]);
    rerender(<PlanList steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
