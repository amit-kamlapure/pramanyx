"use client";

/**
 * DashboardTile — how a dashboard draws one card (Arc CT; the user's mock, 2026-09-28: "make the
 * dashboard look like the mockup").
 *
 * The first cut drew every card with `PinnedCardBody`, the Briefing's own card, unchanged. That
 * kept one rendering of a card, and it is why the dashboard looked like a pinned card and not like
 * the mock: a figure floating in a fixed-height box, the unit dropped, what stands behind the
 * figure unsaid, and three action buttons where the mock says where the figure came from.
 *
 * The law is unchanged — the spec arranges, the card store measures. Nothing here decides what a
 * card measures: the figure is the card's own run, the unit is its metric's, and the scale the
 * unit states is read by the Briefing's own reader (`metricFormat.formatMetric`, fed the
 * `stated_range` the server read). What this file adds is the face:
 *
 *   figure   the figure at its unit's scale; how it moved against the window its range is
 *            compared with (the card's own SQL cut to that window, `previous`), said as not at
 *            equal age before the range is final; its limit, and whether it is over it.
 *   trend    a series drawn as a line, its limit drawn on it, its newest point labelled.
 *   rows     a chart or a table, as the card's chart editor keeps it.
 *
 * Every tile's foot says where its figure comes from. Its doors — refresh, an alert, the
 * evidence, taking it off — show when the tile is pointed at or focused.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { downloadChartPng, type ChartInstance } from "@/lib/chartExport";
import { csvFilename, downloadCsv, toCsv, type CsvCell } from "@/lib/query/csv";

import { useMarkRead } from "@/components/dashboards/readSlot";
import { CardAlertForm, usePersistViz, type CardState } from "@/components/brief/PinnedCardBody";
import { seriesTrend, type SeriesTrend } from "@/components/brief/Sparkline";
import { deltaInfo, formatMetric } from "@/components/brief/metricFormat";
import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { type ChartCustom } from "@/components/Chart";
import { chartOptionsOf, type VizConfig } from "@/components/charts/vizConfig";
import { ALL_CHART_TYPES } from "@/components/charts/chartTypeInference";
import type { Pick as ChartPick } from "@/components/charts/selection";
import { VegaChart } from "@/components/charts/vega/VegaChart";
import { useCellBox, useMeasured } from "@/components/dashboards/cellBox";
import { SizePick } from "@/components/dashboards/SizePick";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { readMetricTrend, type BriefingRange, type CardRunPrevious, type DashboardCard, type QueryShaped, type QueryShown, type StatedRange } from "@/lib/api";
import { readVegaTokens } from "@/components/charts/vega/config";
import { queryChartSpec } from "@/lib/dashboards/queryChart";
import { cellText } from "@/lib/dashboards/objectView";
import { SPAN, type Size } from "@/lib/dashboards/catalog";
import { cardValue } from "@/lib/dashboards/hostStatus";
import type { CardStatus } from "@/lib/dashboards/hostState";
import { fmtDate, formatCount, formatMetricValue, formatSeconds } from "@/lib/format";
import { NumberedPager } from "@/components/dashboards/NumberedPager";
import { usePlacementLook, useValueColors } from "@/components/dashboards/placementLook";
import type { NumberLook } from "@/lib/dashboards/numberLook";
import { cellLook, columnRanges } from "@/lib/dashboards/columnLook";
import { draftedFigure } from "@/lib/dashboards/figureText";

export type TileShape = "figure" | "trend" | "rows";

/** How a card is drawn, from its run. A failed run is a figure that says it failed. A query of a person's own not run
 *  yet — one waiting on a value (Arc AP-8) — takes the room its setup asks for, so it does not jump when it is read. */
export function tileShape(cs: CardState): TileShape {
  const { run, failed } = cs;
  const setup = (cs.card.render as { shown?: { as?: string } } | undefined)?.shown;
  if (!run && !failed && setup?.as) return setup.as === "figure" ? "figure" : "rows";
  if (failed || !run || run.error) return "figure";
  // Arc AP-7 — a card of a person's own query is drawn as they set it up, never by its result's shape
  const shown = (run as { shown?: QueryShaped | null }).shown;
  if (shown) return shown.as === "figure" ? "figure" : "rows";
  if (seriesTrend(run.columns, run.rows)) return "trend";
  // One cell is one figure, even an empty one: a total over a period with no rows is NULL, and
  // that is "no figure for the period", never a one-cell table reading "NULL".
  const oneCell = (run.columns?.length ?? 0) === 1 && (run.rows?.length ?? 0) <= 1;
  if (cardValue(cs) !== null || oneCell) return "figure";
  return (run.columns?.length ?? 0) > 0 && (run.rows?.length ?? 0) > 0 ? "rows" : "figure";
}

/** A tile that needs the room of two columns. */
export const WIDE: Record<TileShape, boolean> = { figure: false, trend: true, rows: true };

export interface TileDoors {
  /** The study's R20 — open the Data Canvas with this card as the question's subject. */
  onAskAbout?: (id: string, title: string) => void;
  /** Take the card off this dashboard. Absent where the reader may not change it — a strip, a published one. */
  onRemove?: (id: string) => void;
  onRefresh: (id: string) => void;
  onOpenSource?: (iid: string) => void;
  onEvidence?: (iid: string) => void;
  /** Give the element this tile draws a size. Absent on a dashboard the reader may not change. */
  onResize?: (key: string, size: Size) => void;
}

/** Where a tile stands: the element it draws, and its size. A tile drawn outside a dashboard's spec
 *  (a test, a strip) has no element, and offers no size. */
/** Rows a card offers to take away. */
export interface CardTable { columns: string[]; rows: CsvCell[][] }

export interface TilePlace {
  elementKey: string | null;
  size: Size;
  /** The range the dashboard is read for, so a bigger figure can show its trend. Null when none. */
  range?: BriefingRange | null;
  schema?: string;
}

const STANDING: TilePlace = { elementKey: null, size: "small", range: null };

/** What stands behind a card's figure, in the words the Briefing uses for each record. */
const MADE_FROM: Record<string, { icon: IconName; words: string }> = {
  metric: { icon: "shield", words: "Approved metric" },
  trusted_query: { icon: "db", words: "Trusted query" },
  finding: { icon: "idea", words: "Finding" },
};

function sourceOf(card: DashboardCard): { icon: IconName; words: string } {
  const made = card.made_from ?? (card.provenance.metric ? "metric" : card.provenance.insight_id ? "finding" : "");
  return MADE_FROM[made] ?? { icon: "sql", words: "Query" };
}

interface Limits { warning?: number | null; critical?: number | null; direction?: string; monitor_id?: string | null }

function limitsOf(card: DashboardCard): { values: number[]; below: boolean; watched: boolean } {
  const t = (card.thresholds ?? {}) as Limits;
  const values = [t.warning, t.critical].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return { values, below: t.direction === "below", watched: !!t.monitor_id };
}

/** One figure, at the scale its unit states. A figure its unit says cannot be is still shown —
 *  a dashboard hides nothing — plainly, and said to be outside its range. */
export function figureText(v: number, card: DashboardCard, sym: string, look: NumberLook | null = null): { text: string; outside: boolean } {
  const range = card.stated_range ?? undefined;
  const f = formatMetric(v, card.unit ?? "", sym, card.title, range, look);
  if (f.ok) return { text: f.display, outside: false };
  const bounded = !!range && ["ratio01", "pct100", "band"].includes(range.kind);
  return { text: formatMetricValue(v), outside: bounded && v !== 0 };
}

/** How the figure moved against what it is compared with: "0.4 pts lower than June". */
export function changeWords(cur: number, prev: number, card: DashboardCard, against: string): { text: string; sign: number } | null {
  const d = deltaInfo([prev, cur], card.unit ?? "", card.title, (card.stated_range ?? undefined) as StatedRange | undefined);
  if (!d) return null;
  if (d.sign === 0) return { text: `the same as ${against}`, sign: 0 };
  // A relative change has no base to stand on when what it is compared with is zero.
  if (!d.text.endsWith("pts") && !d.text.endsWith("×") && prev === 0) return null;
  const size = d.text.replace(/^[+-]/, "").replace(/pts$/, " pts");
  // A move too small to show at the precision it is written in is no move to a reader: "0.0 pts
  // lower" (seen on theLook's gross margin, 2026-09-28) says a direction the figure cannot carry.
  if (parseFloat(size) === 0) return { text: `the same as ${against}`, sign: 0 };
  return { text: `${size} ${d.sign > 0 ? "higher" : "lower"} than ${against}`, sign: d.sign };
}

/** Green or red only where the card says which way is bad — its limit's side. Otherwise the
 *  move is said in the reader's own colour: a rise is not good news for every figure. */
function moveColour(sign: number, card: DashboardCard): string {
  const { values, below } = limitsOf(card);
  if (!values.length || sign === 0) return "var(--t2)";
  const towardTheLimit = below ? sign < 0 : sign > 0;
  return towardTheLimit ? "var(--red4)" : "var(--grn4)";
}

export function Frame({ testid, shape, over, dashed, bare, children, doors }: {
  testid: string; shape?: TileShape; over?: boolean; dashed?: boolean;
  /** Words standing on the page itself, a heading across the dashboard: no card around them. */
  bare?: boolean;
  children: ReactNode; doors?: ReactNode;
}) {
  return (
    <div className="group" data-testid={testid} data-shape={shape} style={{
      position: "relative", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column",
      // on a section's grid the box is fixed: what it holds stays inside it, and a piece's own body scrolls (Arc AP-1)
      minHeight: 0, overflow: "hidden",
      // the quieter card of the board study (docs/OPENDASHBOARDS_STUDY.md §6.2): more air, no shadow (CLARITY.md)
      gap: 8, padding: bare ? "4px 2px" : "16px 18px 14px", background: bare ? "transparent" : "var(--bg-2)", borderRadius: "var(--r3)",
      // a card stands on the page by its fill; an edge is drawn only where it says something — dashed for a piece
      // that cannot be read, red for a figure over its limit (CLARITY.md, "cards on the ground")
      border: `1px ${dashed ? "dashed" : "solid"} ${bare ? "transparent" : over ? "color-mix(in srgb, var(--red4) 55%, var(--b1))" : dashed ? "var(--b1)" : "var(--card-edge)"}`,
    }}>
      {children}
      {doors}
    </div>
  );
}

/** A piece's name: the card says what it shows at full strength (14/600); a figure's name is its muted label, the
 *  figure being the point (CLARITY.md, "a row of figures": label muted · value 22–30px). */
export function Title({ title, right, muted = false }: { title: string; right?: ReactNode; muted?: boolean }) {
  // a placed card's own look (v16): its title hidden, or a description under it
  const look = usePlacementLook();
  return (
    <>
      {(look.showTitle || right) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, paddingRight: 64 }}>
          {look.showTitle ? (
            <div className={muted ? "aug-fs-chrome" : "aug-fs-ui"} title={title} data-testid="tile-title" style={{
              flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              ...(muted ? { fontWeight: 500, color: "var(--t2)" } : { fontWeight: 600, color: "var(--t1)" }),
            }}>{title}</div>
          ) : <div style={{ flex: 1 }} />}
          {right}
        </div>
      )}
      {look.description && (
        <div className="aug-fs-xs" data-testid="tile-description" style={{ color: "var(--t3)", lineHeight: 1.45, paddingRight: look.showTitle ? 0 : 64 }}>
          {look.description}
        </div>
      )}
    </>
  );
}

export function Foot({ icon, children, aside }: { icon: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="aug-fs-sm" style={{ marginTop: "auto", paddingTop: 4, display: "flex", alignItems: "center", gap: 6, color: "var(--t3)", minWidth: 0 }}>
      <Icon name={icon} size={13} />
      <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {aside && <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>{aside}</span>}
    </div>
  );
}

/** The card's doors, shown when the tile is pointed at or focused. */
/** What a card offers to take away (the study's R23): the rows it read as they are drawn here, and its chart as a picture. */
function CardFiles({ title, table, chart }: { title: string; table: CardTable | null; chart?: RefObject<ChartInstance | null> }) {
  if (!table?.columns.length && !chart) return null;
  const name = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "card";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant="ghost" size="icon-xs" aria-label="Download" title="Download this card's rows or its chart" data-testid="card-download"><Icon name="download" /></Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end">
        {!!table?.columns.length && (
          <DropdownMenu.Item data-testid="card-download-csv" onSelect={() => downloadCsv(csvFilename(name), toCsv(table.columns, table.rows))}>Rows as CSV</DropdownMenu.Item>
        )}
        {chart && <DropdownMenu.Item data-testid="card-download-png" onSelect={() => void downloadChartPng(chart.current, title)}>Chart as PNG</DropdownMenu.Item>}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function Doors({ card, doors, onAlert, place, files }: { card: DashboardCard; doors: TileDoors; onAlert?: () => void; place: TilePlace; files?: ReactNode }) {
  const iid = card.provenance.insight_id;
  return (
    <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      data-testid="dashboard-tile-doors"
      style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 2, alignItems: "center", background: "var(--bg-2)", borderRadius: "var(--r2)" }}>
      {doors.onResize && place.elementKey && (
        <SizePick value={place.size} label={`Size of ${card.title}`} onPick={s => doors.onResize?.(place.elementKey as string, s)} />
      )}
      {doors.onAskAbout && (
        <Button variant="ghost" size="icon-xs" aria-label="Ask about this card" title="Ask about this card, for the period on screen" data-testid="card-ask-about"
          onClick={() => doors.onAskAbout?.(card.id, card.title)}><Icon name="chat" /></Button>
      )}
      {iid && doors.onEvidence && (
        <Button variant="ghost" size="icon-xs" aria-label="Evidence" title="See the evidence behind this finding"
          onClick={() => doors.onEvidence?.(iid)}><Icon name="shield" /></Button>
      )}
      {iid && doors.onOpenSource && (
        <Button variant="ghost" size="icon-xs" aria-label="Why" title="Open the finding that explains this figure's move"
          onClick={() => doors.onOpenSource?.(iid)}><Icon name="external" /></Button>
      )}
      {onAlert && (
        <Button variant="ghost" size="icon-xs" aria-label="Set an alert" title="Alert me when this figure crosses a threshold (schedules a monitor)"
          onClick={onAlert}><Icon name="bell" /></Button>
      )}
      {files}
      <Button variant="ghost" size="icon-xs" aria-label="Refresh" title="Run this card again"
        onClick={() => doors.onRefresh(card.id)}><Icon name="refresh" /></Button>
      {doors.onRemove && (
        <Button variant="ghost" size="icon-xs" aria-label="Take off this dashboard" title="Take it off this dashboard. The card is kept."
          onClick={() => doors.onRemove?.(card.id)}><Icon name="close" /></Button>
      )}
    </div>
  );
}

function Moved({ value, previous, card }: { value: number; previous: CardRunPrevious; card: DashboardCard }) {
  if (previous.value === null) {
    return (
      <div className="aug-fs-sm" data-testid="tile-change" title={previous.why} style={{ color: "var(--t3)" }}>
        No figure for {previous.word} to compare with
      </div>
    );
  }
  const moved = changeWords(value, previous.value, card, previous.word);
  if (!moved) return null;
  return (
    <div className="aug-fs-sm" data-testid="tile-change" title={`Against ${previous.covers}`}
      style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", color: previous.equal_age ? moveColour(moved.sign, card) : "var(--t2)" }}>
      {moved.sign !== 0 && <Icon name={moved.sign > 0 ? "rises" : "falls"} size={13} />}
      <span>{moved.text}</span>
      {!previous.equal_age && (
        <span data-testid="tile-not-equal-age" style={{ color: "var(--amb4)" }}
          title="This range's days may still change, so part of the difference may not be a move.">
          · not at equal age
        </span>
      )}
    </div>
  );
}

/** How tall a chart in a tile is drawn: on a section's grid, the height its box leaves it, followed as the box is
 *  resized one grade at a time; off the grid, the height its size names, as before (Arc AP-1). */
function useChartHeight(offGrid: number): [(el: HTMLDivElement | null) => void, number] {
  const box = useCellBox();
  const [ref, room] = useMeasured<HTMLDivElement>();
  return [ref, box.onGrid && room.height > 0 ? Math.max(60, room.height) : offGrid];
}

/** A metric's trend over the ranges before the one the dashboard is read for — what a bigger figure
 *  tile has the room to show (the user, 2026-10-08: "a bigger tile shows the same figure larger, with
 *  its trend"). Read once per card and range; nothing is re-measured, and the figure above it is
 *  the card's own run, untouched. */
function MetricTrendStrip({ card, place, sym }: { card: DashboardCard; place: TilePlace; sym: string }) {
  const metric = card.provenance.metric || "";
  const rangeKey = JSON.stringify(place.range ?? null);
  const [got, setGot] = useState<{ key: string; trend: SeriesTrend | null; labels: string[] } | null>(null);
  useEffect(() => {
    if (!metric || !place.range) { setGot(null); return; }
    let alive = true;
    const key = `${card.id}:${rangeKey}:${place.schema ?? ""}`;
    readMetricTrend(card.connection_id, metric, place.range, place.schema).then(t => {
      if (!alive) return;
      const pts = t.series.filter(p => p.value !== null);
      const trend: SeriesTrend | null = pts.length >= 2
        ? { dates: pts.map(p => p.start), values: pts.map(p => p.value as number), gran: "month", lastDelta: null, periodLabel: "" }
        : null;
      setGot({ key, trend, labels: pts.map(p => p.label) });
    }).catch(() => { if (alive) setGot({ key, trend: null, labels: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the range is read through its key
  }, [card.id, card.connection_id, metric, rangeKey, place.schema]);
  const spec = useMemo(() => (got?.trend ? trendSpec(got.trend, card, sym, got.labels) : null), [got, card, sym]);
  const [room, height] = useChartHeight(SPAN[place.size].h === 2 ? 220 : 110);
  if (!spec) return null;
  return (
    <div ref={room} data-testid="tile-trend" style={{ flex: 1, minHeight: 0, marginTop: 4 }}>
      <VegaChart spec={spec} tier={2} height={height} />
    </div>
  );
}

function FigureTile({ cs, status, sym, doors, place }: { cs: CardState & { card: DashboardCard }; status: CardStatus; sym: string; doors: TileDoors; place: TilePlace }) {
  const numberLook = usePlacementLook().number;
  const { card, run, failed } = cs;
  const errored = failed || !!run?.error;
  const value = cardValue(cs);
  const ranged = !!run?.scoped && !run.scoped.standing;
  const { values: limits, below, watched } = limitsOf(card);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alerting, setAlerting] = useState(watched);
  const source = sourceOf(card);
  const over = status === "over";
  const shown = value !== null ? figureText(value, card, sym, numberLook) : null;
  // Standing: what it moved by since the card last ran, if it did.
  const standingPrev = !ranged ? (run?.refresh?.prev_value ?? null) : null;
  const caveats = run?.caveats ?? [];
  // A bigger tile shows the same figure larger — and, for a metric read for a range, its trend. On the grid, bigger is
  // five columns or five rows and more (Arc AP-1).
  const box = useCellBox();
  const span = SPAN[place.size];
  const big = box.onGrid ? box.w >= 5 || box.h >= 5 : span.w > 1 || span.h > 1;
  const widest = box.onGrid ? box.w >= 9 : span.w >= 3;
  const withTrend = big && ranged && !errored && (card.made_from === "metric" || !!card.provenance.metric) && !!place.range;

  return (
    <Frame testid="dashboard-tile" shape="figure" over={over}
      doors={<Doors card={card} doors={doors} place={place} onAlert={value !== null && !alerting ? () => setAlertOpen(o => !o) : undefined}
        files={<CardFiles title={card.title} table={runTable(cs.run)} />} />}>
      <Title title={card.title} muted />
      {errored ? (
        <>
          <div className="aug-fs-ui" style={{ color: "var(--amb4)" }}>Could not be read</div>
          {run?.error_kind === "sheet_removed" && <div className="aug-fs-sm" data-testid="tile-sheet-removed" style={{ color: "var(--t2)" }}>{run.error}</div>}
        </>
      ) : shown ? (
        <div className="aug-fs-display" data-testid="tile-figure" data-size={place.size} title={shown.outside ? `Outside what its unit states (${card.unit})` : undefined}
          style={{ fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.02em", color: over ? "var(--red4)" : "var(--t1)", fontVariantNumeric: "tabular-nums",
            fontSize: widest ? "2.6em" : big ? "2.1em" : undefined }}>
          {shown.text}
        </div>
      ) : (
        <div className="aug-fs-ui" data-testid="tile-no-figure" style={{ color: "var(--t3)" }}>
          {!run ? "…" : ranged ? `No figure for ${run.scoped?.covers}` : "No figure"}
        </div>
      )}
      {shown?.outside && (
        <div className="aug-fs-sm" style={{ color: "var(--amb4)" }}>Outside what its unit states</div>
      )}
      {value !== null && ranged && run?.previous && <Moved value={value} previous={run.previous} card={card} />}
      {value !== null && !ranged && standingPrev !== null && standingPrev !== value && (() => {
        const moved = changeWords(value, standingPrev, card, "its last run");
        return moved && (
          <div className="aug-fs-sm" data-testid="tile-change" style={{ display: "flex", alignItems: "center", gap: 4, color: moveColour(moved.sign, card) }}>
            <Icon name={moved.sign > 0 ? "rises" : "falls"} size={13} />{moved.text}
          </div>
        );
      })()}
      {run?.scoped?.standing && (
        <div className="aug-fs-sm" data-testid="card-scoped" title={run.scoped.why} style={{ color: "var(--amb4)" }}>
          All history, not {run.scoped.covers} — {run.scoped.why}
        </div>
      )}
      {limits.length > 0 && (
        <div className="aug-fs-sm" data-testid="card-limit" style={{ color: over ? "var(--red4)" : "var(--t3)" }}
          title={alerting ? "A monitor watches this limit" : "This card carries a limit. Nothing is scheduled to watch it."}>
          {over ? "Past its limit" : "Limit"}: {below ? "at or below" : "at or above"} {limits.map(v => figureText(v, card, sym, numberLook).text).join(", ")}
          {alerting ? " · alerting" : ""}
        </div>
      )}
      {alertOpen && !alerting && (
        <CardAlertForm card={card} direction={below ? "below" : "above"}
          onSet={() => { setAlerting(true); setAlertOpen(false); }} />
      )}
      {withTrend && <MetricTrendStrip card={card} place={place} sym={sym} />}
      <Foot icon={source.icon} aside={caveats.length > 0 && (
        <span title={caveats.join("; ")} style={{ color: "var(--amb4)" }}>
          {caveats.length} guard caveat{caveats.length > 1 ? "s" : ""}
        </span>
      )}>
        {source.words}
      </Foot>
    </Frame>
  );
}

/** A Vega-Lite spec for a series: the line, its newest point labelled, and the card's limit
 *  drawn across it. Colours come from the chart theme (`charts/vega/config.ts`), never here. */
export function trendSpec(trend: SeriesTrend, card: DashboardCard, sym: string, labels?: string[]): Record<string, unknown> {
  const n = trend.values.length;
  const values = trend.dates.map((d, i) => ({ x: labels?.[i] ?? fmtDate(d, trend.gran), y: trend.values[i], i }));
  const last = figureText(trend.values[n - 1], card, sym).text;
  const range = card.stated_range?.kind;
  const big = Math.max(...trend.values.map(Math.abs)) >= 1000;
  const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  const money = formatMetric(1234, card.unit ?? "", sym, card.title, card.stated_range ?? undefined).display.startsWith(sym) && !!sym;
  // Three significant figures: a line that moves within a narrow band (2.78M to 2.92M) needs
  // them, or its ticks read "2.9M, 2.9M, 2.8M". "~" trims the zeros a round tick does not need.
  const digits = big ? ".3~s" : ".3~r";
  const axis: Record<string, unknown> = range === "ratio01" ? { format: ".1~%" }
    : range === "pct100" ? { labelExpr: "format(datum.value, '.1~f') + '%'" }
    : money ? { labelExpr: `${q(sym)} + format(datum.value, '${digits}')` }
    : { format: digits };
  const x = { field: "x", type: "ordinal", sort: null, axis: { title: null, labelAngle: 0, labelOverlap: "parity", grid: false, ticks: false } };
  const y = { field: "y", type: "quantitative", scale: { zero: false }, axis: { title: null, tickCount: 4, ...axis } };
  const isLast = { filter: `datum.i === ${n - 1}` };
  const { values: limits } = limitsOf(card);
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    background: null,
    layer: [
      { data: { values }, mark: { type: "line" }, encoding: { x, y } },
      { data: { values }, transform: [isLast], mark: { type: "point" }, encoding: { x, y } },
      { data: { values }, transform: [isLast], mark: { type: "text", dy: 14, align: "right" }, encoding: { x, y, text: { value: last } } },
      ...limits.flatMap(limit => [
        { data: { values: [{ y: limit }] }, mark: { type: "rule" }, encoding: { y: { field: "y", type: "quantitative" } } },
        { data: { values: [{ y: limit }] }, mark: { type: "text", align: "left", dx: 4, dy: -7, x: 0 },
          encoding: { y: { field: "y", type: "quantitative" }, text: { value: "Limit" } } },
      ]),
    ],
  };
}

function TrendTile({ cs, trend, status, sym, doors, place }: { cs: CardState & { card: DashboardCard }; trend: SeriesTrend; status: CardStatus; sym: string; doors: TileDoors; place: TilePlace }) {
  const numberLook = usePlacementLook().number;
  const { card } = cs;
  const source = sourceOf(card);
  const spec = useMemo(() => trendSpec(trend, card, sym), [trend, card, sym]);
  const n = trend.values.length;
  const newest = `${fmtDate(trend.dates[n - 1], trend.gran)} · ${figureText(trend.values[n - 1], card, sym, numberLook).text}`;
  const [room, height] = useChartHeight(SPAN[place.size].h === 2 ? 340 : 170);
  const chart = useRef<ChartInstance | null>(null);
  const table: CardTable = { columns: ["date", card.title], rows: trend.dates.map((d, i) => [d, trend.values[i]]) };
  return (
    <Frame testid="dashboard-tile" shape="trend" over={status === "over"}
      doors={<Doors card={card} doors={doors} place={place} files={<CardFiles title={card.title} table={table} chart={chart} />} />}>
      <Title title={card.title} right={
        <span className="aug-fs-sm" data-testid="tile-newest" style={{ color: "var(--t1)", fontWeight: 500, whiteSpace: "nowrap" }}>{newest}</span>
      } />
      <div ref={room} style={{ flex: 1, minHeight: 0 }}>
        <VegaChart spec={spec} tier={2} height={height} onReady={i => { chart.current = i; }} />
      </div>
      <Foot icon={source.icon}>{source.words}, by {trend.gran}</Foot>
    </Frame>
  );
}

function RowsTile({ cs, doors, place, focus }: { cs: CardState & { card: DashboardCard }; doors: TileDoors; place: TilePlace; focus?: TileFocus }) {
  const { card, run } = cs;
  const persistViz = usePersistViz(card);
  const source = sourceOf(card);
  const render = (card.render || {}) as {
    chartType?: string; chartConfig?: Record<string, unknown>; custom?: ChartCustom; showDataLabels?: boolean; viz?: VizConfig;
  };
  const [room, height] = useChartHeight(SPAN[place.size].h === 2 ? 400 : 200);
  const chart = useRef<ChartInstance | null>(null);
  return (
    <Frame testid="dashboard-tile" shape="rows"
      doors={<Doors card={card} doors={doors} place={place} files={<CardFiles title={card.title} table={runTable(run)} chart={chart} />} />}>
      <Title title={card.title} />
      <div ref={room} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {run && (
          <ResultChartCard editorKey={card.id} columns={run.columns} rows={run.rows as unknown[][]}
            // the board study — a click filters the dashboard; what is chosen stays lit, beside the card's own exhibit
            onPick={focus?.onPick ? (p) => focus.onPick?.(p) : undefined}
            exhibit={focusExhibit(render.chartConfig, run.columns, focus)}
            chartType={render.chartType ?? null} chartConfig={render.chartConfig ?? null} custom={render.custom ?? null}
            defaultShowLabels={render.showDataLabels} fillHeight={height} config={render.viz ?? null} onConfigChange={persistViz}
            onChartReady={i => { chart.current = i; }} />
        )}
      </div>
      <Foot icon={source.icon}>{source.words}{run?.scoped && !run.scoped.standing ? `, for ${run.scoped.covers}` : ""}</Foot>
    </Frame>
  );
}

/** Arc AP-8 — what a query reading the dashboard's values waits on: a value still being read, or the choice a value read
 *  off a chosen object waits on, in words. */
export type QueryWaiting = { reading: true } | { waiting: ReactNode };

export function DashboardTile({ cs, status, sym, doors, place = STANDING, waits = null, focus }: {
  cs: CardState & { card: DashboardCard }; status: CardStatus; sym: string; doors: TileDoors;
  /** The board study — the dashboard's focus: what is chosen (lit), and where a click on a mark goes. */
  focus?: TileFocus;
  /** The element this tile draws and its size; left out, the tile stands alone at the small size. */
  place?: TilePlace;
  waits?: QueryWaiting | null;
}) {
  // a placed card's own title (v16) stands for the card's wherever a tile names it
  const look = usePlacementLook();
  if (look.title && look.title !== cs.card.title) cs = { ...cs, card: { ...cs.card, title: look.title } };
  if (waits) {
    const chrome = <Doors card={cs.card} doors={doors} place={place} />;
    return "reading" in waits ? <QueryReading title={cs.card.title} doors={chrome} />
      : <Frame testid="dashboard-tile" doors={chrome}><Title title={cs.card.title} />
        <div className="aug-fs-sm" data-testid="query-tile-waiting" style={{ color: "var(--t3)" }}>{waits.waiting}</div></Frame>;
  }
  // Arc AP-7 — a card of a person's own query (the run says how it is shown)
  if (cs.run && "shown" in cs.run && (cs.card.render as { shown?: unknown })?.shown) {
    return <QueryTile cs={cs} doors={doors} place={place} focus={focus} />;
  }
  const shape = tileShape(cs);
  const trend = shape === "trend" && cs.run ? seriesTrend(cs.run.columns, cs.run.rows) : null;
  if (trend) return <TrendTile cs={cs} trend={trend} status={status} sym={sym} doors={doors} place={place} />;
  if (shape === "rows") return <RowsTile cs={cs} doors={doors} place={place} focus={focus} />;
  return <FigureTile cs={cs} status={status} sym={sym} doors={doors} place={place} />;
}

const ROWS_HEAD_PX = 28;
const ROWS_ROW_PX = 27;
const ROWS_PAGER_PX = 32;
const NUMERIC_TYPE = /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL/i;

/** A query card's table, a page at a time (study R26): as many rows as its box holds, numbered pages beneath. The count is
 *  the rows the card holds, said as the first of more when the query returned more than a card keeps. */
export function QueryRows({ shaped, height }: { shaped: Extract<QueryShaped, { as: "table" }>; height: number }) {
  // v17 — a number column drawn as a bar or a colour scale, against every row the card holds (not the page alone)
  const looks = usePlacementLook().columns;
  const names = shaped.columns.map(c => c.name);
  const ranges = useMemo(() => columnRanges(names, shaped.rows as unknown[][], looks),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rows and the looks are what it reads
    [shaped.rows, looks]);
  const per = Math.max(3, Math.floor((height - ROWS_HEAD_PX - ROWS_PAGER_PX) / ROWS_ROW_PX));
  const pages = Math.max(1, Math.ceil(shaped.rows.length / per));
  const [page, setPage] = useState(1);
  // a new run starts on its first page
  useEffect(() => { setPage(1); }, [shaped.rows]);
  const at = Math.min(page, pages);
  const from = (at - 1) * per;
  const shown = shaped.rows.slice(from, from + per);
  const right = (j: number) => NUMERIC_TYPE.test(shaped.columns[j]?.type ?? "");
  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table className="aug-fs-sm" style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead><tr>{shaped.columns.map((c, j) => (
            <th key={`${c.name}-${j}`} style={{ textAlign: right(j) ? "right" : "left", color: "var(--t3)", fontWeight: 500, padding: "4px 6px", borderBottom: "1px solid var(--b1)", whiteSpace: "nowrap" }}>{c.name}</th>
          ))}</tr></thead>
          <tbody>{shown.map((r, i) => (
            <tr key={from + i}>{r.map((v, j) => (
              <td key={j} style={{ padding: "4px 6px", borderBottom: "1px solid var(--b1)", whiteSpace: "nowrap", textAlign: right(j) ? "right" : "left",
                ...cellLook(v, looks?.[names[j]], ranges[names[j]]) }}>
                {cellText(v, shaped.columns[j]?.type, undefined, "", "", names[j])}
              </td>
            ))}</tr>
          ))}</tbody>
        </table>
      </div>
      {pages > 1 && (
        <div data-testid="query-tile-pages" className="aug-fs-xs"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 6, color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>
          <span>{formatCount(from + 1)}–{formatCount(from + shown.length)} of {shaped.more ? `the first ${formatCount(shaped.rows.length)}` : formatCount(shaped.rows.length)}</span>
          <NumberedPager testid="query-tile-pager" page={at} pages={pages} onPage={setPage} />
        </div>
      )}
    </>
  );
}

/** Arc AP-7 — a card of a person's own query, as they set it up: its figure, its table or its chart, and what the run
 *  left out said beneath it. A query that cannot be read says why, in its place. */
function QueryTile({ cs, doors, place, focus }: { cs: CardState & { card: DashboardCard }; doors: TileDoors; place: TilePlace; focus?: TileFocus }) {
  const numberLook = usePlacementLook().number;
  // v17 — the colours the dashboard keeps for the split's values
  const keptColors = useValueColors();
  const chart = useRef<ChartInstance | null>(null);
  const { card, run } = cs;
  const shaped = run?.shown ?? null;
  const setup = (card.render as { shown?: QueryShown }).shown;
  const viz = (card.render as { viz?: VizConfig }).viz;
  const persistViz = usePersistViz(card);
  const [room, height] = useChartHeight(SPAN[place.size].h === 2 ? 400 : 200);
  // the board study — any kind an answer's chart draws, when one beyond the query's own six is asked for
  const anyKind = !!shaped && shaped.as !== "figure" && shaped.as !== "table" && isOtherKind(viz?.type);
  const chosen = shaped && shaped.as !== "figure" && shaped.as !== "table" ? focus?.chosen?.(shaped.x.name) ?? null : null;
  const spec = useMemo(() => {
    if (!shaped || !setup || shaped.as === "figure" || shaped.as === "table" || anyKind) return null;
    const t = readVegaTokens();
    return queryChartSpec(shaped, setup, { palette: t.palette, other: t.deemph }, chosen, keptColors?.[setup.split], chartOptionsOf(viz));
  }, [shaped, setup, anyKind, chosen, keptColors, viz]);
  const grid = useMemo(() => (anyKind && shaped && setup ? queryGrid(shaped as Parameters<typeof queryGrid>[0], setup) : null),
    [anyKind, shaped, setup]);
  // A card drafted from a file says what it means, read off its statement: under a figure always, under a chart behind Details.
  const drafted = (card.render as { drafted_by_model?: boolean }).drafted_by_model === true;
  const definition = (card.render as { definition?: string }).definition ?? "";
  const [details, setDetails] = useState(false);
  const foot = drafted ? (
    <Foot icon="sql" aside={<Button size="xs" variant="ghost" aria-expanded={details} data-testid="query-tile-details" onClick={() => setDetails(d => !d)}>Details</Button>}>
      Reads the sheet
    </Foot>
  ) : (
    <Foot icon="sql">
      Your query{run?.duration_ms != null ? ` · ${formatSeconds(run.duration_ms)}` : ""}
      {run?.scoped && !run.scoped.standing ? `, for ${run.scoped.covers}` : ""} · read straight from the tables
    </Foot>
  );
  const explained = details && (
    <div data-testid="query-tile-explained" className="aug-fs-xs" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--t2)" }}>
      <div>{definition || "This query is too involved to say in words. Read it below."}</div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", background: "var(--bg-3)", border: "1px solid var(--b0)", borderRadius: "var(--r2)", padding: "6px 8px" }}>{card.sql}</pre>
    </div>
  );
  const beside = shaped?.as === "figure" && shaped.beside && shaped.beside.value !== null ? shaped.beside : null;
  if (!shaped) return <QueryUnread title={card.title} why={run?.error || "It returned nothing this card can read."} doors={<Doors card={card} doors={doors} place={place} />} />;
  const said = shaped.said.length > 0 && (
    <div className="aug-fs-xs" data-testid="query-tile-said" style={{ color: "var(--t3)" }}>{shaped.said.join(" ")}</div>
  );
  return (
    <Frame testid="dashboard-tile" shape={shaped.as === "figure" ? "figure" : "rows"}
      doors={<Doors card={card} doors={doors} place={place} files={<CardFiles title={card.title} table={shapedTable(shaped, setup)}
        chart={shaped.as === "figure" || shaped.as === "table" ? undefined : chart} />} />}>
      <Title title={card.title} muted={shaped.as === "figure"} />
      {shaped.as === "figure" ? (
        <div data-testid="query-tile-figure" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span data-testid="query-tile-value" className="aug-fs-display" style={{ lineHeight: 1.1, letterSpacing: "-0.02em", fontWeight: 600, color: "var(--t1)", fontVariantNumeric: "tabular-nums" }}>{shaped.format || numberLook ? draftedFigure(shaped.value, shaped.format, numberLook) : formatMetricValue(shaped.value)}</span>
            {beside && (
              <span data-testid="query-tile-beside" className="aug-fs-sm" style={{ padding: "0 6px", borderRadius: "var(--r2)", background: "var(--bg-3)", color: "var(--t2)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {besideText(beside, numberLook)}
              </span>
            )}
          </span>
          <span className="aug-fs-sm" data-testid="query-tile-definition" style={{ color: "var(--t3)" }}>{drafted && definition ? definition : shaped.label}</span>
        </div>
      ) : shaped.as === "table" ? (
        <div ref={room} data-testid="query-tile-table" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <QueryRows shaped={shaped} height={height} />
        </div>
      ) : (
        <div ref={room} data-testid="query-tile-chart" style={{ flex: 1, minHeight: 0 }}>
          {spec && <VegaChart spec={spec} tier={2} height={height} onReady={i => { chart.current = i; }}
            onSelect={focus?.onPick ? (d) => {
              // the place a click stands for, as the query returned it — never the words it was drawn with
              if (d && "xr" in d && d.xr !== null && d.xr !== undefined) {
                focus.onPick?.({ field: shaped.x.name, value: d.xr as string | number });
              }
            } : undefined} />}
          {grid && (
            <ResultChartCard editorKey={card.id} columns={grid.columns} rows={grid.rows} chartType={viz?.type ?? null} config={viz ?? null}
              onConfigChange={persistViz} fillHeight={height} exhibit={chosen ? { emphasis: chosen } : undefined} onChartReady={i => { chart.current = i; }}
              onPick={focus?.onPick ? (p) => focus.onPick?.(p) : undefined} />
          )}
        </div>
      )}
      {said}
      {explained}
      {foot}
    </Frame>
  );
}

/** The board study — what a dashboard's focus asks of a tile: the values chosen for a field (lit on its chart), and where
 *  a click on a mark goes. */
export interface TileFocus {
  chosen?: (field: string) => string[] | null;
  onPick?: (pick: ChartPick) => void;
}

/** A card's own exhibit with the dashboard's chosen values laid over it — undefined when nothing is chosen, so the card's
 *  stored exhibit is read as it always was. */
function focusExhibit(chartConfig: Record<string, unknown> | undefined, columns: string[], focus?: TileFocus) {
  const chosen = columns.map(c => focus?.chosen?.(c) ?? null).find(v => v && v.length);
  if (!chosen) return undefined;
  const own = (chartConfig?.exhibit ?? {}) as Record<string, unknown>;
  return { ...own, emphasis: chosen } as never;
}

/** A kind an answer's chart draws that a query card's own six do not (bar, line, area, scatter, a figure, a table). */
const OWN_SIX = new Set(["auto", "bar", "line", "area", "scatter", "table", "figure"]);
export function isOtherKind(type: string | null | undefined): boolean {
  return !!type && !OWN_SIX.has(type) && (ALL_CHART_TYPES as readonly string[]).includes(type);
}

/** A query card's chart points as a result grid — the place, its series when split, its measure by its own column name
 *  (so a money column still reads as money) — for an answer's chart to draw. */
export function queryGrid(c: Extract<QueryShaped, { as: "bar" | "line" | "area" | "scatter" }>,
  setup: Pick<QueryShown, "series" | "split">): { columns: string[]; rows: unknown[][] } {
  const measure = setup.series?.[0]?.column || "value";
  const split = c.series.length > 1 || (c.series.length === 1 && c.series[0] !== "");
  return split
    ? { columns: [c.x.name, setup.split || "series", measure], rows: c.points.map(p => [p.x, p.s || "", p.v]) }
    : { columns: [c.x.name, measure], rows: c.points.map(p => [p.x, p.v]) };
}

/** A card's run as rows to take away. */
function runTable(run: CardState["run"]): CardTable | null {
  return run?.columns?.length ? { columns: run.columns, rows: (run.rows ?? []) as CsvCell[][] } : null;
}

/** A query card's result as rows to take away: its table, its chart's points, or its figure. */
export function shapedTable(shaped: QueryShaped, setup?: QueryShown): CardTable | null {
  if (shaped.as === "table") return { columns: shaped.columns.map(c => c.name), rows: shaped.rows as CsvCell[][] };
  if (shaped.as === "figure") return { columns: [shaped.label || "value"], rows: [[shaped.value]] };
  return setup ? (queryGrid(shaped, setup) as CardTable) : null;
}

/** A value said beside a figure, in the form its statement asked for. */
function besideText(b: { value: number | null; words: string; format: string }, look: NumberLook | null = null): string {
  const text = draftedFigure(b.value, b.format, look);
  return b.words ? `${text} ${b.words}` : text;
}

/** A query reading a value still being read: its place held, and marked reading for the builder's checks. */
function QueryReading({ title, doors }: { title: string; doors: ReactNode }) {
  useMarkRead("reading");
  return (
    <Frame testid="dashboard-tile" doors={doors}>
      <Title title={title} />
      <div className="aug-fs-sm" data-testid="query-tile-reading" style={{ color: "var(--t3)" }}>Reading…</div>
    </Frame>
  );
}

/** A query card that cannot be read, in its place — said, and marked for the builder's checks. */
function QueryUnread({ title, why, doors }: { title: string; why: string; doors: ReactNode }) {
  useMarkRead("refused", `${title}: ${why}`);
  return (
    <Frame testid="dashboard-tile" dashed doors={doors}>
      <Title title={title} />
      <div className="aug-fs-sm" data-testid="query-tile-unread" style={{ color: "var(--t2)" }}>This query cannot be read: {why}</div>
    </Frame>
  );
}

/** A card the reader may not see, in its place: said, never an empty box. */
export function WithheldTile() {
  useMarkRead("refused", "Withheld: you may not see this card");
  return (
    <Frame testid="dashboard-card-said">
      <div className="aug-fs-ui" style={{ color: "var(--t2)" }}>Withheld</div>
      <div className="aug-fs-h1" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--t1)" }}>
        <Icon name="eyeoff" size={18} /> Not shown
      </div>
      <div className="aug-fs-sm" style={{ color: "var(--t2)" }}>You may not see this card.</div>
      <Foot icon="info">It is here, and it is not empty</Foot>
    </Frame>
  );
}

/** A placed card the reader does not have, or one that failed to draw. */
export function SaidTile({ what, children }: { what: string; children: ReactNode }) {
  useMarkRead("refused", what);
  return (
    <Frame testid="dashboard-card-said" dashed>
      <div className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 500 }}>{what}</div>
      <div className="aug-fs-sm" style={{ color: "var(--t2)" }}>{children}</div>
    </Frame>
  );
}
