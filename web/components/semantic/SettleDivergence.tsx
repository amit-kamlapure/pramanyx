"use client";

/**
 * Settle it — a question the platform has answered more than one way, and the person who decides which answer is
 * right (2026-11-17). Each way it was answered is shown with how often and when, and its SQL; "Run each" runs them
 * side by side (one bounded query each) to say whether the answers actually differ. "This one is right" keeps that
 * answer as the trusted one, recorded as the person's decision (`POST /consistency/pin`). The platform never picks:
 * the most-used answer is not the right one by being used most.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Chip } from "@/components/clarity/kit";
import { getApiBase } from "@/lib/config";
import { formatCount } from "@/lib/format";

interface Variant { sql: string; key: string; tables: string[]; run_count: number; first_seen: string; last_seen: string }
interface Divergence { question: string; question_key: string; run_count: number; variants: Variant[] }
interface Result { key: string; row_count: number; numeric_total: number | null; error: string | null }

async function json<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `${what} (${res.status})`);
  return body as T;
}

export function SettleDivergence({ connId, questionKey, onClose, onSettled }: {
  connId: string; questionKey: string; onClose: () => void; onSettled: () => void;
}) {
  const [div, setDiv] = useState<Divergence | null>(null);
  const [results, setResults] = useState<Map<string, Result> | null>(null);
  const [differ, setDiffer] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const q = new URLSearchParams({ connection_id: connId, include_exploratory: "true" });
    fetch(`${getApiBase()}/consistency/divergences?${q}`)
      .then((r) => json<{ divergences: Divergence[] }>(r, "The answers could not be read"))
      .then((got) => {
        const found = got.divergences.find((d) => d.question_key === questionKey);
        if (found) setDiv(found); else setProblem("This question is no longer answered more than one way.");
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [connId, questionKey]);

  const runEach = async () => {
    setBusy("run"); setProblem("");
    try {
      const q = new URLSearchParams({ connection_id: connId, question_key: questionKey });
      const got = await json<{ impact: { results_differ: boolean; results: Result[] } }>(
        await fetch(`${getApiBase()}/consistency/impact?${q}`), "They could not be run");
      setResults(new Map(got.impact.results.map((r) => [r.key, r])));
      setDiffer(got.impact.results_differ);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const choose = async (v: Variant) => {
    if (!div) return;
    setBusy(v.key); setProblem("");
    try {
      await json(await fetch(`${getApiBase()}/consistency/pin`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connId, question: div.question, sql: v.sql, tables: v.tables }),
      }), "Not kept");
      onSettled();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  return (
    <FormDialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Which answer is right?" width={760}
      testId="settle-divergence" busy={!!busy}
      description={div ? <>&ldquo;{div.question}&rdquo; — asked {div.run_count} times, answered {div.variants.length} ways.</> : undefined}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>
          The one you choose is kept as the trusted answer, as your decision; the others are not used for this question
          again. The most-used answer is not right for being used most.
        </span>
        {!div && !problem && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Reading how it was answered…</span>}
        {div && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="sm" variant="secondary" onClick={() => { void runEach(); }} disabled={!!busy}>
              {busy === "run" ? "Running each…" : "Run each to compare"}
            </Button>
            {differ !== null && (
              <span className="aug-fs-xs" data-testid="settle-differ" style={{ color: differ ? "var(--amb4)" : "var(--t3)" }}>
                {differ ? "They return different results." : "They return the same results; the SQL differs, the data does not."}
              </span>
            )}
          </div>
        )}
        {div?.variants.map((v, i) => {
          const r = results?.get(v.key);
          return (
            <div key={v.key} data-testid="settle-variant"
              style={{ border: "1px solid var(--b1)", borderRadius: "var(--r2)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Chip tone={i === 0 ? "accent" : "plain"}>{v.run_count === 1 ? "used once" : `used ${v.run_count} times`}</Chip>
                <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>
                  {v.first_seen.slice(0, 10)}{v.last_seen && v.last_seen.slice(0, 10) !== v.first_seen.slice(0, 10) ? ` to ${v.last_seen.slice(0, 10)}` : ""}
                </span>
                {r && (
                  <span className="aug-fs-xs" style={{ color: r.error ? "var(--amb4)" : "var(--t2)" }}>
                    {r.error ? `Could not run: ${r.error}` : `${formatCount(r.row_count)} rows${r.numeric_total != null ? `, totalling ${formatCount(r.numeric_total)}` : ""}`}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <Button size="sm" onClick={() => { void choose(v); }} disabled={!!busy}>
                  {busy === v.key ? "Keeping…" : "This one is right"}
                </Button>
              </div>
              <pre className="aug-fs-xs" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", color: "var(--t2)" }}>
                {v.sql}
              </pre>
            </div>
          );
        })}
        {problem && <span className="aug-fs-xs" style={{ color: "var(--amb4)" }}>{problem}</span>}
      </div>
    </FormDialog>
  );
}
