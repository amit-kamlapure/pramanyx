"use client";

/**
 * The dashboards home (the user, 2026-11-18): where Dashboards opens, in place of a strip of tabs over every dashboard,
 * so an open dashboard keeps the page's room for itself. One list to search, filter and sort, drawn as a list, with its
 * detail or as a grid. Metrics is pinned first. The way a person draws it and the dashboards they star follow them
 * (`/me/preferences`); a dashboard's miniature is its real layout and nothing it read.
 */
import { DropdownMenu } from "@radix-ui/themes";
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { Chip } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getMyPreferences, putMyPreference } from "@/lib/api";
import { certificationTitle } from "@/lib/certification";
import { HOME_VIEWS, NO_FILTERS, miniatureCell, modifiedWords, shownItems, type HomeFilters, type HomeItem, type HomeSort, type HomeView } from "@/lib/dashboards/homeList";

const VIEW_WORDS: Record<HomeView, { label: string; icon: IconName }> = {
  list: { label: "List", icon: "list" },
  detail: { label: "Detail", icon: "viewdetail" },
  grid: { label: "Grid", icon: "viewgrid" },
};
const CHIPS: { key: Exclude<keyof HomeFilters, "words">; label: string; icon: IconName }[] = [
  { key: "mine", label: "Owned by me", icon: "user" },
  { key: "week", label: "Modified this week", icon: "clock" },
  { key: "starred", label: "Favorited", icon: "star" },
  { key: "certified", label: "Certified", icon: "shield" },
];
/** This browser's memory of the view, so the page is not drawn one way and then another while the person's is read. */
const VIEW_CACHE = "pramanyx:dashboards-view";

const isView = (v: unknown): v is HomeView => (HOME_VIEWS as readonly unknown[]).includes(v);

/** The ground under the row or card the pointer is on, and the one it goes back to. */
const lit = (rest = "") => ({
  onMouseEnter: (e: MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; },
  onMouseLeave: (e: MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = rest; },
});

function useHomePrefs(connectionId: string) {
  const [view, setView] = useState<HomeView>(() => {
    try { const v = localStorage.getItem(VIEW_CACHE); return isView(v) ? v : "list"; } catch { return "list"; }
  });
  const [stars, setStars] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    getMyPreferences().then(({ preferences: p }) => {
      if (!alive) return;
      if (isView(p.dashboards_view)) setView(p.dashboards_view);
      if (Array.isArray(p.dashboard_stars)) setStars(p.dashboard_stars.map(String));
    }).catch(() => { /* the list is drawn as it stands: a person's choices are not what it reads */ });
    return () => { alive = false; };
  }, []);
  const chooseView = (next: HomeView) => {
    setView(next);
    try { localStorage.setItem(VIEW_CACHE, next); } catch { /* it is kept for the person below */ }
    putMyPreference("dashboards_view", next).catch(() => toast.error("The view was not kept for next time"));
  };
  const key = (id: string) => `${connectionId}:${id}`;
  const toggleStar = (id: string) => {
    const before = stars;
    const next = before.includes(key(id)) ? before.filter(s => s !== key(id)) : [...before, key(id)];
    setStars(next);
    putMyPreference("dashboard_stars", next).catch(() => { setStars(before); toast.error("The favorite was not kept"); });
  };
  const here = stars.filter(s => s.startsWith(`${connectionId}:`)).map(s => s.slice(connectionId.length + 1));
  return { view, chooseView, stars: here, toggleStar };
}

function Star({ item, on, onToggle }: { item: HomeItem; on: boolean; onToggle: () => void }) {
  return (
    <Button size="icon-xs" variant="ghost" aria-pressed={on} data-testid="dashboard-star"
      aria-label={on ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
      title={on ? "Favorited" : "Add to favorites"} onClick={e => { e.stopPropagation(); onToggle(); }}
      style={{ color: on ? "var(--amb3)" : "var(--t3)" }}>
      <Icon name={on ? "starred" : "star"} size={14} />
    </Button>
  );
}

/** How the dashboard stands: pinned, shared, published or a draft, and the organisation's word on it. */
function Marks({ item }: { item: HomeItem }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {item.pinned
        ? <Chip testId="dashboard-pinned"><Icon name="pin" size={11} /> Pinned</Chip>
        : <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>{item.state}</span>}
      {item.mark && (
        <Chip tone={item.mark.status === "certified" ? "up" : "amber"} title={certificationTitle(item.mark)}>
          {item.mark.status === "certified" ? "Certified" : "Deprecated"}
        </Chip>
      )}
    </span>
  );
}

/** A dashboard's layout in small: the room each piece takes on the tab it opens on. */
function Miniature({ item, height }: { item: HomeItem; height: number }) {
  const frame: CSSProperties = { height, overflow: "hidden", borderRadius: "var(--r2)", background: "color-mix(in srgb, var(--t3) 9%, transparent)" };
  if (!item.outline.length) {
    return <div aria-hidden style={{ ...frame, display: "grid", placeItems: "center", color: "var(--t3)" }}><Icon name="gauge" size={22} /></div>;
  }
  return (
    <div aria-hidden data-testid="dashboard-miniature" style={{ ...frame, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
      gridAutoRows: 5, gap: 3, padding: 8, alignContent: "start" }}>
      {item.outline.map((box, i) => {
        const { columns, rows } = miniatureCell(box);
        return <span key={i} style={{ gridColumn: `span ${columns}`, gridRow: `span ${rows}`, background: "color-mix(in srgb, var(--t3) 34%, transparent)", borderRadius: 2 }} />;
      })}
    </div>
  );
}

function Name({ item, onOpen }: { item: HomeItem; onOpen: () => void }) {
  return (
    <Button variant="plain" size="xs" data-testid="dashboard-open" onClick={e => { e.stopPropagation(); onOpen(); }}
      title={item.title} style={{ minWidth: 0, maxWidth: "100%", justifyContent: "flex-start", paddingInline: 0, color: "var(--t1)", fontWeight: 600 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
    </Button>
  );
}

const HEAD: CSSProperties = { textAlign: "left", fontWeight: 500, color: "var(--t3)", padding: "8px 12px", borderBottom: "1px solid var(--b1)", whiteSpace: "nowrap" };
const CELL: CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--b1)", color: "var(--t2)", whiteSpace: "nowrap" };

function ListView({ items, stars, onStar, onOpen }: ViewProps) {
  return (
    <table className="aug-fs-sm" data-testid="dashboards-list" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr><th style={HEAD}>Name</th><th style={HEAD}>Modified</th><th style={HEAD}>Owner</th><th style={HEAD}>Status</th></tr></thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} data-testid="dashboard-row" data-id={item.id} {...lit()} onClick={() => onOpen(item.id)} style={{ cursor: "pointer" }}>
            <td style={{ ...CELL, width: "50%", maxWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Star item={item} on={stars.includes(item.id)} onToggle={() => onStar(item.id)} />
                <span style={{ color: "var(--t3)", display: "inline-flex" }}><Icon name="gauge" size={15} /></span>
                <Name item={item} onOpen={() => onOpen(item.id)} />
              </span>
            </td>
            <td style={CELL}>{modifiedWords(item.modifiedAt)}</td>
            <td style={CELL}>{item.owner}</td>
            <td style={CELL}><Marks item={item} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function facts(item: HomeItem): string {
  return [
    item.cards != null ? `${item.cards} ${item.cards === 1 ? "card" : "cards"}` : "",
    item.version != null ? `version ${item.version}` : "",
    item.modifiedAt ? `modified ${modifiedWords(item.modifiedAt).toLowerCase()}` : "",
    `owner ${item.owner === "You" ? "you" : item.owner}`,
    item.audience.length ? `for ${item.audience.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
}

function DetailView({ items, stars, onStar, onOpen }: ViewProps) {
  return (
    <div data-testid="dashboards-detail" style={{ display: "flex", flexDirection: "column" }}>
      {items.map(item => (
        <div key={item.id} data-testid="dashboard-row" data-id={item.id} {...lit()} onClick={() => onOpen(item.id)}
          style={{ display: "grid", gridTemplateColumns: "148px minmax(0, 1fr) auto", gap: 16, alignItems: "center", padding: "12px", borderBottom: "1px solid var(--b1)", cursor: "pointer" }}>
          <Miniature item={item} height={84} />
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <Name item={item} onOpen={() => onOpen(item.id)} />
            {item.change && <div className="aug-fs-sm" style={{ color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.change}</div>}
            <div className="aug-fs-xs" style={{ color: "var(--t3)" }}>{facts(item)}</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Marks item={item} />
            <Star item={item} on={stars.includes(item.id)} onToggle={() => onStar(item.id)} />
          </span>
        </div>
      ))}
    </div>
  );
}

function GridView({ items, stars, onStar, onOpen }: ViewProps) {
  return (
    <div data-testid="dashboards-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
      {items.map(item => (
        <div key={item.id} data-testid="dashboard-row" data-id={item.id} {...lit("var(--bg-2)")} onClick={() => onOpen(item.id)}
          style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: "var(--r3)", backgroundColor: "var(--bg-2)", cursor: "pointer", minWidth: 0 }}>
          <Miniature item={item} height={132} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex" }}><Name item={item} onOpen={() => onOpen(item.id)} /></span>
            <Star item={item} on={stars.includes(item.id)} onToggle={() => onStar(item.id)} />
          </div>
          <div className="aug-fs-xs" style={{ color: "var(--t3)" }}>{item.modifiedAt ? `${modifiedWords(item.modifiedAt)} · ` : ""}{item.owner}</div>
          <Marks item={item} />
        </div>
      ))}
    </div>
  );
}

interface ViewProps { items: HomeItem[]; stars: string[]; onStar: (id: string) => void; onOpen: (id: string) => void }

export function DashboardHome({ connectionId, items, onOpen, children }: {
  connectionId: string;
  items: HomeItem[];
  onOpen: (id: string) => void;
  /** What the home says beneath its list: how to start a first dashboard of one's own. */
  children?: ReactNode;
}) {
  const { view, chooseView, stars, toggleStar } = useHomePrefs(connectionId);
  const [filters, setFilters] = useState<HomeFilters>(NO_FILTERS);
  const [sort, setSort] = useState<HomeSort>("modified");
  const shown = useMemo(() => shownItems(items, filters, sort, stars), [items, filters, sort, stars]);
  const filtering = filters.words.trim() !== "" || CHIPS.some(c => filters[c.key]);
  const Drawn = view === "grid" ? GridView : view === "detail" ? DetailView : ListView;
  return (
    <div data-testid="dashboards-home" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Input type="search" aria-label="Search dashboards" placeholder="Search dashboards…" data-testid="dashboards-search"
        leading={<Icon name="search" size={15} />} value={filters.words} onChange={e => setFilters(f => ({ ...f, words: e.target.value }))} />
      <div role="group" aria-label="Filters" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {CHIPS.map(c => (
          <Button key={c.key} size="xs" variant={filters[c.key] ? "secondary" : "ghost"} aria-pressed={filters[c.key]} data-testid={`dashboards-filter-${c.key}`}
            onClick={() => setFilters(f => ({ ...f, [c.key]: !f[c.key] }))}>
            <Icon name={c.icon} size={13} /> {c.label}
          </Button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
        <span className="aug-fs-ui" style={{ fontWeight: 600, color: "var(--t1)" }}>{filtering ? "Matching dashboards" : "All dashboards"}</span>
        <span className="aug-fs-sm" data-testid="dashboards-count" style={{ color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>
          {filtering ? `${shown.length} of ${items.length}` : items.length}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <SelectField aria-label="Sort dashboards" data-testid="dashboards-sort" value={sort} onChange={e => setSort(e.target.value as HomeSort)} style={{ width: 170 }}>
            <option value="modified">Recently modified</option>
            <option value="name">Name</option>
          </SelectField>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button size="sm" variant="ghost" data-testid="dashboards-view" aria-label={`View: ${VIEW_WORDS[view].label}`}>
                <Icon name={VIEW_WORDS[view].icon} size={14} /> {VIEW_WORDS[view].label} <Icon name="chevd" size={12} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="1" align="end">
              <DropdownMenu.RadioGroup value={view} onValueChange={v => { if (isView(v)) chooseView(v); }}>
                {HOME_VIEWS.map(v => (
                  <DropdownMenu.RadioItem key={v} value={v} data-testid={`dashboards-view-${v}`}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name={VIEW_WORDS[v].icon} size={14} /> {VIEW_WORDS[v].label}</span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </span>
      </div>
      {shown.length > 0 ? <Drawn items={shown} stars={stars} onStar={toggleStar} onOpen={onOpen} /> : (
        <div className="aug-fs-sm" data-testid="dashboards-none-match" style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 12px", color: "var(--t2)" }}>
          No dashboard matches these filters.
          <Button size="xs" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>
        </div>
      )}
      {children}
    </div>
  );
}
