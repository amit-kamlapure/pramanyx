// @vitest-environment jsdom
/**
 * The page beside the Ask panel (the user, 2026-11-19): while the panel is open the page keeps the
 * width it had without it and scrolls sideways, rather than being squeezed into what is left; closed, hidden on the Ask
 * page, or on a screen too narrow for both, nothing moves.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AskPushedPage } from "@/components/ask/AskPanel";
import { PANEL_DEFAULT_W, hideAskPanel, openAskPanel, resetAskPanel, setAskPanelWidth } from "@/lib/askPanel";

let narrow = false;
beforeEach(() => {
  window.localStorage.clear();
  resetAskPanel();
  narrow = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: narrow, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const page = (hidden = false) => render(<AskPushedPage hidden={hidden}><div data-testid="the-page" /></AskPushedPage>);
const inner = () => screen.getByTestId("the-page").parentElement as HTMLElement;

describe("the page beside the Ask panel", () => {
  it("keeps its width while the panel is open and scrolls sideways; closing the panel gives it back", () => {
    page();
    expect(screen.getByTestId("ask-pushed-page")).not.toHaveAttribute("data-pushed");
    act(() => openAskPanel("c1"));
    expect(screen.getByTestId("ask-pushed-page")).toHaveAttribute("data-pushed");
    expect(screen.getByTestId("ask-pushed-page").style.overflowX).toBe("auto");
    expect(inner().style.width).toBe(`calc(100% + ${PANEL_DEFAULT_W}px)`);
    act(() => setAskPanelWidth(420));                          // dragging the panel moves the page with it
    expect(inner().style.width).toBe("calc(100% + 420px)");
    act(() => hideAskPanel());
    expect(screen.getByTestId("ask-pushed-page")).not.toHaveAttribute("data-pushed");
    expect(inner().style.width).toBe("");
  });

  it("does not move on the Ask page, where the panel is hidden, nor on a narrow screen, where it covers", () => {
    act(() => openAskPanel("c1"));
    const { unmount } = page(true);
    expect(screen.getByTestId("ask-pushed-page")).not.toHaveAttribute("data-pushed");
    unmount();
    narrow = true;
    page();
    expect(screen.getByTestId("ask-pushed-page")).not.toHaveAttribute("data-pushed");
  });

  it("says how far it moved the page, so what must stay in reach — a dashboard's filters — stands that far in (2026-11-19)", () => {
    page();
    act(() => openAskPanel("c1"));
    const scroller = screen.getByTestId("ask-pushed-page");
    Object.defineProperty(scroller, "scrollLeft", { value: 368, configurable: true });
    fireEvent.scroll(scroller);
    expect(inner().style.getPropertyValue("--ask-pushed")).toBe("368px");
    act(() => hideAskPanel());
    expect(inner().style.getPropertyValue("--ask-pushed")).toBe("0px");                  // closed, nothing stands in
  });
});
