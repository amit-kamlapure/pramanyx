// @vitest-environment jsdom
/** Choosing a glyph from a dropdown (2026-11-25): a button shows the one chosen; the list it opens is searched by name
 *  or by what a glyph is about, browsed in groups, walked with the arrow keys; a pick closes it. */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { IconPicker } from "@/components/ui/icon-picker";
import type { IconName } from "@/components/ui/icon";
import { AREA_ICON_PICKER, findAreaIcons } from "@/lib/areaIcons";
import { fireEvent, render, screen, waitFor } from "@/lib/testing";

function Picker({ start = "cart" as IconName, onChange = vi.fn() }) {
  const [v, setV] = useState<IconName>(start);
  return <IconPicker value={v} onChange={(n) => { setV(n); onChange(n); }} groups={AREA_ICON_PICKER} find={findAreaIcons}
    label="Its icon" testId="pick" />;
}

describe("the icon dropdown", () => {
  it("shows the glyph chosen, opens on the groups, and a pick closes it", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Its icon: cart" }));
    expect(await screen.findByText("Sales and retail")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "cart" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("radio").length).toBeGreaterThanOrEqual(80);
    fireEvent.click(screen.getByRole("radio", { name: "warehouse" }));
    expect(onChange).toHaveBeenCalledWith("warehouse");
    await waitFor(() => expect(screen.queryByRole("radio", { name: "cart" })).toBeNull());
    expect(screen.getByRole("button", { name: "Its icon: warehouse" })).toBeTruthy();
  });

  it("finds a glyph by what it is about, says when nothing is, and Enter takes the one found", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Its icon: cart" }));
    const search = await screen.findByLabelText("Search icons");
    fireEvent.change(search, { target: { value: "shipping" } });
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["truck", "ship"]);
    expect(screen.queryByText("Sales and retail")).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(/No icon by that name/)).toBeTruthy();
    fireEvent.change(search, { target: { value: "forklift" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("forklift");
  });

  it("walks the grid with the arrow keys, a row at a time up and down", async () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Its icon: cart" }));
    const search = await screen.findByLabelText("Search icons");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("cart");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("bag");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(AREA_ICON_PICKER[0].icons[9]);
  });
});
