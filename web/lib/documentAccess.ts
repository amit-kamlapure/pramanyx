/**
 * Who may read an uploaded document, and its owner's door to share it (punch list 82; the user, 2026-11-17: an upload
 * is "private until shared"). The server says who may read each document and whether it is the reader's own to share
 * (`GET /documents` → `access`, `yours`); only its owner shares it, never an agent (`PUT /documents/{id}/access`).
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";

export interface DocumentAccess {
  sharing: "org" | "chosen";
  shared_with?: { kind: "person" | "group"; id: string }[];
  why?: string;
  source?: string;
  owner?: string;
}

export type ShareChoice = "me" | "people" | "org";

/** Who reads it, in words — "" for a document that is not an upload (a connector page says its source's rule). */
export function readersWords(access: DocumentAccess | undefined, yours: boolean): string {
  if (!access || access.source !== "upload" || !access.owner) return "";
  if (access.sharing === "org") return yours ? "You shared it with everyone in the organisation" : `Shared with everyone by ${access.owner}`;
  const others = (access.shared_with ?? []).filter((s) => s.id.toLowerCase() !== access.owner!.toLowerCase());
  if (!others.length) return yours ? "Only you can read it" : `${access.owner}'s`;
  const names = others.map((s) => (s.kind === "group" ? `the group ${s.id}` : s.id)).join(", ");
  return yours ? `You and ${names}` : `Shared by ${access.owner} with ${names}`;
}

/** The choice the form opens on: what stands now. */
export function choiceOf(access: DocumentAccess | undefined): ShareChoice {
  if (access?.sharing === "org") return "org";
  const owner = (access?.owner ?? "").toLowerCase();
  return (access?.shared_with ?? []).some((s) => s.id.toLowerCase() !== owner) ? "people" : "me";
}

/** The people it is shared with now, besides its owner. */
export function sharedPeople(access: DocumentAccess | undefined): string[] {
  const owner = (access?.owner ?? "").toLowerCase();
  return (access?.shared_with ?? []).filter((s) => s.kind === "person" && s.id.toLowerCase() !== owner).map((s) => s.id.toLowerCase());
}

/** Which data an upload is about, in words for its row (2026-11-25): one connection's answers alone, or every one's. */
export function aboutWords(connectionId: string | null | undefined, connections: ReadonlyArray<{ id: string; name: string }>): string {
  if (!connectionId) return "For every connection";
  return `For ${connections.find((c) => c.id === connectionId)?.name ?? connectionId} only`;
}

/** Say which connection an upload is about — its owner, else an admin; `null` for every connection. */
export async function sayDocumentAbout(docId: string, connectionId: string | null): Promise<{ connection_id: string; by: string; at: string } | null> {
  const res = await fetch(`${getApiBase()}/documents/${encodeURIComponent(docId)}/about`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connection_id: connectionId }),
  });
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(got, `Not saved (${res.status})`));
  return (got as { about: { connection_id: string; by: string; at: string } | null }).about ?? null;
}

export async function shareDocument(docId: string, choice: ShareChoice, people: string[], groups: string[] = []): Promise<DocumentAccess> {
  const body = choice === "org" ? { sharing: "org" } : { sharing: "chosen", people: choice === "me" ? [] : people, groups: choice === "me" ? [] : groups };
  const res = await fetch(`${getApiBase()}/documents/${encodeURIComponent(docId)}/access`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(got, `Not shared (${res.status})`));
  return (got as { access: DocumentAccess }).access;
}
