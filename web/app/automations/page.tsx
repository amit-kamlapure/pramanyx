"use client";

/**
 * `/automations?conn=<connection>&focus=<automation>`: the platform's schedules and automations as a page of their
 * own. Opened by the coworker's "Schedules" entry, in a frame: there is ONE scheduler (the user, 2026-11-15: "the
 * scheduler needs to be one across the platform"), so the coworker shows this page and keeps no list of its own. A
 * LAYOUT over `AutomationsPanel`, the panel Agent Ops shows: same app, same tokens, same auth, and everything on it
 * works — make one, change it, mute it, run it now, read what each run did.
 *
 * The panel lists one connection's automations, and in the app the top bar chooses which. This page has no top bar,
 * so it carries the choice itself; the panel already says when the others hold some.
 */
import { use, useEffect, useState } from "react";

import { AutomationsPanel } from "@/components/AutomationsPanel";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { type Connection, getConnections } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

// Opened in a frame, where the workbench never installed the authenticated fetch — so the page installs it
// itself, before its first request (the install is idempotent).
if (typeof window !== "undefined") installAuthFetch(getApiBase());

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function AutomationsRoute({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = use(searchParams);
  const asked = one(query.conn);
  const focus = one(query.focus);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [failed, setFailed] = useState("");
  const [chosen, setChosen] = useState(asked);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getConnections()
      .then((all) => {
        if (!live) return;
        setConnections(all);
        setFailed("");
        // The connection the address names, when it is one of this install's; else the first.
        setChosen((now) => (all.some((c) => c.id === now) ? now : all[0]?.id ?? ""));
      })
      .catch((e) => { if (live) setFailed(String((e as Error)?.message || e)); });
    return () => { live = false; };
  }, [attempt]);

  if (failed) {
    return <main style={{ padding: 20 }}><ReadFailed what="the connections" error={failed} onRetry={() => setAttempt((n) => n + 1)} /></main>;
  }
  if (!connections) return <main style={{ padding: 20 }}><Loading what="schedules" /></main>;

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0, background: "var(--bg-0)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px 0", flexShrink: 0 }}>
        <label htmlFor="automations-connection" className="aug-fs-sm" style={{ color: "var(--t3)" }}>Schedules and automations on</label>
        <SelectField id="automations-connection" value={chosen} aria-label="Connection"
          onChange={(e) => setChosen(e.target.value)} style={{ width: 280 }}>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        {chosen
          ? <AutomationsPanel key={chosen} connId={chosen} focusId={focus || null} />
          : <p className="aug-fs-sm" style={{ padding: 20, color: "var(--t2)" }}>There is no connection yet. A schedule asks its question of one.</p>}
      </div>
    </main>
  );
}
