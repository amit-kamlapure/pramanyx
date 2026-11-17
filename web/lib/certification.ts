/**
 * Certified and deprecated (the ontology study, Phase 1, 2026-11-17): the organisation vouching for a table, a
 * document or a dashboard, or warning off it. A curator sets it (a document's owner for their own); the server refuses
 * anyone else and every agent. A metric, a trusted query and a Definition keep their own lifecycles.
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";

export type CertKind = "table" | "document" | "dashboard";
export type CertStatus = "certified" | "deprecated";
export interface Certification { securable: string; status: CertStatus; why: string; by: string; at: string }

export interface CertTarget { kind: CertKind; ref: string; connectionId?: string; schema?: string }

export async function readCertification(t: CertTarget): Promise<Certification | null> {
  const q = new URLSearchParams({ kind: t.kind, ref: t.ref, ...(t.connectionId ? { connection_id: t.connectionId } : {}) });
  const res = await fetch(`${getApiBase()}/governance/certification?${q}`);
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `Reading the certification failed (${res.status})`));
  return ((await res.json()) as { certification: Certification | null }).certification;
}

/** Every certified or deprecated asset of a kind (a connection's tables), by its name or id. */
export async function readCertifications(kind: CertKind, connectionId = ""): Promise<Record<string, Certification>> {
  const q = new URLSearchParams({ kind, ...(connectionId ? { connection_id: connectionId } : {}) });
  const res = await fetch(`${getApiBase()}/governance/certification?${q}`);
  if (!res.ok) return {};
  return ((await res.json()) as { by_ref: Record<string, Certification> }).by_ref ?? {};
}

export async function setCertification(t: CertTarget, status: CertStatus | "", why = ""): Promise<Certification | null> {
  const res = await fetch(`${getApiBase()}/governance/certification`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: t.kind, ref: t.ref, connection_id: t.connectionId ?? "", schema: t.schema ?? "", status, why }),
  });
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `Saving the certification failed (${res.status})`));
  return ((await res.json()) as { certification: Certification | null }).certification;
}

/** The mark's title: who said it, and why. */
export function certificationTitle(c: Certification): string {
  const who = String(c.by || "").replace(/^user:/, "");
  return `${c.status === "certified" ? "Certified" : "Deprecated"} by ${who}${c.at ? ` on ${c.at.slice(0, 10)}` : ""}${c.why ? `: ${c.why}` : ""}`;
}
