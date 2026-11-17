/**
 * Who is in a conversation (group conversations, 2026-11-17; the user: "there cannot be shared conversations unless
 * users add other users in it"). A thread is its owner's and the people they add (`GET /chat-sessions/{id}/people`).
 */
import { getApiBase } from "@/lib/config";

export interface ThreadPeople {
  owner: string;
  members: string[];
  /** Everyone who has asked in it. */
  askers: string[];
  /** Who this page is, as the thread names people. */
  you: string;
  /** No sign-in on this install: everyone here is one person, so adding people takes effect once it is on. */
  single_person: boolean;
}

export interface DirectoryPerson { email: string; name: string; active: boolean }

/** The thread's people, or null for a thread nobody has asked in yet (it is the asker's once they do). */
export async function readThreadPeople(sessionId: string): Promise<ThreadPeople | null> {
  const res = await fetch(`${getApiBase()}/chat-sessions/${encodeURIComponent(sessionId)}/people`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Who is in this conversation could not be read (${res.status})`);
  const got = await res.json().catch(() => null);
  // Only a thread's people is one: an API from before group conversations answers something else.
  return got && typeof got.owner === "string" && Array.isArray(got.members) && Array.isArray(got.askers)
    ? got as ThreadPeople : null;
}

export async function setThreadMembers(sessionId: string, members: string[]): Promise<string[]> {
  const res = await fetch(`${getApiBase()}/chat-sessions/${encodeURIComponent(sessionId)}/members`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ members }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `Not saved (${res.status})`);
  return body.members ?? [];
}

export async function leaveThread(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/chat-sessions/${encodeURIComponent(sessionId)}/members/me`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : `Not left (${res.status})`);
  }
}

export async function readDirectory(): Promise<DirectoryPerson[]> {
  const res = await fetch(`${getApiBase()}/rbac/directory`);
  if (!res.ok) return [];
  return res.json();
}

/** Whether more than one person is in it: someone was added, or someone other than you asked. */
export function isShared(p: ThreadPeople | null): boolean {
  return !!p && (p.members.length > 0 || p.askers.some((a) => a && a !== p.you));
}

/** The line that says who is in it, from this page's side. */
export function whoIsIn(p: ThreadPeople): string {
  const others = [p.owner, ...p.members].filter((x) => x && x !== p.you);
  const mine = !p.owner || p.owner === p.you;
  if (!others.length) return "Just you";
  if (mine) return `You and ${others.join(", ")}`;
  return `${p.owner}'s conversation, with you${others.length > 1 ? ` and ${others.filter((x) => x !== p.owner).join(", ")}` : ""}`;
}
