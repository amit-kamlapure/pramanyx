"use client";

/**
 * The data a dashboard is built on (the user, 2026-11-19: the tables chosen "should be the base on which components get
 * created", and a peer product's Data section, where the data that backs a dashboard is added). A dataset is a table of
 * the connection or a statement of the person's own. A chart set down on the canvas is built on one, and set up there:
 * what runs along the bottom, what is measured, what colours it. A dataset is never itself a piece of the page, and adding
 * one asks no model.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { QUERY_DEFAULT, kindOf, setupAs } from "@/components/dashboards/QuerySetup";
import { BrandSpark, brandEdge } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QueryRefused, askForSql, getCatalogTree, keepDashboardQuery, previewDashboardQuery, type QueryPreview, type QueryShown, type QueryShownAs } from "@/lib/api";
import { MAX_LABEL, MAX_VALUES, type DashboardValueDef } from "@/lib/dashboards/catalog";
import {
  MAX_DATASETS, cardsBuiltOn, datasetOfCard, dropDataset, freshDatasetName, freshWireName, putDataset, putValue, swapCard, type DashboardDataset,
  type DashboardSpec,
} from "@/lib/dashboards/edit";
import { VALUE_KIND_WORDS, startText, triedValues, typedValue, valuesRead, type ValuesSent } from "@/lib/dashboards/values";
import { formatCount, formatSeconds } from "@/lib/format";
import { withUniqueKeys } from "@/lib/listKeys";

export interface TableChoice { schema: string; table: string }

export const tableName = (t: TableChoice) => (t.schema ? `${t.schema}.${t.table}` : t.table);
/** A table's name as a person reads it: "order_lines" is "Order lines". */
export const tableWords = (name: string) => { const s = name.replace(/[_-]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** A name as a statement writes it: bare where it can be, quoted as the connection quotes where it cannot. */
export function tableSql(t: TableChoice, quote: string, sheet = false): string {
  const part = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `${quote}${s.split(quote).join(quote + quote)}${quote}`);
  // a sheet's row number is the platform's own, never a column of the data
  return `SELECT *${sheet ? " EXCLUDE (_row)" : ""} FROM ${[t.schema, t.table].filter(Boolean).map(part).join(".")}`;
}

/** A table as a dataset: every row and column of it. */
export function tableDataset(t: TableChoice, quote: string, sheet = false): DashboardDataset {
  return { label: tableWords(t.table).slice(0, 120), sql: tableSql(t, quote, sheet), table: tableName(t) };
}

/** The spec holding each of `adds` beside what it holds, each under a name of its own, and the name each is held by. One
 *  the dashboard already holds (the same statement) is not added twice; past the most a dashboard holds, none is added. */
export function addDatasets(spec: DashboardSpec, adds: DashboardDataset[]): { spec: DashboardSpec; names: string[] } {
  let next = spec;
  const names: string[] = [];
  for (const d of adds) {
    const same = Object.entries(next.datasets ?? {}).find(([, x]) => x.sql.trim() === d.sql.trim());
    if (same) { names.push(same[0]); continue; }
    if (Object.keys(next.datasets ?? {}).length >= MAX_DATASETS) break;
    const name = freshDatasetName(next, d.label);
    next = putDataset(next, name, d);
    names.push(name);
  }
  return { spec: next, names };
}

export interface ConnectionTables { tables: TableChoice[] | null; quote: string; sheet: boolean; problem: string }

/** The tables a connection holds, as the catalog lists them, with how it quotes a name and whether it is the sheets'. */
export function useConnectionTables(connectionId: string, on = true): ConnectionTables {
  const [got, setGot] = useState<ConnectionTables>({ tables: null, quote: '"', sheet: false, problem: "" });
  useEffect(() => {
    if (!on) return;
    let alive = true;
    getCatalogTree().then(tree => {
      if (!alive) return;
      const entry = tree.sections.flatMap(s => s.entries).find(e => e.conn_id === connectionId);
      setGot({
        quote: /bigquery|mysql/i.test(String(entry?.conn_type ?? "")) ? "`" : '"',
        sheet: entry?.conn_type === "sheets",
        tables: (entry?.schemas ?? []).flatMap(s => s.tables.map(t => ({ schema: s.name, table: t.name }))),
        problem: "",
      });
    }).catch(e => { if (alive) setGot(g => ({ ...g, tables: [], problem: (e as Error).message })); });
    return () => { alive = false; };
  }, [connectionId, on]);
  return got;
}

/** The tables to tick, found by name; no more than `max` at once. */
export function TableChoices({ tables, picked, onFlip, max, disabled = false }: {
  tables: TableChoice[] | null; picked: string[]; onFlip: (key: string) => void; max: number; disabled?: boolean;
}) {
  const [term, setTerm] = useState("");
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (tables ?? []).filter(t => !q || tableName(t).toLowerCase().includes(q));
  }, [tables, term]);
  return (
    <>
      <Input type="search" aria-label="Find a table" placeholder="Find a table" leading={<Icon name="search" size={15} />} value={term} onChange={e => setTerm(e.target.value)} />
      <div role="group" aria-label="Tables" data-testid="dashboard-table-list" style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--b1)", borderRadius: "var(--r2)", padding: 4 }}>
        {tables === null ? <div className="aug-fs-sm" style={{ color: "var(--t3)", padding: 8 }}>Reading the tables…</div>
          : shown.length === 0 ? <div className="aug-fs-sm" style={{ color: "var(--t3)", padding: 8 }}>{term.trim() ? `No table matches “${term.trim()}”.` : "This connection has no tables to choose yet."}</div>
            : shown.map(t => {
              const key = tableName(t);
              const on = picked.includes(key);
              return (
                <label key={key} className="aug-fs-sm" data-testid="dashboard-table-choice" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: "var(--r2)", cursor: "pointer", background: on ? "var(--bg-sel)" : undefined }}>
                  <Checkbox checked={on} aria-label={key} disabled={disabled || (!on && picked.length >= max)} onChange={() => onFlip(key)} />
                  <Icon name="table" size={14} />
                  <span style={{ color: "var(--t1)" }}>{t.table}</span>
                  {t.schema && <span style={{ color: "var(--t3)" }}>{t.schema}</span>}
                </label>
              );
            })}
      </div>
    </>
  );
}

/** Data added to a dashboard: tables of the connection ticked, or a statement of the person's own, run once to check it
 *  reads before it is held. */
export function AddData({ spec, connectionId, way, onAdd, onClose, doneWords = "Check and add" }: {
  spec: DashboardSpec; connectionId: string; way: "table" | "sql";
  onAdd: (next: DashboardSpec, names: string[], note: string) => void;
  /** None where there is nothing to go back to: the statement is the whole of the step. */
  onClose?: () => void;
  doneWords?: string;
}) {
  const room = MAX_DATASETS - Object.keys(spec.datasets ?? {}).length;
  const { tables, quote, sheet, problem: unread } = useConnectionTables(connectionId, way === "table");
  const [picked, setPicked] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [sql, setSql] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string[]>([]);
  const flip = (key: string) => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : p.length < room ? [...p, key] : p));
  const addTables = () => {
    const chosen = (tables ?? []).filter(t => picked.includes(tableName(t)));
    const out = addDatasets(spec, chosen.map(t => tableDataset(t, quote, sheet)));
    onAdd(out.spec, out.names, chosen.length === 1 ? "a table added as data by hand" : "tables added as data by hand");
  };
  const addSql = async () => {
    setChecking(true); setProblem([]);
    try {
      const got = await previewDashboardQuery(connectionId, { sql, shown: { ...QUERY_DEFAULT, as: "table" }, title: label.trim() });
      if (got.refused.length) { setProblem(got.refused); return; }
      const out = addDatasets(spec, [{ label: label.trim().slice(0, 120), sql: sql.trim() }]);
      onAdd(out.spec, out.names, "a statement added as data by hand");
    } catch (e) {
      setProblem([(e as Error).message]);
    } finally { setChecking(false); }
  };
  if (room <= 0) {
    return (
      <div className="aug-fs-sm" data-testid="add-data-full" style={{ color: "var(--t2)", padding: "4px 0" }}>
        This dashboard holds {MAX_DATASETS} datasets, the most it may. Take one off to add another.
        {onClose && <Button size="xs" variant="ghost" onClick={onClose} style={{ marginLeft: 6 }}>Close</Button>}
      </div>
    );
  }
  return (
    <div data-testid="add-data" data-way={way} style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--b1)", borderRadius: "var(--r3)", padding: 10 }}>
      <div className="aug-fs-xs" style={{ color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".06em" }}>{way === "table" ? "Add data" : "Add SQL dataset"}</div>
      {way === "table" ? (
        <>
          <TableChoices tables={tables} picked={picked} onFlip={flip} max={room} />
          {unread && <span className="aug-fs-sm" role="alert" style={{ color: "var(--t1)" }}>{unread}</span>}
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="sm" data-testid="add-data-tables" disabled={!picked.length} onClick={addTables}>
              {picked.length > 1 ? `Add ${formatCount(picked.length)} tables` : "Add the table"}
            </Button>
            {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}
          </span>
        </>
      ) : (
        <>
          <Input aria-label="The dataset's name" placeholder="Orders this year" value={label} maxLength={120} disabled={checking} onChange={e => setLabel(e.target.value)} />
          <Textarea aria-label="The dataset's SQL" data-testid="add-data-sql" placeholder="SELECT * FROM orders WHERE …" rows={6} spellCheck={false}
            value={sql} disabled={checking} onChange={e => setSql(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} />
          {problem.length > 0 && (
            <ul className="aug-fs-sm" role="alert" data-testid="add-data-refused" style={{ margin: 0, paddingLeft: 18, color: "var(--t1)" }}>
              {withUniqueKeys(problem, p => p).map(([k, p]) => <li key={k}>{p}</li>)}
            </ul>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="sm" data-testid="add-data-check" disabled={!label.trim() || !sql.trim() || checking} onClick={() => void addSql()}>
              {checking ? "Checking…" : doneWords}
            </Button>
            {onClose && <Button size="sm" variant="ghost" disabled={checking} onClick={onClose}>Cancel</Button>}
            <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Run once to check it reads. No model is asked.</span>
          </span>
        </>
      )}
    </div>
  );
}

/** A card as the page holds it: what a chart built on a dataset is re-kept with. */
export interface CardHeld { id: string; title: string; render?: unknown }

/** The dashboard's values a statement reads, as they start, for a chart kept on it — or why they cannot be sent. */
function paramsOf(spec: DashboardSpec, sql: string): { values?: ValuesSent } | { refused: string[] } {
  const names = valuesRead(sql);
  if (!names.length) return {};
  const got = triedValues(names, spec.values);
  return "refused" in got ? got : { values: got.values };
}

/** A dataset's new statement, kept on every chart built on it (the user, 2026-11-19: "link them"). Each chart is checked
 *  with its own setup first, so none changes unless every one reads the new statement; then each is kept again as a new
 *  card that replaces its own, dressed as it was. Back: the spec holding the new statement and the new cards, or each
 *  chart that cannot follow and why. */
export async function followDataset(connectionId: string, spec: DashboardSpec, name: string, def: DashboardDataset,
  cardOf: (cardId: string) => CardHeld | undefined): Promise<{ refused: string[] } | { spec: DashboardSpec; charts: number; swaps: [string, string][] }> {
  const held = cardsBuiltOn(spec, name).map(id => {
    const card = cardOf(id);
    return { id, card, shown: (card?.render as { shown?: QueryShown } | undefined)?.shown };
  });
  const sent = paramsOf(spec, def.sql);
  if ("refused" in sent) return sent;
  const refused: string[] = [];
  for (const { id, card, shown } of held) {
    if (!card || !shown) { refused.push(`A chart built on it (card ${id}) is not read on this page, so it cannot follow.`); continue; }
    const got = await previewDashboardQuery(connectionId, { sql: def.sql, shown, title: card.title, ...sent });
    if (got.refused.length) refused.push(`${card.title}: ${got.refused.join(" ")}`);
  }
  if (refused.length) return { refused };
  const swaps: [string, string][] = [];
  for (const { id, card, shown } of held) {
    const { card: kept } = await keepDashboardQuery(connectionId, { sql: def.sql, shown: shown!, title: card!.title, replaces: id, ...sent });
    swaps.push([id, kept.id]);
  }
  return { spec: withFollowed(spec, name, def, swaps), charts: held.length, swaps };
}

/** The spec holding a dataset's new statement and, in place of each chart built on it, the card kept anew. */
export function withFollowed(spec: DashboardSpec, name: string, def: DashboardDataset, swaps: [string, string][]): DashboardSpec {
  return swaps.reduce((s, [from, to]) => swapCard(s, from, to), putDataset(spec, name, def));
}

/** A dataset's name and statement, changed (the Data view): Run shows what the statement as typed returns; Keep runs it
 *  once to check it reads, then keeps it on the dataset — and, through `onFollow`, on every chart built on it. */
function DatasetEditor({ spec, name, connectionId, onChange, onFollow, onClose }: {
  spec: DashboardSpec; name: string; connectionId: string; onChange: (next: DashboardSpec, note: string) => void;
  onFollow?: (name: string, def: DashboardDataset) => Promise<string[]>; onClose: () => void;
}) {
  const was = spec.datasets?.[name];
  const [label, setLabel] = useState(was?.label ?? "");
  const [sql, setSql] = useState(was?.sql ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string[]>([]);
  // Run, in the Data view: what the statement as typed returns
  const [runAsked, setRunAsked] = useState(0);
  // the dashboard's values it reads, `{{name}}` — its parameters — and what each is tried with here (2026-11-20)
  const [adding, setAdding] = useState(false);
  const [tried, setTried] = useState<Record<string, string>>({});
  // Edit ✦ (2026-11-20, of a peer product's dataset editor): the statement rewritten as asked, in place, the one before kept
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<{ before: string; notes: string[] } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // where the person last was in the statement; never there yet, what is put in goes at its end (seen live: at its start)
  const placed = useRef(false);
  const reads = valuesRead(sql);
  const given = triedValues(reads, spec.values, tried);
  const charts = cardsBuiltOn(spec, name).length;
  if (!was) return null;
  const sqlChanged = sql.trim() !== was.sql.trim();
  /** `text` put in the statement where the person was writing, and the writing goes on after it. */
  const insert = (text: string) => {
    const el = box.current;
    const at = el && placed.current ? el.selectionStart : sql.length;
    const to = el && placed.current ? el.selectionEnd : at;
    const gap = at === sql.length && sql && !/\s$/.test(sql) ? " " : "";
    setSql(sql.slice(0, at) + gap + text + sql.slice(to));
    placed.current = true;
    const end = at + gap.length + text.length;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(end, end); });
  };
  const keep = async () => {
    const def: DashboardDataset = { label: label.trim().slice(0, 120), sql: sqlChanged ? sql.trim() : was.sql, ...(sqlChanged ? {} : { table: was.table ?? null }) };
    if (!def.table) delete def.table;
    if (!sqlChanged) { onChange(putDataset(spec, name, def), "a dataset renamed by hand"); onClose(); return; }
    if ("refused" in given) { setProblem(given.refused); return; }
    setBusy(true); setProblem([]);
    try {
      const got = await previewDashboardQuery(connectionId, { sql: def.sql, shown: { ...QUERY_DEFAULT, as: "table" }, title: def.label,
        ...(reads.length ? { values: given.values } : {}) });
      if (got.refused.length) { setProblem(got.refused); return; }
      if (!charts) { onChange(putDataset(spec, name, def), "a dataset's statement changed by hand"); onClose(); return; }
      if (!onFollow) { setProblem(["The charts built on it cannot follow a change made here."]); return; }
      const said = await onFollow(name, def);
      if (said.length) setProblem(said); else onClose();
    } catch (e) {
      setProblem([e instanceof QueryRefused ? e.reasons.join(" ") : (e as Error).message]);
    } finally { setBusy(false); }
  };
  return (
    <div data-testid="data-dataset-editor" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <Input aria-label="The dataset's name" value={label} maxLength={120} disabled={busy} onChange={e => setLabel(e.target.value)} style={{ maxWidth: 420 }} />
      <Textarea ref={box} aria-label="The dataset's SQL" data-testid="data-dataset-sql" rows={12} spellCheck={false} value={sql} disabled={busy}
        onChange={e => setSql(e.target.value)} onSelect={() => { placed.current = true; }}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); setRunAsked(n => n + 1); } }}
        style={{ fontFamily: "var(--font-mono)" }} />
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="xs" variant="outline" data-testid="data-dataset-add-parameter" aria-expanded={adding} onClick={() => setAdding(a => !a)}
          title="One of the dashboard's values, read as a bound parameter: the engine binds it, never pasted into the statement.">
          <Icon name="plus" size={13} /> Add parameter
        </Button>
        <Button size="xs" variant="outline" data-testid="data-dataset-edit" aria-expanded={editing} disabled={busy} onClick={() => setEditing(e => !e)}
          title="Ask in words for a change to this SQL: it is rewritten here, and nothing is run or kept until you do">
          <BrandSpark size={13} /> Edit
        </Button>
      </span>
      {editing && (
        <SqlAsk connectionId={connectionId} sql={sql} onClose={() => setEditing(false)}
          onSql={(next, notes) => { setEdited({ before: sql, notes }); setSql(next); setEditing(false); }} />
      )}
      {edited && (
        <div data-testid="data-dataset-edited" className="aug-fs-xs" style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--t2)", maxWidth: 640 }}>
          <span style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
            Rewritten as asked. Nothing is run or kept until you do.{edited.notes.length ? ` ${edited.notes.join(" ")}` : ""}
          </span>
          <Button size="xs" variant="ghost" data-testid="data-dataset-edit-undo" onClick={() => { setSql(edited.before); setEdited(null); }}>Undo the edit</Button>
        </div>
      )}
      {adding && (
        <ParameterPicker spec={spec} onChange={onChange} onPick={n => { insert(`{{${n}}}`); setAdding(false); }} />
      )}
      {reads.length > 0 && (
        <div data-testid="data-dataset-tried" style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 520 }}>
          <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Run with these; on the page its charts read what the page holds.</span>
          {reads.map(n => {
            const v = spec.values?.[n];
            return (
              <label key={n} className="aug-fs-xs" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px", alignItems: "center", gap: 6, color: "var(--t2)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{`{{${n}}}`}</span>{v ? ` ${v.label}` : " — not a value of this dashboard"}
                </span>
                {v && (
                  <Input aria-label={`Run with ${v.label} as`} value={tried[n] ?? startText(v)} type={v.kind === "date" ? "date" : v.kind === "days" || v.kind === "number" ? "number" : "text"}
                    onChange={e => setTried(t => ({ ...t, [n]: e.target.value }))} />
                )}
              </label>
            );
          })}
        </div>
      )}
      <span className="aug-fs-xs" style={{ color: "var(--t3)", lineHeight: 1.45 }}>
        {!charts ? "No chart is built on it yet." : `${formatCount(charts)} ${charts === 1 ? "chart is" : "charts are"} built on it. A change to its SQL is kept on each, as it is set up; none changes unless every one can read it.`}
      </span>
      {problem.length > 0 && (
        <ul className="aug-fs-sm" role="alert" data-testid="data-dataset-refused" style={{ margin: 0, paddingLeft: 18, color: "var(--t1)" }}>
          {withUniqueKeys(problem, p => p).map(([k, p]) => <li key={k}>{p}</li>)}
        </ul>
      )}
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="sm" data-testid="data-dataset-keep" disabled={busy || !label.trim() || !sql.trim() || (label.trim() === was.label && !sqlChanged)} onClick={() => void keep()}>
          {busy ? "Checking…" : sqlChanged ? "Check and keep" : "Keep"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Undo my edits</Button>
        <Button size="sm" variant="secondary" data-testid="data-dataset-run" disabled={busy || !sql.trim()} onClick={() => setRunAsked(n => n + 1)}
          title="Run it as typed · ⌘Enter" style={{ marginLeft: "auto" }}><Icon name="run" size={13} /> Run</Button>
      </span>
      <DatasetResult connectionId={connectionId} sql={sql} asked={runAsked} values={"refused" in given ? given.refused : reads.length ? given.values : null} />
    </div>
  );
}

/** A change to a dataset's statement asked in words (2026-11-20, of a peer product's dataset editor, "Edit ✦"): written by
 *  the SQL editor's own question-to-SQL path with the statement as it stands, run nowhere and kept nowhere — it lands in
 *  the editor, for the person to run and keep. */
function SqlAsk({ connectionId, sql, onSql, onClose }: {
  connectionId: string; sql: string; onSql: (next: string, notes: string[]) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [problem, setProblem] = useState("");
  const ask = async () => {
    const asked = text.trim();
    if (!asked || writing) return;
    setWriting(true); setProblem("");
    try {
      const got = await askForSql(connectionId, asked, { sql });
      if (!got.sql?.trim()) { setProblem("No statement came back. Nothing was changed."); return; }
      onSql(got.sql.trim(), got.notes ?? []);
    } catch (e) {
      setProblem((e as Error).message);
    } finally { setWriting(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 640 }}>
      <div data-testid="data-dataset-ask" role="group" aria-label="Ask to change this SQL"
        style={{ ...brandEdge("var(--bg-2)"), borderRadius: 10, display: "flex", alignItems: "center", gap: 2, padding: "3px 4px 3px 10px" }}>
        <input autoFocus aria-label="Ask to change this SQL" placeholder="Ask to change this SQL… (only orders since 2018, add the customer's state)" value={text}
          maxLength={500} disabled={writing} className="aug-fs-sm" data-testid="data-dataset-ask-input" onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); }
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
          style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--t1)", fontFamily: "inherit", padding: "4px 0" }} />
        <Button size="icon-xs" variant="ghost" aria-label="Close" title="Close" onClick={onClose} disabled={writing}><Icon name="close" size={14} /></Button>
        <Button size="icon-xs" variant="ghost" aria-label="Write it" title="Write it" data-testid="data-dataset-ask-send" disabled={!text.trim() || writing} onClick={() => void ask()}>
          <Icon name="send" size={14} />
        </Button>
      </div>
      {writing && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Writing the statement…</span>}
      {problem && <span className="aug-fs-sm" role="alert" style={{ color: "var(--t1)" }}>{problem}</span>}
    </div>
  );
}

/** The parameters a dataset may read (2026-11-20, of a peer product's "+ Add parameter"): the dashboard's values, each put
 *  in the statement as `{{name}}` — or a new one, named, of a kind, with what it starts as, kept on the dashboard as a
 *  value its readers may then be offered. */
function ParameterPicker({ spec, onChange, onPick }: {
  spec: DashboardSpec; onChange: (next: DashboardSpec, note: string) => void; onPick: (name: string) => void;
}) {
  const held = Object.entries(spec.values ?? {});
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"days" | "number" | "text" | "date">("number");
  const [start, setStart] = useState("");
  const value = typedValue(kind, start);
  const room = held.length < MAX_VALUES;
  const make = () => {
    if (!label.trim() || value === null) return;
    const name = freshWireName(spec, label.trim());
    onChange(putValue(spec, name, { label: label.trim().slice(0, MAX_LABEL), kind, value } as DashboardValueDef), "a parameter added to a dataset by hand");
    onPick(name);
  };
  return (
    <div data-testid="data-parameter-picker" style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--b1)", borderRadius: "var(--r3)", padding: 10, maxWidth: 520 }}>
      {held.length > 0 && (
        <div role="list" aria-label="The dashboard's values" style={{ display: "flex", flexDirection: "column" }}>
          {held.map(([n, v]) => (
            <Button key={n} role="listitem" size="xs" variant="ghost" data-testid="data-parameter" onClick={() => onPick(n)} style={{ justifyContent: "flex-start", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{`{{${n}}}`}</span>
              <span style={{ color: "var(--t3)" }}>{v.label} · {VALUE_KIND_WORDS[v.kind] ?? v.kind}</span>
            </Button>
          ))}
        </div>
      )}
      {room ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px 120px auto", gap: 6, alignItems: "center" }}>
          <Input aria-label="The parameter's name" placeholder="New parameter: its name" value={label} maxLength={MAX_LABEL} onChange={e => setLabel(e.target.value)} />
          <SelectField aria-label="What it holds" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setStart(""); }}>
            <option value="number">A number</option><option value="days">Days</option><option value="text">Words</option><option value="date">A day</option>
          </SelectField>
          <Input aria-label="What it starts as" placeholder="Starts as" value={start} type={kind === "date" ? "date" : kind === "text" ? "text" : "number"}
            onChange={e => setStart(e.target.value)} />
          <Button size="sm" data-testid="data-parameter-make" disabled={!label.trim() || value === null} onClick={make}>Add</Button>
        </div>
      ) : (
        <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>The dashboard holds {MAX_VALUES} values, the most it may.</span>
      )}
    </div>
  );
}

/** What a dataset's statement returns, run as typed (the Data view): its first rows, or its columns and their kinds. */
function DatasetResult({ connectionId, sql, asked, values = null }: {
  connectionId: string; sql: string; asked: number;
  /** What its parameters are run with — or why they cannot be, said before anything runs. */
  values?: ValuesSent | string[] | null;
}) {
  const [got, setGot] = useState<QueryPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState("");
  const [view, setView] = useState<"rows" | "schema">("rows");
  useEffect(() => {
    if (!asked) return;
    let alive = true;
    if (Array.isArray(values)) { setGot(null); setProblem(values.join(" ")); return; }
    setRunning(true); setProblem("");
    previewDashboardQuery(connectionId, { sql, shown: { ...QUERY_DEFAULT, as: "table" }, ...(values ? { values } : {}) })
      .then(p => { if (alive) { setGot(p); if (p.refused.length) setProblem(p.refused.join(" ")); } })
      .catch(e => { if (alive) setProblem((e as Error).message); })
      .finally(() => { if (alive) setRunning(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when Run is pressed, with the statement as it stands then
  }, [asked, connectionId]);
  if (!asked) {
    return <div className="aug-fs-sm" data-testid="data-dataset-result" style={{ color: "var(--t3)", padding: "8px 0" }}>Run it to see what it returns.</div>;
  }
  const columns = got?.columns ?? [];
  const rows = got?.rows ?? [];
  return (
    <div data-testid="data-dataset-result" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Segmented label="What it returns" value={view} onChange={v => setView(v as "rows" | "schema")}
          options={[{ value: "rows", label: "Result table" }, { value: "schema", label: "Schema" }]} />
        <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>
          {running ? "Running…" : got && !got.refused.length
            ? `${formatCount(columns.length)} columns · the first ${formatCount(rows.length)} rows${got.more ? ", and more" : ""}${got.duration_ms != null && got.duration_ms >= 10 ? ` · ${formatSeconds(got.duration_ms / 1000)}` : ""}` : ""}
        </span>
      </div>
      {problem && <div className="aug-fs-sm" role="alert" style={{ color: "var(--t1)" }}>{problem}</div>}
      {got && !got.refused.length && (view === "schema" ? (
        <table className="aug-fs-sm" data-testid="data-dataset-schema" style={{ borderCollapse: "collapse", width: "auto" }}>
          <tbody>
            {withUniqueKeys(columns, c => c.name).map(([k, c]) => (
              <tr key={k}>
                <td style={{ padding: "4px 16px 4px 0", color: "var(--t1)" }}>{c.name}</td>
                <td style={{ padding: "4px 0", color: "var(--t3)" }}>{kindOf(c.type)} · {c.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ overflow: "auto", maxHeight: 360, border: "1px solid var(--b1)", borderRadius: "var(--r2)" }}>
          <table className="aug-fs-sm" data-testid="data-dataset-rows" style={{ borderCollapse: "collapse", minWidth: "100%" }}>
            <thead>
              <tr>{withUniqueKeys(columns, c => c.name).map(([k, c]) => <th key={k} style={{ position: "sticky", top: 0, background: "var(--bg-2)", textAlign: "left", padding: "6px 10px", color: "var(--t2)", fontWeight: 500, whiteSpace: "nowrap" }}>{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // eslint-disable-next-line react/no-array-index-key -- a preview's rows have no identity of their own
                <tr key={i} style={{ borderTop: "1px solid var(--b1)" }}>
                  {r.map((v, j) => <td key={columns[j]?.name ?? j} style={{ padding: "5px 10px", color: "var(--t1)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{v == null ? "" : String(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const CAPTION = { color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".06em" } as const;

/** The ways a chart built on a dataset may first be drawn; the chart editor changes it after, to any kind it offers. */
export const CHART_KINDS: { value: QueryShownAs; label: string }[] = [
  { value: "bar", label: "Bar" }, { value: "line", label: "Line" }, { value: "area", label: "Area" },
  { value: "scatter", label: "Scatter" }, { value: "table", label: "Table" }, { value: "figure", label: "Figure" },
];

/** A chart box set up on a dataset (the user, 2026-11-19): which data it is built on and how it is first drawn. "Place
 *  it here" keeps the chart, drawn from the data's own columns, and the page puts it in the box and opens its editor:
 *  the X axis, the Y axis, the colour and the rest, each a field of the data. */
export function ChartFromData({ spec, connectionId, busy = false, onChange, onMade, onCancel }: {
  spec: DashboardSpec; connectionId: string; busy?: boolean;
  onChange: (next: DashboardSpec, note: string) => void;
  /** The chart's card, kept: the page places it in the box, built on the dataset `dataset`. */
  onMade: (cardId: string, title: string, dataset: string) => void;
  onCancel: () => void;
}) {
  const held = Object.entries(spec.datasets ?? {});
  const [name, setName] = useState(held[0]?.[0] ?? "");
  const [as, setAs] = useState<QueryShownAs>("bar");
  const [adding, setAdding] = useState<"" | "table" | "sql">("");
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string[]>([]);
  const chosenName = spec.datasets?.[name] ? name : held[0]?.[0] ?? "";
  const chosen = chosenName ? spec.datasets?.[chosenName] : undefined;
  const make = async () => {
    if (!chosen) return;
    const sent = paramsOf(spec, chosen.sql);
    if ("refused" in sent) { setProblem(sent.refused); return; }
    setMaking(true); setProblem([]);
    try {
      const first = await previewDashboardQuery(connectionId, { sql: chosen.sql, shown: { ...QUERY_DEFAULT, as: "table" }, title: chosen.label, ...sent });
      if (first.refused.length) { setProblem(first.refused); return; }
      // what runs along the bottom and what is measured are read from the columns; the colour is the person's to add, never
      // a guess (on a table of rows the first words are often an id: a colour per order)
      const shown = { ...setupAs({ ...QUERY_DEFAULT, as: "table" }, as, first.columns ?? []), split: "" };
      const { card } = await keepDashboardQuery(connectionId, { sql: chosen.sql, shown, title: chosen.label, ...sent });
      onMade(card.id, chosen.label, chosenName);
    } catch (e) {
      setProblem(e instanceof QueryRefused ? e.reasons : [(e as Error).message]);
    } finally { setMaking(false); }
  };
  const adder = adding && (
    <AddData spec={spec} connectionId={connectionId} way={adding} onClose={() => setAdding("")}
      onAdd={(next, names, note) => { onChange(next, note); if (names[0]) setName(names[0]); setAdding(""); }} />
  );
  return (
    <div data-testid="chart-from-data" role="region" aria-label="The chart's data" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px" }}>
      {!held.length ? (
        <>
          <div data-testid="chart-from-data-empty" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 600 }}>Add data to get going</span>
            <span className="aug-fs-sm" style={{ color: "var(--t2)", lineHeight: 1.45 }}>
              Choose a table, or write your own SQL. The dashboard holds it as a dataset, and this chart and the next are built on it.
            </span>
          </div>
          {adder || (
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" variant="secondary" data-testid="chart-add-table" onClick={() => setAdding("table")}><Icon name="table" size={14} /> Choose a table</Button>
              <Button size="sm" variant="secondary" data-testid="chart-add-sql" onClick={() => setAdding("sql")}><Icon name="sql" size={14} /> Write SQL</Button>
            </span>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="aug-fs-xs" style={CAPTION}>Dataset</span>
            <SelectField aria-label="Dataset" data-testid="chart-dataset" value={chosenName} disabled={making} onChange={e => setName(e.target.value)}>
              {held.map(([n, d]) => <option key={n} value={n}>{d.label}</option>)}
            </SelectField>
          </div>
          {adder || (
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: -4 }}>
              <Button size="xs" variant="ghost" data-testid="chart-add-table" disabled={making} onClick={() => setAdding("table")}><Icon name="plus" /> Add data</Button>
              <Button size="xs" variant="ghost" data-testid="chart-add-sql" disabled={making} onClick={() => setAdding("sql")}><Icon name="plus" /> Add SQL dataset</Button>
            </span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="aug-fs-xs" style={CAPTION}>Visualization</span>
            <SelectField aria-label="Visualization" data-testid="chart-kind" value={as} disabled={making} onChange={e => setAs(e.target.value as QueryShownAs)}>
              {CHART_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </SelectField>
          </div>
          <span className="aug-fs-sm" style={{ color: "var(--t2)", lineHeight: 1.45 }}>
            Drawn first from the columns of {chosen?.label ?? "the data"}. Its X axis, Y axis and colour are then set in the panel, each a field of the data.
          </span>
          {problem.length > 0 && (
            <ul className="aug-fs-sm" role="alert" data-testid="chart-from-data-refused" style={{ margin: 0, paddingLeft: 18, color: "var(--t1)" }}>
              {withUniqueKeys(problem, p => p).map(([k, p]) => <li key={k}>{p}</li>)}
            </ul>
          )}
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="sm" data-testid="chart-from-data-place" disabled={!chosen || making || busy} onClick={() => void make()}>
              <Icon name="check" size={14} /> {making ? "Placing…" : "Place it here"}
            </Button>
            <Button size="sm" variant="ghost" disabled={making} onClick={onCancel}>Cancel</Button>
          </span>
        </>
      )}
    </div>
  );
}

/** A chart built on one of the dashboard's datasets, where its query would be set up: the dataset it reads, said, and the
 *  way to a query of its own — after which a change to the dataset no longer reaches it. */
export function BuiltOnDataset({ label, table, onOwnSql }: { label: string; table: string | null; onOwnSql: () => void }) {
  return (
    <div data-testid="chart-built-on" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px" }}>
      <span className="aug-fs-xs" style={CAPTION}>Built on</span>
      <span className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
        <Icon name={table ? "table" : "sql"} size={14} /> {label}
        {table && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>{table}</span>}
      </span>
      <span className="aug-fs-xs" style={{ color: "var(--t3)", lineHeight: 1.45 }}>
        Its SQL is the dataset&rsquo;s. Change it in the Data tab, and every chart built on it follows.
      </span>
      <span>
        <Button size="xs" variant="ghost" data-testid="chart-own-sql" onClick={onOwnSql}>Write its own SQL instead</Button>
      </span>
    </div>
  );
}

/** The builder's door to a dataset in its Data pane, for a chart's setup to open the one it is built on. */
export const OpenDatasetContext = createContext<((name: string) => void) | null>(null);

/** A chart moved onto another of the dashboard's datasets: kept again on its statement as a new card that replaces its
 *  own. Its fields are kept where the dataset has them; where it does not, they are set again from its columns, and
 *  `reset` says so. */
export async function moveToDataset(connectionId: string, spec: DashboardSpec, card: CardHeld, to: string)
  : Promise<{ refused: string[] } | { cardId: string; reset: boolean }> {
  const def = spec.datasets?.[to];
  const shown = (card.render as { shown?: QueryShown } | undefined)?.shown;
  if (!def || !shown) return { refused: ["This chart cannot be moved: its dataset or its setup is not read here."] };
  const sent = paramsOf(spec, def.sql);
  if ("refused" in sent) return sent;
  let use: QueryShown = shown;
  let reset = false;
  const tried = await previewDashboardQuery(connectionId, { sql: def.sql, shown, title: card.title, ...sent });
  if (tried.refused.length) {
    const plain = tried.columns?.length ? tried : await previewDashboardQuery(connectionId, { sql: def.sql, shown: { ...QUERY_DEFAULT, as: "table" }, title: card.title, ...sent });
    if (!plain.columns?.length) return { refused: plain.refused.length ? plain.refused : tried.refused };
    use = { ...setupAs({ ...QUERY_DEFAULT, as: "table" }, shown.as, plain.columns), split: "" };
    reset = true;
  }
  const { card: kept } = await keepDashboardQuery(connectionId, { sql: def.sql, shown: use, title: card.title, replaces: card.id, ...sent });
  return { cardId: kept.id, reset };
}

/** What a chart is built on, under its Visualization (the user, 2026-11-19, of a peer product's editor): the dataset by
 *  name — which opens it in the Data pane — and a pencil to build it on another. A chart of its own SQL says so, and may
 *  be moved onto one of the dashboard's datasets the same way. */
export function DatasetLine({ spec, cardId, onMove }: {
  spec: DashboardSpec; cardId: string;
  /** Build the chart on the dataset `to`: each reason it cannot, or none. */
  onMove: (to: string) => Promise<string[]>;
}) {
  const on = datasetOfCard(spec, cardId);
  const d = on ? spec.datasets?.[on] : undefined;
  const held = Object.entries(spec.datasets ?? {});
  const open = useContext(OpenDatasetContext);
  const [choosing, setChoosing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string[]>([]);
  if (!d && !held.length) return null;
  const move = async (to: string) => {
    if (!to || to === on) { setChoosing(false); return; }
    setMoving(true); setProblem([]);
    try {
      const said = await onMove(to);
      if (said.length) setProblem(said); else setChoosing(false);
    } catch (e) {
      setProblem([e instanceof QueryRefused ? e.reasons.join(" ") : (e as Error).message]);
    } finally { setMoving(false); }
  };
  return (
    <div data-testid="chart-dataset-line" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ color: "var(--t3)", display: "inline-flex" }}><Icon name={d ? (d.table ? "table" : "sql") : "sql"} size={15} /></span>
        {d && on ? (
          <Button size="xs" variant="ghost" data-testid="chart-dataset-open" title="Open it in the Data tab" onClick={() => open?.(on)}
            style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label}
          </Button>
        ) : (
          <span className="aug-fs-sm" style={{ flex: 1, color: "var(--t3)" }}>Its own SQL</span>
        )}
        {held.length > 0 && (
          <Button size="icon-sm" variant="ghost" aria-label="Change dataset" title="Change dataset" data-testid="chart-dataset-change"
            aria-pressed={choosing} disabled={moving} onClick={() => setChoosing(c => !c)}><Icon name="edit" size={14} /></Button>
        )}
      </div>
      {choosing && (
        <SelectField aria-label="Build it on" data-testid="chart-dataset-choose" value={on ?? ""} disabled={moving} onChange={e => void move(e.target.value)}>
          {!on && <option value="">Its own SQL</option>}
          {held.map(([n, x]) => <option key={n} value={n}>{x.label}</option>)}
        </SelectField>
      )}
      {moving && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Building it on the other dataset…</span>}
      {problem.length > 0 && (
        <ul className="aug-fs-sm" role="alert" data-testid="chart-dataset-refused" style={{ margin: 0, paddingLeft: 18, color: "var(--t1)" }}>
          {withUniqueKeys(problem, p => p).map(([k, p]) => <li key={k}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The dashboard's Data tab (the user, 2026-11-19, of a peer product's editor: "Data | Summary | +"): the data that backs
 *  the dashboard on a view of its own. At the left, its datasets and the doors to more; at the right, the one chosen — its
 *  name and statement, Run and what it returns, and Keep, which carries a new statement to every chart built on it. Above,
 *  Data and the pages: a page goes back to the canvas on it. */
export function DataView({ spec, connectionId, onChange, onFollow, opened = null, pages, onPage }: {
  spec: DashboardSpec; connectionId: string; onChange: (next: DashboardSpec, note: string) => void;
  onFollow?: (name: string, def: DashboardDataset) => Promise<string[]>;
  /** A dataset opened from a chart built on it: chosen at once. */
  opened?: { name: string; n: number } | null;
  /** The dashboard's pages, in order; none on a dashboard of one page. */
  pages: { name: string; label: string; hidden: boolean }[];
  /** Back to the canvas, on the page `name` — or as it was, with none. */
  onPage: (name: string | null) => void;
}) {
  const held = Object.entries(spec.datasets ?? {});
  const [chosen, setChosen] = useState<string | null>(opened?.name ?? held[0]?.[0] ?? null);
  const [seen, setSeen] = useState(opened?.n ?? 0);
  if (opened && opened.n !== seen) { setSeen(opened.n); setChosen(opened.name); }
  const [adding, setAdding] = useState<"" | "table" | "sql">("");
  const [fresh, setFresh] = useState(0);
  const name = chosen && spec.datasets?.[chosen] ? chosen : held[0]?.[0] ?? null;
  const def = name ? spec.datasets?.[name] : undefined;
  const title = String((spec.elements[spec.root]?.props as { title?: string } | undefined)?.title ?? "The dashboard");
  const add = (way: "table" | "sql") => setAdding(way);
  return (
    <div data-testid="data-view" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div role="tablist" aria-label="Data and pages" style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderBottom: "1px solid var(--b1)" }}>
        <Button size="xs" variant="ghost" role="tab" aria-selected data-testid="data-view-tab" style={{ boxShadow: "inset 0 -2px 0 var(--accent)", borderRadius: 0 }}>
          <Icon name="table" size={13} /> Data
        </Button>
        <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", margin: "4px 4px", background: "var(--b1)" }} />
        {(pages.length ? pages : [{ name: "", label: title, hidden: false }]).map(p => (
          <Button key={p.name || "page"} size="xs" variant="ghost" role="tab" aria-selected={false} data-testid="data-view-page" onClick={() => onPage(p.name || null)}>
            {p.hidden && <Icon name="eyeoff" size={12} />}{p.label}
          </Button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)" }}>
        <aside aria-label="Datasets" style={{ minHeight: 0, overflow: "auto", borderRight: "1px solid var(--b1)", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="aug-fs-xs" style={{ display: "flex", alignItems: "baseline", ...CAPTION, padding: "2px 6px 6px" }}>
            Datasets<span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}>{held.length} of {MAX_DATASETS}</span>
          </div>
          {held.map(([n, d]) => {
            const charts = cardsBuiltOn(spec, n).length;
            const on = !adding && n === name;
            return (
              <div key={n} data-testid="data-dataset" data-name={n} style={{ display: "flex", alignItems: "center", gap: 2, borderRadius: "var(--r2)", background: on ? "var(--bg-sel)" : undefined }}>
                <Button size="sm" variant="ghost" aria-pressed={on} onClick={() => { setAdding(""); setChosen(n); }}
                  style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", height: "auto", padding: "6px 8px", gap: 8 }}>
                  <Icon name={d.table ? "table" : "sql"} size={14} />
                  <span style={{ minWidth: 0, textAlign: "left" }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t1)" }}>{d.label}</span>
                    <span className="aug-fs-xs" style={{ display: "block", color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.table ?? "Your own SQL"}{charts ? ` · ${formatCount(charts)} ${charts === 1 ? "chart" : "charts"}` : ""}
                    </span>
                  </span>
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Take ${d.label} off`} data-testid="data-dataset-drop"
                  onClick={() => onChange(dropDataset(spec, n), "a dataset taken off by hand")}><Icon name="close" size={13} /></Button>
              </div>
            );
          })}
          {held.length < MAX_DATASETS && (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, marginTop: 8, padding: "0 4px" }}>
              <Button size="xs" variant="outline" data-testid="data-add-table" aria-pressed={adding === "table"} onClick={() => add("table")}><Icon name="plus" /> Add data</Button>
              <Button size="xs" variant="outline" data-testid="data-add-sql" aria-pressed={adding === "sql"} onClick={() => add("sql")}><Icon name="plus" /> Add SQL dataset</Button>
            </span>
          )}
        </aside>
        <section aria-label={adding ? "Add data" : def?.label ?? "Add data"} style={{ minHeight: 0, minWidth: 0, overflow: "auto", padding: "14px 18px" }}>
          {adding ? (
            <div style={{ maxWidth: 640 }}>
              <AddData spec={spec} connectionId={connectionId} way={adding} onClose={() => setAdding("")}
                onAdd={(next, names, note) => { onChange(next, note); setAdding(""); if (names[0]) setChosen(names[0]); }} />
            </div>
          ) : name && def ? (
            <DatasetEditor key={`${name}:${def.label}:${def.sql}:${fresh}`} spec={spec} name={name} connectionId={connectionId}
              onChange={onChange} onFollow={onFollow} onClose={() => setFresh(f => f + 1)} />
          ) : (
            <div data-testid="data-view-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8, padding: "48px 16px" }}>
              <Icon name="table" size={28} />
              <span className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 600 }}>Add data to get going</span>
              <span className="aug-fs-sm" style={{ color: "var(--t2)", maxWidth: 420 }}>
                Create a dataset for your dashboard by choosing a table, or by writing your own SQL. Its charts are built on it.
              </span>
              <span style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <Button size="sm" variant="secondary" onClick={() => add("table")}><Icon name="table" size={14} /> Choose a table</Button>
                <Button size="sm" variant="secondary" onClick={() => add("sql")}><Icon name="sql" size={14} /> Write SQL</Button>
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
