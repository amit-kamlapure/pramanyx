"use client";

/**
 * Define ▸ AI Factory — where the organisation's own models are made (`pramanyx/training/`; the page was "Own model"
 * until 2026-11-24, when the user named it). Six tabs in the order the work goes — Overview · Recipes ·
 * Environments · Runs · Models · Playground — from the mockup the user approved (`web/public/_mockups/ai-factory.html`,
 * not committed). The mockup's Engines tab is gone (the user, 2026-11-24: "lets not say how we do it"): an engine is a
 * dropdown on a new run, offering only those ready here, and the base is changed beside it.
 *
 * One read of everything the tabs show, kept fresh while a run is going; each tab lays it out. The tabs sit in the
 * shell's toolbar row and "New run" in its title row, as every page with views does.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Page } from "@/components/clarity/kit";
import { ChromeActions, ChromeToolbar, useInShell } from "@/components/shell/PageChrome";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Loading, ReadFailed } from "@/components/ui/states";
import { TabStrip } from "@/components/ui/tab-strip";
import { toast } from "@/components/ui/toast";
import {
  getAIFactory, getFactoryEngines, getFactoryEnvironments, getFactoryRecipes, getFactoryRuns, getTrainingPlan, setOrgAllow,
  type AIFactoryOverview, type FactoryEnvironment, type FactoryRecipe, type FactoryRun, type TrainingPlan,
} from "@/lib/api";
import { useFromAddress } from "@/lib/addressOnce";
import { useVisiblePoll } from "@/lib/useVisiblePoll";

import { CorpusTab } from "./CorpusTab";
import { EnvironmentsTab } from "./EnvironmentsTab";
import { ModelsTab } from "./ModelsTab";
import { OverviewTab } from "./OverviewTab";
import { PlaygroundTab } from "./PlaygroundTab";
import { RecipesTab } from "./RecipesTab";
import { RunsTab } from "./RunsTab";
import { ACTIVE, FACTORY_TABS, type FactoryTab } from "./shared";

export interface FactoryData {
  view: AIFactoryOverview;
  recipes: FactoryRecipe[] | null;
  environments: { environments: FactoryEnvironment[]; reward_band: [number, number] } | null;
  engines: Awaited<ReturnType<typeof getFactoryEngines>> | null;
  runs: FactoryRun[] | null;
  /** What a build would hold and leave out now — read from the sources, nothing registered. */
  plan: TrainingPlan | null;
}

export function AIFactoryPanel() {
  const inShell = useInShell();
  const [tab, setTab] = useState<FactoryTab>("overview");
  // `?factory=corpus` opens that tab — the Memory page links to the corpus that moved here (2026-11-26)
  useFromAddress(["factory"], ({ factory }) => { if (FACTORY_TABS.some((t) => t.id === factory)) setTab(factory as FactoryTab); });
  const [data, setData] = useState<FactoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const read = useCallback(async () => {
    const [view, recipes, environments, engines, runs, plan] = await Promise.all([
      getAIFactory(), getFactoryRecipes().catch(() => null), getFactoryEnvironments().catch(() => null),
      getFactoryEngines().catch(() => null), getFactoryRuns().catch(() => null), getTrainingPlan().catch(() => null)]);
    return { view, recipes, environments, engines, runs, plan };
  }, []);
  const reload = useCallback(async () => {
    try { setData(await read()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [read]);
  useEffect(() => {
    let live = true;
    read().then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [read]);

  const running = !!data?.view.run && ACTIVE.has(data.view.run.state);
  // While a run goes, the overview and the runs are read again; the rest change only when a person acts.
  useVisiblePoll(() => {
    if (!running) return;
    Promise.all([getAIFactory(), getFactoryRuns().catch(() => null)])
      .then(([view, runs]) => setData(d => (d ? { ...d, view, runs: runs ?? d.runs } : d)))
      .catch(() => undefined);
  }, 2500);
  // A run that just ended left a model and changed the environments' pass rates: read everything once.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void reload();
    wasRunning.current = running;
  }, [running, reload]);

  const tabs = (
    <TabStrip label="AI Factory views" value={tab} onChange={setTab} className="aug-layer-tabs" tabs={FACTORY_TABS} />
  );
  const newRun = (
    <Button size="sm" onClick={() => setTab("runs")} disabled={!data?.view.allowed}
      title={data?.view.allowed ? "Start a run on the Runs tab" : "The organisation does not allow it yet"}>New run</Button>
  );

  if (error && !data) return <Page><ReadFailed what="the AI Factory" error={error} onRetry={reload} /></Page>;
  if (!data) return <Page><Loading what="the AI Factory" /></Page>;

  const go = (t: FactoryTab, model?: number) => { if (model != null) setPicked(model); setTab(t); };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      {inShell ? (<><ChromeToolbar>{tabs}</ChromeToolbar><ChromeActions>{newRun}</ChromeActions></>)
        : <TabStrip label="AI Factory views" value={tab} onChange={setTab} style={{ padding: "12px 20px 0" }}
          tabs={FACTORY_TABS} trailing={newRun} />}
      <Page testId="ai-factory-page">
        {!data.view.allowed && <OffNotice where={data.view.where} onAllowed={reload} />}
        {tab === "overview" && <OverviewTab data={data} go={go} />}
        {tab === "corpus" && <CorpusTab />}
        {tab === "recipes" && <RecipesTab data={data} go={go} />}
        {tab === "environments" && <EnvironmentsTab data={data} onChanged={reload} />}
        {tab === "runs" && <RunsTab data={data} running={running} onChanged={reload} go={go} />}
        {tab === "models" && <ModelsTab data={data} picked={picked} onPick={setPicked} onChanged={reload} />}
        {tab === "playground" && <PlaygroundTab data={data} />}
      </Page>
    </div>
  );
}

function OffNotice({ where, onAllowed }: { where: string; onAllowed: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Callout tone="amber" data-testid="ai-factory-off">
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", width: "100%", flexWrap: "wrap" }}>
        <span>The AI Factory is off: training the organisation&apos;s own models is an admin&apos;s choice, in {where}.</span>
        <Button size="sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await setOrgAllow("train_own_model", true); toast.info("The AI Factory is allowed"); onAllowed(); }
          catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
          finally { setBusy(false); }
        }}>Allow it</Button>
      </div>
    </Callout>
  );
}
