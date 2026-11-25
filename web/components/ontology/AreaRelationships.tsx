"use client";

/**
 * An Area's relationships, plainly (the Atlas plan's A6; the user, 2026-11-25, of the raised Business Atlas: "I don't
 * want this isometric view at all.. don't know what purpose it serves"). What the picture is for: which entities stand
 * in the Area, how they link — each link named by its verb, with its cardinality — which links leave the Area and for
 * where, and how the Area's processes move, stage by stage, with their counts and what is overdue. The entities are
 * laid out as the entity map lays out a connection (`lib/entityMapLayout.ts`), here only the Area's; an entity pressed
 * opens on the right, as everything pressed on the Atlas does.
 */
import { useEffect, useMemo, useState } from "react";

import { MUTED, ROW } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/states";
import { readAreas } from "@/lib/areas";
import { readDiscoverItems } from "@/lib/discover";
import { CARD, collapseParts, hubOf, ringsOf } from "@/lib/entityMapLayout";
import { formatCount } from "@/lib/format";
import { getProcesses, getTypeMap, type ProcessesAndRules, type TypeMap, type TypeMapRow } from "@/lib/objectTypes";

/** One connection's entities in an Area, the links among them, the links that leave it, its processes. */
export interface AreaPart {
  map: TypeMap;
  leaving: { from: string; verb: string; to: string; toArea: string }[];
  processes: ProcessesAndRules["processes"];
}

/** Split a connection's entity map by Area: the entities whose table is placed in ``area``, the links among them, the
 *  links from them to an entity elsewhere (with that entity's Area, or "no Area"), and the processes of its entities. */
export function partOf(map: TypeMap, declared: ProcessesAndRules | null, areaOfTable: Map<string, { id: string; name: string }>,
  area: string): AreaPart {
  const areaOf = (t: TypeMapRow) => areaOfTable.get(String(t.table || "").split(".").pop()!.toLowerCase());
  // a part is read under its parent, as the entity map reads it: its links are its parent's, said through it
  const folded = collapseParts(map);
  const standing = folded.object_types;
  const inside = new Set(standing.filter((t) => areaOf(t)?.id === area).map((t) => t.object_type));
  const byName = new Map(map.object_types.map((t) => [t.object_type, t]));
  const leaving: AreaPart["leaving"] = [];
  const said = new Set<string>();
  for (const l of folded.links) {
    const a = inside.has(l.from), b = inside.has(l.to);
    if (a === b) continue;
    const [here, there] = a ? [l.from, l.to] : [l.to, l.from];
    const far = byName.get(there);
    const out = { from: byName.get(here)?.display_name ?? here, verb: (l.verb || l.business_name || "").replace(/_/g, " "),
      to: far?.display_name ?? there, toArea: far ? areaOf(far)?.name ?? "no Area" : "no Area" };
    const key = `${out.from}|${out.verb}|${out.to}`;
    if (!said.has(key)) { said.add(key); leaving.push(out); }      // one link said once, however many relationships carry it
  }
  const ids = new Set(standing.filter((t) => inside.has(t.object_type)).map((t) => t.id));
  return {
    map: { ...folded, object_types: standing.filter((t) => inside.has(t.object_type)),
      links: folded.links.filter((l) => inside.has(l.from) && inside.has(l.to)) },
    leaving,
    processes: (declared?.processes ?? []).filter((p) => ids.has(p.entity_id)),
  };
}

/** Gaps between columns of cards (where a link's words sit) and between cards in a column. */
const ACROSS = 150;
const DOWN = 28;

/** An Area's entities laid out to one side, as the rest of the Atlas opens: the one with the most links on the left, the
 *  entities one link from it in a column to its right, two links further right, and those no link reaches last. At
 *  their own size, so the words stay readable. */
export function areaLayout(map: TypeMap): { nodes: { objectType: string; x: number; y: number }[]; width: number; height: number } {
  const hub = hubOf(map);
  if (!hub) return { nodes: [], width: 0, height: 0 };
  const rings = ringsOf(map, hub);
  const columns = new Map<number, string[]>();
  for (const t of map.object_types) {
    const ring = rings.get(t.object_type) ?? -1;
    columns.set(ring, [...(columns.get(ring) ?? []), t.object_type]);
  }
  const order = [...columns.keys()].sort((a, b) => (a < 0 ? 1e9 : a) - (b < 0 ? 1e9 : b));
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));
  const height = tallest * CARD.h + (tallest - 1) * DOWN;
  const nodes = order.flatMap((ring, col) => {
    const names = columns.get(ring)!;
    const top = (height - (names.length * CARD.h + (names.length - 1) * DOWN)) / 2;
    return names.map((objectType, row) => ({ objectType, x: col * (CARD.w + ACROSS) + CARD.w / 2, y: top + row * (CARD.h + DOWN) + CARD.h / 2 }));
  });
  return { nodes, width: order.length * CARD.w + (order.length - 1) * ACROSS, height };
}

function Graph({ part, onOpen }: { part: AreaPart; onOpen: (row: TypeMapRow) => void }) {
  const layout = useMemo(() => areaLayout(part.map), [part.map]);
  if (!layout.nodes.length) return null;
  const at = new Map(layout.nodes.map((n) => [n.objectType, n]));
  const byName = new Map(part.map.object_types.map((t) => [t.object_type, t]));
  return (
    <div style={{ overflowX: "auto" }}>
      <div data-testid="area-relationships-graph" style={{ position: "relative", width: layout.width, height: layout.height }}>
        <svg aria-hidden width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {part.map.links.map((l) => {
            const a0 = at.get(l.from), b0 = at.get(l.to);
            if (!a0 || !b0 || l.from === l.to) return null;
            const [a, b] = a0.x <= b0.x ? [a0, b0] : [b0, a0];
            const sameColumn = a.x === b.x;
            // a link leaves a card on its right and arrives on the next one's left; in one column it runs down the right
            const x1 = a.x + CARD.w / 2, y1 = a.y, x2 = sameColumn ? b.x + CARD.w / 2 : b.x - CARD.w / 2, y2 = b.y;
            const bend = sameColumn ? 40 : (x2 - x1) / 2;
            const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - (sameColumn ? -bend : bend)} ${y2}, ${x2} ${y2}`;
            const words = `${(l.verb || l.business_name || "").replace(/_/g, " ")}${l.cardinality ? ` · ${l.cardinality}` : ""}${"via" in l && l.via ? ` · through ${l.via}` : ""}`;
            return (
              <g key={`${l.from}>${l.to}:${l.relationship}`}>
                <path d={d} fill="none" stroke="var(--b1)" strokeWidth={1.2} />
                <text x={sameColumn ? x1 + 46 : (x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor={sameColumn ? "start" : "middle"}
                  fill="var(--t2)" className="aug-fs-xs">{words}</text>
              </g>
            );
          })}
        </svg>
        {layout.nodes.map((n) => {
          const t = byName.get(n.objectType);
          if (!t) return null;
          return (
            <Button key={n.objectType} variant="secondary" data-testid={`area-entity-${t.object_type}`} onClick={() => onOpen(t)}
              style={{ position: "absolute", left: n.x - CARD.w / 2, top: n.y - CARD.h / 2, width: CARD.w, height: CARD.h, display: "flex",
                flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 2, padding: "6px 10px", whiteSpace: "normal" }}>
              <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>{t.display_name}</span>
              <span className="aug-fs-xs" style={MUTED}>
                {[t.rows === null || t.rows === undefined ? "not counted" : `${formatCount(t.rows)} rows`,
                  t.key ? `key ${t.key}${t.key_verified ? " ✓" : ""}` : "no key yet"].join(" · ")}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function Processes({ processes }: { processes: AreaPart["processes"] }) {
  if (!processes.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label="Its processes">
      <span className="aug-fs-xs" style={MUTED}>How it moves</span>
      {processes.map((p) => (
        <div key={p.id} data-testid="area-process" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>{p.display_name || p.id}</span>
          <span style={{ ...ROW, gap: 6, flexWrap: "wrap" }}>
            {p.stages.map((s, i) => (
              <span key={`${p.id}#${i}`} className="aug-fs-sm" style={{ ...ROW, gap: 6, color: "var(--t2)" }}>
                {i > 0 && <span style={MUTED}>→</span>}
                <span style={{ color: "var(--t1)" }}>{s.display_name || s.name}</span>
                <span>{s.reached === null || s.reached === undefined ? "not counted" : formatCount(s.reached)}</span>
                {s.promise && (s.promise.open_overdue ?? 0) > 0 && (
                  <span style={{ color: "var(--red4)" }}>{`${formatCount(s.promise.open_overdue as number)} overdue`}</span>
                )}
              </span>
            ))}
            {p.leaves && <span className="aug-fs-sm" style={MUTED}>{`· ${formatCount(p.leaves.left)} left (${p.leaves.values.join(", ")})`}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}

/** An Area's relationships on each connection it spans. */
export function AreaRelationships({ area, connections, onOpenEntity }: {
  area: string; connections: { id: string; name: string }[];
  onOpenEntity: (row: TypeMapRow, connection: { id: string; name: string }) => void;
}) {
  const [parts, setParts] = useState<Record<string, AreaPart | "failed">>({});
  // the connections by their ids and names: a list built afresh on each render of the page is the same list
  const which = connections.map((c) => `${c.id}\t${c.name}`).join("\n");
  useEffect(() => {
    const list = which ? which.split("\n").map((l) => ({ id: l.split("\t")[0], name: l.split("\t")[1] ?? "" })) : [];
    for (const c of list) {
      Promise.all([getTypeMap(c.id), getProcesses(c.id).catch(() => null),
        readDiscoverItems({ kind: "table", connectionId: c.id, limit: 200 }), readAreas(c.id)])
        .then(([map, declared, tables, areas]) => {
          const names = new Map(areas.areas.map((a) => [a.id, a.name]));
          const placed = new Map<string, { id: string; name: string }>();
          for (const t of tables.items) {
            if (t.connection_id === c.id && t.area && names.has(t.area)) placed.set(t.name.toLowerCase(), { id: t.area, name: names.get(t.area)! });
          }
          setParts((was) => ({ ...was, [c.id]: partOf(map, declared, placed, area) }));
        })
        .catch(() => setParts((was) => ({ ...was, [c.id]: "failed" })));
    }
  }, [area, which]);
  return (
    <div data-testid="area-relationships" style={{ display: "flex", flexDirection: "column", gap: 20, padding: "8px 16px 24px" }}>
      {connections.length === 0 && <span className="aug-fs-sm" style={MUTED}>The Area is on no connection in view.</span>}
      {connections.map((c) => {
        const part = parts[c.id];
        return (
          <section key={c.id} style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-label={`On ${c.name}`}>
            <span className="aug-fs-xs" style={MUTED}>{`On ${c.name}`}</span>
            {part === undefined ? <Loading what={`${c.name}'s entities`} />
              : part === "failed" ? <span className="aug-fs-sm" style={{ color: "var(--red4)" }}>{`${c.name}'s entities could not be read.`}</span>
              : (
                <>
                  {part.map.object_types.length === 0
                    ? <span className="aug-fs-sm" style={MUTED}>No entity of this connection has its table placed in this Area.</span>
                    : <Graph part={part} onOpen={(row) => onOpenEntity(row, c)} />}
                  {part.leaving.length > 0 && (
                    <section style={{ display: "flex", flexDirection: "column", gap: 3 }} aria-label="Links that leave the Area">
                      <span className="aug-fs-xs" style={MUTED}>Links that leave the Area</span>
                      {part.leaving.map((l, i) => (
                        <span key={i} className="aug-fs-sm" style={{ color: "var(--t2)" }} data-testid="area-link-out">
                          {`${l.from} ${l.verb} ${l.to}`}<span style={MUTED}>{` — in ${l.toArea}`}</span>
                        </span>
                      ))}
                    </section>
                  )}
                  <Processes processes={part.processes} />
                </>
              )}
          </section>
        );
      })}
    </div>
  );
}
