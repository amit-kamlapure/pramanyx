"use client";

/**
 * The organisation's word on its areas (the ontology study, Phase 1, 2026-11-17): who owns an area and where it sits,
 * a new area a curator declares, and where a person places a table. The server decides who may — a curator declares
 * and owns, anyone who edits the semantic layer places — and its refusal is said here.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { declarationsOf, people, placeInArea, saveAreas, type AreaPlaced, type BusinessArea } from "@/lib/areas";

const MUTED = { color: "var(--t2)" };

/** An area's owners and place, set by a curator; saved as the organisation's whole declaration. */
export function AreaOwnersEditor({ connId, schema, areas, area, onSaved }: {
  connId: string; schema?: string; areas: BusinessArea[]; area: BusinessArea; onSaved: (areas: BusinessArea[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [business, setBusiness] = useState(area.business_owners.map((x) => x.replace(/^user:/, "")).join(", "));
  const [technical, setTechnical] = useState(area.technical_owners.map((x) => x.replace(/^user:/, "")).join(", "));
  const [parent, setParent] = useState(area.parent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return <Button size="xs" variant="outline" onClick={() => setOpen(true)}>Owners and place</Button>;
  const save = async () => {
    setBusy(true); setError("");
    try {
      const rest = declarationsOf(areas).filter((d) => d.id !== area.id);
      const mine = { id: area.id, ...(area.source === "organisation" ? { name: area.name, question: area.question } : {}),
                     parent, business_owners: people(business), technical_owners: people(technical) };
      onSaved(await saveAreas(connId, [...rest, mine], schema));
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, alignItems: "center", margin: "6px 0" }} data-testid="area-owners-editor">
      <label className="aug-fs-sm" htmlFor={`owners-${area.id}`} style={MUTED}>Owned by</label>
      <Input id={`owners-${area.id}`} value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="who answers for what it means" />
      <label className="aug-fs-sm" htmlFor={`tech-${area.id}`} style={MUTED}>Its data by</label>
      <Input id={`tech-${area.id}`} value={technical} onChange={(e) => setTechnical(e.target.value)} placeholder="who answers for its data" />
      <label className="aug-fs-sm" htmlFor={`parent-${area.id}`} style={MUTED}>Sits under</label>
      <SelectField id={`parent-${area.id}`} value={parent} onChange={(e) => setParent(e.target.value)}>
        <option value="">nothing — at the top</option>
        {areas.filter((a) => a.id !== area.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </SelectField>
      <span />
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="xs" disabled={busy} onClick={() => void save()}>Save</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        {error && <span className="aug-fs-xs" role="alert" style={{ color: "var(--red4)" }}>{error}</span>}
      </span>
    </div>
  );
}

/** A curator declares an area the industry's map does not have. */
export function DeclareArea({ connId, schema, areas, onSaved }: {
  connId: string; schema?: string; areas: BusinessArea[]; onSaved: (areas: BusinessArea[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>Declare an area</Button>;
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const save = async () => {
    setBusy(true); setError("");
    try {
      onSaved(await saveAreas(connId, [...declarationsOf(areas), { id, name: name.trim(), question: question.trim(), parent }], schema));
      setOpen(false); setName(""); setQuestion(""); setParent("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="declare-area">
      <Input aria-label="Area name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Its name" style={{ width: 180 }} />
      <Input aria-label="Its question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="The question it answers" style={{ width: 240 }} />
      <SelectField aria-label="Sits under" value={parent} onChange={(e) => setParent(e.target.value)}>
        <option value="">at the top</option>
        {areas.map((a) => <option key={a.id} value={a.id}>under {a.name}</option>)}
      </SelectField>
      <Button size="xs" disabled={busy || !id} onClick={() => void save()}>Declare</Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      {error && <span className="aug-fs-xs" role="alert" style={{ color: "var(--red4)" }}>{error}</span>}
    </span>
  );
}

/** Where a person places one table: an area of the connection, or none (left to the evidence). */
export function AreaPlacement({ connId, schema, table, areas, placed, onPlaced }: {
  connId: string; schema?: string; table: string; areas: BusinessArea[]; placed: AreaPlaced | null;
  onPlaced: (area: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async (area: string) => {
    setBusy(true); setError("");
    try { onPlaced(await placeInArea(connId, { kind: "table", ref: table, area, schema_name: schema ?? "" })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }} data-testid="area-placement">
      <SelectField aria-label={`The area ${table} serves`} disabled={busy} value={placed?.area ?? ""}
        title={placed ? `Placed by ${placed.by.replace(/^user:/, "")}` : "Placed by its name and the metrics that read it, until a person places it"}
        onChange={(e) => void change(e.target.value)}>
        <option value="">Area: by evidence</option>
        {areas.map((a) => <option key={a.id} value={a.id}>Area: {a.name}</option>)}
      </SelectField>
      {error && <span className="aug-fs-xs" role="alert" style={{ color: "var(--red4)" }}>{error}</span>}
    </span>
  );
}
