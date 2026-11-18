"use client";

/**
 * PieceSetup — the builder's Setup for the element chosen (Arc AP-1; ROADMAP §3.57,
 * design-mockups/cockpit-builder.html screen 2).
 *
 * Before it, nothing about a placed piece could be changed: a table listed the columns it was placed
 * with, a chart counted objects per day and nothing else. Here each is chosen — a table's columns, its sort and its
 * segment; a figure's calculation, its property and how it is written; a chart's days, its measure and what it is
 * split by; the filter column's properties — from what the ontology declares for the entity, never typed as a spec.
 * Each choice is handed back as the next spec (`lib/dashboards/edit.ts`), checked by the rules before it is kept, and the
 * piece reads again with what it now says. These are a person's choices, by hand; a model never sets a piece up.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BREAKDOWN_TOPS, CHART_DAYS, CHART_TOPS, CHOOSERS, FIGURE_AGGS, MAX_BREAKDOWN_MEASURES, MAX_CAPTION, MAX_CARD_DESCRIPTION, MAX_COLOR_VALUES,
  MAX_COLUMN_LOOKS, MAX_FILTERS, MAX_LABEL, SERIES_SLOTS, type ColumnLook,
  MAX_NOTE, MAX_TABLE_COLUMNS, MAX_TICKED_RUNS, MAX_TITLE, PERIOD_OPENS, SET_READERS, SPLIT_AGGS, TICKERS, TONES, type PieceName,
  MAX_FILTER_DESCRIPTION, MAX_FIXED_FILTERS, type GlobalFilterKind,
} from "@/lib/dashboards/catalog";
import { DATE_PRESETS, DAY_PRESETS, PRESET_WORDS, type DatePreset } from "@/lib/dashboards/datePresets";
import { FILTER_KINDS, TEXT_MATCHES, canFeed, fits, type FilterOpening } from "@/lib/dashboards/globalFilters";
import { dashboardFilterFields, type FilterField } from "@/lib/api";
import {
  editNote, freshWireName, moveCardTo, moveCardToNewSection, moveSectionTo, recaption, rename, sectionsOf, setProps, tabsOf,
  type DashboardSpec,
} from "@/lib/dashboards/edit";
import { lineOf, nameOf, setTitles, wireWords } from "@/lib/dashboards/names";
import { LOOK_DECIMALS } from "@/lib/dashboards/numberLook";
import type { CardHolds } from "@/lib/dashboards/cardHolds";
import { formatCount, isNumericType } from "@/lib/format";
import { propertyLabel } from "@/lib/dashboards/objectView";
import { choicesOf, isRefused, pieceSet, readSet } from "@/lib/dashboards/sets";
import { ButtonsSetup } from "@/components/dashboards/ButtonsSetup";
import { Checkbox as Tick } from "@/components/ui/checkbox";
import { withUniqueKeys } from "@/lib/listKeys";
import { getDeclaredActions, type DeclaredAction } from "@/lib/objects";
import { getObjectType, getProcesses, type ObjectTypeDetail, type TypeProperty } from "@/lib/objectTypes";

/** A property a piece may read: the entity's own, or one of an object it links to one of ("Country via Customer"). */
export interface EntityField { path: string; label: string; via?: string; role: string; type: string; unit: string }
export interface EntityFields {
  fields: EntityField[];
  segments: string[];
  /** Every to-one link, and the one whose object's properties are offered for each object linked to. */
  links: { name: string; to: string }[];
  offeredFor: Record<string, string>;
  /** Arc AP-8b — every link the object door may cross, either way and of either kind: what a set's objects reach. */
  reaches?: { name: string; to: string; toName: string; kind: "to-one" | "to-many" }[];
}

const words = (id: string) => id.replace(/_/g, " ");
const TIME = /DATE|TIME/i;
const NUMBER = /INT|FLOAT|NUMERIC|DECIMAL|DOUBLE|REAL/i;
export const isTime = (f: EntityField) => ["timestamp", "date", "time"].includes(f.role) || TIME.test(f.type);
/** A category a reader filters or splits by — what `from_object.py` offers as a filter. */
export const isCategory = (f: EntityField) =>
  !isTime(f) && (["dimension", "flag", "ordinal"].includes(f.role) || /BOOL/i.test(f.type));
export const isNumber = (f: EntityField) => !isTime(f) && f.role !== "key" && (f.role === "measure" || NUMBER.test(f.type));
/** Words a reader may look for, or an object be called by — text, never a key, a moment or a number (Arc AP-4). */
export const isText = (f: EntityField) => !isTime(f) && f.role !== "key" && /CHAR|STRING|TEXT/i.test(f.type);
const lastOf = (f: EntityField) => f.path.slice(f.path.lastIndexOf(".") + 1).toLowerCase();
const linkOf = (f: EntityField) => f.path.slice(0, f.path.lastIndexOf(".") + 1);

/** What an object is called by: its own name, a title, an email — none when it has no such property (an order). */
export function nameField(ef: EntityFields): EntityField | undefined {
  const own = ef.fields.filter(f => !f.via && isText(f));
  return own.find(f => lastOf(f) === "name") ?? own.find(f => /(^|_)(name|title)$/.test(lastOf(f))) ?? own.find(f => /(^|_)email$/.test(lastOf(f)));
}

/** Where an object is: a latitude and a longitude of the same object — its own first, else one it links to. A
 *  coordinate is a number whatever its role says (theLook's call a distribution centre's latitude a key). */
export function placesOf(ef: EntityFields): { lat: EntityField; lng: EntityField } | null {
  const degrees = (f: EntityField) => !isTime(f) && NUMBER.test(f.type);
  const lats = ef.fields.filter(f => degrees(f) && /^(lat|latitude)$/.test(lastOf(f)));
  for (const lat of [...lats.filter(f => !f.via), ...lats.filter(f => f.via)]) {
    const lng = ef.fields.find(f => degrees(f) && linkOf(f) === linkOf(lat) && /^(lng|lon|long|longitude)$/.test(lastOf(f)));
    if (lng) return { lat, lng };
  }
  return null;
}

/** The two moments a timeline draws between, of the object's own: the one it starts at — placed, created — and the
 *  one it ends at — shipped, closed — else its first two. */
export function timesOf(ef: EntityFields): { start: EntityField; end: EntityField } | null {
  const times = ef.fields.filter(f => !f.via && isTime(f));
  const start = times.find(f => /created|placed|start|open|begin/.test(lastOf(f))) ?? times[0];
  const rest = times.filter(f => f !== start);
  const end = rest.find(f => /shipped|delivered|closed|end|resolved|done|finish/.test(lastOf(f))) ?? rest[0];
  return start && end ? { start, end } : null;
}
const isMoney = (f?: EntityField) => !!f && /^(USD|EUR|GBP|JPY|INR|CNY|CHF|AUD|CAD|SEK|NOK|DKK)$/i.test(f.unit);
/** Numbers in the order a measure is offered them: money first, then what the ontology calls a measure, then any
 *  other number — so "The sum of" starts at revenue, not at the first count a table happens to hold. */
export const ranked = (fs: EntityField[]) => fs.map((f, i) => ({ f, i }))
  .sort((a, b) => (isMoney(a.f) ? 0 : a.f.role === "measure" ? 1 : 2) - (isMoney(b.f) ? 0 : b.f.role === "measure" ? 1 : 2) || a.i - b.i)
  .map(x => x.f);

/** The most linked objects whose properties are offered — the bound `from_object.py` keeps for its filters. */
const MAX_LINKS = 3;

const read = new Map<string, Promise<EntityFields>>();

/** What an entity offers a setup: its own properties but its key, and those of each object it links to one of — once
 *  per entity per page. A property's role is the ontology's own. */
export function entityFields(entity: string, connectionId: string, schema?: string): Promise<EntityFields> {
  const id = `${connectionId}/${schema ?? ""}/${entity}`;
  let p = read.get(id);
  if (!p) {
    p = (async () => {
      // the processes are read beside the type: a promise's overdue segment is one a set or a table may keep
      const processes = (async () => { try { return await getProcesses(connectionId, schema); } catch { return null; } })();
      const t = await getObjectType(entity, connectionId, schema);
      if (!("properties" in t)) throw new Error("This entity is not one the ontology serves here.");
      const own = (props: TypeProperty[], prefix = "", via?: string): EntityField[] => props.filter(x => !x.is_key).map(x => ({
        path: `${prefix}${x.name}`, label: propertyLabel(x.display_name, x.name), via, role: x.role, type: x.data_type, unit: x.unit }));
      const type = t as ObjectTypeDetail;
      const seen = new Set<string>();
      const toOne = [...type.links].filter(l => l.kind === "to-one" && l.traversable).sort((a, b) => a.name.length - b.name.length);
      // one link per object linked to — the shortest name — so a property is offered once, not once per link
      const links = toOne.filter(l => (seen.has(l.to) ? false : (seen.add(l.to), true))).slice(0, MAX_LINKS);
      const linked = await Promise.all(links.map(async l => {
        try {
          const lt = await getObjectType(l.to, connectionId, schema);
          return "properties" in lt ? own((lt as ObjectTypeDetail).properties, `${l.name}.`, l.to_name || words(l.to)) : [];
        } catch { return []; }
      }));
      // every segment the object door reads on it: its own, the ones a process or a rule derives, and each promise's
      // overdue ones — "overdue on dispatch" was kept by a set and offered nowhere (scenario on theLook, 2026-10-11)
      const sameType = (name: string) => [entity, type.object_type, type.id].some(x => (x ?? "").toLowerCase() === name.toLowerCase());
      const derived = (type.derived?.segments ?? []).filter(d => d.usable).map(d => d.name);
      const overdue = ((await processes)?.processes ?? []).flatMap(pr => pr.stages ?? [])
        .map(st => st.promise).filter(pm => !!pm?.overdue_segment && sameType(pm.grain)).map(pm => pm!.overdue_segment!);
      return { fields: [...own(type.properties), ...linked.flat()], segments: [...new Set([...(type.segments ?? []), ...derived, ...overdue])],
        links: toOne.map(l => ({ name: l.name, to: l.to })), offeredFor: Object.fromEntries(links.map(l => [l.to, l.name])),
        reaches: type.links.filter(l => l.traversable).map(l => ({ name: l.name, to: l.to, toName: l.to_name || words(l.to), kind: l.kind })) };
    })();
    read.set(id, p);
    p.catch(() => read.delete(id));
  }
  return p;
}

function useEntityFields(entity: string | undefined, connectionId: string, schema?: string): EntityFields | { problem: string } | null {
  // what was read is kept with what it was read for, so another entity chosen shows nothing until its own is read
  const id = entity ? `${connectionId}/${schema ?? ""}/${entity}` : "";
  const [got, setGot] = useState<{ id: string; out: EntityFields | { problem: string } } | null>(null);
  useEffect(() => {
    if (!entity) return;
    let alive = true;
    entityFields(entity, connectionId, schema)
      .then(f => { if (alive) setGot({ id, out: f }); })
      .catch(e => { if (alive) setGot({ id, out: { problem: (e as Error).message } }); });
    return () => { alive = false; };
  }, [id, entity, connectionId, schema]);
  return got && got.id === id ? got.out : null;
}

// ── the fields a setup is made of ────────────────────────────────────────────────────────────────────────────────────

function Row({ label, right, hint, children, testid }: { label: string; right?: ReactNode; hint?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px" }}>
      <div className="aug-fs-xs" style={{ display: "flex", alignItems: "baseline", gap: 6, color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
        {label}{right && <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}>{right}</span>}
      </div>
      {children}
      {hint && <div className="aug-fs-xs" style={{ color: "var(--t3)", lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

/** A person's words, kept when they leave the field or press Enter — and only when there are some. */
function Words({ label, value, max, onSave, many, clearable, placeholder, rows = 5 }: {
  label: string; value: string; max: number; onSave: (v: string) => void; many?: boolean;
  /** Emptied, it saves "" (the prop goes back to unset) where a name may not be emptied. */
  clearable?: boolean; placeholder?: string; rows?: number;
}) {
  const [text, setText] = useState(value);
  // a value changed from elsewhere — an undo, another dashboard — replaces what the field shows
  const [shown, setShown] = useState(value);
  if (shown !== value) { setShown(value); setText(value); }
  const save = () => {
    const t = text.trim().slice(0, max);
    if ((t || clearable) && t !== value) onSave(t);
    else setText(value);
  };
  return many ? (
    <Textarea aria-label={label} value={text} rows={rows} placeholder={placeholder} onChange={e => setText(e.target.value)} onBlur={save} />
  ) : (
    <Input aria-label={label} value={text} maxLength={max} placeholder={placeholder} onChange={e => setText(e.target.value)} onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/** v17 — a table's number columns, each drawn plain, as a bar or as a colour scale (study R10). */
function ColumnLooks({ numbers, p, set, hint, labelOf = (n: string) => n }: {
  numbers: string[]; p: Props; set: (patch: Props, note: string) => void; hint: string; labelOf?: (name: string) => string;
}) {
  if (!numbers.length) return null;
  const looks = (p.columns_look ?? {}) as Record<string, ColumnLook>;
  const choose = (name: string, look: "" | ColumnLook) => {
    const next = { ...looks };
    if (look) next[name] = look; else delete next[name];
    set({ columns_look: Object.keys(next).length ? next : null }, look ? `a column drawn as a ${look} by hand` : "a column drawn plain by hand");
  };
  return (
    <Row label="Number columns" testid="card-look-columns" hint={hint}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {numbers.slice(0, MAX_COLUMN_LOOKS).map(name => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="aug-fs-sm" style={{ flex: 1, minWidth: 0, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(name)}</span>
            <Segmented label={`How ${labelOf(name)} is drawn`} value={looks[name] ?? ""}
              options={[{ value: "", label: "Plain" }, { value: "bar", label: "Bar" }, { value: "scale", label: "Scale" }]}
              onChange={v => choose(name, v as "" | ColumnLook)} />
          </div>
        ))}
      </div>
    </Row>
  );
}

/** v17 — a value's colour on every card of the dashboard (study R11): one of the six series colours, kept on the
 *  dashboard's root and honoured by every card colouring by the field. "Auto" lets the value take the next free one. */
function KeptColors({ fields, spec, onChange }: { fields: { field: string; values: string[] }[]; spec: DashboardSpec; onChange: Change }) {
  if (!fields.length) return null;
  const root = spec.root;
  const kept = (spec.elements[root]?.props.colors ?? {}) as Record<string, Record<string, number>>;
  const choose = (field: string, value: string, slot: number | null) => {
    const forField = { ...(kept[field] ?? {}) };
    if (slot) forField[value] = slot; else delete forField[value];
    const next = { ...kept };
    if (Object.keys(forField).length) next[field] = forField; else delete next[field];
    onChange(setProps(spec, root, { colors: Object.keys(next).length ? next : null }),
      slot ? "a value's colour kept on the dashboard by hand" : "a value's colour let go by hand");
  };
  return (
    <>
      {fields.map(({ field, values }) => (
        <Row key={field} label={`Colours · ${words(field)}`} testid="card-look-colors"
          hint="Kept on the dashboard: every card colouring by this field shows each value in its colour.">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {values.slice(0, MAX_COLOR_VALUES).map(value => {
              const slot = kept[field]?.[value] ?? null;
              return (
                <div key={value} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="aug-fs-sm" title={value} style={{ flex: 1, minWidth: 0, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
                  {Array.from({ length: SERIES_SLOTS }, (_, i) => i + 1).map(n => (
                    <Button key={n} size="icon-xs" variant="ghost" aria-label={`${value}: colour ${n}`} aria-pressed={slot === n}
                      data-testid={`kept-color-${n}`} onClick={() => choose(field, value, slot === n ? null : n)}
                      style={{ outline: slot === n ? "2px solid var(--t1)" : undefined, outlineOffset: 1 }}>
                      <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: `var(--chart-${n})` }} />
                    </Button>
                  ))}
                  <Button size="xs" variant="ghost" disabled={!slot} onClick={() => choose(field, value, null)}>Auto</Button>
                </div>
              );
            })}
          </div>
        </Row>
      ))}
    </>
  );
}

type Look = { decimals?: 0 | 1 | 2 | null; compact?: boolean | null; negatives?: "minus" | "parens" | null };

/** A placed card's own title, description and number look (dashboards v16; study R8, R9). Display only: what the card
 *  measures and its unit stay the card's. */
function CardLook({ p, own, set }: { p: Props; own: string; set: (patch: Props, note: string) => void }) {
  const look = (p.number ?? {}) as Look;
  const setLook = (patch: Look, note: string) => {
    const next = { ...look, ...patch };
    const kept = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== null && v !== undefined));
    set({ number: Object.keys(kept).length ? kept : null }, note);
  };
  return (
    <div data-testid="card-look">
      <Row label="Title" testid="card-look-title" right={
        <label className="aug-fs-xs" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t2)" }}>
          <Tick checked={p.show_title !== false} aria-label="Show the title"
            onChange={e => set({ show_title: e.target.checked ? null : false }, e.target.checked ? "a card's title shown by hand" : "a card's title hidden by hand")} />
          Shown
        </label>}
        hint={p.title ? `For this dashboard alone; the card's own is "${own}". Empty it to use that again.` : "The card's own. Write one for this dashboard alone."}>
        <Words clearable label="Title" value={String(p.title ?? "")} placeholder={own} max={MAX_TITLE}
          onSave={v => set({ title: v || null }, v ? "a card retitled on this dashboard by hand" : "a card's own title used again")} />
      </Row>
      <Row label="Description" testid="card-look-description">
        <Words many clearable rows={2} label="Description" value={String(p.description ?? "")} placeholder="A line under the title" max={MAX_CARD_DESCRIPTION}
          onSave={v => set({ description: v || null }, v ? "a card's description written by hand" : "a card's description taken off")} />
      </Row>
      <Row label="Filters" testid="card-look-filters" hint="A card set apart keeps its whole figure while a reader filters the rest, and says so.">
        <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
          <Tick checked={p.not_filtered === true} aria-label="Not cut by the dashboard's filters"
            onChange={e => set({ not_filtered: e.target.checked ? true : null }, e.target.checked ? "a card set apart from the dashboard's filters by hand" : "a card cut by the dashboard's filters again")} />
          Not cut by the dashboard's filters
        </label>
      </Row>
      <Row label="Numbers" testid="card-look-number" hint="How this card writes its figures here. A percent stays a percent, and money keeps its symbol.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Pick label="Decimals" none="Auto decimals" value={look.decimals == null ? "" : String(look.decimals)}
            options={LOOK_DECIMALS.map(d => ({ value: String(d), label: d === 0 ? "No decimals" : `${d} decimal${d === 1 ? "" : "s"}` }))}
            onPick={v => setLook({ decimals: v === "" ? null : Number(v) as 0 | 1 | 2 }, "a card's decimals chosen by hand")} />
          <Segmented label="Compact or whole" value={look.compact == null ? "" : look.compact ? "compact" : "whole"}
            options={[{ value: "", label: "Auto" }, { value: "compact", label: "1.2M" }, { value: "whole", label: "1,234,567" }]}
            onChange={v => setLook({ compact: v === "" ? null : v === "compact" }, "how a card's numbers are written chosen by hand")} />
          <Segmented label="Negatives" value={look.negatives ?? "minus"}
            options={[{ value: "minus", label: "-1,234" }, { value: "parens", label: "(1,234)" }]}
            onChange={v => setLook({ negatives: v === "parens" ? "parens" : null }, "how a card writes a negative chosen by hand")} />
        </div>
      </Row>
    </div>
  );
}

/** A global filter's setup (v19): its words, how it is chosen from, and the column it filters. */
const FIXED_HOW: { value: string; label: string }[] = [
  { value: "eq", label: "Is" }, { value: "in", label: "Is one of" }, { value: "contains", label: "Contains" },
  { value: "between", label: "Between numbers" }, { value: "dates", label: "Between dates" },
];
interface FixedFilter { table: string; column: string; op: string; value?: string | number | boolean | null; values?: (string | number | boolean)[] | null; low?: string | number | null; high?: string | number | null }

const fixedWords = (f: FixedFilter) => `${f.column} ${FIXED_HOW.find(h => h.value === f.op)?.label.toLowerCase() ?? f.op} ${
  f.op === "in" ? (f.values ?? []).join(", ") : f.op === "between" || f.op === "dates" ? `${f.low ?? "…"} to ${f.high ?? "…"}` : String(f.value ?? "")}`;

/** v20 — what this placement of a card keeps out of a reader's hands: filters fixed on it, and the dashboard's filters it does not follow. */
function CardFilters({ p, set, spec, connectionId }: { p: Props; set: (patch: Props, note: string) => void; spec: DashboardSpec; connectionId?: string }) {
  const [fields, setFields] = useState<FilterField[] | null>(null);
  const [adding, setAdding] = useState({ table: "", column: "", op: "eq", first: "", second: "" });
  useEffect(() => {
    let live = true;
    if (connectionId) dashboardFilterFields(connectionId).then(f => { if (live) setFields(f); }).catch(() => { if (live) setFields([]); });
    return () => { live = false; };
  }, [connectionId]);
  const fixed = (p.fixed_filters ?? []) as FixedFilter[];
  const ignores = (p.ignores_filters ?? []) as string[];
  const filters = Object.entries(spec.elements).filter(([, e]) => e?.type === "GlobalFilter");
  const columns = fields?.find(t => t.table === adding.table)?.columns ?? [];
  const typed = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v.trim());
  const ready = adding.table && adding.column && adding.first.trim() && (adding.op === "eq" || adding.op === "in" || adding.op === "contains" || adding.second.trim());
  const add = () => {
    const base = { table: adding.table, column: adding.column, op: adding.op };
    const made: FixedFilter = adding.op === "in" ? { ...base, values: adding.first.split(",").map(typed).filter(v => v !== "") }
      : adding.op === "between" ? { ...base, low: Number(adding.first), high: Number(adding.second) }
        : adding.op === "dates" ? { ...base, low: adding.first.trim(), high: adding.second.trim() }
          : { ...base, value: adding.op === "contains" ? adding.first.trim() : typed(adding.first) };
    set({ fixed_filters: [...fixed, made] }, "a filter fixed on a card by hand");
    setAdding({ table: adding.table, column: "", op: "eq", first: "", second: "" });
  };
  return (
    <>
      {filters.length > 0 && p.not_filtered !== true && (
        <Row label="Follows" testid="card-follows-filters" hint="Untick a filter and this card keeps its rows while a reader uses it.">
          {filters.map(([key, e]) => (
            <label key={key} className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
              <Tick checked={!ignores.includes(key)} aria-label={`Follows ${String(e.props.title ?? "the filter")}`}
                onChange={ev => { const next = ev.target.checked ? ignores.filter(k => k !== key) : [...ignores, key]; set({ ignores_filters: next.length ? next : null }, "the filters a card follows chosen by hand"); }} />
              {String(e.props.title ?? "Filter")}
            </label>
          ))}
        </Row>
      )}
      <Row label="Fixed filters" testid="card-fixed-filters" hint="Always on for this card. A reader cannot change them.">
        {fixed.map((f, i) => (
          <div key={`${f.column}-${i}`} className="aug-fs-sm" data-testid="card-fixed-filter" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{fixedWords(f)}</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Take off ${fixedWords(f)}`} onClick={() => { const next = fixed.filter((_, at) => at !== i); set({ fixed_filters: next.length ? next : null }, "a card's fixed filter taken off by hand"); }}><Icon name="close" size={13} /></Button>
          </div>
        ))}
        {fixed.length < MAX_FIXED_FILTERS && fields && fields.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Pick label="The table to fix" none="Choose a table" value={adding.table} options={fields.map(t => ({ value: t.table, label: t.table }))} onPick={v => setAdding({ ...adding, table: v, column: "" })} />
            <Pick label="The column to fix" none="Choose a column" disabled={!adding.table} value={adding.column} options={columns.map(c => ({ value: c.name, label: c.name }))} onPick={v => setAdding({ ...adding, column: v })} />
            <Pick label="How it is fixed" value={adding.op} options={FIXED_HOW} onPick={v => setAdding({ ...adding, op: v })} />
            <Input aria-label="The value to fix" placeholder={adding.op === "in" ? "Values with a comma between" : adding.op === "between" || adding.op === "dates" ? "From" : "Value"} value={adding.first} onChange={e => setAdding({ ...adding, first: e.target.value })} />
            {(adding.op === "between" || adding.op === "dates") && <Input aria-label="The value it runs to" placeholder="To" value={adding.second} onChange={e => setAdding({ ...adding, second: e.target.value })} />}
            <Button size="xs" variant="secondary" data-testid="card-fixed-filter-add" disabled={!ready} onClick={add}>Add fixed filter</Button>
          </div>
        )}
      </Row>
    </>
  );
}

/** What a filter opens on, set the way the filter is chosen from: words, a list, or a date that moves. */
function FilterOpensOn({ p, set }: { p: Props; set: (patch: Props, note: string) => void }) {
  const kind = String(p.kind ?? "multi") as GlobalFilterKind;
  const o = (p.opens_with ?? {}) as FilterOpening;
  const keep = (next: FilterOpening | null) => set({ opens_with: next }, "what a filter opens on chosen by hand");
  const typed = (v: string) => (v !== "" && Number.isFinite(Number(v)) ? Number(v) : v);
  if (kind === "date" || kind === "date_range") {
    const offered = kind === "date" ? DAY_PRESETS : DATE_PRESETS.filter(v => !DAY_PRESETS.includes(v));
    return <Pick label="What it opens on" none={kind === "date" ? "No day" : "All dates"} value={String(o.preset ?? "")} options={offered.map(v => ({ value: v, label: PRESET_WORDS[v] }))}
      onPick={v => keep(v ? { preset: v as DatePreset } : null)} />;
  }
  if (kind === "range") {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <Words clearable label="It opens from" placeholder="From" value={o.low == null ? "" : String(o.low)} max={30} onSave={v => keep(v && Number.isFinite(Number(v)) ? { ...o, low: Number(v) } : null)} />
        <Words clearable label="It opens to" placeholder="To" value={o.high == null ? "" : String(o.high)} max={30} onSave={v => keep(v && Number.isFinite(Number(v)) ? { ...o, high: Number(v) } : null)} />
      </div>
    );
  }
  if (kind === "text") return <Words clearable label="What it opens on" placeholder="No words" value={String(o.words ?? "")} max={200} onSave={v => keep(v ? { words: v } : null)} />;
  if (kind === "single") return <Words clearable label="What it opens on" placeholder="All" value={o.value == null ? "" : String(o.value)} max={200} onSave={v => keep(v ? { value: typed(v) } : null)} />;
  return <Words clearable label="What it opens on" placeholder="All, or values with a comma between" value={(o.values ?? []).join(", ")} max={1000}
    onSave={v => { const values = v.split(",").map(x => x.trim()).filter(Boolean).map(typed); keep(values.length ? { values } : null); }} />;
}

function GlobalFilterSetup({ p, connectionId, set, spec, onChange }: { p: Props; connectionId?: string; set: (patch: Props, note: string) => void; spec: DashboardSpec; onChange: Change }) {
  const [fields, setFields] = useState<FilterField[] | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let live = true;
    if (connectionId) dashboardFilterFields(connectionId).then(f => { if (live) setFields(f); }).catch(e => { if (live) setProblem((e as Error).message); });
    return () => { live = false; };
  }, [connectionId]);
  const kind = String(p.kind ?? "multi") as GlobalFilterKind;
  const table = fields?.find(t => t.table === p.table);
  const columns = (table?.columns ?? []).filter(c => fits(kind, c.kind));
  const [wantsWords, setWantsWords] = useState(p.description != null && p.description !== "");
  const described = wantsWords || !!p.description;
  const holder = Object.entries(spec.elements).find(([, e]) => e?.type === "GlobalFilters")?.[0];
  const pages = tabsOf(spec);
  const parameters = Object.entries((spec as { values?: Record<string, { label?: string; kind?: string; from?: { by?: string } }> }).values ?? {})
    .filter(([, v]) => v.from?.by === "reader" && canFeed(kind, v.kind)).map(([name, v]) => ({ value: name, label: v.label ?? name }));
  return (
    <div data-testid="global-filter-setup">
      <Row label="Widget">
        <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
          <Tick checked={p.show_title !== false} aria-label="Show the title" onChange={e => set({ show_title: e.target.checked ? null : false }, e.target.checked ? "a filter's title shown by hand" : "a filter's title hidden by hand")} /> Title
        </label>
        {p.show_title !== false && <Words label="The filter's title" value={String(p.title ?? "")} max={MAX_LABEL} onSave={v => set({ title: v }, "a filter renamed by hand")} />}
        <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
          <Tick checked={described} aria-label="Show a description" onChange={e => { setWantsWords(e.target.checked); if (!e.target.checked && p.description) set({ description: null }, "a filter's description taken off"); }} /> Description
        </label>
        {described && <Words clearable many rows={2} label="The filter's description" value={String(p.description ?? "")} max={MAX_FILTER_DESCRIPTION} placeholder="A line under the title"
          onSave={v => set({ description: v || null }, "a filter's description written by hand")} />}
      </Row>
      <Row label="Filter">
        <Pick label="How it is chosen from" value={kind} options={FILTER_KINDS} onPick={v => {
          const next = v as GlobalFilterKind;
          const held = table?.columns.find(c => c.name === p.column);
          set({ kind: next, ...(held && !fits(next, held.kind) ? { column: null } : {}) }, "a filter's kind chosen by hand");
        }} />
        {kind === "single" && (
          <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
            <Tick checked={p.allow_all !== false} aria-label="Allow All" onChange={e => set({ allow_all: e.target.checked ? null : false }, "a filter's All chosen by hand")} /> Allow <i>All</i>
          </label>
        )}
      </Row>
      <Row label="Opens on" testid="global-filter-opens" hint="What a reader first sees. They can choose another, and their choice is kept.">
        <FilterOpensOn p={p} set={set} />
      </Row>
      {kind === "text" && (
        <Row label="Matching" testid="global-filter-match">
          <Pick label="How words match" value={String(p.match ?? "contains")} options={TEXT_MATCHES} onPick={v => set({ match: v === "contains" ? null : v }, "how a filter matches words chosen by hand")} />
          <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
            <Tick checked={p.case_sensitive === true} aria-label="Case sensitive" onChange={e => set({ case_sensitive: e.target.checked ? true : null }, "a filter's capitals chosen by hand")} /> Case sensitive
          </label>
        </Row>
      )}
      <Row label="Behaviour" testid="global-filter-behaviour" hint="Linked filters offer only what the others leave. Apply lets a reader make several choices and run the cards once.">
        {(kind === "multi" || kind === "single" || kind === "range") && (
          <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
            <Tick checked={p.linked !== false} aria-label="Linked to the other filters" onChange={e => set({ linked: e.target.checked ? null : false }, "a filter linked by hand")} /> Linked to the other filters
          </label>
        )}
        {holder && (
          <label className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
            <Tick checked={spec.elements[holder].props.apply_button === true} aria-label="Wait for Apply"
              onChange={e => onChange(setProps(spec, holder, { apply_button: e.target.checked ? true : null }), "the filters' Apply button chosen by hand")} /> Wait for Apply
          </label>
        )}
      </Row>
      {pages.length > 1 && (
        <Row label="Applies to" testid="global-filter-page" hint="A filter held to one page is drawn there and cuts only that page's cards.">
          <Pick label="The page it applies to" none="Every page" value={String(p.page ?? "")} options={pages.map(t => ({ value: t.key, label: t.label }))}
            onPick={v => set({ page: v || null }, "the page a filter applies to chosen by hand")} />
        </Row>
      )}
      {parameters.length > 0 && (
        <Row label="Query value" testid="global-filter-parameter" hint="A query that reads this value as {{name}} is run with what the filter holds.">
          <Pick label="The value it feeds" none="None" value={String(p.parameter ?? "")} options={parameters} onPick={v => set({ parameter: v || null }, "the value a filter feeds chosen by hand")} />
        </Row>
      )}
      <Row label="Field" testid="global-filter-field" hint={table?.left_out ? `${formatCount(table.left_out)} of its columns cannot be filtered: their names hold spaces or symbols.` : "Every card that reads this table, or links to it, is cut by the filter."}>
        {problem ? <div className="aug-fs-sm" style={{ color: "var(--t2)" }}>{problem}</div> : !fields ? <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>Reading the tables…</div> : (
          <>
            <Pick label="The table" none="Choose a table" value={String(p.table ?? "")} options={fields.map(t => ({ value: t.table, label: t.table }))}
              onPick={v => set({ table: v || null, column: null }, "a filter's table chosen by hand")} />
            <Pick label="The column" none={columns.length || !table ? "Choose a column" : "No column fits this filter"} disabled={!table} value={String(p.column ?? "")}
              options={columns.map(c => ({ value: c.name, label: c.name }))} onPick={v => set({ column: v || null }, "a filter's column chosen by hand")} />
          </>
        )}
      </Row>
    </div>
  );
}

function Pick({ label, value, options, onPick, none, disabled }: {
  label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void; none?: string; disabled?: boolean;
}) {
  return (
    <SelectField aria-label={label} value={value} disabled={disabled} onChange={e => onPick(e.target.value)}>
      {none !== undefined && <option value="">{none}</option>}
      {withUniqueKeys(options, o => o.value).map(([k, o]) => <option key={k} value={o.value}>{o.label}</option>)}
    </SelectField>
  );
}

const fieldLabel = (f: EntityField) => (f.via ? `${f.label} via ${f.via}` : f.label);

/** The fields a piece is offered: an object it already reads through another link than the one offered keeps being
 *  read through its own — "Country via Customer", ticked, rather than a second Country or a path in its raw words. */
export function fieldsFor(ef: EntityFields, chosen: (string | null | undefined)[]): EntityField[] {
  const swap = new Map<string, string>();
  for (const path of chosen) {
    const name = path && path.includes(".") ? path.slice(0, path.indexOf(".")) : "";
    const link = name ? ef.links.find(l => l.name === name) : undefined;
    const offered = link ? ef.offeredFor[link.to] : undefined;
    if (offered && offered !== name) swap.set(offered, name);
  }
  if (!swap.size) return ef.fields;
  return ef.fields.map(f => {
    const pre = f.path.includes(".") ? f.path.slice(0, f.path.indexOf(".")) : "";
    return swap.has(pre) ? { ...f, path: `${swap.get(pre)}${f.path.slice(pre.length)}` } : f;
  });
}
const asOptions = (fs: EntityField[]) => fs.map(f => ({ value: f.path, label: fieldLabel(f) }));
/** A path the setup names that the entity no longer offers is still shown, as itself, so nothing reads as lost. */
const keeping = (opts: { value: string; label: string }[], ...paths: (string | null | undefined)[]) =>
  [...opts, ...paths.filter((p): p is string => !!p && !opts.some(o => o.value === p)).map(p => ({ value: p, label: words(p) }))];

const TONE_WORDS: Record<string, string> = { good: "Good", warn: "Watch", bad: "Bad", info: "Note", neutral: "Plain" };

const AGG_WORDS: Record<string, string> = {
  count: "How many", count_distinct: "How many different", sum: "The sum of", avg: "The average of", min: "The least", max: "The most",
};

type Props = Record<string, unknown>;
type Change = (next: DashboardSpec, note: string) => void;

/** Where a placed element sits, and a door to move it to another section — or a new one. */
function SectionPick({ spec, k, onChange }: { spec: DashboardSpec; k: string; onChange: Change }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const sections = sectionsOf(spec);
  const here = sections.find(s => spec.elements[s.key]?.children.includes(k))?.key ?? "";
  if (naming) {
    return (
      <Row label="In the section">
        <div style={{ display: "flex", gap: 6 }}>
          <Input autoFocus aria-label="Name of the new section" placeholder="Name of the new section" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && name.trim()) { onChange(moveCardToNewSection(spec, k, name), "moved to a new section by hand"); setNaming(false); setName(""); }
              if (e.key === "Escape") setNaming(false);
            }} />
          <Button size="xs" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
        </div>
      </Row>
    );
  }
  return (
    <Row label="In the section">
      <Pick label="In the section" value={here} onPick={v => (v === "__new__" ? setNaming(true) : onChange(moveCardTo(spec, k, v), "moved by hand"))}
        options={[...sections.map(s => ({ value: s.key, label: s.drawer ? `Drawer · ${s.title}` : s.tabLabel ? `${s.tabLabel} · ${s.title}` : s.title })),
          { value: "__new__", label: "A new section…" }]} />
    </Row>
  );
}

// ── one setup per kind ───────────────────────────────────────────────────────────────────────────────────────────────

/** The rows a declared rule or segment admits, marked in a tone: chosen from what the ontology
 *  declares on the entity — never a condition written here. */
function MarkRow({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const marked = (p.marked ?? null) as { segment: string; tone: string; label?: string | null } | null;
  return (
    <Row label="Mark rows in" testid="setup-marked"
      hint={marked ? "Rows it admits wear its colour; the legend says how many." : "A declared rule or segment whose rows are marked."}>
      <Pick label="Mark rows in" value={marked?.segment ?? ""} none="Nothing"
        options={keeping(ef.segments.map(s => ({ value: s, label: words(s) })), marked?.segment)}
        onPick={v => set({ marked: v ? { segment: v, tone: marked?.tone ?? "warn" } : null }, "a mark chosen by hand")} />
      {marked && (
        <Segmented label="Its colour" value={marked.tone}
          options={TONES.map(t => ({ value: t, label: TONE_WORDS[t] ?? t }))}
          onChange={v => set({ marked: { ...marked, tone: v } }, "a mark's colour chosen by hand")} />
      )}
    </Row>
  );
}

function TableSetup({ p, ef, set, noun }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void; noun: string }) {
  const chosen = (p.columns as string[] | null | undefined) ?? [];
  const fields = fieldsFor(ef, [...chosen, p.sort as string]);
  const offered = keeping(asOptions(fields), ...chosen);
  const full = chosen.length >= MAX_TABLE_COLUMNS;
  const toggle = (path: string) => {
    const next = chosen.includes(path) ? chosen.filter(c => c !== path) : [...chosen, path];
    set({ columns: next.length ? next : null }, "a table's columns chosen by hand");
  };
  return (
    <>
      {!p.set && (
        <Row label="Lists" hint={p.segment ? "The segment's objects only, a page at a time." : "Every object, a page at a time."}>
          <Pick label="Segment" value={String(p.segment ?? "")} none={`Every ${noun}`}
            options={keeping(ef.segments.map(s => ({ value: s, label: words(s) })), p.segment as string)}
            onPick={v => set({ segment: v || null }, "a table's segment chosen by hand")} />
        </Row>
      )}
      <Row label="Columns" right={`${chosen.length} of ${MAX_TABLE_COLUMNS}`} testid="setup-columns"
        hint="Beside each object's key, in the order chosen.">
        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflow: "auto" }}>
          {withUniqueKeys(offered, o => o.value).map(([key, o]) => {
            const on = chosen.includes(o.value);
            return (
              <label key={key} className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", color: on ? "var(--t1)" : "var(--t2)" }}>
                <Checkbox checked={on} disabled={!on && full} onChange={() => toggle(o.value)} aria-label={o.label} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                {on && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>{chosen.indexOf(o.value) + 1}</span>}
              </label>
            );
          })}
        </div>
      </Row>
      <Row label="Sorted by">
        <Pick label="Sorted by" value={String(p.sort ?? "")} none="The key" options={keeping(asOptions(fields), p.sort as string)}
          onPick={v => set({ sort: v || null, descending: v ? (p.descending ?? true) : null }, "a table's order chosen by hand")} />
        {!!p.sort && (
          <Segmented label="Order" value={p.descending ? "desc" : "asc"}
            options={[{ value: "desc", label: "Descending" }, { value: "asc", label: "Ascending" }]}
            onChange={v => set({ descending: v === "desc" }, "a table's order chosen by hand")} />
        )}
      </Row>
    </>
  );
}

/** The measure of a figure or a chart: what it counts or adds up, of which property, and how it is written. */
function MeasureRows({ p, ef, aggs, set, note }: {
  p: Props; ef: EntityFields; aggs: readonly string[]; set: (patch: Props, note: string) => void; note: string;
}) {
  const agg = String(p.agg ?? "count");
  const fields = fieldsFor(ef, [p.path as string]);
  const numbers = ranked(fields.filter(isNumber));
  const any = fields.filter(f => !isTime(f));
  const of = agg === "count_distinct" ? any : numbers;
  const pickAgg = (v: string) => {
    if (v === "count") { set({ agg: "count", path: null, format: null }, note); return; }
    const pool = v === "count_distinct" ? any : numbers;
    const path = pool.some(f => f.path === p.path) ? String(p.path) : pool[0]?.path;
    if (!path) return;
    // how it is written follows what it reads: money for a currency, a number otherwise — the person may say money after
    set({ agg: v, path, format: v !== "count_distinct" && isMoney(fields.find(f => f.path === path)) ? "money" : null }, note);
  };
  return (
    <>
      <Row label="Measures">
        <Pick label="Measure" value={agg} onPick={pickAgg}
          options={aggs.filter(a => a === "count" || (a === "count_distinct" ? any.length : numbers.length)).map(a => ({ value: a, label: AGG_WORDS[a] ?? a }))} />
        {agg !== "count" && (
          <Pick label="Of" value={String(p.path ?? "")} options={keeping(asOptions(of), p.path as string)}
            onPick={v => set({ path: v, format: isMoney(fields.find(f => f.path === v)) && agg !== "count_distinct" ? "money" : null }, note)} />
        )}
      </Row>
      {agg !== "count" && agg !== "count_distinct" && (
        <Row label="Written as">
          <Segmented label="Written as" value={String(p.format ?? "number")}
            options={[{ value: "number", label: "A number" }, { value: "money", label: "Money" }]}
            onChange={v => set({ format: v }, note)} />
        </Row>
      )}
    </>
  );
}

function FigureSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  return (
    <>
      <Row label="Label"><Words label="Label" value={String(p.label ?? "")} max={MAX_LABEL} onSave={v => set({ label: v }, "a figure's label written by hand")} /></Row>
      <MeasureRows p={p} ef={ef} aggs={FIGURE_AGGS} note="a figure's measure chosen by hand" set={set} />
    </>
  );
}

function ChartSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const fields = fieldsFor(ef, [p.time as string, p.split as string]);
  const times = fields.filter(isTime);
  const categories = fields.filter(isCategory);
  const agg = String(p.agg ?? "count");
  const splits = (SPLIT_AGGS as readonly string[]).includes(agg);
  return (
    <>
      <Row label="Label"><Words label="Label" value={String(p.label ?? "")} max={MAX_LABEL} onSave={v => set({ label: v }, "a chart's label written by hand")} /></Row>
      <Row label="Across" hint="A date the objects hold: one bar a day, over the last days they hold.">
        <Pick label="Across" value={String(p.time ?? "")} options={keeping(asOptions(times), p.time as string)}
          onPick={v => set({ time: v }, "a chart's date chosen by hand")} />
      </Row>
      <Row label="Days">
        <Segmented label="Days" value={String(p.days ?? 30)} options={CHART_DAYS.map(d => ({ value: String(d), label: String(d) }))}
          onChange={v => set({ days: Number(v) }, "a chart's days chosen by hand")} />
      </Row>
      {/* a chart that counts says no measure at all, as it did before it could say one */}
      <MeasureRows p={p} ef={ef} aggs={p.split ? SPLIT_AGGS : FIGURE_AGGS} note="a chart's measure chosen by hand"
        set={(patch, note) => set({ ...patch, ...(patch.agg === "count" ? { agg: null } : {}) }, note)} />
      <Row label="Split by" testid="setup-split"
        hint={!splits ? "A split stacks its bars, so it measures how many or a sum."
          : p.split ? "Its most common values, each in its own colour; the rest are folded into Other." : undefined}>
        <Pick label="Split by" value={String(p.split ?? "")} none="Nothing" options={keeping(asOptions(categories), p.split as string)}
          disabled={!splits && !p.split} onPick={v => set({ split: v || null, top: v ? (p.top ?? null) : null }, "a chart's split chosen by hand")} />
        {!!p.split && (
          <Segmented label="Values drawn" value={String(p.top ?? 5)} options={CHART_TOPS.map(t => ({ value: String(t), label: `Top ${t}` }))}
            onChange={v => set({ top: Number(v) === 5 ? null : Number(v) }, "a chart's split chosen by hand")} />
        )}
      </Row>
    </>
  );
}

/** A breakdown: the property its objects are grouped by, one to three measures per group, how many groups it shows
 *  before the rest are one Other row, and whether it is a table with share bars or bars alone. */
function BreakdownSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const fields = fieldsFor(ef, [p.by as string]);
  const categories = fields.filter(isCategory);
  const measures = (Array.isArray(p.measures) ? p.measures : [{ agg: "count" }]) as Props[];
  const setMeasure = (i: number) => (patch: Props, note: string) =>
    set({ measures: measures.map((m, j) => (j === i ? { ...m, ...patch } : m)) }, note);
  return (
    <>
      <Row label="Label"><Words label="Label" value={String(p.label ?? "")} max={MAX_LABEL} onSave={v => set({ label: v }, "a breakdown's label written by hand")} /></Row>
      <Row label="Grouped by" hint="Its largest groups are shown; the rest are one Other row, and objects with no value their own.">
        <Pick label="Grouped by" value={String(p.by ?? "")} options={keeping(asOptions(categories), p.by as string)}
          onPick={v => set({ by: v }, "a breakdown's grouping chosen by hand")} />
      </Row>
      {measures.map((m, i) => (
        <div key={`measure-${i}`} data-testid="setup-breakdown-measure">
          <MeasureRows p={m} ef={ef} aggs={FIGURE_AGGS} note="a breakdown's measure chosen by hand" set={setMeasure(i)} />
          {i > 0 && (
            <Button size="xs" variant="ghost" onClick={() => set({ measures: measures.filter((_, j) => j !== i) }, "a breakdown's measure taken off")}>
              Take this measure off
            </Button>
          )}
        </div>
      ))}
      {measures.length < MAX_BREAKDOWN_MEASURES && (
        <Button size="xs" variant="outline" onClick={() => set({ measures: [...measures, { agg: "count" }] }, "a breakdown's measure added")}>
          Add a measure
        </Button>
      )}
      <Row label="Groups shown">
        <Segmented label="Groups shown" value={String(p.top ?? 8)} options={BREAKDOWN_TOPS.map(n => ({ value: String(n), label: `Top ${n}` }))}
          onChange={v => set({ top: Number(v) === 8 ? null : Number(v) }, "a breakdown's groups chosen by hand")} />
      </Row>
      <Row label="Shown as">
        <Segmented label="Shown as" value={String(p.show ?? "table")}
          options={[{ value: "table", label: "Table with shares" }, { value: "bars", label: "Bars" }]}
          onChange={v => set({ show: v === "table" ? null : v }, "how a breakdown is shown, chosen by hand")} />
      </Row>
    </>
  );
}

function FiltersSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  type F = { path: string; label: string; via?: string | null };
  const list = (p.properties as F[] | undefined) ?? [];
  const free = fieldsFor(ef, list.map(x => x.path)).filter(f => isCategory(f) && !list.some(x => x.path === f.path));
  const put = (next: F[], note: string) => set({ properties: next }, note);
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    put(next, "the filter column arranged by hand");
  };
  return (
    <>
      <Row label="Filters by" right={`${list.length} of ${MAX_FILTERS}`} testid="setup-filters"
        hint="Each reader's clicks are their own, and narrow every piece over the same objects.">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {withUniqueKeys(list, f => f.path).map(([key, f], i) => (
            <li key={key} className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--t1)" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.label}{f.via && <span style={{ color: "var(--vio4)" }}> via {f.via}</span>}
              </span>
              <Button size="xs" variant="plain" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevu" size={12} /></Button>
              <Button size="xs" variant="plain" aria-label={`Move ${f.label} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><Icon name="chevd" size={12} /></Button>
              <Button size="xs" variant="plain" aria-label={`Take ${f.label} off`} disabled={list.length === 1}
                onClick={() => put(list.filter(x => x.path !== f.path), "a filter taken off by hand")}><Icon name="close" size={12} /></Button>
            </li>
          ))}
        </ul>
        {list.length < MAX_FILTERS && free.length > 0 && (
          <Pick label="Add a filter" value="" none="+ Add a filter" options={asOptions(free)}
            onPick={v => {
              const f = free.find(x => x.path === v);
              if (f) put([...list, { path: f.path, label: f.label.slice(0, MAX_LABEL), ...(f.via ? { via: f.via.slice(0, MAX_LABEL) } : {}) }], "a filter added by hand");
            }} />
        )}
      </Row>
    </>
  );
}

function ProcessSetup({ p, connectionId, schema, set }: { p: Props; connectionId: string; schema?: string; set: (patch: Props, note: string) => void }) {
  const [processes, setProcesses] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    getProcesses(connectionId, schema).then(r => { if (alive) setProcesses(r.processes.map(x => ({ value: x.id, label: x.display_name || words(x.id) }))); })
      .catch(() => { /* the process it names stays offered */ });
    return () => { alive = false; };
  }, [connectionId, schema]);
  return (
    <Row label="Process" hint="Each stage, how often each promise is broken, and the objects open past it.">
      <Pick label="Process" value={String(p.process ?? "")} options={keeping(processes, p.process as string)}
        onPick={v => v && set({ process: v }, "a board's process chosen by hand")} />
    </Row>
  );
}

function ActionSetup({ spec, k, p, connectionId, schema, set }: {
  spec: DashboardSpec; k: string; p: Props; connectionId: string; schema?: string; set: (patch: Props, note: string) => void;
}) {
  const [actions, setActions] = useState<Record<string, DeclaredAction>>({});
  useEffect(() => {
    let alive = true;
    getDeclaredActions(connectionId, schema).then(a => { if (alive) setActions(a); }).catch(() => { /* the action it names stays offered */ });
    return () => { alive = false; };
  }, [connectionId, schema]);
  // the detail holding the button follows a table: the actions offered are the ones that take one of its objects
  const detail = Object.entries(spec.elements).find(([, el]) => el.type === "ObjectDetail" && el.children.includes(k))?.[1];
  const entity = String(spec.elements[String(detail?.props.follows ?? "")]?.props.entity ?? "").toLowerCase();
  const fits = Object.values(actions).filter(a => !entity || a.params.some(x => x.kind === "object" && x.object_type.toLowerCase() === entity));
  return (
    <Row label="Action" hint="Run on the object the detail shows — or proposed for approval when it needs one.">
      <Pick label="Action" value={String(p.action ?? "")} options={keeping(fits.map(a => ({ value: a.id, label: a.display_name || words(a.id) })), p.action as string)}
        onPick={v => v && set({ action: v }, "a button's action chosen by hand")} />
    </Row>
  );
}

// ── Arc AP-4 — the pieces the picker adds ───────────────────────────────────────────────────────────────────────────

/** How a list, a map or a timeline calls each object: by a property, or by its key — "Order 63981". */
function CalledByRow({ p, prop, fields, set, note }: { p: Props; prop: string; fields: EntityField[]; set: (patch: Props, note: string) => void; note: string }) {
  const named = fields.filter(f => !isTime(f) && !isNumber(f) && f.role !== "key");
  return (
    <Row label="Each is called by" hint={p[prop] ? undefined : "Its key, beside what it is — “Order 63981” — until a property is chosen."}>
      <Pick label="Called by" value={String(p[prop] ?? "")} none="Its key" options={keeping(asOptions(named), p[prop] as string)}
        onPick={v => set({ [prop]: v || null }, note)} />
    </Row>
  );
}

function ListSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const fields = fieldsFor(ef, [p.title, p.figure, p.mark, p.sort] as string[]);
  const note = "an object list set up by hand";
  return (
    <>
      <CalledByRow p={p} prop="title" fields={fields} set={set} note={note} />
      <Row label="Beside it" hint="A number, written as the ontology declares it — money as money.">
        <Pick label="Beside it" value={String(p.figure ?? "")} none="Nothing" options={keeping(asOptions(ranked(fields.filter(isNumber))), p.figure as string)}
          onPick={v => set({ figure: v || null }, note)} />
      </Row>
      <Row label="Marked by" hint="A category, as a chip under its name.">
        <Pick label="Marked by" value={String(p.mark ?? "")} none="Nothing" options={keeping(asOptions(fields.filter(isCategory)), p.mark as string)}
          onPick={v => set({ mark: v || null }, note)} />
      </Row>
      <Row label="Sorted by">
        <Pick label="Sorted by" value={String(p.sort ?? "")} none="The key" options={keeping(asOptions(fields), p.sort as string)}
          onPick={v => set({ sort: v || null, descending: v ? (p.descending ?? false) : null }, note)} />
        {!!p.sort && (
          <Segmented label="Order" value={p.descending ? "desc" : "asc"}
            options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]}
            onChange={v => set({ descending: v === "desc" }, note)} />
        )}
      </Row>
    </>
  );
}

function MapSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const fields = fieldsFor(ef, [p.lat, p.lng, p.label] as string[]);
  const degrees = asOptions(fields.filter(f => !isTime(f) && NUMBER.test(f.type)));
  const note = "a map set up by hand";
  return (
    <>
      <Row label="Placed at" hint="A latitude and a longitude in degrees — its own, or those of an object it links to.">
        <Pick label="Latitude" value={String(p.lat ?? "")} options={keeping(degrees, p.lat as string)} onPick={v => v && set({ lat: v }, note)} />
        <Pick label="Longitude" value={String(p.lng ?? "")} options={keeping(degrees, p.lng as string)} onPick={v => v && set({ lng: v }, note)} />
      </Row>
      <CalledByRow p={p} prop="label" fields={fields} set={set} note={note} />
    </>
  );
}

function TimelineSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const fields = fieldsFor(ef, [p.start, p.end, p.label] as string[]);
  const times = asOptions(fields.filter(isTime));
  const note = "a timeline set up by hand";
  return (
    <>
      <Row label="From" hint="Each a bar from one moment to the other, the latest first; one with no end yet runs to today.">
        <Pick label="From" value={String(p.start ?? "")} options={keeping(times, p.start as string)} onPick={v => v && set({ start: v }, note)} />
      </Row>
      <Row label="To">
        <Pick label="To" value={String(p.end ?? "")} options={keeping(times, p.end as string)} onPick={v => v && set({ end: v }, note)} />
      </Row>
      <CalledByRow p={p} prop="label" fields={fields} set={set} note={note} />
    </>
  );
}

function ChooseOneSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const texts = asOptions(fieldsFor(ef, [p.label as string]).filter(isText));
  return (
    <Row label="Found by" testid="setup-found-by"
      hint={`The words a reader types look for it here. It chooses “${wireWords(String(p.chooses ?? ""))}”: a detail, a set or a button reads it.`}>
      <Pick label="Found by" value={String(p.label ?? "")} options={keeping(texts, p.label as string)}
        onPick={v => v && set({ label: v }, "what a choose-one finds by chosen by hand")} />
    </Row>
  );
}

function SearchSetup({ p, ef, set }: { p: Props; ef: EntityFields; set: (patch: Props, note: string) => void }) {
  const texts = asOptions(fieldsFor(ef, [p.path as string]).filter(isText));
  return (
    <>
      <Row label="Label"><Words label="Label" value={String(p.label ?? "")} max={MAX_LABEL} onSave={v => set({ label: v }, "a search's label written by hand")} /></Row>
      <Row label="Looks in" testid="setup-looks-in" hint="Every piece over these objects narrows to the ones whose property holds the words — for each reader alone.">
        <Pick label="Looks in" value={String(p.path ?? "")} options={keeping(texts, p.path as string)}
          onPick={v => v && set({ path: v }, "what a search looks in chosen by hand")} />
      </Row>
    </>
  );
}

// ── Arc AP-2 — what a piece reads, and what it chooses ───────────────────────────────────────────────────────────────

/** Which set a table, a figure or a chart reads: every object of its entity, or a set the dashboard names. */
function ReadsRow({ spec, k, p, entity, onChange }: { spec: DashboardSpec; k: string; p: Props; entity: string; onChange: Change }) {
  const sets = Object.entries(spec.sets ?? {});
  const value = p.set ? `set:${String(p.set)}` : `entity:${entity}`;
  return (
    <Row label="Reads" testid="setup-reads" hint="A set is named in the Data tab: an entity narrowed by a segment, conditions, or a chosen object.">
      <Pick label="Reads" value={value}
        options={[{ value: `entity:${entity}`, label: `Every ${words(entity).toLowerCase()}` }, ...sets.map(([n, d]) => ({ value: `set:${n}`, label: d.label }))]}
        onPick={v => onChange(setProps(spec, k, v.startsWith("set:") ? { set: v.slice(4), entity: null, segment: null } : { entity, set: null, set_from: null }),
          "what a piece reads chosen by hand")} />
    </Row>
  );
}

/** What a filter column counts within (Arc AP-2): every object of its entity, or a set of it — so its counts say how
 *  the waiting orders split, not every order ever. */
function CountsWithinRow({ spec, k, p, onChange }: { spec: DashboardSpec; k: string; p: Props; onChange: Change }) {
  const entity = String(p.entity ?? "");
  const sets = Object.keys(spec.sets ?? {}).map(n => ({ n, r: readSet(spec, n) }))
    .filter(({ r }) => !isRefused(r) && r.entity.toLowerCase() === entity.toLowerCase() && !r.linkedTo);
  return (
    <Row label="Counts within" testid="setup-counts-within" hint="A reader's ticks narrow every set of the same objects, whatever it counts within.">
      <Pick label="Counts within" value={p.set ? String(p.set) : ""}
        options={[{ value: "", label: `Every ${words(entity).toLowerCase()}` }, ...sets.map(({ n }) => ({ value: n, label: spec.sets?.[n]?.label ?? n }))]}
        onPick={v => onChange(setProps(spec, k, { set: v || null }), "what a filter column counts within chosen by hand")} />
    </Row>
  );
}

/** What a click in a table, a list, a map or a timeline chooses, and what a table's or a list's ticks collect — each a
 *  choice other pieces read — and whether figures switch the set it lists. */
function ChoicesRows({ spec, k, p, noun, set }: { spec: DashboardSpec; k: string; p: Props; noun: string; set: (patch: Props, note: string) => void }) {
  const shown = [...choicesOf(spec).values()].filter(c => c.kind === "shown");
  const type = spec.elements[k]?.type as PieceName;
  const thing = type === "ObjectList" ? "card" : type === "ObjectMap" ? "place" : type === "ObjectTimeline" ? "bar" : "row";
  return (
    <>
      <Row label="A click" testid="setup-chooses" hint={p.chooses ? `Chooses “${wireWords(String(p.chooses))}”: a detail, a set or a button reads it.` : `Chooses a ${thing} for a detail that follows this piece.`}>
        <label className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--t2)" }}>
          <Tick checked={!!p.chooses} aria-label="A click chooses for the dashboard"
            onChange={e => set({ chooses: e.target.checked ? freshWireName(spec, `chosen ${noun}`) : null }, "what a click chooses named by hand")} />
          Names the {noun.toLowerCase()} it chooses, for other pieces
        </label>
      </Row>
      {TICKERS.includes(type) && (
        <Row label="Ticks" testid="setup-ticks" hint={p.ticks ? `Collects “${wireWords(String(p.ticks))}” — a button runs once for each, at most ${MAX_TICKED_RUNS}.` : undefined}>
          <label className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--t2)" }}>
            <Tick checked={!!p.ticks} aria-label={`Ticks collect ${thing}s`}
              onChange={e => set({ ticks: e.target.checked ? freshWireName(spec, `ticked ${noun}`) : null }, "what ticks collect named by hand")} />
            A tick beside each {thing}
          </label>
        </Row>
      )}
      {!!p.set && shown.length > 0 && (
        <Row label="Figures switch it" hint="A figure clicked shows its set here; the set above stands until one is.">
          <Pick label="Figures switch it" value={String(p.set_from ?? "")} none="No" options={shown.map(c => ({ value: c.name, label: `Yes — the figures that show in “${wireWords(c.name)}”` }))}
            onPick={v => set({ set_from: v || null }, "what switches a table chosen by hand")} />
        </Row>
      )}
    </>
  );
}

/** What a figure is said beside, and the list a click shows its set in. */
function FigureWiring({ spec, p, set }: { spec: DashboardSpec; p: Props; set: (patch: Props, note: string) => void }) {
  const sets = Object.entries(spec.sets ?? {});
  const shown = [...choicesOf(spec).values()].filter(c => c.kind === "shown");
  return (
    <>
      <Row label="Said beside" hint="The same measure over another set, said under the figure: “of … placed”.">
        <Pick label="Said beside" value={String(p.of ?? "")} none="Nothing, or the whole while filtered" options={sets.map(([n, d]) => ({ value: n, label: `of ${d.label}` }))}
          onPick={v => set({ of: v || null }, "what a figure is said beside chosen by hand")} />
      </Row>
      {!!p.set && (
        <Row label="A click" testid="setup-shows" hint="Shows this figure's set in a table that figures switch.">
          <Pick label="A click shows it" value={String(p.shows ?? "")} none="Does nothing"
            options={[...shown.map(c => ({ value: c.name, label: `Switches the list in “${wireWords(c.name)}”` })),
              ...(shown.length ? [] : [{ value: freshWireName(spec, "shown"), label: "Shows it in a list (new)" }])]}
            onPick={v => set({ shows: v || null }, "what a figure's click shows chosen by hand")} />
        </Row>
      )}
    </>
  );
}

/** v15 — a placed card and the date the period cuts it by. */
export interface CardDate { id: string; title: string; date: string | null; standing: boolean }

/** The period's choices as a person reads them (the PeriodPicker's words). */
const OPENS_WORDS: Record<(typeof PERIOD_OPENS)[number], string> = {
  standing: "As written", current_day: "Current day", current_week: "Current week", current_month: "Current month",
  current_year: "Current year", previous_week: "Last week", previous_month: "Last month", previous_year: "Last year",
};

/** Each card and the date the period cuts it by — or that it has none and is read as written. */
function PeriodCuts({ dates }: { dates: CardDate[] }) {
  if (!dates.length) return <span className="aug-fs-sm" style={{ color: "var(--t3)" }}>No card on the dashboard yet.</span>;
  return (
    <div data-testid="period-cuts" style={{ display: "flex", flexDirection: "column", border: "1px solid var(--b1)", borderRadius: "var(--r2)" }}>
      {dates.map((d, i) => (
        <div key={d.id} className="aug-fs-sm" style={{ display: "flex", flexDirection: "column", gap: 1, padding: "6px 10px",
          borderTop: i ? "1px solid var(--b1)" : undefined }}>
          <span style={{ color: "var(--t1)" }}>{d.title}</span>
          <span className="aug-fs-xs" style={{ color: "var(--t3)", fontFamily: d.date ? "var(--font-mono)" : undefined }}>
            {d.standing || !d.date ? "no date: read as written" : d.date}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A part of the panel folded under its name: a row that opens it, the way it opens said by its arrow. */
function Fold({ label, testid, children }: { label: string; testid?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--b1)" }}>
      <Button size="sm" variant="plain" data-testid={testid} aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ width: "100%", justifyContent: "space-between", padding: "8px 14px", height: "auto", borderRadius: 0 }}>
        <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{label}</span>
        <Icon name={open ? "chevu" : "chevd"} size={14} />
      </Button>
      {open && <div>{children}</div>}
    </div>
  );
}

/** With nothing chosen, the dashboard's own setup (the dashboards study, R6, 2026-11-18): its name, what it holds, the
 *  way to its layout, and the keys. */
function DashboardSetup({ spec, onChange, onOpenLayout, release }: { spec: DashboardSpec; onChange: Change; onOpenLayout?: () => void; release?: string | null }) {
  const root = spec.root;
  const top = spec.elements[root];
  const count = (types: string[]) => Object.values(spec.elements).filter(e => types.includes(e.type)).length;
  const holds: [string, number][] = [
    ["Sections", count(["Section"])],
    ["Cards", count(["Card"])],
    ["Pieces from the ontology", Object.values(spec.elements).filter(e => e.type.startsWith("Object") || e.type === "ProcessBoard").length],
    ["Notes and pictures", count(["Note", "Image"])],
    ["Variables", Object.keys(spec.sets ?? {}).length + Object.keys(spec.values ?? {}).length],
  ];
  const lines = Object.keys(spec.elements).length;
  return (
    <div data-testid="setup-empty">
      <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid var(--b1)" }}>
        <div className="aug-fs-xs" style={{ color: "var(--accent-11)", textTransform: "uppercase", letterSpacing: ".06em" }}>Dashboard</div>
        <div className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600, marginTop: 2 }}>{String(top?.props.title ?? "") || "This dashboard"}</div>
        <div className="aug-fs-xs" style={{ color: "var(--t3)", marginTop: 4, lineHeight: 1.45 }}>
          Nothing is chosen: this is the dashboard's own setup. Choose a piece on the dashboard to set it up; its size moves
          one grade at a time — drag an edge or a corner, or Alt and the arrow keys.
        </div>
      </div>
      {top && (
        <Row label="Name"><Words label="Name" value={String(top.props.title ?? "")} max={MAX_TITLE} onSave={v => onChange(rename(spec, root, v), "renamed by hand")} /></Row>
      )}
      {top && Object.keys((top.props.colors ?? {}) as object).length > 0 && (
        <Row label="Colours kept" testid="setup-kept-colors" hint="Every card colouring by one of these fields shows each value in its colour. Choose a card to change them.">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {Object.entries(top.props.colors as Record<string, Record<string, number>>).map(([field, values]) => (
              <div key={field} className="aug-fs-sm" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--t2)" }}>{words(field)}</span>
                {Object.entries(values).map(([value, n]) => (
                  <span key={value} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: `var(--chart-${n})` }} />{value}
                  </span>
                ))}
                <Button size="xs" variant="ghost" style={{ marginLeft: "auto" }} onClick={() => {
                  const next = { ...(top.props.colors as Record<string, unknown>) };
                  delete next[field];
                  onChange(setProps(spec, root, { colors: Object.keys(next).length ? next : null }), "a field's colours let go by hand");
                }}>Let go</Button>
              </div>
            ))}
          </div>
        </Row>
      )}
      {release && (
        <Row label="Ontology release" testid="setup-release">
          <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>Its pieces read release {release}, the one it was composed against.</span>
        </Row>
      )}
      <Row label="What it holds">
        <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--b1)", borderRadius: "var(--r2)" }}>
          {holds.map(([what, n], i) => (
            <div key={what} className="aug-fs-sm" style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px",
              borderTop: i ? "1px solid var(--b1)" : undefined }}>
              <span style={{ color: "var(--t2)" }}>{what}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>
            </div>
          ))}
        </div>
        {onOpenLayout && (
          <Button size="xs" variant="ghost" data-testid="setup-open-layout" onClick={onOpenLayout} style={{ alignSelf: "flex-start" }}>
            Open the layout · {lines} {lines === 1 ? "line" : "lines"}
          </Button>
        )}
      </Row>
      <div className="aug-fs-xs" style={{ padding: "10px 14px", color: "var(--t3)", borderTop: "1px solid var(--b1)", lineHeight: 1.5 }}>
        Keys: ⌘Z undo · ⇧⌘Z redo · Delete takes off · ⌘D duplicates · Esc lets go
      </div>
    </div>
  );
}

// ── the panel ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function PieceSetup({ spec, selected, onChange, connectionId, schema, cardTitle, entityTitle, cardSetup, cardChart, cardSql, onOpenLayout, cardDates, cardHolds, release }: {
  spec: DashboardSpec;
  /** The ontology release its pieces read, when it is the one the dashboard was composed against. */
  release?: string | null;
  /** v17 — what a placed card holds that its panel offers to draw: number columns, and fields whose values it colours. */
  cardHolds?: (cardId: string) => CardHolds;
  /** v15 — each placed card and the date the period cuts it by, for the Period piece's setup. */
  cardDates?: () => CardDate[];
  /** Open the layout pane, folded away by default (the dashboards study, R7, 2026-11-18). */
  onOpenLayout?: () => void;
  selected: string | null;
  onChange: Change;
  connectionId: string;
  schema?: string;
  cardTitle?: (id: string) => string | undefined;
  /** The name the ontology gives an entity, where the caller knows it. */
  entityTitle?: (id: string) => string | undefined;
  /** Arc AP-7 — the setup of a card the page knows more of (a card of a person's own query), by its id. */
  cardSetup?: (cardId: string) => ReactNode | null;
  /** The board study — the card's own chart editor, held in the panel. */
  cardChart?: (cardId: string) => ReactNode | null;
  /** The board study — the statement the card ran. */
  cardSql?: (cardId: string) => ReactNode | null;
}) {
  const el = selected ? spec.elements[selected] : undefined;
  // the entity a piece reads: its set's (Arc AP-2), or the one it names
  const read = el ? pieceSet(spec, el.props) : null;
  const own = el?.type === "ObjectFilters" || el?.type === "ObjectSearch";
  const entity = el && (own || SET_READERS.includes(el.type as PieceName))
    ? (!own && read && !isRefused(read) ? read.entity : String(el.props.entity ?? "")) : undefined;
  const ef = useEntityFields(entity, connectionId, schema);
  if (!selected || !el) return <DashboardSetup spec={spec} onChange={onChange} onOpenLayout={onOpenLayout} release={release} />;
  const k = selected;
  const p = el.props as Props;
  const set = (patch: Props, note: string) => onChange(setProps(spec, k, patch), note);
  const named = nameOf(spec.elements, k, cardTitle, entityTitle, setTitles(spec));
  const noun = entity ? entityTitle?.(entity) ?? words(entity) : "";
  const kind = named.kind.charAt(0).toUpperCase() + named.kind.slice(1);
  const title = named.title;
  const needsFields = entity !== undefined;
  const fieldsBody = (body: (ef: EntityFields) => ReactNode) => (
    !ef ? <div className="aug-fs-sm" style={{ padding: "10px 14px", color: "var(--t3)" }}>Reading what {noun} holds…</div>
      : "problem" in ef ? <div className="aug-fs-sm" style={{ padding: "10px 14px", color: "var(--t2)" }}>What {noun} holds could not be read: {ef.problem}</div>
        : body(ef)
  );
  const placed = !["Cockpit", "Tabs", "Tab", "Section", "ObjectFilters", "GlobalFilter", "ActionButton", "Drawer"].includes(el.type);
  return (
    <div data-testid="piece-setup" data-kind={el.type}>
      <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid var(--b1)" }}>
        <div className="aug-fs-xs" style={{ color: "var(--accent-11)", textTransform: "uppercase", letterSpacing: ".06em" }}>{kind}</div>
        <div className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{title || kind}</div>
      </div>
      {el.type === "Cockpit" && (
        <Row label="Name"><Words label="Name" value={String(p.title ?? "")} max={MAX_TITLE} onSave={v => onChange(rename(spec, k, v), "renamed by hand")} /></Row>
      )}
      {el.type === "Tab" && (
        <Row label="Label"><Words label="Label" value={String(p.label ?? "")} max={MAX_LABEL} onSave={v => onChange(rename(spec, k, v), "a tab renamed by hand")} /></Row>
      )}
      {el.type === "Section" && (
        <>
          <Row label="Title"><Words label="Title" value={String(p.title ?? "")} max={MAX_TITLE} onSave={v => onChange(rename(spec, k, v), "a section renamed by hand")} /></Row>
          {tabsOf(spec).length > 0 && (
            <Row label="In the tab">
              <Pick label="In the tab" value={tabsOf(spec).find(t => spec.elements[t.key]?.children.includes(k))?.key ?? ""}
                options={tabsOf(spec).map(t => ({ value: t.key, label: t.label }))} onPick={v => onChange(moveSectionTo(spec, k, v), "a section moved by hand")} />
            </Row>
          )}
          <Row label="Laid out" hint={p.grid ? "Twelve columns, and rows of 40 px: each piece moves one grade at a time."
            : "By size. Resize anything in it and it moves onto the twelve-column grid, each piece keeping its room."}>
            <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{p.grid ? "On the grid" : `${p.columns ?? "Up to 4"} columns`}</span>
          </Row>
        </>
      )}
      {el.type === "Card" && (
        <div data-testid="card-panel">
          {/* one panel for a card that opens on its look (the dashboards study, R6, 2026-11-18): how it is drawn first,
              then what it reads and the statement it ran, each a fold below — they were tabs a click away */}
          {cardChart?.(String(p.card ?? ""))}
          <div className="aug-fs-xs" data-testid="card-alt-click" style={{ padding: "8px 14px 0", color: "var(--t3)" }}>
            A click here chooses the card. Alt and a click on a mark tries the filter it makes for readers.
          </div>
          <CardLook p={p} own={cardTitle?.(String(p.card ?? "")) ?? "the card's title"} set={set} />
          <CardFilters p={p} set={set} spec={spec} connectionId={connectionId} />
          <ColumnLooks numbers={cardHolds?.(String(p.card ?? "")).numbers ?? []} p={p} set={set}
            hint="Each against every row the card holds. A bar runs the length of its value; a scale washes a cell from its column's lowest to its highest." />
          <KeptColors fields={cardHolds?.(String(p.card ?? "")).fields ?? []} spec={spec} onChange={onChange} />
          <Row label="Edge" hint="A coloured edge is emphasis. What the card measures is the card's own.">
            <Pick label="Edge" value={String(p.tone ?? "")} none="None" options={TONES.map(t => ({ value: t, label: TONE_WORDS[t] }))}
              onPick={v => set({ tone: v || null }, "a card's edge chosen by hand")} />
          </Row>
          {cardSetup && <Fold label="What it reads" testid="card-fold-reads">{cardSetup(String(p.card ?? "")) ?? (
            <div className="aug-fs-sm" style={{ padding: "4px 14px 10px", color: "var(--t3)" }}>A card from the card store: what it reads is the card's own.</div>
          )}</Fold>}
          {cardSql && <Fold label="The SQL, as it ran" testid="card-fold-sql">{cardSql(String(p.card ?? ""))}</Fold>}
        </div>
      )}
      {el.type === "GlobalFilter" && <GlobalFilterSetup p={p} connectionId={connectionId} set={set} spec={spec} onChange={onChange} />}
      {el.type === "Period" && (
        <>
          <Row label="Label"><Words label="Label" value={String(p.label ?? "Period")} max={MAX_LABEL}
            onSave={v => set({ label: v === "Period" ? null : v }, "the period's label changed by hand")} /></Row>
          <Row label="Opens on" testid="setup-period-opens" hint="What the dashboard is read for when it opens. A reader chooses another, a custom range too.">
            <Pick label="Opens on" value={String(p.opens_on ?? "previous_month")}
              options={PERIOD_OPENS.map(o => ({ value: o, label: OPENS_WORDS[o] }))}
              onPick={v => set({ opens_on: v === "previous_month" ? null : v }, "what the period opens on chosen by hand")} />
          </Row>
          <Row label="What it cuts" testid="setup-period-cuts"
            hint="Every card is cut to the period by its own date. A card with none is read as written, and says so.">
            <PeriodCuts dates={cardDates?.() ?? []} />
          </Row>
        </>
      )}
      {el.type === "Note" && (
        <Row label="Words" hint="Yours, stamped with your name and today when kept. A model never writes one. Start a line with # or ## for a heading; a note of headings alone stands on the page with no card.">
          <Words many label="Words" value={String(p.text ?? "")} max={MAX_NOTE} onSave={v => onChange(editNote(spec, k, v), "a note's words changed by hand")} />
        </Row>
      )}
      {el.type === "Image" && (
        <Row label="Caption"><Words label="Caption" value={String(p.caption ?? "")} max={MAX_CAPTION} onSave={v => onChange(recaption(spec, k, v), "an image's caption changed by hand")} /></Row>
      )}
      {el.type === "Drawer" && (
        <>
          <Row label="Title"><Words label="Title" value={String(p.title ?? "")} max={MAX_TITLE} onSave={v => set({ title: v }, "a drawer renamed by hand")} /></Row>
          <Row label="Opens on" testid="setup-opens-on" hint="A click that chooses one opens the drawer beside the page; closing it lets go of the choice.">
            <Pick label="Opens on" value={String(p.opens_on ?? "")} onPick={v => v && set({ opens_on: v }, "what opens a drawer chosen by hand")}
              options={keeping([...choicesOf(spec).values()].filter(c => c.kind === "chosen").map(c => ({ value: c.name, label: `The ${wireWords(c.name)}` })), p.opens_on as string)} />
          </Row>
        </>
      )}
      {el.type === "ProcessBoard" && <ProcessSetup p={p} connectionId={connectionId} schema={schema} set={set} />}
      {el.type === "ObjectDetail" && (
        <Row label="Shows the object chosen in">
          <Pick label="Follows" value={String(p.follows ?? "")} onPick={v => v && set({ follows: v }, "a detail's table chosen by hand")}
            options={[...Object.keys(spec.elements).filter(x => CHOOSERS.includes(spec.elements[x].type as PieceName) && spec.elements[x].type !== "ChooseOne")
              .map(x => ({ value: x, label: lineOf(spec.elements, x, undefined, undefined, setTitles(spec)) })),
              ...[...choicesOf(spec).values()].filter(c => c.kind === "chosen").map(c => ({ value: c.name, label: `The ${wireWords(c.name)}` }))]} />
        </Row>
      )}
      {el.type === "ActionButton" && <ActionSetup spec={spec} k={k} p={p} connectionId={connectionId} schema={schema} set={set} />}
      {SET_READERS.includes(el.type as PieceName) && <ReadsRow spec={spec} k={k} p={p} entity={entity ?? ""} onChange={onChange} />}
      {CHOOSERS.includes(el.type as PieceName) && el.type !== "ChooseOne" && <ChoicesRows spec={spec} k={k} p={p} noun={noun} set={set} />}
      {el.type === "ObjectFigure" && <FigureWiring spec={spec} p={p} set={set} />}
      {el.type === "ObjectFilters" && <CountsWithinRow spec={spec} k={k} p={p} onChange={onChange} />}
      {el.type === "ActionButtons" && <ButtonsSetup spec={spec} k={k} onChange={onChange} connectionId={connectionId} schema={schema} />}
      {needsFields && el.type === "ObjectTable" && fieldsBody(f => <TableSetup p={p} ef={f} set={set} noun={noun} />)}
      {needsFields && el.type === "ObjectTable" && fieldsBody(f => (
        <ColumnLooks p={p} set={set} labelOf={path => fieldLabel(f.fields.find(x => x.path === path) ?? { path, label: words(path), role: "", type: "", unit: "" })}
          numbers={((p.columns as string[] | null | undefined) ?? []).filter(path => isNumericType(f.fields.find(x => x.path === path)?.type ?? ""))}
          hint="Each against the page shown. A bar runs the length of its value; a scale washes a cell from its column's lowest to its highest." />
      ))}
      {needsFields && (el.type === "ObjectTable" || el.type === "ObjectList")
        && fieldsBody(f => <MarkRow p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectFigure" && fieldsBody(f => <FigureSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectChart" && fieldsBody(f => <ChartSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectBreakdown" && fieldsBody(f => <BreakdownSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectFilters" && fieldsBody(f => <FiltersSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectList" && fieldsBody(f => <ListSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectMap" && fieldsBody(f => <MapSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectTimeline" && fieldsBody(f => <TimelineSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ChooseOne" && fieldsBody(f => <ChooseOneSetup p={p} ef={f} set={set} />)}
      {needsFields && el.type === "ObjectSearch" && fieldsBody(f => <SearchSetup p={p} ef={f} set={set} />)}
      {placed && <SectionPick spec={spec} k={k} onChange={onChange} />}
    </div>
  );
}
