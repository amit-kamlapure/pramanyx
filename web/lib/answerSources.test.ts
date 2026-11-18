import { describe, expect, it } from "vitest";

import { answerSources } from "@/lib/answerSources";

const READ = { receipt_id: "r1", connection_id: "c1", metrics: [{ name: "net revenue", departed: false }, { name: "margin", departed: true }],
  definitions: ["Active customer"], objects: ["Order"] };

describe("what an answer stood on", () => {
  it("opens each thing on the app's own page, on the answer's connection", () => {
    expect(answerSources(READ, "c 1", new Map(), ["Order"]).map(s => s.page)).toEqual([
      "/metrics/net%20revenue?conn=c%201", "/metrics/margin?conn=c%201", "/definitions/Active%20customer?conn=c%201", "/ontology/Order?conn=c%201",
    ]);
  });

  it("says when the answer departed from an approved metric", () => {
    const [, margin] = answerSources(READ, "c1");
    expect(margin.label).toBe("margin · not used as approved");
    expect(margin.title).toContain("did not use this metric as approved");
  });

  it("opens a table of the sheets connection as the spreadsheet it is", () => {
    const sheets = new Map([["netflix_titles", { id: "s1", name: "Netflix titles" }]]);
    const read = { ...READ, metrics: [], definitions: [], objects: ["main.netflix_titles", "other_table"] };
    const [sheet, other] = answerSources(read, "sheets", sheets);
    expect(sheet).toMatchObject({ kind: "sheet", label: "Netflix titles", page: "/sheets/s1?name=Netflix%20titles" });
    expect(other).toMatchObject({ kind: "table", page: "", table: { connection: "sheets", name: "other_table" } });
  });

  it("does not take another connection's table for a spreadsheet", () => {
    const sheets = new Map([["orders", { id: "s1", name: "Orders" }]]);
    expect(answerSources({ ...READ, metrics: [], definitions: [], objects: ["orders"] }, "c1", sheets)[0].kind).toBe("table");
  });

  it("opens a table as its object when the ontology models it, however it is spelled", () => {
    const read = { ...READ, metrics: [], definitions: [], objects: ["main.orders", "airports"] };
    const [order, airports] = answerSources(read, "c1", new Map(), ["Order"]);
    expect(order).toMatchObject({ kind: "object", label: "Order", page: "/ontology/Order?conn=c1" });
    expect(airports).toMatchObject({ kind: "table", label: "airports", page: "" });
  });
});
