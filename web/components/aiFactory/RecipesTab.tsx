"use client";

/** AI Factory ▸ Recipes — what a model can be for, each saying whether it can be made now and, when it cannot, why.
 *  A recipe's readiness is read from the stores (`pramanyx/training/recipes.py`), never written into the page. */
import { Chip, Empty, MUTED, ROW } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";

import type { FactoryData } from "./AIFactoryPanel";
import type { FactoryTab } from "./shared";

const STATUS_TONE: Record<string, "up" | "amber" | "violet" | "plain"> = {
  "in service": "up", ready: "up", "waiting for data": "amber", "needs your say": "amber", "needs a GPU": "violet",
};

export function RecipesTab({ data, go }: { data: FactoryData; go: (t: FactoryTab, model?: number) => void }) {
  const { recipes, view } = data;
  if (!recipes) return <Empty>The recipes could not be read.</Empty>;
  const inService = view.models.find(m => m.state === "published");
  return (
    <section aria-label="Recipes" data-testid="ai-factory-recipes">
      <div className="aug-fs-sm" style={{ ...MUTED, marginBottom: 12 }}>
        A recipe is what a model is for: what it learns from, how it is taught, how it is measured. Each says whether it can be made now.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {recipes.map(r => (
          <div key={r.id} data-testid={`recipe-${r.id}`} style={{ background: "var(--bg-2)", border: "1px solid var(--card-edge)",
            borderRadius: "var(--r3)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ ...ROW, justifyContent: "space-between" }}>
              <span className="aug-fs-ui" style={{ fontWeight: 600 }}>{r.name}</span>
              <Chip tone={STATUS_TONE[r.status] ?? "plain"}>{r.status}</Chip>
            </div>
            <div className="aug-fs-chrome" style={{ color: "var(--t2)" }}>{r.what}</div>
            <div style={ROW}>{r.facts.map(f => <Chip key={f}>{f}</Chip>)}</div>
            <div className="aug-fs-sm" style={MUTED}>Measured by {r.measured_by}</div>
            {r.why && <div className="aug-fs-sm" style={{ color: "var(--amb4)" }}>{r.why}</div>}
            <div style={{ ...ROW, marginTop: "auto" }}>
              {r.trainable ? (
                <>
                  <Button size="sm" disabled={!view.allowed} onClick={() => go("runs")}>{inService ? "Train again" : "Train"}</Button>
                  {inService && <Button size="sm" variant="secondary" onClick={() => go("models", inService.number)}>Open model {inService.number}</Button>}
                </>
              ) : r.environment ? (
                <Button size="sm" variant="secondary" onClick={() => go("environments")}>See what it needs</Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
