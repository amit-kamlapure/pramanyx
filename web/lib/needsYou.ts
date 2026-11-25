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
  lane: "decide" | "alerts";
  /** Its name in the person's read marks. */
  key: string;
  read: boolean;
}

export interface WaitingLane { id: "decide" | "alerts"; title: string; rows: WaitingRow[]; count: number; unread: number; not_read: string[] }

export interface ReviewArea { id: string; name: string; icon: string; count: number; unread: number; mine: boolean }

export interface ReviewLane {
  id: "review"; title: string; count: number; unread: number;
  /** In the Areas the person answers for, and of those not opened. */
  mine: number; mine_unread: number;
  unplaced: number; read_at: string | null; areas: ReviewArea[]; not_read: string[];
}

export interface NeedsYou { person: string; lanes: [WaitingLane, WaitingLane, ReviewLane]; badge: number; said: string[] }

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
};
