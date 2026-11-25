"use client";

/**
 * Name people, as a person types (2026-11-25: an Area's Business and Technical contacts — "make sure contacts pop up
 * if they exist as users type name/email"). The chosen people stand as chips, each removable; typing a part of a name or
 * an email offers who the platform knows (`GET /people`: the directory, the person typing, people already named); Enter
 * or a click names the one offered, and a name nobody holds is named as typed. The value is who they sign in as
 * (`user:<id>`), as every owner is kept.
 */
import { useEffect, useId, useRef, useState } from "react";

import { MUTED } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { findPeople, personRef, personWords, type PersonFound } from "@/lib/people";

export function PeopleField({ id, label, value, onChange, placeholder = "Type a name or an email", testId }: {
  /** The input's id, for a label beside it. */
  id?: string;
  /** What the field names, as a reader of the page hears it. */
  label: string;
  value: string[];
  onChange: (refs: string[]) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PersonFound[]>([]);
  const [at, setAt] = useState(0);
  const listId = useId();
  const box = useRef<HTMLInputElement>(null);
  const chosen = new Set(value.map((r) => r.toLowerCase()));
  const offered = q.trim() ? found.filter((p) => !chosen.has(p.ref.toLowerCase())) : [];

  useEffect(() => {
    if (!q.trim()) return undefined;
    let live = true;
    const t = window.setTimeout(() => {
      findPeople(q).then((people) => { if (live) { setFound(people); setAt(0); } }).catch(() => { if (live) setFound([]); });
    }, 150);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);

  const add = (ref: string) => {
    if (ref && !chosen.has(ref.toLowerCase())) onChange([...value, ref]);
    setQ(""); setFound([]);
    box.current?.focus();
  };
  const remove = (ref: string) => onChange(value.filter((r) => r !== ref));
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && offered.length) { e.preventDefault(); setAt((i) => Math.min(i + 1, offered.length - 1)); }
    else if (e.key === "ArrowUp" && offered.length) { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" || e.key === ",") {
      if (!q.trim()) return;
      e.preventDefault();
      add(offered[at]?.ref ?? personRef(q));
    } else if (e.key === "Backspace" && !q && value.length) remove(value[value.length - 1]);
    else if (e.key === "Escape") { setQ(""); setFound([]); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }} data-testid={testId}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {value.map((ref) => (
          <span key={ref} className="aug-fs-sm" data-testid="people-chip"
            style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 2px 1px 8px", borderRadius: "var(--r1)",
                     background: "var(--bg-3)", color: "var(--t1)" }}>
            {personWords(ref)}
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${personWords(ref)}`} onClick={() => remove(ref)}>
              <Icon name="close" size={11} />
            </Button>
          </span>
        ))}
      </div>
      <Input bespoke id={id} ref={box} aria-label={label} placeholder={placeholder} value={q} role="combobox"
        aria-expanded={offered.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={offered.length ? `${listId}-${at}` : undefined}
        onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      {offered.length > 0 && (
        <div id={listId} role="listbox" aria-label={`People for ${label}`}
          style={{ display: "flex", flexDirection: "column", gap: 1, padding: 2, borderRadius: "var(--r2)", background: "var(--bg-2)" }}>
          {offered.map((p, i) => (
            <Button key={p.ref} id={`${listId}-${i}`} role="option" aria-selected={i === at} size="xs"
              variant={i === at ? "secondary" : "ghost"} style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "4px 6px" }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => add(p.ref)}>
              <Icon name="user" size={13} />
              <span>{p.name}</span>
              {p.email && p.email !== p.name && <span className="aug-fs-xs" style={MUTED}>{p.email}</span>}
              {p.source === "you" && <span className="aug-fs-xs" style={MUTED}>you</span>}
            </Button>
          ))}
        </div>
      )}
      {q.trim() && !offered.length && (
        <span className="aug-fs-xs" style={MUTED}>Nobody by that name yet — Enter names “{q.trim()}” as typed.</span>
      )}
    </div>
  );
}
