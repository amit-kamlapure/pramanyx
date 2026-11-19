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
import { isOtherKind, queryGrid } from "@/components/dashboards/DashboardTile";
import { SqlView } from "@/components/query/SqlView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import type { VizConfig } from "@/components/charts/vizConfig";
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

/** The one place a card of a person's own query is given its kind of chart (the user, 2026-11-19: "the chart type is not
 *  editable ... two ways to edit a visualisation ... causing a major issue"). Every kind it can be drawn as is listed
 *  together and the one in force is marked: the query's own (bar, line, area, scatter) is kept with its setup, and any other
 *  an answer's chart draws is kept as the card's chart settings — choosing one of the query's own clears it, so the card is
 *  drawn one way wherever it is read. A table or a figure is chosen under What it reads, where its columns are set. */
const OWN_KINDS: ChartType[] = ["bar", "line", "area", "scatter"];

export function QueryKindPick({ cs, onKept }: { cs: CardState; onKept: () => void }) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const shaped = cs.run?.shown ?? null;
  const setup = (cs.card.render as { shown?: QueryShown }).shown;
  const viz = ((cs.card.render ?? {}) as { viz?: VizConfig }).viz;
  const others = useMemo(() => {
    if (!shaped || !setup || shaped.as === "figure" || shaped.as === "table") return [];
    const g = queryGrid(shaped, setup);
    return availableChartTypes(g.columns, g.rows).filter(t => !OWN_KINDS.includes(t) && t !== "counter");
  }, [shaped, setup]);
  if (!setup || setup.as === "figure" || setup.as === "table") {
    return (
      <div className="aug-fs-sm" data-testid="query-kind-none" style={NOTE}>
        Drawn as a {setup?.as === "figure" ? "figure" : "table"}: choose a chart under What it reads, below, where its columns are set.
      </div>
    );
  }
  const inForce: string = isOtherKind(viz?.type) ? String(viz?.type) : setup.as;
  const keep = async (render: Record<string, unknown>) => {
    setSaving(true);
    setProblem("");
    try {
      await updateCard(cs.card.id, { ...cs.card, render });
      onKept();
    } catch (e) {
      setProblem((e as Error).message || "It could not be kept.");
    } finally {
      setSaving(false);
    }
  };
  const pick = (t: ChartType) => {
    const render = (cs.card.render ?? {}) as Record<string, unknown>;
    if (OWN_KINDS.includes(t)) {
      // the query's own kind, kept with its setup; the chart settings' kind cleared, so nothing else draws it another way
      const { type: _cleared, ...rest } = (viz ?? {}) as VizConfig & { type?: string };
      void keep({ ...render, shown: { ...setup, as: t }, viz: rest });
    } else {
      void keep({ ...render, viz: { ...(viz ?? {}), type: t } });
    }
  };
  return (
    <div data-testid="query-kind-pick" style={{ ...NOTE, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="aug-fs-sm">Drawn as</div>
      <div role="radiogroup" aria-label="Kind of chart" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {[...OWN_KINDS, ...others].map(t => (
          <Button key={t} size="xs" variant={t === inForce ? "secondary" : "ghost"} role="radio" aria-checked={t === inForce}
            disabled={saving} onClick={() => { if (t !== inForce) pick(t); }} data-kind={t}>
            {CHART_TYPE_LABEL[t]}
          </Button>
        ))}
      </div>
      {problem && <div className="aug-fs-sm" style={{ color: "var(--amb4)" }}>{problem}</div>}
      <QueryChartOptions cs={cs} onKept={onKept} />
    </div>
  );
}

const numberIn = (text: string): number | undefined => {
  const t = text.trim();
  return t && Number.isFinite(Number(t)) ? Number(t) : undefined;
};

/** How a card of a person's own query is drawn beyond its kind (the study's R12), kept with the card: a line's shape and
 *  points, the value axis's range and scale, and a bar's categories in order and only the largest. */
export function QueryChartOptions({ cs, onKept }: { cs: CardState; onKept: () => void }) {
  const shaped = cs.run?.shown ?? null;
  const viz = ((cs.card.render ?? {}) as { viz?: VizConfig }).viz ?? {};
  const [problem, setProblem] = useState("");
  const [low, setLow] = useState(viz.yMin !== undefined ? String(viz.yMin) : "");
  const [high, setHigh] = useState(viz.yMax !== undefined ? String(viz.yMax) : "");
  if (!shaped || shaped.as === "figure" || shaped.as === "table") return null;
  const save = async (patch: Partial<VizConfig>) => {
    setProblem("");
    const next: Record<string, unknown> = { ...viz, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    try {
      await updateCard(cs.card.id, { ...cs.card, render: { ...(cs.card.render ?? {}), viz: next } });
      onKept();
    } catch (e) { setProblem((e as Error).message || "It could not be kept."); }
  };
  const lined = shaped.as === "line" || shaped.as === "area";
  const categories = shaped.as === "bar" && shaped.x.kind === "text";
  const label = (word: string) => <div className="aug-fs-xs" style={{ color: "var(--t3)" }}>{word}</div>;
  return (
    <div data-testid="query-chart-options" style={{ ...NOTE, display: "flex", flexDirection: "column", gap: 10 }}>
      {lined && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {label("Line")}
          <Segmented label="Line shape" value={viz.lineShape ?? "straight"}
            options={[{ value: "straight", label: "Straight" }, { value: "smooth", label: "Smooth" }, { value: "step", label: "Step" }]}
            onChange={v => void save({ lineShape: v === "straight" ? undefined : v as "smooth" | "step" })} />
          {shaped.as === "line" && (
            <Segmented label="Markers" value={viz.markers ? "on" : "off"} options={[{ value: "off", label: "No markers" }, { value: "on", label: "Markers" }]}
              onChange={v => void save({ markers: v === "on" ? true : undefined })} />
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {label("Value axis")}
        <div style={{ display: "flex", gap: 6 }}>
          <Input aria-label="Lowest on the value axis" placeholder="Lowest: auto" value={low} onChange={e => setLow(e.target.value)}
            onBlur={() => { if (numberIn(low) !== viz.yMin) void save({ yMin: numberIn(low) }); }} />
          <Input aria-label="Highest on the value axis" placeholder="Highest: auto" value={high} onChange={e => setHigh(e.target.value)}
            onBlur={() => { if (numberIn(high) !== viz.yMax) void save({ yMax: numberIn(high) }); }} />
        </div>
        <Segmented label="Value scale" value={viz.yLog ? "log" : "linear"} options={[{ value: "linear", label: "Linear" }, { value: "log", label: "Log" }]}
          onChange={v => void save({ yLog: v === "log" ? true : undefined })} />
      </div>
      {categories && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {label("Order")}
          <Segmented label="Order of the bars" value={viz.sortBy === "label" ? "label" : "value"}
            options={[{ value: "value", label: "Largest first" }, { value: "label", label: "By name" }]}
            onChange={v => void save({ sortBy: v === "label" ? "label" : undefined })} />
          <SelectField aria-label="How many bars" value={String(viz.top ?? "")} onChange={e => void save({ top: numberIn(e.target.value) })}>
            <option value="">Every category</option>
            {[5, 10, 20].map(n => <option key={n} value={n}>The {n} largest</option>)}
          </SelectField>
        </div>
      )}
      {problem && <div className="aug-fs-sm" style={{ color: "var(--amb4)" }}>{problem}</div>}
    </div>
  );
}
