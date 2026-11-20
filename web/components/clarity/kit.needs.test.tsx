// @vitest-environment jsdom

/**
 * "Needs you" can be dismissed (the user, 2026-11-20: "Add dismiss button to 'Needs you'"). Dismissed, it folds to one
 * line that says what it holds and Show — withheld is said, never implied — and it comes back by itself the moment
 * something new waits (or a day passes). Remembered in this browser per section, as a convenience, never a record.
 */
import { Theme } from "@radix-ui/themes";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEEDS_HIDDEN_FOR_MS, NeedsRow, NeedsYou } from "@/components/clarity/kit";

const rows = (ids: string[]) => ids.map(id => <NeedsRow key={id} title={`Row ${id}`} testId={`row-${id}`} />);
const show = (ids: string[], testId = "page-needs") =>
  render(<Theme><NeedsYou testId={testId} empty="Nothing needs you">{rows(ids)}</NeedsYou></Theme>);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("dismissing Needs you", () => {
  it("folds to one line that says how many wait, and Show brings them back", () => {
    show(["a", "b"]);
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("page-needs-dismiss"));
    const section = screen.getByTestId("page-needs");
    expect(section).toHaveAttribute("data-dismissed", "true");
    expect(section).toHaveTextContent("Needs you2 items hidden · back when something new waits");
    expect(screen.queryByTestId("row-a")).toBeNull();
    fireEvent.click(screen.getByTestId("page-needs-show"));
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
    expect(screen.getByTestId("page-needs")).not.toHaveAttribute("data-dismissed");
  });

  it("stays folded when the page is opened again, until a new item waits", async () => {
    show(["a", "b"]);
    fireEvent.click(screen.getByTestId("page-needs-dismiss"));
    cleanup();
    show(["a", "b"]);
    await act(async () => {});
    expect(screen.getByTestId("page-needs")).toHaveAttribute("data-dismissed", "true");
    cleanup();
    show(["a", "b", "c"]);                                   // something new needs the person
    await act(async () => {});
    expect(screen.getByTestId("row-c")).toBeInTheDocument();
    expect(screen.getByTestId("page-needs")).not.toHaveAttribute("data-dismissed");
  });

  it("is said again after a day, even with nothing new", async () => {
    show(["a"]);
    fireEvent.click(screen.getByTestId("page-needs-dismiss"));
    cleanup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + NEEDS_HIDDEN_FOR_MS + 1000);
    show(["a"]);
    await act(async () => {});
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
  });

  it("offers no Dismiss when nothing waits", () => {
    show([]);
    expect(screen.getByTestId("page-needs")).toHaveTextContent("Nothing needs you");
    expect(screen.queryByTestId("page-needs-dismiss")).toBeNull();
  });

  it("remembers each section on its own", async () => {
    show(["a"], "one-needs");
    fireEvent.click(screen.getByTestId("one-needs-dismiss"));
    cleanup();
    show(["a"], "two-needs");
    await act(async () => {});
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
  });
});
