"use client";

/**
 * An Area's curation on its Discover page (the plan's D4, §4.2 and §4.4; the user's call, 2026-11-23): its owners, and
 * whoever administers the organisation, write its description, name its owners and choose what it features; anything
 * Discover lists is added to it; and a thing a person placed is taken out again. A thing's own owner may place it too.
 * Edited in place on the page, never in a pop-up (no pop-up on every click); every change is saved as it is made by the
 * server's own checks, and published on save.
 */
import { useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";

import { Card, MUTED } from "@/components/clarity/kit";
import { DiscoverFinder } from "@/components/discover/DiscoverFinder";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { RichText, type RichTextKind } from "@/components/ui/rich-text";
import { toast } from "@/components/ui/toast";
import { people } from "@/lib/areas";
import { bodyHref } from "@/lib/definitionBody";
import {
  KIND_WORDS, mayPlace, placeInDiscoverArea, saveDiscoverArea, type DiscoverAreaPage, type DiscoverItem, type FeaturedRef,
} from "@/lib/discover";

/** The most an Area's page puts first, and the longest description it keeps — the server's own bounds. */
export const MAX_FEATURED = 12;
export const MAX_DESCRIPTION = 2000;

/** What an Area's description may hold when written (`RichText`): a few paragraphs, bold, italics, lists and links — to
 *  the web or a page of the app — and no heading or table: its name heads the page. Drawn by `DefinitionBody`. */
export const AREA_TEXT: RichTextKind = {
  headings: [], lists: true, table: false, code: false, quote: false, rule: false,
  linkHref: (h) => bodyHref(h)?.href ?? null, linkHint: "https://… or a page of the app (/?tab=…)",
};

const aThing = (word: string) => `${/^[aeiou]/i.test(word) ? "An" : "A"} ${word}`;
const plain = (owners: string[]) => owners.map((o) => o.replace(/^user:/, "")).join(", ");
const isFeatured = (page: DiscoverAreaPage, item: DiscoverItem) => page.featured_refs.some((f) => f.kind === item.kind && f.ref === item.id);

/** Edit an Area: its description, its owners and the order of what it features. */
export function AreaEditor({ page, workspaceId, onSaved, onCancel }: {
  page: DiscoverAreaPage; workspaceId?: string; onSaved: () => void; onCancel: () => void;
}) {
  const a = page.area;
  const [description, setDescription] = useState(a.description ?? "");
  const [business, setBusiness] = useState(plain(a.business_owners));
  const [technical, setTechnical] = useState(plain(a.technical_owners));
  const [featured, setFeatured] = useState<FeaturedRef[]>(page.featured_refs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const named = (f: FeaturedRef) => page.featured.find((i) => i.kind === f.kind && i.id === f.ref)?.name;
  const move = (at: number, by: -1 | 1) => setFeatured((list) => {
    const next = [...list];
    [next[at], next[at + by]] = [next[at + by], next[at]];
    return next;
  });
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await saveDiscoverArea(a.id, { description: description.trim(), business_owners: people(business),
        technical_owners: people(technical), featured }, workspaceId);
      onSaved();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); setBusy(false); }
  };
  return (
    <Card label={`Edit ${a.name}`} testId="discover-area-editor" right={
      <span style={{ display: "inline-flex", gap: 6 }}>
        <Button size="xs" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="xs" onClick={() => void save()} disabled={busy || description.length > MAX_DESCRIPTION}>{busy ? "Saving…" : "Save"}</Button>
      </span>}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 160px) 1fr", gap: "10px 16px", alignItems: "start" }}>
        <span className="aug-fs-sm" style={{ ...MUTED, paddingTop: 6 }}>Description</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* written as it reads (the user, 2026-11-23), kept as Markdown */}
          <RichText kind={AREA_TEXT} label="Description" value={description} onChange={setDescription} max={MAX_DESCRIPTION}
            minHeight={96} placeholder={`What ${a.name} covers, and what someone new to it should know`} testId="area-description-editor" />
          <span className="aug-fs-xs" style={MUTED}>Its question stays the line under its name.</span>
        </div>
        <label className="aug-fs-sm" htmlFor="area-business" style={{ ...MUTED, paddingTop: 6 }}>Owned by</label>
        <Input bespoke id="area-business" value={business} onChange={(e) => setBusiness(e.target.value)}
          placeholder="Who answers for what it means — names, separated by commas" />
        <label className="aug-fs-sm" htmlFor="area-technical" style={{ ...MUTED, paddingTop: 6 }}>Its data by</label>
        <Input bespoke id="area-technical" value={technical} onChange={(e) => setTechnical(e.target.value)}
          placeholder="Who answers for its data — names, separated by commas" />
        <span className="aug-fs-sm" style={{ ...MUTED, paddingTop: 4 }}>Featured</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="discover-area-editor-featured">
          {!featured.length && <span className="aug-fs-sm" style={MUTED}>Nothing yet — choose “Feature” on a row of this page.</span>}
          {featured.map((f, at) => (
            <div key={`${f.kind}:${f.ref}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="aug-fs-sm" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {named(f) ?? <span style={MUTED}>{aThing(KIND_WORDS[f.kind]?.[0] ?? "thing")} you may not open, or no longer there</span>}
              </span>
              <Button size="icon-xs" variant="ghost" aria-label={`Move ${named(f) ?? "it"} up`} disabled={at === 0} onClick={() => move(at, -1)}>
                <Icon name="chevu" size={13} />
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label={`Move ${named(f) ?? "it"} down`} disabled={at === featured.length - 1} onClick={() => move(at, 1)}>
                <Icon name="chevd" size={13} />
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label={`Stop featuring ${named(f) ?? "it"}`}
                onClick={() => setFeatured((list) => list.filter((_, i) => i !== at))}>
                <Icon name="close" size={13} />
              </Button>
            </div>
          ))}
        </div>
      </div>
      {err && <p className="aug-fs-sm" role="alert" style={{ color: "var(--red4)", margin: "10px 0 0" }}>{err}</p>}
    </Card>
  );
}

/** Add anything Discover lists to this Area: found by its name or what it means, placed on a click. */
export function AddToArea({ page, workspaceId, onAdded, onClose }: {
  page: DiscoverAreaPage; workspaceId?: string; onAdded: (item: DiscoverItem) => void; onClose: () => void;
}) {
  const [err, setErr] = useState("");
  const a = page.area;
  return (
    <Card label={`Add to ${a.name}`} testId="discover-area-add">
      <DiscoverFinder label={`Find something to add to ${a.name}`} placeholder="Find a table, metric, dashboard, canvas, agent, document…"
        onClose={onClose}
        // already here, or a Definition — whose Area is chosen on its own page
        taken={(i) => i.area === a.id || i.kind === "definition"}
        onPick={(i) => {
          setErr("");
          placeInDiscoverArea(i, a.id, workspaceId).then(() => { toast.success(`${i.name} is in ${a.name} now`); onAdded(i); })
            .catch((e) => setErr(String((e as Error)?.message ?? e)));
        }} />
      {err && <p className="aug-fs-sm" role="alert" style={{ color: "var(--red4)", margin: "6px 0 0" }}>{err}</p>}
    </Card>
  );
}

/** What a curator, or a thing's own owner, may do to one row of this Area's page. Nothing to offer, nothing drawn. */
export function RowMenu({ item, page, workspaceId, onChanged }: {
  item: DiscoverItem; page: DiscoverAreaPage; workspaceId?: string; onChanged: () => void;
}) {
  const curate = page.can_curate;
  const takeOut = item.placed && item.area === page.area.id && mayPlace(page, item);
  if (!curate && !takeOut) return null;
  const first = isFeatured(page, item);
  const full = !first && page.featured_refs.length >= MAX_FEATURED;
  const run = (what: Promise<unknown>, said: string) =>
    what.then(() => { toast.success(said); onChanged(); }).catch((e) => toast.error(String((e as Error)?.message ?? e)));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button size="icon-xs" variant="ghost" aria-label={`More for ${item.name}`} title="More">
          <Icon name="more" size={14} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end">
        {curate && (
          <DropdownMenu.Item disabled={full} onSelect={() => run(saveDiscoverArea(page.area.id, {
            featured: first ? page.featured_refs.filter((f) => !(f.kind === item.kind && f.ref === item.id))
              : [...page.featured_refs, { kind: item.kind, ref: item.id }] }, workspaceId),
            first ? `${item.name} is no longer featured` : `${item.name} is featured in ${page.area.name}`)}>
            {first ? "Stop featuring" : full ? `Feature (${MAX_FEATURED} featured already)` : `Feature in ${page.area.name}`}
          </DropdownMenu.Item>
        )}
        {takeOut && (
          <DropdownMenu.Item onSelect={() => run(placeInDiscoverArea(item, "", workspaceId), `${item.name} is out of ${page.area.name}`)}>
            Take out of {page.area.name}
          </DropdownMenu.Item>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
