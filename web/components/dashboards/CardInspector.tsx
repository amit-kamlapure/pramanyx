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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { CardState } from "@/components/brief/PinnedCardBody";
import { CHART_TYPE_LABEL, availableChartTypes, type ChartType } from "@/components/charts/chartTypeInference";
import { LEGEND_POS, NUMBER_FORMATS, TOP_OPTIONS, TRANSFORM_OPTS } from "@/components/charts/ResultChartCard";
import { VizEditorPanel, type VizEditorModel, type VizFieldKind, type VizSelectOption, type VizValueColor } from "@/components/charts/VizEditorPanel";
import { isEmptyVizConfig, type VizConfig } from "@/components/charts/vizConfig";
import { closeVizEditor, openVizEditor, setVizDock } from "@/components/charts/vizEditorStore";
import { readVegaTokens } from "@/components/charts/vega/config";
import { isOtherKind, queryGrid } from "@/components/dashboards/DashboardTile";
import { AGGS, BUCKETS, MAX_SERIES, MAX_TOP, QUERY_DEFAULT, kindOf, setupAs } from "@/components/dashboards/QuerySetup";
import { SqlView } from "@/components/query/SqlView";
import { updateCard, type QueryAgg, type QueryBucket, type QuerySegments, type QueryShown, type QueryShownAs, type TypedColumn } from "@/lib/api";
import { SERIES_SLOTS } from "@/lib/dashboards/catalog";
import { seriesColours } from "@/lib/dashboards/queryChart";

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

/**
 * A card of a person's own query, set up in the one chart editor (the user, 2026-11-19: a dashboard's chart is edited
 * "almost entirely" as a chart is edited anywhere — "the dropdown for viz type, formatting of fields, etc." — with its
 * fields each a pill with + and −). One kind is in force, kept one way: the query's own (a table, a
 * figure, a bar, a line, an area, a scatter) with its setup, any other an answer's chart draws as the card's chart
 * settings — choosing one of the query's own clears it. What it reads along each axis, what colours it and what it
 * labels are its setup, read again by the server; how it is dressed (format, titles, range, tooltip, lines) is its chart
 * settings. Each change is kept on the card as it is made.
 */
const OWN_KINDS: ChartType[] = ["bar", "line", "area", "scatter"];
const BUCKET_FN: Record<string, string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", quarter: "QUARTERLY", year: "YEARLY" };
const WAIT_MS = 450;

type Draft = { shown: QueryShown; viz: VizConfig };

const fieldKind = (type: string): VizFieldKind => {
  const k = kindOf(type);
  return k === "number" ? "number" : k === "text" ? "text" : "date";
};
const numberIn = (text: string): number | undefined => {
  const t = text.trim();
  return t && Number.isFinite(Number(t)) ? Number(t) : undefined;
};
/** Chart settings without what is unset, so an untouched one keeps nothing. */
function cleanViz(v: VizConfig): VizConfig {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== "" && x !== null)) as VizConfig;
}

/** The dashboard's colours for a field's values (v17), kept on the whole dashboard. */
export interface KeptValueColors {
  kept: Record<string, Record<string, number>>;
  choose: (field: string, value: string, slot: number | null) => void;
}

export function QueryChartEditor({ cs, onKept, colors = null, dataset }: {
  cs: CardState; onKept: () => void; colors?: KeptValueColors | null;
  /** The dataset it is built on, and the way to another, said under its Visualization (2026-11-19). */
  dataset?: ReactNode;
}) {
  const render = (cs.card.render ?? {}) as { shown?: QueryShown; viz?: VizConfig; columns?: TypedColumn[] };
  const kept = JSON.stringify({ shown: render.shown ?? null, viz: render.viz ?? {} });
  const fromCard = (): Draft => ({ shown: { ...QUERY_DEFAULT, ...render.shown }, viz: render.viz ?? {} });
  const [draft, setDraft] = useState<Draft>(fromCard);
  // words typed for the range and the titles, kept as typed while the number or the title they make is kept
  const [texts, setTexts] = useState(() => ({ yMin: String(render.viz?.yMin ?? ""), yMax: String(render.viz?.yMax ?? "") }));
  const [problem, setProblem] = useState("");
  const pending = useRef(false);
  // each change numbered: only the save of the newest lets the card be read again, so an older one landing never undoes a newer
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(cs);
  latest.current = cs;
  // the card changed from elsewhere — an undo, the SQL kept anew — and nothing of this editor waits to be kept: it reads the card again
  const [seen, setSeen] = useState(kept);
  if (seen !== kept && !pending.current) {
    setSeen(kept);
    setDraft(fromCard());
    setTexts({ yMin: String(render.viz?.yMin ?? ""), yMax: String(render.viz?.yMax ?? "") });
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (next: Draft) => {
    setDraft(next);
    pending.current = true;
    const mine = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const card = latest.current.card;
      const out: Record<string, unknown> = { ...(card.render ?? {}), shown: next.shown };
      const viz = cleanViz(next.viz);
      if (isEmptyVizConfig(viz)) delete out.viz; else out.viz = viz;
      updateCard(card.id, { ...card, render: out })
        .then(() => setProblem(""))
        .catch(e => setProblem((e as Error).message || "It could not be kept."))
        .finally(() => {
          if (mine !== seq.current) return;
          pending.current = false;
          onKept();
        });
    }, WAIT_MS);
  };
  const shown = draft.shown;
  const viz = draft.viz;
  const put = (patch: Partial<QueryShown>) => commit({ ...draft, shown: { ...shown, ...patch } });
  const style = (patch: Partial<VizConfig>) => commit({ ...draft, viz: { ...viz, ...patch } });

  const columns = useMemo(() => render.columns ?? [], [render.columns]);
  const typeOf = (name: string) => columns.find(c => c.name === name)?.type ?? "";
  const opt = (c: TypedColumn): VizSelectOption => ({ v: c.name, t: c.name, k: fieldKind(c.type) });
  const shaped = cs.run?.shown ?? null;
  const chart = shown.as !== "table" && shown.as !== "figure";
  const other = chart && isOtherKind(viz.type) ? String(viz.type) : null;
  const kind: string = other ?? shown.as;
  const others = useMemo(() => {
    if (!shaped || shaped.as === "figure" || shaped.as === "table") return [] as ChartType[];
    const g = queryGrid(shaped, shown);
    return availableChartTypes(g.columns, g.rows).filter(t => !OWN_KINDS.includes(t) && t !== "counter");
  }, [shaped, shown]);
  const vizOptions: VizSelectOption[] = [
    ...OWN_KINDS.map(t => ({ v: t, t: CHART_TYPE_LABEL[t] })),
    ...[...others, ...(other && !others.includes(other as ChartType) ? [other as ChartType] : [])].map(t => ({ v: t, t: CHART_TYPE_LABEL[t] ?? t })),
    { v: "table", t: "Table" }, { v: "figure", t: "Figure" },
  ];
  const setViz = (v: string) => {
    if (v === kind) return;
    const { type: _cleared, ...rest } = viz as VizConfig & { type?: string };
    if (v === "table" || v === "figure" || OWN_KINDS.includes(v as ChartType)) {
      // the query's own kind, kept with its setup; the chart settings' kind cleared, so nothing else draws it another way
      commit({ shown: setupAs(shown, v as QueryShownAs, columns), viz: rest });
    } else {
      commit({ shown: chart ? shown : setupAs(shown, "bar", columns), viz: { ...viz, type: v as ChartType } });
    }
  };

  const xKind = kindOf(typeOf(shown.x));
  const dated = (xKind === "date" || xKind === "time") && shown.as !== "scatter";
  const scatter = shown.as === "scatter";
  const calculated = shown.as === "figure" || (shown.summed && !scatter);
  const lined = other ? /line/.test(other) && !/forecast/.test(other) : shown.as === "line" || shown.as === "area";
  const bars = other ? /bar/.test(other) : shown.as === "bar";
  const categories = !other && shown.as === "bar" && xKind === "text";
  const several = shown.series.length > 1;
  const measureOptions: VizSelectOption[] = calculated
    ? [{ v: "", t: "Rows", k: "number" }, ...columns.map(opt)]
    : columns.filter(c => kindOf(c.type) === "number").map(opt);
  const setMeasure = (i: number, patch: { column?: string; agg?: string }) => put({
    series: shown.series.map((x, j) => {
      if (j !== i) return x;
      const column = patch.column ?? x.column;
      let agg = (patch.agg ?? x.agg) as QueryAgg;
      // a sum or an average of words reads nothing: words are counted, each different one once
      if (patch.column !== undefined && column && kindOf(typeOf(column)) !== "number" && (agg === "sum" || agg === "avg")) agg = "count_distinct";
      if (patch.column === "" ) agg = "count";
      return { ...x, column, agg };
    }),
  });
  const average = () => {
    const vs = shaped && "points" in shaped ? shaped.points.map(p => p.v).filter((v): v is number => typeof v === "number") : [];
    if (!vs.length) return;
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    style({ refLines: [...(viz.refLines ?? []), { value: Number(mean.toFixed(4)), label: "Average", kind: "global_avg" }] });
  };
  const valueColors: VizValueColor[] | undefined = useMemo(() => {
    if (!colors || other || !shown.split || !shaped || !("series" in shaped)) return undefined;
    const named = shaped.series.filter(x => x && x !== "Other");
    if (named.length < 2) return undefined;
    const t = readVegaTokens();
    const forField = colors.kept[shown.split] ?? {};
    const drawn = seriesColours(named, { palette: t.palette, other: t.deemph }, shaped.tones ?? {}, forField);
    return named.map((value, i) => ({ value, color: drawn[i], slot: forField[value] ?? null,
      choose: (slot: number | null) => colors.choose(shown.split, value, slot) }));
  }, [colors, other, shown.split, shaped]);

  const model: VizEditorModel = {
    title: cs.card.title,
    vizBelow: dataset,
    view: chart ? "chart" : "table", setView: () => {}, chartAvailable: true, canPivot: false,
    chartTypeValue: kind, chartTypeOptions: [], setChartType: setViz,
    vizValue: kind, vizOptions, setViz,
    // X axis: what runs along the bottom, and the buckets a date is counted in
    dimValue: shown.x,
    dimOptions: (scatter ? columns.filter(c => kindOf(c.type) !== "text") : columns).map(opt),
    setDim: v => put({ x: v, bucket: ["date", "time"].includes(kindOf(typeOf(v))) && !scatter ? (shown.bucket || "day") : "" }),
    dimLabel: dated && shown.bucket ? `${BUCKET_FN[shown.bucket]}(${shown.x})` : shown.x || "Choose a field",
    bucketValue: dated ? shown.bucket || "day" : undefined,
    bucketOptions: dated ? BUCKETS.map(b => ({ v: b.value, t: b.label })) : undefined,
    setBucket: v => put({ bucket: v as QueryBucket }),
    // Y axis: each measure and its calculation
    metricValue: shown.series[0]?.column ?? "", metricOptions: measureOptions, setMetric: v => setMeasure(0, { column: v }),
    aggValue: null, aggOptions: [], setAgg: () => {}, rateSummed: false,
    measures: (shown.as === "figure" ? shown.series.slice(0, 1) : shown.series).map(x => ({ column: x.column, agg: calculated ? x.agg : null })),
    setMeasure,
    addMeasure: chart && !scatter && !shown.split && shown.series.length < MAX_SERIES
      ? (column: string) => put({ series: [...shown.series, { column, agg: !column ? "count" : kindOf(typeOf(column)) === "number" ? "sum" : "count_distinct" }] })
      : null,
    removeMeasure: several ? (i: number) => put({ series: shown.series.filter((_, j) => j !== i) }) : null,
    measureAggOptions: calculated ? AGGS.map(a => ({ v: a.value, t: a.label })) : undefined,
    summedValue: chart && !scatter ? shown.summed : undefined, setSummed: b => put({ summed: b }),
    runningValue: chart && !scatter ? shown.running : undefined, setRunning: b => put({ running: b }),
    // the bars' way round
    orientValue: other ? viz.orient ?? "" : shown.across ? "horizontal" : "",
    orientAvailable: bars,
    setOrient: v => (other ? style({ orient: v || undefined }) : put({ across: v === "horizontal" })),
    // a line's shape and markers; the value axis; the bars' order
    lineAvailable: lined,
    markersAvailable: other ? true : shown.as === "line",
    lineShapeValue: viz.lineShape ?? "", setLineShape: v => style({ lineShape: v || undefined }),
    // a query card's line hides its points unless they are asked for; an answer's chart shows them unless they are not
    markersOn: other ? viz.markers !== false : viz.markers === true,
    setMarkersOn: b => style({ markers: other ? (b ? undefined : false) : (b ? true : undefined) }),
    yMinValue: texts.yMin, setYMin: t => { setTexts(x => ({ ...x, yMin: t })); style({ yMin: numberIn(t) }); },
    yMaxValue: texts.yMax, setYMax: t => { setTexts(x => ({ ...x, yMax: t })); style({ yMax: numberIn(t) }); },
    yLog: !!viz.yLog, setYLog: b => style({ yLog: b || undefined }),
    barSortAvailable: other ? bars : categories,
    sortValue: viz.sortBy ?? "", setSort: v => style({ sortBy: v || undefined }),
    topValue: viz.top ? String(viz.top) : "", topOptions: TOP_OPTIONS, setTop: v => style({ top: numberIn(v) }),
    // an answer's chart transforms its points; the query's own sums them itself (Rows, Running total)
    transformValue: viz.transform ?? "none", transformOptions: other ? TRANSFORM_OPTS : [],
    setTransform: v => style({ transform: v === "none" ? undefined : v as VizConfig["transform"] }),
    // labels: the query's own, or the chart's
    labelsAvailable: !scatter,
    showLabels: other ? !!viz.showLabels : shown.labels,
    setShowLabels: b => (other ? style({ showLabels: b || undefined }) : put({ labels: b })),
    // Color: what splits it, how many of its values, how its parts stand, and each value's colour
    colorFieldValue: several ? "" : shown.split,
    colorFieldOptions: [{ v: "", t: "None" }, ...columns.filter(c => c.name !== shown.x).map(opt)],
    setColorField: v => put({ split: v }),
    colorScaleAvailable: false,
    colorNote: several ? "Coloured by its measures: a chart of several is split by them." : undefined,
    colorScaleValue: "", setColorScale: () => {}, colorNameValue: "", setColorName: () => {},
    legendValue: viz.legend ?? "", legendOptions: LEGEND_POS, setLegend: v => style({ legend: v || undefined }),
    colorTopValue: String(shown.top),
    colorTopOptions: Array.from({ length: MAX_TOP }, (_, i) => ({ v: String(i + 1), t: `The top ${i + 1}, the rest as Other` })),
    setColorTop: v => put({ top: Number(v) }),
    segmentsValue: shown.segments,
    segmentsOptions: !other && (shown.as === "bar" || shown.as === "area") && (shown.split || several)
      ? [["stacked", "Stacked"], ["side_by_side", shown.as === "area" ? "Over each other" : "Side by side"], ["shares", "Shares"]] : undefined,
    setSegments: v => put({ segments: v as QuerySegments }),
    colorValues: valueColors, colorSlots: SERIES_SLOTS,
    // how it is dressed
    numberFormatValue: viz.numberFormat ?? "", numberFormatOptions: NUMBER_FORMATS, setNumberFormat: v => style({ numberFormat: v || undefined }),
    xTitleValue: viz.xTitle ?? "", setXTitle: v => style({ xTitle: v || undefined }),
    yTitleValue: viz.yTitle ?? "", setYTitle: v => style({ yTitle: v || undefined }),
    tooltipOn: !viz.tooltipOff, setTooltipOn: b => style({ tooltipOff: b ? undefined : true }),
    refLines: (viz.refLines ?? []).map(l => ({ label: l.label, value: l.value })),
    addRefLine: (value, label) => style({ refLines: [...(viz.refLines ?? []), { value, label: label || `y = ${value}`, kind: "target" }] }),
    addAverageLine: average,
    removeRefLine: i => style({ refLines: (viz.refLines ?? []).filter((_, j) => j !== i) }),
    measureLabel: shown.series[0]?.column || "the rows",
    // a table: its columns and its order; a figure: the words under it
    ...(shown.as === "table" ? {
      tableColumns: shown.columns, columnOptions: columns.map(opt), setTableColumns: (v: string[]) => put({ columns: v }),
      sortField: shown.sort, setSortField: (v: string) => put({ sort: v }),
      sortDescending: shown.descending, setSortDescending: (b: boolean) => put({ descending: b }),
    } : {}),
    ...(shown.as === "figure" ? { figureLabel: shown.label, setFigureLabel: (v: string) => put({ label: v.slice(0, 60) }) } : {}),
  };
  return (
    <div data-testid="query-chart-editor">
      <VizEditorPanel model={model} docked onClose={() => {}} />
      {problem && <div className="aug-fs-sm" role="alert" style={{ ...NOTE, color: "var(--amb4)" }}>{problem}</div>}
    </div>
  );
}
