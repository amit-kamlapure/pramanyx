// @vitest-environment jsdom
/**
 * The Area map plan's gap (2026-11-26): an approved metric the context-layer eval showed an answer using stands on a
 * person's word and a measured result — the panel beside an answer says so on the claim that won, ahead of "verified".
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DefinitionSource, MetricProvenance } from "@/lib/api";

const claim = (over: Partial<DefinitionSource>): DefinitionSource => ({
  formula_sql: "SUM(x)", source_asset: "metric registry", source_kind: "manual", author: "", recorded_at: "",
  use_count: 0, certified: false, verified: false, verification_note: "", ...over,
});
const measured = claim({ measured: true, measured_note: "the context-layer eval, 2026-11-26" });
const graph = claim({ formula_sql: "SUM(y)", source_asset: "the ontology graph", verified: true });
const data: MetricProvenance = {
  metric_id: "revenue", display_name: "Revenue", definitions: [measured, graph], chosen: measured, dissenter: graph,
  contested: true, why: "Using the definition from metric registry, unattributed — an answer was shown to use its formula.",
  known_divergent_calculations: [],
};
vi.mock("@/lib/api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()), getMetricProvenance: vi.fn(async () => data),
}));
const { MetricProvenancePanel } = await import("./MetricProvenance");

describe("a measured metric's claim", () => {
  it("says an answer used it, with when, and the verified claim it outranks does not", async () => {
    render(<MetricProvenancePanel metricId="revenue" connectionId="c" />);
    const badge = await screen.findByText(/an answer used it · the context-layer eval, 2026-11-26/);
    expect(badge).toBeTruthy();
    expect(screen.getAllByText(/an answer used it/)).toHaveLength(1);
    expect(screen.getByText(/an answer was shown to use its formula/)).toBeTruthy();
  });
});
