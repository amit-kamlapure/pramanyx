"use client";

/**
 * Who reads an uploaded document, and Share for its owner (punch list 82). An upload is private to the person who
 * brought it until they share it (the user, 2026-11-17); the server already had the owner's door
 * (`PUT /documents/{id}/access`) and no page called it. One line under the document's name says who reads it; its owner
 * opens a form to keep it to themselves, share it with people they choose, or with everyone in the organisation.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import {
  aboutWords, choiceOf, readersWords, sayDocumentAbout, shareDocument, sharedPeople, type DocumentAccess, type ShareChoice,
} from "@/lib/documentAccess";
import { readDirectory, type DirectoryPerson } from "@/lib/threads";

/** Which data an upload is about (2026-11-25): one connection's answers alone, or every connection's. The Superstore
 *  handbook reached a theLook answer because an upload could not say. Its owner, or an admin, chooses here; anyone
 *  else reads it. */
export function DocumentAbout({ docId, name, connectionId, connections, maySay, onSaid }: {
  docId: string; name: string; connectionId: string | null; connections: ReadonlyArray<{ id: string; name: string }>;
  maySay: boolean; onSaid: (next: { connection_id: string; by: string; at: string } | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!maySay) {
    return <span data-testid="document-about" className="aug-fs-xs" style={{ color: "var(--t3)" }}>{aboutWords(connectionId, connections)}</span>;
  }
  return (
    <span data-testid="document-about" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <SelectField value={connectionId ?? ""} disabled={busy} aria-label={`Which data ${name} is about`}
        onChange={(e) => {
          const next = e.target.value || null;
          setBusy(true); setFailed(null);
          sayDocumentAbout(docId, next).then(onSaid).catch((err: Error) => setFailed(err.message)).finally(() => setBusy(false));
        }}>
        <option value="">For every connection</option>
        {connections.map((c) => <option key={c.id} value={c.id}>{`For ${c.name} only`}</option>)}
      </SelectField>
      {failed && <span role="alert" className="aug-fs-xs" style={{ color: "var(--red4)" }}>{failed}</span>}
    </span>
  );
}

export function DocumentReaders({ docId, name, access, yours, onShared }: {
  docId: string; name: string; access?: DocumentAccess; yours: boolean; onShared: (next: DocumentAccess) => void;
}) {
  const [open, setOpen] = useState(false);
  const words = readersWords(access, yours);
  if (!words) return null;
  return (
    <span data-testid="document-readers" className="aug-fs-xs" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t3)" }}>
      <span data-testid="document-readers-words">{words}</span>
      {yours && <Button size="xs" variant="outline" onClick={() => setOpen(true)}>Share</Button>}
      {open && (
        <ShareForm docId={docId} name={name} access={access} onClose={() => setOpen(false)}
          onSaved={(next) => { onShared(next); setOpen(false); }} />
      )}
    </span>
  );
}

function ShareForm({ docId, name, access, onClose, onSaved }: {
  docId: string; name: string; access?: DocumentAccess; onClose: () => void; onSaved: (next: DocumentAccess) => void;
}) {
  const [choice, setChoice] = useState<ShareChoice>(choiceOf(access));
  const [directory, setDirectory] = useState<DirectoryPerson[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(sharedPeople(access)));
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => { readDirectory().then(setDirectory).catch(() => setDirectory([])); }, []);
  const owner = (access?.owner ?? "").toLowerCase();
  const others = (directory ?? []).filter((p) => p.active && p.email.toLowerCase() !== owner);
  const toggle = (email: string) => setChosen((was) => {
    const next = new Set(was);
    if (next.has(email)) next.delete(email); else next.add(email);
    return next;
  });
  const save = async () => {
    setBusy(true); setProblem("");
    try {
      const extra = typed.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      const people = [...new Set([...chosen, ...extra])];
      if (choice === "people" && !people.length) throw new Error("Choose someone to share it with, or keep it to yourself.");
      onSaved(await shareDocument(docId, choice, people));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`Who may read “${name}”`} width={520}
      testId="document-share" busy={busy}
      description="Only you decide. Whoever may read it can find it, and their answers can quote it.">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Segmented label="Who may read it" value={choice} onChange={setChoice}
          options={[{ value: "me", label: "Only me" }, { value: "people", label: "People I choose" },
                    { value: "org", label: "Everyone in the organisation" }]} />
        {choice === "people" && (directory === null ? (
          <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Reading your organisation&rsquo;s people…</span>
        ) : (
          <>
            {others.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                {others.map((p) => (
                  <label key={p.email} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                    <Checkbox checked={chosen.has(p.email.toLowerCase())} onChange={() => toggle(p.email.toLowerCase())}
                      aria-label={p.name || p.email} />
                    <span className="aug-fs-chrome" style={{ color: "var(--t1)" }}>{p.name || p.email}</span>
                    {p.name && <span className="aug-fs-sm" style={{ color: "var(--t3)" }}>{p.email}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>
                Your organisation&rsquo;s people are not listed here yet (Settings ▸ Access imports them). Add someone by
                the email they sign in with.
              </span>
            )}
            <Input aria-label="Emails" placeholder="Or type emails, separated by commas" value={typed}
              onChange={(e) => setTyped(e.target.value)} />
          </>
        ))}
        {problem && <span className="aug-fs-xs" role="alert" style={{ color: "var(--amb4)" }}>{problem}</span>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => { void save(); }} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
