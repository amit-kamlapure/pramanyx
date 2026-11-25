"use client";

/**
 * The Atlas, by Area — the organisation's map, where the Ontology page opens (2026-11-25, the Atlas-by-Area plan's A4a;
 * `docs/AREA_MAP_PLAN_2026-11-25.md` §3.1, the mockup's first screen). Every Area in view is a bubble, its glyph and its
 * name, sized by how many of the month's answers drew on it; the model's suggested Areas dashed; what sits in no Area
 * and the Areas that hold nothing said apart. The side panel tells the month: the answers, the share that drew on
 * governed knowledge, the share placed in an Area, who answers for the Areas, what is used most — and, on its Review tab,
 * what waits in each Area. A bubble chosen turns the panel into that Area's. One colour, as every tile on the platform.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MUTED, ROW } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { Loading, ReadFailed } from "@/components/ui/states";
import { areaIcon } from "@/lib/areaIcons";
import {
  bounds, changeWords, packBubbles, radiusFor, R_MIN, share, waiting, waitingWords, type Atlas, type AtlasArea,
} from "@/lib/areaMap";
import { holdsWords, ownersLine, readAtlas, usageLine } from "@/lib/discover";
import { formatCount } from "@/lib/format";
import { getActiveWorkspace } from "@/lib/workspace";

const SUGGESTED = "suggested:";
const PAD = 24;

function Figure({ value, label, sub, testId }: { value: string; label: string; sub?: string; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span className="aug-fs-chrome" style={{ color: "var(--t1)", fontWeight: 600 }}>{value}</span>
      <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{label}</span>
      {sub && <span className="aug-fs-xs" style={MUTED}>{sub}</span>}
    </div>
  );
}

function Overview({ atlas }: { atlas: Atlas }) {
  const f = atlas.figures;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: "var(--r3)", background: "var(--bg-0)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span data-testid="atlas-answers" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="aug-fs-display" style={{ color: "var(--t1)", fontWeight: 700 }}>{formatCount(f.answers)}</span>
            <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`answers in the last ${f.window_days} days that ran SQL`}</span>
          </span>
          {changeWords(f.answers, f.previous, f.window_days) && (
            <span className="aug-fs-xs" style={MUTED}>{changeWords(f.answers, f.previous, f.window_days)}</span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <Figure testId="atlas-governed" value={share(f.governed, f.answers)} label="Governed reach"
            sub={`${f.governed} drew on an approved metric, a published Definition or a trusted query (Definitions counted since ${f.given_since})`} />
          <Figure testId="atlas-coverage" value={share(f.in_an_area, f.answers)} label="Area coverage"
            sub={`${f.in_an_area} read a table placed in an Area`} />
        </div>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="aug-fs-xs" style={MUTED}>Who answers for it</span>
        <span className="aug-fs-sm" data-testid="atlas-contacts"
          style={{ color: atlas.contacts.named ? "var(--t1)" : "var(--amb4)" }}>
          {`${atlas.contacts.named} of ${atlas.contacts.of} Areas name a Business or Technical contact`}
        </span>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="aug-fs-xs" style={MUTED}>Used most this month</span>
        {atlas.most_used.length === 0 ? (
          <span className="aug-fs-sm" style={MUTED}>Nothing was opened or used in an answer this month.</span>
        ) : atlas.most_used.map((i) => (
          <a key={`${i.kind}:${i.id}`} href={i.href || undefined} style={{ display: "flex", flexDirection: "column", gap: 1, color: "var(--t1)" }}>
            <span className="aug-fs-sm">{i.name}</span>
            <span className="aug-fs-xs" style={MUTED}>{[i.kind, usageLine(i.use)].filter(Boolean).join(" · ")}</span>
          </a>
        ))}
      </section>
    </div>
  );
}

function Review({ atlas, onPick }: { atlas: Atlas; onPick: (id: string) => void }) {
  if (!atlas.review) {
    return <span className="aug-fs-sm" style={MUTED}>{atlas.said[0] ?? "What waits for review is being read."}</span>;
  }
  const rows = [...atlas.areas].filter((a) => waiting(a.review) || a.learned).sort((a, b) => waiting(b.review) - waiting(a.review));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="aug-fs-sm" data-testid="atlas-review-total" style={{ color: "var(--t2)" }}>
        {`${formatCount(atlas.review.total)} wait for review, ${formatCount(atlas.review.unplaced)} in no Area`}
        {atlas.read_at && ` · read at ${new Date(atlas.read_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
      </span>
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -8px" }}>
        {rows.map((a) => (
          <Button key={a.id} role="listitem" variant="ghost" size="sm" onClick={() => onPick(a.id)}
            style={{ justifyContent: "flex-start", gap: 10, height: "auto", padding: "6px 8px", textAlign: "left" }}>
            <IconSquare name={areaIcon(a.icon)} size={22} />
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{a.name}</span>
              <span className="aug-fs-xs" style={MUTED}>{waitingWords(a.review, a.learned)}</span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function AreaPanel({ area, onBack }: { area: AtlasArea; onBack: () => void }) {
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
      <span className="aug-fs-sm" style={{ color: area.business_owners.length || area.technical_owners.length ? "var(--t2)" : "var(--amb4)" }}>
        {ownersLine(area)}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: "var(--r3)", background: "var(--bg-0)" }}>
        <span className="aug-fs-sm" style={{ color: "var(--t1)" }} data-testid="atlas-area-answers">
          {`${formatCount(area.answers)} answer${area.answers === 1 ? "" : "s"} this month drew on it`}
        </span>
        <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`Holds ${holdsWords(area.counts) || "nothing yet"}`}</span>
        <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{`Waiting: ${waitingWords(area.review, area.learned)}`}</span>
        {area.connections.length > 0 && (
          <span className="aug-fs-xs" style={MUTED}>{`On ${area.connections.length} connection${area.connections.length === 1 ? "" : "s"}`}</span>
        )}
      </div>
      <a href={`/?view=discover&tab=discover&id=${encodeURIComponent(area.id)}`} className="aug-fs-sm">Open its page in Discover</a>
    </div>
  );
}

export function AreaMap() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [failed, setFailed] = useState("");
  const [tab, setTab] = useState<"overview" | "review">("overview");
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ w: 900, h: 640 });
  const canvas = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    readAtlas<Atlas>(getActiveWorkspace() || undefined).then((a) => { setAtlas(a); setFailed(""); })
      .catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [atlas]);

  const suggested = useMemo(() => {
    const by = new Map<string, { label: string; where: string[] }>();
    for (const s of atlas?.suggested ?? []) {
      const k = s.label.toLowerCase();
      by.set(k, { label: s.label, where: [...(by.get(k)?.where ?? []), s.connection_name] });
    }
    return [...by.values()];
  }, [atlas]);
  const placed = useMemo(() => packBubbles([
    ...(atlas?.areas ?? []).map((a) => ({ id: a.id, r: radiusFor(a.answers) })),
    ...suggested.map((s) => ({ id: SUGGESTED + s.label, r: R_MIN })),
  ]), [atlas, suggested]);

  if (failed) return <ReadFailed what="the Atlas" error={failed} onRetry={load} />;
  if (!atlas) return <Loading what="the Areas of the business" />;

  const box = bounds(placed);
  const fit = Math.min((size.w - 2 * PAD) / box.width, (size.h - 2 * PAD - 40) / box.height, 1.3);
  const scale = Math.max(0.3, fit) * zoom;
  const at = (p: { x: number; y: number }) => ({
    left: size.w / 2 + (p.x - (box.minX + box.width / 2)) * scale,
    top: (size.h - 40) / 2 + 20 + (p.y - (box.minY + box.height / 2)) * scale,
  });
  const byId = new Map(atlas.areas.map((a) => [a.id, a]));
  const chosen = picked ? byId.get(picked) ?? null : null;
  const other = atlas.everything_else;

  return (
    <div data-testid="area-map" style={{ flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap" }}>
      <aside aria-label="The Areas at a glance" style={{ flex: "1 1 320px", maxWidth: 380, minWidth: 0, background: "var(--bg-2)",
        padding: "14px 16px 20px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", boxSizing: "border-box" }}>
        {chosen ? <AreaPanel area={chosen} onBack={() => setPicked(null)} /> : (
          <>
            <div role="tablist" aria-label="The side panel" style={{ ...ROW, gap: 18 }}>
              {(["overview", "review"] as const).map((t) => (
                <Button key={t} role="tab" aria-selected={tab === t} variant="ghost" size="xs" onClick={() => setTab(t)}
                  style={tab === t ? { color: "var(--t1)", boxShadow: "inset 0 -2px 0 var(--accent)", borderRadius: 0 } : { color: "var(--t2)" }}>
                  {t === "overview" ? "Overview" : `Review${atlas.review ? ` ${formatCount(atlas.review.total)}` : ""}`}
                </Button>
              ))}
            </div>
            {tab === "overview" ? <Overview atlas={atlas} /> : <Review atlas={atlas} onPick={setPicked} />}
          </>
        )}
      </aside>
      <section ref={canvas} aria-label="The Areas of the business" style={{ flex: "999 1 480px", minWidth: 0, minHeight: 520, position: "relative",
        overflow: "hidden", backgroundColor: "var(--bg-0)", backgroundImage: "radial-gradient(var(--bg-hover) 1px, transparent 1px)",
        backgroundSize: "18px 18px" }}>
        {other.total > 0 && (
          <span className="aug-fs-xs" data-testid="atlas-everything-else" style={{ position: "absolute", left: 14, top: 12, zIndex: 2,
            padding: "4px 10px", borderRadius: 12, background: "var(--bg-2)", color: "var(--t2)" }}>
            {`Everything else · ${formatCount(other.total)} things in no Area${other.answers ? ` · ${formatCount(other.answers)} answers read no placed table` : ""}`}
          </span>
        )}
        {placed.map((p) => {
          const area = byId.get(p.id);
          const sug = p.id.startsWith(SUGGESTED) ? suggested.find((s) => SUGGESTED + s.label === p.id) : null;
          const d = 2 * p.r * scale;
          const pos = at(p);
          return (
            <Button key={p.id} variant="ghost" data-testid={area ? `atlas-bubble-${area.id}` : "atlas-bubble-suggested"}
              aria-pressed={area ? picked === area.id : undefined} disabled={!area}
              aria-label={area ? `${area.name}: ${area.answers} answers this month, holds ${area.total}` : `${sug?.label}, suggested by the model`}
              onClick={() => area && setPicked(picked === area.id ? null : area.id)}
              style={{ position: "absolute", left: pos.left - d / 2, top: pos.top - d / 2, width: d, height: d, padding: 4,
                borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                background: area ? "var(--bg-2)" : "transparent", opacity: 1,
                boxShadow: area ? (picked === area.id ? "0 0 0 2px var(--accent)" : "inset 0 0 0 1px var(--b0)") : "inset 0 0 0 1px var(--b1)",
                border: area ? "none" : "1px dashed var(--t4)", color: "var(--t1)", whiteSpace: "normal" }}>
              <IconSquare name={areaIcon(area?.icon)} size={Math.max(18, Math.min(28, d / 5))} />
              <span className="aug-fs-sm" style={{ fontWeight: 600, lineHeight: 1.15, textAlign: "center", padding: "0 6px" }}>
                {area ? area.name : sug?.label}
              </span>
              <span className="aug-fs-xs" style={{ ...MUTED, textAlign: "center", padding: "0 8px", lineHeight: 1.2 }}>
                {area ? `${formatCount(area.answers)} answer${area.answers === 1 ? "" : "s"} · ${formatCount(area.total)} things`
                  : `Suggested · ${sug?.where.join(", ")}`}
              </span>
            </Button>
          );
        })}
        {atlas.quiet.length > 0 && (
          <span className="aug-fs-xs" data-testid="atlas-quiet" style={{ position: "absolute", left: 14, bottom: 12, maxWidth: "60%", ...MUTED }}>
            {`${atlas.quiet.length} hold nothing yet — ${atlas.quiet.map((q) => q.name).join(", ")}`}
          </span>
        )}
        <div role="group" aria-label="Zoom" style={{ position: "absolute", right: 12, bottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <Button size="icon-sm" variant="secondary" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z * 1.25))}><Icon name="plus" size={14} /></Button>
          <Button size="icon-sm" variant="secondary" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}><Icon name="minus" size={14} /></Button>
          <Button size="icon-sm" variant="secondary" aria-label="Fit the map" onClick={() => setZoom(1)}><Icon name="expand" size={14} /></Button>
        </div>
      </section>
    </div>
  );
}
