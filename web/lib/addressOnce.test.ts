// @vitest-environment jsdom
/**
 * A link's word for what to open is read once and taken off the address (Discover's links, 2026-11-23), so the next
 * visit to the page opens it as it opens.
 */
import { afterEach, describe, expect, it } from "vitest";

import { takeFromAddress } from "@/lib/addressOnce";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("a link's word", () => {
  it("is read once and taken off, and the app's own words stay", () => {
    window.history.replaceState(null, "", "/?tab=catalog&conn=c1&schema=thelook&table=orders");
    expect(takeFromAddress("table", "schema")).toEqual({ table: "orders", schema: "thelook" });
    expect(window.location.search).toBe("?tab=catalog&conn=c1");
    expect(takeFromAddress("table", "schema")).toEqual({});
  });

  it("leaves the address alone when it holds none of them", () => {
    window.history.replaceState(null, "", "/?tab=documents");
    expect(takeFromAddress("doc")).toEqual({});
    expect(window.location.search).toBe("?tab=documents");
  });
});
