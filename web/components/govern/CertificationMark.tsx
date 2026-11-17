"use client";

/**
 * The organisation's word on an asset — Certified or Deprecated — with the control a curator sets it by (the ontology
 * study, Phase 1, 2026-11-17). Shown as a chip where the asset is named; the action beside it opens a small form in
 * place: certify, deprecate (which says why, and what to use instead), or clear. The server decides who may — a curator,
 * or a document's owner — and its refusal is said here, never hidden.
 */
import { useEffect, useState } from "react";

import { Chip } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  certificationTitle,
  readCertification,
  setCertification,
  type CertStatus,
  type CertTarget,
  type Certification,
} from "@/lib/certification";

export function CertificationMark({ target, initial, compact = false }: {
  target: CertTarget;
  /** What the caller already read (a list's batch read), so a row asks nothing more. */
  initial?: Certification | null;
  /** In a list row: the mark only, and the action as a small link-sized button. */
  compact?: boolean;
}) {
  const [mark, setMark] = useState<Certification | null | undefined>(initial);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CertStatus>("certified");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initial !== undefined) { setMark(initial); return; }
    let alive = true;
    readCertification(target).then((c) => { if (alive) setMark(c); }).catch(() => { if (alive) setMark(null); });
    return () => { alive = false; };
  }, [target.kind, target.ref, target.connectionId, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next: CertStatus | "") => {
    setBusy(true); setError("");
    try {
      setMark(await setCertification(target, next, next ? why.trim() : ""));
      setOpen(false); setWhy("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-testid="certification-mark">
      {mark && (
        <Chip tone={mark.status === "certified" ? "up" : "amber"} title={certificationTitle(mark)} testId="certification-chip">
          {mark.status === "certified" ? "Certified" : "Deprecated"}
        </Chip>
      )}
      {!open && (
        <Button size="xs" variant={compact ? "ghost" : "outline"} onClick={() => { setStatus(mark?.status ?? "certified"); setWhy(mark?.why ?? ""); setOpen(true); }}
          title="Certify it as an asset the organisation vouches for, or deprecate it">
          {mark ? "Change" : "Certify or deprecate"}
        </Button>
      )}
      {open && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Button size="xs" variant={status === "certified" ? "secondary" : "ghost"} onClick={() => setStatus("certified")}>Certified</Button>
          <Button size="xs" variant={status === "deprecated" ? "secondary" : "ghost"} onClick={() => setStatus("deprecated")}>Deprecated</Button>
          <Input aria-label="Why" value={why} onChange={(e) => setWhy(e.target.value)} style={{ width: 260 }}
            placeholder={status === "deprecated" ? "Why, and what to use instead (required)" : "Why (optional)"} />
          <Button size="xs" disabled={busy || (status === "deprecated" && !why.trim())} onClick={() => void save(status)}>Save</Button>
          {mark && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void save("")}>Clear</Button>}
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Cancel</Button>
        </span>
      )}
      {error && <span className="aug-fs-xs" role="alert" style={{ color: "var(--red4)" }}>{error}</span>}
    </span>
  );
}
