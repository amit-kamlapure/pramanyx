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
import { DropdownMenu } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";

import { Chip, Empty, MUTED, ROW } from "@/components/clarity/kit";
import { AreaEditor } from "@/components/discover/AreaCuration";
import { inPlace, ItemRow, Said } from "@/components/discover/parts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { Loading, ReadFailed } from "@/components/ui/states";
import { openInApp } from "@/lib/addressOnce";
import { areaIcon } from "@/lib/areaIcons";
import {
  areaTone, curve, KIND_TONE, oneSided, reviewFilters, reviewWord, tint, waitingWords, type AtlasArea, type Disc,
  type Fan, type FanKey,
} from "@/lib/areaMap";
import {
  holdsWords, KIND_TITLES, ownersLine, readAtlasReview, readDiscoverItems, readDiscoverSearch,
  type AtlasReview, type DiscoverArea,
  type DiscoverAreaPage, type DiscoverItem,
} from "@/lib/discover";
import { countNoun, formatCount, relTime } from "@/lib/format";
import { KIND_WORDS as LEARNED_WORDS, readLearned, type LearnedItem } from "@/lib/learned";
import type { TypeMapRow } from "@/lib/objectTypes";

/** A thing open in the right panel. */
export type Opened =
  | { key: string; title: string; what: "area"; area: AreaLike }
  | { key: string; title: string; what: "entity"; row: TypeMapRow; connection: { id: string; name: string } }
  | { key: string; title: string; what: "item"; item: DiscoverItem }
  | { key: string; title: string; what: "learned"; item: LearnedItem; connId: string; connName: string };

/** A learned item, with the connection it was learned on. */
export interface LearnedHere { item: LearnedItem; connId: string; connName: string }

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

/** How many things a kind's list shows a page at a time (the reference pages a long list; it never scrolls forever). */
export const PER_PAGE = 20;
type Order = "use" | "name" | "recent";
const ORDER_WORDS: Record<Order, string> = { use: "Most used", name: "Name", recent: "Recently changed" };

/** The pages of a long list: the first, the last, the one shown and its neighbours, "…" between. */
export function pagesShown(at: number, pages: number): (number | "gap")[] {
  const want = new Set([0, pages - 1, at - 1, at, at + 1].filter((n) => n >= 0 && n < pages));
  const out: (number | "gap")[] = [];
  [...want].sort((x, y) => x - y).forEach((n, k, all) => { if (k && n - all[k - 1] > 1) out.push("gap"); out.push(n); });
  return out;
}

function Pager({ at, total, onAt }: { at: number; total: number; onAt: (n: number) => void }) {
  const pages = Math.ceil(total / PER_PAGE);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" style={{ ...ROW, gap: 2, justifyContent: "center", paddingTop: 4 }}>
      <Button variant="ghost" size="icon-xs" aria-label="The page before" disabled={at === 0} onClick={() => onAt(at - 1)}>
        <Icon name="chevl" size={12} />
      </Button>
      {pagesShown(at, pages).map((n, k) => (n === "gap"
        ? <span key={`gap${k}`} className="aug-fs-xs" style={MUTED}>…</span>
        : (
          <Button key={n} variant={n === at ? "secondary" : "ghost"} size="xs" aria-current={n === at ? "page" : undefined}
            aria-label={`Page ${n + 1}`} onClick={() => onAt(n)}>{n + 1}</Button>
        )))}
      <Button variant="ghost" size="icon-xs" aria-label="The page after" disabled={at >= pages - 1} onClick={() => onAt(at + 1)}>
        <Icon name="chevr" size={12} />
      </Button>
    </nav>
  );
}

/** Something learned, as Discover draws a row (the user, 2026-11-26: Discover's design followed in the Ontology): its
 *  glyph, what it says on one line, what kind of learned thing it is and where on the next; a click opens it beside the
 *  list, ⌘-click the Semantic Layer's Learned tab. */
function LearnedRow({ l, onOpen }: { l: LearnedHere; onOpen: (o: Opened) => void }) {
  const href = `/?tab=semantic&semtab=learned&conn=${encodeURIComponent(l.connId)}`;
  return (
    <div className="aug-discover-row" data-testid="atlas-learned-row">
      <a href={href} title={l.item.text} onClick={(e) => inPlace(e, () => onOpen(learnedOpened(l)))}>
        <span className="k" style={{ color: KIND_TONE.learned }}><Icon name="memory" size={15} /></span>
        <span className="main">
          <span className="n aug-fs-chrome">{l.item.text}</span>
          <span className="d aug-fs-sm">{[LEARNED_WORDS[l.item.kind] ?? l.item.kind, l.connName, l.item.standing_said].filter(Boolean).join(" · ")}</span>
        </span>
      </a>
    </div>
  );
}

/** A kind of what an Area holds, listed on the left as the reference lists an Area's pages: how many, in which order
 *  (Most used, by name, recently changed), a page at a time; a thing clicked opens on the right. Read from the server a
 *  page at a time — an Area's page carries only the first few of each kind. */
function KindList({ area, fan, learned, onOpen, workspaceId, many }: {
  area: string; fan: Fan; learned: { items: LearnedHere[]; unread: string[] } | null | "failed";
  onOpen: (o: Opened) => void; workspaceId?: string;
  /** The Area spans more than one connection: each row names its own. */
  many: boolean;
}) {
  const [order, setOrder] = useState<Order>("use");
  const [at, setAt] = useState(0);
  const asked = `${area}|${fan.key}|${order}|${at}`;
  const [got, setGot] = useState<{ asked: string; items: DiscoverItem[]; total: number } | { asked: string; failed: string } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (fan.key === "learned") return undefined;
    let live = true;
    readDiscoverItems({ kind: fan.key === "certified" ? "" : fan.key, area, certified: fan.key === "certified", sort: order,
      cursor: at * PER_PAGE, limit: PER_PAGE, workspaceId })
      .then((r) => { if (live) setGot({ asked, items: r.items, total: r.total }); })
      .catch((e) => { if (live) setGot({ asked, failed: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [asked, tries]);   // eslint-disable-line react-hooks/exhaustive-deps
  const here = got?.asked === asked ? got : null;
  const learnedRows = learned && learned !== "failed" ? learned.items : [];
  const total = fan.key === "learned" ? learnedRows.length : here && "total" in here ? here.total : fan.count;
  const title = fanTitle(fan);
  // drawn as Discover draws a kind on an Area's page: its title and count, what orders it at the right, its rows
  return (
    <section className="aug-discover-kind" data-testid="atlas-kind-list" aria-label={title}>
      <div className="head aug-fs-sm">
        <span className="title">{title}</span><span data-testid="atlas-kind-count">{formatCount(fan.key === "learned" ? fan.count : total)}</span>
        <span className="right">
          {fan.key === "learned" ? (
            <span className="aug-fs-xs" title="A person's word on what a run measured first">in standing order</span>
          ) : (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Button variant="link" size="xs" aria-label={`In order: ${ORDER_WORDS[order]}`}>
                  {ORDER_WORDS[order]} <Icon name="chevd" size={12} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content size="1" align="end">
                {(Object.keys(ORDER_WORDS) as Order[]).map((o) => (
                  <DropdownMenu.Item key={o} onSelect={() => { setOrder(o); setAt(0); }}>{ORDER_WORDS[o]}</DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
        </span>
      </div>
      {fan.key !== "learned" && (here === null ? <Loading what={title.toLowerCase()} />
        : "failed" in here ? <ReadFailed what={title.toLowerCase()} error={here.failed} onRetry={() => setTries((n) => n + 1)} />
        : here.items.length === 0 ? <Empty>Nothing of this kind stands in this Area.</Empty>
        : here.items.map((i) => (
          <ItemRow key={`${i.kind}:${i.id}`} item={i} many={many} how tone={KIND_TONE[i.kind]} onOpen={(x) => onOpen(itemOpened(x))} />
        )))}
      {fan.key === "learned" && (learned === null ? <Loading what="what was learned here" />
        : learned === "failed" ? <Said lines={["What was learned here could not be read."]} />
        : (
          <>
            {learned.items.slice(at * PER_PAGE, (at + 1) * PER_PAGE).map((l) => (
              <LearnedRow key={`${l.connId}:${l.item.ref}:${l.item.text}`} l={l} onOpen={onOpen} />
            ))}
            {learned.items.length < fan.count && (
              <p className="aug-fs-xs" data-testid="atlas-learned-shown" style={{ ...MUTED, margin: "6px 8px 0" }}>
                {`${formatCount(learned.items.length)} of ${formatCount(fan.count)} read here — every one is on the Semantic Layer's Learned tab.`}
              </p>
            )}
            {learned.unread.length > 0 && <Said lines={[`Not read: what was learned on ${learned.unread.join(", ")}.`]} />}
          </>
        ))}
      <Pager at={at} total={total} onAt={setAt} />
    </section>
  );
}

/** A kind's title, as Discover names it ("Metrics", "Tables"), and the Areas' own two: what is certified, what was learned. */
function fanTitle(fan: Fan): string {
  return fan.key === "learned" ? "Learned" : fan.key === "certified" ? "Certified" : KIND_TITLES[fan.key];
}

/** One place in the breadcrumb: its name, and where it goes — none for where the reader is. */
export interface Crumb { label: string; go?: () => void }
/** How many places the breadcrumb names; before them a "…" goes one place up (the reference's "… › Customers › Pages"). */
const CRUMBS_SHOWN = 3;

/**
 * The head of the left panel, as the reference heads it: where the reader is — "Ontology › Customers › Orders & sales ›
 * Metrics", each place a way back to it — and a search over what is in view (the Area's, or every Area's). While a search
 * is typed, what it finds stands where the panel's own content was; a thing found opens on the right.
 */
export function RailHead({ crumbs, area = "", workspaceId, onOpen, areaNames, children }: {
  crumbs: Crumb[]; area?: string; workspaceId?: string; onOpen: (o: Opened) => void;
  /** The Areas' names by id, for the chip a found thing carries. */
  areaNames?: Record<string, string>;
  children?: React.ReactNode;
}) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; items: DiscoverItem[]; total: number } | { q: string; failed: string } | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const asked = searching ? q.trim() : "";
  useEffect(() => {
    if (!asked) return undefined;
    let live = true;
    const t = setTimeout(() => {
      readDiscoverSearch({ q: asked, area: area || undefined, workspaceId, limit: PER_PAGE })
        .then((r) => { if (live) setFound({ q: asked, items: r.items, total: r.total }); })
        .catch((e) => { if (live) setFound({ q: asked, failed: e instanceof Error ? e.message : String(e) }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [asked, area, workspaceId]);
  useEffect(() => { if (searching) box.current?.focus(); }, [searching]);
  const results = asked && found?.q === asked ? found : null;
  const hidden = crumbs.length > CRUMBS_SHOWN ? crumbs.slice(0, crumbs.length - CRUMBS_SHOWN) : [];
  const shown = crumbs.slice(hidden.length);
  const up = hidden[hidden.length - 1];
  const where = area ? "this Area" : "every Area";
  return (
    <>
      <div style={{ ...ROW, gap: 6, justifyContent: "space-between", minHeight: 28 }}>
        {searching ? (
          <span style={{ ...ROW, gap: 6, flex: 1, minWidth: 0 }}>
            <Icon name="search" size={14} />
            <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${where}`} placeholder={`Search ${where}`}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setSearching(false); setQ(""); } }}
              className="aug-fs-sm" style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "var(--t1)" }} />
          </span>
        ) : (
          <nav aria-label="Where you are" style={{ ...ROW, gap: 2, minWidth: 0, flexWrap: "nowrap", overflow: "hidden" }}>
            {up && (
              <>
                <Button variant="ghost" size="xs" aria-label={`Up to ${up.label}`} title={hidden.map((c) => c.label).join(" › ")}
                  onClick={up.go}>…</Button>
                <Icon name="chevr" size={11} />
              </>
            )}
            {shown.map((c, k) => (
              <span key={`${k}:${c.label}`} style={{ ...ROW, gap: 2, minWidth: 0 }}>
                {k > 0 && <span style={{ color: "var(--t3)", lineHeight: 0 }}><Icon name="chevr" size={11} /></span>}
                {c.go ? (
                  <Button variant="ghost" size="xs" onClick={c.go} style={{ color: "var(--t2)", maxWidth: 160 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                  </Button>
                ) : (
                  <span className="aug-fs-sm" aria-current="page" style={{ color: "var(--t1)", fontWeight: 600, padding: "0 6px",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <Button variant="ghost" size="icon-xs" aria-label={searching ? "Stop searching" : `Search ${where}`}
          onClick={() => { setSearching((x) => !x); setQ(""); }}>
          <Icon name={searching ? "close" : "search"} size={14} />
        </Button>
      </div>
      {asked ? (
        <section data-testid="atlas-search" aria-label="What the search found" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {results === null ? <Loading what="the search" />
            : "failed" in results ? <span className="aug-fs-sm" style={{ color: "var(--red4)" }}>{`The search could not be read: ${results.failed}`}</span>
            : (
              <>
                <span className="aug-fs-xs" style={MUTED}>{results.total ? `${formatCount(results.total)} found in ${where}` : `Nothing in ${where} says “${asked}”.`}</span>
                <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -8px" }}>
                  {results.items.map((i) => (
                    <ItemRow key={`${i.kind}:${i.id}`} item={i} many areaName={areaNames?.[i.area]} tone={KIND_TONE[i.kind]}
                      onOpen={(x) => onOpen(itemOpened(x))} />
                  ))}
                </div>
              </>
            )}
        </section>
      ) : children}
    </>
  );
}

export function AreaRail({ area, ancestors = [], page, pageFailed, onRetry, connections, fan, kind, onKind, learned, onOpen, onPickArea,
  onBack, workspaceId, onSaved }: {
  area: AtlasArea; page: DiscoverAreaPage | null; pageFailed: string; onRetry: () => void;
  /** The Areas it sits inside, the outermost first — its place in the breadcrumb. */
  ancestors?: AreaLike[];
  connections: { id: string; name: string }[]; fan: Fan[]; kind: FanKey | null; onKind: (k: FanKey | null) => void;
  learned: { items: LearnedHere[]; unread: string[] } | null | "failed"; onOpen: (o: Opened) => void;
  onPickArea: (a: AreaLike) => void; onBack: () => void; workspaceId?: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const chosenFan = kind ? fan.find((f) => f.key === kind) ?? null : null;
  const on = connections.filter((c) => area.connections.includes(c.id)).map((c) => c.name);
  return (
    <div data-testid="atlas-area-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <RailHead area={area.id} workspaceId={workspaceId} onOpen={onOpen} crumbs={[
        { label: "Ontology", go: onBack },
        ...ancestors.map((a) => ({ label: a.name, go: () => onPickArea(a) })),
        { label: area.name, go: kind ? () => onKind(null) : undefined },
        ...(kind ? [{ label: kind === "review" ? "Review" : (chosenFan?.words.replace(/^[\d,]+\s*/, "") ?? kind).replace(/^./, (c) => c.toUpperCase()) }] : []),
      ]}>
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
      {kind === "review" ? <ReviewList area={area.id} /> : chosenFan ? (
        <KindList area={area.id} fan={chosenFan} learned={learned} onOpen={onOpen} workspaceId={workspaceId} many={area.connections.length > 1} />
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
      </RailHead>
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
