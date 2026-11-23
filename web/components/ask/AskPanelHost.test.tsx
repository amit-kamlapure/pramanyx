// @vitest-environment jsdom
/**
 * The Ask panel draws a conversation the first time it is shown, and keeps it after (2026-11-23). Behind a closed panel
 * each remembered tab used to be drawn on every page load: it read its whole conversation, its people, suggestions,
 * agents and connections and drew its charts — three tabs were half of a cold load's 120 reads.
 */
import { act, fireEvent, render, screen } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => function Chat({ restoreSessionId }: { restoreSessionId?: string | null }) {
    return <div data-testid="chat" data-session={restoreSessionId ?? ""} />;
  },
}));

const { AskPanelHost } = await import("@/components/ask/AskPanel");
const { hideAskPanel, openAskConversation, openAskPanel, resetAskPanel } = await import("@/lib/askPanel");

beforeEach(() => {
  window.localStorage.clear();
  resetAskPanel();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const drawn = () => screen.queryAllByTestId("chat").map(el => el.getAttribute("data-session"));

describe("the Ask panel's conversations", () => {
  it("draws none behind a closed panel, the front one when it opens, and keeps each one drawn after", () => {
    openAskConversation("s1", "One", "c1");
    openAskConversation("s2", "Two", "c1");
    hideAskPanel();
    render(<AskPanelHost connectionId="c1" />);
    expect(drawn()).toEqual([]);                                   // two tabs remembered, nothing read for them

    act(() => openAskPanel("c1"));
    expect(drawn()).toEqual(["s2"]);                               // the one in front

    fireEvent.click(screen.getByRole("tab", { name: "One" }));
    expect(drawn()).toEqual(["s1", "s2"]);                         // the other, and the first stays

    act(() => hideAskPanel());
    expect(drawn()).toEqual(["s1", "s2"]);                         // hiding cuts off no answer being written
  });

  it("is not drawn while the Ask page shows the conversations, until the panel is shown", () => {
    openAskConversation("s1", "One", "c1");
    const { rerender } = render(<AskPanelHost connectionId="c1" hidden />);
    expect(drawn()).toEqual([]);
    rerender(<AskPanelHost connectionId="c1" />);
    expect(drawn()).toEqual(["s1"]);
  });
});
