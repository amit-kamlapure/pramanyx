// @vitest-environment jsdom
/**
 * Arc FA-2 — the subject a question carries from a dashboard, held in memory: said in a line, sent as the ask door's
 * focus (references, or a set by name — never what the set reads), and the dashboard named by a page's key.
 */
import { createElement } from "react";
import { render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  askSubject, changeable, dashboardOf, dashboardSubject, focusOf, nounOf, setAskSubject, subjectWords, useOnPage, usePageSubject,
  type AskSubject,
} from "@/lib/askSubject";
import { LayerVisibleContext } from "@/lib/useVisiblePoll";

const TICKED: AskSubject = { kind: "objects", connectionId: "thelook", noun: nounOf("Order"), label: "Late dispatch",
  refs: Array.from({ length: 12 }, (_, i) => `order:${48200 + i}`) };
const SET: AskSubject = { kind: "set", connectionId: "thelook", noun: nounOf("DistributionCenter"), dashboard: "desk-3f2a1c",
  set: "late", label: "Late dispatch", total: 1400, values: { window: 14 }, chosen: {}, filters: [], narrowed: false };

afterEach(() => setAskSubject(null));

describe("the subject a question carries", () => {
  it("is said in a line, as the canvas shows it above its input", () => {
    expect(subjectWords(TICKED)).toBe("Asking about 12 orders · from Late dispatch");
    expect(subjectWords({ ...TICKED, refs: ["order:1"], label: undefined })).toBe("Asking about 1 order");
    expect(subjectWords(SET)).toBe("Asking about Late dispatch · 1,400 distribution centers");
    expect(subjectWords({ ...SET, total: null, narrowed: true })).toBe("Asking about Late dispatch · narrowed by your filters");
  });

  it("is sent as references, or as a set by its name with the page's values — never what the set reads", () => {
    expect(focusOf(TICKED)).toEqual({ kind: "objects", objects: TICKED.kind === "objects" ? TICKED.refs : [], label: "Late dispatch" });
    expect(focusOf(SET)).toEqual({ kind: "set", dashboard: "desk-3f2a1c", set: "late", values: { window: 14 }, chosen: {}, filters: [] });
    const segment: AskSubject = { kind: "segment", connectionId: "thelook", noun: nounOf("Order"), entity: "order",
      segment: "overdue_dispatch", label: "overdue dispatch", total: 24934, filters: [], narrowed: false };
    expect(focusOf(segment)).toEqual({ kind: "set", entity: "order", segment: "overdue_dispatch", label: "overdue dispatch",
      filters: [], narrowed: false });
    expect(subjectWords(segment)).toBe("Asking about overdue dispatch · 24,934 orders");
    const many = { ...TICKED, refs: Array.from({ length: 70 }, (_, i) => `order:${i}`) };
    expect((focusOf(many).objects as string[]).length).toBe(50);
  });

  it("is held in memory until it is taken off", () => {
    setAskSubject(TICKED);
    expect(askSubject()).toBe(TICKED);
    setAskSubject(null);
    expect(askSubject()).toBeNull();
  });

  it("names the dashboard a page's key names, and none for a key that names none", () => {
    expect(dashboardOf("thelook:desk-3f2a1c", "thelook")).toEqual({ dashboard: "desk-3f2a1c" });
    expect(dashboardOf("thelook:desk-3f2a1c:preview", "thelook")).toEqual({ dashboard: "desk-3f2a1c" });
    expect(dashboardOf("shared:ana:desk-3f2a1c", "thelook")).toEqual({ dashboard: "desk-3f2a1c", owner: "ana" });
    expect(dashboardOf("thelook:shared:ana:desk-3f2a1c", "thelook")).toEqual({ dashboard: "desk-3f2a1c", owner: "ana" });
    expect(dashboardOf(undefined, "thelook")).toBeNull();
    expect(dashboardOf("other:desk", "thelook")).toBeNull();
    expect(dashboardOf("thelook:Not An Id", "thelook")).toBeNull();
  });
});

describe("a dashboard asked about (the study's R20)", () => {
  const range = { start: "2026-10-01", last_day: "2026-10-31", covers: "October 2026" };

  it("carries the period on screen, and the card when one is asked about", () => {
    const whole = dashboardSubject("c", "c:sales", "Sales", range);
    expect(whole && subjectWords(whole)).toBe("Asking about Sales · October 2026");
    expect(whole && focusOf(whole)).toEqual({ kind: "dashboard", dashboard: "sales", label: "Sales", period: "2026-10-01..2026-10-31" });
    const one = dashboardSubject("c", "shared:ana:sales", "Sales", range, { id: "rev", title: "Revenue" });
    expect(one && subjectWords(one)).toBe("Asking about “Revenue” on Sales · October 2026");
    expect(one && focusOf(one)).toMatchObject({ dashboard: "sales", owner: "ana", id: "rev" });
  });

  it("says a dashboard with no period is read as written, and asks nothing of a page that names no dashboard", () => {
    const standing = dashboardSubject("c", "c:sales", "Sales", null);
    expect(standing && subjectWords(standing)).toBe("Asking about Sales · as written");
    expect(standing && focusOf(standing)).toMatchObject({ period: "" });
    expect(dashboardSubject("c", undefined, "Sales", range)).toBeNull();
  });
});

describe("what a page says it shows (the Ask panel, Stage 1)", () => {
  const TABLE: AskSubject = { kind: "table", connectionId: "sheets", noun: ["row", "rows"], table: "main.netflix_titles" };
  function Page({ subject, shown }: { subject: AskSubject | null; shown: boolean }) {
    return createElement(LayerVisibleContext.Provider, { value: shown }, createElement(Says, { subject }));
  }
  function Says({ subject }: { subject: AskSubject | null }) {
    useOnPage(subject);
    return null;
  }
  const onPage = () => renderHook(() => usePageSubject()).result.current;

  it("is said while the page shows, and let go when it closes", () => {
    const page = render(createElement(Page, { subject: TABLE, shown: true }));
    expect(onPage()).toEqual(TABLE);
    page.unmount();
    expect(onPage()).toBeNull();
  });

  it("is let go while the page is kept behind another, and said again when it shows", () => {
    const page = render(createElement(Page, { subject: TABLE, shown: true }));
    page.rerender(createElement(Page, { subject: TABLE, shown: false }));
    expect(onPage()).toBeNull();
    page.rerender(createElement(Page, { subject: TABLE, shown: true }));
    expect(onPage()).toEqual(TABLE);
    page.unmount();
  });
});

describe("where a change can be asked", () => {
  it("is a dashboard the person keeps, never another person's or anything else", () => {
    expect(changeable(dashboardSubject("sheets", "sheets:sales", "Sales", null))).toBe(true);
    expect(changeable(dashboardSubject("sheets", "shared:ana:sales", "Sales", null))).toBe(false);
    expect(changeable({ kind: "table", connectionId: "sheets", noun: ["row", "rows"], table: "main.t" })).toBe(false);
    expect(changeable(null)).toBe(false);
  });
});
