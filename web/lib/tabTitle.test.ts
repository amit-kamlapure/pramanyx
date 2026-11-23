// @vitest-environment jsdom
/**
 * The app's tab names what is open, and nothing else (the user, 2026-11-23: "'Whats Open' only").
 */
import { describe, expect, it } from "vitest";

import type { AskSubject } from "@/lib/askSubject";
import { pageName, tabTitle } from "@/lib/tabTitle";

const on = (s: Partial<AskSubject> & { kind: AskSubject["kind"] }) => ({ connectionId: "c", noun: ["row", "rows"], ...s }) as AskSubject;

describe("a tab", () => {
  it("names the page by the rail's word for it", () => {
    expect(pageName("home")).toBe("Home");
    expect(pageName("builder")).toBe("SQL Editor");
    expect(pageName("dashboards")).toBe("Dashboards");
    expect(pageName("settings")).toBe("Settings");
    expect(pageName("nothing-of-ours")).toBe("Pramanyx");
  });

  it("names the one thing a page shows, over the page", () => {
    expect(tabTitle("dashboards", on({ kind: "dashboard", dashboard: "d1", title: "Revenue Overview" }))).toBe("Revenue Overview");
    expect(tabTitle("spreadsheets", on({ kind: "sheet", id: "s1", title: "Netflix titles" }))).toBe("Netflix titles");
    expect(tabTitle("catalog", on({ kind: "table", table: "thelook.orders" }))).toBe("orders");
    expect(tabTitle("builder", on({ kind: "query", sql: "select 1", title: "" }))).toBe("SQL Editor");
  });

  it("names an open Data Canvas, which says no subject", () => {
    expect(tabTitle("canvas-workspace", null, "Orders desk")).toBe("Orders desk");
    expect(tabTitle("canvas-workspace", null, null)).toBe("Data Canvas");
  });

  it("never says the product's long name", () => {
    expect(tabTitle("home", null)).not.toContain("Autonomous");
  });
});

describe("the tab's words", () => {
  it("hold when the page's head writes the product's name over them, and let go when asked", async () => {
    const { keepTabTitle } = await import("@/lib/tabTitle");
    const head = document.head.querySelector("title") ?? document.head.appendChild(document.createElement("title"));
    const letGo = keepTabTitle("Home");
    expect(document.title).toBe("Home");
    head.textContent = "Pramanyx";
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe("Home");
    letGo();
    head.textContent = "Pramanyx";
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe("Pramanyx");
  });
});
