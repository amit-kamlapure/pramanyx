"use client";

/**
 * Settings ▸ Access ▸ People — the organisation's directory (People, 2026-11-15): who is here, their title, team and
 * manager. Filled from a CSV in a dialog that shows what an import would change before it changes it; a team becomes
 * the function group of that name (`pramanyx/rbac/directory.py`). Visible to role administrators only, like the roster.
 */
import { useCallback, useEffect, useState } from "react";

import { Card, Chip, Empty, MUTED, NUM, ONE_LINE, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { getDirectory, importDirectory, type DirectoryImportPlan, type DirectoryPerson } from "@/lib/api";

import { plural } from "./settings/parts";

const LIST_ROW = { ...ROW, gap: 10, padding: "7px 0", ...RULE, flexWrap: "nowrap" as const };

function said(plan: DirectoryImportPlan): string {
  const parts = [
    plan.add.length && plural(plan.add.length, "person", "people") + " added",
    plan.change.length && plural(plan.change.length, "person", "people") + " changed",
    plan.deactivate.length && plural(plan.deactivate.length, "person", "people") + " deactivated",
    plan.teams_new.length && plural(plan.teams_new.length, "new team"),
    plan.unchanged && `${plan.unchanged} unchanged`,
  ].filter(Boolean);
  return parts.join(" · ") || "Nothing to change";
}

export function PeopleDirectoryCard({ canManage, onImported }: { canManage: boolean; onImported?: () => void }) {
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [full, setFull] = useState(true);
  const [plan, setPlan] = useState<DirectoryImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const read = useCallback(async () => {
    try { setPeople(await getDirectory()); } catch (e) { setErr(e instanceof Error ? e.message : "Reading failed"); }
  }, []);
  useEffect(() => { if (canManage) void read(); }, [canManage, read]);

  const close = () => { setOpen(false); setCsv(""); setPlan(null); setErr(null); setFull(true); };

  const preview = async () => {
    setBusy(true); setErr(null);
    try { setPlan(await importDirectory(csv, { dryRun: true, full })); }
    catch (e) { setErr(e instanceof Error ? e.message : "The import was refused"); }
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const applied = await importDirectory(csv, { dryRun: false, full });
      setDone(`Imported · ${said(applied)}`);
      close();
      await read();
      onImported?.();
    } catch (e) { setErr(e instanceof Error ? e.message : "The import was refused"); }
    setBusy(false);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text()); setPlan(null);
  };

  return (
    <>
      <Card label="People" testId="access-people" right={canManage
        ? <Button size="xs" variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog"><Icon name="upload" size={12} />Import a CSV</Button>
        : undefined}>
        {!canManage ? (
          <Empty>The directory is visible to role administrators.</Empty>
        ) : people === null ? (
          <Empty>Reading…</Empty>
        ) : people.length === 0 ? (
          <Empty>No one is in the directory yet. Import a CSV with an email column, and optionally name, title, team and manager.</Empty>
        ) : (
          <>
            {done && <div className="aug-fs-xs" style={{ ...MUTED, marginBottom: 6 }}>{done}</div>}
            {people.map(p => (
              <div key={p.email} style={LIST_ROW}>
                <span className="aug-fs-sm" style={{ color: "var(--t1)", ...ONE_LINE, minWidth: 0, flex: "0 1 220px" }} title={p.email}>{p.name || p.email}</span>
                <span className="aug-fs-xs" style={{ ...MUTED, ...ONE_LINE, flex: 1, minWidth: 0 }}>
                  {[p.title, p.manager && `reports to ${p.manager}`].filter(Boolean).join(" · ") || p.email}
                </span>
                {p.team && <Chip>{p.team}</Chip>}
              </div>
            ))}
            <div className="aug-fs-xs" style={{ ...MUTED, ...NUM, marginTop: 6 }}>{plural(people.length, "person", "people")}</div>
          </>
        )}
      </Card>

      <FormDialog open={open} onOpenChange={o => { if (!o) close(); }} busy={busy} title="Import people from a CSV" width={720}
        description="Columns: email (required), name, title, team, manager. A team becomes the function group of that name."
        testId="directory-import">
        {err && <div role="alert" className="aug-fs-xs" style={{ color: "var(--red4)" }}>{err}</div>}
        <input id="directory-file" type="file" accept=".csv,text/csv" aria-label="Choose a CSV file"
          onChange={e => void pick(e.target.files?.[0])} />
        <Textarea id="directory-csv" rows={8} value={csv} aria-label="The CSV"
          placeholder={"email,name,title,team,manager\nana@acme.com,Ana Rao,CFO,Finance,"}
          onChange={e => { setCsv(e.target.value); setPlan(null); }} style={{ fontFamily: "var(--font-mono)" }} />
        <label className="aug-fs-sm" style={{ ...ROW, gap: 8, color: "var(--t2)" }}>
          <input id="directory-full" type="checkbox" checked={full} onChange={e => { setFull(e.target.checked); setPlan(null); }} />
          This file is the whole directory: deactivate anyone it leaves out
        </label>
        {plan && (
          <div data-testid="directory-plan" className="aug-fs-sm" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--t1)" }}>
            <strong>{said(plan)}</strong>
            {plan.teams_new.length > 0 && <span style={MUTED}>New teams: {plan.teams_new.join(", ")}</span>}
            {plan.deactivate.length > 0 && <span style={MUTED}>Deactivated: {plan.deactivate.join(", ")}</span>}
            {plan.refused.map(r => <span key={r.line} style={{ color: "var(--amb4)" }}>Line {r.line}: {r.reason}</span>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="sm" disabled={busy} onClick={close}>Cancel</Button>
          {plan
            ? <Button size="sm" disabled={busy || (!plan.add.length && !plan.change.length && !plan.deactivate.length)} onClick={() => void apply()}>Apply</Button>
            : <Button size="sm" disabled={busy || !csv.trim()} onClick={() => void preview()}>Show what changes</Button>}
        </div>
      </FormDialog>
    </>
  );
}
