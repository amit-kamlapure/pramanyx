"use client";

/**
 * Discover on a page of its own (D6, 2026-11-24, `docs/DISCOVER_PLAN_2026-11-23.md` §4.6): what the coworker's sidebar
 * entry shows in its main area, in the coworker's light or dark (`?theme=`, `lib/frameTheme.ts`). The same page the app
 * shows, over every connection this install has; here a row opens its thing in the app, in a browser tab of its own,
 * and "Ask about it" begins a question in the coworker's conversation — said to the shell that framed it (`?shell=`, an
 * address on this machine), which never sends it: the person finishes it.
 */
import { use, useEffect, useMemo, useState } from "react";

import { DiscoverPage } from "@/components/discover/DiscoverPage";
import { DiscoverHost, askWords, shellOrigin, type DiscoverHostDoors } from "@/components/discover/host";
import { getConnections } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";
import { KIND_WORDS } from "@/lib/discover";

// Opened in a frame, where the workbench never installed the authenticated fetch — the page installs it itself.
if (typeof window !== "undefined") installAuthFetch(getApiBase());

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function DiscoverRoute({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = use(searchParams);
  const shell = shellOrigin(one(query.shell));
  const [connections, setConnections] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(one(query.id) || null);

  useEffect(() => {
    let live = true;
    getConnections().then((all) => { if (live) setConnections(all.map((c) => ({ id: c.id, name: c.name }))); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const doors = useMemo<DiscoverHostDoors>(() => ({
    // the thing's own page is the app's: a tab of its own, so the conversation stays where it was
    open: (href) => { window.open(href, "_blank", "noopener"); },
    ...(shell && typeof window !== "undefined" && window.parent !== window ? {
      ask: (item) => window.parent.postMessage({ type: "pramanyx:ask-about", text: askWords(item, KIND_WORDS[item.kind][0]),
        connection: item.connection_id }, shell),
    } : {}),
  }), [shell]);

  return (
    <main style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <DiscoverHost.Provider value={doors}>
        <DiscoverPage openId={openId} onOpenArea={setOpenId} onName={() => {}} connections={connections} ready />
      </DiscoverHost.Provider>
    </main>
  );
}
