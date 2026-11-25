"use client";

/**
 * Learned — what the platform picked up from its own work on a connection, on a page (2026-11-25, the Atlas-by-Area
 * plan's A3). Until now only the coworker could read it (`read_learned`). A ledger leads with its list (CLARITY): one
 * line of what there is, an Area to narrow it to — or what sits in none — and words to search it by; then each item in
 * the one standing's order (A2), saying what it is, why it stands where it does, what it read, its Area.
 *
 * Promote drafts a Definition from an item, in the person's own name: the word (guessed, theirs to change), its Area,
 * what it means, and a line saying where it came from — a draft until its owner publishes it, or a suggested edit when
 * someone already defines the word. The form opens under its own row, never over the page.
 */
import { useCallback, useEffect, useState } from "react";

import { Chip, Empty, MUTED, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { countNoun } from "@/lib/format";
import {
  KIND_WORDS, NO_AREA, promoteLearned, readLearned, whereFrom, wordOf, type Learned, type LearnedItem, type Promoted,
} from "@/lib/learned";

function PromoteForm({ connId, item, areas, onDone, onCancel }: {
  connId: string; item: LearnedItem; areas: { id: string; name: string }[];
  onDone: (p: Promoted) => void; onCancel: () => void;
}) {
  const [term, setTerm] = useState(wordOf(item.text));
  const [area, setArea] = useState(item.area);
  const [text, setText] = useState(item.text.replace(/^Restated:\s*/i, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = () => {
    setBusy(true); setError("");
    promoteLearned(connId, item, { term, text, area }).then(onDone)
      .catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <div data-testid="learned-promote" style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, alignItems: "center",
      padding: "10px 12px", margin: "6px 0 2px", borderRadius: "var(--r3)", background: "var(--bg-2)" }}>
      <label className="aug-fs-sm" htmlFor={`promote-term-${item.ref}`} style={MUTED}>The word</label>
      <Input id={`promote-term-${item.ref}`} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={120} />
      <label className="aug-fs-sm" htmlFor={`promote-area-${item.ref}`} style={MUTED}>Its Area</label>
      <SelectField id={`promote-area-${item.ref}`} value={area} onChange={(e) => setArea(e.target.value)}>
        <option value="">Every Area</option>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </SelectField>
      <label className="aug-fs-sm" htmlFor={`promote-text-${item.ref}`} style={{ ...MUTED, alignSelf: "start", paddingTop: 6 }}>What it means</label>
      <Textarea id={`promote-text-${item.ref}`} value={text} rows={4} onChange={(e) => setText(e.target.value)} />
      <span />
      <span className="aug-fs-xs" style={MUTED}>{whereFrom(item)} A draft until its owner publishes it.</span>
      <span />
      <span style={{ ...ROW, gap: 6 }}>
        <Button size="sm" disabled={busy || !term.trim() || !text.trim()} onClick={save}>Save the draft</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        {error && <span role="alert" className="aug-fs-xs" style={{ color: "var(--red4)" }}>{error}</span>}
      </span>
    </div>
  );
}

function Row({ connId, item, areaName, areas }: {
  connId: string; item: LearnedItem; areaName: (id: string) => string; areas: { id: string; name: string }[];
}) {
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState<Promoted | null>(null);
  const meta = [item.tables.length ? `read ${item.tables.join(", ")}` : "names no table",
    item.area ? areaName(item.area) : "in no Area", item.times > 1 ? `booked ${item.times} times` : ""].filter(Boolean);
  return (
    <div data-testid="learned-row" style={{ ...RULE, padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ width: 128, flexShrink: 0, paddingTop: 1 }}><Chip tone="plain">{KIND_WORDS[item.kind] ?? item.kind}</Chip></div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="aug-fs-chrome" style={{ color: "var(--t1)", wordBreak: "break-word" }}>{item.text}</span>
          <span className="aug-fs-sm" data-testid="learned-why" style={MUTED}>{item.why}</span>
          <span className="aug-fs-xs" style={MUTED}>{meta.join(" · ")}</span>
          {promoted && (
            <span className="aug-fs-xs" data-testid="learned-promoted" style={{ color: "var(--t2)" }}>
              {promoted.suggested ? `“${promoted.term}” is already defined — filed as a suggested edit for its owner. `
                : `Drafted as “${promoted.term}”. `}
              <a href={promoted.href}>Open it</a>
            </span>
          )}
        </div>
        {item.kind !== "trusted_query" && !promoted && (
          <Button size="sm" variant="secondary" style={{ flexShrink: 0 }} aria-expanded={promoting}
            onClick={() => setPromoting((p) => !p)}>Promote</Button>
        )}
      </div>
      {promoting && (
        <div style={{ paddingLeft: 140 }}>
          <PromoteForm connId={connId} item={item} areas={areas}
            onDone={(p) => { setPromoted(p); setPromoting(false); }} onCancel={() => setPromoting(false)} />
        </div>
      )}
    </div>
  );
}

export function LearnedPanel({ connId }: { connId: string }) {
  const [area, setArea] = useState("");
  const [typed, setTyped] = useState("");
  const [about, setAbout] = useState("");
  const [learned, setLearned] = useState<Learned | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setAbout(typed), 250);
    return () => window.clearTimeout(t);
  }, [typed]);
  const load = useCallback(() => {
    setFailed("");
    readLearned(connId, { area, about }).then(setLearned).catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [connId, area, about]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <ReadFailed what="what was learned" error={failed} onRetry={load} />;
  if (!learned) return <Loading what="what was learned" />;

  const names = new Map(learned.areas.map((a) => [a.id, a.name]));
  const areaName = (id: string) => names.get(id) ?? id;
  const placed = learned.total - learned.unplaced;
  return (
    <div data-testid="learned-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...ROW, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="aug-fs-sm" data-testid="learned-summary" style={{ color: "var(--t2)" }}>
          {learned.total === 0 ? "Nothing learned yet" : `${countNoun(learned.total, "thing learned", "things learned")}`}
          {learned.total > 0 && ` · ${placed} in an Area, ${learned.unplaced} in none`}
          {learned.folded > 0 && ` · ${countNoun(learned.folded, "repeat", "repeats")} folded in`}
        </span>
        <span style={{ ...ROW, gap: 8, flexWrap: "wrap" }}>
          <Input aria-label="Search what was learned" placeholder="Words it says or tables it read" value={typed}
            onChange={(e) => setTyped(e.target.value)} style={{ minWidth: 240 }} />
          <SelectField value={area} aria-label="Area" style={{ minWidth: 220 }} onChange={(e) => setArea(e.target.value)}>
            <option value="">Every Area</option>
            <option value={NO_AREA}>{`In no Area — ${learned.unplaced}`}</option>
            {learned.areas.filter((a) => a.count > 0).map((a) => <option key={a.id} value={a.id}>{`${a.name} — ${a.count}`}</option>)}
          </SelectField>
        </span>
      </div>
      {learned.withheld && (
        <div className="aug-fs-xs" data-testid="learned-withheld" style={{ color: "var(--amb4)" }}>{learned.withheld.notice}</div>
      )}
      {learned.items.length === 0 ? (
        <Empty>{about || area ? "Nothing learned matches." : "The platform has learned nothing about this connection yet."}</Empty>
      ) : (
        <div>
          {learned.items.map((i) => (
            <Row key={i.ref} connId={connId} item={i} areaName={areaName} areas={learned.areas} />
          ))}
          {learned.matched > learned.items.length && (
            <div className="aug-fs-xs" style={{ ...MUTED, padding: "8px 0" }}>
              The first {learned.items.length} of {learned.matched}, in the order they stand — search or pick an Area to see the rest.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
