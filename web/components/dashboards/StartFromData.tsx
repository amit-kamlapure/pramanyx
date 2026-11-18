"use client";

/**
 * A dashboard started from the data itself, with no model asked (the user, 2026-11-18): the tables a person chooses, each placed as
 * a table of its rows, or a statement of their own. The links between tables are the ontology's already, so nobody maps them here.
 */
import { useEffect, useMemo, useState } from "react";

import { QUERY_DEFAULT, QuerySetup } from "@/components/dashboards/QuerySetup";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { QueryRefused, getCatalogTree, keepDashboardQuery } from "@/lib/api";
import { cardsDashboardSpec, startDashboard } from "@/lib/dashboards/start";
import { formatCount } from "@/lib/format";

/** The most tables one start places: each is a card that reads when the dashboard opens. */
export const MAX_START_TABLES = 12;

export interface TableChoice { schema: string; table: string }

const nameOf = (t: TableChoice) => (t.schema ? `${t.schema}.${t.table}` : t.table);
const words = (name: string) => { const s = name.replace(/[_-]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** A name as a statement writes it: bare where it can be, quoted as the connection quotes where it cannot. */
export function tableSql(t: TableChoice, quote: string): string {
  const part = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `${quote}${s.split(quote).join(quote + quote)}${quote}`);
  return `SELECT * FROM ${[t.schema, t.table].filter(Boolean).map(part).join(".")}`;
}

/** Keep one card of each table and start the dashboard that places them; what could not be read is said by name. */
export async function startFromTables(connectionId: string, title: string, chosen: TableChoice[], quote: string): Promise<{ id: string; left: string[] }> {
  const kept: { card: string; size: string }[] = [];
  const left: string[] = [];
  for (const t of chosen) {
    try {
      const { card } = await keepDashboardQuery(connectionId, { sql: tableSql(t, quote), shown: { ...QUERY_DEFAULT, as: "table" }, title: words(t.table) });
      kept.push({ card: card.id, size: "full" });
    } catch (e) {
      left.push(`${nameOf(t)}: ${e instanceof QueryRefused ? e.reasons.join(" ") : (e as Error).message}`);
    }
  }
  if (!kept.length) throw new Error(left.join(" "));
  const id = await startDashboard(connectionId, title, cardsDashboardSpec(title, kept), `Started from ${chosen.map(nameOf).join(", ")}`.slice(0, 200));
  return { id, left };
}

export function FromTables({ connectionId, onKept, onBusy }: {
  connectionId: string; onKept: (dashboardId: string) => void; onBusy?: (busy: boolean) => void;
}) {
  const [tables, setTables] = useState<TableChoice[] | null>(null);
  const [quote, setQuote] = useState('"');
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let alive = true;
    getCatalogTree().then(tree => {
      if (!alive) return;
      const entry = tree.sections.flatMap(s => s.entries).find(e => e.conn_id === connectionId);
      setQuote(/bigquery|mysql/i.test(String(entry?.conn_type ?? "")) ? "`" : '"');
      setTables((entry?.schemas ?? []).flatMap(s => s.tables.map(t => ({ schema: s.name, table: t.name }))));
    }).catch(e => { if (alive) { setTables([]); setProblem((e as Error).message); } });
    return () => { alive = false; };
  }, [connectionId]);
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (tables ?? []).filter(t => !q || nameOf(t).toLowerCase().includes(q));
  }, [tables, term]);
  const flip = (key: string) => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : p.length < MAX_START_TABLES ? [...p, key] : p));
  const start = async () => {
    setStarting(true); onBusy?.(true); setProblem("");
    try {
      const chosen = (tables ?? []).filter(t => picked.includes(nameOf(t)));
      const out = await startFromTables(connectionId, name.trim(), chosen, quote);
      onKept(out.id);
    } catch (e) {
      setProblem((e as Error).message);
    } finally { setStarting(false); onBusy?.(false); }
  };
  return (
    <div data-testid="dashboard-from-tables" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Input aria-label="The dashboard's name" placeholder="Name this dashboard" value={name} disabled={starting} onChange={e => setName(e.target.value)} style={{ maxWidth: 420 }} />
      <Input type="search" aria-label="Find a table" placeholder="Find a table" leading={<Icon name="search" size={15} />} value={term} onChange={e => setTerm(e.target.value)} />
      <div role="group" aria-label="Tables" data-testid="dashboard-table-list" style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--b1)", borderRadius: "var(--r2)", padding: 4 }}>
        {tables === null ? <div className="aug-fs-sm" style={{ color: "var(--t3)", padding: 8 }}>Reading the tables…</div>
          : shown.length === 0 ? <div className="aug-fs-sm" style={{ color: "var(--t3)", padding: 8 }}>{term.trim() ? `No table matches “${term.trim()}”.` : "This connection has no tables to choose yet."}</div>
            : shown.map(t => {
              const key = nameOf(t);
              const on = picked.includes(key);
              return (
                <label key={key} className="aug-fs-sm" data-testid="dashboard-table-choice" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: "var(--r2)", cursor: "pointer", background: on ? "var(--bg-sel)" : undefined }}>
                  <Checkbox checked={on} aria-label={key} disabled={!on && picked.length >= MAX_START_TABLES} onChange={() => flip(key)} />
                  <Icon name="table" size={14} />
                  <span style={{ color: "var(--t1)" }}>{t.table}</span>
                  {t.schema && <span style={{ color: "var(--t3)" }}>{t.schema}</span>}
                </label>
              );
            })}
      </div>
      {problem && <span className="aug-fs-sm" role="alert" data-testid="dashboard-from-tables-problem" style={{ color: "var(--t1)" }}>{problem}</span>}
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="sm" data-testid="dashboard-start-tables" disabled={!name.trim() || !picked.length || starting} onClick={() => void start()}>{starting ? "Starting…" : "Start it"}</Button>
        <span className="aug-fs-sm" style={{ color: "var(--t3)" }}>
          {!picked.length ? "Choose the tables it reads." : !name.trim() ? "Name it."
            : `${formatCount(picked.length)} ${picked.length === 1 ? "table" : "tables"}, each placed as its rows. Then add charts and filters. No model is asked.`}
        </span>
      </span>
    </div>
  );
}

export function FromSql({ connectionId, onKept }: { connectionId: string; onKept: (dashboardId: string) => void }) {
  const [problem, setProblem] = useState("");
  return (
    <div data-testid="dashboard-from-sql">
      {problem && <span className="aug-fs-sm" role="alert" style={{ color: "var(--t1)" }}>{problem}</span>}
      <QuerySetup connectionId={connectionId} onKept={kept => {
        const title = kept.title || "My dashboard";
        startDashboard(connectionId, title, cardsDashboardSpec(title, [{ card: kept.id, size: "full" }]), "Started from your own SQL")
          .then(onKept).catch(e => setProblem((e as Error).message));
      }} />
    </div>
  );
}
