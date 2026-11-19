// @vitest-environment jsdom

/** The logo is drawn from the supplied artwork, and its colours stay an edge. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PramanyxLogo, PramanyxMark, PramanyxName, brandEdge } from "@/components/ui/brand";
import { MARK_BOX, MARK_RING_COLORS, NAME_BASELINE, NAME_BOX } from "@/components/ui/brandArt";

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

  it("stands the mark on the name's baseline, as tall as the name (the user, 2026-11-19)", () => {
    render(<PramanyxLogo height={18} />);
    const mark = screen.getByTestId("brand-logo-mark");
    // the foot of the y lies under the baseline; the mark is raised by exactly that much, so its foot and the letters' meet
    const foot = (18 * (NAME_BOX.h - NAME_BASELINE)) / NAME_BOX.h;
    expect(parseFloat(mark.style.marginBottom)).toBeCloseTo(foot, 1);
    expect(screen.getByTestId("brand-logo").style.alignItems).toBe("flex-end");
    expect(mark.querySelector("svg")?.getAttribute("height")).toBe("18");
  });

  it("keeps the surface's own ground inside a brand edge", () => {
    const edge = brandEdge("var(--bg-2)");
    expect(edge.border).toBe("1.5px solid transparent");
    expect(edge.background).toContain("linear-gradient(var(--bg-2), var(--bg-2)) padding-box");
  });
});
