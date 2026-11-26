"use client";

/**
 * Definitions, together (the user, 2026-11-25: "comments and votes on Definitions"). Two parts of a Definition's page:
 *
 *  - `RightVotes` — how many people say it is right, and the person's own "This is right" (a vote says that only:
 *    disagreement is a comment or a suggested edit). Folded on the server from each person's latest.
 *  - `DefinitionComments` — what people said about it, oldest first, each in its writer's name; a person may take
 *    back their own, its words kept beneath it on the record. Typing `@` and a few letters offers the organisation's
 *    people (`GET /people`, names and emails only); a mention reaches that person in their Inbox's "For you" lane.
 */
import { useCallback, useEffect, useState } from "react";

import { MUTED } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";
import { same, who } from "@/lib/definitions";
import { fmtDate } from "@/lib/format";
import { findPeople, type PersonFound } from "@/lib/people";

/** The `@` being typed at the end of a comment, and what follows it so far. */
const TYPING_MENTION = /(^|\s)@([\w.%+-]*(?:@[\w.-]*)?)$/;

/** The comment with the `@` being typed replaced by the person chosen — their email, the name they sign in with. */
export function withMention(text: string, person: PersonFound): string {
  const m = TYPING_MENTION.exec(text);
  const handle = person.email || person.ref.replace(/^user:/, "");
  return m ? `${text.slice(0, m.index + m[1].length)}@${handle} ` : `${text}@${handle} `;
}

export interface DefinitionComment { id: string; text: string; by: string; at: string; mentions: string[] }
export interface RightVotesRead { right: number; by: string[]; mine: boolean }

/** Where a Definition is: its connection, word and Area — every read and write names all three. */
interface Where { connection: string; term: string; area: string }

const q = ({ connection, term, area }: Where) =>
  `connection_id=${encodeURIComponent(connection)}&term=${encodeURIComponent(term)}&area=${encodeURIComponent(area)}`;

async function send(path: string, where: Where, body: Record<string, unknown>) {
  const res = await fetch(`${getApiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connection_id: where.connection, term: where.term, area: where.area, ...body }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(out, `Not saved (${res.status})`));
  return out;
}

/** "3 people say this is right" — and none is said as none, never as a 0 next to nothing. */
export function rightWords(n: number): string {
  return n === 0 ? "No one has said it is right yet" : n === 1 ? "1 person says this is right" : `${n} people say this is right`;
}

export function RightVotes(where: Where) {
  const [got, setGot] = useState<RightVotesRead | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const read = useCallback(() => {
    fetch(`${getApiBase()}/record/definitions/votes?${q(where)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: RightVotesRead) => setGot(typeof v?.right === "number" && Array.isArray(v.by) ? v : null))
      .catch(() => setGot(null));
  }, [where.connection, where.term, where.area]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { read(); }, [read]);
  if (got === undefined) return <span className="aug-fs-xs" style={MUTED}>Reading…</span>;
  if (got === null) return <span className="aug-fs-xs" style={MUTED}>Who says it is right could not be read</span>;
  const toggle = async () => {
    setBusy(true); setSaid("");
    try {
      const v = await send("/record/definitions/vote", where, { right: !got.mine });
      setGot(typeof v?.right === "number" && Array.isArray(v.by) ? v : null);
    }
    catch (e) { setSaid((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="definition-right">
      <span className="aug-fs-sm" style={{ color: "var(--t2)" }} title={got.by.length ? got.by.map(who).join(", ") : undefined}>
        {rightWords(got.right)}
      </span>
      <Button size="xs" variant={got.mine ? "secondary" : "outline"} aria-pressed={got.mine} disabled={busy} onClick={() => void toggle()}
        title={got.mine ? "You said it is right — press to take that back" : "Say this Definition is right"}>
        {got.mine ? "You said it is right" : "This is right"}
      </Button>
      {said && <span className="aug-fs-xs" style={{ color: "var(--amb4)" }} role="alert">{said}</span>}
    </span>
  );
}

export function DefinitionComments({ me, ...where }: Where & { me: string }) {
  const [list, setList] = useState<DefinitionComment[] | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [offered, setOffered] = useState<PersonFound[]>([]);
  const typing = TYPING_MENTION.exec(text)?.[2] ?? null;
  useEffect(() => {
    if (typing === null) return;           // nothing offered: the list draws only while an @ is typed
    let live = true;
    findPeople(typing, 6).then((p) => { if (live) setOffered(p); }).catch(() => { if (live) setOffered([]); });
    return () => { live = false; };
  }, [typing]);
  const read = useCallback(() => {
    fetch(`${getApiBase()}/record/definitions/comments?${q(where)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: DefinitionComment[]) => setList(Array.isArray(rows) ? rows.filter((c) => c && typeof c.text === "string") : null))
      .catch(() => setList(null));
  }, [where.connection, where.term, where.area]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { read(); }, [read]);
  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setSaid("");
    try { await send(path, where, body); setSaid(done); read(); return true; }
    catch (e) { setSaid((e as Error).message); return false; } finally { setBusy(false); }
  };
  return (
    <section data-testid="definition-comments">
      <h2 className="aug-fs-h2" style={{ margin: "8px 0 4px", color: "var(--t1)" }}>Comments</h2>
      {list === undefined ? <p className="aug-fs-xs" style={MUTED}>Reading…</p>
        : list === null ? <p className="aug-fs-xs" style={MUTED}>The comments could not be read.</p>
        : list.length === 0 ? <p className="aug-fs-xs" style={MUTED}>No one has commented yet.</p>
        : list.map((c) => (
          <div key={c.id} style={{ borderTop: "1px solid var(--b0)", padding: "8px 0", display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="aug-fs-xs" style={{ ...MUTED, display: "flex", gap: 8, alignItems: "center" }}>
              <span>{who(c.by)} · {fmtDate(c.at, "day")}</span>
              {!!me && same(who(c.by), who(me)) && (
                <Button size="xs" variant="ghost" disabled={busy}
                  onClick={() => void act("/record/definitions/comments/take-back", { id: c.id }, "Taken back — kept on its record")}>
                  Take back
                </Button>
              )}
            </div>
            <div className="aug-fs-sm" style={{ color: "var(--t2)", whiteSpace: "pre-wrap" }}>{c.text}</div>
          </div>
        ))}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        <Textarea aria-label="Your comment" placeholder="Say something about this Definition — @name to mention someone"
          value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 56 }} />
        {typing !== null && offered.length > 0 && (
          <div role="listbox" aria-label="People to mention" data-testid="mention-people"
            style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {offered.map((p) => (
              <Button key={p.ref} role="option" aria-selected={false} size="xs" variant="ghost"
                onClick={() => setText(withMention(text, p))}>
                {p.name && p.name !== p.email ? `${p.name} · ${p.email}` : p.email || p.ref.replace(/^user:/, "")}
              </Button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="xs" disabled={busy || !text.trim()}
            onClick={async () => { if (await act("/record/definitions/comments", { text }, "")) setText(""); }}>Comment</Button>
          {said && <span className="aug-fs-xs" style={MUTED} role="status">{said}</span>}
        </div>
      </div>
    </section>
  );
}
