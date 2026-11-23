/**
 * The Page editor's toolbar (2026-11-23): what each tool does to a Definition's body and its selection.
 */
import { describe, expect, it } from "vitest";

import { BODY_TEMPLATE, apply, bodyHref } from "@/lib/definitionBody";

const at = (text: string, start: number, end = start) => ({ text, start, end });

describe("the toolbar", () => {
  it("makes the lines a selection touches a heading, a subheading, or text again", () => {
    expect(apply("heading", at("Orders twice\nor more", 3)).text).toBe("## Orders twice\nor more");
    expect(apply("subheading", at("## Orders", 0)).text).toBe("### Orders");
    expect(apply("text", at("### Orders", 0)).text).toBe("Orders");
    expect(apply("heading", at("one\ntwo", 0, 7)).text).toBe("## one\n## two");
  });

  it("wraps the chosen words in bold or italic, and selects them", () => {
    const e = apply("bold", at("a returning buyer", 2, 11));
    expect(e.text).toBe("a **returning** buyer");
    expect(e.text.slice(e.start, e.end)).toBe("returning");
    expect(apply("italic", at("x", 1)).text).toBe("x*italic*");
  });

  it("lists the lines, and a second press takes the list away", () => {
    const listed = apply("bullets", at("paid\nshipped", 0, 12));
    expect(listed.text).toBe("- paid\n- shipped");
    expect(apply("bullets", listed).text).toBe("paid\nshipped");
    expect(apply("numbers", at("paid\nshipped", 0, 12)).text).toBe("1. paid\n2. shipped");
  });

  it("links the chosen words and leaves the address to fill selected", () => {
    const e = apply("link", at("see the wiki", 8, 12));
    expect(e.text).toBe("see the [wiki](https://)");
    expect(e.text.slice(e.start, e.end)).toBe("https://");
  });

  it("puts a table on a line of its own", () => {
    expect(apply("table", at("Rates", 5)).text).toBe("Rates\n\n| Column | Column |\n| --- | --- |\n|  |  |\n");
  });

  it("opens a new Definition on the two sections a Page has", () => {
    expect(BODY_TEMPLATE).toContain("## Definition");
    expect(BODY_TEMPLATE).toContain("## Business use");
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
