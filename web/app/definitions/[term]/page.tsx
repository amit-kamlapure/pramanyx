"use client";

/**
 * `/definitions/<word>?conn=<connection>`: what a business word means on a connection — a Definition, as a person
 * wrote it (a Record claim of kind `definition`, `pramanyx/record/writers.py`). Its words, who owns it, whether it
 * stands approved and by whom, and the wordings before. Opened beside an answer that was given it (the coworker's
 * right-hand pane), and where a person writes or approves one: an answer leans on a definition only once a person
 * has written it.
 */
import { use, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fastApiError } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";
import { fmtDate } from "@/lib/format";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

interface Version { id: string; text: string; tier: string; author: string; recorded_at: string }
interface Definition {
  term: string; statement: { text: string }; tier: string; owner: string; author: string;
  approved_by: string; approved_on: string; aliases: string[]; versions: Version[];
}

function segment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const MUTED = { color: "var(--t2)" };
const who = (ref: string) => String(ref || "").replace(/^(user|person):/, "");

export default function DefinitionRoute({ params, searchParams }: {
  params: Promise<{ term: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const term = segment(use(params).term);
  const raw = use(searchParams).conn;
  const connection = typeof raw === "string" ? raw : "";
  const [found, setFound] = useState<Definition | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const read = useCallback(async () => {
    const q = new URLSearchParams({ connection_id: connection, term });
    const res = await fetch(`${getApiBase()}/record/definitions?${q}`);
    if (!res.ok) { setSaid(fastApiError(await res.json().catch(() => ({})), `Reading the definition failed (${res.status})`)); setFound(null); return; }
    const rows = (await res.json()) as Definition[];
    setFound(rows[0] ?? null);
    setDraft(rows[0]?.statement.text ?? "");
  }, [connection, term]);

  useEffect(() => { if (connection) void read(); }, [connection, read]);

  const send = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setSaid("");
    try {
      const res = await fetch(`${getApiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" },
                                                         body: JSON.stringify({ connection_id: connection, term, ...body }) });
      if (!res.ok) { setSaid(fastApiError(await res.json().catch(() => ({})), `${done} failed (${res.status})`)); return; }
      setFound((await res.json()) as Definition); setWriting(false); setSaid(done);
    } finally { setBusy(false); }
  };

  if (!connection) {
    return <main className="aug-fs-sm" style={{ padding: 20, ...MUTED }}>This page needs a connection: add <code>?conn=</code> to its address.</main>;
  }
  const approved = found?.tier === "approved";
  return (
    <main style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, maxWidth: "none" }}>
      <div>
        <div className="aug-fs-xs" style={{ color: "var(--t3)" }}>Definition</div>
        <h1 className="aug-fs-h1" style={{ margin: 0, color: "var(--t1)" }}>{found?.term || term}</h1>
        {found && (
          <p className="aug-fs-xs" style={{ margin: "4px 0 0", ...MUTED }}>
            {approved ? `Approved by ${who(found.approved_by)} on ${fmtDate(found.approved_on, "day")}` : "Written, not yet approved"}
            {" · "}owned by {who(found.owner) || "no one named"}
            {found.aliases?.length ? ` · also called ${found.aliases.join(", ")}` : ""}
          </p>
        )}
      </div>

      {found === undefined && <p className="aug-fs-sm" style={MUTED}>Reading…</p>}

      {found && !writing && (
        <p className="aug-fs-ui" style={{ margin: 0, color: "var(--t1)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{found.statement.text}</p>
      )}

      {found === null && !writing && (
        <p className="aug-fs-sm" style={MUTED}>No one has written what “{term}” means on this connection yet.</p>
      )}

      {writing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="definition-text" className="aug-fs-sm" style={MUTED}>What “{term}” means here</label>
          <Textarea id="definition-text" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {writing ? (
          <>
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void send("/record/definitions", { text: draft.trim() }, "Written")}>
              Keep this definition
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setWriting(false); setDraft(found?.statement.text ?? ""); }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setWriting(true)}>{found ? "Change the wording" : "Write what it means"}</Button>
            {found && !approved && (
              // Only its owner approves it; anyone else is told whose it is, by the server.
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void send("/record/definitions/approve", {}, "Approved")}
                title={`Only its owner, ${who(found.owner) || "no one named"}, can approve it`}>
                Approve as written
              </Button>
            )}
          </>
        )}
      </div>
      {said && <p className="aug-fs-xs" style={MUTED}>{said}</p>}

      {found && found.versions.length > 1 && (
        <section>
          <h2 className="aug-fs-h2" style={{ margin: "8px 0 4px", color: "var(--t1)" }}>Earlier wordings</h2>
          {found.versions.slice(1).map((v) => (
            <div key={v.id} style={{ borderTop: "1px solid var(--b2)", padding: "8px 0" }}>
              <div className="aug-fs-xs" style={MUTED}>{fmtDate(v.recorded_at, "day")} · {v.tier} · {who(v.author)}</div>
              <div className="aug-fs-sm" style={{ color: "var(--t2)", whiteSpace: "pre-wrap" }}>{v.text}</div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
