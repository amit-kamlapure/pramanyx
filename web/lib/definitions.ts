/**
 * A Definition as the app reads it (`GET /record/definitions`), and the small helpers its page and its tests share.
 * Since 2026-11-17 (the ontology study) a Definition has drafts, published by its owner only,
 * suggested edits from anyone, one area of the business, other names, and what it refers to.
 */
export interface Version { id: string; text: string; tier: string; author: string; recorded_at: string }
/** A related asset: any thing Discover lists, a person or a web address — with the app's own address for it, when kept. */
export interface DefinitionLink { kind: string; ref: string; label: string; href?: string }
/** Where its words come from: a web address, or a document of the corpus. */
export interface DefinitionSource { kind: "url" | "document"; ref: string; label: string }
export interface Suggestion {
  id: string; by: string; at: string; why: string; by_agent?: boolean; text?: string; aliases?: string[];
  links?: DefinitionLink[]; description?: string; sources?: DefinitionSource[];
}
export interface Definition {
  term: string; area: string; statement: { text: string }; tier: string; state: "published" | "draft"; owner: string;
  author: string; approved_by: string; approved_on: string; aliases: string[]; links: DefinitionLink[];
  /** The line under its name, apart from what it means (2026-11-23). */
  description?: string;
  sources?: DefinitionSource[];
  suggestions: Suggestion[]; versions: Version[];
  /** The coworker drafted it for its owner, who has not published it yet (2026-11-17). */
  drafted_by_agent?: boolean;
  /** Who handed it to whom, latest last (2026-11-24): its owner answers for it, and may hand it on. */
  handed?: { on: string; by: string; from: string; to: string }[];
}

export const LINK_KINDS = ["metric", "table", "definition", "dashboard", "document", "person", "url",
  "canvas", "agent", "schedule", "sheet", "trusted_query"] as const;

/** A principal as a reader names them: `user:ana` is Ana. */
export const who = (ref: string) => String(ref || "").replace(/^(user|person):/, "");
export const same = (a: string, b: string) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
export const names = (raw: string) => raw.split(",").map((s) => s.trim()).filter(Boolean);

/** Where a link opens: the app's own page for what it names, else nothing. */
export function linkHref(link: DefinitionLink, connection: string): string | null {
  const c = encodeURIComponent(connection);
  if (link.kind === "metric") return `/metrics/${encodeURIComponent(link.ref)}?conn=${c}`;
  if (link.kind === "definition") return `/definitions/${encodeURIComponent(link.ref)}?conn=${c}`;
  if (link.kind === "url" && /^https?:\/\//.test(link.ref)) return link.ref;
  return null;
}

/** Where a link opens inside the app (the Semantic Layer holds metrics and Definitions — Discover's links, 2026-11-23),
 *  for a definition shown in the app rather than on a page of its own. */
export function inAppHref(link: DefinitionLink, connection: string): string | null {
  if (link.href?.startsWith("/?tab=")) return link.href;   // picked from Discover: its own address
  const q = (more: Record<string, string>) => `/?${new URLSearchParams({ tab: "semantic", conn: connection, ...more })}`;
  if (link.kind === "metric") return q({ metric: link.ref });
  if (link.kind === "definition") return q({ definition: link.ref });
  if (link.kind === "url" && /^https?:\/\//.test(link.ref)) return link.ref;
  return null;
}

/** The versions whose WORDS changed — a suggestion filed or decided restates the claim without changing them. */
export function earlierWordings(versions: Version[]): Version[] {
  const out: Version[] = [];
  for (const v of versions.slice(1)) if (!out.length || out[out.length - 1].text !== v.text) out.push(v);
  return out.filter((v) => v.text !== versions[0]?.text);
}

