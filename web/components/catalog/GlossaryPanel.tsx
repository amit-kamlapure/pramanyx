"use client";

/**
 * Catalog — Business Glossary (comments on tables and columns).
 *
 * Surfaces the institutional knowledge the agent reads AT QUERY TIME and lets a
 * human author it. Everything here is injected into the schema context via
 * `apply_glossary()` before the investigator plans a query, so a good comment,
 * grain note, join hint, value list, or caveat directly steers the agent.
 *
 *  Table level   → description · grain · join hints
 *  Column level  → description · known values · caveats
 *
 * Wires to /glossary (GET) and /glossary/{table}[/{column}]?schema= (PUT).
 *
 * SCOPED BY SCHEMA. The store holds both bare and `schema.table` keys (the connectors
 * disagree on the `TABLE:` header), so reads resolve tolerantly via `lookupGlossaryTable`
 * and writes carry the schema — otherwise editing `orders` here overwrote the `orders`
 * comment belonging to every other schema. Pass the BARE table name plus its schema.
 */
import { useEffect, useState } from "react";
import {
  getGlossary, lookupGlossaryTable, modelWrote, updateTableGlossary, updateColumnGlossary,
  getColumnNotes, setColumnNote, type ColumnNoteEntry, type GlossaryTable,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";

/** Spacing only: the type is the section label's own (.aug-label). */
const LABEL: React.CSSProperties = { marginBottom: 6 };

/** Inline click-to-edit field (single value). Reused for every annotation. */
function EditableField({ value, placeholder, multiline = true, onSave }: {
  value: string; placeholder: string; multiline?: boolean; onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <div onClick={() => setEditing(true)}
        style={{ fontSize: 12, lineHeight: 1.5, cursor: "text", padding: "4px 6px", borderRadius: 4,
          color: value ? "var(--t2)" : "var(--t3)", whiteSpace: "pre-wrap" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
        {value || placeholder}
      </div>
    );
  }
  const save = async () => {
    setBusy(true);
    try { await onSave(draft.trim()); setEditing(false); }
    catch (e) {
      // Editor stays open; without this the failure was invisible.
      window.alert(e instanceof Error ? e.message : "Save failed");
    }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Textarea autoFocus value={draft} disabled={busy}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Enter" && !multiline && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === "Escape") setEditing(false);
        }}
        style={{ minHeight: multiline ? 54 : 32, resize: "vertical", width: "100%" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="default" size="xs" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>
        <span style={{ fontSize: 11, color: "var(--t3)", alignSelf: "center" }}>⌘↵ to save · Esc to cancel</span>
      </div>
    </div>
  );
}

/** Said beside words the model wrote (2026-11-25): a person's edit makes them theirs, and the mark goes. */
export function ByModel() {
  return (
    <span data-testid="by-model" className="aug-fs-xs" title="The model wrote this. Edit it to make it yours."
      style={{ fontWeight: 400, color: "var(--t3)" }}>Written by the model</span>
  );
}

/** A small captioned annotation row (used for column values/caveats and table grain). */
function SubField({ caption, value, placeholder, accent, byModel, onSave }: {
  caption: string; value: string; placeholder: string; accent?: string; byModel?: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 1 }}>
        <span style={{ fontSize: 11, color: accent ?? "var(--t3)", fontWeight: 600 }}>{caption}</span>
        {byModel && value ? <ByModel /> : null}
      </div>
      <EditableField value={value} placeholder={placeholder} multiline={false} onSave={onSave} />
    </div>
  );
}

export function GlossaryPanel({ table, columns, schema, connectionId }: {
  table: string;
  columns: string[];
  /** The connection whose column notes this table's columns carry; without it none are shown. */
  connectionId?: string;
  /** The table's schema — scopes both the lookup and the write. */
  schema?: string | null;
}) {
  const [entry, setEntry] = useState<GlossaryTable>({});
  const [notes, setNotes] = useState<Record<string, ColumnNoteEntry>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      getGlossary(connectionId).then(g => lookupGlossaryTable(g, table, schema) ?? {}).catch(() => ({})),
      connectionId ? getColumnNotes(connectionId, schema).then(t => t[table] ?? {}).catch(() => ({})) : Promise.resolve({}),
    ])
      .then(([g, n]) => { setEntry(g as GlossaryTable); setNotes(n as Record<string, ColumnNoteEntry>); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [table]);

  if (loading) return <Loading what="the glossary" style={{ padding: 20 }} />;

  const colEntry = (c: string) => (entry.columns ?? {})[c] ?? {};
  const byModel = (field: string) => modelWrote(entry, field);
  const saveTable = async (patch: Parameters<typeof updateTableGlossary>[1]) => {
    await updateTableGlossary(table, patch, schema, connectionId); load();
  };
  const saveColumn = async (c: string, patch: Parameters<typeof updateColumnGlossary>[2]) => {
    await updateColumnGlossary(table, c, patch, schema, connectionId); load();
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
      {/* Why this matters — the agent reads everything below at query time. */}
      <div style={{
        fontSize: 11, color: "var(--t3)", lineHeight: 1.5, marginBottom: 16,
        padding: "8px 11px", background: "var(--bg-2)",
        borderRadius: 6,
      }}>
        These notes are read by the agent <b style={{ color: "var(--t2)" }}>at query time</b> — descriptions,
        grain, join hints, known values, and caveats all steer how deep analyses are planned.
      </div>

      {/* ── Table level ── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ ...LABEL, display: "flex", gap: 8, alignItems: "baseline" }}>
          <span className="aug-label">Table comment</span>
          {byModel("description") && entry.description ? <ByModel /> : null}
        </div>
        <EditableField value={entry.description ?? ""} placeholder="Describe what this table represents…"
          onSave={v => saveTable({ description: v })} />

        <SubField
          caption="Grain — one row per…"
          value={entry.grain ?? ""}
          placeholder="e.g. one row per order line"
          byModel={byModel("grain")}
          onSave={v => saveTable({ grain: v })}
        />

        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 1 }}>
            <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>Join hints — one per line</span>
            {byModel("joins") && (entry.joins ?? []).length ? <ByModel /> : null}
          </div>
          <EditableField
            value={(entry.joins ?? []).join("\n")}
            placeholder="e.g. customers on customer_id"
            onSave={v => saveTable({ joins: v.split("\n").map(s => s.trim()).filter(Boolean) })}
          />
        </div>
      </div>

      {/* ── Column level ── */}
      <div className="aug-label" style={LABEL}>Columns</div>
      {columns.length === 0 && <p style={{ fontSize: 12, color: "var(--t3)" }}>No columns.</p>}
      {columns.map(c => {
        const ce = colEntry(c);
        return (
          <div key={c} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, padding: "10px 0", borderBottom: "0.5px solid var(--b0)", alignItems: "start" }}>
            <div style={{ minWidth: 0 }}>
              <span className="aug-fs-chrome" style={{ color: "var(--t1)", fontWeight: 500, fontFamily: "var(--font-mono)" }}>{c}</span>
            </div>
            <div>
              {byModel(`columns.${c}.description`) && ce.description ? <ByModel /> : null}
              <EditableField value={ce.description ?? ""} placeholder="Add a comment…"
                onSave={v => saveColumn(c, { description: v })} />
              <SubField
                caption="Known values"
                value={ce.values ?? ""}
                placeholder="e.g. pending · paid · refunded · canceled"
                byModel={byModel(`columns.${c}.values`)}
                onSave={v => saveColumn(c, { values: v })}
              />
              <SubField
                caption="⚠ Caveats"
                value={ce.caveats ?? ""}
                placeholder="e.g. NULL until the order ships; excludes test accounts"
                accent="var(--amb4)"
                byModel={byModel(`columns.${c}.caveats`)}
                onSave={v => saveColumn(c, { caveats: v })}
              />
              {/* The note the agent reads with this column — written by a person or proposed by the
                  agent. A wrong one could not be removed from the app (2026-10-02): Clear replaces it
                  with nothing, the note is kept in the column's history, and an agent's next note here
                  waits for review. */}
              {connectionId && notes[c]?.note && (
                <div style={{ marginTop: 6 }}>
                  <div className="aug-fs-xs" style={{ color: "var(--t3)", fontWeight: 600, marginBottom: 1 }}>
                    Note the agent reads · {notes[c].source === "agent" ? "written by the agent" : "written by a person"}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <p className="aug-fs-sm" style={{ flex: 1, margin: 0, color: "var(--t2)" }}>{notes[c].note}</p>
                    <Button variant="ghost" size="xs" title="Clear this note — it is kept in the column's history"
                      onClick={async () => { await setColumnNote(connectionId, schema, table, c, ""); load(); }}>
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
