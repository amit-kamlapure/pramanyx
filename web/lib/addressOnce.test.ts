// @vitest-environment jsdom
/**
 * A link into one thing inside the app (Discover's links, 2026-11-23): its words ride the address, are read once and
 * taken off; a page reads them when it mounts AND when a link names them while it is open (the shell keeps pages
 * mounted); one page never takes another link's qualifier; and opening a link in place puts its words on the address
 * as a step Back undoes and asks the shell for its screen, without a reload.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_EVENT, openInApp, takeFromAddress, useFromAddress } from "@/lib/addressOnce";
import { NAVIGATE_EVENT } from "@/lib/navigate";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("a link's words", () => {
  it("are read once and taken off, and the app's own words stay", () => {
    window.history.replaceState(null, "", "/?tab=catalog&conn=c1&schema=thelook&table=orders");
    expect(takeFromAddress("table", "schema")).toEqual({ table: "orders", schema: "thelook" });
    expect(window.location.search).toBe("?tab=catalog&conn=c1");
    expect(takeFromAddress("table", "schema")).toEqual({});
  });

  it("are taken only by the page whose key they carry — a metric's schema is not the Catalog's", () => {
    window.history.replaceState(null, "", "/?tab=semantic&conn=c1&metric=revenue&schema=thelook");
    expect(takeFromAddress("table", "schema")).toEqual({});
    expect(window.location.search).toContain("schema=thelook");
    expect(takeFromAddress("metric", "schema")).toEqual({ metric: "revenue", schema: "thelook" });
  });
});

describe("a page that holds things", () => {
  it("reads a link's words when it mounts, and again when a link names them while it is open", () => {
    window.history.replaceState(null, "", "/?tab=spreadsheets&sheet=s1");
    const seen: string[] = [];
    renderHook(() => useFromAddress(["sheet"], ({ sheet }) => seen.push(sheet)));
    expect(seen).toEqual(["s1"]);
    act(() => openInApp("/?tab=spreadsheets&sheet=s2"));
    expect(seen).toEqual(["s1", "s2"]);
    expect(window.location.search).toBe("?tab=spreadsheets");
  });

  it("does not stir for a link that names something else", () => {
    const seen: string[] = [];
    renderHook(() => useFromAddress(["sheet"], ({ sheet }) => seen.push(sheet)));
    window.history.replaceState(null, "", "/?tab=documents&doc=d1&sheet=lingering");
    act(() => { window.dispatchEvent(new CustomEvent(ADDRESS_EVENT, { detail: { words: ["tab", "doc"] } })); });
    expect(seen).toEqual([]);
  });
});

describe("opening a link in place", () => {
  it("puts its words on the address as a step, and asks the shell for its screen, connection and layer", () => {
    const asked = vi.fn();
    window.addEventListener(NAVIGATE_EVENT, asked);
    const before = window.history.length;
    openInApp("/?tab=agentic-ops&layer=automations&conn=c1&automation=a1");
    window.removeEventListener(NAVIGATE_EVENT, asked);
    expect(window.history.length).toBe(before + 1);
    // only the shell's words go on the address; the schedule's is handed to the page (Next's router writes back what a
    // pushState gave it, so a word put there would stay)
    expect(window.location.search).toBe("?tab=agentic-ops&layer=automations&conn=c1");
    expect((asked.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: "agentic-ops", params: { conn: "c1", layer: "automations" } });
  });
});

describe("a link opened in place before its page is open", () => {
  it("is held for the page and read as it mounts", () => {
    openInApp("/?tab=catalog&conn=c1&schema=thelook&table=orders");
    expect(window.location.search).toBe("?tab=catalog&conn=c1");
    const seen: Record<string, string>[] = [];
    renderHook(() => useFromAddress(["table", "schema"], found => seen.push(found)));
    expect(seen).toEqual([{ table: "orders", schema: "thelook" }]);
    renderHook(() => useFromAddress(["table", "schema"], found => seen.push(found)));   // taken once, not twice
    expect(seen).toHaveLength(1);
  });
});
