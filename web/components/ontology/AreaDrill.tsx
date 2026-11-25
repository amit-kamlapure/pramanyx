"use client";

/**
 * An Area, opened on the Atlas (2026-11-25, the Atlas-by-Area plan's A4b — `docs/AREA_MAP_PLAN_2026-11-25.md` §3.2–3.3).
 * The canvas centres it and fans it out by kind, each with its count — what people defined and certified first, then
 * what was learned in it and the rest — its sub-Areas around them; each count is a door. The side panel becomes the
 * Area's: its glyph and name, who answers for it (its curators change them here), its month, its sub-Areas, what it
 * holds; a count opened lists that kind, the most used first, each with its state and its connection. Opening a thing
 * adds a tab to the right panel — several stay open side by side: a metric, a table, a dashboard, a Definition, a
 * learned item with where it came from, why it stands where it does, and Promote.
 */
import { useState } from "react";

import { Chip, MUTED, ROW } from "@/components/clarity/kit";
import { AreaEditor } from "@/components/discover/AreaCuration";
import { PromoteForm } from "@/components/semantic/LearnedPanel";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { Loading, ReadFailed } from "@/components/ui/states";
import { openInApp } from "@/lib/addressOnce";
import { areaIcon } from "@/lib/areaIcons";
import { itemsOf, ring, waitingWords, type AtlasArea, type Fan, type FanKey } from "@/lib/areaMap";
import {
  holdsWords, KIND_WORDS, markOf, ownersLine, usageLine, type DiscoverArea, type DiscoverAreaPage, type DiscoverItem,
} from "@/lib/discover";
import { formatCount, relTime } from "@/lib/format";
import { KIND_WORDS as LEARNED_WORDS, readLearned, whereFrom, type LearnedItem, type Promoted } from "@/lib/learned";

/** A thing open in the right panel. */
export type Opened =
  | { key: string; title: string; what: "item"; item: DiscoverItem }
  | { key: string; title: string; what: "learned"; item: LearnedItem; connId: string; connName: string };

/** A learned item, with the connection it was learned on. */
export interface LearnedHere { item: LearnedItem; connId: string; connName: string }

/** A kind's name for one, as a line starts with it: "Table", "Data Canvas". */
const kindWord = (k: DiscoverItem["kind"]) => KIND_WORDS[k][0].replace(/^./, (c) => c.toUpperCase());

/** The most things kept open side by side; opening one more closes the oldest. */
export const MAX_OPEN = 6;

/** What was learned in an Area, on every connection it spans — each connection's list narrowed to the Area, in the one
 *  standing's order within each; a connection whose list could not be read is named, never taken for none. */
export async function readLearnedIn(area: string, connections: { id: string; name: string }[]):
  Promise<{ items: LearnedHere[]; unread: string[] }> {
  const read = await Promise.allSettled(connections.map((c) => readLearned(c.id, { area, limit: 200 })));
  const items: LearnedHere[] = [];
  const unread: string[] = [];
  read.forEach((r, n) => {
    const c = connections[n];
    if (r.status === "fulfilled") items.push(...r.value.items.map((item) => ({ item, connId: c.id, connName: c.name })));
    else unread.push(c.name);
  });
  return { items, unread };
}

/** Add a thing to what is open (or bring it forward), the oldest closed past {@link MAX_OPEN}. */
export function withOpened(open: Opened[], o: Opened): Opened[] {
  if (open.some((x) => x.key === o.key)) return open;
  return [...open, o].slice(-MAX_OPEN);
}

export const itemOpened = (item: DiscoverItem): Opened => ({ key: `item:${item.kind}:${item.id}`, title: item.name, what: "item", item });
export const learnedOpened = (l: LearnedHere): Opened => ({
  key: `learned:${l.connId}:${l.item.ref || l.item.text}`, title: l.item.text, what: "learned", ...l,
});

// ── the side panel ──────────────────────────────────────────────────────────────────────────────────────────────────

function KindList({ fan, items, learned, onOpen, onBack }: {
  fan: Fan; items: DiscoverItem[]; learned: { items: LearnedHere[]; unread: string[] } | null | "failed";
  onOpen: (o: Opened) => void; onBack: () => void;
}) {
  return (
    <section data-testid="atlas-kind-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ ...ROW, gap: 8, justifyContent: "space-between" }}>
        <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>{fan.words}</span>
        <Button variant="ghost" size="xs" onClick={onBack}>The Area</Button>
      </span>
      <span className="aug-fs-xs" style={MUTED}>
        {fan.key === "learned" ? "In the one standing's order: a person's word on what a run measured first"
          : "The most used this month first"}
      </span>
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -8px" }}>
        {fan.key !== "learned" && items.map((i) => {
          const mark = markOf(i);
          const line = [mark?.word, i.connection_name, usageLine(i.use) || "not used this month"].filter(Boolean).join(" · ");
          return (
            <Button key={`${i.kind}:${i.id}`} role="listitem" variant="ghost" size="sm" data-testid="atlas-kind-row"
              onClick={() => onOpen(itemOpened(i))}
              style={{ justifyContent: "flex-start", height: "auto", padding: "6px 8px", textAlign: "left", whiteSpace: "normal" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{i.name}</span>
                <span className="aug-fs-xs" style={MUTED}>{fan.key === "certified" ? `${kindWord(i.kind)} · ${line}` : line}</span>
              </span>
            </Button>
          );
        })}
        {fan.key === "learned" && (learned === null ? <Loading what="what was learned here" />
          : learned === "failed" ? <span className="aug-fs-sm" style={{ color: "var(--red4)" }}>What was learned here could not be read.</span>
          : (
            <>
              {learned.items.map((l) => (
                <Button key={`${l.connId}:${l.item.ref}:${l.item.text}`} role="listitem" variant="ghost" size="sm"
                  data-testid="atlas-learned-row" onClick={() => onOpen(learnedOpened(l))}
                  style={{ justifyContent: "flex-start", height: "auto", padding: "6px 8px", textAlign: "left", whiteSpace: "normal" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <span className="aug-fs-sm" style={{ color: "var(--t1)", display: "-webkit-box", WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical", overflow: "hidden" }}>{l.item.text}</span>
                    <span className="aug-fs-xs" style={MUTED}>{[LEARNED_WORDS[l.item.kind] ?? l.item.kind, l.connName].join(" · ")}</span>
                  </span>
                </Button>
              ))}
              {learned.unread.length > 0 && (
                <span className="aug-fs-xs" style={{ color: "var(--amb4)", padding: "0 8px" }}>{`Not read: what was learned on ${learned.unread.join(", ")}.`}</span>
              )}
            </>
          ))}
      </div>
    </section>
  );
}

export function AreaRail({ area, page, pageFailed, onRetry, connections, fan, kind, onKind, learned, onOpen, onPickArea,
  onBack, workspaceId, onSaved }: {
  area: AtlasArea; page: DiscoverAreaPage | null; pageFailed: string; onRetry: () => void;
  connections: { id: string; name: string }[]; fan: Fan[]; kind: FanKey | null; onKind: (k: FanKey | null) => void;
  learned: { items: LearnedHere[]; unread: string[] } | null | "failed"; onOpen: (o: Opened) => void;
  onPickArea: (a: DiscoverArea) => void; onBack: () => void; workspaceId?: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const chosenFan = kind ? fan.find((f) => f.key === kind) ?? null : null;
  const on = connections.filter((c) => area.connections.includes(c.id)).map((c) => c.name);
  return (
    <div data-testid="atlas-area-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Button variant="ghost" size="xs" onClick={onBack} style={{ alignSelf: "flex-start" }}>
        <Icon name="chevl" size={12} /> All Areas
      </Button>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <IconSquare name={areaIcon(area.icon)} size={32} />
        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span className="aug-fs-h1" style={{ color: "var(--t1)", fontWeight: 600 }}>{area.name}</span>
          {area.question && <span className="aug-fs-sm" style={MUTED}>{area.question}</span>}
        </span>
      </span>
      {editing && page ? (
        <AreaEditor page={page} workspaceId={workspaceId} onSaved={() => { setEditing(false); onSaved(); }} onCancel={() => setEditing(false)} />
      ) : (
        <span style={{ ...ROW, gap: 8, justifyContent: "space-between" }}>
          <span className="aug-fs-sm" data-testid="atlas-area-contacts"
            style={{ color: area.business_owners.length || area.technical_owners.length ? "var(--t2)" : "var(--amb4)" }}>
            {ownersLine(area)}
          </span>
          {page?.can_curate && <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
        </span>
      )}
      {chosenFan ? (
        <KindList fan={chosenFan} items={page ? itemsOf(page, chosenFan.key) : []} learned={learned} onOpen={onOpen}
          onBack={() => onKind(null)} />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: "var(--r3)", background: "var(--bg-0)" }}>
            <span className="aug-fs-sm" style={{ color: "var(--t1)" }} data-testid="atlas-area-answers">
              {`${formatCount(area.answers)} answer${area.answers === 1 ? "" : "s"} this month drew on it`}
            </span>
            <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`Holds ${holdsWords(area.counts) || "nothing yet"}`}</span>
            <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`Waiting: ${waitingWords(area.review, area.learned)}`}</span>
            {on.length > 0 && <span className="aug-fs-xs" style={MUTED}>{`On ${on.join(", ")}`}</span>}
          </div>
          {pageFailed ? <ReadFailed what="the Area" error={pageFailed} onRetry={onRetry} />
            : !page ? <Loading what="what the Area holds" /> : (
              <>
                {page.children.length > 0 && (
                  <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="aug-fs-xs" style={MUTED}>Inside it</span>
                    {page.children.map((c) => (
                      <Button key={c.id} variant="ghost" size="sm" onClick={() => onPickArea(c)}
                        style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "4px 8px", margin: "0 -8px" }}>
                        <IconSquare name={areaIcon(c.icon)} size={20} />
                        <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{c.name}</span>
                        <span className="aug-fs-xs" style={MUTED}>{`${formatCount(c.total)} things`}</span>
                      </Button>
                    ))}
                  </section>
                )}
                <section style={{ display: "flex", flexDirection: "column", gap: 4 }} aria-label="What it holds">
                  <span className="aug-fs-xs" style={MUTED}>What it holds</span>
                  {fan.length === 0 && <span className="aug-fs-sm" style={MUTED}>Nothing placed in it yet.</span>}
                  {fan.map((f) => (
                    <Button key={f.key} variant="ghost" size="sm" data-testid={`atlas-fan-row-${f.key}`} onClick={() => onKind(f.key)}
                      style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "4px 8px", margin: "0 -8px" }}>
                      <Icon name={f.icon} size={14} />
                      <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{f.words}</span>
                    </Button>
                  ))}
                </section>
                {page.said.length > 0 && <span className="aug-fs-xs" style={MUTED}>{page.said.join(" ")}</span>}
              </>
            )}
          <a href={`/?view=discover&tab=discover&id=${encodeURIComponent(area.id)}`} className="aug-fs-sm">Open its page in Discover</a>
        </>
      )}
    </div>
  );
}

// ── the canvas ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Area at the middle, its kinds around it, its sub-Areas further out — each a door. */
export function AreaFan({ area, fan, subAreas, size, zoom, kind, onKind, onPickArea }: {
  area: AtlasArea; fan: Fan[]; subAreas: DiscoverArea[]; size: { w: number; h: number }; zoom: number;
  kind: FanKey | null; onKind: (k: FanKey) => void; onPickArea: (a: DiscoverArea) => void;
}) {
  const cx = size.w / 2;
  const cy = size.h / 2;
  const unit = Math.max(0.55, Math.min(1.2, Math.min(size.w / 900, size.h / 640))) * zoom;
  const centre = 64 * unit;
  const kinds = ring(fan.length, (centre + 120) * unit);
  const outer = ring(subAreas.length, (centre + 250) * unit);
  return (
    <div data-testid="atlas-area-fan" style={{ position: "absolute", inset: 0 }}>
      <svg aria-hidden width={size.w} height={size.h} style={{ position: "absolute", inset: 0 }}>
        {[...kinds, ...outer].map((p, n) => (
          <line key={n} x1={cx} y1={cy} x2={cx + p.x} y2={cy + p.y} stroke="var(--b1)" strokeWidth={1}
            strokeDasharray={n >= kinds.length ? "4 4" : undefined} />
        ))}
      </svg>
      <span data-testid="atlas-fan-centre" style={{ position: "absolute", left: cx - centre, top: cy - centre, width: 2 * centre,
        height: 2 * centre, borderRadius: "50%", background: "var(--bg-2)", boxShadow: "0 0 0 2px var(--accent)", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center", padding: 6, boxSizing: "border-box" }}>
        <IconSquare name={areaIcon(area.icon)} size={28} />
        <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600, lineHeight: 1.15 }}>{area.name}</span>
        <span className="aug-fs-xs" style={MUTED}>{`${formatCount(area.answers)} answers`}</span>
      </span>
      {fan.map((f, n) => (
        <Button key={f.key} variant="secondary" size="sm" data-testid={`atlas-fan-${f.key}`} aria-pressed={kind === f.key}
          onClick={() => onKind(f.key)}
          style={{ position: "absolute", left: cx + kinds[n].x, top: cy + kinds[n].y, transform: "translate(-50%, -50%)", gap: 6,
            boxShadow: kind === f.key ? "0 0 0 2px var(--accent)" : undefined }}>
          <Icon name={f.icon} size={13} />
          <span className="aug-fs-sm">{f.words}</span>
        </Button>
      ))}
      {subAreas.map((c, n) => (
        <Button key={c.id} variant="ghost" data-testid={`atlas-fan-child-${c.id}`} onClick={() => onPickArea(c)}
          style={{ position: "absolute", left: cx + outer[n].x, top: cy + outer[n].y, transform: "translate(-50%, -50%)",
            width: 96 * unit, height: 96 * unit, borderRadius: "50%", background: "var(--bg-2)", boxShadow: "inset 0 0 0 1px var(--b0)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: 4, whiteSpace: "normal" }}>
          <IconSquare name={areaIcon(c.icon)} size={18} />
          <span className="aug-fs-xs" style={{ color: "var(--t1)", fontWeight: 600, textAlign: "center", lineHeight: 1.15 }}>{c.name}</span>
          <span className="aug-fs-xs" style={MUTED}>{`${formatCount(c.total)} things`}</span>
        </Button>
      ))}
    </div>
  );
}

// ── the right panel ─────────────────────────────────────────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="aug-fs-xs" style={MUTED}>{label}</span>
      <span className="aug-fs-sm" style={{ color: "var(--t1)", wordBreak: "break-word" }}>{value}</span>
    </>
  );
}

const plainKey = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function ItemCard({ item }: { item: DiscoverItem }) {
  const mark = markOf(item);
  const facts = Object.entries(item.detail ?? {})
    .filter(([, v]) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "")
    .slice(0, 8);
  return (
    <div data-testid="atlas-open-item" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ ...ROW, gap: 8 }}>
        <Chip tone="plain">{kindWord(item.kind)}</Chip>
        {mark && <Chip tone={mark.tone === "up" ? "up" : mark.tone === "amber" ? "amber" : "plain"}>{mark.word}</Chip>}
      </span>
      <span className="aug-fs-h2" style={{ color: "var(--t1)", fontWeight: 600, wordBreak: "break-word" }}>{item.name}</span>
      {item.line && <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{item.line}</span>}
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 10px", alignItems: "baseline" }}>
        <Fact label="Used this month" value={usageLine(item.use) || (item.use === undefined ? "not measured for this kind" : "not used this month")} />
        {item.connection_name && <Fact label="Connection" value={item.connection_name} />}
        {item.area_how && <Fact label="In this Area" value={item.area_how} />}
        {item.owner && <Fact label="Owner" value={item.owner} />}
        {item.updated_at && <Fact label="Updated" value={relTime(item.updated_at)} />}
        {item.certification?.status && (
          <Fact label="Certification" value={[item.certification.status, item.certification.by && `by ${item.certification.by}`,
            item.certification.why].filter(Boolean).join(" · ")} />
        )}
        {facts.map(([k, v]) => <Fact key={k} label={plainKey(k)} value={String(v)} />)}
      </div>
      {item.href && (
        <Button size="sm" variant="secondary" style={{ alignSelf: "flex-start" }} onClick={() => openInApp(item.href)}>
          Open its page <Icon name="external" size={12} />
        </Button>
      )}
    </div>
  );
}

function LearnedCard({ o, areas, areaName }: {
  o: Extract<Opened, { what: "learned" }>; areas: { id: string; name: string }[]; areaName: (id: string) => string;
}) {
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState<Promoted | null>(null);
  const i = o.item;
  return (
    <div data-testid="atlas-open-learned" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ ...ROW, gap: 8 }}>
        <Chip tone="plain">{LEARNED_WORDS[i.kind] ?? i.kind}</Chip>
        <span className="aug-fs-xs" style={MUTED}>{o.connName}</span>
      </span>
      <span className="aug-fs-chrome" style={{ color: "var(--t1)", wordBreak: "break-word" }}>{i.text}</span>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 10px", alignItems: "baseline" }}>
        <Fact label="Where it stands" value={i.why} />
        <Fact label="Where it came from" value={whereFrom(i)} />
        <Fact label="What it read" value={i.tables.length ? i.tables.join(", ") : "names no table"} />
        <Fact label="Its Area" value={i.area ? areaName(i.area) : "in no Area"} />
        <Fact label="Used in answers" value={i.uses == null ? "not counted yet" : formatCount(i.uses)} />
        {i.times > 1 && <Fact label="Said" value={`${i.times} times`} />}
      </div>
      {promoted ? (
        <span className="aug-fs-sm" data-testid="atlas-promoted" style={{ color: "var(--t2)" }}>
          {promoted.suggested ? `“${promoted.term}” is already defined — filed as a suggested edit for its owner. `
            : `Drafted as “${promoted.term}”. `}
          <Button size="xs" variant="ghost" onClick={() => openInApp(promoted.href)}>Open it</Button>
        </span>
      ) : i.kind !== "trusted_query" && (
        promoting ? (
          <PromoteForm connId={o.connId} item={i} areas={areas} onDone={(p) => { setPromoted(p); setPromoting(false); }}
            onCancel={() => setPromoting(false)} />
        ) : (
          <Button size="sm" variant="secondary" style={{ alignSelf: "flex-start" }} onClick={() => setPromoting(true)}>
            Promote to a Definition
          </Button>
        )
      )}
    </div>
  );
}

export function OpenPanel({ open, active, onActive, onClose, areas }: {
  open: Opened[]; active: string | null; onActive: (key: string) => void; onClose: (key: string) => void;
  areas: { id: string; name: string }[];
}) {
  const shown = open.find((o) => o.key === active) ?? open[open.length - 1];
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? id;
  return (
    <aside aria-label="What is open" data-testid="atlas-open-panel" style={{ flex: "1 1 340px", maxWidth: 420, minWidth: 0,
      background: "var(--bg-2)", padding: "10px 16px 20px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto",
      boxSizing: "border-box" }}>
      <div role="tablist" aria-label="Open things" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {open.map((o) => (
          <span key={o.key} style={{ ...ROW, gap: 0, borderRadius: "var(--r2)", background: o.key === shown?.key ? "var(--bg-0)" : undefined }}>
            <Button role="tab" aria-selected={o.key === shown?.key} variant="ghost" size="xs" onClick={() => onActive(o.key)}
              title={o.title} style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
              {o.title}
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Close ${o.title}`} onClick={() => onClose(o.key)}>
              <Icon name="close" size={11} />
            </Button>
          </span>
        ))}
      </div>
      {shown && (shown.what === "item" ? <ItemCard key={shown.key} item={shown.item} />
        : <LearnedCard key={shown.key} o={shown} areas={areas} areaName={areaName} />)}
    </aside>
  );
}
