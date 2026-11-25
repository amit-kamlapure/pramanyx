"use client";

/**
 * The parts of a Discover page other pages draw too (the user, 2026-11-26: "make sure that Design choices of 'Discover'
 * page are followed in Ontology and spaces that we [are] touching"): ONE row for a thing — its kind's glyph, its name on
 * one line and what it is on the next, its one mark and its Area at the right, a link to its page that opens in place,
 * "Ask about it" beside it — and the amber lines that say what could not be read. Discover lists with them; the Areas'
 * lists in the Ontology and the Inbox do too, a row there opening its page beside the list (`onOpen`) while ⌘-click
 * still opens it in a tab of the browser.
 */
import type { MouseEvent, ReactNode } from "react";

import { Chip, MUTED } from "@/components/clarity/kit";
import { useDiscoverHost } from "@/components/discover/host";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { openInApp } from "@/lib/addressOnce";
import { askAbout } from "@/lib/askSubject";
import { KIND_ICON, KIND_WORDS, askSubjectOf, markOf, secondLine, type DiscoverItem } from "@/lib/discover";

/** A click that opens in place; one with a modifier is the browser's (a new tab, a new window). */
export function inPlace(e: MouseEvent, open: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  open();
}

/** One thing: its kind, its name and what it is, its mark, and its Area (or, on the Area's own page, how it came to
 *  stand there). The row is a link to its page; "Ask about it" sits beside the link, never inside it. */
export function ItemRow({ item, areaName, many, how = false, actions, onOpen, tone }: {
  item: DiscoverItem; areaName?: string; many: boolean; how?: boolean;
  /** What may be done to it here — an Area's page gives its curators and the thing's owner a menu (D4). */
  actions?: ReactNode;
  /** Open it beside the list (the side panel) rather than go to its page; a click with a modifier still goes there. */
  onOpen?: (item: DiscoverItem) => void;
  /** Its glyph in its kind's colour, where the page colours by kind (the Areas, 2026-11-25); muted otherwise. */
  tone?: string;
}) {
  const mark = markOf(item);
  // shown in the coworker (D6), its host opens the thing and takes the question; else the app's own doors
  const host = useDiscoverHost();
  const subject = askSubjectOf(item);
  const ask = host ? (host.ask ? () => host.ask!(item) : null) : subject ? () => askAbout(subject) : null;
  const also = item.also_on?.length ? `also on ${item.also_on.join(", ")}` : "";
  const homes = item.workspaces?.length ? `in ${item.workspaces.join(", ")}` : "";
  const line = [secondLine(item, many || !!item.workspaces), also, homes].filter(Boolean).join(" · ");
  return (
    <div className="aug-discover-row" data-testid="discover-row">
      <a href={item.href} title={`${KIND_WORDS[item.kind][0]} · ${item.name}`}
        onClick={e => inPlace(e, () => (onOpen ? onOpen(item) : host ? host.open(item.href) : openInApp(item.href)))}>
        <span className="k" style={tone ? { color: tone } : undefined}><Icon name={KIND_ICON[item.kind]} size={15} /></span>
        <span className="main">
          <span className="n aug-fs-chrome">{item.name}</span>
          {line && <span className="d aug-fs-sm">{line}</span>}
        </span>
        <span className="meta aug-fs-xs">
          {item.matched?.length ? <span className="how" style={MUTED} title={item.matched.join(" · ")}>{item.matched.join(" · ")}</span> : null}
          {mark && <Chip tone={mark.tone}>{mark.word}</Chip>}
          {how
            ? item.area_how && <span className="how" style={MUTED} title={item.area_how}>{item.area_how}</span>
            : areaName && <Chip title={item.area_how || undefined}>{areaName}</Chip>}
        </span>
      </a>
      {ask && (
        <Button className="ask" size="icon-xs" variant="ghost" aria-label={`Ask about ${item.name}`} title="Ask about it"
          onClick={ask}>
          <Icon name="chat" size={14} />
        </Button>
      )}
      {actions}
    </div>
  );
}

export function Said({ lines }: { lines: string[] }): ReactNode {
  if (!lines.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }} data-testid="discover-said">
      {lines.map(l => (
        <span key={l} className="aug-fs-sm" style={{ color: "var(--amb4)", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <Icon name="warning" size={13} />{l}
        </span>
      ))}
    </div>
  );
}
