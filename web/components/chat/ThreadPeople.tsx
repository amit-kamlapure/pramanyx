"use client";

/**
 * Who is in this conversation, and the way to add people (group conversations, 2026-11-17; the user: "there cannot be
 * shared conversations unless users add other users in it"). One line above the conversation: "Just you", or who
 * else is in it. Its owner adds or removes people — the organisation's people, by the email they sign in with — in a
 * form; someone added may leave. Everyone in it sees it and asks in it as themselves.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  leaveThread, readDirectory, setThreadMembers, whoIsIn, type DirectoryPerson, type ThreadPeople as People,
} from "@/lib/threads";

export function ThreadPeople({ sessionId, people, onChange, onLeft }: {
  sessionId: string;
  people: People;
  onChange: (next: People) => void;
  onLeft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const owner = !people.owner || people.owner === people.you;
  const [problem, setProblem] = useState("");
  const leave = async () => {
    setProblem("");
    try { await leaveThread(sessionId); onLeft(); } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div data-testid="thread-people" className="aug-fs-xs"
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--t3)", marginBottom: 16 }}>
      <span data-testid="thread-people-line">{whoIsIn(people)}</span>
      {owner ? (
        <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>Add people</Button>
      ) : (
        <Button size="xs" variant="secondary" onClick={() => { void leave(); }}>Leave</Button>
      )}
      {problem && <span style={{ color: "var(--amb4)" }}>{problem}</span>}
      {open && (
        <AddPeople sessionId={sessionId} people={people} onClose={() => setOpen(false)}
          onSaved={(members) => { onChange({ ...people, members }); setOpen(false); }} />
      )}
    </div>
  );
}

function AddPeople({ sessionId, people, onClose, onSaved }: {
  sessionId: string; people: People; onClose: () => void; onSaved: (members: string[]) => void;
}) {
  const [directory, setDirectory] = useState<DirectoryPerson[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(people.members));
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => { readDirectory().then(setDirectory).catch(() => setDirectory([])); }, []);
  const others = (directory ?? []).filter((p) => p.active && p.email.toLowerCase() !== people.you);
  const toggle = (email: string) => setChosen((was) => {
    const next = new Set(was);
    if (next.has(email)) next.delete(email); else next.add(email);
    return next;
  });
  const save = async () => {
    setBusy(true); setProblem("");
    try {
      const extra = typed.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      onSaved(await setThreadMembers(sessionId, [...chosen, ...extra]));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Add people to this conversation" width={520}
      testId="thread-add-people" busy={busy}
      description="They see it, and ask in it as themselves. Nobody else does.">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {people.single_person && (
          <span className="aug-fs-xs" data-testid="thread-single-person" style={{ color: "var(--amb4)" }}>
            Sign-in is off on this install, so everyone here is one person. The people you add see this conversation
            once sign-in is on.
          </span>
        )}
        {directory === null ? (
          <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Reading your organisation&rsquo;s people…</span>
        ) : others.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {others.map((p) => (
              <label key={p.email} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <Checkbox checked={chosen.has(p.email.toLowerCase())} onChange={() => toggle(p.email.toLowerCase())}
                  aria-label={p.name || p.email} />
                <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{p.name || p.email}</span>
                {p.name && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>{p.email}</span>}
              </label>
            ))}
          </div>
        ) : (
          <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>
            Your organisation&rsquo;s people are not listed here yet (Settings ▸ Access imports them). Add someone by the
            email they sign in with.
          </span>
        )}
        <Input aria-label="Emails" placeholder="Or type emails, separated by commas" value={typed}
          onChange={(e) => setTyped(e.target.value)} />
        {problem && <span className="aug-fs-xs" style={{ color: "var(--amb4)" }}>{problem}</span>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => { void save(); }} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
