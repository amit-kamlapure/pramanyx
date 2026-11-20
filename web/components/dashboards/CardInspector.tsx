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
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { CardState } from "@/components/brief/PinnedCardBody";
import { VizEditorPanel } from "@/components/charts/VizEditorPanel";
import { queryEditorModel, type KeptValueColors, type QueryDraft } from "@/components/charts/queryEditorModel";
import { isEmptyVizConfig, type VizConfig } from "@/components/charts/vizConfig";
import { closeVizEditor, openVizEditor, setVizDock } from "@/components/charts/vizEditorStore";
import { QUERY_DEFAULT } from "@/components/dashboards/QuerySetup";
import { SqlView } from "@/components/query/SqlView";
import { updateCard, type QueryShown, type TypedColumn } from "@/lib/api";

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

const WAIT_MS = 450;

/** Chart settings without what is unset, so an untouched one keeps nothing. */
function cleanViz(v: VizConfig): VizConfig {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== "" && x !== null)) as VizConfig;
}

/** The dashboard's colours for a field's values (v17) — the one editor's own type (`queryEditorModel.ts`). */
export type { KeptValueColors };

/**
 * A card of a person's own query, set up in the one chart editor (the user, 2026-11-19: a dashboard's chart is edited
 * "almost entirely" as a chart is edited anywhere — "the dropdown for viz type, formatting of fields, etc." — with its
 * fields each a pill with + and −). One kind is in force, kept one way: the query's own (a table, a
 * figure, a bar, a line, an area, a scatter) with its setup, any other an answer's chart draws as the card's chart
 * settings — choosing one of the query's own clears it. What it reads along each axis, what colours it and what it
 * labels are its setup, read again by the server; how it is dressed (format, titles, range, tooltip, lines) is its chart
 * settings. Each change is kept on the card as it is made.
 */
export function QueryChartEditor({ cs, onKept, colors = null, dataset }: {
  cs: CardState; onKept: () => void; colors?: KeptValueColors | null;
  /** The dataset it is built on, and the way to another, said under its Visualization (2026-11-19). */
  dataset?: ReactNode;
}) {
  const render = (cs.card.render ?? {}) as { shown?: QueryShown; viz?: VizConfig; columns?: TypedColumn[] };
  const kept = JSON.stringify({ shown: render.shown ?? null, viz: render.viz ?? {} });
  const fromCard = (): QueryDraft => ({ shown: { ...QUERY_DEFAULT, ...render.shown }, viz: render.viz ?? {} });
  const [draft, setDraft] = useState<QueryDraft>(fromCard);
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

  const commit = (next: QueryDraft) => {
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
  // the one editor's model, built as an answer's chart builds it (`queryEditorModel.ts`): here every control is honoured,
  // the card read again by the server
  const model = queryEditorModel({
    title: cs.card.title, draft, columns: render.columns ?? [], shaped: cs.run?.shown ?? null, commit,
    texts, setText: (which, text) => setTexts(x => ({ ...x, [which]: text })), colors, dataset,
  });
  return (
    <div data-testid="query-chart-editor">
      <VizEditorPanel model={model} docked onClose={() => {}} />
      {problem && <div className="aug-fs-sm" role="alert" style={{ ...NOTE, color: "var(--amb4)" }}>{problem}</div>}
    </div>
  );
}
