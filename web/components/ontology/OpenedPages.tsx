"use client";

/**
 * What the Areas open on the right — each thing a page of its own in a tab of the side panel (the user, 2026-11-25, with
 * the reference Ontology manager and the coworker's side panel: "several artefacts like matrix and pages … open up in the
 * right panel in the form of tabs"; on the left "the list of pages and on the right … the specific page on which the
 * user has clicked"). Each page is laid out as the reference lays out a page or a snippet: its glyph in its kind's
 * colour, its name and its mark, what it does at the right; then what it is — its Area, who answers for it, what it says,
 * how much it is used — then what only its kind has: a metric's formula, dimensions and tables, a table's rows, a
 * learned thing's standing with Promote. A Definition is its own page (`DefinitionView`), the one it has everywhere.
 *
 * Inside the app a page opens in the shell's one side panel (`shell/Inspector`); outside it — a test, a Data Canvas —
 * the Areas keep a panel of their own, drawn the same way.
 */
import { useState, type ReactNode } from "react";

import { Chip, MUTED, ROW } from "@/components/clarity/kit";
import { DefinitionBody } from "@/components/definitions/DefinitionBody";
import { DefinitionView } from "@/components/definitions/DefinitionView";
import { PromoteForm } from "@/components/semantic/LearnedPanel";
import { SIDE, type InspectorSubject } from "@/components/shell/Inspector";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { openInApp } from "@/lib/addressOnce";
import { areaIcon } from "@/lib/areaIcons";
import { areaTone, KIND_TONE, waitingWords } from "@/lib/areaMap";
import { holdsWords, KIND_ICON, KIND_WORDS, markOf, ownersLine, usageLine, type DiscoverItem } from "@/lib/discover";
import { countNoun, formatCount, relTime } from "@/lib/format";
import { KIND_WORDS as LEARNED_WORDS, whereFrom, type Promoted } from "@/lib/learned";
import type { AreaLike, Opened } from "@/components/ontology/AreaDrill";

const kindWord = (k: DiscoverItem["kind"]) => KIND_WORDS[k][0].replace(/^./, (c) => c.toUpperCase());
const LEARNED_ICON: IconName = "memory";

/** What a page needs of the page it opened from: the Areas by id (for their chips) and the connections by id. */
export interface OpenedContext {
  areas: AreaLike[];
  connections: { id: string; name: string }[];
}

// ── the parts every page is made of ─────────────────────────────────────────────────────────────────────────────────

function PageHead({ icon, tone, title, mark, sub, actions }: {
  icon: IconName; tone?: string; title: string; mark?: ReactNode; sub?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <IconSquare name={icon} size={30} tone={tone} />
        <span className="aug-fs-h1" style={{ flex: 1, minWidth: 0, color: "var(--t1)", fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>
          {title}{mark && <span style={{ marginLeft: 8, verticalAlign: "middle" }}>{mark}</span>}
        </span>
        {actions && <span style={{ ...ROW, gap: 6, flexShrink: 0 }}>{actions}</span>}
      </span>
      {sub && <span className="aug-fs-sm" style={{ ...MUTED, paddingLeft: 40 }}>{sub}</span>}
    </header>
  );
}

/** What a thing is, label beside value, as the reference's page lists Domain, Owner, Synonyms and Description. */
function Props({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!shown.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr)", gap: "8px 12px", alignItems: "baseline",
      paddingBottom: 14, borderBottom: "1px solid var(--b0)" }}>
      {shown.map(([label, value]) => (
        <Prop key={label} label={label} value={value} />
      ))}
    </div>
  );
}

function Prop({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <span className="aug-fs-sm" style={MUTED}>{label}</span>
      <span className="aug-fs-sm" style={{ color: "var(--t1)", wordBreak: "break-word", minWidth: 0 }}>{value}</span>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }} aria-label={title}>
      <h3 className="aug-fs-h2" style={{ margin: 0, color: "var(--t1)", fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  );
}

function Pill({ children, icon, tone }: { children: ReactNode; icon?: IconName; tone?: string }) {
  return (
    <span className="aug-fs-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px",
      borderRadius: "var(--r2)", background: "var(--bg-3)", color: "var(--t1)" }}>
      {icon && <span style={{ color: tone ?? "var(--t2)", lineHeight: 0 }}><Icon name={icon} size={12} /></span>}
      {children}
    </span>
  );
}

function Pills({ of }: { of: ReactNode[] }) {
  return <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{of}</span>;
}

/** An Area as a chip — its glyph in its colour and its name — or the words for none. */
function AreaChips({ ids, ctx }: { ids: string[]; ctx: OpenedContext }) {
  const found = ids.filter(Boolean);
  if (!found.length) return <span style={MUTED}>in no Area</span>;
  return (
    <Pills of={found.map((id) => {
      const a = ctx.areas.find((x) => x.id === id);
      return <Pill key={id} icon={areaIcon(a?.icon)} tone={areaTone(id)}>{a?.name ?? id}</Pill>;
    })} />
  );
}

const Mark = ({ word, tone }: { word: string; tone: "up" | "amber" | "plain" }) => <Chip tone={tone}>{word}</Chip>;

// ── the pages ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** An Area, opened on the right (the user, 2026-11-25: "panels on the right side with the artefact/circle clicked upon"):
 *  what it is, who answers for it, what it holds, the month's answers that drew on it, what waits in it. */
function AreaPage({ area, ctx }: { area: AreaLike; ctx: OpenedContext }) {
  const on = ctx.connections.filter((c) => (area.connections ?? []).includes(c.id)).map((c) => c.name);
  const named = (area.business_owners?.length ?? 0) + (area.technical_owners?.length ?? 0) > 0;
  // as Discover heads an Area's page: its glyph and name with what it is in chips, its question, what it covers, and who
  // answers for it — in amber while nobody does
  return (
    <div data-testid="atlas-open-area" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead icon={areaIcon(area.icon)} tone={areaTone(area.id)} title={area.name}
        mark={(
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {area.source === "package" && <Chip>From the industry package</Chip>}
            {area.source === "organisation" && <Chip>Declared by your organisation</Chip>}
            {(area.deprecated ?? 0) > 0 && <Chip tone="amber">{`${formatCount(area.deprecated ?? 0)} deprecated`}</Chip>}
          </span>
        )}
        sub={area.question}
        actions={(
          <Button size="xs" variant="outline" onClick={() => openInApp(`/?view=discover&tab=discover&id=${encodeURIComponent(area.id)}`)}>
            Open its page <Icon name="external" size={12} />
          </Button>
        )} />
      {area.description && <div style={{ maxWidth: "80ch" }}><DefinitionBody text={area.description} /></div>}
      <p className="aug-fs-sm" style={{ margin: 0, color: named ? "var(--t3)" : "var(--amb4)" }}>
        {area.business_owners || area.technical_owners
          ? ownersLine({ business_owners: area.business_owners ?? [], technical_owners: area.technical_owners ?? [] }) : "Who answers for it was not read."}
      </p>
      <Props rows={[
        ["This month", area.answers !== undefined ? `${countNoun(area.answers, "answer")} drew on it` : null],
        ["Holds", area.counts ? holdsWords(area.counts) || "nothing yet" : null],
        ["Waiting", area.review !== undefined ? waitingWords(area.review ?? null, area.learned ?? null) : null],
        ["On", on.length ? on.join(", ") : null],
        ["Inside", area.parent ? <AreaChips ids={[area.parent]} ctx={ctx} /> : null],
      ]} />
    </div>
  );
}

/** An entity of an Area, opened on the right: what it is, its key, how many there are, what it reads and links to. */
function EntityPage({ o }: { o: Extract<Opened, { what: "entity" }> }) {
  const { row, connection } = o;
  return (
    <div data-testid="atlas-open-entity" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead icon="node" title={row.display_name} sub={`Entity · ${connection.name}`}
        actions={(
          <Button size="xs" variant="outline" onClick={() => openInApp(`/?tab=ontology&conn=${encodeURIComponent(connection.id)}`)}>
            Open {connection.name}&apos;s ontology <Icon name="external" size={12} />
          </Button>
        )} />
      <Props rows={[
        ["How many", row.rows === null || row.rows === undefined ? "not counted" : formatCount(row.rows)],
        ["Its key", row.key ? `${row.key}${row.key_verified ? " — proved unique" : row.key_verified === false ? " — not unique" : ""}` : "none yet"],
        ["Read from", row.table || "—"],
        ["Properties", formatCount(row.properties ?? 0)],
        ["Links", `${formatCount(row.links ?? 0)}, ${formatCount(row.traversable_links ?? 0)} followed by answers`],
        ["Metrics", formatCount(row.metrics ?? 0)],
        ["Actions", formatCount(row.actions ?? 0)],
      ]} />
    </div>
  );
}

const listed = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/** Any other thing an Area holds — a metric, a table, a dashboard, a Data Canvas, a document — as a page: what it is,
 *  then what only its kind has. */
function ItemPage({ item, ctx }: { item: DiscoverItem; ctx: OpenedContext }) {
  const mark = markOf(item);
  const d = (item.detail ?? {}) as Record<string, unknown>;
  const said = new Set(["formula", "dimensions", "tables", "unit", "rows", "schema", "dated_by", "measurable", "right"]);
  const rest = Object.entries(d).filter(([k, v]) => !said.has(k) && (typeof v === "string" || typeof v === "number") && String(v).trim() !== "");
  return (
    <div data-testid="atlas-open-item" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead icon={KIND_ICON[item.kind]} tone={KIND_TONE[item.kind]} title={item.name}
        mark={mark && <Mark word={mark.word} tone={mark.tone === "up" ? "up" : mark.tone === "amber" ? "amber" : "plain"} />}
        sub={[kindWord(item.kind), item.connection_name].filter(Boolean).join(" · ")}
        actions={item.href ? (
          <Button size="xs" variant="outline" onClick={() => openInApp(item.href)}>
            Open its page <Icon name="external" size={12} />
          </Button>
        ) : undefined} />
      <Props rows={[
        ["Area", <AreaChips key="a" ids={[item.area]} ctx={ctx} />],
        ["How it is placed", item.area_how],
        ["Owner", item.owner],
        ["Description", item.line],
        ["Used this month", usageLine(item.use) || (item.use === undefined ? "not measured for this kind" : "not used this month")],
        ["Updated", item.updated_at ? relTime(item.updated_at) : null],
        ["Certification", item.certification?.status ? [item.certification.status, item.certification.by && `by ${item.certification.by}`,
          item.certification.why].filter(Boolean).join(" · ") : null],
        ["Unit", typeof d.unit === "string" ? d.unit : null],
        ["Rows", typeof d.rows === "number" ? formatCount(d.rows) : null],
        ["Schema", typeof d.schema === "string" ? d.schema : null],
        ["Dated by", typeof d.dated_by === "string" ? d.dated_by : null],
        ...rest.map(([k, v]) => [k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(v)] as [string, ReactNode]),
      ]} />
      {typeof d.formula === "string" && d.formula.trim() && (
        <Section title="Formula">
          <pre className="aug-fs-sm" style={{ margin: 0, padding: "10px 12px", borderRadius: "var(--r2)", background: "var(--bg-0)",
            color: "var(--t1)", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{d.formula}</pre>
        </Section>
      )}
      {listed(d.dimensions).length > 0 && (
        <Section title="Dimensions"><Pills of={listed(d.dimensions).map((x) => <Pill key={x} icon="column">{x}</Pill>)} /></Section>
      )}
      {listed(d.tables).length > 0 && (
        <Section title="Tables"><Pills of={listed(d.tables).map((x) => <Pill key={x} icon="table">{x}</Pill>)} /></Section>
      )}
    </div>
  );
}

/** A Definition: the page it has everywhere — its Area, owner, synonyms and description, its body, its sources — whose
 *  owner edits it here. */
function DefinitionPage({ item }: { item: DiscoverItem }) {
  return (
    <div data-testid="atlas-open-definition" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <DefinitionView key={item.id} term={item.name} connection={item.connection_id} initialArea={item.area} inApp />
    </div>
  );
}

/** Something learned (the reference's "snippet"): what it says, where it came from and where it stands — and Promote,
 *  which makes it a Definition every answer reads. */
function LearnedPage({ o, ctx }: { o: Extract<Opened, { what: "learned" }>; ctx: OpenedContext }) {
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState<Promoted | null>(null);
  const i = o.item;
  const canPromote = i.kind !== "trusted_query" && !promoted && !promoting;
  return (
    <div data-testid="atlas-open-learned" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead icon={LEARNED_ICON} tone={KIND_TONE.learned} title={i.text} sub={`Learned · ${LEARNED_WORDS[i.kind] ?? i.kind} · ${o.connName}`}
        actions={canPromote ? <Button size="xs" variant="outline" onClick={() => setPromoting(true)}>Promote</Button> : undefined} />
      {promoting && (
        <PromoteForm connId={o.connId} item={i} areas={ctx.areas.map((a) => ({ id: a.id, name: a.name }))}
          onDone={(p) => { setPromoted(p); setPromoting(false); }} onCancel={() => setPromoting(false)} />
      )}
      {promoted && (
        <span className="aug-fs-sm" data-testid="atlas-learned-promoted" style={{ color: "var(--t2)" }}>
          {promoted.suggested ? `“${promoted.term}” is already defined — filed as a suggested edit for its owner. `
            : `Drafted as “${promoted.term}”. `}
          <Button size="xs" variant="ghost" onClick={() => openInApp(promoted.href)}>Open it</Button>
        </span>
      )}
      <Props rows={[
        ["Where it stands", i.why],
        ["Where it came from", whereFrom(i)],
        ["What it read", i.tables.length ? i.tables.join(", ") : "names no table"],
        ["Its Area", <AreaChips key="a" ids={[i.area]} ctx={ctx} />],
        ["Used in answers", i.uses == null ? "not counted yet" : formatCount(i.uses)],
        ["Said", i.times > 1 ? `${i.times} times` : null],
      ]} />
    </div>
  );
}

/** The page for whatever was opened. */
export function OpenedPage({ o, ctx }: { o: Opened; ctx: OpenedContext }) {
  if (o.what === "area") return <AreaPage area={o.area} ctx={ctx} />;
  if (o.what === "entity") return <EntityPage o={o} />;
  if (o.what === "learned") return <LearnedPage o={o} ctx={ctx} />;
  return o.item.kind === "definition" ? <DefinitionPage item={o.item} /> : <ItemPage item={o.item} ctx={ctx} />;
}

/** The glyph and the word a tab names an opened thing by. */
export function openedLook(o: Opened): { icon: IconName; kind: string } {
  if (o.what === "area") return { icon: areaIcon(o.area.icon), kind: "Area" };
  if (o.what === "entity") return { icon: "node", kind: "Entity" };
  if (o.what === "learned") return { icon: LEARNED_ICON, kind: "Learned" };
  return { icon: KIND_ICON[o.item.kind], kind: kindWord(o.item.kind) };
}

/** An opened thing as a tab of the shell's side panel: a page of its own, which draws its own title. */
export function subjectOf(o: Opened, ctx: OpenedContext): InspectorSubject {
  const { icon, kind } = openedLook(o);
  return { key: o.key, kind, title: o.title, icon, bare: true, tabs: { overview: <OpenedPage o={o} ctx={ctx} /> } };
}

/** The Areas' own side panel, outside the app (a test, a Data Canvas) — drawn as the shell's is: a tab for each thing
 *  open, its glyph, its name and ×, and the page in front under them. */
export function OpenPanel({ open, active, onActive, onClose, ctx }: {
  open: Opened[]; active: string | null; onActive: (key: string) => void; onClose: (key: string) => void; ctx: OpenedContext;
}) {
  const shown = open.find((o) => o.key === active) ?? open[open.length - 1];
  return (
    <aside aria-label="What is open" data-testid="atlas-open-panel" className="aug-inspector" style={{ flex: "1 1 380px", maxWidth: 560,
      minWidth: 0, maxHeight: "100%" }}>
      <div style={SIDE.bar}>
        <div role="tablist" aria-label="Open things" style={SIDE.open}>
          {open.map((o) => (
            <span key={o.key} style={SIDE.tab(o.key === shown?.key)}>
              <Button variant="ghost" size="xs" role="tab" aria-selected={o.key === shown?.key} title={o.title} style={SIDE.name}
                onClick={() => onActive(o.key)}>
                <Icon name={openedLook(o).icon} size={13} />
                <span style={SIDE.text}>{o.title}</span>
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Close ${o.title}`} onClick={() => onClose(o.key)}>
                <Icon name="close" size={11} />
              </Button>
            </span>
          ))}
        </div>
      </div>
      <div className="aug-inspector-body">
        {shown && <OpenedPage key={shown.key} o={shown} ctx={ctx} />}
      </div>
    </aside>
  );
}
