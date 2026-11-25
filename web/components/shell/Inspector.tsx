"use client";

/**
 * The one side panel (2026-11-10, ROADMAP §6 item 64; the Evidence → Action mockups) — since 2026-11-25 a panel of TABS,
 * one for each thing opened, as the coworker's side panel holds what it opens and the reference Ontology manager holds
 * each page, metric or snippet clicked (the user: "several artefacts … open up in the right panel in the form of tabs").
 * Selecting a thing anywhere — an object in a table, a result column, a claim, a metric, an Area's page — opens it as a
 * tab at the right of the page, or brings its tab forward; each tab says what it is with its glyph and closes with ×.
 * A thing with several facets keeps them under its title: Overview · Definition · Relations · Provenance · Activity ·
 * Actions · Assist, the ones that do not apply hidden; a thing that is a page of its own (`bare`) draws its own title.
 *
 * The user's answers: it opens on SELECTION and stays open while the reader moves between things; Esc or × closes the
 * tab in front, the panel going with its last; it widens to the page's whole width and back, and hides out of the way
 * with its tabs kept. A page keeps its full width otherwise. It JOINS the drawers and detail pieces that exist — it
 * replaces one only once it does all that one did ("Do not remove features as a cost of redesign").
 *
 * A page opens a tab with `useInspector().inspect(subject)`; the shell draws `<InspectorHost/>` once, beside the content.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { ResizeGrip, useKeptWidth } from "@/components/ui/resize-grip";
import { TabStrip } from "@/components/ui/tab-strip";

export const INSPECTOR_TABS = ["overview", "definition", "relations", "provenance", "activity", "actions", "assist"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];
const TAB_WORD: Record<InspectorTab, string> = {
  overview: "Overview", definition: "Definition", relations: "Relations", provenance: "Provenance",
  activity: "Activity", actions: "Actions", assist: "Assist",
};

/** How many things stay open side by side; opening one more lets go of the one opened longest ago (not the one shown). */
export const MAX_OPEN_TABS = 8;

export interface InspectorSubject {
  /** Stable identity: the same thing opened twice keeps its tab. */
  key: string;
  /** What kind of thing it is, as a chip: "Order", "Result column", "Claim". */
  kind: string;
  title: string;
  icon?: IconName;
  /** A line under the title: its id, its state. */
  meta?: ReactNode;
  /** Its tabs; a tab not given is not drawn. */
  tabs: Partial<Record<InspectorTab, ReactNode>>;
  /** The tab to open on, when the subject is new. */
  tab?: InspectorTab;
  /** A page of its own (a Definition, a metric, an Area): it draws its own title, so the panel draws none over it. */
  bare?: boolean;
}

interface InspectorStore {
  /** The thing in front, or null when nothing is open. */
  subject: InspectorSubject | null;
  /** Everything open, in the order it was opened. */
  open: InspectorSubject[];
  /** Open a thing as a tab and bring it forward — or, open already, draw its tab again from what is given. */
  inspect: (subject: InspectorSubject) => void;
  /** Bring an open tab forward. */
  activate: (key: string) => void;
  /** Close one tab — the one in front when none is named. The panel goes with the last. */
  close: (key?: string) => void;
  closeAll: () => void;
}

const InspectorContext = createContext<InspectorStore | null>(null);

/** Opened `s` among `open`: the same key keeps its place and is drawn again; a new one goes last, and past the cap the
 *  one opened longest ago — never the one in front — is let go. */
export function withSubject(open: InspectorSubject[], s: InspectorSubject, front: string | null): InspectorSubject[] {
  if (open.some(o => o.key === s.key)) return open.map(o => (o.key === s.key ? s : o));
  const next = [...open, s];
  while (next.length > MAX_OPEN_TABS) {
    const drop = next.findIndex(o => o.key !== front && o.key !== s.key);
    if (drop < 0) break;
    next.splice(drop, 1);
  }
  return next;
}

/** Holds what is open. Closes everything when the page changes (`pageKey`): a thing from one page never stays over the
 *  next. */
type Held = { open: InspectorSubject[]; front: string | null };
type Act = { do: "inspect"; s: InspectorSubject } | { do: "activate"; key: string } | { do: "close"; key?: string } | { do: "clear" };
const NOTHING: Held = { open: [], front: null };

/** What is open after one act — pure, so a tab's coming and going is one step. */
export function held(h: Held, a: Act): Held {
  switch (a.do) {
    case "inspect": return { open: withSubject(h.open, a.s, h.front), front: a.s.key };
    case "activate": return h.open.some(o => o.key === a.key) ? { ...h, front: a.key } : h;
    case "clear": return NOTHING;
    case "close": {
      const front = h.open.some(o => o.key === h.front) ? h.front : h.open[h.open.length - 1]?.key ?? null;
      const gone = a.key ?? front;
      const i = h.open.findIndex(o => o.key === gone);
      if (i < 0) return h;
      const left = h.open.filter(o => o.key !== gone);
      // the tab in front closed: the one beside it comes forward, as tabs do
      return { open: left, front: gone === front ? left[Math.min(i, left.length - 1)]?.key ?? null : front };
    }
  }
}

export function InspectorProvider({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const [{ open, front }, act] = useReducer(held, NOTHING);
  const inspect = useCallback((s: InspectorSubject) => act({ do: "inspect", s }), []);
  const activate = useCallback((key: string) => act({ do: "activate", key }), []);
  const close = useCallback((key?: string) => act({ do: "close", key }), []);
  const closeAll = useCallback(() => act({ do: "clear" }), []);
  useEffect(() => { act({ do: "clear" }); }, [pageKey]);
  const subject = open.find(o => o.key === front) ?? open[open.length - 1] ?? null;
  const value = useMemo(() => ({ subject, open, inspect, activate, close, closeAll }),
    [subject, open, inspect, activate, close, closeAll]);
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

/** Open (or bring forward) a tab, close one, or read what is open. Outside the shell it does nothing. */
export function useInspector(): InspectorStore {
  return useContext(InspectorContext) ?? NO_INSPECTOR;
}
const NO_INSPECTOR: InspectorStore = {
  subject: null, open: [], inspect: () => {}, activate: () => {}, close: () => {}, closeAll: () => {},
};

const WIDTH_KEY = "pramanyx_inspector_width";
// Wide enough for a page of its own beside the page it came from (the reference keeps a third of the screen for it).
const MIN_W = 320, MAX_W = 960, DEFAULT_W = 420;


/**
 * The tab strip's look, set on the elements themselves rather than in `globals.css`: the user's dev server keeps a
 * compiled stylesheet across a checkout move and served this strip with none of its rules (2026-11-26: the tabs ran over
 * each other and the controls fell onto lines of their own), so what holds the strip together travels with it.
 */
export const SIDE = {
  bar: { display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 4px 10px", minWidth: 0, flexShrink: 0 },
  open: { display: "flex", alignItems: "center", gap: 2, flex: "1 1 auto", minWidth: 0, overflowX: "auto", overflowY: "hidden",
    scrollbarWidth: "none" },
  // a tab gives way to its neighbours down to where its name still reads; past that the strip scrolls sideways
  tab: (front: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", flex: "0 1 auto", minWidth: 96,
    maxWidth: 200, height: 26, borderRadius: "var(--r2)", background: front ? "var(--bg-3)" : undefined,
    color: front ? "var(--t1)" : "var(--t2)" }),
  name: { gap: 6, minWidth: 0, maxWidth: "100%", overflow: "hidden", padding: "0 2px 0 8px", color: "inherit", justifyContent: "flex-start" },
  text: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  controls: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0, color: "var(--t2)" },
} satisfies Record<string, CSSProperties | ((front: boolean) => CSSProperties)>;

/** The panel itself — drawn once by the shell, beside the content; nothing at all while nothing is open. */
export function InspectorHost() {
  const { subject, open, activate, close, closeAll } = useInspector();
  const [facet, setFacet] = useState<InspectorTab>("overview");
  const [width, keep] = useKeptWidth(WIDTH_KEY, DEFAULT_W, MIN_W, MAX_W);
  // the panel at the page's whole width, or tucked away with its tabs kept — the coworker's side panel does both
  const [full, setFull] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastKey = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  // At the page's whole width the page beside it steps aside, and comes back as it was.
  useEffect(() => {
    if (!full) return undefined;
    const page = panel.current?.parentElement?.querySelector<HTMLElement>(":scope > .aug-page-surface");
    if (!page) return undefined;
    const was = page.style.display;
    page.style.display = "none";
    return () => { page.style.display = was; };
  }, [full]);
  // A new thing opens on its own facet; the same thing again keeps the facet the reader was on.
  useEffect(() => {
    if (!subject) { lastKey.current = null; setFull(false); setHidden(false); return; }
    if (subject.key !== lastKey.current) {
      lastKey.current = subject.key;
      const first = INSPECTOR_TABS.find(t => subject.tabs[t] != null) ?? "overview";
      setFacet(subject.tab && subject.tabs[subject.tab] != null ? subject.tab : first);
      setHidden(false);   // something opened shows itself
    }
  }, [subject]);
  // Esc closes the tab in front — unless the reader is typing, or an overlay (a menu, a dialog) is open above the page.
  useEffect(() => {
    if (!subject || hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='menu']")) return;
      if (full) { setFull(false); return; }
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subject, hidden, full, close]);


  if (!subject) return null;
  if (hidden) {
    return (
      <aside className="aug-inspector" aria-label="The side panel, hidden"
        style={{ width: 36, alignItems: "center", paddingTop: 8, gap: 4 }}>
        <Button variant="ghost" size="icon-sm" aria-label={`Show the side panel — ${open.length} open`} title="Show the side panel"
          onClick={() => setHidden(false)}>
          <Icon name="panelshow" size={16} />
        </Button>
        <span className="aug-fs-xs" style={{ color: "var(--t3)" }} aria-hidden>{open.length}</span>
      </aside>
    );
  }
  const tabs = INSPECTOR_TABS.filter(t => subject.tabs[t] != null);
  const shown = tabs.includes(facet) ? facet : tabs[0];
  return (
    <aside ref={panel} className="aug-inspector" data-full={full || undefined} aria-label={`Inspector: ${subject.title}`}
      style={full ? { flex: "1 1 auto", minWidth: 0 } : { width }}>
      {!full && <ResizeGrip edge="left" width={width} min={MIN_W} max={MAX_W} onWidth={keep} label="Resize the inspector" />}
      <div style={SIDE.bar}>
        <div role="tablist" aria-label="Open in the side panel" style={SIDE.open}>
          {open.map(o => (
            <span key={o.key} style={SIDE.tab(o.key === subject.key)}>
              <Button variant="ghost" size="xs" role="tab" aria-selected={o.key === subject.key} title={`${o.title} — ${o.kind}`}
                style={SIDE.name} onClick={() => activate(o.key)}>
                {o.icon && <Icon name={o.icon} size={13} />}
                <span style={SIDE.text}>{o.title}</span>
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Close ${o.title}`} title="Close · Esc" onClick={() => close(o.key)}>
                <Icon name="close" size={11} />
              </Button>
            </span>
          ))}
        </div>
        <span style={SIDE.controls}>
          <Button variant="ghost" size="icon-xs" aria-label={full ? "Back to its width" : "Widen to the whole page"}
            title={full ? "Back to its width · Esc" : "Widen to the whole page"} onClick={() => setFull(f => !f)}>
            <Icon name={full ? "restore" : "expand"} size={14} />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Hide the side panel" title="Hide the side panel — its tabs are kept"
            onClick={() => { setFull(false); setHidden(true); }}>
            <Icon name="panelhide" size={14} />
          </Button>
          {open.length > 1 && (
            <Button variant="ghost" size="icon-xs" aria-label="Close every tab" title="Close every tab" onClick={closeAll}>
              <Icon name="close" size={14} />
            </Button>
          )}
        </span>
      </div>
      {!subject.bare && (
        <header className="aug-inspector-head">
          <div className="aug-inspector-row1">
            {subject.icon && <span className="aug-inspector-glyph" aria-hidden><Icon name={subject.icon} size={14} /></span>}
            <span className="aug-inspector-title" title={subject.title}>{subject.title}</span>
            <span className="aug-inspector-kind">{subject.kind}</span>
          </div>
          {subject.meta && <div className="aug-inspector-meta">{subject.meta}</div>}
        </header>
      )}
      {tabs.length > 1 && (
        <TabStrip label="Inspector tabs" size="1" value={shown} onChange={setFacet} className="aug-inspector-tabs"
          tabs={tabs.map(t => ({ id: t, label: TAB_WORD[t] }))} />
      )}
      <div className="aug-inspector-body" role="tabpanel" aria-label={TAB_WORD[shown]} key={subject.key}>
        {subject.tabs[shown]}
      </div>
    </aside>
  );
}

/** A key/value grid for an inspector tab: the label muted on the left, the value beside it. */
export function InspectorFacts({ rows }: { rows: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="aug-inspector-facts">
      {rows.map((r, i) => (
        <div key={`${i}:${r.label}`} className="aug-inspector-fact">
          <dt>{r.label}</dt>
          <dd>{r.value}{r.note && <div className="aug-inspector-note">{r.note}</div>}</dd>
        </div>
      ))}
    </dl>
  );
}
