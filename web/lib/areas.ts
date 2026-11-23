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
  /** What its curators wrote on its Discover page (D4, 2026-11-23); the server keeps both when a save leaves them out. */
  description?: string; featured?: { kind: string; ref: string }[];
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
    // a package's Area given only a description or things put first on its page is declared too: left out of a save, it
    // would lose them (Discover D4)
    .filter((a) => a.source === "organisation" || a.parent || a.business_owners.length || a.technical_owners.length
      || a.description || a.featured?.length)
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

/** An area the model suggests from its own labels for the data (punch list 87): an area only once a curator declares it. */
export interface SuggestedArea { label: string; id: string; tables: string[] }

export async function readSuggestedAreas(connectionId: string, schema?: string): Promise<SuggestedArea[]> {
  const res = await fetch(`${getApiBase()}/areas/${encodeURIComponent(connectionId)}/suggested${q(schema)}`);
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `Reading the suggested areas failed (${res.status})`));
  return ((await res.json()) as { suggested: SuggestedArea[] }).suggested ?? [];
}

/** A curator says a suggestion is not an area of the business (or takes that back). */
export async function setNotAnArea(connectionId: string, label: string, notAnArea = true): Promise<string[]> {
  const res = await fetch(`${getApiBase()}/areas/${encodeURIComponent(connectionId)}/not-an-area`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, not_an_area: notAnArea }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(out, `Not saved (${res.status})`));
  return (out as { not_areas: string[] }).not_areas ?? [];
}
