/**
 * The editor's settings an answer's line ignored (seen live 2026-11-23 in the SQL Editor, a multi-line of orders by
 * month and status): Labels drew nothing, Tooltip off left the tooltip on, Dates as left the axis as it was, and an
 * Annotation drew no line — while a dashboard's card, drawn by the other engine, honoured all four. Each spec is also
 * compiled, so a setting that makes it invalid fails here, not on the page.
 */
import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";
import { dressed } from "@/components/charts/drawn";

type Obj = Record<string, unknown>;
const ORDERS = {
  columns: ["month", "order_status", "orders"],
  rows: [["2017-09-01", "canceled", 20], ["2017-09-01", "delivered", 4150], ["2017-10-01", "canceled", 26],
         ["2017-10-01", "delivered", 4478], ["2017-11-01", "canceled", 37], ["2017-11-01", "delivered", 7289]] as unknown[][],
};
const multi = (extra: Obj = {}) => resolveVegaSpec({ ...ORDERS, chartType: "multi_line", ...extra })!;
const compiles = (spec: Obj) => expect(() => vl.compile(spec as never)).not.toThrow();
const text = (spec: Obj) => JSON.stringify(spec);

describe("an answer's line, as the editor sets it", () => {
  it("labels the last place of each series when Labels is on, and nothing when it is off", () => {
    const on = multi({ showLabels: true });
    expect(on.resolved).toBe("multi-line");
    const inner = ((on.spec.layer as Obj[])[0].layer as Obj[]);
    const label = inner.find((l) => (l.mark as Obj)?.type === "text") as Obj;
    expect(label).toBeTruthy();
    expect(text(label)).toContain('"groupby":["order_status"]');
    expect(text(label)).toContain("datum.__last === 1");
    compiles(on.spec);
    expect(text(multi().spec)).not.toContain("__valueLabel");
  });

  it("writes its dates as chosen, every label in that one format", () => {
    const written = multi({ dateFormat: "YYYY-MM" });
    const axis = ((written.spec.encoding as Obj).x as Obj).axis as Obj;
    expect(axis.labelExpr).toBe("utcFormat(datum.value, '%Y-%m')");
    expect(text(multi({ dateFormat: "YYYY-QQ" }).spec)).toContain("%Y Q%q");
    compiles(written.spec);
    expect(String((((multi().spec.encoding as Obj).x as Obj).axis as Obj).labelExpr ?? "")).not.toContain("%Y-%m");
  });

  it("draws a reference line across the plot, placed by its value and not by the band its data does not have", () => {
    const ref = multi({ exhibit: { ref_lines: [{ value: 4000, label: "Target" }] } });
    const rule = (ref.spec.layer as Obj[]).find((l) => text(l).includes("__ref")) as Obj;
    expect(rule).toBeTruthy();
    expect(text(rule)).toContain('"x2":{"value":{"expr":"width"}}');
    compiles(ref.spec);
  });

  it("drops every tooltip when the tooltip is off, and leaves the spec as it was when nothing is set", () => {
    const spec = multi().spec;
    expect(text(spec)).toContain('"tooltip"');
    const off = dressed(spec, { tooltip: "off" });
    expect(text(off)).not.toContain('"content":"data"');
    expect(((off.config as Obj).mark as Obj).tooltip).toBe(false);
    compiles(off);
    expect(dressed(spec, null)).toBe(spec);
    expect(dressed(spec, { format: ",.0f" })).toBe(spec);
  });

  it("stands its legend where it was put, or not at all", () => {
    const spec = multi().spec;
    expect(((dressed(spec, { legend: "bottom" }).config as Obj).legend as Obj).orient).toBe("bottom");
    expect(((dressed(spec, { legend: "none" }).config as Obj).legend as Obj).disable).toBe(true);
    compiles(dressed(spec, { legend: "none" }));
  });
});
