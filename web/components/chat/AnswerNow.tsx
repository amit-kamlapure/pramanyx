"use client";

/**
 * Answer now, under a deep analysis that is still running. Stop ends a run and answers nothing; this ends it with an answer
 * from what it has found so far, and the report says that some planned steps did not run. The person's own word: nothing
 * presses it for them.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { answerRunNow } from "@/lib/api";

export function AnswerNow({ runId }: { runId: string }) {
  const [state, setState] = useState<"idle" | "asking" | "asked">("idle");
  const [problem, setProblem] = useState("");
  const ask = async () => {
    setState("asking");
    setProblem("");
    try {
      await answerRunNow(runId);
      setState("asked");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "It could not be asked to answer now.");
      setState("idle");
    }
  };
  if (state === "asked") {
    return <p role="status" data-testid="answer-now-asked" className="aug-fs-sm" style={{ margin: "6px 0 0", color: "var(--t2)" }}>Answering now, from what it has found so far.</p>;
  }
  return (
    <div data-testid="answer-now" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
      <Button size="xs" variant="secondary" disabled={state === "asking"} onClick={() => void ask()}
        title="Stop here and answer from what it has found. Some planned steps will not run.">
        {state === "asking" ? "Asking…" : "Answer now"}
      </Button>
      {problem && <span role="alert" className="aug-fs-sm" style={{ color: "var(--t2)" }}>{problem}</span>}
    </div>
  );
}
