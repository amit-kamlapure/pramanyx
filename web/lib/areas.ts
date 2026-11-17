/**
 * The areas of the business, as the organisation declares them (the ontology study, Phase 1, 2026-11-17): the
 * industry's map, the organisation's own areas and owners on top (a curator's), and what people placed in them. A
 * placement says what an asset means, never who may read it.
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";

export interface BusinessArea {
  id: string; name: string; question: string; parent: string;
  business_owners: string[]; technical_owners: string[]; source: "package" | "organisation"; pack_id: string;
}
export interface AreaPlaced { area: string; by: string }
export interface AreasRead {
  areas: BusinessArea[];
  placed: { tables: Record<string, AreaPlaced>; metrics: Record<string, AreaPlaced>; connection: AreaPlaced | null };
}
/** One declaration as the server keeps it: a new area, or a package's own given owners or a place. */
export interface AreaDeclaration {
  id: string; name?: string; question?: string; parent?: string; business_owners?: string[]; technical_owners?: string[];
}

const q = (schema?: string) => (schema ? `?schema=${encodeURIComponent(schema)}` : "");

export async function readAreas(connectionId: string, schema?: string): Promise<AreasRead> {
  const res = await fetch(`${getApiBase()}/areas/${encodeURIComponent(connectionId)}${q(schema)}`);
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `Reading the areas failed (${res.status})`));
  return (await res.json()) as AreasRead;
}

/** What the organisation has declared, from what it reads back: every area it named, owned or placed under another. */
export function declarationsOf(areas: BusinessArea[]): AreaDeclaration[] {
  return areas
    .filter((a) => a.source === "organisation" || a.parent || a.business_owners.length || a.technical_owners.length)
    .map((a) => ({ id: a.id, ...(a.source === "organisation" ? { name: a.name, question: a.question } : {}),
                   parent: a.parent, business_owners: a.business_owners, technical_owners: a.technical_owners }));
}

export async function saveAreas(connectionId: string, declarations: AreaDeclaration[], schema?: string): Promise<BusinessArea[]> {
  const res = await fetch(`${getApiBase()}/areas/${encodeURIComponent(connectionId)}${q(schema)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ areas: declarations }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const problems = (out?.detail?.problems as string[] | undefined) ?? [];
    throw new Error(problems.length ? `Not saved: ${problems.join("; ")}.` : fastApiError(out, `Saving the areas failed (${res.status})`));
  }
  return (out as { areas: BusinessArea[] }).areas;
}

export async function placeInArea(connectionId: string, body: { kind: "table" | "connection" | "metric"; ref?: string; area: string; schema_name?: string }): Promise<string | null> {
  const res = await fetch(`${getApiBase()}/areas/${encodeURIComponent(connectionId)}/placement`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "", ...body }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(out, `Placing it failed (${res.status})`));
  return (out as { area: string | null }).area;
}

export const ownersWords = (a: Pick<BusinessArea, "business_owners" | "technical_owners">): string => {
  const who = (xs: string[]) => xs.map((x) => x.replace(/^user:/, "")).join(", ");
  return [a.business_owners.length ? `owned by ${who(a.business_owners)}` : "",
          a.technical_owners.length ? `its data by ${who(a.technical_owners)}` : ""].filter(Boolean).join(" · ");
};
export const people = (raw: string): string[] => raw.split(",").map((s) => s.trim()).filter(Boolean)
  .map((s) => (s.includes(":") ? s : `user:${s}`));
