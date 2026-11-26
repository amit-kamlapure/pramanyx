"use client";

/**
 * ResultChartCard — the answer-result chart surface for Insight (chat), Deep Analysis (report), the Data Canvas, the
 * query results and the briefing. It renders CLEAN: no controls sit on the chart. A single hover pencil ("Edit
 * visualization") opens the right-docked side panel (VizEditorPanel), where every control lives.
 *
 * ONE chart editor everywhere (the owner, 2026-11-20: "Dashboard has the best one"): the panel's model is built by the
 * dashboard's own builder (`queryEditorModel.ts`), in ROWS ONLY — an answer's chart is edited without asking anything
 * again: its own rows are charted. What only a new query could honour (another date bucket, a calculation over the
 * rows, the rows summed) is said in its place to need the question asked again, never offered as if it worked.
 *
 * Two drawings:
 *   • nobody has set it up in the editor — the chart is drawn exactly as it was answered: the canonical <Chart> over the
 *     answer's rows, with the backend's hint, config and exhibit (and any display choices kept before the one editor);
 *   • set up in the editor — drawn as a dashboard draws a card: the answer's rows shaped client-side
 *     (`answerShape.ts`) and drawn by `queryChartSpec` for a bar, a line, an area or a scatter; a table, a pivot and a
 *     figure as such; any other kind (a pie, a map, a treemap…) by <Chart>, from the answer's own rows while its fields
 *     are the ones it was drawn with, else from the shaped points as a dashboard's other kinds are.
 *
 * The editor's opening values always name what is drawn — the real type and the real fields (`drawn.ts`) — never
 * "Auto" or "As answered".
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Chart, type ChartCustom } from "@/components/Chart";
import type { ChartOptions } from "@/components/charts/chartCustom";
import { SqlResultTable } from "@/components/AugTable";
import { PivotTable } from "@/components/PivotTable";
import { AnswerMap } from "@/components/charts/geo/AnswerMap";
import { classifyColumns, availableChartTypes, inferChartType, ALL_CHART_TYPES, TYPE_TO_HINT, HINT_TO_TYPE, type ChartType } from "@/components/charts/chartTypeInference";
import { isUngraphableGrid, offeredMeasures } from "@/components/charts/columnRoles";
import type { ExhibitSpec, ExhibitColor } from "@/components/charts/exhibit";
import { cleanLabel, formatDateAs, formatMetricValue } from "@/lib/format";
import { downloadChartPng, type ChartInstance } from "@/lib/chartExport";
import { VizEditorPanel } from "@/components/charts/VizEditorPanel";
import { pickOf, type Pick } from "@/components/charts/selection";
import { chartOptionsOf, type VizConfig } from "@/components/charts/vizConfig";
import { useVizEditorOpen, openVizEditor, closeVizEditor, useVizDock } from "@/components/charts/vizEditorStore";
import { vizSubject } from "@/components/charts/VizDock";
import { useInspector } from "@/components/shell/Inspector";
import { useInShell } from "@/components/shell/PageChrome";
import { drawnOf, drawnType, resolveChart } from "@/components/charts/drawn";
import { kindOfDraft, queryEditorModel, type QueryDraft } from "@/components/charts/queryEditorModel";
import { VegaChart } from "@/components/charts/vega/VegaChart";
import { readVegaTokens } from "@/components/charts/vega/config";
import { useValueColors } from "@/components/dashboards/placementLook";
import { QUERY_DEFAULT } from "@/components/dashboards/QuerySetup";
import { openingDraft, rowsOnly, shapeAnswer, typedColumns } from "@/lib/dashboards/answerShape";
import { queryChartSpec, queryGrid, queryLookOf, type QueryChart } from "@/lib/dashboards/queryChart";

// The editor's lists live with the editor's model (`vizOptions.ts`); kept importable from here for the callers that
// already read them so.
export { LEGEND_POS, NUMBER_FORMATS, TOP_OPTIONS, TRANSFORM_OPTS } from "@/components/charts/vizOptions";

type Agg = "sum" | "avg" | "count" | "min" | "max";

const RATE_RE = /avg|average|mean|rate|ratio|share|pct|percent|proportion|margin|per_/i;
/** Grain-aware default aggregation: rate/share metrics average, additive metrics sum. */
function defaultAgg(metric: string): Agg {
  return RATE_RE.test(metric) ? "avg" : "sum";
}

function aggregate(xs: number[], agg: Agg): number | null {
  if (agg === "count") return xs.length;
  if (!xs.length) return null;
  switch (agg) {
    case "sum": return xs.reduce((a, b) => a + b, 0);
    case "avg": return xs.reduce((a, b) => a + b, 0) / xs.length;
    case "min": return Math.min(...xs);
    case "max": return Math.max(...xs);
  }
}

/** Project (and optionally re-aggregate) to a [dimension, metric] table — a display choice kept before the one editor
 *  (its `dim`/`metric`/`agg`), still drawn as it was. When a `colorField` is bound (and distinct from dim/metric), it is
 *  CARRIED THROUGH — the table becomes [dim, metric, colorField] aggregated by (dim, colorField). */
function derive(
  columns: string[], rows: unknown[][], dim: string, metric: string, agg: Agg, colorField?: string,
): { columns: string[]; rows: unknown[][] } {
  const di = columns.indexOf(dim);
  const mi = columns.indexOf(metric);
  if (di < 0 || mi < 0) return { columns, rows };
  const ci = colorField && colorField !== dim && colorField !== metric ? columns.indexOf(colorField) : -1;
  const outCol = agg === "count" ? "count" : metric;

  // With a colour binding: group by (dim, colorField) so the breakdown survives.
  if (ci >= 0) {
    const groups = new Map<string, { d: unknown; c: unknown; vals: number[] }>();
    const order: string[] = [];
    for (const r of rows) {
      const dv = (r as unknown[])[di], cv = (r as unknown[])[ci];
      const k = `${String(dv)}\u0000${String(cv)}`;
      if (!groups.has(k)) { groups.set(k, { d: dv, c: cv, vals: [] }); order.push(k); }
      const v = Number((r as unknown[])[mi]);
      if (!isNaN(v)) groups.get(k)!.vals.push(v);
    }
    // METRIC before the carried colour column: the resolver plots the FIRST numeric column.
    return { columns: [dim, outCol, colorField!], rows: order.map((k) => { const g = groups.get(k)!; return [g.d, aggregate(g.vals, agg), g.c]; }) };
  }

  const distinct = new Set(rows.map((r) => String((r as unknown[])[di])));
  const hasDups = distinct.size < rows.length;
  if (!hasDups && agg !== "count") {
    return { columns: [dim, metric], rows: rows.map((r) => [(r as unknown[])[di], (r as unknown[])[mi]]) };
  }
  const groups = new Map<string, number[]>();
  const order: string[] = [];
  for (const r of rows) {
    const k = String((r as unknown[])[di]);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    const v = Number((r as unknown[])[mi]);
    if (!isNaN(v)) groups.get(k)!.push(v);
  }
  return { columns: [dim, outCol], rows: order.map((k) => [k, aggregate(groups.get(k)!, agg)]) };
}

/** Chart settings without what is unset, so an untouched one keeps nothing. */
function cleanViz(v: VizConfig): VizConfig {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== "" && x !== null)) as VizConfig;
}

/** How a chart is dressed, as <Chart> reads it: the settings' format, legend, titles, tooltip, orientation, options
 *  and transform, over what the caller passed. Empty strings and absent fields keep the caller's. */
function customOf(base: ChartCustom | null | undefined, c: VizConfig, opts: { colorBound: boolean; valueCol: string; markersFalseOnly: boolean }): ChartCustom {
  const options: ChartOptions | null = opts.markersFalseOnly
    ? (() => { const o = chartOptionsOf(c); if (o && o.markers !== false) delete o.markers; return o && Object.keys(o).length ? o : null; })()
    : chartOptionsOf(c);
  return {
    ...(base || {}),
    ...(c.numberFormat ? { format: c.numberFormat } : {}),
    // A bound colour owns the legend (handled in the builder); otherwise the legend position applies to the series legend.
    ...(c.legend && !opts.colorBound ? { legend: c.legend as ChartCustom["legend"] } : {}),
    ...(c.xTitle ? { xTitle: c.xTitle } : {}),
    ...(c.yTitle ? { yTitle: c.yTitle } : {}),
    ...(c.tooltipOff ? { tooltip: "off" as const } : {}),
    ...(c.dateFormat ? { dateFormat: c.dateFormat } : {}),
    ...(c.orient ? { orient: c.orient } : {}),
    ...(options ? { options } : {}),
    ...(c.transform && c.transform !== "none" && opts.valueCol
      ? { transform: { op: c.transform, valueCol: opts.valueCol } as ChartCustom["transform"] } : {}),
  };
}

/** Reference lines and a colour binding laid over the caller's exhibit; the caller's exhibit itself when neither. */
function exhibitOf(base: ExhibitSpec | null, refLines: VizConfig["refLines"], color: ExhibitColor | null, emphasis?: unknown[] | null): ExhibitSpec | null {
  if (!refLines?.length && !color && !emphasis) return base;
  const spec: ExhibitSpec = { ...(base || {}) };
  if (refLines?.length) spec.ref_lines = [...(base?.ref_lines || []), ...refLines];
  if (color) spec.color = color;
  if (emphasis) spec.emphasis = emphasis as ExhibitSpec["emphasis"];
  return spec;
}

interface Props {
  columns: string[];
  rows: unknown[][];
  title?: string;
  /** Backend-suggested chart hint, respected until the user changes Display. */
  chartType?: string | null;
  chartConfig?: Record<string, unknown> | null;
  custom?: ChartCustom | null;
  /** Backend exhibit spec (semantic colour / ref-lines) — takes precedence over the
   *  one riding inside chartConfig; lets the deep-report path pass it explicitly. */
  exhibit?: ExhibitSpec | null;
  /** Authoritative per-column display unit from the backend finding (e.g. percent). */
  columnUnits?: Record<string, string> | null;
  /** Initial data-label visibility (the deep report ships labels on). */
  defaultShowLabels?: boolean;
  heightScale?: number;
  /** Fill an exact pixel height — for a resizeable card/canvas node (chart + table grow to fill). */
  fillHeight?: number | null;
  onSelect?: (datum: Record<string, unknown>) => void;
  /** A click on a mark, as the column and value it stands for (`charts/selection.ts`) — what a dashboard filters by.
   *  An axis, a legend or a mark standing for no single value is not reported. */
  onPick?: (pick: Pick, datum: Record<string, unknown>) => void;
  /** A stable name for this chart's editor — a dashboard card's id — so a panel elsewhere (the builder's Chart tab) can
   *  hold it. Left out, the chart names its own. */
  editorKey?: string;
  /** Draws the hover pencil that opens the chart's editor. A dashboard draws none (the user, 2026-11-19: two ways to edit
   *  a chart "causing a major issue"): there the card's own panel, in Edit, is the one way, and docks this same editor. */
  pencil?: boolean;
  /** The user's saved display choices, applied as the INITIAL state (read once per mount, so restoring a card and
   *  editing it can't fight each other). */
  config?: VizConfig | null;
  /** Fired whenever a person changes the chart in the editor, with the full config. The caller decides where it goes (a
   *  pinned card's `render`, or `viz_configs` for a card-less chart) and is expected to debounce. Absent → the chart is
   *  ephemeral, exactly as before. */
  onConfigChange?: (config: VizConfig) => void;
  /** The chart as it is drawn, for whoever offers to save it as a picture. */
  onChartReady?: (chart: ChartInstance) => void;
  /** A map answer is drawn as a map a person can pan and zoom, on the organisation's base map. Left out, as a still picture. */
  liveMap?: boolean;
  /** Fired with what the card is showing — on mount and on every switch — so a caller that offers its
   *  own "Table" disclosure can withhold it while the card already IS a table (2026-11-06). */
  onViewChange?: (view: "chart" | "table" | "pivot") => void;
}

const OWN = new Set(["bar", "line", "area", "scatter"]);

export function ResultChartCard({
  columns, rows, title, chartType, chartConfig, custom, exhibit: exhibitProp,
  columnUnits, defaultShowLabels, heightScale, fillHeight, onSelect, onPick, editorKey, pencil = true,
  config, onConfigChange, onViewChange, onChartReady,
  liveMap = false,
}: Props) {
  // Saved display choices seed the chart ONCE: a parent re-render — a refetch, or a debounced save echoing back — can't
  // yank a control out from under the person mid-edit. The component owns the chart from mount.
  const [seed] = useState<VizConfig>(() => config ?? {});
  const { numericIdxs, catIdxs, dateIdxs } = useMemo(() => classifyColumns(columns, rows), [columns, rows]);
  const chartTypes = useMemo(() => availableChartTypes(columns, rows), [columns, rows]);
  const offeredTypes = useMemo(
    () => (chartTypes.length ? [...chartTypes, ...ALL_CHART_TYPES.filter((t) => !chartTypes.includes(t))] : []),
    [chartTypes],
  );
  // The exhibit spec (semantic colour / reference lines) rides inside chart_config on the quick path, but it is NOT
  // field-role config: it must survive the person choosing a chart type, which nulls chartConfig below.
  const exhibit = useMemo(
    () => exhibitProp ?? (chartConfig?.exhibit as ExhibitSpec | undefined) ?? null,
    [exhibitProp, chartConfig],
  );
  const metricCols = useMemo(() => offeredMeasures(columns, numericIdxs).map((i) => columns[i]), [numericIdxs, columns]);
  const dimCols = useMemo(() => [...dateIdxs, ...catIdxs].map((i) => columns[i]), [dateIdxs, catIdxs, columns]);
  const canPivot = metricCols.length >= 1 && dimCols.length >= 1;

  // ── As answered: the chart nobody has set up in the one editor, drawn as before (a choice kept before it included) ──
  const defaultView: "chart" | "table" = chartTypes.length && !isUngraphableGrid(columns, rows) ? "chart" : "table";
  const legacyView = seed.view ?? defaultView;
  const seedLabels = seed.showLabels ?? defaultShowLabels ?? false;
  const defaultMetric = useMemo(
    () => metricCols.find((c) => /pct|percent|share|rate|ratio|proportion/i.test(c)) ?? metricCols[0] ?? "",
    [metricCols],
  );
  const metric = seed.metric ?? defaultMetric;
  const dim = seed.dim ?? dimCols[0] ?? "";
  const touched = !!(seed.metric || seed.dim || seed.agg);
  const data = useMemo(() => {
    if (!touched || !metric || !dim) return { columns, rows };
    return derive(columns, rows, dim, metric, seed.agg ?? defaultAgg(metric), seed.colorField || undefined);
  }, [touched, columns, rows, dim, metric, seed.agg, seed.colorField]);
  const legacyHint = seed.type && seed.type !== "auto" ? (TYPE_TO_HINT[seed.type] ?? "auto") : (chartType ?? "auto");
  // The backend chart config re-plots its OWN field + type, so it yields the moment a type, a transform or a reshape was chosen.
  const userChoseChart = touched || (!!seed.type && seed.type !== "auto") || (!!seed.transform && seed.transform !== "none");
  const legacyConfig = userChoseChart ? (chartConfig?.names ? { names: chartConfig.names } : null) : chartConfig ?? null;
  const legacyColor: ExhibitColor | null = useMemo(() => {
    if (!seed.colorField) return null;
    const scale = seed.colorScale || (metricCols.includes(seed.colorField) ? "continuous" : "categorical");
    return { mode: scale, field: seed.colorField, name: seed.colorName || null, legend: seed.legend || null };
  }, [seed, metricCols]);
  const legacyCustom = useMemo(() => customOf(custom, seed, { colorBound: !!seed.colorField, valueCol: metric, markersFalseOnly: true }),
    [custom, seed, metric]);
  const legacyExhibit = useMemo(() => exhibitOf(exhibit, seed.refLines, legacyColor), [exhibit, seed.refLines, legacyColor]);

  // ── The one editor ──
  const typed = useMemo(() => typedColumns(columns, rows), [columns, rows]);
  const [draft, setDraft] = useState<QueryDraft | null>(() => {
    if (!seed.shown) return null;
    const { shown, ...viz } = seed;
    return { shown: rowsOnly({ ...QUERY_DEFAULT, ...shown }), viz };
  });
  const [texts, setTexts] = useState(() => ({ yMin: seed.yMin !== undefined ? String(seed.yMin) : "", yMax: seed.yMax !== undefined ? String(seed.yMax) : "" }));
  const ownId = useId();
  const cardId = editorKey ?? ownId;
  const dock = useVizDock(cardId);
  const editorOpen = useVizEditorOpen(cardId);
  // Inside the app the editor opens as a tab of the side panel, among whatever else is open there, as the coworker's
  // does (the user, 2026-11-25); outside it — a shared page, a test — it is the drawer it always was.
  const inShell = useInShell();
  const inspector = useInspector();
  const openEditor = () => {
    if (inShell && !dock) inspector.inspect(vizSubject(cardId, title));
    else openVizEditor(cardId);
  };

  // Only an open editor, or a chart set up in it, reads what is drawn: a chart nobody edits resolves once, as before.
  const needs = editorOpen || !!draft;
  // What the chart as answered draws — its type and its fields, read off the very spec <Chart> renders.
  const asDrawn = useMemo(() => (needs ? resolveChart({
    columns: data.columns, rows: data.rows, chartType: legacyHint, chartConfig: legacyConfig, showLabels: seedLabels,
    custom: legacyCustom, exhibit: legacyExhibit, measure: seed.metric ?? null,
  }) : null), [needs, data, legacyHint, legacyConfig, seedLabels, legacyCustom, legacyExhibit, seed.metric]);
  // The type the chart as answered renders, as before: the kept pick, else the backend hint, else the data's shape — what
  // decides whether a map answer is drawn as a map.
  const legacyType = seed.type && seed.type !== "auto" ? seed.type
    : (HINT_TO_TYPE[(chartType ?? "").toLowerCase()] ?? inferChartType(columns, rows)?.type ?? "");
  const drawnAs = useMemo(() => {
    if (!needs) return null;
    const d = drawnType(asDrawn?.resolved);
    // a map, or a result no chart was drawn for: the type the chart as answered takes
    const type = (legacyType === "choropleth" || legacyType === "point-map") ? legacyType
      : d.type ?? (legacyType || null) ?? (offeredTypes[0] ?? null);
    const named = drawnOf(data.columns, data.rows, asDrawn);
    const has = (c: string | null) => (c && columns.includes(c) ? c : null);
    return { type: type as ChartType | null, across: d.across,
      fields: { x: has(named.x), measures: named.measures.filter((m) => columns.includes(m)), color: has(named.color) } };
  }, [needs, asDrawn, legacyType, columns, offeredTypes, data]);
  const opening = useMemo<QueryDraft | null>(() => (drawnAs ? openingDraft({
    columns: typed, view: legacyView, type: drawnAs.type, across: drawnAs.across, fields: drawnAs.fields, seed, labels: seedLabels,
  }) : null), [typed, legacyView, drawnAs, seed, seedLabels]);
  const current = draft ?? opening;

  const commit = (next: QueryDraft) => {
    const settled = { shown: rowsOnly(next.shown), viz: next.viz };
    setDraft(settled);
    // a chart set up in the one editor is kept as its setup and its settings; the fields kept before it are not
    const { metric: _m, dim: _d, agg: _a, colorField: _c, ...viz } = cleanViz(settled.viz);
    onConfigChange?.({ ...viz, shown: settled.shown });
  };

  const view: "chart" | "table" | "pivot" = draft
    ? (draft.viz.view === "pivot" ? "pivot" : draft.shown.as === "table" ? "table" : "chart") : legacyView;
  const viewChanged = useRef(onViewChange);
  viewChanged.current = onViewChange;
  useEffect(() => { viewChanged.current?.(view); }, [view]);

  // The answer's rows shaped as a dashboard card's run: what the shared drawing draws, and what the editor reads.
  const shaped = useMemo(() => (current ? shapeAnswer(typed, rows, current.shown, { transform: current.viz.transform, units: columnUnits }) : null),
    [typed, rows, current, columnUnits]);

  // Live chart instance (for the panel's Download PNG on a chromeless chart), engine-neutral.
  const instRef = useRef<ChartInstance | null>(null);
  const handleDownload = () => { void downloadChartPng(instRef.current, title || "chart"); };
  const ready = (inst: ChartInstance) => { instRef.current = inst; onChartReady?.(inst); };

  const kind = current ? kindOfDraft(current) : legacyType;
  const isMap = kind === "choropleth" || kind === "point-map";
  const model = current && queryEditorModel({
    title, draft: current, columns: typed, shaped, commit,
    texts, setText: (which, text) => setTexts((x) => ({ ...x, [which]: text })),
    rowsOnly: {
      otherKinds: offeredTypes, canPivot, label: cleanLabel,
      onDownload: view === "chart" && !(liveMap && isMap) && kind !== "figure" ? handleDownload : null,
    },
  });

  // ── What is drawn ──
  const keptColors = useValueColors();
  const emphasis = (exhibit?.emphasis as unknown[] | undefined) ?? null;
  const mapKind = (k: string) => (liveMap && view === "chart" ? (k === "choropleth" ? "shapes" : k === "point-map" ? "points" : null) : null);
  const height = fillHeight && fillHeight > 0 ? Math.round(fillHeight) : null;

  let body: React.ReactNode;
  if (!draft) {
    // as answered: the canonical chart over the answer's rows, as it always was
    const drawn = (
      <Chart columns={data.columns} rows={data.rows} measure={seed.metric ?? null} chartType={legacyHint} chartConfig={legacyConfig}
        exhibit={legacyExhibit} columnUnits={columnUnits} custom={legacyCustom} title={title} chrome={false} showLabels={seedLabels}
        heightScale={heightScale} fitHeight={fillHeight}
        onSelect={onSelect || onPick ? (datum) => {
          onSelect?.(datum);
          // read against the data drawn (the card's own aggregation applied) and the chart in force
          const pick = onPick ? pickOf(datum, data.columns, data.rows, legacyHint, dim || null) : null;
          if (pick) onPick?.(pick, datum);
        } : undefined}
        onInstanceReady={ready} />
    );
    const legacyMap = mapKind(legacyType);
    body = view === "pivot" ? <PivotTable columns={columns} rows={rows} />
      : view === "table" ? <SqlResultTable columns={data.columns} rows={data.rows} maxHeight={height ?? 340} />
        : legacyMap ? <AnswerMap columns={columns} rows={rows} kind={legacyMap} columnUnits={columnUnits} fallback={drawn} />
          : drawn;
  } else {
    body = <SetUp draft={draft} shaped={shaped!} columns={columns} rows={rows} chartConfig={chartConfig} exhibit={exhibit}
      custom={custom} columnUnits={columnUnits} title={title} heightScale={heightScale} height={height} emphasis={emphasis}
      keptColors={keptColors} as={drawnAs?.fields ?? { x: null, measures: [], color: null }} mapKind={mapKind(kind)} onSelect={onSelect} onPick={onPick} onReady={ready} />;
  }

  return (
    <div className="group/viz relative">
      {/* Edit visualization — the single hover affordance; every control lives in the panel. */}
      {pencil && <Button
        variant="ghost"
        size="icon-sm"
        onClick={openEditor}
        title="Edit visualization"
        className="absolute -top-1 right-0 z-10 opacity-0 group-hover/viz:opacity-100 transition-opacity"
        style={editorOpen ? { color: "var(--accent)", opacity: 1 } : { color: "var(--t3)" }}
      >
        <Icon name="edit" size={13} />
      </Button>}

      {/* Body — clean chart / table / pivot / figure */}
      {body}

      {editorOpen && model && typeof document !== "undefined" &&
        createPortal(<VizEditorPanel model={model} docked={!!dock} onClose={() => closeVizEditor(cardId)} />, dock ?? document.body)}
    </div>
  );
}

/** An answer's chart as a person set it up in the one editor: drawn as a dashboard draws a card of its own query. */
function SetUp({ draft, shaped, columns, rows, chartConfig, exhibit, custom, columnUnits, title, heightScale, height, emphasis,
  keptColors, as, mapKind, onSelect, onPick, onReady }: {
  draft: QueryDraft; shaped: ReturnType<typeof shapeAnswer>; columns: string[]; rows: unknown[][];
  chartConfig?: Record<string, unknown> | null; exhibit: ExhibitSpec | null; custom?: ChartCustom | null;
  columnUnits?: Record<string, string> | null; title?: string; heightScale?: number; height: number | null;
  emphasis: unknown[] | null; keptColors: Record<string, Record<string, number>> | null;
  /** The fields the chart was answered with: another kind draws the answer's own rows while they stand. */
  as: { x: string | null; measures: string[]; color: string | null };
  mapKind: "shapes" | "points" | null;
  onSelect?: (datum: Record<string, unknown>) => void; onPick?: (pick: Pick, datum: Record<string, unknown>) => void;
  onReady: (inst: ChartInstance) => void;
}) {
  const { shown, viz } = draft;
  const kind = kindOfDraft(draft);
  const said = "said" in shaped && shaped.said.length > 0 && (
    <div className="aug-fs-xs" data-testid="answer-chart-said" style={{ color: "var(--t3)" }}>{shaped.said.join(" ")}</div>
  );
  const own = OWN.has(kind) && shaped.as !== "table" && shaped.as !== "figure";
  const spec = useMemo(() => {
    if (!own) return null;
    const t = readVegaTokens();
    return queryChartSpec(shaped as QueryChart, shown, { palette: t.palette, other: t.deemph }, emphasis, keptColors?.[shown.split],
      chartOptionsOf(viz), queryLookOf(viz));
  }, [own, shaped, shown, emphasis, keptColors, viz]);

  if (kind === "pivot") return <PivotTable columns={columns} rows={rows} />;
  if (shaped.as === "table") {
    const fmt = viz.dateFormat;
    const dated = new Set(shaped.columns.filter((c) => /DATE|TIME/i.test(c.type)).map((c) => c.name));
    const names = shaped.columns.map((c) => c.name);
    const cells = fmt ? shaped.rows.map((r) => r.map((v, j) => (dated.has(names[j]) ? formatDateAs(v, fmt) ?? v : v))) : shaped.rows;
    return <>{<SqlResultTable columns={names} rows={cells} maxHeight={height ?? 340} />}{said}</>;
  }
  if (shaped.as === "figure") {
    return (
      <div data-testid="answer-figure" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 0" }}>
        <span className="aug-fs-display" style={{ lineHeight: 1.1, letterSpacing: "-0.02em", fontWeight: 600, color: "var(--t1)", fontVariantNumeric: "tabular-nums" }}>
          {formatMetricValue(shaped.value)}
        </span>
        <span className="aug-fs-sm" style={{ color: "var(--t3)" }}>{shaped.label}</span>
        {said}
      </div>
    );
  }
  if (own && spec) {
    const c = shaped as QueryChart;
    const places = new Set(c.points.map((p) => p.x)).size;
    const h = height ?? Math.round((shown.across && shown.as === "bar" ? Math.max(300, places * 24 + 60) : 300) * (heightScale ?? 1));
    return (
      <div data-testid="answer-chart" style={{ width: "100%" }}>
        <VegaChart spec={spec} tier={2} height={h} onReady={onReady}
          onSelect={onSelect || onPick ? (d) => {
            if (!d) return;
            onSelect?.(d);
            // the place a click stands for, as the answer returned it — never the words it was drawn with
            if (onPick && "xr" in d && d.xr !== null && d.xr !== undefined) onPick({ field: c.x.name, value: d.xr as string | number }, d);
          } : undefined} />
        {said}
      </div>
    );
  }
  // another kind, drawn by the answer's own engine: from its own rows while its fields are the ones it was answered with
  // (so a map keeps its places, a treemap its tiles), else from the shaped points, as a dashboard's other kinds are
  const sameFields = shown.x === (as.x ?? shown.x) && !shown.running
    && JSON.stringify(shown.series.map((s) => s.column)) === JSON.stringify(as.measures.length ? as.measures : shown.series.map((s) => s.column))
    && (shown.split || null) === (as.color ?? null);
  const grid = sameFields ? { columns, rows } : queryGrid(shaped as QueryChart, shown);
  const valueCol = shown.series[0]?.column ?? "";
  const color: ExhibitColor | null = shown.split && (!sameFields || viz.colorScale || viz.colorName)
    ? { mode: viz.colorScale || (typedKind(columns, rows, shown.split) === "number" ? "continuous" : "categorical"), field: shown.split,
        name: viz.colorName || null, legend: viz.legend || null }
    : null;
  const drawn = (
    <Chart columns={grid.columns} rows={grid.rows} measure={valueCol || null} chartType={TYPE_TO_HINT[kind as ChartType] ?? kind}
      chartConfig={chartConfig?.names ? { names: chartConfig.names } : null}
      exhibit={exhibitOf(exhibit, viz.refLines, color)} columnUnits={columnUnits}
      custom={customOf(custom, viz, { colorBound: !!color, valueCol, markersFalseOnly: true })} title={title} chrome={false}
      showLabels={!!viz.showLabels} heightScale={heightScale} fitHeight={height}
      onSelect={onSelect || onPick ? (datum) => {
        onSelect?.(datum);
        const pick = onPick ? pickOf(datum, grid.columns, grid.rows, kind, shown.x || null) : null;
        if (pick) onPick?.(pick, datum);
      } : undefined}
      onInstanceReady={onReady} />
  );
  return <>{mapKind ? <AnswerMap columns={columns} rows={rows} kind={mapKind} columnUnits={columnUnits} fallback={drawn} /> : drawn}{said}</>;
}

/** A column's kind as the answer's rows read it. */
function typedKind(columns: string[], rows: unknown[][], name: string): "number" | "other" {
  const i = columns.indexOf(name);
  return i >= 0 && classifyColumns(columns, rows).numericIdxs.includes(i) ? "number" : "other";
}

