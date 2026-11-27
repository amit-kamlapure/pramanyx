/**
 * The one answer object, as the web reads it (the plan of record, 2026-11-27): the stream's last frame rides the turn,
 * and a turn whose envelope has not come — still streaming, or read back from a thread — says the same fields itself.
 */
import { describe, expect, it } from "vitest";

import { answerOfTurn, pathOfRoute, pathWords, readEnvelope, unsaidCaveats } from "./answerEnvelope";
import { EMPTY_TURN, projectTurn, type ChatTurn, type PramanyxUIMessage } from "./chatTurn";

const WIRE = {
  version: 2, question: "Why did revenue fall in March?", headline: "Revenue fell 12% in March",
  body: "Fewer orders, not smaller ones.", grid: { columns: ["month", "revenue"], rows: [["2026-02", 100], ["2026-03", 88]] },
  chart: { chart_type: "line", chart_config: {} }, caveats: ["March holds 21 of 31 days"], follow_ups: ["By region?"],
  figures: [{ label: "March", value: "$88", note: "" }, { label: "empty", value: " " }],
  exhibits: [{ claim: "Orders fell", grid: { columns: ["month", "orders"], rows: [["2026-03", 9]] }, chart: { chart_type: "bar" }, caveats: [] },
             { claim: "no grid", grid: { columns: [], rows: [] } }],
  gaps: "Returns were not read.", lifted_tables: 0, error: "",
  provenance: { receipt_id: "r1", sql: ["SELECT 1"], tables_used: ["orders"],
                path: { kind: "diagnose", depth: "deep", engine: "analyst", why: "a why question" } },
};

describe("reading the envelope off the wire", () => {
  it("keeps every field, drops what is not there, and names no answer as none", () => {
    const env = readEnvelope(WIRE)!;
    expect(env.headline).toBe("Revenue fell 12% in March");
    expect(env.figures).toEqual([{ label: "March", value: "$88" }]);                  // a figure with no value is not one
    expect(env.exhibits.map(e => e.claim)).toEqual(["Orders fell"]);                  // an exhibit with no grid is not one
    expect(env.exhibits[0].chart).toEqual({ chart_type: "bar", chart_config: {} });
    expect(env.provenance.path).toEqual({ kind: "diagnose", depth: "deep", engine: "analyst", why: "a why question" });
    expect(readEnvelope(null)).toBeNull();
    expect(readEnvelope({ headline: "", body: "" })).toBeNull();
    expect(readEnvelope("nonsense")).toBeNull();
  });
});

describe("how it was answered, in words", () => {
  it("says each kind and engine as a reader would", () => {
    expect(pathWords({ kind: "survey", engine: "converse", depth: "quick" })).toBe("An open question · answered by the conversation · quick");
    expect(pathWords({ kind: "describe", engine: "quick core", depth: "quick" })).toBe("A figure · answered by the quick answer · quick");
    expect(pathWords({ kind: "diagnose", engine: "analyst", depth: "deep" })).toBe("A why · answered by the analyst · deep");
    expect(pathWords({ kind: "check" })).toBe("A check");
    expect(pathWords({})).toBe("");
  });

  it("reads a route frame the way the backend's fold does", () => {
    const route = { depth: "deep" as const, mode: "", tier: "", why: "w", ambiguous: false, forced: null, downgradedFrom: null, shape: "diagnose" };
    expect(pathOfRoute(route)).toEqual({ kind: "diagnose", depth: "deep", engine: "deep graph", why: "w" });
    expect(pathOfRoute({ ...route, depth: "quick", engine: "converse" }).engine).toBe("converse");
    expect(pathOfRoute(null)).toEqual({});
  });
});

describe("the envelope rides the turn", () => {
  const message = (parts: unknown[]) => ({ id: "a1", role: "assistant", parts }) as unknown as PramanyxUIMessage;

  it("is projected from its frame, and the turn reads its answer from it once settled", () => {
    const t = projectTurn("Why did revenue fall in March?", message([
      { type: "data-headline", data: { headline: "Revenue fell 12% in March — caution: partial month" } },
      { type: "data-route", data: { depth: "quick", body: "converse", question_shape: "diagnose" } },
      { type: "data-envelope", data: { envelope: WIRE } },
    ]));
    expect(t.envelope?.headline).toBe("Revenue fell 12% in March");
    expect(t.route?.engine).toBe("converse");
    const a = answerOfTurn(t);
    expect(a.body).toBe("Fewer orders, not smaller ones.");
    expect(a.provenance.path.engine).toBe("analyst");                                 // the envelope's own path wins
  });

  it("says the same fields from the turn while it streams, and for a turn read back with no envelope", () => {
    const turn = {
      ...EMPTY_TURN, id: "t", question: "q", mode: "ask", status: "loading", headline: "Revenue fell",
      narrative: { narrative: "Fewer orders.", anomalies: [], trend: "", confidence: "" }, sql: "SELECT 1",
      columns: ["a"], rows: [[1]], chartType: "bar", followups: ["Next?"], tablesUsed: ["t1"], publicReceiptId: "r9",
      route: { depth: "quick", mode: "", tier: "", why: "", ambiguous: false, forced: null, downgradedFrom: null, shape: "describe" },
      envelope: readEnvelope(WIRE),
    } as ChatTurn;
    const streaming = answerOfTurn(turn);                                             // still loading: the turn's own
    expect(streaming.headline).toBe("Revenue fell");
    expect(streaming.body).toBe("Fewer orders.");
    expect(streaming.grid).toEqual({ columns: ["a"], rows: [[1]] });
    expect(streaming.chart?.chart_type).toBe("bar");
    expect(streaming.provenance).toMatchObject({ receipt_id: "r9", sql: ["SELECT 1"], tables_used: ["t1"],
      path: { kind: "describe", depth: "quick", engine: "quick core" } });
    expect(answerOfTurn({ ...turn, status: "done" }).headline).toBe("Revenue fell 12% in March");   // settled: the envelope
    expect(answerOfTurn({ ...turn, status: "done", envelope: null }).follow_ups).toEqual(["Next?"]);
  });
});

describe("caveats", () => {
  it("are said once: one the headline already says is not repeated", () => {
    expect(unsaidCaveats({ headline: "Revenue rose — caution: March is a partial month.", body: "",
      caveats: ["March is a partial month", "Two stores reported late", "two stores reported late."] }))
      .toEqual(["Two stores reported late"]);
  });
});
