"use client";

/**
 * Ask for access (Discover's left-out plan's C5, 2026-11-26): where the app says no and knows what was refused and whose
 * it is — a Data Canvas, a sheet — the refusal offers to ask, with a short reason. The ask goes to its maker (else the
 * admins) in their Inbox; once asked, the refusal says so rather than offering to ask again.
 */
import { useEffect, useState } from "react";

import { MUTED } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askForAccess, myAccessAsk, type AccessAsk } from "@/lib/needsYou";

const toWhom = (a: AccessAsk) => (a.to_admins ? "the admins" : a.to.join(", ") || "its maker");

export function AskForAccess({ thing, id }: { thing: "canvas" | "sheet"; id: string }) {
  const [asked, setAsked] = useState<AccessAsk | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    let live = true;
    myAccessAsk(thing, id).then((a) => { if (live) setAsked(a); }).catch(() => { if (live) setAsked(null); });
    return () => { live = false; };
  }, [thing, id]);
  const send = async () => {
    setBusy(true); setSaid("");
    try { setAsked(await askForAccess(thing, id, reason)); setOpen(false); }
    catch (e) { setSaid(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (asked === undefined) return null;
  if (asked) {
    return <span className="aug-fs-xs" style={MUTED} data-testid="access-asked">{`Asked ${toWhom(asked)} — waiting for their answer`}</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-testid="access-ask">
      {open ? (
        <>
          <Input aria-label="Why you need it" placeholder="Why you need it (optional)" value={reason} maxLength={500}
            onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
            style={{ width: 260, height: 26 }} />
          <Button size="xs" disabled={busy} onClick={() => void send()} data-testid="access-ask-send">{busy ? "Asking…" : "Send"}</Button>
          <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </>
      ) : (
        <Button size="xs" variant="secondary" onClick={() => setOpen(true)} data-testid="access-ask-open">Ask for access</Button>
      )}
      {said && <span className="aug-fs-xs" style={MUTED} role="status">{said}</span>}
    </span>
  );
}
