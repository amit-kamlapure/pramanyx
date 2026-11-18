"use client";

/**
 * The builder's tabs for a card (the board study, 2026-11-16: a card's chart type, labels and aggregation under our control, as
 * an answer's chart has them, and the SQL behind it a click away):
 *
 *   - Chart: the card's OWN chart editor, the one an answer's chart opens, held here in the panel instead of the
 *     drawer — the same editor, the same state, kept on the card as the drawer keeps it.
 *   - SQL: the statement as it RAN — after the guards translated and hardened it, cut to the range, around a person's
 *     own query — its values beside it, never pasted in. A card that has not run here says so, with its statement as kept.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { CardState } from "@/components/brief/PinnedCardBody";
import { CHART_TYPE_LABEL, availableChartTypes, type ChartType } from "@/components/charts/chartTypeInference";
import { closeVizEditor, openVizEditor, setVizDock } from "@/components/charts/vizEditorStore";
import { queryGrid } from "@/components/dashboards/DashboardTile";
import { SqlView } from "@/components/query/SqlView";
import { Button } from "@/components/ui/button";
import { updateCard, type QueryShown } from "@/lib/api";

const NOTE = { padding: "12px 14px", color: "var(--t2)", lineHeight: 1.5 } as const;

/** Holds the card's chart editor while the Chart tab is open; a figure, which draws no chart, says so instead. */
export function ChartDock({ cardKey, charted }: { cardKey: string; charted: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!charted || !el) return;
    setVizDock({ key: cardKey, el });
    openVizEditor(cardKey);
    return () => { setVizDock(null); closeVizEditor(cardKey); };
  }, [cardKey, charted]);
  if (!charted) {
    return (
      <div className="aug-fs-sm" data-testid="card-chart-none" style={NOTE}>
        This card draws a figure: its limit, its alert and its change are on the card, and there is no chart to set up.
      </div>
    );
  }
  return <div ref={ref} data-testid="card-chart-dock" style={{ minHeight: 120 }} />;
}

/** The statement a card ran on this dashboard, its values beside it — or why there is none to show yet. */
export function CardSql({ cs, readsValues = false }: { cs?: CardState; readsValues?: boolean }) {
  if (!cs) {
    return <div className="aug-fs-sm" data-testid="card-sql-none" style={NOTE}>This card has not been read on this dashboard yet.</div>;
  }
  const ran = cs.run?.ran ?? null;
  const params = ran?.params && Object.keys(ran.params).length ? ran.params : null;
  return (
    <div data-testid="card-sql" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px" }}>
      <div className="aug-fs-sm" style={{ color: "var(--t2)", lineHeight: 1.5 }}>
        {ran ? "The statement as it ran" : readsValues
          ? "It reads the dashboard's values and runs with each reader's own, so here is its statement as kept"
          : "It has not run here yet, so here is its statement as kept"}
        {ran && cs.run?.scoped?.covers ? `, for ${cs.run.scoped.covers}` : ""}.
      </div>
      <SqlView sql={ran?.sql ?? cs.card.sql ?? ""} style={{ maxHeight: 360, overflow: "auto" }} />
      {params && (
        <div className="aug-fs-sm" data-testid="card-sql-params" style={{ color: "var(--t2)" }}>
          <div style={{ color: "var(--t3)", marginBottom: 4 }}>Bound beside it, never pasted in</div>
          {Object.entries(params).map(([k, v]) => (
            <div key={k} style={{ fontFamily: "var(--font-mono)" }}>{k} = {JSON.stringify(v)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A person's own query draws its own six kinds; any other an answer's chart draws is asked for here — kept on the
 *  card as its chart settings, after which the Chart tab holds that chart's full editor. Only the kinds its result can
 *  carry are offered. */
export function QueryKindPick({ cs, onKept }: { cs: CardState; onKept: () => void }) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const shaped = cs.run?.shown ?? null;
  const setup = (cs.card.render as { shown?: QueryShown }).shown;
  const kinds = useMemo(() => {
    if (!shaped || !setup || shaped.as === "figure" || shaped.as === "table") return [];
    const g = queryGrid(shaped, setup);
    return availableChartTypes(g.columns, g.rows).filter(t => !["bar", "line", "area", "scatter", "counter"].includes(t));
  }, [shaped, setup]);
  if (!kinds.length) {
    return (
      <div className="aug-fs-sm" data-testid="query-kind-none" style={NOTE}>
        It is drawn as its query says — set that up under What it reads, below. Its result carries no other kind of chart.
      </div>
    );
  }
  const pick = async (type: ChartType) => {
    setSaving(true);
    setProblem("");
    try {
      const render = { ...(cs.card.render ?? {}), viz: { ...(((cs.card.render ?? {}) as { viz?: object }).viz ?? {}), type } };
      await updateCard(cs.card.id, { ...cs.card, render });
      onKept();
    } catch (e) {
      setProblem((e as Error).message || "It could not be kept.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div data-testid="query-kind-pick" style={{ ...NOTE, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="aug-fs-sm">Drawn as its query says (bar, line, area or scatter, under What it reads, below). It can also be drawn as:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {kinds.map(t => (
          <Button key={t} size="xs" variant="ghost" disabled={saving} onClick={() => void pick(t)} data-kind={t}>
            {CHART_TYPE_LABEL[t]}
          </Button>
        ))}
      </div>
      {problem && <div className="aug-fs-sm" style={{ color: "var(--amb4)" }}>{problem}</div>}
    </div>
  );
}
