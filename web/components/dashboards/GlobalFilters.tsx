"use client";

/**
 * A dashboard's global filters, beside its pages (format v19; the user, 2026-11-18). A reader chooses in six ways; what they choose
 * is theirs, kept in their browser and said in the "Filtered by" bar. In the builder a filter is chosen like any piece and set up in
 * the right panel.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Popover, Slider } from "@radix-ui/themes";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { dashboardFilterValues, type FilterValues } from "@/lib/api";
import { MAX_GLOBAL_FILTERS } from "@/lib/dashboards/catalog";
import { DAY_PRESETS, DATE_PRESETS, PRESET_WORDS, type DatePreset } from "@/lib/dashboards/datePresets";
import type { DashboardFocus, FocusOn, FocusValue } from "@/lib/dashboards/focus";
import { focusOfChoice, heldBy, narrowedBy, parameterValue, withFilter, type FilterChoice, type GlobalFilterProps } from "@/lib/dashboards/globalFilters";
import { formatCount } from "@/lib/format";

interface Control {
  p: GlobalFilterProps; connectionId: string; held: DashboardFocus | null; choose: (c: FilterChoice) => void;
  /** What the other filters hold, when this one is linked to them. */
  narrow: FocusOn[];
}

/** The most a filter holds at once (`dashboards.focus.MAX_FOCUS_VALUES`). */
const MOST_VALUES = 200;

/** The values a filter lists: read once per column, and again when the filters it is linked to change. */
function useValues(connectionId: string, table: string, column: string, narrow: FocusOn[]) {
  const [got, setGot] = useState<FilterValues | null>(null);
  const [problem, setProblem] = useState("");
  const linked = JSON.stringify(narrow);
  useEffect(() => {
    let live = true;
    setProblem("");
    const ask = () => dashboardFilterValues(connectionId, { table, column, read: "values", ...(narrow.length ? { focus: narrow } : {}) })
      .then(v => { if (live) setGot(v); }).catch(e => { if (live) setProblem((e as Error).message); });
    // a run of quick choices reads the list once
    const timer = narrow.length ? setTimeout(ask, 250) : null;
    if (!timer) void ask();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [connectionId, table, column, linked]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on what it asks
  return { got, problem };
}

const Note = ({ children }: { children: React.ReactNode }) => <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>{children}</div>;

/** Every value a filter of multiple values can hold, to tick: found by words when there are many, with Select all and Clear. */
function ValueList({ p, connectionId, held, choose, narrow }: Control) {
  const { got, problem } = useValues(connectionId, String(p.table), String(p.column), narrow);
  const [term, setTerm] = useState("");
  const picked = held?.values ?? [];
  // v20 Include / Exclude (the user, 2026-11-19): keep the values ticked, or every value but them. A filter that feeds a
  // dashboard value only includes: "every value but these" names no value to hand on.
  const excludes = !p.parameter;
  const [exclude, setExclude] = useState(held?.op === "not_in");
  useEffect(() => { if (held) setExclude(held.op === "not_in"); }, [held?.op]); // eslint-disable-line react-hooks/exhaustive-deps -- follows what is held
  const pick = (values: FocusValue[], out = exclude) => choose({ kind: "multi", values, ...(out && excludes ? { exclude: true } : {}) });
  if (problem) return <Note>{problem}</Note>;
  if (!got) return <Note>Reading…</Note>;
  const q = term.trim().toLowerCase();
  // what a reader ticked stays on the list, even once another filter leaves none of it
  const listed = [...got.values, ...picked.filter(v => !got.values.some(x => x.value === v)).map(value => ({ value, n: 0 }))];
  const shown = listed.filter(v => !q || String(v.value).toLowerCase().includes(q));
  const flip = (v: FocusValue) => pick(picked.includes(v) ? picked.filter(x => x !== v) : [...picked, v]);
  const allShown = () => pick([...new Set([...picked, ...shown.map(v => v.value)])].slice(0, MOST_VALUES));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {excludes && (
        <Segmented label={`${p.title || p.column}: keep or leave out the values ticked`} value={exclude ? "exclude" : "include"}
          onChange={v => { const out = v === "exclude"; setExclude(out); if (picked.length) pick(picked, out); }}
          options={[{ value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }]} />
      )}
      {got.values.length > 8 && <Input type="search" aria-label={`Find a value of ${p.title || p.column}`} placeholder="Find a value" value={term} onChange={e => setTerm(e.target.value)} />}
      {shown.length > 1 && (
        <div style={{ display: "flex", gap: 4 }}>
          <Button size="xs" variant="ghost" data-testid="global-filter-select-all" onClick={allShown}>{q ? "Select all matching" : "Select all"}</Button>
          {picked.length > 0 && <Button size="xs" variant="ghost" data-testid="global-filter-select-none" onClick={() => pick([])}>Clear</Button>}
        </div>
      )}
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {shown.map(v => (
          <label key={String(v.value)} className="aug-fs-sm" data-testid="global-filter-value" style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr) auto", gap: 7, alignItems: "center", padding: "3px 2px", cursor: "pointer" }}>
            <Checkbox checked={picked.includes(v.value)} aria-label={String(v.value)} onChange={() => flip(v.value)} />
            <span style={{ color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(v.value)}</span>
            <span style={{ color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{formatCount(v.n)}</span>
          </label>
        ))}
      </div>
      {got.more && <Note>The commonest {formatCount(got.values.length)} are listed.</Note>}
    </div>
  );
}

/** What a dropdown says it holds, in one line: All, the values, or the first two and how many more — "Not …" when they are
 *  the ones left out. */
export function heldWords(picked: FocusValue[], exclude = false): string {
  if (!picked.length) return "All";
  const listed = picked.length <= 2 ? picked.map(String).join(", ") : `${String(picked[0])}, ${String(picked[1])} +${formatCount(picked.length - 2)}`;
  return exclude ? `Not ${listed}` : listed;
}

/** Multiple values in one line, as a dropdown (the user, 2026-11-19: it "takes less space and gives a better UX"). The
 *  values are read when it opens, not when the dashboard does. */
function MultiDropdown(props: Control) {
  const [open, setOpen] = useState(false);
  const picked = props.held?.values ?? [];
  const words = heldWords(picked, props.held?.op === "not_in");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button variant="secondary" size="sm" data-testid="global-filter-dropdown" aria-label={`${props.p.title || props.p.column}: ${words}`}
          style={{ width: "100%", justifyContent: "space-between", gap: 6, fontWeight: 400 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: picked.length ? "var(--t1)" : "var(--t2)" }}>{words}</span>
          <Icon name="chevd" size={14} />
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1" align="start" data-testid="global-filter-dropdown-list" style={{ width: 260, maxWidth: "calc(100vw - 32px)" }}>
        <ValueList {...props} />
      </Popover.Content>
    </Popover.Root>
  );
}

function MultiValues(props: Control) {
  return props.p.show === "dropdown" ? <MultiDropdown {...props} /> : <ValueList {...props} />;
}

function SingleValue({ p, connectionId, held, choose, clear, narrow }: Control & { clear: () => void }) {
  const { got, problem } = useValues(connectionId, String(p.table), String(p.column), narrow);
  const allowAll = p.allow_all !== false;
  const first = got?.values[0]?.value;
  // with no All on offer the filter always holds a value: the commonest, until a reader chooses another
  useEffect(() => { if (!allowAll && !held && first !== undefined) choose({ kind: "single", value: first }); }, [allowAll, held, first]); // eslint-disable-line react-hooks/exhaustive-deps -- by what it reads
  if (problem) return <Note>{problem}</Note>;
  if (!got) return <Note>Reading…</Note>;
  return (
    <SelectField aria-label={p.title || String(p.column)} value={held ? String(held.value) : ""} onChange={e => {
      const v = got.values.find(x => String(x.value) === e.target.value);
      if (v) choose({ kind: "single", value: v.value }); else if (e.target.value !== String(held?.value ?? "")) clear();
    }}>
      {allowAll && <option value="">All</option>}
      {held && !got.values.some(v => String(v.value) === String(held.value)) && <option value={String(held.value)}>{String(held.value)}</option>}
      {got.values.map(v => <option key={String(v.value)} value={String(v.value)}>{String(v.value)}</option>)}
    </SelectField>
  );
}

function DatePicker({ p, held, choose, clear }: Control & { clear: () => void }) {
  const name = p.title || String(p.column);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <SelectField aria-label={`${name}: which day`} data-testid="global-filter-day-preset" value={held?.preset ?? ""} onChange={e => {
        const v = e.target.value as DatePreset | "";
        if (v) choose({ kind: "date", day: "", preset: v }); else clear();
      }}>
        <option value="">Choose a day</option>
        {DAY_PRESETS.map(v => <option key={v} value={v}>{PRESET_WORDS[v]}</option>)}
      </SelectField>
      <Input type="date" aria-label={name} value={held?.preset ? "" : String(held?.low ?? "")} onChange={e => choose({ kind: "date", day: e.target.value })} />
    </div>
  );
}

const CUSTOM = "custom";

function DateRange({ p, held, choose, clear }: Control & { clear: () => void }) {
  const low = String(held?.low ?? ""), high = String(held?.high ?? "");
  const [custom, setCustom] = useState(!!held && !held.preset);
  const name = p.title || p.column;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <SelectField aria-label={`${name}: period`} data-testid="global-filter-date-preset" value={held?.preset ?? (custom ? CUSTOM : "")} onChange={e => {
        const v = e.target.value;
        setCustom(v === CUSTOM);
        if (v === CUSTOM) return;
        if (v) choose({ kind: "date_range", low: "", high: "", preset: v as DatePreset }); else clear();
      }}>
        <option value="">All dates</option>
        {DATE_PRESETS.filter(v => !DAY_PRESETS.includes(v)).map(v => <option key={v} value={v}>{PRESET_WORDS[v]}</option>)}
        <option value={CUSTOM}>Custom range</option>
      </SelectField>
      {custom && !held?.preset && (
        <>
          <Input type="date" aria-label={`${name}: from`} value={low} max={high || undefined} onChange={e => choose({ kind: "date_range", low: e.target.value, high })} />
          <Input type="date" aria-label={`${name}: to`} value={high} min={low || undefined} onChange={e => choose({ kind: "date_range", low, high: e.target.value })} />
        </>
      )}
    </div>
  );
}

function TextEntry({ p, held, choose }: Control) {
  const said = String(held?.value ?? "");
  const [text, setText] = useState(said);
  useEffect(() => { setText(said); }, [said]);
  const commit = () => { if (text.trim() !== said) choose({ kind: "text", words: text }); };
  return <Input type="search" aria-label={p.title || String(p.column)} placeholder="Type to filter" value={text} onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") commit(); }} />;
}

function RangeSlider({ p, connectionId, held, choose, clear, narrow }: Control & { clear: () => void }) {
  const linked = JSON.stringify(narrow);
  const [bounds, setBounds] = useState<{ low: number; high: number } | null>(null);
  const [problem, setProblem] = useState("");
  const [moving, setMoving] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    dashboardFilterValues(connectionId, { table: String(p.table), column: String(p.column), read: "range", ...(narrow.length ? { focus: narrow } : {}) }).then(r => {
      if (live) setBounds(r.low == null || r.high == null ? null : { low: Number(r.low), high: Number(r.high) });
    }).catch(e => { if (live) setProblem((e as Error).message); });
    return () => { live = false; };
  }, [connectionId, p.table, p.column, linked]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on what it asks
  if (problem) return <Note>{problem}</Note>;
  if (!bounds) return <Note>Reading…</Note>;
  if (bounds.low === bounds.high) return <Note>Every row holds {formatCount(bounds.low)}.</Note>;
  const whole = Number.isInteger(bounds.low) && Number.isInteger(bounds.high);
  const value = moving ?? [Number(held?.low ?? bounds.low), Number(held?.high ?? bounds.high)];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 2px" }}>
      <Slider size="1" min={bounds.low} max={bounds.high} step={whole ? 1 : (bounds.high - bounds.low) / 100} value={value} aria-label={String(p.title || p.column)}
        onValueChange={setMoving} onValueCommit={v => {
          setMoving(null);
          if (v[0] <= bounds.low && v[1] >= bounds.high) clear(); else choose({ kind: "range", low: v[0], high: v[1] });
        }} />
      <div className="aug-fs-sm" data-testid="global-filter-range" style={{ display: "flex", justifyContent: "space-between", color: "var(--t2)", fontVariantNumeric: "tabular-nums" }}>
        <span>{formatCount(value[0])}</span><span>{formatCount(value[1])}</span>
      </div>
    </div>
  );
}

function FilterControl(props: Control & { clear: () => void }) {
  switch (props.p.kind) {
    case "multi": return <MultiValues {...props} />;
    case "single": return <SingleValue {...props} />;
    case "date": return <DatePicker {...props} />;
    case "date_range": return <DateRange {...props} />;
    case "text": return <TextEntry {...props} />;
    case "range": return <RangeSlider {...props} />;
  }
}

// ── the column, put away and brought back (the user, 2026-11-19: "our Global filters need to be collapsible") ──

const SHUT_KEY = "pramanyx:dashboard-filters-shut";
let shut: boolean | null = null;
const shutListeners = new Set<() => void>();
const readShut = (): boolean => {
  if (shut !== null) return shut;
  try { shut = window.localStorage.getItem(SHUT_KEY) === "1"; } catch { shut = false; }
  return shut;
};

/** Whether the reader has put the filters column away: theirs, kept in their browser, for every dashboard. */
export function useFiltersShut(): boolean {
  return useSyncExternalStore(
    l => { shutListeners.add(l); return () => { shutListeners.delete(l); }; },
    () => (typeof window === "undefined" ? false : readShut()),
    () => false,
  );
}

export function shutFilters(next: boolean): void {
  shut = next;
  try { window.localStorage.setItem(SHUT_KEY, next ? "1" : "0"); } catch { /* kept while the page is open */ }
  shutListeners.forEach(l => l());
}

/** For tests: forget what this browser kept. */
export function resetFiltersShut(): void { shut = null; }

/** Where the menu of everything cutting the dashboard goes (its filters' choices, a mark clicked on a chart, Clear all, Copy
 *  link): beside the filters' own heading, never in the title row (the user, 2026-11-19: "The filter icon at the top is not
 *  necessary"). The dashboard gives the place; each filters heading, and the button that stands for a put-away column, holds it. */
export const FiltersMenuPlace = createContext<((el: HTMLElement | null) => void) | null>(null);

function FiltersMenuSlot() {
  const place = useContext(FiltersMenuPlace);
  return place ? <span ref={place} data-testid="filters-menu-place" style={{ display: "inline-flex" }} /> : null;
}

/** What stands above the cards once the column is put away: the way back to it, and how many filters still hold a choice,
 *  so a reader never forgets the cards are narrowed. It takes a line above the cards and none of their width (the user,
 *  2026-11-19: "it should sit on top of the dashboard components ... no vertical space occupying dashboard area"). */
export function FiltersShutStrip({ held }: { held: number }) {
  return (
    <div data-testid="global-filters-shut" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <FiltersMenuSlot />
      <Button size="sm" variant="secondary" data-testid="global-filters-show" onClick={() => shutFilters(false)}
        aria-label={held ? `Show the filters · ${held} holding a choice` : "Show the filters"} style={{ gap: 6 }}>
        <Icon name="filter" size={14} /> Filters
        {held > 0 && <span data-testid="global-filters-held" style={{ color: "var(--t2)", fontVariantNumeric: "tabular-nums" }}>· {held}</span>}
      </Button>
    </div>
  );
}

/** The control that puts a filters column away; every filters column a dashboard draws carries it. */
export function FiltersHideButton() {
  return (
    <Button size="icon-xs" variant="ghost" aria-label="Put the filters away" title="Put the filters away · they keep what they hold"
      data-testid="global-filters-hide" onClick={() => shutFilters(true)}><Icon name="chevl" size={14} /></Button>
  );
}

/** The head of a filters column that draws none of its own: its name, and the way to put it away. */
export function FiltersHead() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 24, marginBottom: 8 }}>
      <span className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 600 }}>Filters</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>{!useFiltersShut() && <FiltersMenuSlot />}<FiltersHideButton /></span>
    </div>
  );
}

export function GlobalFiltersColumn({ filters, connectionId, focus, onFocus, building, selected, onChoose, onAdd, applyButton = false, page = null, onParameter, valueKinds, bare = false }: {
  filters: { key: string; props: GlobalFilterProps }[];
  /** One filter placed on the canvas as a box of its own (2026-11-19): the filter alone, filling its box — no column head. */
  bare?: boolean;
  connectionId?: string;
  focus: DashboardFocus[];
  onFocus: ((next: DashboardFocus[]) => void) | null;
  /** The builder: every filter is drawn, a click chooses it, and more can be added. */
  building: boolean;
  selected: string | null;
  onChoose?: (key: string) => void;
  onAdd?: () => void;
  /** What a reader chooses waits for Apply, so several choices run the cards once. */
  applyButton?: boolean;
  /** The page open now, by its element: a filter held to another page is not drawn. */
  page?: string | null;
  /** A filter's choice, for the dashboard value it feeds. */
  onParameter?: (name: string, value: unknown) => void;
  /** The kind of each value a filter can feed, so a choice arrives as that value holds it. */
  valueKinds?: Record<string, { kind: string }>;
}) {
  const holds = applyButton && !building;
  const shut = useFiltersShut();
  const [draft, setDraft] = useState<DashboardFocus[] | null>(null);
  const applied = JSON.stringify(focus);
  // a chip taken off, or a click on a chart, is what the dashboard holds now: a choice still waiting is laid aside
  useEffect(() => { setDraft(null); }, [applied]);
  const now = holds && draft ? draft : focus;
  const waiting = holds && !!draft && JSON.stringify(draft) !== applied;
  const put = (next: DashboardFocus[]) => { if (holds) setDraft(next); else onFocus?.(next); };

  // the values these filters feed follow what the dashboard holds, however it came to hold it
  const fed = useRef(new Map<string, string>());
  useEffect(() => {
    for (const { key, props: p } of filters) {
      if (!p.parameter) continue;
      const value = parameterValue(heldBy(focus, key, p), valueKinds?.[p.parameter]?.kind);
      const said = JSON.stringify(value ?? null);
      if (fed.current.get(p.parameter) === said) continue;
      fed.current.set(p.parameter, said);
      onParameter?.(p.parameter, value);
    }
  }, [applied, filters, onParameter, valueKinds]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on what the dashboard holds

  const shown = useMemo(() => filters.filter(f => building || (f.props.table && f.props.column && (!f.props.page || !page || f.props.page === page))), [filters, building, page]);
  if (!shown.length && !building) return null;
  return (
    <aside aria-label={bare ? "Filter" : "Global filters"} data-testid={bare ? "placed-filter" : "global-filters"}
      style={bare ? { display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }
        : { display: "flex", flexDirection: "column", gap: 10, alignSelf: "start", position: "sticky", top: 12, minWidth: 0 }}>
      {!bare && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
        <span className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 600 }}>{building ? "Global filters" : "Filters"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          {!shut && <FiltersMenuSlot />}
          {building && onAdd && (
            <Button size="icon-xs" variant="ghost" aria-label="Add a global filter" title="Add a global filter" data-testid="global-filter-add"
              disabled={filters.length >= MAX_GLOBAL_FILTERS} onClick={onAdd}><Icon name="plus" size={14} /></Button>
          )}
          <FiltersHideButton />
        </span>
      </div>}
      {shown.map(({ key, props: p }) => {
        const ready = !!p.table && !!p.column && !!connectionId;
        const chosen = selected === key;
        const held = heldBy(now, key, p);
        const set = (next: DashboardFocus | null) => put(withFilter(now, key, next));
        return (
          <section key={key} data-testid="global-filter" data-kind={p.kind} data-selected={chosen || undefined} aria-label={p.title || "Filter"}
            onPointerDownCapture={building ? () => onChoose?.(key) : undefined}
            style={{ background: "var(--bg-2)", border: "1px solid var(--card-edge)", borderRadius: "var(--r3)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
              outline: chosen ? "2px solid var(--accent)" : undefined, outlineOffset: 1, ...(bare ? { flex: 1, minHeight: 0, overflow: "auto" } : {}) }}>
            {p.show_title !== false && <div className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 500 }}>{p.title || "Filter"}</div>}
            {p.description && <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>{p.description}</div>}
            {ready ? (
              <FilterControl key={`${p.kind}:${p.table}.${p.column}`} p={p} connectionId={connectionId as string} held={held} narrow={narrowedBy(now, key, p, page)}
                choose={c => set(focusOfChoice(key, p, c))} clear={() => set(null)} />
            ) : <Note>Select a field to filter.</Note>}
          </section>
        );
      })}
      {waiting && (
        <div data-testid="global-filters-waiting" style={{ display: "flex", gap: 6, position: "sticky", bottom: 8 }}>
          <Button size="sm" data-testid="global-filters-apply" style={{ flex: 1 }} onClick={() => { if (draft) onFocus?.(draft); setDraft(null); }}>Apply</Button>
          <Button size="sm" variant="secondary" data-testid="global-filters-discard" onClick={() => setDraft(null)}>Discard</Button>
        </div>
      )}
    </aside>
  );
}
