/**
 * Needs you — the Inbox's reads and writes (`pramanyx/routers/needs_you.py`; the Atlas plan's §7.8, decision 2). One
 * view over every queue that waits on a person: what to decide, alerts, the knowledge review by Area; each row read or
 * not for the person signed in; the count the rail shows. A review row says the doors that settle it (`ReviewAction`):
 * the page makes the request as the person, or opens the page the action names.
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";
import type { ReviewRow } from "@/lib/discover";

/** The wire value of a staged change's row: the frozen name of the store it waits in (the same field Agent Ops' strip
 *  switches on). Spelled here once; a reader is shown "Staged change". */
export const STAGED_CHANGE = "kinetic_inbox";

/** One thing waiting to be decided or acknowledged. */
export interface WaitingRow {
  /** STAGED_CHANGE · automation_approval · paused_run · automation_broken · agent_alert · monitor_alert */
  source: string;
  id: string;
  title: string;
  connection_id: string | null;
  connection_name: string;
  since: string | null;
  waiting_ms: number | null;
  severity?: string;
  metric?: string;
  resolve: Record<string, string>;
  lane: "for_you" | "decide" | "alerts";
  /** A second line of its own — a mention's words. */
  line?: string;
  /** Its name in the person's read marks. */
  key: string;
  read: boolean;
}

export interface WaitingLane { id: "for_you" | "decide" | "alerts"; title: string; rows: WaitingRow[]; count: number; unread: number; not_read: string[] }

export interface ReviewArea { id: string; name: string; icon: string; count: number; unread: number; mine: boolean }

export interface ReviewLane {
  id: "review"; title: string; count: number; unread: number;
  /** In the Areas the person answers for, and of those not opened. */
  mine: number; mine_unread: number;
  unplaced: number; read_at: string | null; areas: ReviewArea[]; not_read: string[];
}

/** An ask for access as the Inbox reads it (`record/access_requests.view`). */
export interface AccessAsk {
  id: string; thing: "canvas" | "sheet"; thing_id: string; name: string; asker: string; reason: string;
  to: string[]; to_admins: boolean; status: string; why: string; asked_at: string; answered_at: string | null; answered_by: string;
}

/** What is addressed to this person alone (Discover's C5 and P1): an ask for access to answer, the answer to their own
 *  ask, a comment that mentions them. */
export interface ForYouRow extends WaitingRow {
  /** access_request · access_answer · mention */
  ask?: AccessAsk;
  /** What opening it opens: the Definition a mention is on, or the thing an accepted ask shared. */
  open?: { kind: "definition"; connection_id: string; term: string; area: string } | { kind: "canvas" | "sheet"; id: string } | null;
}

export interface ForYouLane { id: "for_you"; title: string; rows: ForYouRow[]; count: number; unread: number; not_read: string[] }

export interface NeedsYou { person: string; lanes: [ForYouLane, WaitingLane, WaitingLane, ReviewLane]; badge: number; said: string[] }

/** A door that settles a review row: a request made as the person, or a page to open. */
export interface ReviewAction {
  do: "accept" | "reject" | "edit" | "open";
  label: string;
  call?: { method: "POST" | "PUT"; path: string; body: Record<string, unknown> };
  open?: {
    definition?: { connection: string; term: string; area: string };
    new_definition?: { connection: string; term: string; area: string };
    href?: string;
  };
}

/** A review row as the Inbox reads it — the Atlas's own, with the doors that settle it. */
export type ReviewRowWithDoors = ReviewRow & { actions?: ReviewAction[] };

const ws = (workspaceId?: string) => (workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "");

async function answer<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `${what} failed (${res.status})`));
  return res.json();
}

export async function readNeedsYou(workspaceId?: string): Promise<NeedsYou> {
  return answer(await fetch(`${getApiBase()}/needs-you${ws(workspaceId)}`), "Reading what waits on you");
}

export async function readNeedsYouCount(workspaceId?: string): Promise<{ badge: number; lanes: Record<string, number> }> {
  return answer(await fetch(`${getApiBase()}/needs-you/count${ws(workspaceId)}`), "Reading the count");
}

export async function markRead(keys: string[], read = true, workspaceId?: string): Promise<{ marked: number; read: number }> {
  return answer(await fetch(`${getApiBase()}/needs-you/read${ws(workspaceId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys, read }),
  }), "Marking it read");
}

/** Answer an ask for access addressed to you: accept shares it with the asker to read; decline tells them ``why``. */
export async function answerAccess(id: string, accept: boolean, why = ""): Promise<AccessAsk> {
  return answer(await fetch(`${getApiBase()}/access-requests/${encodeURIComponent(id)}/answer`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept, why }),
  }), accept ? "Sharing it" : "Declining it");
}

/** Ask the maker of a thing you were refused (else the admins) to share it with you to read. */
export async function askForAccess(thing: "canvas" | "sheet", id: string, reason: string): Promise<AccessAsk & { already: boolean }> {
  return answer(await fetch(`${getApiBase()}/access-requests`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thing, id, reason }),
  }), "Asking for access");
}

/** Your ask for this thing, if one waits. */
export async function myAccessAsk(thing: "canvas" | "sheet", id: string): Promise<AccessAsk | null> {
  const got = await answer<{ pending: AccessAsk | null }>(
    await fetch(`${getApiBase()}/access-requests/mine?thing=${thing}&id=${encodeURIComponent(id)}`), "Reading your ask");
  return got.pending;
}

/** A review row's name in the person's read marks — as the server names it (`record/needs_you.row_key`). */
export const reviewKey = (r: Pick<ReviewRow, "connection_id" | "id">) => `review:${r.connection_id ?? ""}:${r.id}`;

/** Make the request a review action names, as the person signed in. */
export async function settle(action: ReviewAction): Promise<void> {
  if (!action.call) return;
  const { method, path, body } = action.call;
  await answer(await fetch(`${getApiBase()}${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), action.label);
}

/** How long a waiting thing has waited, in a reader's words: "3 min", "5 h", "2 d". */
export function waitedWords(ms: number | null): string {
  if (ms == null || ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** What a waiting row is, in a reader's words. */
export const SOURCE_WORDS: Record<string, string> = {
  [STAGED_CHANGE]: "Staged change", automation_approval: "Automation approval", paused_run: "Paused deep analysis",
  automation_broken: "Automation that cannot send", agent_alert: "Agent alert", monitor_alert: "Monitor alert",
  access_request: "Ask for access", access_answer: "Your ask for access", mention: "Mention",
};
