/**
 * A segmented choice: an option whose value is empty ("Plain", "Auto", "Everything") can be chosen like any other, and
 * pressing the chosen one again changes nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/lib/testing";

import { Segmented } from "@/components/ui/segmented";

const OPTIONS = [{ value: "", label: "Plain" }, { value: "bar", label: "Bar" }] as const;
const press = (name: string) => {
  const item = screen.getByRole("radio", { name });
  fireEvent.mouseDown(item, { button: 0 });
  fireEvent.click(item);
  return item;
};

describe("a segmented choice", () => {
  it("chooses an option whose value is empty, and shows it chosen", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Segmented label="Look" value="bar" options={OPTIONS} onChange={onChange} />);
    press("Plain");
    expect(onChange).toHaveBeenCalledWith("");
    rerender(<Segmented label="Look" value="" options={OPTIONS} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Plain" })).toHaveAttribute("aria-checked", "true");
  });

  it("changes nothing when the chosen one is pressed again", () => {
    const onChange = vi.fn();
    render(<Segmented label="Look" value="" options={OPTIONS} onChange={onChange} />);
    press("Plain");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows none chosen when the value is empty and no option is", () => {
    render(<Segmented label="Range" value="" options={[{ value: "1h", label: "1h" }, { value: "24h", label: "24h" }]} onChange={() => {}} />);
    for (const name of ["1h", "24h"]) expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false");
  });
});
