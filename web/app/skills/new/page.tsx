"use client";

/**
 * `/skills/new?conn=<connection>&inv=<deep analysis id>`: keep an analysis as a skill — the method, to run again on other
 * values — as a page of its own (punch list 88, 2026-11-18). Opened beside a coworker conversation by "Save as a skill"
 * under a deep analysis. The platform shapes the skill from the run; the page shows what it runs, its inputs and the
 * approved metrics it is held to, and only the person's click keeps it. One that computes an approved metric some other
 * way is said, and is not kept.
 */
import { use, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/ui/states";
import type { QueryTemplate } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";
import { keepSkill, proposeSkill } from "@/lib/skills";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

export default function NewSkillRoute({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = use(searchParams);
  const connection = one(query.conn);
  const inv = one(query.inv);
  const [skill, setSkill] = useState<QueryTemplate | null>(null);
  const [otherwise, setOtherwise] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState("");

  useEffect(() => {
    if (!connection || !inv) return;
    let live = true;
    proposeSkill(inv, connection)
      .then((p) => { if (live) { setSkill(p.candidate); setOtherwise(p.computed_otherwise); } })
      .catch((e) => { if (live) setProblem(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [connection, inv]);

  if (!connection || !inv) {
    return <main className="aug-fs-sm" style={{ padding: 20, color: "var(--t2)" }}>This page needs an analysis: add <code>?conn=</code> and <code>?inv=</code> to its address.</main>;
  }
  if (kept) return <main style={{ padding: "16px 20px" }}><p className="aug-fs-ui" role="status" style={{ margin: 0, color: "var(--t1)" }}>{kept}</p></main>;
  if (problem && !skill) return <main className="aug-fs-sm" style={{ padding: 20, color: "var(--amb4)" }} role="alert">{problem}</main>;
  if (!skill) return <main style={{ padding: 20 }}><Loading what="the skill this analysis makes" /></main>;

  const save = async () => {
    setBusy(true); setProblem("");
    try {
      const got = await keepSkill(skill, connection);
      setKept(`Kept as the skill “${skill.display_name}”${got.metrics.length ? `, held to ${got.metrics.join(", ")}` : ""}. Ask for it by its name.`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const held = skill.metrics ?? [];
  return (
    <main style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, maxWidth: "100%" }} data-testid="new-skill">
      <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Keep this analysis as a skill: its method, to run again on other values.</span>
      <label className="aug-fs-sm" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--t2)" }}>
        Its name
        <Input aria-label="Its name" value={skill.display_name} onChange={(e) => setSkill({ ...skill, display_name: e.target.value })} />
      </label>
      <p className="aug-fs-sm" style={{ margin: 0, color: "var(--t2)" }}>{skill.description}</p>
      <div className="aug-fs-sm" data-testid="skill-held-to" style={{ color: held.length ? "var(--t1)" : "var(--t3)" }}>
        {held.length ? `Held to the approved ${held.length === 1 ? "metric" : "metrics"} ${held.join(", ")}.` : "It uses no approved metric."}
      </div>
      {otherwise.length > 0 && (
        <div className="aug-fs-sm" role="alert" data-testid="skill-computed-otherwise" style={{ color: "var(--amb4)" }}>
          It computes {otherwise.join(", ")} otherwise than the approved {otherwise.length === 1 ? "definition" : "definitions"}, so it
          cannot be kept. Keep a run that uses the approved metric.
        </div>
      )}
      {skill.parameters.length > 0 && (
        <div className="aug-fs-sm" style={{ color: "var(--t2)" }}>
          Its inputs: {skill.parameters.map((p) => p.name).join(", ")}.
        </div>
      )}
      <pre className="aug-fs-xs" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)",
                                          color: "var(--t2)", background: "var(--bg-1)", padding: 10, borderRadius: "var(--r2)" }}>
        {skill.sql_template}
      </pre>
      {problem && <span className="aug-fs-sm" role="alert" style={{ color: "var(--amb4)" }}>{problem}</span>}
      <span style={{ display: "flex", gap: 8 }}>
        <Button size="sm" disabled={busy || otherwise.length > 0 || !skill.display_name.trim()} onClick={() => void save()}>
          {busy ? "Keeping…" : "Keep as a skill"}
        </Button>
      </span>
    </main>
  );
}
