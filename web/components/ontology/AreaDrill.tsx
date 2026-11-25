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
import { useEffect, useState } from "react";

import { Chip, MUTED, ROW } from "@/components/clarity/kit";
import { AreaEditor } from "@/components/discover/AreaCuration";
import { PromoteForm } from "@/components/semantic/LearnedPanel";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { Loading, ReadFailed } from "@/components/ui/states";
import { openInApp } from "@/lib/addressOnce";
import { areaIcon } from "@/lib/areaIcons";
import {
  areaTone, curve, itemsOf, KIND_TONE, oneSided, reviewFilters, reviewWord, tint, waitingWords, type AtlasArea, type Disc,
  type Fan, type FanKey,
} from "@/lib/areaMap";
import {
  holdsWords, KIND_WORDS, markOf, ownersLine, readAtlasReview, usageLine, type AtlasReview, type DiscoverArea,
  type DiscoverAreaPage, type DiscoverItem,
} from "@/lib/discover";
import { countNoun, formatCount, relTime } from "@/lib/format";
import { KIND_WORDS as LEARNED_WORDS, readLearned, whereFrom, type LearnedItem, type Promoted } from "@/lib/learned";
import type { TypeMapRow } from "@/lib/objectTypes";

/** A thing open in the right panel. */
export type Opened =
  | { key: string; title: string; what: "area"; area: AreaLike }
  | { key: string; title: string; what: "entity"; row: TypeMapRow; connection: { id: string; name: string } }
  | { key: string; title: string; what: "item"; item: DiscoverItem }
  | { key: string; title: string; what: "learned"; item: LearnedItem; connId: string; connName: string };

/** A learned item, with the connection it was learned on. */
export interface LearnedHere { item: LearnedItem; connId: string; connName: string }

/** A small mark in a kind's colour (the user, 2026-11-25: colour by type). */
function KindDot({ tone }: { tone: string }) {
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0, display: "inline-block" }} />;
}

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

export const areaOpened = (area: AreaLike): Opened => ({ key: `area:${area.id}`, title: area.name, what: "area", area });
export const entityOpened = (row: TypeMapRow, connection: { id: string; name: string }): Opened => ({
  key: `entity:${connection.id}:${row.object_type}`, title: row.display_name, what: "entity", row, connection,
});
export const itemOpened = (item: DiscoverItem): Opened => ({ key: `item:${item.kind}:${item.id}`, title: item.name, what: "item", item });
export const learnedOpened = (l: LearnedHere): Opened => ({
  key: `learned:${l.connId}:${l.item.ref || l.item.text}`, title: l.item.text, what: "learned", ...l,
});

// ── the side panel ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The most review rows drawn at once; the rest are counted. */
const REVIEW_SHOWN = 100;

/** What waits for review in an Area across its connections — its sub-Areas' rolled up — or, "none", in no Area (the
 *  Atlas plan's §3.4, A5): each row in the plan's words, its reason, its weight, and the door to the page it is decided
 *  on, where only a contact or an admin decides, as today. */
export function ReviewList({ area, onBack, backWords = "The Area" }: { area: string; onBack?: () => void; backWords?: string }) {
  const [review, setReview] = useState<AtlasReview | null>(null);
  const [failed, setFailed] = useState("");
  const [only, setOnly] = useState("");
  useEffect(() => {
    readAtlasReview(area).then((r) => { setReview(r); setFailed(""); })
      .catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [area]);
  if (failed) return <span className="aug-fs-sm" style={{ color: "var(--red4)" }}>{`What waits for review could not be read: ${failed}`}</span>;
  if (!review) return <Loading what="what waits for review" />;
  const rows = review.items.filter((r) => !only || reviewWord(r.source, r.kind) === only);
  const at = review.read_at ? new Date(review.read_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <section data-testid="atlas-review-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ ...ROW, gap: 8, justifyContent: "space-between" }}>
        <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>
          {`${countNoun(review.total, "waits", "wait")} for review${area === "none" ? " in no Area" : ""}`}
        </span>
        {onBack && <Button variant="ghost" size="xs" onClick={onBack}>{backWords}</Button>}
      </span>
      <span className="aug-fs-xs" style={MUTED}>
        {[review.within.length ? `with its ${countNoun(review.within.length, "sub-Area")}` : "", "across its connections",
          at && `as read at ${at}`].filter(Boolean).join(" · ")}
      </span>
      {review.total > 0 && (
        <div role="group" aria-label="What kind" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <Button size="xs" variant={only ? "ghost" : "secondary"} aria-pressed={!only} onClick={() => setOnly("")}>All</Button>
          {reviewFilters(review.by_source).map((f) => (
            <Button key={f.word} size="xs" variant={only === f.word ? "secondary" : "ghost"} aria-pressed={only === f.word}
              onClick={() => setOnly(only === f.word ? "" : f.word)}>{`${f.word} ${formatCount(f.count)}`}</Button>
          ))}
        </div>
      )}
      {review.total === 0 && review.said.length === 0 && <span className="aug-fs-sm" style={MUTED}>Nothing waits here.</span>}
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.slice(0, REVIEW_SHOWN).map((r) => {
          const meta = [r.connection_name, r.count != null && (r.source === "framing_miss" || r.source === "unanswered")
            ? `asked ${r.count === 1 ? "once" : `${formatCount(r.count)} times`}` : "",
            r.complaints ? countNoun(r.complaints, "complaint") : "", r.at ? relTime(r.at) : ""].filter(Boolean);
          return (
            <div key={`${r.connection_id}:${r.id}`} role="listitem" data-testid="atlas-review-row"
              style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ ...ROW, gap: 6, alignItems: "flex-start" }}>
                <Chip tone={r.kind === "conflict" ? "amber" : "plain"}>{reviewWord(r.source, r.kind)}</Chip>
                <span className="aug-fs-sm" style={{ color: "var(--t1)", wordBreak: "break-word" }}>{r.title}</span>
              </span>
              {r.detail && (
                <span className="aug-fs-xs" style={{ ...MUTED, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden" }}>{r.detail}</span>
              )}
              <span style={{ ...ROW, gap: 8, justifyContent: "space-between" }}>
                <span className="aug-fs-xs" style={MUTED}>{meta.join(" · ")}</span>
                {r.resolve.href && (
                  <Button size="xs" variant="secondary" onClick={() => openInApp(r.resolve.href as string)}>{r.resolve.action}</Button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {rows.length > REVIEW_SHOWN && (
        <span className="aug-fs-xs" style={MUTED}>{`The first ${REVIEW_SHOWN} of ${formatCount(rows.length)}, the busiest first.`}</span>
      )}
      {review.said.map((s) => <span key={s} className="aug-fs-xs" style={{ color: "var(--amb4)" }}>{s}</span>)}
    </section>
  );
}

function KindList({ fan, items, learned, onOpen, onBack }: {
  fan: Fan; items: DiscoverItem[]; learned: { items: LearnedHere[]; unread: string[] } | null | "failed";
  onOpen: (o: Opened) => void; onBack: () => void;
}) {
  return (
    <section data-testid="atlas-kind-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ ...ROW, gap: 8, justifyContent: "space-between" }}>
        <span className="aug-fs-sm" style={{ ...ROW, gap: 8, color: "var(--t1)", fontWeight: 600 }}><KindDot tone={fan.tone} />{fan.words}</span>
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
              <span style={{ ...ROW, gap: 8, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ paddingTop: 5 }}><KindDot tone={KIND_TONE[i.kind]} /></span>
                <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{i.name}</span>
                  <span className="aug-fs-xs" style={MUTED}>{fan.key === "certified" ? `${kindWord(i.kind)} · ${line}` : line}</span>
                </span>
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
              {learned.items.length < fan.count && (
                <span className="aug-fs-xs" data-testid="atlas-learned-shown" style={{ ...MUTED, padding: "0 8px" }}>
                  {`The first ${formatCount(learned.items.length)} of ${formatCount(fan.count)} — every one is on the Semantic Layer's Learned tab.`}
                </span>
              )}
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
  onPickArea: (a: AreaLike) => void; onBack: () => void; workspaceId?: string; onSaved: () => void;
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
        <IconSquare name={areaIcon(area.icon)} size={32} tone={areaTone(area.id)} />
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
      {kind === "review" ? <ReviewList area={area.id} onBack={() => onKind(null)} /> : chosenFan ? (
        <KindList fan={chosenFan} items={page ? itemsOf(page, chosenFan.key) : []} learned={learned} onOpen={onOpen}
          onBack={() => onKind(null)} />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: "var(--r3)", background: "var(--bg-0)" }}>
            <span className="aug-fs-sm" style={{ color: "var(--t1)" }} data-testid="atlas-area-answers">
              {`${formatCount(area.answers)} answer${area.answers === 1 ? "" : "s"} this month drew on it`}
            </span>
            <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`Holds ${holdsWords(area.counts) || "nothing yet"}`}</span>
            <span style={{ ...ROW, gap: 8, justifyContent: "space-between" }}>
              <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`Waiting: ${waitingWords(area.review, area.learned)}`}</span>
              <Button size="xs" variant="secondary" data-testid="atlas-area-review" onClick={() => onKind("review")}>Review</Button>
            </span>
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
                        <IconSquare name={areaIcon(c.icon)} size={20} tone={areaTone(c.id)} />
                        <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{c.name}</span>
                        <span className="aug-fs-xs" style={MUTED}>{countNoun(c.total, "thing")}</span>
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
                      <span style={{ color: f.tone, lineHeight: 0 }}><Icon name={f.icon} size={14} /></span>
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

/** An Area-like thing a circle stands for: an Area on the map, its parent, a sibling, a sub-Area. */
export type AreaLike = Pick<DiscoverArea, "id" | "name"> & Partial<AtlasArea>;

function Circle({ disc, area, note, chosen = false, faded = false, testId, onClick }: {
  disc: Disc; area: AreaLike; note: string; chosen?: boolean; faded?: boolean; testId: string; onClick: () => void;
}) {
  const d = 2 * disc.r;
  return (
    <Button variant="ghost" data-testid={testId} aria-pressed={chosen} onClick={onClick} title={area.question || area.name}
      style={{ position: "absolute", left: disc.x - disc.r, top: disc.y - disc.r, width: d, height: d, borderRadius: "50%", padding: 6,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, whiteSpace: "normal",
        background: tint(areaTone(area.id), chosen ? 20 : 12), opacity: faded ? 0.5 : 1, color: "var(--t1)",
        boxShadow: chosen ? "0 0 0 2px var(--accent)" : "inset 0 0 0 1px var(--b0)" }}>
      <IconSquare name={areaIcon(area.icon)} size={Math.max(16, Math.min(28, disc.r / 2.6))} tone={areaTone(area.id)} />
      <span className={disc.r >= 52 ? "aug-fs-sm" : "aug-fs-xs"} style={{ fontWeight: 600, lineHeight: 1.15, textAlign: "center" }}>{area.name}</span>
      {note && <span className="aug-fs-xs" style={{ ...MUTED, textAlign: "center" }}>{note}</span>}
    </Button>
  );
}

/** An opened Area, to one side (the user, 2026-11-25, on a reference design: "how everything opens up — on one side
 *  of the bigger circle"): its parent large on the left with the Area among its siblings to its right — the others
 *  faded — or, with no parent, the Area itself large on the left; what it holds stacked to its right, each count a
 *  door, its sub-Areas below them; every line leaves a circle on the same side. A circle clicked opens that Area. */
export function AreaFan({ area, parent, siblings, fan, subAreas, size, zoom, kind, onKind, onPickArea }: {
  area: AtlasArea; parent: AreaLike | null; siblings: AreaLike[]; fan: Fan[]; subAreas: AreaLike[];
  size: { w: number; h: number }; zoom: number; kind: FanKey | null; onKind: (k: FanKey) => void; onPickArea: (a: AreaLike) => void;
}) {
  const sibs = parent ? (siblings.some((s) => s.id === area.id) ? siblings : [area, ...siblings]) : [];
  const chosenAt = parent ? sibs.findIndex((s) => s.id === area.id) : 0;
  const L = oneSided(size.w, size.h, { parent: !!parent, siblings: sibs.length, chosenAt, chips: fan.length, subs: subAreas.length });
  // zoomed about the canvas's middle; type stays its own size
  const zx = (x: number) => size.w / 2 + (x - size.w / 2) * zoom;
  const zy = (y: number) => size.h / 2 + (y - size.h / 2) * zoom;
  const zd = (d: Disc): Disc => ({ x: zx(d.x), y: zy(d.y), r: d.r * zoom });
  const chosen = zd(L.chosen);
  const things = (a: AreaLike) => (a.total === undefined ? "" : countNoun(a.total, "thing"));
  return (
    <div data-testid="atlas-area-fan" style={{ position: "absolute", inset: 0 }}>
      <svg aria-hidden width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {L.parent && L.siblings.map((s, i) => (
          <path key={`p${i}`} d={curve(zd(L.parent!), { x: zx(s.x - s.r), y: zy(s.y) })} fill="none"
            stroke={i === chosenAt ? "var(--t3)" : "var(--b1)"} strokeWidth={1} />
        ))}
        {L.chips.map((c, i) => <path key={`c${i}`} d={curve(chosen, { x: zx(c.x), y: zy(c.y) })} fill="none" stroke={tint(fan[i].tone, 55, "var(--bg-0)")} strokeWidth={1.2} />)}
        {L.subs.map((d, i) => (
          <path key={`s${i}`} d={curve(chosen, { x: zx(d.x - d.r), y: zy(d.y) })} fill="none" stroke="var(--b1)" strokeWidth={1} strokeDasharray="4 4" />
        ))}
      </svg>
      {parent && L.parent && (
        <Circle disc={zd(L.parent)} area={parent} note={things(parent)} faded testId="atlas-fan-parent" onClick={() => onPickArea(parent)} />
      )}
      {parent ? sibs.map((s, i) => i === chosenAt
        ? <Circle key={s.id} disc={chosen} area={area} note={countNoun(area.answers, "answer")} chosen testId="atlas-fan-centre" onClick={() => onPickArea(area)} />
        : <Circle key={s.id} disc={zd(L.siblings[i])} area={s} note={things(s)} faded testId={`atlas-fan-sibling-${s.id}`} onClick={() => onPickArea(s)} />)
        : <Circle disc={chosen} area={area} note={countNoun(area.answers, "answer")} chosen testId="atlas-fan-centre" onClick={() => onPickArea(area)} />}
      {fan.map((f, n) => (
        <Button key={f.key} variant="secondary" size="sm" data-testid={`atlas-fan-${f.key}`} aria-pressed={kind === f.key}
          onClick={() => onKind(f.key)}
          style={{ position: "absolute", left: zx(L.chips[n].x), top: zy(L.chips[n].y) - L.chips[n].h / 2, width: L.chips[n].w,
            height: L.chips[n].h, justifyContent: "flex-start", gap: 8, background: tint(f.tone, 16),
            boxShadow: kind === f.key ? "0 0 0 2px var(--accent)" : undefined }}>
          <span style={{ color: f.tone, lineHeight: 0 }}><Icon name={f.icon} size={14} /></span>
          <span className="aug-fs-sm">{f.words}</span>
        </Button>
      ))}
      {subAreas.map((c, n) => (
        <Circle key={c.id} disc={zd(L.subs[n])} area={c} note={things(c)} testId={`atlas-fan-child-${c.id}`} onClick={() => onPickArea(c)} />
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

/** An Area, opened on the right (the user, 2026-11-25: "panels on the right side with the artefact/circle clicked upon"):
 *  what it is, who answers for it, what it holds, the month's answers that drew on it, what waits in it. */
function AreaCard({ area, connections }: { area: AreaLike; connections: { id: string; name: string }[] }) {
  const on = connections.filter((c) => (area.connections ?? []).includes(c.id)).map((c) => c.name);
  return (
    <div data-testid="atlas-open-area" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ ...ROW, gap: 10 }}>
        <IconSquare name={areaIcon(area.icon)} size={28} tone={areaTone(area.id)} />
        <span className="aug-fs-h2" style={{ color: "var(--t1)", fontWeight: 600 }}>{area.name}</span>
      </span>
      {area.question && <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{area.question}</span>}
      {area.description && <span className="aug-fs-sm" style={{ color: "var(--t1)", whiteSpace: "pre-wrap" }}>{area.description}</span>}
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 10px", alignItems: "baseline" }}>
        <Fact label="Who answers for it" value={area.business_owners || area.technical_owners
          ? ownersLine({ business_owners: area.business_owners ?? [], technical_owners: area.technical_owners ?? [] }) : "not read"} />
        {area.answers !== undefined && <Fact label="This month" value={`${countNoun(area.answers, "answer")} drew on it`} />}
        {area.counts && <Fact label="Holds" value={holdsWords(area.counts) || "nothing yet"} />}
        {area.review !== undefined && <Fact label="Waiting" value={waitingWords(area.review ?? null, area.learned ?? null)} />}
        {on.length > 0 && <Fact label="On" value={on.join(", ")} />}
      </div>
      <Button size="sm" variant="secondary" style={{ alignSelf: "flex-start" }}
        onClick={() => openInApp(`/?view=discover&tab=discover&id=${encodeURIComponent(area.id)}`)}>
        Open its page in Discover <Icon name="external" size={12} />
      </Button>
    </div>
  );
}

/** An entity of an Area, opened on the right: what it is, its key, how many there are, what it reads and links to. */
function EntityCard({ row, connection }: { row: TypeMapRow; connection: { id: string; name: string } }) {
  return (
    <div data-testid="atlas-open-entity" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ ...ROW, gap: 8 }}>
        <Chip tone="plain">Entity</Chip>
        <span className="aug-fs-xs" style={MUTED}>{connection.name}</span>
      </span>
      <span className="aug-fs-h2" style={{ color: "var(--t1)", fontWeight: 600 }}>{row.display_name}</span>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 10px", alignItems: "baseline" }}>
        <Fact label="How many" value={row.rows === null || row.rows === undefined ? "not counted" : formatCount(row.rows)} />
        <Fact label="Its key" value={row.key ? `${row.key}${row.key_verified ? " — proved unique" : row.key_verified === false ? " — not unique" : ""}` : "none yet"} />
        <Fact label="Read from" value={row.table || "—"} />
        <Fact label="Properties" value={formatCount(row.properties ?? 0)} />
        <Fact label="Links" value={`${formatCount(row.links ?? 0)}, ${formatCount(row.traversable_links ?? 0)} followed by answers`} />
        <Fact label="Metrics" value={formatCount(row.metrics ?? 0)} />
        <Fact label="Actions" value={formatCount(row.actions ?? 0)} />
      </div>
      <Button size="sm" variant="secondary" style={{ alignSelf: "flex-start" }}
        onClick={() => openInApp(`/?tab=ontology&conn=${encodeURIComponent(connection.id)}`)}>
        Open {connection.name}&apos;s ontology <Icon name="external" size={12} />
      </Button>
    </div>
  );
}

function ItemCard({ item }: { item: DiscoverItem }) {
  const mark = markOf(item);
  const facts = Object.entries(item.detail ?? {})
    .filter(([, v]) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "")
    .slice(0, 8);
  return (
    <div data-testid="atlas-open-item" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ ...ROW, gap: 8 }}>
        <span style={{ ...ROW, gap: 6 }}><KindDot tone={KIND_TONE[item.kind]} /><Chip tone="plain">{kindWord(item.kind)}</Chip></span>
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
        <span style={{ ...ROW, gap: 6 }}><KindDot tone={KIND_TONE.learned} /><Chip tone="plain">{LEARNED_WORDS[i.kind] ?? i.kind}</Chip></span>
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

export function OpenPanel({ open, active, onActive, onClose, areas, connections = [] }: {
  open: Opened[]; active: string | null; onActive: (key: string) => void; onClose: (key: string) => void;
  areas: { id: string; name: string }[]; connections?: { id: string; name: string }[];
}) {
  const shown = open.find((o) => o.key === active) ?? open[open.length - 1];
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? id;
  return (
    <aside aria-label="What is open" data-testid="atlas-open-panel" style={{ flex: "1 1 340px", maxWidth: 420, minWidth: 0, maxHeight: "100%",
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
      {shown && (shown.what === "area" ? <AreaCard key={shown.key} area={shown.area} connections={connections} />
        : shown.what === "entity" ? <EntityCard key={shown.key} row={shown.row} connection={shown.connection} />
        : shown.what === "item" ? <ItemCard key={shown.key} item={shown.item} />
        : <LearnedCard key={shown.key} o={shown} areas={areas} areaName={areaName} />)}
    </aside>
  );
}
