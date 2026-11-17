"use client";

/**
 * `/agents/new?conn=<connection>&description=<words>`: make an agent — the app's own flow, as a page of its own
 * (2026-11-17). Opened beside a coworker answer by "Make an agent from it": what it should answer starts as the
 * answer's question, on the answer's connection; the platform drafts it, the person reads and changes it, and only
 * their click creates it.
 */
import { use, useState } from "react";

import { CreateAgentFlow } from "@/components/agentops/CreateAgentFlow";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

export default function NewAgentRoute({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = use(searchParams);
  const [done, setDone] = useState("");
  return (
    <main style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {done ? (
        <p className="aug-fs-ui" role="status" style={{ margin: 0, color: "var(--t1)" }}>{done}</p>
      ) : (
        <CreateAgentFlow initialDescription={one(query.description)} initialConnectionId={one(query.conn)}
          onCreated={(agent) => setDone(`Made the agent ${agent.name}. It is under Agents, and asked by its own name.`)}
          onCancel={() => setDone("No agent made.")} />
      )}
    </main>
  );
}
