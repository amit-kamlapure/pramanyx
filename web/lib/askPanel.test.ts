// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_TABS, closeAskTab, hideAskPanel, newAskTab, noteAskSession, openAskConversation, openAskPanel, resetAskPanel,
  selectAskTab, toggleAskPanel, useAskPanel,
} from "@/lib/askPanel";
import { renderHook } from "@testing-library/react";

const now = () => renderHook(() => useAskPanel()).result.current;
beforeEach(() => { window.localStorage.clear(); resetAskPanel(); });

describe("the Ask panel", () => {
  it("opens from the top bar on a first conversation, and hides keeping it", () => {
    toggleAskPanel("c1");
    const opened = now();
    expect(opened.open).toBe(true);
    expect(opened.tabs).toHaveLength(1);
    expect(opened.tabs[0]).toMatchObject({ session: null, connectionId: "c1" });
    toggleAskPanel("c1");
    expect(now()).toMatchObject({ open: false, tabs: opened.tabs });
  });

  it("is kept in the browser, so a reload finds the same tabs", () => {
    openAskPanel("c1");
    const { tabs } = now();
    noteAskSession(tabs[0].key, "s1", "Why did returns rise?");
    resetAskPanel();
    expect(now()).toMatchObject({ open: true, tabs: [{ session: "s1", title: "Why did returns rise?" }] });
  });

  it("keeps one empty new conversation rather than many, and lets the oldest tab go past the most it holds", () => {
    openAskPanel("c1");
    newAskTab("c1");
    expect(now().tabs).toHaveLength(1);
    for (let i = 0; i < MAX_TABS + 2; i++) openAskConversation(`s${i}`, `Q${i}`, "c1");
    const { tabs, active } = now();
    expect(tabs).toHaveLength(MAX_TABS);
    expect(tabs[tabs.length - 1].key).toBe(active);
    expect(tabs.some(t => t.session === "s0")).toBe(false);
  });

  it("brings an open conversation to the front instead of opening it twice", () => {
    openAskConversation("s1", "Q1", "c1");
    openAskConversation("s2", "Q2", "c1");
    openAskConversation("s1", "Q1", "c1");
    const { tabs, active } = now();
    expect(tabs.filter(t => t.session === "s1")).toHaveLength(1);
    expect(tabs.find(t => t.key === active)?.session).toBe("s1");
  });

  it("closes a tab to its neighbour, and hides when the last one goes", () => {
    openAskConversation("s1", "Q1", "c1");
    openAskConversation("s2", "Q2", "c1");
    const [first, second] = now().tabs;
    selectAskTab(first.key);
    closeAskTab(first.key);
    expect(now().active).toBe(second.key);
    closeAskTab(second.key);
    expect(now()).toMatchObject({ open: false, tabs: [] });
    hideAskPanel();
  });
});
