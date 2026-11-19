"use client";

/**
 * A dashboard started from the data itself, with no model asked (the user, 2026-11-18): the tables a person chooses, or a
 * statement of their own. Each is held as a dataset the dashboard's charts are built on (the user, 2026-11-19: "that should
 * be the base on which components get created"), never placed as a table of its rows. The links between tables are the
 * ontology's already, so nobody maps them here.
 */
import { useState } from "react";

import { AddData, TableChoices, addDatasets, tableDataset, tableName, tableSql, useConnectionTables, type TableChoice } from "@/components/dashboards/Datasets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_DATASETS, type DashboardDataset, type DashboardSpec } from "@/lib/dashboards/edit";
import { cardsDashboardSpec, startDashboard } from "@/lib/dashboards/start";
import { formatCount } from "@/lib/format";

/** The most tables one start holds: each a dataset of the dashboard. */
export const MAX_START_TABLES = 12;

export { tableSql, type TableChoice };

/** A new dashboard holding `data` as its datasets, with an empty page to set charts down on. */
export function datasetsDashboardSpec(title: string, data: DashboardDataset[]): DashboardSpec {
  return addDatasets(cardsDashboardSpec(title, []), data.slice(0, MAX_DATASETS)).spec;
}

/** Start the dashboard that holds each table chosen as a dataset; nothing is run, and no card is made. */
export async function startFromTables(connectionId: string, title: string, chosen: TableChoice[], quote: string, sheet = false): Promise<{ id: string }> {
  if (!chosen.length) throw new Error("Choose the tables it reads.");
  const spec = datasetsDashboardSpec(title, chosen.map(t => tableDataset(t, quote, sheet)));
  const id = await startDashboard(connectionId, title, spec, `Started from ${chosen.map(tableName).join(", ")}`.slice(0, 200));
  return { id };
}

export function FromTables({ connectionId, onKept, onBusy }: {
  connectionId: string; onKept: (dashboardId: string) => void; onBusy?: (busy: boolean) => void;
}) {
  const { tables, quote, sheet, problem: unread } = useConnectionTables(connectionId);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState("");
  const flip = (key: string) => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : p.length < MAX_START_TABLES ? [...p, key] : p));
  const start = async () => {
    setStarting(true); onBusy?.(true); setProblem("");
    try {
      const chosen = (tables ?? []).filter(t => picked.includes(tableName(t)));
      const out = await startFromTables(connectionId, name.trim(), chosen, quote, sheet);
      onKept(out.id);
    } catch (e) {
      setProblem((e as Error).message);
    } finally { setStarting(false); onBusy?.(false); }
  };
  return (
    <div data-testid="dashboard-from-tables" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Input aria-label="The dashboard's name" placeholder="Name this dashboard" value={name} disabled={starting} onChange={e => setName(e.target.value)} style={{ maxWidth: 420 }} />
      <TableChoices tables={tables} picked={picked} onFlip={flip} max={MAX_START_TABLES} disabled={starting} />
      {(problem || unread) && <span className="aug-fs-sm" role="alert" data-testid="dashboard-from-tables-problem" style={{ color: "var(--t1)" }}>{problem || unread}</span>}
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="sm" data-testid="dashboard-start-tables" disabled={!name.trim() || !picked.length || starting} onClick={() => void start()}>{starting ? "Starting…" : "Start it"}</Button>
        <span className="aug-fs-sm" style={{ color: "var(--t3)" }}>
          {!picked.length ? "Choose the tables it reads." : !name.trim() ? "Name it."
            : `${formatCount(picked.length)} ${picked.length === 1 ? "table" : "tables"}, each held as a dataset the charts are built on. Then place charts and filters. No model is asked.`}
        </span>
      </span>
    </div>
  );
}

/** A dashboard started on a statement of the person's own, held as its first dataset once it is checked to read. */
export function FromSql({ connectionId, onKept }: { connectionId: string; onKept: (dashboardId: string) => void }) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const blank = cardsDashboardSpec(name.trim() || "My dashboard", []);
  return (
    <div data-testid="dashboard-from-sql" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Input aria-label="The dashboard's name" placeholder="Name this dashboard" value={name} onChange={e => setName(e.target.value)} style={{ maxWidth: 420 }} />
      {problem && <span className="aug-fs-sm" role="alert" style={{ color: "var(--t1)" }}>{problem}</span>}
      <AddData spec={blank} connectionId={connectionId} way="sql" doneWords="Check and start it"
        onAdd={next => {
          const title = name.trim() || Object.values(next.datasets ?? {})[0]?.label || "My dashboard";
          startDashboard(connectionId, title, { ...cardsDashboardSpec(title, []), datasets: next.datasets }, "Started from your own SQL")
            .then(onKept).catch(e => setProblem((e as Error).message));
        }} />
    </div>
  );
}
