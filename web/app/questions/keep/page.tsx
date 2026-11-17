"use client";

/**
 * `/questions/keep?conn=<connection>&question=<words>[&first=<answer>]`: keep a question on the connection's
 * dashboard, asked again on a rhythm — the app's own composer, as a page of its own (2026-11-17). Opened beside a
 * coworker answer by "Keep on a dashboard": the question starts in the box, the person chooses the rhythm and sees what
 * it costs, and only their click keeps it.
 */
import { use, useState } from "react";

import { QuestionComposer } from "@/components/dashboards/QuestionComposer";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

export default function KeepQuestionRoute({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = use(searchParams);
  const connection = one(query.conn);
  const [kept, setKept] = useState("");
  if (!connection) {
    return <main className="aug-fs-sm" style={{ padding: 20, color: "var(--t2)" }}>This page needs a connection: add <code>?conn=</code> to its address.</main>;
  }
  return (
    <main style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {kept ? (
        <p className="aug-fs-ui" role="status" style={{ margin: 0, color: "var(--t1)" }}>{kept}</p>
      ) : (
        <QuestionComposer connectionId={connection} question={one(query.question)} firstRun={one(query.first) || undefined}
          from="the coworker" onClose={() => setKept("Not kept.")}
          onKept={(_id, _first, rhythm) => setKept(rhythm === "ask"
            ? "Kept on the dashboard. It is asked only when you ask it."
            : `Kept on the dashboard, asked ${rhythm}. Each answer is filed beside the earlier ones.`)} />
      )}
    </main>
  );
}
