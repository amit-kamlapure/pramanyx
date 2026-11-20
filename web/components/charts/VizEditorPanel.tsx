"use client";

/**
 * VizEditorPanel — the one chart editor: the drawer beside an answer's chart, and the panel a dashboard card is set up in
 * (the user, 2026-11-19: a dashboard keeps "almost entirely" how a chart is edited anywhere, laid out channel by channel
 * — "All fields are almost with +/- icons that open up properties.. such a nice way to do it").
 *
 * Each ENCODING CHANNEL (X axis · Y axis · Color) is a header with ⋮, its properties, and +, a field to add; each field in
 * it is a pill — its kind's glyph and what it reads, `SUM(revenue)`, `MONTHLY(order_date)` — that a click changes from a
 * searchable list of measures and fields, and − takes off. The marks and references follow one row each (Line shape,
 * Marker, Labels, Tooltip, Order, Transform, Annotation). Table and Pivot fold into the one Visualization dropdown. Every
 * control is the design system's own.
 *
 * It is a pure presentational component: it renders whatever the caller passes in the VizEditorModel. What a caller does
 * not offer (an absent field, an empty list) is not drawn. Single-instance drawering is the caller's (vizEditorStore +
 * portal).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "@radix-ui/themes";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select as UiSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** What a field holds, as its glyph says it and the field list groups it: a measure is a number. */
export type VizFieldKind = "number" | "date" | "text";

export interface VizSelectOption { v: string; t: string; k?: VizFieldKind }

/** A value a chart colours, the colour it is drawn in now, and the dashboard's kept slot for it (none: the next free). */
export interface VizValueColor { value: string; color: string; slot: number | null; choose: (slot: number | null) => void }

/** Everything the drawer needs to render + drive one chart's controls. The caller owns
 *  the state; the panel is stateless. `null`/empty option lists hide their section. */
export interface VizEditorModel {
  title?: string;
  // Visualization — view mode + chart type (folded into one dropdown here)
  view: "chart" | "table" | "pivot";
  setView: (v: "chart" | "table" | "pivot") => void;
  chartAvailable: boolean;
  canPivot: boolean;
  chartTypeValue: string;
  chartTypeOptions: VizSelectOption[];   // [] → not chartable (Table/Pivot only)
  setChartType: (v: string) => void;
  /** The whole Visualization list, when the caller has kinds of its own (a dashboard's own query: its table and its
   *  figure beside its charts). Given, it stands for chartTypeOptions + Table + Pivot. */
  vizValue?: string;
  vizOptions?: VizSelectOption[];
  setViz?: (v: string) => void;
  /** What the chart is built on, said under the Visualization dropdown (a dashboard's dataset, 2026-11-19). */
  vizBelow?: ReactNode;
  // X axis
  dimValue: string;
  dimOptions: VizSelectOption[];         // [] → no X control
  setDim: (v: string) => void;
  /** What the X pill reads (`MONTHLY(order_date)`); left out, the field's name. */
  dimLabel?: string;
  /** The buckets a date along X is counted in; absent, none offered. */
  bucketValue?: string;
  bucketOptions?: VizSelectOption[];
  setBucket?: (v: string) => void;
  // Y axis
  metricValue: string;
  metricOptions: VizSelectOption[];      // [] → no measure control
  setMetric: (v: string) => void;
  aggValue: string | null;               // null → hide aggregation (not meaningful)
  aggOptions: VizSelectOption[];
  setAgg: (v: string) => void;
  rateSummed: boolean;
  /** Several measures (a query's series), each with its own calculation; absent, the one metric above. */
  measures?: { column: string; agg: string | null }[];
  setMeasure?: (i: number, patch: { column?: string; agg?: string }) => void;
  /** + on the Y axis: another measure, of the field chosen. */
  addMeasure?: ((column: string) => void) | null;
  removeMeasure?: ((i: number) => void) | null;
  /** The calculations a measure of `measures` may take; a count needs no column. */
  measureAggOptions?: VizSelectOption[];
  runningValue?: boolean;
  setRunning?: (b: boolean) => void;
  summedValue?: boolean;
  setSummed?: (b: boolean) => void;
  // Orientation — swap which axis carries the measure. Empty string = let the chart decide.
  orientValue: "" | "vertical" | "horizontal";
  orientAvailable: boolean;
  setOrient: (v: "" | "vertical" | "horizontal") => void;
  // The chart options (the dashboards study, R12)
  lineAvailable: boolean;
  /** A line's markers are offered (an area has none to show). Left out, with the line. */
  markersAvailable?: boolean;
  lineShapeValue: "" | "smooth" | "step";
  setLineShape: (v: "" | "smooth" | "step") => void;
  /** A line's width, "1" to "6"; left out, not offered. */
  lineWidthValue?: string;
  setLineWidth?: (v: string) => void;
  /** How the card's dates are written, along the bottom or in its table; left out, not offered (no dates to write). */
  dateFormatValue?: string;
  dateFormatOptions?: VizSelectOption[];
  setDateFormat?: (v: string) => void;
  markersOn: boolean;
  setMarkersOn: (b: boolean) => void;
  yMinValue: string;
  setYMin: (v: string) => void;
  yMaxValue: string;
  setYMax: (v: string) => void;
  yLog: boolean;
  setYLog: (b: boolean) => void;
  barSortAvailable: boolean;
  sortValue: "" | "value" | "label";
  setSort: (v: "" | "value" | "label") => void;
  topValue: string;
  topOptions: VizSelectOption[];
  setTop: (v: string) => void;
  // Transform (post-processing)
  transformValue: string;
  transformOptions: VizSelectOption[];
  setTransform: (v: string) => void;
  transformErr?: string;
  // Labels
  labelsAvailable?: boolean;
  showLabels: boolean;
  setShowLabels: (b: boolean) => void;
  // Color binding — colour marks by a CHOSEN field: a dimension → discrete legend, a
  // measure → gradient legend. Scale type auto-defaults by the field's role, overridable.
  colorFieldValue: string;
  colorFieldOptions: VizSelectOption[];
  setColorField: (v: string) => void;
  /** False: the colour is always by category (a query's split), so no scale type or display name is offered. */
  colorScaleAvailable?: boolean;
  /** Said in place of a colour field, where the chart is coloured another way (several measures, by measure). */
  colorNote?: string;
  colorScaleValue: "" | "continuous" | "categorical";
  setColorScale: (v: "continuous" | "categorical") => void;
  colorNameValue: string;
  setColorName: (v: string) => void;
  legendValue: string;
  legendOptions: VizSelectOption[];
  setLegend: (v: string) => void;
  /** Only the largest values of the colour field, the rest as Other. */
  colorTopValue?: string;
  colorTopOptions?: VizSelectOption[];
  setColorTop?: (v: string) => void;
  /** How the coloured parts stand: stacked, side by side, as shares. */
  segmentsValue?: string;
  segmentsOptions?: [string, string][];
  setSegments?: (v: string) => void;
  /** Each value's colour, kept on the dashboard; the number of colours a value may be given. */
  colorValues?: VizValueColor[];
  colorSlots?: number;
  // Format & axis titles
  numberFormatValue: string;
  numberFormatOptions: VizSelectOption[];
  setNumberFormat: (v: string) => void;
  xTitleValue: string;
  setXTitle: (v: string) => void;
  yTitleValue: string;
  setYTitle: (v: string) => void;
  // Tooltip
  tooltipOn: boolean;
  setTooltipOn: (b: boolean) => void;
  // Annotation (reference lines)
  refLines: { label: string; value: number }[];
  addRefLine: (value: number, label: string) => void;
  addAverageLine: () => void;
  removeRefLine: (idx: number) => void;
  measureLabel: string;
  // A table of rows (a query shown as its rows): the columns it shows, none for every one, and its order
  tableColumns?: string[];
  columnOptions?: VizSelectOption[];
  setTableColumns?: (v: string[]) => void;
  sortField?: string;
  setSortField?: (v: string) => void;
  sortDescending?: boolean;
  setSortDescending?: (b: boolean) => void;
  // A figure: the one value, and the words under it
  figureLabel?: string;
  setFigureLabel?: (v: string) => void;
  // Export
  onDownload?: (() => void) | null;
}

// ── primitives ────────────────────────────────────────────────────────────────

const ROW: React.CSSProperties = { padding: "12px 16px", borderBottom: "1px solid var(--b1)", display: "flex", flexDirection: "column", gap: 8 };
const TITLE: React.CSSProperties = { fontWeight: 600, color: "var(--t1)" };

/** The app's design-system dropdown (Base UI), wrapped to the panel's {value, options, onChange}
 *  API. Portals its menu to <body> — the drawer's outside-click handler guards for that. */
function Select({ value, options, onChange, leading, label }: {
  value: string; options: VizSelectOption[]; onChange: (v: string) => void; leading?: ReactNode; label?: string;
}) {
  const items = Object.fromEntries(options.map((o) => [o.v, o.t]));
  return (
    <UiSelect value={value} onValueChange={(v) => onChange((v ?? "") as string)} items={items}>
      <SelectTrigger className="w-full" aria-label={label}>
        {leading}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.v} value={o.v}>{o.t}</SelectItem>)}
      </SelectContent>
    </UiSelect>
  );
}

/** Words typed into the panel: kept as they are typed, where the caller saves each change; on leaving the field otherwise. */
function TextInput({ value, placeholder, onChange, label }: { value: string; placeholder?: string; onChange: (v: string) => void; label?: string }) {
  return <Input aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** A label above its control (the stacked layout the properties use). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="aug-fs-xs" style={{ fontWeight: 500, color: "var(--t3)" }}>{label}</span>
      {children}
    </label>
  );
}

/** A plain titled section (the Visualization dropdown). */
function Section({ title, right, children, testid }: { title: string; right?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} style={ROW}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 24 }}>
        <span className="aug-fs-chrome" style={TITLE}>{title}</span>
        {right && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** An encoding channel: its title, ⋮ for its properties and + for a field to add; its fields
 *  beneath, each a pill; the properties open under them. */
function Channel({ title, props, add, children, testid }: {
  title: string; props?: ReactNode; add?: ReactNode; children?: ReactNode; testid?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testid} style={ROW}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, minHeight: 24 }}>
        <span className="aug-fs-chrome" style={TITLE}>{title}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 }}>
          {props && (
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              aria-label={`${title}: properties`} title="Properties" data-testid="viz-props-open"
              style={{ color: open ? "var(--accent)" : "var(--t3)" }}>
              <Icon name="morev" size={14} />
            </Button>
          )}
          {add}
        </div>
      </div>
      {children}
      {props && open && (
        <div data-testid="viz-props" style={{ display: "flex", flexDirection: "column", gap: 9, padding: "10px 10px", border: "1px solid var(--b1)", borderRadius: "var(--r2)", background: "var(--bg-1)" }}>
          {props}
        </div>
      )}
    </div>
  );
}

/** A one-control row that reads as a section header (Labels, Tooltip, Marker, Line shape). */
function ToggleRow({ title, on, onChange }: { title: string; on: boolean; onChange: (b: boolean) => void }) {
  return (
    <div style={{ ...ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <span className="aug-fs-chrome" style={TITLE}>{title}</span>
      <Switch aria-label={title} checked={on} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

/** A segmented control (Categorical | Continuous). */
function SegToggle<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: "1px solid var(--b2)", borderRadius: "var(--r2)", padding: 3, alignSelf: "flex-start", background: "var(--bg-1)", flexWrap: "wrap" }}>
      {options.map(([v, text]) => {
        const on = value === v;
        return (
          <Button key={v} variant="ghost" size="xs" onClick={() => onChange(v)} role="radio" aria-checked={on}
            className="!h-6 !px-2.5 !rounded-[var(--r2)] !font-medium"
            style={on ? { background: "var(--bg-sel)", color: "var(--accent)" } : { color: "var(--t3)" }}>
            {text}
          </Button>
        );
      })}
    </div>
  );
}

function Warn({ text }: { text: string }) {
  return <div className="aug-fs-xs" style={{ color: "var(--amb4)" }}>⚠ {text}</div>;
}

const GLYPH: Record<VizFieldKind, IconName> = { number: "num", date: "date", text: "text" };

/** A field's glyph: a measure's number, a date's calendar, words' letters. */
function Glyph({ kind }: { kind?: VizFieldKind }) {
  return <span aria-hidden style={{ color: "var(--t3)", display: "inline-flex", flexShrink: 0 }}><Icon name={GLYPH[kind ?? "text"]} size={14} /></span>;
}

/**
 * The list a field is chosen from: a search, then the measures, then the other fields, each with
 * its glyph. Where the field is calculated, its calculation is chosen above the list. Opened by its trigger (a pill, or +).
 */
function FieldPicker({ options, value, onPick, aggs, agg, onAgg, trigger, label }: {
  options: VizSelectOption[]; value?: string; onPick: (v: string) => void;
  aggs?: VizSelectOption[]; agg?: string | null; onAgg?: (v: string) => void;
  trigger: ReactNode; label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.t.toLowerCase().includes(t) || o.v.toLowerCase().includes(t)) : options;
  }, [options, q]);
  const measures = found.filter((o) => o.k === "number");
  const fields = found.filter((o) => o.k !== "number");
  const choose = (v: string) => { onPick(v); setOpen(false); setQ(""); };
  const group = (title: string, list: VizSelectOption[]) => list.length > 0 && (
    <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column" }}>
      <span className="aug-fs-xs" style={{ color: "var(--t3)", padding: "6px 8px 2px" }}>{title}</span>
      {list.map((o) => (
        <Button key={o.v || "∅"} variant="ghost" size="xs" role="option" aria-selected={o.v === value} data-testid="viz-field-option"
          onClick={() => choose(o.v)}
          style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "5px 8px", fontWeight: o.v === value ? 600 : 400, color: "var(--t1)" }}>
          <Glyph kind={o.k} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.t}</span>
        </Button>
      ))}
    </div>
  );
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <Popover.Trigger>{trigger}</Popover.Trigger>
      <Popover.Content size="1" align="end" data-testid="viz-field-picker" aria-label={label}
        style={{ width: 260, maxWidth: "calc(100vw - 32px)", padding: 6 }}>
        {aggs && aggs.length > 0 && onAgg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 4px 8px", borderBottom: "1px solid var(--b1)", marginBottom: 6 }}>
            <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Calculation</span>
            <div role="radiogroup" aria-label="Calculation" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {aggs.map((a) => (
                <Button key={a.v} size="xs" variant={a.v === agg ? "secondary" : "ghost"} role="radio" aria-checked={a.v === agg}
                  onClick={() => onAgg(a.v)}>{a.t}</Button>
              ))}
            </div>
          </div>
        )}
        <Input aria-label="Search the fields" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div role="listbox" aria-label={label} style={{ maxHeight: 280, overflowY: "auto", marginTop: 4 }}>
          {group("Measures", measures)}
          {group("Fields", fields)}
          {!found.length && <div className="aug-fs-xs" style={{ color: "var(--t3)", padding: 8 }}>No field is called that.</div>}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

/** The + of a channel: a field to add, from the list. */
function AddField({ title, options, onPick, aggs, agg, onAgg }: {
  title: string; options: VizSelectOption[]; onPick: (v: string) => void;
  aggs?: VizSelectOption[]; agg?: string | null; onAgg?: (v: string) => void;
}) {
  return (
    <FieldPicker options={options} onPick={onPick} aggs={aggs} agg={agg} onAgg={onAgg} label={`${title}: a field to add`}
      trigger={(
        <Button variant="ghost" size="icon-sm" aria-label={`${title}: add a field`} title="Add a field" data-testid="viz-add-field" style={{ color: "var(--t3)" }}>
          <Icon name="plus" size={14} />
        </Button>
      )} />
  );
}

/** A field in a channel: its glyph and what it reads, a click to change it (and its calculation), − to take it off. */
function FieldPill({ kind, text, options, value, onPick, onRemove, aggs, agg, onAgg, title }: {
  kind?: VizFieldKind; text: string; options: VizSelectOption[]; value: string; onPick: (v: string) => void;
  onRemove?: (() => void) | null; aggs?: VizSelectOption[]; agg?: string | null; onAgg?: (v: string) => void; title: string;
}) {
  return (
    <div data-testid="viz-field" style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <FieldPicker options={options} value={value} onPick={onPick} aggs={aggs} agg={agg} onAgg={onAgg} label={`${title}: choose the field`}
        trigger={(
          <Button variant="secondary" size="sm" aria-label={`${title}: ${text}`} title={text}
            style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", gap: 8, fontWeight: 600 }}>
            <Glyph kind={kind} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
          </Button>
        )} />
      {onRemove ? (
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Take ${text} off ${title}`} title="Take it off" style={{ color: "var(--t3)" }}>
          <Icon name="minus" size={14} />
        </Button>
      ) : <span aria-hidden style={{ width: 28, flexShrink: 0 }} />}
    </div>
  );
}

/** A value's colour: its swatch, and a click to keep it in another of the chart's colours (or let it take the next free). */
function ValueSwatch({ v, slots }: { v: VizValueColor; slots: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="aug-fs-sm" title={v.value} style={{ flex: 1, minWidth: 0, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.value}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger>
          <Button variant="ghost" size="icon-sm" aria-label={`${v.value}: its colour`} data-testid="viz-value-color" title={v.slot ? "Kept on the dashboard" : "The next free colour"}>
            <span aria-hidden style={{ width: 16, height: 16, borderRadius: 4, background: v.color, outline: v.slot ? "1.5px solid var(--t1)" : undefined, outlineOffset: 1 }} />
          </Button>
        </Popover.Trigger>
        <Popover.Content size="1" align="end" style={{ padding: 6 }}>
          <div role="radiogroup" aria-label={`${v.value}: its colour`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {Array.from({ length: slots }, (_, i) => i + 1).map((n) => (
              <Button key={n} size="icon-xs" variant="ghost" role="radio" aria-checked={v.slot === n} aria-label={`Colour ${n}`}
                data-testid={`kept-color-${n}`} onClick={() => { v.choose(v.slot === n ? null : n); setOpen(false); }}
                style={{ outline: v.slot === n ? "2px solid var(--t1)" : undefined, outlineOffset: 1 }}>
                <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, background: `var(--chart-${n})` }} />
              </Button>
            ))}
            <Button size="xs" variant="ghost" disabled={!v.slot} onClick={() => { v.choose(null); setOpen(false); }}>Auto</Button>
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}

// Annotation channel owns the "add a line" input state (the panel is otherwise stateless).
function AnnotationSection({ model }: { model: VizEditorModel }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const [label, setLabel] = useState("");
  const add = () => {
    const n = Number(val);
    if (val && !Number.isNaN(n)) { model.addRefLine(n, label); setVal(""); setLabel(""); setAdding(false); }
  };
  return (
    <Channel title="Annotation" testid="viz-channel-annotation"
      add={(
        <Button variant="ghost" size="icon-sm" aria-label="Annotation: add a reference line" title="Add a reference line" aria-expanded={adding}
          onClick={() => setAdding((a) => !a)} style={{ color: adding ? "var(--accent)" : "var(--t3)" }}>
          <Icon name="plus" size={14} />
        </Button>
      )}>
      {model.refLines.map((l, i) => (
        <div key={i} className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t2)" }}>
          <span style={{ width: 12, borderTop: "1.5px dashed var(--t3)" }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label} · {l.value}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => model.removeRefLine(i)} aria-label={`Take ${l.label} off`} title="Take it off" style={{ color: "var(--t3)" }}>
            <Icon name="minus" size={14} />
          </Button>
        </div>
      ))}
      {adding && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Input type="number" value={val} placeholder="value" aria-label="The line's value" className="w-[76px]"
              onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Input value={label} placeholder="label" aria-label="The line's label" className="flex-1 min-w-0"
              onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Button variant="secondary" size="xs" onClick={add} disabled={!val}>Add</Button>
          </div>
          <Button variant="ghost" size="xs" onClick={() => { model.addAverageLine(); setAdding(false); }} style={{ alignSelf: "flex-start", color: "var(--t2)" }}>
            + Average of {model.measureLabel}
          </Button>
        </>
      )}
      {!model.refLines.length && !adding && <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>No reference line. + adds one.</div>}
    </Channel>
  );
}

const VIZ_ICON: Record<string, IconName> = {
  table: "table", __table__: "table", pivot: "viewgrid", __pivot__: "viewgrid", figure: "num", counter: "num",
  line: "trendup", multi_line: "trendup", forecast: "trendup", area: "trendup", scatter: "graph",
};

/** A measure as its pill says it: `SUM(revenue)`, `COUNT(*)`; the field alone where nothing is calculated. */
export function measureWords(column: string, agg: string | null | undefined, label = column): string {
  if (!agg) return label || column;
  const fn = agg === "count_distinct" ? "COUNT DISTINCT" : agg.toUpperCase();
  return `${fn}(${column ? label : "*"})`;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function VizEditorPanel({ model, onClose, docked = false }: { model: VizEditorModel; onClose: () => void; docked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // Escape closes; a click outside the drawer closes — EXCEPT clicks in a design-system Select
  // menu or a field list, which portal to <body> (a click there, or a dismiss while one is open, is theirs
  // to handle, not the drawer's). The listener is attached on mount, AFTER the opening pencil click.
  useEffect(() => {
    if (docked) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('[data-slot="select-content"], [data-radix-popper-content-wrapper], .rt-PopoverContent')) return;
      if (document.querySelector('[data-slot="select-content"][data-open], .rt-PopoverContent')) return;  // a menu is open → dismiss it
      if (ref.current && !ref.current.contains(t as globalThis.Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose, docked]);

  const chartMode = model.view === "chart" && model.chartAvailable;

  // Table + Pivot fold into the ONE Visualization dropdown, alongside the
  // chart types. Selecting Table/Pivot switches the view; a chart type switches to chart view.
  const VIZ_TABLE = "__table__", VIZ_PIVOT = "__pivot__";
  const vizValue = model.vizValue ?? (model.view === "table" ? VIZ_TABLE : model.view === "pivot" ? VIZ_PIVOT : model.chartTypeValue);
  const vizOptions: VizSelectOption[] = model.vizOptions ?? [
    ...model.chartTypeOptions,
    { v: VIZ_TABLE, t: "Table" },
    ...(model.canPivot ? [{ v: VIZ_PIVOT, t: "Pivot" }] : []),
  ];
  const setViz = model.setViz ?? ((v: string) => {
    if (v === VIZ_TABLE) model.setView("table");
    else if (v === VIZ_PIVOT) model.setView("pivot");
    else { model.setView("chart"); model.setChartType(v); }
  });

  const kindOf = (options: VizSelectOption[], v: string) => options.find((o) => o.v === v)?.k;
  const nameOf = (options: VizSelectOption[], v: string) => options.find((o) => o.v === v)?.t ?? v;

  // The Y axis: the caller's several measures, or the one metric and its calculation
  const measures = model.measures ?? (model.metricOptions.length
    ? [{ column: model.metricValue, agg: model.aggValue }] : []);
  const measureAggs = model.measures ? model.measureAggOptions : (model.aggValue != null ? model.aggOptions : undefined);
  const setMeasure = (i: number, patch: { column?: string; agg?: string }) => {
    if (model.setMeasure) { model.setMeasure(i, patch); return; }
    if (patch.column !== undefined) model.setMetric(patch.column);
    if (patch.agg !== undefined) model.setAgg(patch.agg);
  };
  const figure = model.figureLabel !== undefined;
  const table = model.tableColumns !== undefined;
  const yTitle = figure ? "Value" : "Y axis";

  const yProps = (
    <>
      {model.summedValue !== undefined && model.setSummed && (
        <Field label="Rows">
          <SegToggle label="Rows" value={model.summedValue ? "summed" : "as"} onChange={(v) => model.setSummed?.(v === "summed")}
            options={[["summed", "Summed here"], ["as", "As the query returns them"]]} />
        </Field>
      )}
      {model.runningValue !== undefined && model.setRunning && (
        <Field label="Running total">
          <SegToggle label="Running total" value={model.runningValue ? "on" : "off"} onChange={(v) => model.setRunning?.(v === "on")}
            options={[["off", "Each place"], ["on", "Running total"]]} />
        </Field>
      )}
      {!figure && <Field label="Number format"><Select label="Number format" value={model.numberFormatValue} options={model.numberFormatOptions} onChange={model.setNumberFormat} /></Field>}
      {!figure && <Field label="Axis title"><TextInput label="Y axis title" value={model.yTitleValue} placeholder="auto" onChange={model.setYTitle} /></Field>}
      {/* the value axis's range and scale (study R12): unset is what the data asks */}
      {!figure && (
        <Field label="Range">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <TextInput label="Lowest on the value axis" value={model.yMinValue} placeholder="lowest: auto" onChange={model.setYMin} />
            <TextInput label="Highest on the value axis" value={model.yMaxValue} placeholder="highest: auto" onChange={model.setYMax} />
          </div>
        </Field>
      )}
      {!figure && (
        <Field label="Scale">
          <SegToggle label="Value scale" value={model.yLog ? "log" : "linear"} onChange={(v) => model.setYLog(v === "log")}
            options={[["linear", "Linear"], ["log", "Log"]]} />
        </Field>
      )}
    </>
  );
  const hasYProps = !figure || (model.summedValue !== undefined && !!model.setSummed);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Edit visualization"
      data-testid="viz-editor"
      className={docked ? undefined : "animate-in slide-in-from-right-8 fade-in-0 duration-150"}
      // No z-index: it is portalled into <body> after the page, which is one layer (.aug-root),
      // so it is above the page already — and a select opened inside it, portalled after IT,
      // is above this. A z-index here would put that menu underneath.
      // docked (the board study): drawn in the place that holds it — the builder's card panel — as part of that panel
      style={docked ? { display: "flex", flexDirection: "column" } : {
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(340px, 92vw)",
        background: "var(--bg-2)", borderLeft: "1px solid var(--b2)",
        boxShadow: "-8px 0 28px -12px rgba(0,0,0,.55)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* Header — the drawer's own; docked, the panel holding it is titled already */}
      {!docked && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--b1)" }}>
          <div style={{ minWidth: 0 }}>
            <div className="aug-fs-chrome" style={TITLE}>Edit visualization</div>
            {model.title && (
              <div className="aug-fs-xs" style={{ color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 250 }} title={model.title}>
                {model.title}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {model.onDownload && (
              <Button variant="ghost" size="icon-sm" onClick={model.onDownload} title="Download PNG" aria-label="Download PNG" style={{ color: "var(--t3)" }}>
                <Icon name="download" size={15} />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close" aria-label="Close" style={{ color: "var(--t3)" }}>
              <Icon name="close" size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Sections */}
      <div style={docked ? undefined : { overflowY: "auto", flex: 1 }}>
        <Section title="Visualization" testid="viz-visualization"
          right={docked && model.onDownload ? (
            <Button variant="ghost" size="icon-sm" onClick={model.onDownload} title="Download PNG" aria-label="Download PNG" style={{ color: "var(--t3)" }}>
              <Icon name="download" size={14} />
            </Button>
          ) : undefined}>
          <Select label="Visualization" value={vizValue} options={vizOptions} onChange={setViz}
            leading={<span style={{ color: "var(--accent)", flexShrink: 0, display: "inline-flex", marginRight: 6 }}><Icon name={VIZ_ICON[vizValue] ?? "chart"} size={15} /></span>} />
          {model.vizBelow}
        </Section>

        {chartMode && model.dimOptions.length > 0 && (
          <Channel title="X axis" testid="viz-channel-x"
            props={(
              <>
                {model.bucketOptions && model.bucketOptions.length > 0 && model.setBucket && (
                  <Field label="Counted by"><Select label="Counted by" value={model.bucketValue ?? ""} options={model.bucketOptions} onChange={model.setBucket} /></Field>
                )}
                <Field label="Axis title"><TextInput label="X axis title" value={model.xTitleValue} placeholder="auto" onChange={model.setXTitle} /></Field>
                {model.orientAvailable && (
                  <Field label="Orientation">
                    <SegToggle label="Orientation" value={model.orientValue} onChange={model.setOrient}
                      options={[["", "Auto"], ["vertical", "Vertical"], ["horizontal", "Horizontal"]]} />
                  </Field>
                )}
              </>
            )}>
            <FieldPill title="X axis" kind={kindOf(model.dimOptions, model.dimValue)}
              text={model.dimLabel ?? nameOf(model.dimOptions, model.dimValue)}
              options={model.dimOptions} value={model.dimValue} onPick={model.setDim} />
          </Channel>
        )}

        {chartMode && model.orientAvailable && model.dimOptions.length > 0 && measures.length > 0 && (
          // swap the axes (⇅): the bars run the other way
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", marginTop: -1, marginBottom: -1, position: "relative" }}>
            <span style={{ flex: 1, borderTop: "1px solid var(--b1)" }} />
            <Button variant="ghost" size="icon-sm" data-testid="viz-swap-axes" aria-label="Swap the axes"
              title={model.orientValue === "horizontal" ? "The bars run sideways: swap them upright" : "Swap the axes: the bars run sideways"}
              onClick={() => model.setOrient(model.orientValue === "horizontal" ? "vertical" : "horizontal")} style={{ color: "var(--t3)" }}>
              <Icon name="sort" size={14} />
            </Button>
            <span style={{ flex: 1, borderTop: "1px solid var(--b1)" }} />
          </div>
        )}

        {(chartMode || figure) && measures.length > 0 && (
          <Channel title={yTitle} testid="viz-channel-y" props={hasYProps ? yProps : undefined}
            add={model.addMeasure ? (
              <AddField title={yTitle} options={model.metricOptions} onPick={(v) => model.addMeasure?.(v)} />
            ) : undefined}>
            {measures.map((m, i) => (
              <FieldPill key={i} title={yTitle} kind={m.column ? kindOf(model.metricOptions, m.column) ?? "number" : "number"}
                text={measureWords(m.column, m.agg, nameOf(model.metricOptions, m.column))}
                options={model.metricOptions} value={m.column} onPick={(v) => setMeasure(i, { column: v })}
                aggs={measureAggs} agg={m.agg} onAgg={measureAggs ? (v) => setMeasure(i, { agg: v }) : undefined}
                onRemove={model.removeMeasure && measures.length > 1 ? () => model.removeMeasure?.(i) : null} />
            ))}
            {model.rateSummed && <Warn text="summing a rate — AVG is the grain-correct aggregate" />}
            {figure && model.setFigureLabel && (
              <Field label="Said under it"><TextInput label="Said under the figure" value={model.figureLabel ?? ""} placeholder="The figure's label" onChange={model.setFigureLabel} /></Field>
            )}
          </Channel>
        )}

        {chartMode && (model.colorFieldOptions.length > 1 || model.colorNote) && (
          <Channel title="Color" testid="viz-channel-color"
            props={model.colorFieldValue || model.colorNote ? (
              <>
                {model.colorTopOptions && model.setColorTop && model.colorFieldValue && (
                  <Field label="Values"><Select label="How many values" value={model.colorTopValue ?? ""} options={model.colorTopOptions} onChange={model.setColorTop} /></Field>
                )}
                {model.segmentsOptions && model.setSegments && (
                  <Field label="Parts">
                    <SegToggle label="Parts" value={model.segmentsValue ?? ""} onChange={(v) => model.setSegments?.(v)} options={model.segmentsOptions} />
                  </Field>
                )}
                {model.colorScaleAvailable !== false && model.colorFieldValue && (
                  <>
                    <Field label="Scale type">
                      <SegToggle label="Scale type" value={model.colorScaleValue || "categorical"} onChange={model.setColorScale}
                        options={[["categorical", "Categorical"], ["continuous", "Continuous"]]} />
                    </Field>
                    <Field label="Display name"><TextInput label="Display name" value={model.colorNameValue} placeholder="auto" onChange={model.setColorName} /></Field>
                  </>
                )}
                <Field label="Legend"><Select label="Legend" value={model.legendValue} options={model.legendOptions} onChange={model.setLegend} /></Field>
              </>
            ) : undefined}
            add={!model.colorFieldValue && !model.colorNote ? (
              <AddField title="Color" options={model.colorFieldOptions.filter((o) => o.v)} onPick={model.setColorField} />
            ) : undefined}>
            {model.colorFieldValue ? (
              <FieldPill title="Color" kind={kindOf(model.colorFieldOptions, model.colorFieldValue)}
                text={nameOf(model.colorFieldOptions, model.colorFieldValue)}
                options={model.colorFieldOptions.filter((o) => o.v)} value={model.colorFieldValue} onPick={model.setColorField}
                onRemove={() => model.setColorField("")} />
            ) : model.colorNote ? (
              <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>{model.colorNote}</div>
            ) : null}
            {model.colorValues && model.colorValues.length > 0 && (
              <div data-testid="viz-value-colors" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {model.colorValues.map((v) => <ValueSwatch key={v.value} v={v} slots={model.colorSlots ?? 6} />)}
              </div>
            )}
          </Channel>
        )}

        {table && model.setTableColumns && (
          <Channel title="Columns" testid="viz-channel-columns"
            add={(
              <AddField title="Columns" options={(model.columnOptions ?? []).filter((o) => !model.tableColumns?.includes(o.v))}
                onPick={(v) => model.setTableColumns?.([...(model.tableColumns ?? []), v])} />
            )}>
            {(model.tableColumns ?? []).map((c, i) => (
              <FieldPill key={c} title="Columns" kind={kindOf(model.columnOptions ?? [], c)} text={nameOf(model.columnOptions ?? [], c)}
                options={(model.columnOptions ?? []).filter((o) => o.v === c || !model.tableColumns?.includes(o.v))} value={c}
                onPick={(v) => model.setTableColumns?.((model.tableColumns ?? []).map((x, j) => (j === i ? v : x)))}
                onRemove={() => model.setTableColumns?.((model.tableColumns ?? []).filter((x) => x !== c))} />
            ))}
            {!model.tableColumns?.length && <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>Every column, as the query returns them. + chooses some.</div>}
          </Channel>
        )}

        {table && model.setSortField && (
          <Channel title="Sorted by" testid="viz-channel-sort"
            props={model.sortField ? (
              <Field label="Order">
                <SegToggle label="Order" value={model.sortDescending ? "desc" : "asc"} onChange={(v) => model.setSortDescending?.(v === "desc")}
                  options={[["desc", "Largest first"], ["asc", "Smallest first"]]} />
              </Field>
            ) : undefined}
            add={!model.sortField ? <AddField title="Sorted by" options={model.columnOptions ?? []} onPick={(v) => model.setSortField?.(v)} /> : undefined}>
            {model.sortField ? (
              <FieldPill title="Sorted by" kind={kindOf(model.columnOptions ?? [], model.sortField)}
                text={`${nameOf(model.columnOptions ?? [], model.sortField)} · ${model.sortDescending ? "largest first" : "smallest first"}`}
                options={model.columnOptions ?? []} value={model.sortField} onPick={(v) => model.setSortField?.(v)}
                onRemove={() => model.setSortField?.("")} />
            ) : <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>As the query returns them.</div>}
          </Channel>
        )}

        {chartMode && model.lineAvailable && (
          <div style={{ ...ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="aug-fs-chrome" style={TITLE}>Line shape</span>
            <SegToggle label="Line shape" value={model.lineShapeValue} onChange={model.setLineShape}
              options={[["", "Straight"], ["smooth", "Smooth"], ["step", "Step"]]} />
          </div>
        )}
        {chartMode && model.lineAvailable && model.setLineWidth && (
          <div style={{ ...ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="aug-fs-chrome" style={TITLE}>Line width</span>
            <SegToggle label="Line width" value={model.lineWidthValue ?? "2"} onChange={model.setLineWidth}
              options={[["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]]} />
          </div>
        )}
        {chartMode && model.lineAvailable && model.markersAvailable !== false && (
          <ToggleRow title="Marker" on={model.markersOn} onChange={model.setMarkersOn} />
        )}
        {model.setDateFormat && model.dateFormatOptions && (
          <div data-testid="viz-date-format" style={{ ...ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="aug-fs-chrome" style={TITLE}>Dates as</span>
            <Select label="Dates as" value={model.dateFormatValue ?? ""} options={model.dateFormatOptions} onChange={model.setDateFormat} />
          </div>
        )}
        {chartMode && <ToggleRow title="Tooltip" on={model.tooltipOn} onChange={model.setTooltipOn} />}
        {chartMode && model.labelsAvailable !== false && <ToggleRow title="Labels" on={model.showLabels} onChange={model.setShowLabels} />}

        {chartMode && model.barSortAvailable && (
          <Channel title="Order" testid="viz-channel-order">
            <SegToggle label="Order of the bars" value={model.sortValue} onChange={model.setSort}
              options={[["", "Auto"], ["value", "Largest first"], ["label", "By name"]]} />
            <Field label="Show"><Select label="How many bars" value={model.topValue} options={model.topOptions} onChange={model.setTop} /></Field>
          </Channel>
        )}

        {model.view !== "pivot" && model.transformOptions.length > 0 && (
          <Channel title="Transform">
            <Select label="Transform" value={model.transformValue} options={model.transformOptions} onChange={model.setTransform} />
            {model.transformErr && <Warn text="transform not available for this shape" />}
          </Channel>
        )}

        {chartMode && <AnnotationSection model={model} />}
      </div>
    </div>
  );
}
