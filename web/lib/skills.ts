/**
 * A skill from an analysis, as the page beside a coworker conversation proposes and keeps it (punch list 88): the
 * candidate the platform shapes from the run (`POST /ontology/skills/propose`), with what it would be refused for,
 * and the save that only the person's click makes (`POST /ontology/skills`).
 */
import { fastApiError, type QueryTemplate } from "@/lib/api";
import { getApiBase } from "@/lib/config";

export interface SkillProposal { candidate: QueryTemplate; computed_otherwise: string[] }

export async function proposeSkill(invId: string, connectionId: string): Promise<SkillProposal> {
  const q = new URLSearchParams({ inv_id: invId, connection_id: connectionId });
  const res = await fetch(`${getApiBase()}/ontology/skills/propose?${q}`, { method: "POST" });
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(got, "This analysis cannot be kept as a skill"));
  return { candidate: got.candidate as QueryTemplate, computed_otherwise: (got.computed_otherwise as string[]) ?? [] };
}

export async function keepSkill(skill: QueryTemplate, connectionId: string): Promise<{ id: string; metrics: string[] }> {
  const q = new URLSearchParams({ connection_id: connectionId });
  const res = await fetch(`${getApiBase()}/ontology/skills?${q}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(skill),
  });
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(got, `Not kept (${res.status})`));
  return { id: String(got.id ?? skill.id), metrics: (got.metrics as string[]) ?? [] };
}
