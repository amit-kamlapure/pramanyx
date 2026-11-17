"use client";

/**
 * `/definitions/<word>?conn=<connection>[&area=<area>]`: what a business word means on a connection — a Definition,
 * a governed definition (a Record claim of kind `definition`, `pramanyx/record/writers.py`).
 *
 * Since 2026-11-17 (the ontology study): anyone drafts a word nobody has defined and owns it; its OWNER
 * edits and publishes it; anyone else's change is a SUGGESTED EDIT the owner accepts or declines, and the published
 * wording stands until then. One word may mean one thing in one area of the business and another in the next — each its own
 * definition, chosen here. It carries the other names people use for it and what it refers to. Opened beside an answer
 * that was given it (the coworker's right-hand pane), and where a person writes, suggests or publishes one.
 */
import { use, useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fastApiError } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";
import { readAreas, type BusinessArea } from "@/lib/areas";
import { LINK_KINDS, earlierWordings, linkHref, names, same, who, type Definition, type DefinitionLink } from "@/lib/definitions";
import { fmtDate } from "@/lib/format";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

function segment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const MUTED = { color: "var(--t2)" };

interface Draft { text: string; aliases: string; links: DefinitionLink[]; area: string; why: string }
const fromDefinition = (d: Definition | null | undefined, area: string): Draft => ({
  text: d?.statement.text ?? "", aliases: (d?.aliases ?? []).join(", "), links: d?.links ?? [], area: d?.area ?? area, why: "",
});

export default function DefinitionRoute({ params, searchParams }: {
  params: Promise<{ term: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const term = segment(use(params).term);
  const query = use(searchParams);
  const connection = typeof query.conn === "string" ? query.conn : "";
  const [area, setArea] = useState(typeof query.area === "string" ? query.area : "");
  const [all, setAll] = useState<Definition[] | null | undefined>(undefined);
  const [me, setMe] = useState("");
  const [draft, setDraft] = useState<Draft>(fromDefinition(null, ""));
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const found = all?.find((d) => same(d.area, area)) ?? (all && !area ? all[0] : undefined) ?? (all ? null : undefined);

  const read = useCallback(async () => {
    const q = new URLSearchParams({ connection_id: connection, term });
    const res = await fetch(`${getApiBase()}/record/definitions?${q}`);
    if (!res.ok) { setSaid(fastApiError(await res.json().catch(() => ({})), `Reading the definition failed (${res.status})`)); setAll(null); return; }
    setAll((await res.json()) as Definition[]);
  }, [connection, term]);

  useEffect(() => { if (connection) void read(); }, [connection, read]);
  // The connection's areas of the business: a definition is written in one of them, chosen, never typed (2026-11-17).
  const [areas, setAreas] = useState<BusinessArea[]>([]);
  useEffect(() => { if (connection) readAreas(connection).then((r) => setAreas(r.areas)).catch(() => setAreas([])); }, [connection]);
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name || id;
  useEffect(() => {
    fetch(`${getApiBase()}/record/you`).then((r) => (r.ok ? r.json() : null)).then((r) => setMe(String(r?.principal ?? ""))).catch(() => setMe(""));
  }, []);

  const send = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setSaid("");
    try {
      const res = await fetch(`${getApiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" },
                                                         body: JSON.stringify({ connection_id: connection, term, area: found?.area ?? area, ...body }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setSaid(fastApiError(out, `${done} failed (${res.status})`)); return; }
      setWriting(false);
      setSaid(out?.suggested ? `Sent to its owner, ${who(out.owner)}, as a suggested edit. The wording stands until they accept it.` : done);
      if (out?.area !== undefined) setArea(out.area);
      await read();
    } finally { setBusy(false); }
  };

  if (!connection) {
    return <main className="aug-fs-sm" style={{ padding: 20, ...MUTED }}>This page needs a connection: add <code>?conn=</code> to its address.</main>;
  }
  const mine = !!found && !!me && same(found.owner, me);
  const published = found?.state === "published";
  const startWriting = () => { setDraft(fromDefinition(found, area)); setWriting(true); };
  const setLink = (i: number, patch: Partial<DefinitionLink>) =>
    setDraft((d) => ({ ...d, links: d.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  return (
    <main style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, maxWidth: "none" }}>
      <div>
        <div className="aug-fs-xs" style={{ color: "var(--t3)" }}>Definition</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1 className="aug-fs-h1" style={{ margin: 0, color: "var(--t1)" }}>{found?.term || term}</h1>
          {found && <Badge variant={published ? "green" : "amber"} data-testid="definition-state">{published ? "Published" : "Draft"}</Badge>}
          {found?.area && <Badge variant="outline">in {areaName(found.area)}</Badge>}
        </div>
        {found && (
          <p className="aug-fs-xs" style={{ margin: "4px 0 0", ...MUTED }}>
            {published ? `Published by ${who(found.approved_by || found.owner)} on ${fmtDate(found.approved_on, "day")}`
              : found.drafted_by_agent ? `Drafted by the coworker for ${who(found.owner)}, from what they said — not used until they publish it`
              : "Written, not yet published by its owner"}
            {" · "}owned by {who(found.owner) || "no one named"}
          </p>
        )}
        {all && all.length > 1 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }} data-testid="definition-areas">
            <span className="aug-fs-xs" style={MUTED}>Means something different in each of {all.length} areas:</span>
            {all.map((d) => (
              <Button key={d.area || "-"} size="xs" variant={same(d.area, found?.area ?? "") ? "secondary" : "ghost"}
                onClick={() => { setArea(d.area); setWriting(false); }}>{d.area ? areaName(d.area) : "no area"}</Button>
            ))}
          </div>
        )}
      </div>

      {found === undefined && <p className="aug-fs-sm" style={MUTED}>Reading…</p>}

      {found && !writing && (
        <>
          <p className="aug-fs-ui" style={{ margin: 0, color: "var(--t1)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{found.statement.text}</p>
          {found.aliases.length > 0 && (
            <p className="aug-fs-sm" style={{ margin: 0, ...MUTED }} data-testid="definition-aliases">Also called {found.aliases.join(", ")}</p>
          )}
          {found.links.length > 0 && (
            <div className="aug-fs-sm" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...MUTED }} data-testid="definition-links">
              Refers to
              {found.links.map((l) => {
                const href = linkHref(l, connection);
                const text = `${l.kind} ${l.label || l.ref}`;
                return href ? <a key={`${l.kind}:${l.ref}`} href={href}>{text}</a> : <span key={`${l.kind}:${l.ref}`}>{text}</span>;
              })}
            </div>
          )}
        </>
      )}

      {found === null && !writing && (
        <p className="aug-fs-sm" style={MUTED}>No one has written what “{term}” means on this connection yet.</p>
      )}

      {writing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="definition-form">
          <label htmlFor="definition-text" className="aug-fs-sm" style={MUTED}>What “{term}” means here</label>
          <Textarea id="definition-text" rows={6} value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
          <label htmlFor="definition-aliases" className="aug-fs-sm" style={MUTED}>Other names people use for it, comma-separated</label>
          <Input id="definition-aliases" value={draft.aliases} onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value }))} />
          {!found && (
            <>
              <label htmlFor="definition-area" className="aug-fs-sm" style={MUTED}>Area of the business, when it means something particular there</label>
              <SelectField id="definition-area" value={draft.area} onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}>
                <option value="">Everywhere — no one area</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
            </>
          )}
          <span className="aug-fs-sm" style={MUTED}>What it refers to</span>
          {draft.links.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr auto", gap: 8, alignItems: "center" }}>
              <SelectField aria-label="Kind" value={l.kind} onChange={(e) => setLink(i, { kind: e.target.value })}>
                {LINK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </SelectField>
              <Input aria-label="What it names" value={l.ref} placeholder="its name or address" onChange={(e) => setLink(i, { ref: e.target.value })} />
              <Input aria-label="Label" value={l.label} placeholder="label (optional)" onChange={(e) => setLink(i, { label: e.target.value })} />
              <Button size="xs" variant="ghost" onClick={() => setDraft((d) => ({ ...d, links: d.links.filter((_, j) => j !== i) }))}>Remove</Button>
            </div>
          ))}
          <div><Button size="xs" variant="ghost" onClick={() => setDraft((d) => ({ ...d, links: [...d.links, { kind: "metric", ref: "", label: "" }] }))}>Add what it refers to</Button></div>
          {found && !mine && (
            <>
              <label htmlFor="definition-why" className="aug-fs-sm" style={MUTED}>Why, for its owner (optional)</label>
              <Input id="definition-why" value={draft.why} onChange={(e) => setDraft((d) => ({ ...d, why: e.target.value }))} />
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {writing ? (
          <>
            <Button size="sm" disabled={busy || !draft.text.trim()} onClick={() => void send("/record/definitions", {
              text: draft.text.trim(), aliases: names(draft.aliases), why: draft.why.trim(), area: found?.area ?? draft.area.trim(),
              links: draft.links.filter((l) => l.ref.trim()).map((l) => ({ kind: l.kind, ref: l.ref.trim(), label: l.label.trim() })),
            }, found ? "Changed" : "Written as a draft — publish it when it is right")}>
              {!found ? "Keep this draft" : mine ? "Keep the change" : "Suggest this edit"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setWriting(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={startWriting}>{!found ? "Write what it means" : mine ? "Change it" : "Suggest an edit"}</Button>
            {found && !published && (
              // Only its owner publishes it; anyone else is told whose it is, by the server.
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void send("/record/definitions/approve", {}, "Published")}
                title={`Only its owner, ${who(found.owner) || "no one named"}, can publish it`}>Publish</Button>
            )}
            {found && published && mine && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send("/record/definitions/unpublish", {}, "Back to a draft")}>Unpublish</Button>
            )}
          </>
        )}
      </div>
      {said && <p className="aug-fs-xs" style={MUTED} role="status">{said}</p>}

      {found && found.suggestions.length > 0 && (
        <section data-testid="definition-suggestions">
          <h2 className="aug-fs-h2" style={{ margin: "8px 0 4px", color: "var(--t1)" }}>Suggested edits</h2>
          {found.suggestions.map((s) => (
            <div key={s.id} style={{ borderTop: "1px solid var(--b2)", padding: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="aug-fs-xs" style={MUTED}>
                {who(s.by)}{s.by_agent ? " (drafted by the coworker for them)" : ""} · {fmtDate(s.at, "day")}{s.why ? ` · ${s.why}` : ""}
              </div>
              {s.text && <div className="aug-fs-sm" style={{ color: "var(--t1)", whiteSpace: "pre-wrap" }}>{s.text}</div>}
              {s.aliases && <div className="aug-fs-sm" style={MUTED}>Other names: {s.aliases.join(", ") || "none"}</div>}
              {s.links && <div className="aug-fs-sm" style={MUTED}>Refers to: {s.links.map((l) => `${l.kind} ${l.label || l.ref}`).join(", ") || "nothing"}</div>}
              {mine && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="xs" variant="secondary" disabled={busy}
                    onClick={() => void send("/record/definitions/suggestions/decide", { suggestion_id: s.id, accept: true }, "Accepted")}>Accept</Button>
                  <Button size="xs" variant="ghost" disabled={busy}
                    onClick={() => void send("/record/definitions/suggestions/decide", { suggestion_id: s.id, accept: false }, "Declined, and kept beside it")}>Decline</Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {found && earlierWordings(found.versions).length > 0 && (
        <section>
          <h2 className="aug-fs-h2" style={{ margin: "8px 0 4px", color: "var(--t1)" }}>Earlier wordings</h2>
          {earlierWordings(found.versions).map((v) => (
            <div key={v.id} style={{ borderTop: "1px solid var(--b2)", padding: "8px 0" }}>
              <div className="aug-fs-xs" style={MUTED}>{fmtDate(v.recorded_at, "day")} · {v.tier} · {who(v.author)}</div>
              <div className="aug-fs-sm" style={{ color: "var(--t2)", whiteSpace: "pre-wrap" }}>{v.text}</div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
