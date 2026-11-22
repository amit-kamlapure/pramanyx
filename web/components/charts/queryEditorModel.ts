/**
 * The one chart editor's model, built one way for both of its callers (the owner, 2026-11-20: ONE chart editor
 * everywhere, and "Dashboard has the best one"):
 *
 *   - a dashboard card of a person's own query (`CardInspector.tsx` `QueryChartEditor`): its setup (`QueryShown`) is
 *     read again by the server, so every control is honoured — another date bucket, a calculation, the rows summed;
 *   - an answer's chart (`ResultChartCard.tsx`), ROWS ONLY: the answer's own rows are charted and nothing is asked
 *     again, so what only a re-query can honour is said, where its control would be, to need the question asked again
 *     (`withheld`), never offered as if it worked. An answer's own extras — Pivot, the kinds its rows draw (a map, a
 *     treemap), its transforms — sit in the same lists.
 *
 * One kind is in force, kept one way: the query's own (a table, a figure, a bar, a line, an area, a scatter) with its
 * setup, any other as the chart settings' `type` — choosing one of the query's own clears it. What each axis reads,
 * what colours it and what it labels is the setup; how it is dressed (format, titles, range, tooltip, lines) is the
 * chart settings. A pure function: the caller owns the draft and keeps each change.
 */
import type { ReactNode } from "react";
import { CHART_TYPE_LABEL, availableChartTypes, type ChartType } from "@/components/charts/chartTypeInference";
import { LEGEND_POS, NUMBER_FORMATS, TOP_OPTIONS, TRANSFORM_OPTS } from "@/components/charts/vizOptions";
import type { VizEditorModel, VizFieldKind, VizSelectOption, VizValueColor } from "@/components/charts/VizEditorPanel";
import type { VizConfig } from "@/components/charts/vizConfig";
import { readVegaTokens } from "@/components/charts/vega/config";
import { AGGS, BUCKETS, MAX_SERIES, MAX_TOP, kindOf, setupAs } from "@/components/dashboards/QuerySetup";
import type { QueryAgg, QueryBucket, QueryShaped, QueryShown, QueryShownAs, QuerySegments, TypedColumn } from "@/lib/api";
import { SERIES_SLOTS } from "@/lib/dashboards/catalog";
import { isOtherKind, queryGrid, seriesColours, xText } from "@/lib/dashboards/queryChart";
import { NEEDS_ASKING, rowsOnly } from "@/lib/dashboards/answerShape";
import { DATE_FORMATS, DATE_FORMAT_WORDS, type DateFormat } from "@/lib/format";

export const OWN_KINDS: ChartType[] = ["bar", "line", "area", "scatter"];
const BUCKET_FN: Record<string, string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", quarter: "QUARTERLY", year: "YEARLY" };

/** A chart's setup and its chart settings: what the one editor changes. */
export interface QueryDraft { shown: QueryShown; viz: VizConfig }

/** The dashboard's colours for a field's values (v17), kept on the whole dashboard. */
export interface KeptValueColors {
  kept: Record<string, Record<string, number>>;
  choose: (field: string, value: string, slot: number | null) => void;
}

/** What an answer's chart brings that a dashboard card does not, and the rule that nothing is asked again. */
export interface RowsOnly {
  /** The kinds beyond the query's own the answer's rows draw (a pie, a map, a treemap…), from the rows themselves. */
  otherKinds: ChartType[];
  /** The rows as a cross-tab, offered beside Table. */
  canPivot: boolean;
  transformErr?: string;
  onDownload?: (() => void) | null;
  /** What a column reads as to a person (`cleanLabel`: "order_date" → "Order date"); left out, its own name. */
  label?: (column: string) => string;
}

export interface QueryEditorInput {
  title?: string;
  draft: QueryDraft;
  columns: TypedColumn[];
  /** What is drawn now, shaped (a card's run, or an answer's rows shaped here): its series, its points. */
  shaped: QueryShaped | null;
  /** Keep a whole change — the setup and the settings together. */
  commit: (next: QueryDraft) => void;
  /** The value axis's range as typed, kept as typed while the number it makes is kept. */
  texts: { yMin: string; yMax: string };
  setText: (which: "yMin" | "yMax", text: string) => void;
  colors?: KeptValueColors | null;
  /** The dataset it is built on, and the way to another, said under its Visualization (2026-11-19). */
  dataset?: ReactNode;
  /** Absent: a dashboard card, re-queried. Given: an answer's own rows, charted as they are. */
  rowsOnly?: RowsOnly | null;
}

export const fieldKind = (type: string): VizFieldKind => {
  const k = kindOf(type);
  return k === "number" ? "number" : k === "text" ? "text" : "date";
};
const numberIn = (text: string): number | undefined => {
  const t = text.trim();
  return t && Number.isFinite(Number(t)) ? Number(t) : undefined;
};

/** The kind in force: Pivot, a kind of the chart settings', or the query's own. */
export function kindOfDraft(d: QueryDraft): string {
  if (d.viz.view === "pivot") return "pivot";
  const chart = d.shown.as !== "table" && d.shown.as !== "figure";
  return chart && isOtherKind(d.viz.type) ? String(d.viz.type) : d.shown.as;
}

/** The default way dates are written, said by an example of what the chart draws ("Default · Jul 2026"), never a
 *  placeholder (the user, 2026-11-20: "always a specific field.. always"). */
function drawnDateWords(shaped: QueryShaped | null): string {
  const points = shaped && "points" in shaped ? shaped.points : [];
  const x = shaped && "x" in shaped ? shaped.x : null;
  const first = points.find(p => p.x !== null && p.x !== undefined);
  if (!first || !x) return "Default";
  const temporal = x.kind === "date" || x.kind === "time";
  const wholeMonths = temporal && !x.bucket && points.length > 1 && points.every(p => String(p.x ?? "").slice(8, 10) === "01");
  const manyYears = temporal && new Set(points.map(p => String(p.x ?? "").slice(0, 4))).size > 1;
  const example = xText(first.x, x.kind, wholeMonths ? "month" : x.bucket, manyYears);
  return example === null || example === "" ? "Default" : `Default · ${example}`;
}

export function queryEditorModel(input: QueryEditorInput): VizEditorModel {
  const { draft, columns, shaped, commit, texts, setText, colors = null, dataset, title } = input;
  const ro = input.rowsOnly ?? null;
  const shown = draft.shown;
  const viz = draft.viz;
  const settle = (s: QueryShown) => (ro ? rowsOnly(s) : s);
  const put = (patch: Partial<QueryShown>) => commit({ ...draft, shown: settle({ ...shown, ...patch }) });
  const style = (patch: Partial<VizConfig>) => commit({ ...draft, viz: { ...viz, ...patch } });

  const typeOf = (name: string) => columns.find(c => c.name === name)?.type ?? "";
  const said = ro?.label ?? ((c: string) => c);
  const opt = (c: TypedColumn): VizSelectOption => ({ v: c.name, t: said(c.name), k: fieldKind(c.type) });
  const pivot = viz.view === "pivot";
  const chart = !pivot && shown.as !== "table" && shown.as !== "figure";
  const other = chart && isOtherKind(viz.type) ? String(viz.type) : null;
  const kind = kindOfDraft(draft);
  const others: ChartType[] = ro ? ro.otherKinds.filter(t => !OWN_KINDS.includes(t) && t !== "table")
    : (!shaped || shaped.as === "figure" || shaped.as === "table") ? []
      : (() => { const g = queryGrid(shaped, shown); return availableChartTypes(g.columns, g.rows).filter(t => !OWN_KINDS.includes(t) && t !== "counter"); })();
  const vizOptions: VizSelectOption[] = [
    ...OWN_KINDS.map(t => ({ v: t, t: CHART_TYPE_LABEL[t] })),
    ...[...others, ...(other && !others.includes(other as ChartType) ? [other as ChartType] : [])].map(t => ({ v: t, t: CHART_TYPE_LABEL[t] ?? t })),
    { v: "table", t: "Table" },
    ...(ro?.canPivot ? [{ v: "pivot", t: "Pivot" }] : []),
    { v: "figure", t: "Figure" },
  ];
  const setViz = (v: string) => {
    if (v === kind) return;
    const { type: _cleared, view: _view, ...rest } = viz as VizConfig & { type?: string };
    if (v === "pivot") {
      commit({ shown, viz: { ...viz, view: "pivot" } });
    } else if (v === "table" || v === "figure" || OWN_KINDS.includes(v as ChartType)) {
      // the query's own kind, kept with its setup; the chart settings' kind cleared, so nothing else draws it another way.
      // An answer's line shows its points unless told not to (`openingDraft`) — whichever kind it was switched from
      // (2026-11-23: Multi-line → Line hid them, though nobody turned them off).
      const kept = ro && v === "line" && viz.markers !== false ? { ...rest, markers: true } : rest;
      commit({ shown: settle(setupAs(shown, v as QueryShownAs, columns)), viz: kept });
    } else {
      const { view: _v, ...kept } = viz;
      commit({ shown: chart ? shown : settle(setupAs(shown, "bar", columns)), viz: { ...kept, type: v as ChartType } });
    }
  };

  const xKind = kindOf(typeOf(shown.x));
  const dated = (xKind === "date" || xKind === "time") && shown.as !== "scatter";
  const scatter = shown.as === "scatter";
  // rows only, nothing is calculated: each measure is drawn as the answer returns it
  const calculated = !ro && (shown.as === "figure" || (shown.summed && !scatter));
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
  const valueColors: VizValueColor[] | undefined = (() => {
    if (!colors || other || !shown.split || !shaped || !("series" in shaped)) return undefined;
    const named = shaped.series.filter(x => x && x !== "Other");
    if (named.length < 2) return undefined;
    const t = readVegaTokens();
    const forField = colors.kept[shown.split] ?? {};
    const drawn = seriesColours(named, { palette: t.palette, other: t.deemph }, shaped.tones ?? {}, forField);
    return named.map((value, i) => ({ value, color: drawn[i], slot: forField[value] ?? null,
      choose: (slot: number | null) => colors.choose(shown.split, value, slot) }));
  })();
  // rows only: what a re-query alone could honour, said where its control would be
  const withheld: NonNullable<VizEditorModel["withheld"]> = ro && chart ? [
    ...(dated ? [{ at: "x" as const, label: "Counted by", value: "As the answer returns it", why: `another bucket ${NEEDS_ASKING}` }] : []),
    ...(!scatter ? [
      { at: "y" as const, label: "Calculation", value: "As the answer returns it", why: `another ${NEEDS_ASKING}` },
      { at: "y" as const, label: "Rows", value: "As the answer returns them", why: `summed here ${NEEDS_ASKING}` },
    ] : []),
  ] : ro && shown.as === "figure" ? [
    { at: "y" as const, label: "Calculation", value: "The first row's value", why: `another ${NEEDS_ASKING}` },
  ] : [];
  // an answer's chart transforms its points, whatever draws them; a dashboard's query sums them itself (Rows, Running total)
  const transforms = ro ? (columns.some(c => kindOf(c.type) === "number") ? TRANSFORM_OPTS : []) : other ? TRANSFORM_OPTS : [];

  return {
    title,
    vizBelow: dataset,
    view: pivot ? "pivot" : chart ? "chart" : "table", setView: () => {}, chartAvailable: true, canPivot: !!ro?.canPivot,
    chartTypeValue: kind, chartTypeOptions: [], setChartType: setViz,
    vizValue: kind, vizOptions, setViz,
    // X axis: what runs along the bottom, and the buckets a date is counted in
    dimValue: shown.x,
    dimOptions: (scatter ? columns.filter(c => kindOf(c.type) !== "text") : columns).map(opt),
    setDim: v => put({ x: v, bucket: ["date", "time"].includes(kindOf(typeOf(v))) && !scatter ? (shown.bucket || "day") : "" }),
    dimLabel: !ro && dated && shown.bucket ? `${BUCKET_FN[shown.bucket]}(${shown.x})` : shown.x ? said(shown.x) : "Choose a field",
    bucketValue: !ro && dated ? shown.bucket || "day" : undefined,
    bucketOptions: !ro && dated ? BUCKETS.map(b => ({ v: b.value, t: b.label })) : undefined,
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
    summedValue: !ro && chart && !scatter ? shown.summed : undefined, setSummed: b => put({ summed: b }),
    runningValue: chart && !scatter ? shown.running : undefined, setRunning: b => put({ running: b }),
    withheld,
    // the bars' way round
    orientValue: other ? viz.orient ?? "" : shown.across ? "horizontal" : "",
    orientAvailable: bars,
    setOrient: v => (other ? style({ orient: v || undefined }) : put({ across: v === "horizontal" })),
    // a line's shape and markers; the value axis; the bars' order
    lineAvailable: lined,
    markersAvailable: other ? true : shown.as === "line",
    lineShapeValue: viz.lineShape ?? "", setLineShape: v => style({ lineShape: v || undefined }),
    // how its dates are written (2026-11-20: "put the month format as YYYY-MM"), wherever it has dates to write
    ...((chart ? dated : columns.some(c => ["date", "time"].includes(kindOf(c.type)))) ? {
      dateFormatValue: viz.dateFormat ?? "",
      dateFormatOptions: [{ v: "", t: drawnDateWords(shaped) }, ...DATE_FORMATS.map(f => ({ v: f, t: `${f} · ${DATE_FORMAT_WORDS[f]}` }))],
      setDateFormat: (v: string) => style({ dateFormat: (v || undefined) as DateFormat | undefined }),
    } : {}),
    // a query card's line width (2026-11-19): 2 is the default and is kept as nothing
    ...(!other && shown.as === "line" ? { lineWidthValue: String(viz.lineWidth ?? 2), setLineWidth: (v: string) => style({ lineWidth: v === "2" ? undefined : Number(v) }) } : {}),
    // a query card's line hides its points unless they are asked for; an answer's chart shows them unless they are not
    markersOn: other ? viz.markers !== false : viz.markers === true,
    setMarkersOn: b => style({ markers: other ? (b ? undefined : false) : (b ? true : undefined) }),
    yMinValue: texts.yMin, setYMin: t => { setText("yMin", t); style({ yMin: numberIn(t) }); },
    yMaxValue: texts.yMax, setYMax: t => { setText("yMax", t); style({ yMax: numberIn(t) }); },
    yLog: !!viz.yLog, setYLog: b => style({ yLog: b || undefined }),
    barSortAvailable: other ? bars : categories,
    sortValue: viz.sortBy ?? "", setSort: v => style({ sortBy: v || undefined }),
    topValue: viz.top ? String(viz.top) : "", topOptions: TOP_OPTIONS, setTop: v => style({ top: numberIn(v) }),
    transformValue: viz.transform ?? "none", transformOptions: transforms, transformErr: ro?.transformErr,
    setTransform: v => style({ transform: v === "none" ? undefined : v as VizConfig["transform"] }),
    // labels: the query's own, or the chart's
    labelsAvailable: !scatter,
    showLabels: other ? !!viz.showLabels : shown.labels,
    setShowLabels: b => (other ? style({ showLabels: b || undefined }) : put({ labels: b })),
    // Color: what splits it, how many of its values, how its parts stand, and each value's colour
    colorFieldValue: several ? "" : shown.split,
    colorFieldOptions: [{ v: "", t: "None" }, ...columns.filter(c => c.name !== shown.x).map(opt)],
    setColorField: v => (ro && other ? commit({ shown: settle({ ...shown, split: v }), viz: { ...viz, colorScale: undefined, ...(v ? {} : { colorName: undefined }) } }) : put({ split: v })),
    // an answer's own kinds colour by a measure as a scale, and name their legend; a query's split is always by category
    colorScaleAvailable: !!(ro && other),
    colorNote: several ? "Coloured by its measures: a chart of several is split by them." : undefined,
    colorScaleValue: viz.colorScale || (ro && other && shown.split ? (kindOf(typeOf(shown.split)) === "number" ? "continuous" : "categorical") : ""),
    setColorScale: v => style({ colorScale: v }),
    colorNameValue: viz.colorName ?? "", setColorName: v => style({ colorName: v || undefined }),
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
    measureLabel: shown.series[0]?.column ? said(shown.series[0].column) : "the rows",
    // a table: its columns and its order; a figure: the words under it
    ...(shown.as === "table" && !pivot ? {
      tableColumns: shown.columns, columnOptions: columns.map(opt), setTableColumns: (v: string[]) => put({ columns: v }),
      sortField: shown.sort, setSortField: (v: string) => put({ sort: v }),
      sortDescending: shown.descending, setSortDescending: (b: boolean) => put({ descending: b }),
    } : {}),
    ...(shown.as === "figure" && !pivot ? { figureLabel: shown.label, setFigureLabel: (v: string) => put({ label: v.slice(0, 60) }) } : {}),
    onDownload: ro?.onDownload ?? null,
  };
}
