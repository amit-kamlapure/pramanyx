import { describe, expect, it } from "vitest";

import { earlierWordings, linkHref, names, same, who } from "./definitions";

describe("a Definition's helpers (2026-11-17, the ontology study)", () => {
  it("opens what a link names as the app's own page, and nothing it cannot", () => {
    expect(linkHref({ kind: "metric", ref: "gmv", label: "" }, "shop")).toBe("/metrics/gmv?conn=shop");
    expect(linkHref({ kind: "definition", ref: "active customer", label: "" }, "shop")).toBe("/definitions/active%20customer?conn=shop");
    expect(linkHref({ kind: "url", ref: "https://wiki.example/gmv", label: "" }, "shop")).toBe("https://wiki.example/gmv");
    expect(linkHref({ kind: "url", ref: "javascript:alert(1)", label: "" }, "shop")).toBeNull();
    expect(linkHref({ kind: "table", ref: "orders", label: "" }, "shop")).toBeNull();
  });

  it("lists the earlier WORDINGS only — a suggestion filed restates the claim without changing them", () => {
    const v = (id: string, text: string) => ({ id, text, tier: "approved", author: "user:ana", recorded_at: "2026-11-17" });
    expect(earlierWordings([v("4", "new"), v("3", "new"), v("2", "old"), v("1", "old"), v("0", "oldest")]).map((x) => x.id))
      .toEqual(["2", "0"]);
  });

  it("reads names, people and sameness the way the server does", () => {
    expect(names(" gross sales, , GMV ")).toEqual(["gross sales", "GMV"]);
    expect(who("user:ana")).toBe("ana");
    expect(same(" User:Ana ", "user:ana")).toBe(true);
  });
});
