"use client";

/**
 * Find anything Discover lists by its name or by what it means (`GET /discover/search`, the plan's D3). One finder for
 * every place that picks a thing: a Definition's related assets, and "Add to this Area" on an Area's page (D4).
 */
import { useEffect, useState } from "react";

import { MUTED } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { KIND_ICON, KIND_WORDS, readDiscoverSearch, type DiscoverItem } from "@/lib/discover";

export function DiscoverFinder({ label, placeholder, onPick, onClose, taken, connectionId = "", note, testId = "discover-finder" }: {
  /** The search box's name, as a reader of the page hears it. */
  label: string;
  placeholder: string;
  onPick: (item: DiscoverItem) => void;
  onClose: () => void;
  /** What is already there, left out of what is found. */
  taken?: (item: DiscoverItem) => boolean;
  connectionId?: string;
  /** What a found thing says beside its kind, when the place picking it has something to add ("in Returns"). */
  note?: (item: DiscoverItem) => string;
  testId?: string;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DiscoverItem[] | null>(null);
  useEffect(() => {
    if (!q.trim()) { setFound(null); return; }
    let alive = true;
    const t = window.setTimeout(() => {
      readDiscoverSearch({ q, connectionId, limit: 8 }).then((r) => { if (alive) setFound(r.items); })
        .catch(() => { if (alive) setFound([]); });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, connectionId]);
  const shown = (found ?? []).filter((i) => !taken?.(i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 640 }} data-testid={testId}>
      <Input bespoke autoFocus aria-label={label} placeholder={placeholder}
        value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
      {shown.map((i) => (
        <Button key={`${i.kind}:${i.id}`} size="xs" variant="ghost" style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "4px 6px" }}
          onClick={() => { onPick(i); setQ(""); }}>
          <Icon name={KIND_ICON[i.kind]} size={13} /><span>{i.name}</span>
          <span className="aug-fs-xs" style={MUTED}>
            {KIND_WORDS[i.kind][0]}{i.connection_name ? ` · ${i.connection_name}` : ""}{note?.(i) ? ` · ${note(i)}` : ""}
          </span>
        </Button>
      ))}
      {found && !shown.length && <span className="aug-fs-xs" style={MUTED}>Nothing found by that name or meaning.</span>}
      <div><Button size="xs" variant="link" onClick={onClose}>Done</Button></div>
    </div>
  );
}
