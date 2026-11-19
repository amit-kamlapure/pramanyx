// @vitest-environment jsdom
/** A pane folded from its own divider (the user, 2026-11-19, of a peer product's editor): a round chevron on the divider folds
 *  it away, and a slim strip with the same chevron brings it back; both panes stay mounted. */
import { fireEvent, render, screen } from "@/lib/testing";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ResizableSplit } from "@/components/ResizableSplit";

function Folding() {
  const [shut, setShut] = useState(false);
  return (
    <ResizableSplit storageKey="t.fold" collapsed={shut} collapsible={{ onToggle: () => setShut(v => !v), name: "the catalog" }}
      left={<div data-testid="left">Catalog</div>} right={<div data-testid="right">Editor</div>} />
  );
}

describe("a pane folded from its divider", () => {
  it("folds away from the divider's chevron and comes back from the strip's, staying mounted", () => {
    render(<Folding />);
    fireEvent.click(screen.getByRole("button", { name: "Hide the catalog" }));
    expect(screen.getByTestId("left")).not.toBeVisible();
    expect(screen.getByTestId("split-unfold-strip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the catalog" }));
    expect(screen.getByTestId("left")).toBeVisible();
    expect(screen.queryByTestId("split-unfold-strip")).toBeNull();
  });
});
