"use client";

/**
 * Choose a glyph from a dropdown (2026-11-25, the user: "such way of choosing the icons (dropdown basically).. add the
 * ones which are missing" — and no colour row). A button shows the glyph chosen; it opens a list a person searches by
 * name or by what the glyph is about, and picks from a grid, in groups. The arrow keys move through the grid, Enter or
 * a click picks and closes, Escape closes. One colour, as every tile on the platform (`ui/icon-square.tsx`).
 */
import { Popover } from "@radix-ui/themes";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { Input } from "@/components/ui/input";

/** Glyphs a row of the grid holds — the arrow keys move a row up and down by this many. */
const PER_ROW = 8;

export function IconPicker({ value, onChange, groups, find, label, testId }: {
  value: IconName;
  onChange: (name: IconName) => void;
  /** The glyphs offered, in groups, as a reader browses them. */
  groups: { group: string; icons: IconName[] }[];
  /** The glyphs a search finds, in order (every one for nothing typed). */
  find: (typed: string) => IconName[];
  /** What the glyph is for, as a reader of the page hears it ("Its icon"). */
  label: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [at, setAt] = useState<IconName | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const found = useMemo(() => (typed.trim() ? find(typed) : null), [find, typed]);
  const shown: { group: string; icons: IconName[] }[] = found ? [{ group: "", icons: found }] : groups;
  const order = shown.flatMap((g) => g.icons);

  const pick = (name: IconName) => { onChange(name); setOpen(false); setTyped(""); };
  const focusOn = (name: IconName) => {
    setAt(name);
    grid.current?.querySelector<HTMLElement>(`[data-glyph="${name}"]`)?.focus();
  };
  const onGridKey = (e: React.KeyboardEvent) => {
    const here = order.indexOf(at ?? value);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: PER_ROW, ArrowUp: -PER_ROW }[e.key];
    if (step === undefined || here < 0) return;
    e.preventDefault();
    const next = order[Math.min(order.length - 1, Math.max(0, here + step))];
    if (next) focusOn(next);
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <Popover.Trigger>
        <Button type="button" variant="secondary" size="sm" data-testid={testId} aria-label={`${label}: ${value}`}
          aria-haspopup="dialog" style={{ gap: 6, paddingLeft: 4 }}>
          <IconSquare name={value} size={24} />
          <Icon name="chevd" size={14} />
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1" align="start" data-testid={testId ? `${testId}-list` : undefined} aria-label={label}
        style={{ width: 344, maxWidth: "calc(100vw - 32px)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Input aria-label="Search icons" placeholder="Search icons" value={typed} autoFocus
            onChange={(e) => { setTyped(e.target.value); setAt(null); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && order.length) { e.preventDefault(); focusOn(order[0]); }
              else if (e.key === "Enter" && found?.length === 1) { e.preventDefault(); pick(found[0]); }
            }} />
          <div ref={grid} role="radiogroup" aria-label={label} onKeyDown={onGridKey}
            // one height whatever a search leaves, so the list never jumps to the other side of its button as you type
            style={{ display: "flex", flexDirection: "column", gap: 8, height: 280, overflowY: "auto", paddingRight: 2 }}>
            {shown.map((g) => (
              <div key={g.group || "found"} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {g.group && <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>{g.group}</span>}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))`, gap: 4 }}>
                  {g.icons.map((name) => (
                    <Button key={name} type="button" size="icon-sm" variant={name === value ? "secondary" : "ghost"}
                      role="radio" aria-checked={name === value} aria-label={name} title={name} data-glyph={name}
                      tabIndex={name === (at ?? value) || (!order.includes(at ?? value) && name === order[0]) ? 0 : -1}
                      onFocus={() => setAt(name)} onClick={() => pick(name)}
                      style={name === value ? { boxShadow: "inset 0 0 0 1px var(--accent)" } : undefined}>
                      <IconSquare name={name} size={24} />
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            {found && !found.length && (
              <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>No icon by that name — try what the Area is about.</span>
            )}
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
