"use client";

/**
 * Two parts of the Atlas's Overview that were pages of their own until 2026-11-25 (the Atlas-by-Area plan §7, decision
 * 1, "Yes to all three"): the Brain map — every store behind what the platform knows, counted live per connection, with
 * the measured links between them and the facts that changed — and Org, the findings promoted to the organisation, which
 * every deep analysis is handed the five closest of. Nothing of either page is dropped (the inventory is in the plan,
 * §7 "What moves where"): a store that could not be read is a dash with why, never a zero; a route rides a store's
 * hover; a link the side panel cannot draw as an arrow is its sentence, as the Brain map said one it could not draw.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { Chip, Empty, MUTED, NUM, ONE_LINE, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import {
  deleteOrgInsight, getBrainMap, getConnections, getOrgIntelligence, type BrainMap, type Connection, type OrgInsight,
} from "@/lib/api";
import { boxFigure, edgeLines, recentFacts, vaultColumns } from "@/lib/brainMap";
import { agoWords } from "@/lib/canvasList";
import { countNoun, formatCount, formatTimestamp } from "@/lib/format";
import { dayMonth } from "@/lib/home";
import { connectionLabel, keyToWords } from "@/lib/names";
import { localizeCurrency } from "@/lib/orgSettings";

const HEAD: CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
const HATCH = "repeating-linear-gradient(135deg, var(--chart-deemph) 0 4px, transparent 4px 7px)";
/** How many changed facts show before "Show all" — the Brain map listed the server's newest, all of them. */
const FIRST_FACTS = 5;

// ── Where what it knows lives (the Brain map) ─────────────────────────────────────────────

const KIND_WORDS: Record<string, string> = { glossary_term: "column", table: "table", metric: "metric", finding: "finding", domain: "domain" };

/** A fact as a reader names it: a column as `table.column`, a metric in words, anything else by its label. */
function factName(f: ReturnType<typeof recentFacts>[number]): { text: string; mono: boolean } {
  if (f.kind === "glossary_term") return { text: f.id.slice(f.id.indexOf(":") + 1) || f.label, mono: true };
  if (f.kind === "metric") return { text: keyToWords(f.label), mono: false };
  return { text: f.label, mono: false };
}

/** The connection the stores are counted on first: the one the page stands on when the Atlas holds it, else the first. */
export function firstConnection(connections: { id: string }[], standing?: string | null): string {
  return (standing && connections.some((c) => c.id === standing) ? standing : connections[0]?.id) ?? "";
}

export function WhereItLives({ connections, standing, workspaceId }: {
  connections: { id: string; name: string }[];
  /** The connection the page stands on (the bar above), counted first when the Atlas holds it. */
  standing?: string | null;
  workspaceId?: string;
}) {
  const [chosen, setChosen] = useState(() => firstConnection(connections, standing));
  const [read, setRead] = useState<{ of: string; map: BrainMap | null; error: string | null } | null>(null);
  const [reads, setReads] = useState(0);   // Retry bumps it
  const [allFacts, setAllFacts] = useState(false);
  const which = chosen && connections.some((c) => c.id === chosen) ? chosen : firstConnection(connections, standing);

  useEffect(() => {
    if (!which) return undefined;
    let alive = true;
    getBrainMap(which, workspaceId)
      .then((map) => { if (alive) setRead({ of: which, map, error: null }); })
      .catch((e) => { if (alive) setRead({ of: which, map: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [which, workspaceId, reads]);

  const name = connections.find((c) => c.id === which)?.name ?? which;
  const current = read?.of === which ? read : null;
  return (
    <section aria-label="Where what it knows lives" data-testid="atlas-stores" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...HEAD, justifyContent: "space-between" }}>
        <span className="aug-fs-xs" style={MUTED} title="Nothing here is estimated: every store is read now, every link a count.">
          Where what it knows lives
        </span>
        {connections.length > 1 ? (
          <SelectField aria-label="The connection its stores are counted on" value={which}
            onChange={(e) => { setChosen(e.target.value); setAllFacts(false); }} style={{ maxWidth: 170 }}>
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        ) : <span className="aug-fs-xs" style={MUTED}>{name}</span>}
      </div>
      {!which ? <Empty>No connection in view to count.</Empty>
        : current?.error ? (
          <ReadFailed what={`${name}'s stores — no store was changed`} error={current.error} onRetry={() => setReads((n) => n + 1)} />
        ) : !current?.map ? <Loading what={`${name}'s stores`} />
        : <Stores map={current.map} allFacts={allFacts} onAllFacts={() => setAllFacts(true)} />}
    </section>
  );
}

function Stores({ map, allFacts, onAllFacts }: { map: BrainMap; allFacts: boolean; onAllFacts: () => void }) {
  const links = edgeLines(map);
  return (
    <>
      {vaultColumns(map).filter((v) => v.boxes.length > 0).map((v) => (
        <div key={v.id} role="list" aria-label={v.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>{v.title}</span>
          {v.boxes.map((box) => {
            const unread = box.count === null || box.count === undefined;
            return (
              // The route is for a developer: it rides the store's hover, not its face.
              <div key={box.id} role="listitem" data-testid={`atlas-store-${box.id}`} title={box.door}
                style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ ...HEAD, justifyContent: "space-between" }}>
                  <span className="aug-fs-sm" style={{ color: "var(--t1)", ...ONE_LINE }}>{box.title}</span>
                  <span className="aug-fs-sm" title={unread ? "Not read — the line below says why" : `${formatCount(box.count)} ${box.unit}`}
                    style={{ fontWeight: 600, color: unread || box.count === 0 ? "var(--t3)" : "var(--t1)", ...NUM,
                      ...(unread ? { background: HATCH, borderRadius: "var(--r1)", padding: "0 6px" } : {}) }}>
                    {boxFigure(box)}
                  </span>
                </span>
                <span className="aug-fs-xs" style={{ color: unread ? "var(--t2)" : "var(--t3)", lineHeight: 1.4 }}>{box.line}</span>
              </div>
            );
          })}
        </div>
      ))}
      {links.length > 0 && (
        <div role="list" aria-label="Measured links" data-testid="atlas-store-links" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Measured links between them</span>
          {map.edges.map((e, i) => (
            <span key={`${e.from}>${e.to}#${i}`} role="listitem" className="aug-fs-xs"
              style={{ color: e.count ? "var(--t2)" : "var(--t3)", lineHeight: 1.4, ...NUM }}>{links[i]}</span>
          ))}
        </div>
      )}
      <ChangedFacts map={map} all={allFacts} onAll={onAllFacts} />
    </>
  );
}

function ChangedFacts({ map, all, onAll }: { map: BrainMap; all: boolean; onAll: () => void }) {
  const box = map.boxes.find((b) => b.id === "facts");
  const facts = recentFacts(map);
  const changed = typeof box?.detail?.with_history === "number" ? (box.detail.with_history as number) : null;
  const unread = !box || box.count === null || box.count === undefined;
  const shown = all ? facts : facts.slice(0, FIRST_FACTS);
  return (
    <div aria-label="Facts that changed" data-testid="atlas-changed-facts" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...HEAD, justifyContent: "space-between" }}>
        <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Facts that changed, and what each replaced</span>
        {facts.length > 0 && (
          <span className="aug-fs-xs" style={{ ...MUTED, ...NUM }}>
            {changed != null && changed > facts.length ? `newest ${formatCount(facts.length)} of ${formatCount(changed)}` : formatCount(facts.length)}
          </span>
        )}
      </span>
      {unread ? (
        <span className="aug-fs-xs" style={{ color: "var(--t2)" }}>{`Fact history not read — ${box?.line || "the facts store is not counted here"}`}</span>
      ) : facts.length === 0 ? (
        <span className="aug-fs-xs" style={MUTED}>No fact has changed since it was first seen.</span>
      ) : shown.map((f, i) => {
        const fname = factName(f);
        return (
          <div key={f.id} data-testid={`atlas-fact-${f.id}`} title={f.id}
            style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "4px 0", ...(i ? RULE : {}) }}>
            <div style={{ minWidth: 0 }}>
              <div className="aug-fs-sm" style={{ ...HEAD }}>
                <span style={{ color: "var(--t1)", ...ONE_LINE, ...(fname.mono ? { fontFamily: "var(--font-mono)" } : {}) }}>{fname.text}</span>
                <span className="aug-fs-xs" style={MUTED}>{KIND_WORDS[f.kind] ?? keyToWords(f.kind)}</span>
                {f.reason && f.reason !== "changed" && <Chip>{f.reason}</Chip>}
              </div>
              <div className="aug-fs-xs" title={f.replaced || undefined}
                style={{ ...MUTED, ...ONE_LINE, fontFamily: f.replaced ? "var(--font-mono)" : undefined }}>
                {f.replaced ? `was ${f.replaced}` : "what it replaced was not kept"}
              </div>
            </div>
            <span className="aug-fs-xs" title={formatTimestamp(f.changed)} style={{ color: "var(--t2)", ...NUM }}>
              {f.changed ? dayMonth(f.changed) : "—"}
            </span>
          </div>
        );
      })}
      {!all && facts.length > FIRST_FACTS && (
        <Button variant="ghost" size="xs" onClick={onAll} style={{ alignSelf: "flex-start" }}>
          {`Show all ${formatCount(facts.length)}`}
        </Button>
      )}
    </div>
  );
}

// ── Promoted to the organisation (Org) ────────────────────────────────────────────────────

/** The connection a finding was promoted from — read off the canvas key a Briefing's promotion writes when an older
 *  record carries no connection; "" for one promoted from a Data Canvas. */
function sourceOf(f: OrgInsight): string {
  if (f.connection_id) return f.connection_id;
  return f.canvas_id?.startsWith("conn:") ? f.canvas_id.slice(5) : "";
}

/** Prose the platform wrote, as a line: no markdown emphasis (nothing renders it here), the org's currency. */
const plain = (text: string) => localizeCurrency(text).replace(/\*+/g, "");

const domainOf = (f: OrgInsight) => f.domain?.trim() || "General";

export function PromotedFindings() {
  const [tick, setTick] = useState(0);
  const [read, setRead] = useState<{ tick: number; found: OrgInsight[] | null; error: string | null } | null>(null);
  const [conns, setConns] = useState<Connection[]>([]);
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOrgIntelligence()
      .then((found) => { if (alive) setRead({ tick, found, error: null }); })
      // a refresh that fails keeps what was read, and says it was not refreshed
      .catch((e) => { if (alive) setRead((prev) => ({ tick, found: prev?.found ?? null, error: String((e as Error)?.message || e) })); });
    return () => { alive = false; };
  }, [tick]);
  // A finding names its connection, never its id; a list that cannot be read leaves the id standing.
  useEffect(() => { getConnections().then(setConns).catch(() => setConns([])); }, []);

  const all = read?.found ?? null;
  const refreshing = read?.tick !== tick;
  const query = search.trim().toLowerCase();
  const domains = useMemo(() => {
    const shown = (all ?? []).filter((f) => !query || [f.text, f.domain, f.angle].some((v) => (v || "").toLowerCase().includes(query)));
    const by = new Map<string, OrgInsight[]>();
    for (const f of [...shown].sort((a, b) => (b.promoted_at || "").localeCompare(a.promoted_at || ""))) {
      by.set(domainOf(f), [...(by.get(domainOf(f)) ?? []), f]);
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b));
  }, [all, query]);
  const matched = domains.reduce((n, [, rows]) => n + rows.length, 0);
  // Said once: when every finding came from one connection, the sentence names it and no line repeats it.
  const sources = [...new Set((all ?? []).map(sourceOf))];
  const oneSource = sources.length === 1 ? sources[0] : null;

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await deleteOrgInsight(id);
      setRead((r) => (r ? { ...r, found: r.found?.filter((f) => f.id !== id) ?? null } : r));
    } catch (e) {
      // It stays listed: the server still holds it.
      toast.error("Not removed — it is still promoted", { description: String((e as Error)?.message || e).slice(0, 240) });
    } finally {
      setRemoving(null);
    }
  };

  const lead = !all || all.length === 0 ? "Findings promoted from a connection's Briefing."
    : oneSource ? `Findings promoted from ${connectionLabel(oneSource, conns)}'s Briefing.`
    : oneSource === "" ? "Findings promoted from a Data Canvas." : "Findings promoted from a connection's Briefing or a Data Canvas.";

  return (
    <section aria-label="Promoted to the organisation" data-testid="atlas-promoted" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ ...HEAD, justifyContent: "space-between" }}>
        <span className="aug-fs-xs" style={MUTED}>{`Promoted to the organisation${all && all.length ? ` · ${formatCount(all.length)}` : ""}`}</span>
        <Button variant="ghost" size="xs" disabled={refreshing && read !== null} onClick={() => setTick((t) => t + 1)}>Refresh</Button>
      </span>
      <span className="aug-fs-xs" style={{ color: "var(--t2)", lineHeight: 1.45 }}>
        {`${lead} Every deep analysis is handed the five closest to its question.`}
      </span>
      {read?.error && all && (
        <span className="aug-fs-xs" style={ROW}><Chip tone="amber" title={read.error}>not refreshed — showing the last read</Chip></span>
      )}
      {all === null ? (
        read?.error ? <ReadFailed what="the promoted findings" error={read.error} onRetry={() => setTick((t) => t + 1)} />
          : <Loading what="the promoted findings" />
      ) : all.length === 0 ? (
        <div data-testid="atlas-promoted-empty" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="aug-fs-sm" style={{ ...ROW, color: "var(--t1)" }}>
            Nothing promoted yet
            <Chip title="The store answers an empty list when it cannot be read, so an outage looks the same as nothing promoted">
              or its store could not be read
            </Chip>
          </span>
          <span className="aug-fs-xs" style={MUTED}>On a connection&apos;s Briefing, open a finding&apos;s ⋯ menu and choose Promote.</span>
        </div>
      ) : (
        <>
          <span style={{ ...HEAD }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter findings"
              aria-label="Filter promoted findings" style={{ flex: 1, minWidth: 0 }} />
            {query && <span className="aug-fs-xs" style={{ ...MUTED, ...NUM }}>{`${formatCount(matched)} of ${formatCount(all.length)}`}</span>}
          </span>
          {domains.length === 0 ? <Empty>{`No promoted finding matches “${search.trim()}”.`}</Empty> : domains.map(([domain, rows]) => (
            <div key={domain} role="group" aria-label={domain} data-testid="atlas-promoted-domain"
              style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, ...RULE }}>
              <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>
                {domain} <span className="aug-fs-xs" style={{ ...MUTED, fontWeight: 400 }}>{countNoun(rows.length, "finding")}</span>
              </span>
              {rows.map((f) => {
                const src = sourceOf(f);
                const facts: { text: string; title?: string }[] = [
                  { text: f.angle },
                  { text: oneSource === null ? `from ${src ? connectionLabel(src, conns) : "a Data Canvas"}` : "" },
                  { text: `promoted ${agoWords(f.promoted_at, Date.now())}${f.promoted_by && f.promoted_by !== "user" ? ` by ${f.promoted_by}` : ""}`,
                    title: formatTimestamp(f.promoted_at) },
                  { text: f.novelty != null ? `novelty ${f.novelty} of 5` : "",
                    title: "How new the finding was against its domain's other findings when it was found, 1 to 5" },
                ].filter((x) => x.text);
                return (
                  <div key={f.id} data-testid="atlas-promoted-finding" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className="aug-fs-sm" style={{ color: "var(--t1)", lineHeight: 1.5 }}>{plain(f.text)}</span>
                    <span className="aug-fs-xs" style={{ ...MUTED, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <span style={{ minWidth: 0 }}>{facts.map((x, i) => <span key={i} title={x.title}>{i ? " · " : ""}{x.text}</span>)}</span>
                      <Button variant="ghost" size="xs" disabled={removing === f.id} onClick={() => { void remove(f.id); }}
                        title="Take this finding out of the organisation's — no deep analysis is handed it again">
                        {removing === f.id ? "Removing…" : "Remove"}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
