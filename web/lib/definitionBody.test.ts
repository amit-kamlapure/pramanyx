/**
 * A Definition's body (2026-11-23): a new one's two sections, and what a body may link to.
 */
import { describe, expect, it } from "vitest";

import { BODY_TEMPLATE, bodyHref, isBlankBody, plainWords } from "@/lib/definitionBody";

const at = (text: string, start: number, end = start) => ({ text, start, end });

describe("a new body", () => {
  it("opens on the two sections a Page has, and says nothing until something is written in them", () => {
    expect(BODY_TEMPLATE).toContain("## Definition");
    expect(BODY_TEMPLATE).toContain("## Business use");
    expect(isBlankBody(BODY_TEMPLATE)).toBe(true);
    expect(isBlankBody("## Definition\n\n## Business use")).toBe(true);           // as the editor spaces it
    expect(isBlankBody("## Definition\n\nOrdered twice.\n\n## Business use")).toBe(false);
    expect(isBlankBody("  ")).toBe(true);
  });
});

describe("a link in a body", () => {
  it("is the web or a page of the app, and nothing else", () => {
    expect(bodyHref("https://wiki.example/x")).toEqual({ href: "https://wiki.example/x", inApp: false });
    expect(bodyHref("/?tab=semantic&metric=revenue")).toEqual({ href: "/?tab=semantic&metric=revenue", inApp: true });
    expect(bodyHref("javascript:alert(1)")).toBeNull();
    expect(bodyHref("/sheets/1")).toBeNull();
  });
});

describe("one plain line of formatted words", () => {
  it("keeps the words and drops the marks, where a row shows one line (a metric's caveats, 2026-11-24)", () => {
    expect(plainWords("**Finance-approved.** Excludes [test accounts](https://wiki.example/t).")).toBe("Finance-approved. Excludes test accounts.");
    expect(plainWords("## Definition\n\n- paid\n- shipped\n\n| a | b |\n| --- | --- |")).toBe("paid shipped a b");
    expect(plainWords("")).toBe("");
  });
});
