/**
 * People to name as someone — an Area's contacts and the like (2026-11-25). `GET /people` says who the platform knows
 * that matches what was typed: the organisation's directory, the person asking, and people already named. A person is
 * kept as who they sign in as (`user:<id>`).
 */
import { getApiBase } from "@/lib/config";

export interface PersonFound { ref: string; name: string; email: string; source: "you" | "directory" | "named" }

export async function findPeople(q: string, limit = 8): Promise<PersonFound[]> {
  const res = await fetch(`${getApiBase()}/people?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
  if (!res.ok) return [];
  const got = await res.json().catch(() => []);
  return Array.isArray(got) ? got.filter((p) => p && typeof p.ref === "string") : [];
}

/** Who a typed name is kept as: as written when it already says (`user:ana`, `group:finance`), else `user:<name>`. */
export function personRef(typed: string): string {
  const t = typed.trim().replace(/,+$/, "").trim();
  return !t ? "" : t.includes(":") ? t : `user:${t}`;
}

/** A kept person as a reader says them: without the `user:` a sign-in id carries. */
export function personWords(ref: string): string {
  return String(ref || "").replace(/^(user|person):/, "");
}
