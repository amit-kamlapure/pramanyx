"use client";

/**
 * A Definition as a Page — what a business word means on a connection (a Record claim of kind `definition`,
 * `pramanyx/record/writers.py`), laid out as the Page the user showed beside ours (2026-11-23) — a catalog's page for a business word:
 * its name, then its Area, owner, synonyms and a short description, then its body under a toolbar — a Definition and a
 * Business use section to start — then its related assets and its sources. The page `/definitions/<word>` shows on its
 * own (beside an answer, the coworker's pane) and the Semantic Layer shows inside the app — one page, two places.
 *
 * Since 2026-11-17 (the ontology study): anyone drafts a word nobody has defined and owns it; its OWNER edits and
 * publishes it; anyone else's change is a SUGGESTED EDIT the owner accepts or declines, and the published wording
 * stands until then. One word may mean one thing in one Area and another in the next — each its own definition.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { Chip } from "@/components/clarity/kit";
import { DefinitionBody } from "@/components/definitions/DefinitionBody";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { openInApp } from "@/lib/addressOnce";
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";
import { readAreas, type BusinessArea } from "@/lib/areas";
import { BODY_MAX, BODY_TEMPLATE, apply, type Tool } from "@/lib/definitionBody";
import {
  earlierWordings, inAppHref, linkHref, same, who,
  type Definition, type DefinitionLink, type DefinitionSource,
} from "@/lib/definitions";
import { KIND_ICON, KIND_WORDS, readDiscoverItems, readDiscoverSearch, type DiscoverItem, type DiscoverKind } from "@/lib/discover";
import { fmtDate, formatCount } from "@/lib/format";

const MUTED = { color: "var(--t3)" };

interface Draft {
  name: string; text: string; description: string; aliases: string[]; links: DefinitionLink[];
  sources: DefinitionSource[]; area: string; why: string;
}
const fromDefinition = (d: Definition | null | undefined, term: string, area: string): Draft => ({
  name: d?.term ?? term, text: d?.statement.text ?? BODY_TEMPLATE, description: d?.description ?? "",
  aliases: d?.aliases ?? [], links: d?.links ?? [], sources: d?.sources ?? [], area: d?.area ?? area, why: "",
});

/** A click that opens in place; one with a modifier is the browser's. */
function inPlace(e: MouseEvent, open: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault(); open();
}

export function DefinitionView({ term, connection, initialArea = "", inApp = false, onCancel, onNamed }: {
  /** The word; empty for a new Definition, named on the page. */
  term: string;
  connection: string;
  /** The area of the business the link named, when it named one. */
  initialArea?: string;
  /** Shown inside the app: what it refers to opens inside the app too, never on a page of its own. */
  inApp?: boolean;
  /** Leaving a new Definition unwritten (the host closes the page). */
  onCancel?: () => void;
  /** A new Definition was kept under its name (the host opens it by that name). */
  onNamed?: (term: string, area: string) => void;
}) {
  const [area, setArea] = useState(initialArea);
  const [all, setAll] = useState<Definition[] | null | undefined>(term ? undefined : null);
  const [me, setMe] = useState("");
  const [draft, setDraft] = useState<Draft>(fromDefinition(null, term, initialArea));
  const [writing, setWriting] = useState(!term);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  // undefined while it is read; null when there is none — a new one (no word yet) is none, never "Reading…"
  const found = !term ? null
    : all === undefined ? undefined
    : (all?.find((d) => same(d.area, area)) ?? (all && !area ? all[0] : undefined) ?? null);

  const read = useCallback(async () => {
    if (!term) return;
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

  const post = async (path: string, body: Record<string, unknown>, name: string, where: string) => {
    const res = await fetch(`${getApiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: connection, term: name, area: where, ...body }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(fastApiError(out, `${path.endsWith("approve") ? "Publishing" : "Saving"} failed (${res.status})`));
    return out;
  };

  /** Keep what is written — and publish it too when asked and it is the person's own. */
  const keep = async (publish: boolean) => {
    const name = (found?.term ?? draft.name).trim();
    const where = found?.area ?? draft.area;
    setBusy(true); setSaid("");
    try {
      const out = await post("/record/definitions", {
        text: draft.text.trim(), description: draft.description.trim(), aliases: draft.aliases, why: draft.why.trim(),
        links: draft.links.map(({ kind, ref, label, href }) => ({ kind, ref, label, ...(href ? { href } : {}) })),
        sources: draft.sources,
      }, name, where);
      if (out?.suggested) {
        setSaid(`Sent to its owner, ${who(out.owner)}, as a suggested edit. The wording stands until they accept it.`);
      } else if (publish) {
        await post("/record/definitions/approve", {}, name, where);
        setSaid("Published — answers read it from now on");
      } else {
        setSaid(found?.state === "published" ? "Saved — it stays published" : "Saved as a draft — publish it when it is right");
      }
      setWriting(false);
      if (!term) { onNamed?.(name, where); return; }
      if (out?.area !== undefined) setArea(out.area);
      await read();
    } catch (e) { setSaid((e as Error).message); } finally { setBusy(false); }
  };

  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    if (!found) return;
    setBusy(true); setSaid("");
    try { await post(path, body, found.term, found.area); setSaid(done); await read(); }
    catch (e) { setSaid((e as Error).message); } finally { setBusy(false); }
  };

  if (!connection) {
    return <main className="aug-fs-sm" style={{ padding: 20, ...MUTED }}>This page needs a connection: add <code>?conn=</code> to its address.</main>;
  }
  const mine = !!found && !!me && same(found.owner, me);
  const published = found?.state === "published";
  const isNew = !found;
  const startWriting = () => { setDraft(fromDefinition(found, term, area)); setWriting(true); setSaid(""); };
  const cancel = () => { setWriting(false); setSaid(""); if (!term) onCancel?.(); };
  const nameOk = !!(found?.term ?? draft.name).trim();
  const textOk = !!draft.text.trim() && draft.text.trim() !== BODY_TEMPLATE.trim() && draft.text.length <= BODY_MAX;
  const open = (href: string | null) =>
    (href && inApp && href.startsWith("/?") ? (e: MouseEvent) => inPlace(e, () => openInApp(href)) : undefined);

  // ── the actions on the title row, as a Page has them ──
  const actions = writing ? (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={cancel}>Cancel</Button>
      {found && !mine ? (
        <Button size="sm" disabled={busy || !textOk} onClick={() => void keep(false)}>Suggest this edit</Button>
      ) : (
        <>
          <Button size="sm" variant="outline" disabled={busy || !nameOk || !textOk} onClick={() => void keep(false)}
            data-testid="definition-save">{published ? "Save" : "Save as draft"}</Button>
          {!published && <Button size="sm" disabled={busy || !nameOk || !textOk} onClick={() => void keep(true)}>Publish</Button>}
        </>
      )}
    </>
  ) : found ? (
    <>
      <Button size="sm" variant="outline" onClick={startWriting}>{mine ? "Edit" : "Suggest an edit"}</Button>
      {!published && (
        // Only its owner publishes it; anyone else is told whose it is, by the server.
        <Button size="sm" disabled={busy} onClick={() => void act("/record/definitions/approve", {}, "Published — answers read it from now on")}
          title={`Only its owner, ${who(found.owner) || "no one named"}, can publish it`}>Publish</Button>
      )}
      {published && mine && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("/record/definitions/unpublish", {}, "Back to a draft")}>Unpublish</Button>
      )}
    </>
  ) : found === null ? (
    <Button size="sm" onClick={startWriting}>Write what it means</Button>
  ) : null;

  const links = writing ? draft.links : found?.links ?? [];
  const sources = writing ? draft.sources : found?.sources ?? [];

  return (
    <main style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, maxWidth: "none" }}>
      <section data-testid="definition-page" style={{ background: "var(--bg-2)", borderRadius: "var(--r3)", minWidth: 0 }}>
        {/* name · state · actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span className="aug-fs-xs" style={MUTED}>Definition</span>
            {writing && !term ? (
              <Input bespoke aria-label="Its name" placeholder="Click to set its name" value={draft.name} autoFocus
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="aug-fs-h1" style={{ fontWeight: 600, height: 36, width: "min(560px, 100%)" }} />
            ) : (
              <h1 className="aug-fs-h1" style={{ margin: 0, color: "var(--t1)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {found?.term || term}
                {found && <Chip tone={published ? "up" : "amber"} testId="definition-state">{published ? "Published" : "Draft"}</Chip>}
              </h1>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>
        </div>
        {found && !writing && (
          <p className="aug-fs-xs" style={{ margin: "-6px 20px 10px", ...MUTED }}>
            {published ? `Published by ${who(found.approved_by || found.owner)} on ${fmtDate(found.approved_on, "day")}`
              : found.drafted_by_agent ? `Drafted by the coworker for ${who(found.owner)}, from what they said — not used until they publish it`
              : "Written, not yet published by its owner — answers do not read it yet"}
          </p>
        )}
        {all && all.length > 1 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "0 20px 10px" }} data-testid="definition-areas">
            <span className="aug-fs-xs" style={MUTED}>Means something different in each of {all.length} areas:</span>
            {all.map((d) => (
              <Button key={d.area || "-"} size="xs" variant={same(d.area, found?.area ?? "") ? "secondary" : "outline"}
                onClick={() => { setArea(d.area); setWriting(false); }}>{d.area ? areaName(d.area) : "no area"}</Button>
            ))}
          </div>
        )}

        {found === undefined && <p className="aug-fs-sm" style={{ ...MUTED, padding: "0 20px 16px" }}>Reading…</p>}
        {found === null && !writing && (
          <p className="aug-fs-sm" style={{ ...MUTED, padding: "0 20px 16px" }}>No one has written what “{term}” means on this connection yet.</p>
        )}

        {(found || writing) && (
          <>
            {/* the facts, a row each */}
            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", rowGap: 12, columnGap: 16, padding: "12px 20px 16px",
              boxShadow: "inset 0 1px 0 var(--b0)" }}>
              <Field label="Area">
                {writing && isNew ? (
                  <SelectField bespoke aria-label="Area" value={draft.area} onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}>
                    <option value="">Everywhere — no one area</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectField>
                ) : (found?.area ?? draft.area) ? (
                  <span title="An Area is part of what it is: the same word in another Area is another Definition">
                    <Chip>{areaName(found?.area ?? draft.area)}</Chip>
                  </span>
                ) : <span className="aug-fs-sm" style={MUTED}>Everywhere — no one area</span>}
              </Field>
              <Field label="Owner" title="Whoever writes it first owns it; only its owner publishes it, and anyone else suggests an edit">
                <Chip>{found ? `${who(found.owner) || "no one named"}${mine ? " (you)" : ""}` : `${who(me) || "you"} (you)`}</Chip>
              </Field>
              <Field label="Synonyms">
                <Synonyms value={writing ? draft.aliases : (found?.aliases ?? [])} editing={writing}
                  onChange={(aliases) => setDraft((d) => ({ ...d, aliases }))} />
              </Field>
              <Field label="Description">
                {writing ? (
                  <Textarea aria-label="Description" rows={2} placeholder="Add a short description" value={draft.description}
                    maxLength={400} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} style={{ width: "100%" }} />
                ) : found?.description ? (
                  <span className="aug-fs-ui" style={{ color: "var(--t1)" }} data-testid="definition-description">{found.description}</span>
                ) : <span className="aug-fs-sm" style={MUTED}>No description</span>}
              </Field>
            </div>

            {/* the body */}
            <div style={{ padding: "0 20px 16px", boxShadow: "inset 0 1px 0 var(--b0)" }}>
              {writing ? (
                <BodyEditor value={draft.text} onChange={(text) => setDraft((d) => ({ ...d, text }))} />
              ) : (
                <div style={{ paddingTop: 12 }}><DefinitionBody text={found?.statement.text ?? ""} /></div>
              )}
            </div>

            {/* related assets · sources */}
            <div style={{ padding: "12px 20px 16px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "inset 0 1px 0 var(--b0)" }}>
              <div data-testid="definition-links">
                <h2 className="aug-fs-chrome" style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--t1)" }}>Related assets</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {links.map((l, i) => {
                    const href = inApp ? inAppHref(l, connection) : (linkHref(l, connection) ?? (l.href || null));
                    const words = l.label || l.ref;
                    const kind = l.kind as DiscoverKind;
                    const glyph: IconName = KIND_ICON[kind] ?? (l.kind === "person" ? "user" : "link");
                    return (
                      <div key={`${l.kind}:${l.ref}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={MUTED}><Icon name={glyph} size={14} /></span>
                        {href ? <a href={href} onClick={open(href)} aria-label={`${l.kind} ${words}`}>{words}</a> : <span>{words}</span>}
                        <span className="aug-fs-xs" style={MUTED}>{KIND_WORDS[kind]?.[0] ?? l.kind}</span>
                        {writing && (
                          <Button size="icon-xs" variant="ghost" aria-label={`Remove ${words}`}
                            onClick={() => setDraft((d) => ({ ...d, links: d.links.filter((_, j) => j !== i) }))}><Icon name="close" size={12} /></Button>
                        )}
                      </div>
                    );
                  })}
                  {!writing && !links.length && <span className="aug-fs-sm" style={MUTED}>None yet</span>}
                  {writing && <AssetPicker connection={connection} have={draft.links}
                    onPick={(link) => setDraft((d) => ({ ...d, links: [...d.links, link] }))} />}
                </div>
              </div>
              <div data-testid="definition-sources">
                <h2 className="aug-fs-chrome" style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--t1)" }}>Sources</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {sources.map((s, i) => {
                    const href = s.kind === "url" ? s.ref : `/?${new URLSearchParams({ tab: "documents", doc: s.ref })}`;
                    return (
                      <div key={`${s.kind}:${s.ref}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={MUTED}><Icon name={s.kind === "url" ? "external" : "folder"} size={14} /></span>
                        {s.kind === "url"
                          ? <a href={href} target="_blank" rel="noopener noreferrer">{s.label || s.ref}</a>
                          : <a href={href} onClick={open(href)}>{s.label || s.ref}</a>}
                        {writing && (
                          <Button size="icon-xs" variant="ghost" aria-label={`Remove ${s.label || s.ref}`}
                            onClick={() => setDraft((d) => ({ ...d, sources: d.sources.filter((_, j) => j !== i) }))}><Icon name="close" size={12} /></Button>
                        )}
                      </div>
                    );
                  })}
                  {!writing && !sources.length && <span className="aug-fs-sm" style={MUTED}>None yet</span>}
                  {writing && <SourcePicker have={draft.sources}
                    onPick={(source) => setDraft((d) => ({ ...d, sources: [...d.sources, source] }))} />}
                </div>
              </div>
              {writing && found && !mine && (
                <div>
                  <label htmlFor="definition-why" className="aug-fs-sm" style={MUTED}>Why, for its owner (optional)</label>
                  <Input id="definition-why" value={draft.why} onChange={(e) => setDraft((d) => ({ ...d, why: e.target.value }))} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {said && <p className="aug-fs-xs" style={MUTED} role="status">{said}</p>}

      {found && found.suggestions.length > 0 && (
        <section data-testid="definition-suggestions">
          <h2 className="aug-fs-h2" style={{ margin: "8px 0 4px", color: "var(--t1)" }}>Suggested edits</h2>
          {found.suggestions.map((s) => (
            <div key={s.id} style={{ borderTop: "1px solid var(--b0)", padding: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="aug-fs-xs" style={MUTED}>
                {who(s.by)}{s.by_agent ? " (drafted by the coworker for them)" : ""} · {fmtDate(s.at, "day")}{s.why ? ` · ${s.why}` : ""}
              </div>
              {s.text && <DefinitionBody text={s.text} />}
              {s.description !== undefined && <div className="aug-fs-sm" style={MUTED}>Description: {s.description || "none"}</div>}
              {s.aliases && <div className="aug-fs-sm" style={MUTED}>Synonyms: {s.aliases.join(", ") || "none"}</div>}
              {s.links && <div className="aug-fs-sm" style={MUTED}>Related assets: {s.links.map((l) => l.label || l.ref).join(", ") || "none"}</div>}
              {s.sources && <div className="aug-fs-sm" style={MUTED}>Sources: {s.sources.map((x) => x.label || x.ref).join(", ") || "none"}</div>}
              {mine && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="xs" variant="secondary" disabled={busy}
                    onClick={() => void act("/record/definitions/suggestions/decide", { suggestion_id: s.id, accept: true }, "Accepted")}>Accept</Button>
                  <Button size="xs" variant="outline" disabled={busy}
                    onClick={() => void act("/record/definitions/suggestions/decide", { suggestion_id: s.id, accept: false }, "Declined, and kept beside it")}>Decline</Button>
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
            <div key={v.id} style={{ borderTop: "1px solid var(--b0)", padding: "8px 0" }}>
              <div className="aug-fs-xs" style={MUTED}>{fmtDate(v.recorded_at, "day")} · {v.tier} · {who(v.author)}</div>
              <div className="aug-fs-sm" style={{ color: "var(--t2)", whiteSpace: "pre-wrap" }}>{v.text}</div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <>
      <span className="aug-fs-chrome" style={{ color: "var(--t2)", paddingTop: 4 }} title={title}>{label}</span>
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </>
  );
}

/** Its other names: chips, and one more typed in when writing. */
function Synonyms({ value, editing, onChange }: { value: string[]; editing: boolean; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState("");
  const add = () => {
    const w = word.trim();
    if (w && !value.some((v) => same(v, w))) onChange([...value, w]);
    setWord(""); setAdding(false);
  };
  if (!editing && !value.length) return <span className="aug-fs-sm" style={MUTED}>None</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="definition-aliases">
      {value.map((v) => (
        <Chip key={v}>{v}{editing && (
          <Button size="icon-xs" variant="ghost" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}
            style={{ height: 14, width: 14 }}><Icon name="close" size={10} /></Button>
        )}</Chip>
      ))}
      {editing && (adding ? (
        <Input bespoke autoFocus aria-label="A synonym" value={word} placeholder="Another name for it" style={{ width: 200 }}
          onChange={(e) => setWord(e.target.value)} onBlur={add}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { setWord(""); setAdding(false); } }} />
      ) : (
        <Button size="icon-xs" variant="outline" aria-label="Add a synonym" onClick={() => setAdding(true)}><Icon name="plus" size={12} /></Button>
      ))}
    </span>
  );
}

const TOOLS: { tool: Tool; label: string; icon?: IconName; text?: string }[] = [
  { tool: "bold", label: "Bold", text: "B" }, { tool: "italic", label: "Italic", text: "I" },
  { tool: "bullets", label: "Bulleted list", icon: "list" }, { tool: "numbers", label: "Numbered list", icon: "num" },
  { tool: "link", label: "Link", icon: "link" }, { tool: "table", label: "Table", icon: "table" },
];

/** The body, written in Markdown under its toolbar, with a look at it drawn. */
function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const use = (tool: Tool) => {
    const el = area.current;
    const next = apply(tool, { text: value, start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length });
    onChange(next.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next.start, next.end); });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10 }} data-testid="definition-editor">
      <div role="toolbar" aria-label="Format" style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <SelectField bespoke aria-label="Heading" value="" disabled={preview} onChange={(e) => { if (e.target.value) use(e.target.value as Tool); }}>
          <option value="">Heading…</option>
          <option value="heading">Heading</option>
          <option value="subheading">Subheading</option>
          <option value="text">Text</option>
        </SelectField>
        {TOOLS.map((t) => (
          <Button key={t.tool} size="icon-xs" variant="outline" aria-label={t.label} title={t.label} disabled={preview} onClick={() => use(t.tool)}>
            {t.icon ? <Icon name={t.icon} size={13} />
              : <span style={{ fontWeight: t.text === "B" ? 700 : 400, fontStyle: t.text === "I" ? "italic" : "normal" }}>{t.text}</span>}
          </Button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="aug-fs-xs" style={{ color: value.length > BODY_MAX ? "var(--red4)" : "var(--t3)" }}>
          {formatCount(value.length)} / {formatCount(BODY_MAX)}
        </span>
        <Button size="xs" variant={preview ? "secondary" : "outline"} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? "Write" : "Preview"}
        </Button>
      </div>
      {preview ? (
        <div style={{ minHeight: 160 }}><DefinitionBody text={value} /></div>
      ) : (
        <Textarea ref={area} aria-label="What it means" rows={12} value={value} onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: "var(--font-mono)" }} />
      )}
    </div>
  );
}

/** Add a related asset: anything Discover lists, found by its name or what it means. */
function AssetPicker({ connection, have, onPick }: { connection: string; have: DefinitionLink[]; onPick: (l: DefinitionLink) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DiscoverItem[] | null>(null);
  useEffect(() => {
    if (!open || !q.trim()) { setFound(null); return; }
    let alive = true;
    const t = window.setTimeout(() => {
      readDiscoverSearch({ q, connectionId: connection, limit: 8 }).then((r) => { if (alive) setFound(r.items); })
        .catch(() => { if (alive) setFound([]); });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, open, connection]);
  if (!open) {
    return <div><Button size="xs" variant="outline" onClick={() => setOpen(true)}><Icon name="plus" size={12} />Add related asset</Button></div>;
  }
  const taken = (i: DiscoverItem) => have.some((l) => l.kind === i.kind && l.href === i.href);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 640 }} data-testid="asset-picker">
      <Input bespoke autoFocus aria-label="Find a related asset" placeholder="Find a table, metric, dashboard, canvas, agent, document…"
        value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {found?.filter((i) => !taken(i)).map((i) => (
        <Button key={`${i.kind}:${i.id}`} size="xs" variant="ghost" style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "4px 6px" }}
          onClick={() => {
            onPick({ kind: i.kind, ref: i.kind === "metric" ? i.id.split("/").slice(1).join("/") : i.id, label: i.name, href: i.href });
            setQ(""); setOpen(false);
          }}>
          <Icon name={KIND_ICON[i.kind]} size={13} /><span>{i.name}</span>
          <span className="aug-fs-xs" style={MUTED}>{KIND_WORDS[i.kind][0]}{i.connection_name ? ` · ${i.connection_name}` : ""}</span>
        </Button>
      ))}
      {found && !found.length && <span className="aug-fs-xs" style={MUTED}>Nothing found by that name or meaning.</span>}
      <div><Button size="xs" variant="link" onClick={() => setOpen(false)}>Done</Button></div>
    </div>
  );
}

/** Add a source: a web address, or a document of the corpus. */
function SourcePicker({ have, onPick }: { have: DefinitionSource[]; onPick: (s: DefinitionSource) => void }) {
  const [open, setOpen] = useState<"" | "url" | "document">("");
  const [ref, setRef] = useState("");
  const [label, setLabel] = useState("");
  const [docs, setDocs] = useState<DiscoverItem[] | null>(null);
  useEffect(() => {
    if (open !== "document") return;
    let alive = true;
    const t = window.setTimeout(() => {
      readDiscoverItems({ kind: "document", q: ref, limit: 8 }).then((r) => { if (alive) setDocs(r.items); })
        .catch(() => { if (alive) setDocs([]); });
    }, 200);
    return () => { alive = false; window.clearTimeout(t); };
  }, [open, ref]);
  const close = () => { setOpen(""); setRef(""); setLabel(""); };
  if (!open) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="xs" variant="outline" onClick={() => setOpen("url")}><Icon name="plus" size={12} />Add a web address</Button>
        <Button size="xs" variant="outline" onClick={() => setOpen("document")}><Icon name="plus" size={12} />Add a document</Button>
      </div>
    );
  }
  if (open === "url") {
    const ok = /^https?:\/\/\S+$/i.test(ref.trim()) && !have.some((s) => s.ref === ref.trim());
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="source-picker">
        <Input bespoke autoFocus aria-label="Its address" placeholder="https://…" value={ref} onChange={(e) => setRef(e.target.value)} style={{ width: 320 }} />
        <Input bespoke aria-label="Its name" placeholder="Its name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 200 }} />
        <Button size="xs" disabled={!ok} onClick={() => { onPick({ kind: "url", ref: ref.trim(), label: label.trim() }); close(); }}>Add</Button>
        <Button size="xs" variant="link" onClick={close}>Cancel</Button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 640 }} data-testid="source-picker">
      <Input bespoke autoFocus aria-label="Find a document" placeholder="Find a document by its name" value={ref} onChange={(e) => setRef(e.target.value)} />
      {docs?.filter((d) => !have.some((s) => s.kind === "document" && s.ref === d.id)).map((d) => (
        <Button key={d.id} size="xs" variant="ghost" style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "4px 6px" }}
          onClick={() => { onPick({ kind: "document", ref: d.id, label: d.name }); close(); }}>
          <Icon name="folder" size={13} /><span>{d.name}</span>
        </Button>
      ))}
      {docs && !docs.length && <span className="aug-fs-xs" style={MUTED}>No document by that name.</span>}
      <div><Button size="xs" variant="link" onClick={close}>Done</Button></div>
    </div>
  );
}
