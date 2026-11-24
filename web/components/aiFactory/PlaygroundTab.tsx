"use client";

/** AI Factory ▸ Playground — one question to the models in service, side by side. Every answer comes back as the
 *  door checked it: a settled source's own words with that source, "nothing is settled", or withheld with why — the
 *  words of a withheld answer never reach the page. */
import { useState } from "react";

import { Card, Chip, Empty, MUTED, ROW } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askOwnModel, type OwnModelAnswer } from "@/lib/api";

import type { FactoryData } from "./AIFactoryPanel";
import { kindWord } from "./shared";

type Asked = { q: string; answers: { model: number; r?: OwnModelAnswer; error?: string }[] };

export function PlaygroundTab({ data }: { data: FactoryData }) {
  const live = data.view.models.filter(m => m.state === "published");
  const [chosen, setChosen] = useState<number[]>(live.slice(0, 3).map(m => m.number));
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<Asked[]>([]);
  if (!live.length) {
    return <Empty>No model is in service. Put one in service on the Models tab, then ask it here.</Empty>;
  }
  const toggle = (n: number) => setChosen(c => c.includes(n) ? c.filter(x => x !== n) : c.length < 3 ? [...c, n] : c);
  const ask = async () => {
    const q = question.trim();
    if (!q || !chosen.length) return;
    setBusy(true);
    const answers = await Promise.all(chosen.map(n => askOwnModel(n, q)
      .then(r => ({ model: n, r })).catch(e => ({ model: n, error: e instanceof Error ? e.message : String(e) }))));
    setAsked(prev => [{ q, answers }, ...prev]);
    setQuestion("");
    setBusy(false);
  };
  return (
    <>
      <Card label="Ask" right="up to three models in service" testId="ai-factory-playground">
        <div style={{ ...ROW, marginBottom: 10 }}>
          {live.map(m => (
            <Button key={m.number} size="xs" variant={chosen.includes(m.number) ? "default" : "secondary"} onClick={() => toggle(m.number)}
              aria-pressed={chosen.includes(m.number)}>Model {m.number}</Button>
          ))}
        </div>
        <form style={ROW} onSubmit={e => { e.preventDefault(); void ask(); }}>
          <Input value={question} onChange={e => setQuestion(e.target.value)} placeholder="What is Revenue at theLook?"
            style={{ flex: "1 1 420px" }} aria-label="A question for the models" />
          <Button size="sm" type="submit" disabled={busy || !question.trim() || !chosen.length}>{busy ? "Asking…" : chosen.length > 1 ? `Ask all ${chosen.length}` : "Ask"}</Button>
        </form>
        <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 8 }}>
          An answer is shown only as the words of something the organisation settled, with what it came from; anything else is withheld and said so.
        </div>
      </Card>
      {asked.map((a, i) => (
        <section key={i} aria-label={a.q} data-testid="ai-factory-asked" className="aug-section">
          <div className="aug-fs-chrome" style={{ fontWeight: 500, marginBottom: 8 }}>{a.q}</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, a.answers.length)}, minmax(0, 1fr))`, gap: 14 }}>
            {a.answers.map(x => (
              <div key={x.model} style={{ background: "var(--bg-2)", border: "1px solid var(--card-edge)", borderRadius: "var(--r3)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="aug-fs-sm" style={{ ...ROW, justifyContent: "space-between" }}>
                  <span><b>Model {x.model}</b>{x.r?.ms != null ? <span style={MUTED}> · {x.r.ms} ms</span> : null}</span>
                  {x.r && <Chip tone={x.r.verdict === "settled" ? "up" : x.r.verdict === "withheld" ? "amber" : "plain"}>
                    {x.r.verdict === "settled" ? "From a settled source" : x.r.verdict === "withheld" ? "Withheld" : "Nothing settled"}</Chip>}
                </div>
                {x.error ? <span className="aug-fs-chrome" style={{ color: "var(--red4)" }}>{x.error}</span>
                  : x.r?.verdict === "withheld" ? (
                    <span className="aug-fs-chrome" style={{ color: "var(--amb4)" }}>
                      {x.r.why}.{x.r.closest?.id ? ` Nearest settled: ${kindWord(x.r.closest.kind ?? "").toLowerCase()} ${x.r.closest.id}.` : ""}
                    </span>
                  ) : <span className="aug-fs-chrome" style={{ color: "var(--t2)" }}>{x.r?.answer}</span>}
                {x.r?.verdict === "settled" && x.r.source && (
                  <span className="aug-fs-xs" style={MUTED}>{kindWord(x.r.source.kind ?? "")} · {x.r.source.id}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
