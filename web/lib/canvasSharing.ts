/**
 * Who a Data Canvas is shared with (2026-11-20): a sheet's rule and a sheet's shape (`lib/sheets.ts`, SH-8) — the
 * workspace's until its maker chooses people and groups, each to open it and ask in it (view) or to change it (edit).
 * The server's `GET/PUT /canvases/{id}/sharing` answer in the shape the share chooser reads.
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";
import type { SheetShare, SheetSharing } from "@/lib/sheets";

const path = (id: string) => `${getApiBase()}/canvases/${encodeURIComponent(id)}/sharing`;

async function answer(res: Response, what: string): Promise<SheetSharing> {
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `${what} failed (${res.status})`));
  return res.json();
}

export async function readCanvasSharing(id: string): Promise<SheetSharing> {
  return answer(await fetch(path(id)), "Reading who it is shared with");
}

export async function saveCanvasSharing(id: string, sharing: SheetSharing["sharing"], shares: SheetShare[]): Promise<SheetSharing> {
  return answer(await fetch(path(id), {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sharing, shared_with: shares.map(({ kind, id: who, level }) => ({ kind, id: who, level })) }),
  }), "Sharing the canvas");
}
