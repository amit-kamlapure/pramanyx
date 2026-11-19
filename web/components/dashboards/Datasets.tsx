"use client";

/**
 * The data a dashboard is built on (the user, 2026-11-19: the tables chosen "should be the base on which components get
 * created", and a peer product's Data section, where the data that backs a dashboard is added). A dataset is a table of
 * the connection or a statement of the person's own. A chart set down on the canvas is built on one, and set up there:
 * what runs along the bottom, what is measured, what colours it. A dataset is never itself a piece of the page, and adding
 * one asks no model.
 */
import { useEffect, useMemo, useState } from "react";

import { QUERY_DEFAULT, setupAs } from "@/components/dashboards/QuerySetup";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QueryRefused, getCatalogTree, keepDashboardQuery, previewDashboardQuery, type QueryShownAs } from "@/lib/api";
import { MAX_DATASETS, dropDataset, freshDatasetName, putDataset, type DashboardDataset, type DashboardSpec } from "@/lib/dashboards/edit";
import { formatCount } from "@/lib/format";
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

/** The dashboard's datasets in its Data pane: each by its name and what it reads, taken off with ×; and the two doors to
 *  more. A chart already built on one keeps reading what it read when the dataset is taken off. */
export function DatasetsList({ spec, connectionId, onChange }: {
  spec: DashboardSpec; connectionId: string; onChange: (next: DashboardSpec, note: string) => void;
}) {
  const held = Object.entries(spec.datasets ?? {});
  const [adding, setAdding] = useState<"" | "table" | "sql">("");
  return (
    <div data-testid="data-datasets" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {!held.length && !adding && (
        <div className="aug-fs-xs" data-testid="data-datasets-empty" style={{ color: "var(--t3)", padding: "0 10px 6px", lineHeight: 1.45 }}>
          Add data to get going: choose a table, or write your own SQL. Charts set down on the canvas are built on it.
        </div>
      )}
      {held.map(([name, d]) => (
        <div key={name} data-testid="data-dataset" data-name={name} className="aug-fs-sm"
          style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: "var(--r2)" }}>
          <Icon name={d.table ? "table" : "sql"} size={14} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t1)" }}>{d.label}</span>
            <span className="aug-fs-xs" title={d.sql} style={{ display: "block", color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.table ?? "Your own SQL"}
            </span>
          </span>
          <Button size="icon-sm" variant="ghost" aria-label={`Take ${d.label} off`} data-testid="data-dataset-drop"
            onClick={() => onChange(dropDataset(spec, name), "a dataset taken off by hand")}><Icon name="close" size={13} /></Button>
        </div>
      ))}
      {adding ? (
        <AddData spec={spec} connectionId={connectionId} way={adding} onClose={() => setAdding("")}
          onAdd={(next, _names, note) => { onChange(next, note); setAdding(""); }} />
      ) : held.length < MAX_DATASETS && (
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Button size="xs" variant="ghost" data-testid="data-add-table" onClick={() => setAdding("table")}><Icon name="plus" /> Add data</Button>
          <Button size="xs" variant="ghost" data-testid="data-add-sql" onClick={() => setAdding("sql")}><Icon name="plus" /> Add SQL dataset</Button>
        </span>
      )}
    </div>
  );
}

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
  /** The chart's card, kept: the page places it in the box. */
  onMade: (cardId: string, title: string) => void;
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
    setMaking(true); setProblem([]);
    try {
      const first = await previewDashboardQuery(connectionId, { sql: chosen.sql, shown: { ...QUERY_DEFAULT, as: "table" }, title: chosen.label });
      if (first.refused.length) { setProblem(first.refused); return; }
      const shown = setupAs({ ...QUERY_DEFAULT, as: "table" }, as, first.columns ?? []);
      const { card } = await keepDashboardQuery(connectionId, { sql: chosen.sql, shown, title: chosen.label });
      onMade(card.id, chosen.label);
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
          <div className="aug-fs-xs" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Dataset
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
          <div className="aug-fs-xs" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Visualization
            <SelectField aria-label="Visualization" data-testid="chart-kind" value={as} disabled={making} onChange={e => setAs(e.target.value as QueryShownAs)}>
              {CHART_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </SelectField>
          </div>
          <span className="aug-fs-sm" style={{ color: "var(--t2)", lineHeight: 1.45 }}>
            Drawn first from {chosen?.label ?? "the data"}&rsquo;s own columns. Its X axis, Y axis and colour are then set in the panel, each a field of the data.
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
