// @vitest-environment jsdom

/** The logo is drawn from the supplied artwork, and its colours stay an edge. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PramanyxMark, PramanyxName, brandEdge } from "@/components/ui/brand";
import { MARK_BOX, MARK_RING_COLORS, NAME_BOX } from "@/components/ui/brandArt";

describe("the logo", () => {
  it("draws the mark at the artwork's proportions, with its whole ring", () => {
    const { container } = render(<PramanyxMark size={40} label="Pramanyx" />);
    const svg = screen.getByRole("img", { name: "Pramanyx" });
    expect(svg.getAttribute("height")).toBe("40");
    expect(svg.getAttribute("width")).toBe(String(Math.round((40 * MARK_BOX.w) / MARK_BOX.h)));
    expect(container.querySelectorAll('[data-testid="brand-ring"]')).toHaveLength(MARK_RING_COLORS.length);
  });

  it("names itself, at the artwork's proportions", () => {
    render(<PramanyxName height={20} />);
    expect(screen.getByRole("img", { name: "Pramanyx" }).getAttribute("width")).toBe(String(Math.round((20 * NAME_BOX.w) / NAME_BOX.h)));
  });

  it("keeps the surface's own ground inside a brand edge", () => {
    const edge = brandEdge("var(--bg-2)");
    expect(edge.border).toBe("1.5px solid transparent");
    expect(edge.background).toContain("linear-gradient(var(--bg-2), var(--bg-2)) padding-box");
  });
});
