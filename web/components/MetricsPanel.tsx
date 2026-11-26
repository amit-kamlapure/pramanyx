"use client";

/**
 * The Semantic Layer's Metrics tab: every metric that applies to one connection — its own definitions, its industry
 * package's and the explorer's suggestions — redone to `pramanyx-v2/CLARITY.md` (2026-10-12).
 *
 * The user asked, of LuxExperience, why its metrics "had not popped up": they were suggestions until its profile was
 * built, then proposed and approved — and four of them still had no date column. So the tab opens on what a reader
 * came for: four figures (approved and measured · waiting for review · can't be measured · the last decision), then
 * what needs a person (a proposal to review, an approved metric with no SQL or no date column, an industry metric not
 * bound here), then the list, grouped by where each metric stands. A row opens in place (asked for 2026-09-18: "in a
 * table format and expanded upon click so that it could be edited"), to read first — Overview · Approval · Dates ·
 * Measures — with the form behind Edit and the tools in one menu. Where each row stands: `lib/semanticMetrics.ts`.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Card, Chip, Empty, Facts, Figure, Figures, Label, MUTED, NUM, NeedsYou, NotSet, ONE_LINE, Page, ROW, RULE } from "@/components/clarity/kit";
import { FoldLine, GroupHead, Sql, ToolsMenu, rowButtonStyle } from "@/components/semantic/parts";
import { AdoptProposals } from "@/components/semantic/AdoptProposals";
import { CoverageCard } from "@/components/semantic/CoverageCard";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { TabStrip } from "@/components/ui/tab-strip";
import { Textarea } from "@/components/ui/textarea";
import {
  createMetric,
  deleteMetric,
  getMetricCatalogue,
  getMetrics,
  materialiseMetric,
  getMetricFreshness,
  updateMetric,
  validateMetric,
  transitionMetric,
  getMetricAudit,
  getDefinitionReport,
  getMetricProposals,
  generateMetricSql,
  promoteMetric,
  removeProposal,
  restoreProposal,
  getOntologyKeys,
  confirmMetricEntity,
  getMetricVersions,
  getMetricDimensions,
  exportMetricView,
  putMetricFormat,
  putMetricSynonyms,
  queryMetric,
  type MetricDimensions,
  type MetricQueryResult,
  getSchemaRich,
  restoreMetricVersion,
  structureMetrics,
  type MetricVersion,
  type MetricSplit,
  type MetricWindow,
  type OntologyKeys,
  type CatalogueMetric,
  type RemovedProposal,
  type MetricDateCandidate,
  type MetricProposals,
  type MetricStatementOption,
  type MetricSqlDraft,
  type Metric,
  type MetricValidationResult,
  type MetricFreshnessResult,
  type MetricAuditEntry,
  type DefinitionReport,
  type DefinitionClaim,
} from "@/lib/api";
import { countNoun, formatCount, formatDateTime, formatFigure, formatMetricValue, formatTimestamp, type FigureFormat } from "@/lib/format";
import {
  ALL, datasetWords, datesProblem, datesSentence, dayWords, figures as figuresOf, grouped, homeOf, lastDecision, missingRoles,
  needs as needsOf, packsOf, place, sameDataset, shortColumn, shortUnit, standingChip, storedFor,
  type Need, type Placed,
} from "@/lib/semanticMetrics";
import { withUniqueKeys } from "@/lib/listKeys";
import { showWhenDrawn } from "@/lib/addressOnce";
import { BindRolesDialog } from "@/components/semantic/BindRoles";
import { useMe } from "@/lib/useMe";
import { byWho } from "@/lib/names";
import { DefinitionBody, PROSE_TEXT } from "@/components/definitions/DefinitionBody";
import { RichText } from "@/components/ui/rich-text";
import { plainWords } from "@/lib/definitionBody";
import { noteOpened } from "@/lib/discover";

const GRAINS = ["day", "week", "month", "quarter", "year"] as const;

// ── Governance lifecycle (B-8) ──────────────────────────────────────────────────────────────────────────────────────
// Legal transitions per state — mirrors pramanyx/semantic/governance.py.
const NEXT_ACTIONS: Record<string, string[]> = {
  draft:      ["propose"],
  proposed:   ["approve", "reject"],
  approved:   ["deprecate"],
  deprecated: ["propose"],
};
const ACTION_WORD: Record<string, string> = { propose: "Propose", approve: "Approve", reject: "Reject", deprecate: "Deprecate" };
const STATUS_TONE: Record<string, "up" | "amber" | "plain"> = { approved: "up", proposed: "amber" };

const TEXT: CSSProperties = { color: "var(--t1)", margin: 0 };
const SUPPORT: CSSProperties = { color: "var(--t2)", margin: 0 };
const ERROR: CSSProperties = { color: "var(--red4)", margin: 0 };
const STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, minWidth: 0 };
const PAIR2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };

/** A3 — one claim, rendered so that "could not check" never reads like "nothing to report".
 *
 *  An UNAVAILABLE section wears the SAME amber as one with findings, because the thing it is telling the approver — we
 *  could not answer this — is exactly as load-bearing as an answer. Greying it out would reproduce, in CSS, the
 *  collapse the server refuses to make. */
function ClaimBlock({ title, claim }: { title: string; claim: DefinitionClaim }) {
  const tone = claim.outcome === "unavailable" ? "amber"
    : claim.findings.some(f => f.severity === "defect") ? "down"
    : claim.outcome === "findings" ? "amber" : "plain";
  return (
    <div style={{ ...RULE, padding: "8px 0" }}>
      <div style={ROW}>
        <span className="aug-fs-chrome" style={{ color: "var(--t1)", fontWeight: 500 }}>{title}</span>
        <Chip tone={tone}>{claim.outcome.replace("_", " ")}</Chip>
      </div>
      <p className="aug-fs-sm" style={{ ...SUPPORT, marginTop: 2 }}>{claim.summary}</p>
      {claim.findings.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {claim.findings.map(f => (
            <li key={f.code} className="aug-fs-sm">
              <span style={{ color: f.severity === "defect" ? "var(--red4)" : "var(--amb4)" }}>
                {f.severity === "defect" ? "✕" : "!"}
              </span>{" "}
              <span style={{ color: "var(--t1)" }}>{f.what}</span>
              {/* The evidence is not decoration: a finding a reader cannot check is one they must take on faith,
                  which is what this screen exists to stop. */}
              <div className="aug-fs-xs" style={{ ...MUTED, paddingLeft: 14, fontFamily: "var(--font-mono)" }}>{f.evidence}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A3 — the report beside the ask.
 *
 *  Deliberately renders NO recommendation and pre-selects nothing. A menu cursor placed on the model's own answer, at
 *  exactly the screen the design insists must be human, was refused: on an ambiguous row the pre-selection is a coin flip that one keypress records as a human judgement. The definition is the
 *  user's call, so this shows what was measured and stops. */
function DefinitionReportBlock({ report }: { report: DefinitionReport }) {
  const pop = report.population;
  return (
    <section aria-label="Before you decide" data-testid="metric-report">
      <Label right={<>
        <Chip>advisory</Chip>
        {report.defects.length > 0 && <Chip tone="down">{countNoun(report.defects.length, "defect")}</Chip>}
      </>}>Before you decide</Label>
      <ClaimBlock title="What it changes" claim={report.predecessor} />
      <ClaimBlock title="Whether it runs" claim={report.execution} />
      <ClaimBlock title="What it declares" claim={report.declaration} />
      <ClaimBlock title="What could be compared" claim={report.segments} />
      {/* The population line is stated LAST but never omitted. A4's lesson, applied: a caveat printed after a row of
          green ticks reads as a footnote to reassurance — so when the numbers cannot be pinned, this says so in the
          amber it deserves rather than in grey. */}
      <div className="aug-fs-sm" style={{ ...RULE, padding: "8px 0", color: pop.reproducible ? "var(--t3)" : "var(--amb4)" }}>
        <span style={{ fontWeight: 500 }}>Population: {pop.mode}</span>
        {pop.reason && <span style={{ color: "var(--t2)" }}> — {pop.reason}</span>}
        {pop.token && <span style={{ ...MUTED, fontFamily: "var(--font-mono)" }}> {pop.token}</span>}
      </div>
    </section>
  );
}

// ── Dates (Arc BR-2) ────────────────────────────────────────────────────────────────────────────────────────────────
// How the metric is measured for a date range. The platform sets these by rule — the user's call (ROADMAP §6 item
// 34(b)) — and says which rule; a person confirms or corrects them here, and from then on the platform leaves them alone.

const KIND_WORDS: Record<string, string> = {
  flow: "adds up over a range", stock: "a level at a date", cohort: "tied to one date, completed by a later one",
};

/** A statement begins with SELECT or WITH; anything else is an expression written before the rule. */
const isStatement = (sql: string) => /^\s*(select|with)\b/i.test(sql);

/** Arc OC-3 — which entity the metric measures: the one a person confirmed, else the one its grain proposes and why.
 *  Confirming keys the metric to the ontology, so the object door, the question frame and a release read it by what it
 *  is about. Its statement, status and version are untouched. A house metric (every connection) is keyed per
 *  connection, so it shows nothing here. */
export function EntitySection({ metric, onChanged }: { metric: Metric; onChanged: () => void }) {
  const conn = metric.connection ?? "*";
  const schema = homeOf(metric);
  const [keys, setKeys] = useState<OntologyKeys | null>(null);
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState(metric.entity ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const me = useMe();

  useEffect(() => {
    if (conn === "*") return;
    getOntologyKeys(conn, schema).then(setKeys).catch(() => setKeys(null));
  }, [conn, schema]);

  if (conn === "*") return null;
  const proposal = keys?.metrics.find((k) => k.name === metric.name)?.proposal;
  const confirmed = !!metric.entity;

  const save = async (entity: string) => {
    setErr("");
    setBusy(true);
    try {
      await confirmMetricEntity(metric.name, conn, schema, entity);
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not key the metric");
    } finally { setBusy(false); }
  };

  return (
    <div style={STACK} data-testid="metric-entity">
      <div style={ROW}>
        <Chip tone={confirmed ? "up" : proposal?.entity ? "violet" : "plain"}>
          {confirmed ? `confirmed by ${metric.entity_confirmed_by ? byWho(metric.entity_confirmed_by, me?.actor) : "a person"}` : proposal?.entity ? "proposed" : "not keyed"}
        </Chip>
      </div>
      <p className="aug-fs-sm" style={TEXT}>
        {confirmed
          ? `${metric.entity} — each figure is computed over ${metric.entity} objects.`
          : proposal?.entity
            ? `${proposal.entity}${proposal.property ? `, on its ${proposal.property}` : ""} — ${proposal.why}.`
            : keys ? `No entity proposed — ${proposal?.why ?? "this metric is not read on the scope's ontology"}.`
              : "Reading the ontology…"}
      </p>
      {confirmed && proposal?.entity && proposal.entity !== metric.entity && (
        <p className="aug-fs-sm" style={{ ...MUTED, margin: 0 }}>Its grain proposes {proposal.entity}: {proposal.why}.</p>
      )}
      {!editing ? (
        <div style={ROW}>
          {!confirmed && proposal?.entity && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => save(proposal.entity)}>Confirm</Button>
          )}
          {keys && keys.entities.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { setPick(metric.entity ?? proposal?.entity ?? ""); setEditing(true); }}>
              Correct…
            </Button>
          )}
          {confirmed && <Button size="sm" variant="ghost" disabled={busy} onClick={() => save("")}>Clear</Button>}
          {me?.actor && <span className="aug-fs-xs" style={MUTED}>as {me.actor}</span>}
        </div>
      ) : (
        <div style={ROW}>
          <SelectField value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Entity it measures">
            <option value="">— choose the entity —</option>
            {(keys?.entities ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.label === e.id ? e.id : `${e.label} (${e.id})`}</option>
            ))}
          </SelectField>
          <Button size="sm" variant="secondary" disabled={busy || !pick} onClick={() => save(pick)}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      )}
      {err && <p className="aug-fs-sm" style={ERROR} role="alert">{err}</p>}
    </div>
  );
}

const ANOTHER = "\u0000another";

/** A proposal as the list says it: "web_sessions.session_start · text, read as a date". */
function dateOptionWords(c: MetricDateCandidate): string {
  return `${c.grain} · ${c.primary ? "main date · " : ""}${c.text ? "text, read as a date" : c.type}`;
}

/** A date column, chosen from the platform's proposals — a list (the user, 2026-10-13: the dates "do not appear as [a]
 *  drop down") — or typed when none of them is the one. With no proposal at all it is the typed field alone. */
function DateColumnPicker({ value, onChange, candidates, label, placeholder }: {
  value: string; onChange: (v: string) => void; candidates: MetricDateCandidate[]; label: string; placeholder: string;
}) {
  const known = candidates.some(c => c.grain === value);
  const [typing, setTyping] = useState(!!value.trim() && !known);
  // A value that becomes one of the listed dates (the "Use …" button beside the note, or typed to the
  // letter) is shown in the list, not left behind "Another column".
  useEffect(() => { if (known) setTyping(false); }, [known]);
  if (!candidates.length) {
    return <Input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} aria-label={label} />;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <SelectField value={typing ? ANOTHER : value} aria-label={label}
        onChange={e => {
          if (e.target.value === ANOTHER) { setTyping(true); onChange(""); }
          else { setTyping(false); onChange(e.target.value); }
        }}>
        {!value && !typing && <option value="">Choose the date…</option>}
        {candidates.map(c => <option key={c.grain} value={c.grain}>{dateOptionWords(c)}</option>)}
        <option value={ANOTHER}>Another column — type it…</option>
      </SelectField>
      {typing && (
        <Input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} aria-label={`${label}, typed`} />
      )}
    </div>
  );
}

function DatesSection({ metric, proposals, onChanged, startEditing = false, onEditSql, draftSql }: {
  metric: Metric; proposals: MetricProposals | null; onChanged: () => void;
  /** Open straight on the form — the door from "Needs you" for a metric with no date column. */
  startEditing?: boolean;
  /** Open the definition's SQL — where a date one join away is made usable, by reading its table. */
  onEditSql?: () => void;
  /** The SQL as it stands in Edit (the pop-up). The proposals are read from it, so a date chosen here is saved WITH it:
   *  saving the stored SQL instead refused the date the Edit tab's join had made possible, while the Edit tab's own
   *  save was refused for the stored date — each tab blocking the other (LuxExperience, 2026-10-14). */
  draftSql?: string;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [kind, setKind] = useState(metric.time_kind ?? "flow");
  const [column, setColumn] = useState(metric.time_column ?? "");
  // The platform's proposals for the grain (the user, 2026-09-26): the date or timestamp columns of the table the SQL
  // statement reads — only those. One date is set for the person and said; several are a list beside the open input,
  // and the person picks; none is said with the reason. The parent reads them from the SQL in the field.
  const candidates = proposals?.candidates ?? [];
  const candidatesNote = proposals?.note ?? "";
  const reachable = proposals?.reachable ?? [];
  const listed = candidates.length > 1;
  const tablesRead = Array.from(new Set(candidates.map((c) => c.table))).join(", ");
  // The one date is SET for the person — derived, so it follows the proposals as they arrive and yields to anything typed.
  const shownColumn = column.trim() ? column : (candidates.length === 1 ? candidates[0].grain : "");
  // …and a value the SQL's own tables do not carry is said as such, never called "set for you".
  const stale = !!shownColumn.trim() && candidates.length > 0 && !candidates.some(c => c.grain === shownColumn);
  const [outcome, setOutcome] = useState(metric.outcome_column ?? "");
  const [until, setUntil] = useState(metric.until_column ?? "");
  const [settles, setSettles] = useState(metric.settles_after_days != null ? String(metric.settles_after_days) : "");
  const [grain, setGrain] = useState<string>(metric.time_grain ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const me = useMe();

  // The Edit tab's statement, when it differs from the stored one: the dates are saved with it, as they were proposed from it.
  const sqlEdited = !!draftSql?.trim() && draftSql.trim() !== (metric.sql ?? "").trim();
  // No name is asked: the confirmation is stamped by the server with the person signed in.
  const save = async (fields: Partial<Metric>) => {
    setErr("");
    setBusy(true);
    try {
      await updateMetric(metric.name, { ...metric, ...(sqlEdited ? { sql: draftSql!.trim() } : {}), ...fields }, homeOf(metric));
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the dates");
    } finally { setBusy(false); }
  };

  const confirmed = !!metric.time_confirmed_by;
  return (
    <div style={STACK} data-testid="metric-dates">
      {metric.time_kind && (
        <div style={ROW}>
          <Chip tone={confirmed ? "up" : "plain"}>{confirmed ? `confirmed by ${byWho(metric.time_confirmed_by, me?.actor)}` : "set automatically"}</Chip>
          <Chip>{`by ${metric.time_grain ?? "month"}`}</Chip>
        </div>
      )}
      <p className="aug-fs-sm" style={metric.time_kind && metric.time_column && !datesProblem(metric) ? TEXT : { ...TEXT, color: "var(--amb4)" }}>
        {datesSentence(metric)}
      </p>
      {datesProblem(metric) && (
        <p className="aug-fs-xs" style={{ margin: 0, color: "var(--amb4)" }} data-testid="metric-dates-problem">
          {datesProblem(metric)}
        </p>
      )}
      {metric.time_kind && (
        <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }}>{KIND_WORDS[metric.time_kind] ?? ""}{metric.time_source ? ` · ${metric.time_source}` : ""}</p>
      )}
      {!editing ? (
        <div style={ROW}>
          {metric.time_kind && !confirmed && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({})}>Confirm</Button>
          )}
          <Button size="sm" variant={metric.time_kind ? "ghost" : "secondary"} onClick={() => setEditing(true)}>
            {metric.time_kind ? "Correct…" : "Set the date…"}
          </Button>
          {me?.actor && <span className="aug-fs-xs" style={MUTED}>as {me.actor}</span>}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
          <label className="aug-fs-xs" style={{ color: "var(--t2)", display: "flex", alignItems: "center", gap: 8 }}>Kind
            <SelectField value={kind} onChange={e => setKind(e.target.value as "flow" | "stock" | "cohort")}>
              <option value="flow">Flow — adds up over a range</option>
              <option value="stock">Stock — a level at a date</option>
              <option value="cohort">Cohort — completed by a later date</option>
            </SelectField>
          </label>
          <DateColumnPicker value={shownColumn} onChange={setColumn} candidates={candidates} label="Date column"
            placeholder="Date column — schema.table.column" />
          <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }} data-testid="metric-date-proposals">
            {stale
              // The field carries a value that is not a date on the tables this SQL reads — a stored one the SQL
              // outgrew, or a typo (the user, 2026-10-14: `luxexperience.order.order_date` beside a SQL that joins
              // `luxexperience.orders`; the note said "set for you" while the field still said the old value, and
              // every save was refused with it).
              ? `The field says ${shownColumn}, which is not a date on ${tablesRead}. ${candidates.length === 1
                  ? `The only date there is ${candidates[0].grain}`
                  : `${candidates.length} dates are listed`} — choose it in the list.`
              : listed
                ? `${candidates.length} dates on ${tablesRead} — choose one`
                : candidates.length === 1
                  ? `The only date on ${candidates[0].table} is ${candidates[0].grain} — set for you; change it here if that is wrong.`
                  : candidatesNote || "no proposals yet"}
          </p>
          {stale && candidates.length === 1 && (
            <div style={ROW}>
              <Button size="xs" variant="secondary" onClick={() => setColumn(candidates[0].grain)} data-testid="metric-date-use">
                Use {candidates[0].grain}
              </Button>
            </div>
          )}
          {candidates.find(c => c.grain === shownColumn)?.text && (
            <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }} data-testid="metric-date-text">
              {shownColumn.split(".").pop()} is kept as text — it is read as a date when a period is measured; a value
              that is not a date fails that measurement, and says so.
            </p>
          )}
          {reachable.length > 0 && (
            <div style={{ ...ROW, alignItems: "flex-start" }} data-testid="metric-date-reachable">
              <span className="aug-fs-xs" style={{ ...MUTED, flex: "1 1 320px" }}>
                One join away: {reachable.map(r => `${r.grain} (on ${r.via})`).join(" · ")}. The definition reads{" "}
                {reachable[0].from} only — add the join to {reachable[0].table} in its SQL, then choose the date here.
              </span>
              {onEditSql && <Button size="xs" variant="secondary" onClick={onEditSql}>Edit the SQL</Button>}
            </div>
          )}
          {kind === "cohort" && (
            <>
              <DateColumnPicker value={outcome} onChange={setOutcome} candidates={candidates} label="Completing date column"
                placeholder="Completing date, e.g. schema.table.returned_at" />
              <Input placeholder="Settles after (days)" value={settles}
                onChange={e => setSettles(e.target.value)} aria-label="Settles after days" />
            </>
          )}
          {kind === "stock" && (
            <DateColumnPicker value={until} onChange={setUntil} candidates={candidates} label="Counts until column"
              placeholder="Counts until, e.g. schema.table.sold_at" />
          )}
          <label className="aug-fs-xs" style={{ color: "var(--t2)", display: "flex", alignItems: "center", gap: 8 }}>Reported by
            <SelectField value={grain} onChange={e => setGrain(e.target.value)} aria-label="Date grain">
              <option value="">month (the default)</option>
              {GRAINS.map(g => <option key={g} value={g}>{g}</option>)}
            </SelectField>
          </label>
          {sqlEdited && (
            <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }} data-testid="metric-date-with-sql">
              Saved together with the SQL as it stands in Edit.
            </p>
          )}
          <div style={ROW}>
            <Button size="sm" variant="secondary" disabled={busy || !shownColumn.trim()}
              onClick={() => save({
                time_kind: kind, time_column: shownColumn.trim(),
                outcome_column: kind === "cohort" ? outcome.trim() || null : null,
                until_column: kind === "stock" ? until.trim() || null : null,
                settles_after_days: kind === "cohort" && settles.trim() ? Number(settles) : null,
                time_grain: (grain || null) as Metric["time_grain"],
              })}>Save dates</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            {me?.actor && <span className="aug-fs-xs" style={MUTED}>confirmed as {me.actor}</span>}
          </div>
        </div>
      )}
      {err && <p className="aug-fs-sm" style={ERROR}>{err}</p>}
    </div>
  );
}

/** Its governance: where it stands, the report to read before a decision, the decisions open to a person, and its trail. */
function GovernanceSection({ metric, onChanged }: { metric: Metric; onChanged: () => void }) {
  const me = useMe();
  const home = homeOf(metric);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [audit, setAudit] = useState<MetricAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [report, setReport] = useState<DefinitionReport | null>(null);
  const [reportErr, setReportErr] = useState("");

  const status = metric.status ?? "draft";
  const actions = NEXT_ACTIONS[status] ?? [];

  useEffect(() => {
    let alive = true;
    getMetricAudit(metric.name, metric.connection, home).then(a => { if (alive) setAudit(a); }).catch(() => {});
    return () => { alive = false; };
  }, [metric.name, metric.connection, home]);

  // A3 — fetched whenever there is a decision to take. A metric with no next action has nobody to inform, so the call
  // is not made at all rather than made and hidden. `wantReport` is DERIVED rather than pushed into state: setting
  // state synchronously in an effect body triggers cascading renders (react-hooks/set-state-in-effect), and the render
  // below gates on the same value, so there is nothing to reset.
  const reportConn = metric.connection;
  const wantReport = !!reportConn && reportConn !== "*" && actions.length > 0;

  useEffect(() => {
    if (!wantReport || !reportConn) return;
    let alive = true;
    getDefinitionReport(metric.name, reportConn, home)
      .then(r => { if (alive) { setReport(r); setReportErr(""); } })
      .catch(e => {
        if (alive) { setReport(null); setReportErr(e instanceof Error ? e.message : "unavailable"); }
      });
    return () => { alive = false; };
  }, [metric.name, reportConn, home, metric.sql, status, wantReport]);

  // No name is asked (the user, 2026-10-07): the server records the person signed in. An approval the platform's gate
  // holds answers 428 and the app-wide approval prompt takes it (lib/approval); the refusal's words land below.
  const run = async (action: string) => {
    setErr("");
    setBusy(action);
    try {
      // The connection and the dataset are SENT — without them the server looked for a global metric of this name,
      // or reached another dataset's. See `transitionMetric`'s note.
      await transitionMetric(metric.name, action, metric.connection, home);
      setAudit(await getMetricAudit(metric.name, metric.connection, home));
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transition failed");
    } finally { setBusy(null); }
  };

  const by = status === "approved" ? metric.approved_by : status === "proposed" ? metric.proposed_by : null;
  const at = status === "approved" ? metric.approved_at : status === "proposed" ? metric.proposed_at : null;
  return (
    <div style={STACK} data-testid="metric-governance">
      <div style={ROW}>
        <Chip tone={STATUS_TONE[status] ?? "plain"}>{status}{metric.version ? ` v${metric.version}` : ""}</Chip>
        {by && <span className="aug-fs-sm" style={MUTED}>{status} by {byWho(by, me?.actor)}{at ? ` · ${dayWords(at)}` : ""}</span>}
      </div>
      {/* A3 — above the buttons on purpose. A report placed after the control that acts on it is read after the
          decision, which is the same as not being read. */}
      {wantReport && report && <DefinitionReportBlock report={report} />}
      {wantReport && reportErr && (
        <p className="aug-fs-sm" style={{ color: "var(--amb4)", margin: 0 }}>The definition report is unavailable: {reportErr}</p>
      )}
      {actions.length > 0 && (
        <div style={ROW}>
          {actions.map(a => (
            <Button key={a} size="sm" disabled={!!busy} onClick={() => run(a)} data-testid={`metric-${a}`}
              variant={a === "approve" ? "default" : (a === "reject" || a === "deprecate") ? "destructive" : "secondary"}>
              {busy === a ? "…" : ACTION_WORD[a] ?? a}
            </Button>
          ))}
          {me?.actor && <span className="aug-fs-xs" style={MUTED}>as {me.actor}</span>}
        </div>
      )}
      {err && <p className="aug-fs-sm" style={ERROR}>{err}</p>}
      {audit.length > 0 && (
        <div>
          <FoldLine open={showAudit} onToggle={() => setShowAudit(s => !s)}>{`History · ${audit.length}`}</FoldLine>
          {showAudit && (
            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {audit.map((a, i) => (
                <div key={i} className="aug-fs-chrome" style={{ ...MUTED, ...NUM }}>
                  {formatDateTime(a.at)} · <span style={{ color: "var(--t1)" }}>{a.actor}</span>{" "}
                  {a.action} <span style={{ fontFamily: "var(--font-mono)" }}>{a.from}→{a.to}</span>{a.version ? ` v${a.version}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Form state ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface FormState {
  name: string; label: string; sql: string;
  /** How it is written (M1): "parts" — a source, a measure, filters, its statement composed by the server and grouped
   *  by any dimension; "statement" — one whole query, which cannot be grouped. */
  written: "parts" | "statement";
  source: string; measure: string;
  /** M3 — "" (none), cumulative, trailing, offset, first or last; `window_n` its periods */
  window: string; window_n: string;
  tables: string; dimensions: string; filters: string;
  unit: string; caveats: string;
  target_value: string; warning_threshold: string; critical_threshold: string;
  /** "higher" · "lower" · "" (a band). */
  target_direction: string;
  target_period: string; benchmark_source: string;
  // governance
  owner: string; freshness_sla: string; freshness_check_sql: string;
  quality_tests: string;   // newline-separated
  lineage: string;         // newline-separated
  wrong_usage_examples: string; // newline-separated
  /** The dataset it belongs to: "" — the one its SQL reads; "*" — every dataset. */
  schema_name: string;
  additivity: string;
}

const EMPTY_FORM: FormState = {
  // a new metric is written as parts (the user, 2026-11-25: "A metric is structured")
  name: "", label: "", sql: "", written: "parts", source: "", measure: "", window: "", window_n: "",
  tables: "", dimensions: "", filters: "",
  unit: "", caveats: "",
  target_value: "", warning_threshold: "", critical_threshold: "", target_direction: "",
  target_period: "", benchmark_source: "",
  owner: "", freshness_sla: "", freshness_check_sql: "",
  quality_tests: "", lineage: "", wrong_usage_examples: "",
  schema_name: "", additivity: "",
};

function parseList(val: string): string[] {
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}
function parseLines(val: string): string[] {
  return val.split("\n").map((s) => s.trim()).filter(Boolean);
}
function joinList(arr: string[]): string { return arr.join(", "); }
function joinLines(arr: string[]): string { return arr.join("\n"); }
function parseOptFloat(s: string): number | null {
  const n = parseFloat(s.trim());
  return isNaN(n) ? null : n;
}

export function metricToForm(m: Metric): FormState {
  const parts = !!(m.measure && (m.source || builtFromMetrics(m.measure).length));
  return {
    name: m.name, label: m.label, sql: m.sql,
    written: parts || !!m.measure ? "parts" : "statement", source: m.source ?? "", measure: m.measure ?? "",
    window: m.window?.kind ?? "", window_n: m.window?.n != null ? String(m.window.n) : "",
    tables: joinList(m.tables),
    dimensions: joinList(m.dimensions),
    // a part's filter may hold a comma (`status IN ('a', 'b')`): one per line there
    filters: parts ? joinLines(m.filters) : joinList(m.filters),
    unit: m.unit ?? "", caveats: m.caveats ?? "",
    target_value: m.target_value != null ? String(m.target_value) : "",
    warning_threshold: m.warning_threshold != null ? String(m.warning_threshold) : "",
    critical_threshold: m.critical_threshold != null ? String(m.critical_threshold) : "",
    target_direction: m.target_direction ?? "",
    target_period: m.target_period ?? "", benchmark_source: m.benchmark_source ?? "",
    owner: m.owner ?? "", freshness_sla: m.freshness_sla ?? "",
    freshness_check_sql: m.freshness_check_sql ?? "",
    quality_tests: joinLines(m.quality_tests),
    lineage: joinLines(m.lineage),
    wrong_usage_examples: joinLines(m.wrong_usage_examples),
    schema_name: m.schema_name || m.home_schema || "",
    additivity: m.additivity ?? "",
  };
}

export function formToMetric(f: FormState): Metric {
  const parts = f.written === "parts";
  return {
    name: f.name.trim(), label: f.label.trim(), sql: parts ? "" : f.sql.trim(),
    source: parts && !builtFromMetrics(f.measure).length ? f.source.trim() || null : null, measure: parts ? f.measure.trim() || null : null,
    window: f.window ? { kind: f.window as MetricWindow["kind"], ...(f.window === "trailing" || f.window === "offset" ? { n: Number(f.window_n) || 1 } : {}) } : null,
    tables: parts ? (f.source.trim() && !builtFromMetrics(f.measure).length ? [f.source.trim()] : []) : parseList(f.tables), dimensions: parseList(f.dimensions),
    filters: parts ? parseLines(f.filters) : parseList(f.filters),
    unit: f.unit.trim() || null, caveats: f.caveats.trim() || null,
    target_value: parseOptFloat(f.target_value),
    warning_threshold: parseOptFloat(f.warning_threshold),
    critical_threshold: parseOptFloat(f.critical_threshold),
    target_direction: f.target_direction === "higher" || f.target_direction === "lower" ? f.target_direction : null,
    target_period: f.target_period.trim() || null,
    benchmark_source: f.benchmark_source.trim() || null,
    owner: f.owner.trim() || null,
    freshness_sla: f.freshness_sla.trim() || null,
    freshness_check_sql: f.freshness_check_sql.trim() || null,
    quality_tests: parseLines(f.quality_tests),
    lineage: parseLines(f.lineage),
    wrong_usage_examples: parseLines(f.wrong_usage_examples),
    // Approval is stamped by the approve transition with the person signed in — never sent.
    approved_by: null, approved_at: null,
    schema_name: f.schema_name.trim() || null,
    additivity: f.additivity.trim() || null,
  };
}

/** The statement a metric written as parts runs — composed as the server composes it, shown before it is saved. */
/** M3 — the metrics a measure is built from, named as MEASURE(name), each once. */
export function builtFromMetrics(measure: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (measure ?? "").matchAll(/MEASURE\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function composedPreview(f: FormState): string {
  const from = builtFromMetrics(f.measure);
  if (from.length) return `Built from ${from.join(", ")} — each measured as asked, then combined; a division by nothing is no figure.`;
  if (!f.source.trim() || !f.measure.trim()) return "";
  const filters = parseLines(f.filters);
  return `SELECT ${f.measure.trim()} AS ${f.name.trim() || "value"} FROM ${f.source.trim()}`
    + (filters.length ? ` WHERE ${filters.map((x) => `(${x})`).join(" AND ")}` : "");
}

/** The views of one opened definition: read first, the form behind Edit. */
type DetailTab = "overview" | "approval" | "dates" | "measures" | "grouped" | "words" | "versions" | "edit";

// ── Component ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function MetricsPanel({ connId, schema, datasets = [], focus = null }: {
  connId?: string;
  /** The dataset whose metrics to list; "*" — every dataset of the connection at once, each row saying which (the
   *  user, 2026-10-07). */
  schema?: string;
  /** The connection's datasets — what a definition can belong to. */
  datasets?: string[];
  /** A metric a link named (Discover's, 2026-11-23): opened on its overview and brought into view once the list holds it;
   *  `n` tells one asking from the next, so the same metric asked for again opens again. */
  focus?: { name: string; n: number } | null;
}) {
  const me = useMe();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** The dataset of the definition being edited — with `selected`, its identity. */
  const [selectedSchema, setSelectedSchema] = useState<string>(ALL);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  // M1 — a metric written as parts names its source among this connection's tables, read when the form asks for one
  const [sourceRead, setSourceRead] = useState<{ conn: string; tables: string[] }>({ conn: "", tables: [] });
  const sourceTables = sourceRead.conn === connId ? sourceRead.tables : [];
  const wantsSource = form.written === "parts" && (adding || detailTab === "edit") && !!connId && sourceRead.conn !== connId;
  useEffect(() => {
    if (!wantsSource || !connId) return;
    let alive = true;
    getSchemaRich(connId)
      .then((r) => { if (alive) setSourceRead({ conn: connId, tables: (r.tables ?? []).map((t) => t.name) }); })
      .catch(() => { if (alive) setSourceRead({ conn: connId, tables: [] }); });   // the field is typed in instead
    return () => { alive = false; };
  }, [wantsSource, connId]);
  // Binding a package's roles, here rather than in Settings (2026-10-13): the package and the metrics that read it.
  const [binding, setBinding] = useState<{ packId: string; rows: Placed[] } | null>(null);
  /** Opened from "Needs you" to set a date: the Dates view opens on its form. */
  const [datesEditing, setDatesEditing] = useState(false);

  // validation / freshness state
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<MetricValidationResult | null>(null);
  const [checkingFreshness, setCheckingFreshness] = useState(false);
  const [freshnessResult, setFreshnessResult] = useState<MetricFreshnessResult | null>(null);

  // The CATALOGUE is what this tab lists: every metric that applies to this connection, not just the ones already in
  // the registry. Most of what applies is not in the registry — an industry package's recipe is role-bound until this
  // connection binds those roles, and the explorer's judgement lives on the business profile. Both are computed server
  // side and materialised only when someone edits one.
  const [rows, setRows] = useState<CatalogueMetric[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<RemovedProposal[]>([]);
  /** Whether the catalogue has answered — before it has, "nothing applies" would be a guess. */
  const [loaded, setLoaded] = useState(false);
  /** The catalogue could not be read: said, never shown as "nothing applies". */
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  /** The stored definitions could not be read: an approved row's dates are then "not checked", never guessed. */
  const [registryError, setRegistryError] = useState(false);
  /** The stored definition behind a row: same name AND dataset. */
  const storedOf = (name: string | null, ds: string) => (name === null ? undefined : storedFor(metrics, name, ds));

  // The model writes the statement from the fields in the editor, on a click (the user, 2026-09-26): one model call,
  // the result filled into the field and said to be the model's until saved. Kept apart from the platform's proposals
  // below, which cost nothing.
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<MetricSqlDraft | null>(null);
  const [writeError, setWriteError] = useState("");
  const handleWriteSql = async () => {
    if (!connId) { setWriteError("Pick a connection first — the statement is written over its schema."); return; }
    if (!form.name.trim()) { setWriteError("Name the metric first — the name becomes the statement's column."); return; }
    const row = rows.find((r) => r.name === form.name.trim() && sameDataset(r.schema, selectedSchema));
    setWriting(true); setWriteError("");
    try {
      const draft = await generateMetricSql(connId, {
        name: form.name.trim(), label: form.label.trim(),
        definition: (row?.definition || form.caveats).trim(), unit: form.unit.trim(),
        tables: parseList(form.tables), filters: parseList(form.filters), dimensions: parseList(form.dimensions),
        wrong_usage_examples: parseLines(form.wrong_usage_examples),
      });
      setWritten(draft);
      setForm((f) => ({ ...f, sql: draft.sql }));
    } catch (e: unknown) {
      setWriteError(e instanceof Error ? e.message : "The statement could not be written");
    } finally { setWriting(false); }
  };

  // What the platform proposes for the definition opened (the user, 2026-09-26: the SQL field holds the whole runnable
  // statement, and the dates are those of the table it reads). Read for an EXISTING metric from the SQL in the field —
  // so a FROM typed just now is what the dates follow — and, for a row stored as an expression, the runnable statement
  // goes into the field and is said to be proposed until it is saved. When a column is carried by two tables the first
  // (largest) is filled in and the others are offered as a switch — the field always holds something runnable (the
  // user, 2026-09-26: "still cannot see the entire SQL"). Kept by metric name, so a proposal never outlives the row it
  // was made for.
  const [proposals, setProposals] = useState<MetricProposals | null>(null);
  const [proposed, setProposed] = useState<{
    metric: string; from: string; statement: string; options: MetricStatementOption[]; note: string;
  } | null>(null);
  useEffect(() => {
    if (adding || !selected || form.written === "parts") { setProposals(null); setProposed(null); return; }
    const stored = storedOf(selected, selectedSchema);
    const sql = form.sql;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const r = await getMetricProposals(stored?.connection ?? connId ?? "*", sql,
          parseList(form.tables), parseList(form.filters), form.name || "value");
        if (!live) return;
        setProposals(r);
        if (!isStatement(sql) && r.statements.length >= 1) {
          const statement = r.statements[0].statement;
          setProposed({ metric: selected, from: sql, statement, options: r.statements, note: r.statement_note });
          setForm((f) => (f.sql === sql ? { ...f, sql: statement } : f));
        }
      } catch { if (live) setProposals(null); }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, selected, selectedSchema, metrics, connId, form.sql, form.tables, form.filters, form.name, form.written]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [materialising, setMaterialising] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  /** A row opened from "Needs you" is scrolled to once it is open. */
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(`metric-row-${scrollTo}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    setScrollTo(null);
  }, [scrollTo]);

  // Only the newest load writes. The tab mounts before the scope bar knows its schema, so a read naming no schema and
  // the schema's own read were in flight together and whichever answered LAST won: "Showing the metrics for amazon"
  // over the two defined rows of the read that named none, until a tab switch remounted the panel with the schema
  // known (2026-10-07). Returns the stored definitions it read, for a caller that reopens one.
  const loadSeq = useRef(0);
  const load = async (): Promise<Metric[] | null> => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    // `metrics` still holds the raw registry: the governance view and the duplicate-name warning read it, and both are
    // about what is STORED, not about what applies.
    let stored: Metric[] | null = null;
    try {
      stored = await getMetrics(connId);
      if (!stale()) { setMetrics(stored); setRegistryError(false); }
    } catch { if (!stale()) setRegistryError(true); }
    if (stale()) return stored;
    if (!connId) { setRows([]); setCounts({}); setRemoved([]); setLoaded(true); return stored; }
    try {
      const cat = await getMetricCatalogue(connId, schema);
      if (stale()) return stored;
      setRows(cat.metrics); setCounts(cat.counts); setRemoved(cat.removed ?? []); setCatalogueError(null);
    } catch (e) {
      if (!stale()) {
        setRows([]); setCounts({}); setRemoved([]);
        setCatalogueError(e instanceof Error ? e.message : "The metrics that apply here could not be read");
      }
    }
    if (!stale()) setLoaded(true);
    return stored;
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, schema]);

  const startAdd = () => {
    setAdding(true); setSelected(null); setExpanded(null);
    setForm(EMPTY_FORM); setError(""); setWritten(null); setWriteError("");
    setValidationResult(null); setFreshnessResult(null);
  };

  const startEdit = (m: Metric) => {
    setAdding(false); setSelected(m.name); setSelectedSchema(homeOf(m));
    setForm(metricToForm(m)); setError(""); setWritten(null); setWriteError("");
    setValidationResult(null); setFreshnessResult(null);
  };

  const cancelForm = () => {
    setAdding(false); setSelected(null);
    setForm(EMPTY_FORM); setError(""); setWritten(null); setWriteError("");
    setValidationResult(null); setFreshnessResult(null);
  };

  /** Open a row on one of its views. A definition opens to read; a suggestion opens to its provenance and the ways to
   *  make it this connection's — a recipe is copied before it is changed, because editing it in place would rewrite a
   *  definition shared by every connection that reads the same package. */
  const open = (p: Placed, tab: DetailTab = "overview", how: { editDates?: boolean; scroll?: boolean } = {}) => {
    setExpanded(p.key);
    setRowError((prev) => ({ ...prev, [p.key]: "" }));
    setDatesEditing(!!how.editDates);
    setDeleting(null);
    if (p.row.editable && p.stored) { startEdit(p.stored); setDetailTab(tab); }
    else { setAdding(false); setSelected(null); }
    if (how.scroll) setScrollTo(p.key);
    // a defined metric opened is a use of it (Discover D5): its page says so, having no read route of its own
    if (p.stored && connId) noteOpened("metric", `${connId}/${p.stored.name}`, connId);
  };
  const toggle = (p: Placed) => {
    if (expanded === p.key) { setExpanded(null); cancelForm(); return; }
    open(p);
  };

  // The metric a link named, opened once the list holds it — or said not to be on it, never left unopened in silence.
  const focusDone = useRef(0);
  const [focusMissing, setFocusMissing] = useState("");
  useEffect(() => {
    if (!focus || focusDone.current === focus.n || !loaded) return;
    focusDone.current = focus.n;
    const hit = place(rows, metrics).find(p => p.row.name === focus.name || p.stored?.name === focus.name);
    if (hit) {
      setFocusMissing(""); open(hit, "overview");
      showWhenDrawn(`#${CSS.escape(`metric-row-${hit.key}`)}`, 40);   // once the sections above it have landed
    }
    else setFocusMissing(focus.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, loaded, rows, metrics]);

  /** Reopen a definition by name and dataset after a write, on its overview — or close it when it moved away. */
  const reopen = (stored: Metric[] | null, name: string, ds: string) => {
    const m = stored ? storedFor(stored, name, ds) : undefined;
    if (!m) { setExpanded(null); cancelForm(); return; }
    startEdit(m);
    setExpanded(`defined:${homeOf(m)}:${m.name}`);
    setDetailTab("overview");
  };

  const customise = async (row: CatalogueMetric, key: string) => {
    if (!connId) return;
    setMaterialising(key);
    setRowError((prev) => ({ ...prev, [key]: "" }));
    try {
      // The row's OWN dataset: in the every-dataset view two rows may share a name.
      const made = await materialiseMetric(connId, row.name, row.schema || schema);
      await load();
      startEdit(made);
      setDetailTab("edit");
      setExpanded(`defined:${made.home_schema ?? made.schema_name ?? row.schema}:${made.name}`);
    } catch (e: unknown) {
      setRowError((prev) => ({
        ...prev,
        [key]: e instanceof Error ? e.message : "Could not make this metric editable",
      }));
    } finally { setMaterialising(null); }
  };

  // Removing a PROPOSAL (the user, 2026-10-07: "the right to remove the proposed Metric"): it is recorded, never
  // proposed here again, and listed at the foot of the list to restore.
  const removeRow = async (row: CatalogueMetric, key: string) => {
    if (!connId) return;
    setMaterialising(key);
    try {
      await removeProposal(connId, row.name, row.schema);
      setExpanded(null);
      await load();
    } catch (e: unknown) {
      setRowError((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : "Could not remove it" }));
    } finally { setMaterialising(null); }
  };

  const restore = async (r: RemovedProposal) => {
    if (!connId) return;
    try { await restoreProposal(connId, r.name, r.schema_name); await load(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not restore it"); }
  };

  const handleSave = async () => {
    setError("");
    const metric = formToMetric(form);
    if (!metric.name) { setError("Name is required"); return; }
    if (!metric.label) { setError("Label is required"); return; }
    // A draft may be saved without SQL — a recipe opened to be written over this connection's columns is one — but a
    // new definition needs its statement.
    if (form.written === "parts" && (!metric.measure || (!metric.source && !builtFromMetrics(metric.measure).length))) {
      setError("A metric written as parts names its source table and its measure — or a measure built from metrics, MEASURE(a) / MEASURE(b)"); return;
    }
    if (form.written === "statement" && !metric.sql && adding) { setError("SQL statement is required"); return; }
    setSaving(true);
    try {
      // Scope every write to the connection this tab is showing. Without it the request fell back to the server's "*"
      // default, so editing theLook's metric republished its SQL — over `inventory_items` — to every connection,
      // including ones with no such table. A metric with no connection is a house default, and that is a deliberate
      // choice, not what an edit here means.
      const scoped = connId ? { ...metric, connection: connId } : metric;
      if (adding) {
        const made = await createMetric(scoped);
        const stored = await load();
        reopen(stored, made?.name ?? metric.name, made ? homeOf(made) : metric.schema_name || ALL);
      } else {
        await updateMetric(selected!, scoped, selectedSchema);
        const stored = await load();
        reopen(stored, metric.name, metric.schema_name || selectedSchema);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async (m: Metric) => {
    if (!connId) return;
    if (deleting !== `confirm:${m.name}`) { setDeleting(`confirm:${m.name}`); return; }
    setDeleting(m.name);
    setError("");
    try {
      // THIS connection's definition in THIS dataset — never every connection's of the name.
      await deleteMetric(m.name, connId, homeOf(m));
      if (selected === m.name) cancelForm();
      setExpanded(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not remove it");
    } finally { setDeleting(null); }
  };

  const promote = async (m: Metric) => {
    if (!m.connection) return;
    setError("");
    setPromoting(true);
    try {
      await promoteMetric(m.name, m.connection, homeOf(m));
      // A promotion moves it to every dataset — it stays open there.
      reopen(await load(), m.name, ALL);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not promote it");
    } finally { setPromoting(false); }
  };

  const handleValidate = async () => {
    if (!connId || !selected) return;
    setDetailTab("overview");
    setValidating(true); setValidationResult(null);
    try {
      setValidationResult(await validateMetric(selected, connId));
    } catch (e: unknown) {
      setValidationResult({
        metric: selected, passed: false, results: [],
        message: e instanceof Error ? e.message : "Validation failed",
      });
    } finally { setValidating(false); }
  };

  const handleFreshness = async () => {
    if (!connId || !selected) return;
    setDetailTab("overview");
    setCheckingFreshness(true); setFreshnessResult(null);
    try {
      setFreshnessResult(await getMetricFreshness(selected, connId));
    } catch (e: unknown) {
      setFreshnessResult({
        metric: selected, latest_data_at: null, sla: null, ok: false,
        message: e instanceof Error ? e.message : "Freshness check failed",
      });
    } finally { setCheckingFreshness(false); }
  };

  // ── The form — behind Edit, or under "New metric". Every field is editable (the user, 2026-10-07) — the name too:
  //    renaming moves the definition, its governance and its trail with it.
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const mono: CSSProperties = { fontFamily: "var(--font-mono)" };
  const editorForm = (
    <div style={{ ...STACK, gap: 12 }} data-testid="metric-form">
      <div style={PAIR2}>
        <Field label="Name (snake_case)" required hint={adding ? undefined : "renaming keeps its history"}>
          <Input placeholder="mrr" value={form.name} onChange={set("name")} aria-label="Name" />
        </Field>
        <Field label="Label" required>
          <Input placeholder="Monthly Recurring Revenue" value={form.label} onChange={set("label")} aria-label="Label" />
        </Field>
        {datasets.length > 1 && (
          <Field label="Dataset" hint="which dataset's metric this is">
            <SelectField value={form.schema_name} aria-label="Dataset"
              onChange={(e) => setForm({ ...form, schema_name: e.target.value })}>
              {adding && <option value="">The one its SQL reads</option>}
              <option value={ALL}>Every dataset of this connection</option>
              {datasets.map((d) => <option key={d} value={d}>{d}</option>)}
            </SelectField>
          </Field>
        )}
      </div>

      <Field label="How it is written" hint={form.written === "parts"
        ? "a source, a measure and filters — it can be grouped by any dimension"
        : "one whole query — it cannot be grouped by a dimension"}>
        <Segmented<"parts" | "statement"> label="How it is written" value={form.written}
          onChange={(w) => setForm({ ...form, written: w })}
          options={[{ value: "parts", label: <span data-testid="metric-written-parts">Parts</span> },
            { value: "statement", label: <span data-testid="metric-written-statement">One statement</span> }]} />
      </Field>
      {form.written === "parts" && (
        <div style={{ ...STACK, gap: 12 }} data-testid="metric-parts">
          <div style={PAIR2}>
            <Field label="Source" required={!builtFromMetrics(form.measure).length}
              hint={builtFromMetrics(form.measure).length ? "none — the metrics it is built from have theirs" : "the table its rows come from"}>
              {sourceTables.length > 0 ? (
                <SelectField value={form.source} aria-label="Source" data-testid="metric-source"
                  onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  <option value="">Choose a table</option>
                  {form.source && !sourceTables.includes(form.source) && <option value={form.source}>{form.source}</option>}
                  {sourceTables.map((t) => <option key={t} value={t}>{t}</option>)}
                </SelectField>
              ) : (
                <Input style={mono} placeholder="order_items" value={form.source} onChange={set("source")} aria-label="Source" />
              )}
            </Field>
            <Field label="Measure" required hint="one aggregate over its rows — or built from metrics: MEASURE(revenue) / MEASURE(orders)">
              <Input style={mono} placeholder="SUM(sale_price)" value={form.measure} onChange={set("measure")} aria-label="Measure" />
            </Field>
          </div>
          <div style={PAIR2}>
            <Field label="Window" hint="how its figure runs across periods, when one is asked">
              <SelectField value={form.window} aria-label="Window" onChange={(e) => setForm({ ...form, window: e.target.value })}>
                {WINDOW_CHOICES.map(([v, l]) => <option key={v || "none"} value={v}>{l}</option>)}
              </SelectField>
            </Field>
            {(form.window === "trailing" || form.window === "offset") && (
              <Field label="Periods" hint={form.window === "trailing" ? "how many, the current one with them" : "how many before"}>
                <Input value={form.window_n} onChange={set("window_n")} aria-label="Periods" placeholder="3" />
              </Field>
            )}
          </div>
          <Field label="Filters" hint="always applied — one per line">
            <Textarea style={{ ...mono, minHeight: 56, resize: "vertical" }} aria-label="Filters"
              placeholder={"status <> 'Cancelled'\nis_test = false"} value={form.filters} onChange={set("filters")} />
          </Field>
          {composedPreview(form) && (builtFromMetrics(form.measure).length
            ? <p className="aug-fs-sm" style={{ ...MUTED, margin: 0 }} data-testid="metric-parts-statement">{composedPreview(form)}</p>
            : (
              <Field label="The statement it runs" hint="composed from the parts on every save">
                <Sql testId="metric-parts-statement">{composedPreview(form)}</Sql>
              </Field>
            ))}
        </div>
      )}
      {form.written === "statement" && (
      <Field label="SQL statement" required hint="a whole SELECT — CTEs allowed — that returns one row with the metric's value">
        <Textarea style={{ ...mono, minHeight: 88, resize: "vertical" }} aria-label="SQL statement"
          placeholder="SELECT SUM(amount) AS revenue FROM orders WHERE status = 'active'"
          value={form.sql} onChange={set("sql")} />
        <div style={ROW} data-testid="metric-statement-write">
          <Button size="sm" variant="secondary" disabled={writing} onClick={handleWriteSql}
            title="One model call: the statement written from the name, label, definition, filters and tables, over this connection's schema">
            {writing ? "Writing…" : "Generate from the definition"}
          </Button>
          <Chip>1 model call</Chip>
        </div>
        {written && form.sql === written.sql && (
          <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }} data-testid="metric-statement-written">
            Written by the model{written.model ? ` (${written.model})` : ""} from the definition
            {written.note ? ` — ${written.note}` : ""} — check it, then save.
          </p>
        )}
        {written && form.sql === written.sql && written.refused && (
          <p className="aug-fs-xs" style={{ color: "var(--amb4)", margin: 0 }} data-testid="metric-statement-refused">
            The platform could not accept it as a metric&apos;s statement: {written.refused} — fix it before saving.
          </p>
        )}
        {writeError && <p className="aug-fs-xs" style={ERROR}>{writeError}</p>}
        {!adding && proposed && proposed.metric === selected && form.sql === proposed.statement && (
          <div style={{ ...STACK, gap: 4 }} data-testid="metric-statement-proposed">
            <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }}>
              {proposed.options.length > 1 ? proposed.note : "Proposed by the platform from the stored expression"}
              {" — save to keep it."}
            </p>
            {proposed.options.length > 1 && (
              <div style={ROW} data-testid="metric-statement-options">
                <span className="aug-fs-xs" style={MUTED}>Switch to:</span>
                {proposed.options.filter((o) => o.statement !== form.sql).map((o) => (
                  <Button key={o.table} size="sm" variant="secondary" title={o.why}
                    onClick={() => { setProposed({ ...proposed, statement: o.statement }); setForm({ ...form, sql: o.statement }); }}>
                    over {o.table}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {!adding && proposals && proposals.statements.length === 0 && !isStatement(form.sql) && proposals.statement_note && (
          <p className="aug-fs-xs" style={{ color: "var(--amb4)", margin: 0 }}>{proposals.statement_note}</p>
        )}
      </Field>
      )}

      <div style={PAIR2}>
        {form.written === "statement" && (
          <Field label="Tables" hint="comma-separated">
            <Input placeholder="subscriptions, payments" value={form.tables} onChange={set("tables")} aria-label="Tables" />
          </Field>
        )}
        <Field label="Unit">
          <Input placeholder="$ or % or days" value={form.unit} onChange={set("unit")} aria-label="Unit" />
        </Field>
        <Field label="Dimensions" hint="columns it can be sliced by">
          <Input placeholder="order_date, country, plan_type" value={form.dimensions} onChange={set("dimensions")} aria-label="Dimensions" />
        </Field>
        {form.written === "statement" && (
          <Field label="Always-on filters" hint="WHERE conditions, comma-separated">
            <Input placeholder="is_test = false, deleted_at IS NULL" value={form.filters} onChange={set("filters")} aria-label="Filters" />
          </Field>
        )}
        <Field label="Caveats">
          {/* written as it reads (2026-11-24), kept as Markdown: drawn whole in the metric's detail, one plain line in its row */}
          <RichText kind={PROSE_TEXT} label="Caveats" placeholder="Finance-approved. Excludes internal test accounts."
            value={form.caveats} onChange={(v) => setForm((f) => ({ ...f, caveats: v }))} minHeight={56} testId="metric-caveats-editor" />
        </Field>
        <Field label="Additivity" hint="may its figures be summed — across groups and across periods">
          <SelectField value={form.additivity} aria-label="Additivity"
            onChange={(e) => setForm({ ...form, additivity: e.target.value })}>
            <option value="">Not said</option>
            <option value="additive">Additive — a total: groups and periods sum (revenue, orders)</option>
            <option value="non_additive">Non-additive — neither sums (a rate, an average)</option>
          </SelectField>
        </Field>
      </div>

      <Label>Health scorecard</Label>
      <div style={PAIR2}>
        <Field label="Target value" hint="green">
          <Input type="number" placeholder="e.g. 0.28" value={form.target_value} onChange={set("target_value")} aria-label="Target value" />
        </Field>
        <Field label="Better when" hint="beating a target is on target">
          <SelectField value={form.target_direction} aria-label="Better when"
            onChange={(e) => setForm({ ...form, target_direction: e.target.value })}>
            <option value="">Near it — a band, either side is short</option>
            <option value="higher">Higher — above the target is good</option>
            <option value="lower">Lower — below the target is good</option>
          </SelectField>
        </Field>
        <Field label="Warns when short by" hint="yellow · in its own units">
          <Input type="number" placeholder="e.g. 0.02" value={form.warning_threshold} onChange={set("warning_threshold")} aria-label="Warning threshold" />
        </Field>
        <Field label="Off target when short by" hint="red · in its own units">
          <Input type="number" placeholder="e.g. 0.05" value={form.critical_threshold} onChange={set("critical_threshold")} aria-label="Critical threshold" />
        </Field>
        <Field label="Target period">
          <Input placeholder="monthly, quarterly, ytd" value={form.target_period} onChange={set("target_period")} aria-label="Target period" />
        </Field>
        <Field label="Benchmark source">
          <Input placeholder="internal: FY2025 plan" value={form.benchmark_source} onChange={set("benchmark_source")} aria-label="Benchmark source" />
        </Field>
      </div>

      {/* Who approved it, and when, are not typed: the approve transition stamps the person signed in. */}
      <Label>Ownership and checks</Label>
      <div style={PAIR2}>
        <Field label="Owner" hint="the team or person who answers for it">
          <Input placeholder="Revenue team" value={form.owner} onChange={set("owner")} aria-label="Owner" />
        </Field>
        <Field label="Freshness SLA" hint="in words">
          <Input placeholder="daily by 6am UTC" value={form.freshness_sla} onChange={set("freshness_sla")} aria-label="Freshness SLA" />
        </Field>
      </div>
      <Field label="Freshness check SQL" hint="must return a single timestamp">
        <Textarea style={{ ...mono, minHeight: 56, resize: "vertical" }} placeholder="SELECT MAX(updated_at) FROM orders"
          value={form.freshness_check_sql} onChange={set("freshness_check_sql")} aria-label="Freshness check SQL" />
      </Field>
      <div style={PAIR2}>
        <Field label="Lineage" hint="one source per line">
          <Textarea style={{ minHeight: 56, resize: "vertical" }}
            placeholder={"orders table — raw Stripe charges\nrefunds table — Stripe refund events"}
            value={form.lineage} onChange={set("lineage")} aria-label="Lineage" />
        </Field>
        <Field label="Anti-patterns (NEVER rules)" hint="one per line — sent to the model as NEVER instructions">
          <Textarea style={{ minHeight: 56, resize: "vertical" }}
            placeholder={"COUNT(refunds) / COUNT(orders) — ignores refund amounts\nSUM(amount) without status filter — includes cancelled orders"}
            value={form.wrong_usage_examples} onChange={set("wrong_usage_examples")} aria-label="Anti-patterns" />
        </Field>
      </div>
      <Field label="Quality tests" hint="one SQL assertion per line — must return a truthy scalar to pass">
        <Textarea style={{ ...mono, minHeight: 80, resize: "vertical" }}
          placeholder={"SELECT COUNT(*) > 0 FROM orders\nSELECT SUM(amount) > 0 FROM orders WHERE status = 'paid'"}
          value={form.quality_tests} onChange={set("quality_tests")} aria-label="Quality tests" />
      </Field>

      {error && <p className="aug-fs-sm" style={ERROR}>{error}</p>}
      <div style={ROW}>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : adding ? "Create" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => {
          if (adding) { cancelForm(); return; }
          const sm = storedOf(selected, selectedSchema);
          if (sm) startEdit(sm);
          setDetailTab("overview");
        }}>Cancel</Button>
      </div>
    </div>
  );

  // ── One opened definition ──────────────────────────────────────────────────────────────────────────────────────────
  const definedDetail = (p: Placed, sm: Metric) => {
    const home = homeOf(sm);
    const status = sm.status ?? "draft";
    const keyed = (sm.connection ?? "*") !== "*";
    const confirming = deleting === `confirm:${sm.name}`;
    const tabs: { id: DetailTab; label: string; badge?: number }[] = [
      { id: "overview", label: "Overview" },
      { id: "approval", label: "Approval", badge: status === "proposed" ? 1 : 0 },
      { id: "dates", label: "Dates", badge: p.standing === "no_date" || p.standing === "date_unread" ? 1 : 0 },
      ...(keyed ? [{ id: "measures" as DetailTab, label: "Measures" }, { id: "grouped" as DetailTab, label: "Grouped" },
        { id: "words" as DetailTab, label: "Words & format" }] : []),
      { id: "versions", label: "Versions" },
    ];
    // Editing is a pop-up over the page, never a form opened in the row (the user, 2026-11-11, of this row's Edit tab:
    // "I want it as a pop-up"). "edit" is still where the page is — what "Write its SQL" and "Edit the SQL" open — but
    // it is drawn as the dialog, with the tab the reader was on behind it.
    const editing = detailTab === "edit";
    const shownTab: DetailTab = editing ? "overview" : detailTab;
    return (
      <div data-testid="metric-detail">
        <TabStrip size="1" label={`${sm.label || sm.name} views`} value={shownTab} onChange={setDetailTab} tabs={tabs}
          trailing={<><Button size="xs" variant="outline" data-testid="metric-edit-open" onClick={() => setDetailTab("edit")}
            title={p.standing === "no_sql" ? "It has no SQL yet — write it here" : "Change its name, SQL, unit, targets and checks"}>
            <Icon name="edit" size={12} /> Edit{p.standing === "no_sql" ? " · write its SQL" : ""}
          </Button><ToolsMenu testId="metric-tools" items={[
            { label: validating ? "Validating…" : "Validate now", onSelect: handleValidate, hidden: !connId,
              title: "Runs its quality tests against the warehouse" },
            { label: checkingFreshness ? "Checking…" : "Check freshness", onSelect: handleFreshness, hidden: !connId,
              title: "Reads its freshness check against the warehouse" },
            { label: promoting ? "Promoting…" : "Promote to the whole connection", onSelect: () => promote(sm),
              hidden: datasets.length < 2 || home === ALL || !sm.connection || sm.connection === ALL,
              title: "Every dataset of this connection reads this definition, except one that keeps its own of the same name." },
            status === "approved"
              ? { label: "Remove — deprecate it first", onSelect: () => {}, disabled: true, apart: true,
                  title: "An approved definition is in use: deprecate it (Approval) to remove it." }
              : { label: "Remove…", onSelect: () => { setDetailTab("overview"); setDeleting(`confirm:${sm.name}`); }, danger: true,
                  apart: true, testId: "metric-remove",
                  title: "Removes this definition from this dataset; a suggestion it came from is not proposed again." },
          ]} /></>} />
        <div style={{ paddingTop: 12 }}>
          {shownTab === "overview" && (
            <div style={STACK} data-testid="metric-overview">
              {/* What it is, as the study's Model layout lists it (§16: "Definition · formula · grain · unit · tests"), in
                  the Catalog's facts list; what is not recorded says so. The formula — its SQL — under it. */}
              <Facts testId="metric-facts" rows={[
                ["State", <span key="st" style={{ ...ROW, gap: 6 }}>
                  <Chip tone={STATUS_TONE[status] ?? "plain"}>{status}{sm.version ? ` v${sm.version}` : ""}</Chip>
                  {status === "approved" && sm.approved_by && (
                    <span className="aug-fs-sm" style={MUTED} title={sm.approved_at ? formatTimestamp(sm.approved_at) : undefined}>
                      approved by {byWho(sm.approved_by, me?.actor)}{sm.approved_at ? ` · ${dayWords(sm.approved_at)}` : ""}
                    </span>
                  )}
                </span>],
                ["Id", <span key="id" title="What SQL, agents and the API call it" style={{ fontFamily: "var(--font-mono)", color: "var(--t1)" }}>{sm.name}</span>],
                ["Definition", p.row.definition?.trim() || <NotSet key="d" word="Not written" what="No definition is written for it" />],
                // its caveats, where they say something the definition does not (a catalogue row's definition is often
                // the stored caveats themselves)
                ...(sm.caveats?.trim() && sm.caveats.trim() !== p.row.definition?.trim()
                  ? [["Caveats", <DefinitionBody key="caveats" text={sm.caveats} />] as [string, ReactNode]] : []),
                ["Grain", sm.time_column
                  ? <span key="g">{`${sm.time_grain ?? "month"} · dated by `}<span style={{ fontFamily: "var(--font-mono)" }}>{sm.time_column}</span></span>
                  : <NotSet key="g" word="No date column" what="It has no figure for a period until a date column is set — Dates" />],
                ["Grouping", sm.groupable
                  ? <span key="gr" data-testid="metric-grouping">by any dimension — written as parts: <span style={{ fontFamily: "var(--font-mono)" }}>{sm.measure}</span> over <span style={{ fontFamily: "var(--font-mono)" }}>{sm.source}</span></span>
                  : <span key="gr" data-testid="metric-grouping" style={MUTED}>{`${(sm.groupable_why || "cannot be grouped: it is one whole query").replace(/^./, (c) => c.toUpperCase())} — Edit › Parts to group it`}</span>],
                ...(status === "approved" ? [["Measured", sm.measured
                  ? <span key="ms" data-testid="metric-measured" title={sm.measured.question}>an answer used its formula · {dayWords(sm.measured.at)} — it stands on a person&apos;s word and a measured result</span>
                  : <NotSet key="ms" word="Not yet" what="No answer has been shown using its formula in the last 45 days — Evals › Context layer" />] as [string, ReactNode]] : []),
                ["Unit", sm.unit?.trim() || <NotSet key="u" what="No unit is set" />],
                ["Additivity", sm.additivity ? (sm.additivity === "additive" ? "additive — its figures may be summed, across groups and periods" : "non-additive — its figures may not be summed, across groups or periods")
                  : <NotSet key="a" what="Whether its figures may be summed is not set" />],
                ["Owner", sm.owner?.trim() || <NotSet key="o" what="No owner is recorded" />],
                ...(keyed ? [["Measures", sm.entity ? `${sm.entity}` : <NotSet key="e" word="Not linked" what="Not linked to a business object — Measures" />] as [string, ReactNode]] : []),
                ...((datasets.length > 1 || home === ALL) ? [["Dataset", <span key="ds" data-testid="metric-dataset">
                  {home === ALL ? "every dataset of this connection" : `belongs to ${home}`}</span>] as [string, ReactNode]] : []),
                ["Reads", sm.tables.length ? <span key="r" style={{ fontFamily: "var(--font-mono)" }}>{sm.tables.join(", ")}</span>
                  : <NotSet key="r" word="Not declared" what="No table is declared — the Catalog's lineage reads it from here" />],
                ...(sm.dimensions.length ? [["Sliced by", sm.dimensions.join(", ")] as [string, ReactNode]] : []),
                ...(sm.filters.length ? [["Always filtered", sm.filters.join(" and ")] as [string, ReactNode]] : []),
                ["Tests", sm.quality_tests.length ? `${countNoun(sm.quality_tests.length, "quality test")} — Tools ▾ › Validate now runs them`
                  : <NotSet key="t" what="No quality test is written — Edit" />],
                ...(sm.freshness_sla ? [["Freshness", `expected within ${sm.freshness_sla}`] as [string, ReactNode]] : []),
              ]} />
              {sm.sql
                ? <Sql testId="metric-sql">{sm.sql}</Sql>
                : <p className="aug-fs-sm" style={{ color: "var(--amb4)", margin: 0 }}>No SQL yet — it can&apos;t be measured until it has one. Write it under Edit.</p>}
              {validating && <Empty>Running its quality tests…</Empty>}
              {validationResult && <ValidationResultBlock result={validationResult} />}
              {checkingFreshness && <Empty>Checking its freshness…</Empty>}
              {freshnessResult && <FreshnessResultBlock result={freshnessResult} />}
              {confirming && (
                <div style={{ ...ROW, padding: "8px 10px", borderRadius: "var(--r2)", background: "var(--amb1)" }} data-testid="metric-remove-confirm">
                  <span className="aug-fs-sm" style={{ color: "var(--amb4)", flex: "1 1 240px" }}>
                    Remove it from {datasetWords(home)}? A suggestion it came from is not proposed again.
                  </span>
                  <Button size="xs" variant="destructive" disabled={deleting === sm.name} onClick={() => handleDelete(sm)}>
                    {deleting === sm.name ? "Removing…" : "Remove"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
                </div>
              )}
              {error && <p className="aug-fs-sm" style={ERROR}>{error}</p>}
            </div>
          )}
          {detailTab === "approval" && <GovernanceSection metric={sm} onChanged={() => { load(); }} />}
          {detailTab === "dates" && (
            <DatesSection key={`${sm.name}:${sm.time_column ?? ""}:${sm.time_confirmed_by ?? ""}`}
              metric={sm} proposals={proposals} onChanged={() => { setDatesEditing(false); load(); }} startEditing={datesEditing}
              onEditSql={() => setDetailTab("edit")} draftSql={form.sql} />
          )}
          {detailTab === "measures" && <EntitySection key={`${sm.name}:${sm.entity ?? ""}`} metric={sm} onChanged={load} />}
          {detailTab === "grouped" && <MetricGrouped key={`${sm.name}:${homeOf(sm)}`} metric={sm} />}
          {detailTab === "words" && <MetricWords key={`${sm.name}:${homeOf(sm)}`} metric={sm} onChanged={() => { load(); }} />}
          {detailTab === "versions" && <MetricVersions key={`${sm.name}:${homeOf(sm)}`} metric={sm} onChanged={() => { load(); }} />}
        </div>
        {/* Closing it keeps what was typed (the Dates read the statement as it stands here); Cancel puts back what is stored. */}
        <FormDialog open={editing && !adding} onOpenChange={o => { if (!o) setDetailTab("overview"); }} busy={saving}
          title={`Edit ${sm.label || sm.name}`} testId="metric-edit" width={980}>
          {editing && !adding ? editorForm : null}
        </FormDialog>
      </div>
    );
  };

  if (!connId) {
    return <Page testId="metrics-tab"><Empty>Select a connection to see the metrics that apply to it.</Empty></Page>;
  }
  if (!loaded) return <Page testId="metrics-tab"><Loading what="the metrics" /></Page>;
  if (catalogueError) {
    return (
      <Page testId="metrics-tab">
        <ReadFailed what="the metrics that apply to this connection" error={catalogueError} onRetry={() => { load(); }} />
      </Page>
    );
  }

  const every = schema === ALL;
  const placed = place(rows, metrics);
  const f = figuresOf(placed);
  const waiting = needsOf(placed);
  const groups = grouped(placed);
  const last = lastDecision(placed.map(p => p.stored).filter((m): m is Metric => !!m), removed);
  const proposedAt = placed.filter(p => p.standing === "proposed").map(p => p.stored?.proposed_at).filter((a): a is string => !!a).sort();
  const unmeasured = f.noDate + f.dateUnread + f.noSql;

  return (
    <Page testId="metrics-tab">
      {focusMissing && (
        <p className="aug-fs-sm" style={{ color: "var(--amb4)", margin: "0 0 8px" }} data-testid="metrics-focus-missing">
          The metric “{focusMissing}” is not in this list — it may be in another dataset or on another connection.
        </p>
      )}
      {rows.length > 0 && (
        <>
          <Figures testId="metrics-figures">
            <Figure label="Approved and measured" value={formatCount(f.measured)} testId="fig-measured"
              title="Approved, with SQL and a date column — it has a figure for any period"
              sub={f.approved
                ? `of ${formatCount(f.approved)} approved${f.unchecked ? ` · ${formatCount(f.unchecked)} not checked` : ""}`
                : "none approved yet"} />
            <Figure label="Waiting for review" value={formatCount(f.review)} tone={f.review ? "amber" : undefined} testId="fig-review"
              title="Proposed, not yet approved or rejected"
              sub={f.review
                ? (proposedAt.length ? `proposed ${dayWords(proposedAt[0])}` : "proposed")
                : f.drafts ? `${countNoun(f.drafts, "draft")} not yet proposed` : "nothing proposed"} />
            <Figure label="Can't be measured" value={formatCount(unmeasured)} tone={unmeasured ? "amber" : undefined} testId="fig-unmeasured"
              title="Approved, but with no SQL, or no date column — so no figure for a period"
              sub={registryError ? "the definitions could not be read"
                : unmeasured === 0 ? (f.approved ? "every approved one has SQL and a date" : "nothing approved yet")
                : [f.noDate ? `${unmeasured > f.noDate ? `${formatCount(f.noDate)} ` : ""}no date column` : "",
                   f.dateUnread ? `${unmeasured > f.dateUnread ? `${formatCount(f.dateUnread)} ` : ""}date on a table the SQL doesn't read` : "",
                   f.noSql ? `${unmeasured > f.noSql ? `${formatCount(f.noSql)} ` : ""}no SQL` : ""].filter(Boolean).join(" · ")} />
            <Figure label="Last decision" value={last ? dayWords(last.at) : "—"} testId="fig-last"
              title={last ? formatTimestamp(last.at) : "Approvals, proposals and removals are dated; an edit is not"}
              sub={last
                ? `${last.count > 1 ? `${formatCount(last.count)} ${last.action}` : `${last.label} ${last.action}`}${last.by ? ` · ${last.by}` : ""}`
                : "none recorded"} />
          </Figures>

          <NeedsYou testId="metrics-needs"
            empty={`Nothing needs you${registryError ? " · the definitions could not be read, so their dates are not checked" : ""}`}>
            {withUniqueKeys(waiting, n => n.kind).map(([key, n]) => (
              <NeedsGroup key={key} need={n}
                onOpen={(p, tab, editDates) => open(p, tab, { editDates, scroll: true })}
                onBind={(packId, rows) => setBinding({ packId, rows })} />
            ))}
          </NeedsYou>
        </>
      )}

      {/* A new metric is written in a dialog over the page (the user, 2026-11-07: "a pop-up overlay where I enter the
          details — at the moment everything is adjusted on the same plane"). Editing one is a dialog too (2026-11-11). */}
      <FormDialog open={adding} onOpenChange={o => { if (!o) cancelForm(); }} title="New metric" testId="metric-new"
        width={820}>
        {editorForm}
      </FormDialog>

      {/* Arc MC — the areas a business like this one is read by, and how far its metrics cover them. */}
      {connId && !every && <CoverageCard connId={connId} schema={schema || undefined} rows={rows} onAdopted={() => { load(); }} />}

      {/* The proposals, adopted as a set: dated, proposed and approved together, approved once (2026-10-23). */}
      {connId && !every && <AdoptProposals connId={connId} schema={schema || undefined} rows={rows} onDone={() => { load(); }} />}

      <Card label="Metrics" testId="metrics-list" right={<>
        {rows.length > 0 && <span style={NUM}>{`${formatCount(counts.total ?? rows.length)} apply${every ? " · every dataset" : ""}`}</span>}
        {connId && !every && <SplitIntoParts connId={connId} onDone={() => { load(); }} />}
        {connId && !every && <ExportMetricView connId={connId} />}
        <Button size="xs" variant="ghost" onClick={startAdd} disabled={adding}><Icon name="plus" size={12} />Add metric</Button>
      </>}>
        {rows.length === 0 ? (
          <Empty>
            Nothing applies to this connection yet. The explorer proposes metrics as it profiles the data, and an industry
            package adds its own once its roles are bound here.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 980 }}>
              {/* The register, as the Evidence → Action study draws it (§11.2: "a precise table, not cards"): what each
                  metric is, where it stands, its grain and date, unit, owner, the tables it reads, its tests and when it
                  was last approved. A row still opens in place to read and edit (the user, 2026-09-18). */}
              <div className="aug-fs-xs" style={{ ...LIST_GRID, ...MUTED, padding: "0 6px 6px" }}
                data-testid="metrics-register-head">
                <span>Metric</span><span>State</span><span>Grain · dated by</span><span>Unit</span><span>Owner</span>
                <span>Reads</span><span style={{ textAlign: "right" }}>Tests</span><span>Verified</span><span />
              </div>
              {groups.map((g, gi) => {
                const folded = g.folded && !unfolded[g.id] && !g.items.some(p => p.key === expanded);
                if (folded) {
                  return (
                    <div key={g.id}>
                      <FoldLine open={false} onToggle={() => setUnfolded(u => ({ ...u, [g.id]: true }))} testId={`metrics-group-${g.id}`}>
                        {`${g.label} · ${g.items.length}`}
                      </FoldLine>
                    </div>
                  );
                }
                return (
                  <div key={g.id} data-testid={`metrics-group-${g.id}`}>
                    <GroupHead name={g.label} count={g.items.length} first={gi === 0}
                      right={g.folded ? <Button size="xs" variant="ghost" onClick={() => setUnfolded(u => ({ ...u, [g.id]: false }))}>Fold</Button> : undefined} />
                    {g.items.map(p => (
                      <MetricRow key={p.key} p={p} every={every} open={expanded === p.key} onToggle={() => toggle(p)}>
                        {expanded === p.key && (
                          p.row.source === "defined"
                            ? (p.stored && selected === p.row.name && sameDataset(p.row.schema, selectedSchema)
                                ? definedDetail(p, p.stored)
                                : <ReadFailed what="its stored definition" error="the definitions could not be read" onRetry={() => { load(); }} />)
                            : <MetricProvenance row={p.row} onCustomise={() => customise(p.row, p.key)} onRemove={() => removeRow(p.row, p.key)}
                                onBind={() => setBinding({ packId: p.row.pack_id, rows: [p] })}
                                busy={materialising === p.key} error={rowError[p.key] ?? ""} />
                        )}
                      </MetricRow>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {removed.length > 0 && <RemovedList removed={removed} onRestore={restore} />}
        {!adding && error && !selected && <p className="aug-fs-sm" style={{ ...ERROR, marginTop: 8 }}>{error}</p>}
      </Card>
      {binding && connId && (
        <BindRolesDialog open onClose={() => setBinding(null)} connId={connId}
          schema={schema && schema !== "*" ? schema : (binding.rows[0]?.row.schema !== "*" ? binding.rows[0]?.row.schema : undefined)}
          packId={binding.packId}
          recipes={binding.rows.map(p => ({ name: p.row.name, label: p.row.label || p.row.name, sql: p.row.sql }))}
          onBound={() => { load(); }}
          onWriteSql={name => {
            const p = binding.rows.find(x => x.row.name === name);
            setBinding(null);
            if (p) void customise(p.row, p.key);
          }} />
      )}
    </Page>
  );
}

// ── The list ────────────────────────────────────────────────────────────────────────────────────────────────────────

const LIST_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 2.2fr) minmax(140px, 1fr) minmax(190px, 1.5fr) minmax(60px, .5fr) minmax(80px, .7fr) minmax(110px, 1fr) 44px minmax(64px, .5fr) 20px",
  columnGap: 14,
};

/** One metric's row in the register: its name and what it is (its definition, and its dataset in the every-dataset
 *  view, where it tells two rows of one name apart); where it stands; its grain and the column that dates it; its
 *  unit, owner, the tables it reads, how many quality tests it carries and when it was approved — and, open, its
 *  detail below it. What a row does not have says "—"; its id is said once, in the detail. */
function MetricRow({ p, every, open, onToggle, children }: {
  p: Placed; every: boolean; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const r = p.row, m = p.stored;
  const chip = standingChip(p);
  const unit = shortUnit(m?.unit ?? r.unit);
  const what = plainWords(r.definition || m?.caveats || "");
  const meta = [what, every ? datasetWords(r.schema) : ""].filter(Boolean).join(" · ");
  const col = m?.time_column ? shortColumn(m.time_column) : "";
  const grain = m?.time_grain ?? (r.grain || "");
  const owner = m?.owner || r.owner || "";
  const reads = (m?.tables?.length ? m.tables : r.tables) ?? [];
  const tests = m?.quality_tests?.length ?? 0;
  const none = <span style={MUTED}>—</span>;
  return (
    <div id={`metric-row-${p.key}`} data-testid="metric-row">
      <Button variant="plain" onClick={onToggle} aria-expanded={open} style={rowButtonStyle(open, LIST_GRID)}>
        <span style={{ minWidth: 0 }} title={r.name}>
          <span className="aug-fs-chrome" style={{ ...ONE_LINE, display: "block", color: "var(--t1)", fontWeight: 500 }}>{r.label}</span>
          {meta && (
            <span className="aug-fs-sm" style={{ ...MUTED, ...ONE_LINE, display: "block" }} title={meta}>{meta}</span>
          )}
        </span>
        <span style={{ ...ROW, gap: 6 }}>
          <Chip tone={chip.tone} title={chip.title}>{chip.text}</Chip>
          {p.duplicate && <Chip tone="amber" title="Two definitions share this name in this dataset; the newer one is read.">defined twice</Chip>}
        </span>
        <span className="aug-fs-chrome" title={m?.time_column ?? undefined} style={{ ...ONE_LINE, color: col || grain ? "var(--t2)" : "var(--t3)" }}>
          {col ? <>{`${grain || "month"} · `}<span style={{ fontFamily: "var(--font-mono)" }}>{col}</span></> : grain || "—"}
        </span>
        <span className="aug-fs-chrome" style={{ ...ONE_LINE, color: "var(--t2)" }} title={m?.unit ?? r.unit ?? undefined}>{unit || none}</span>
        <span className="aug-fs-chrome" style={{ ...ONE_LINE, color: "var(--t2)" }} title={owner || "No owner recorded"}>{owner || none}</span>
        <span className="aug-fs-chrome" style={{ ...ONE_LINE, color: "var(--t2)", fontFamily: reads.length ? "var(--font-mono)" : undefined }}
          title={reads.join(", ") || "No table declared"}>{reads.length ? reads.join(", ") : none}</span>
        <span className="aug-fs-chrome" style={{ ...NUM, textAlign: "right", color: tests ? "var(--t2)" : "var(--t3)" }}
          title={tests ? `${countNoun(tests, "quality test")} — Validate now runs them` : "No quality test written"}>
          {tests ? formatCount(tests) : "—"}
        </span>
        <span className="aug-fs-chrome" style={{ ...ONE_LINE, color: m?.approved_at ? "var(--t2)" : "var(--t3)" }}
          title={m?.approved_at ? `Approved ${formatTimestamp(m.approved_at)}${m.approved_by ? ` by ${m.approved_by}` : ""}` : "Not approved"}>
          {m?.approved_at ? dayWords(m.approved_at) : "—"}
        </span>
        <span style={{ display: "inline-flex", color: "var(--t3)" }}><Icon name={open ? "chevd" : "chevr"} size={12} /></span>
      </Button>
      {/* The detail hangs from the chosen row: the accent's edge says whose it is, without a box around it. */}
      {open && <div style={{ padding: "12px 6px 18px 14px", borderLeft: "2px solid var(--blue3)" }}>{children}</div>}
    </div>
  );
}

/** One kind of thing that needs a person — said once, with a button for each metric it is about. */
function NeedsGroup({ need, onOpen, onBind }: {
  need: Need; onOpen: (p: Placed, tab: DetailTab, editDates?: boolean) => void;
  /** Bind a package's roles, in place — the package and the metrics of this group that read it. */
  onBind?: (packId: string, rows: Placed[]) => void;
}) {
  const me = useMe();
  const n = need.items.length;
  const one = n === 1 ? need.items[0] : null;
  const name = (p: Placed) => p.row.label || p.row.name;
  const SHOWN = 8;
  const names = (verb: string, tab: DetailTab, editDates?: boolean) => [
    ...need.items.slice(0, SHOWN).map(p => (
      <Button key={p.key} size="xs" variant="secondary" title={`${verb} ${name(p)}`} onClick={() => onOpen(p, tab, editDates)}>
        {name(p)}
      </Button>
    )),
    ...(n > SHOWN ? [<span key="more" className="aug-fs-xs" style={MUTED}>{`+${formatCount(n - SHOWN)} more in the list`}</span>] : []),
  ];

  let title: string, detail: string, actions: ReactNode;
  switch (need.kind) {
    case "review": {
      const at = one?.stored?.proposed_at;
      title = one ? `${name(one)} is waiting for review` : `${formatCount(n)} metrics are waiting for review`;
      detail = one
        ? `proposed${one.stored?.proposed_by ? ` by ${byWho(one.stored.proposed_by, me?.actor)}` : ""}${at ? ` · ${dayWords(at)}` : ""} — approve or reject it`
        : "proposed, not yet approved — approve or reject each";
      actions = one
        ? <Button size="xs" variant="secondary" onClick={() => onOpen(one, "approval")}>Review</Button>
        : names("Review", "approval");
      break;
    }
    case "no_sql":
      title = one ? `${name(one)} has no SQL` : `${formatCount(n)} approved metrics have no SQL`;
      detail = "approved, but nothing can be measured until it has SQL";
      actions = one
        ? <Button size="xs" variant="secondary" onClick={() => onOpen(one, "edit")}>Write its SQL</Button>
        : names("Write the SQL of", "edit");
      break;
    case "no_date":
      title = one ? `${name(one)} can't be measured for a period` : `${formatCount(n)} approved metrics can't be measured for a period`;
      detail = one
        ? (one.standing === "date_unread"
            ? `${one.stored?.measurable_why || "its date is on a table its SQL does not read"} — join that table in the SQL, then choose the date`
            : "it has no date column — set one")
        : need.items.every(p => p.standing === "date_unread")
          ? "each has its date on a table its SQL does not read — join that table, then choose the date"
          : need.items.some(p => p.standing === "date_unread")
            ? "some have no date column, some a date on a table the SQL does not read — set one on each"
            : "none has a date column — set one on each";
      actions = one
        ? <Button size="xs" variant="secondary" onClick={() => onOpen(one, "dates", true)}>Set its date</Button>
        : names("Set the date of", "dates", true);
      break;
    case "not_bound": {
      const packs = packsOf(need.items);
      const roles = missingRoles(need.items);
      title = one ? `${name(one)} is not bound` : `${formatCount(n)} industry metrics are not bound`;
      detail = `the ${packs.join(", ") || "industry"} package names data not bound here${roles.length ? `: ${roles.join(", ")}` : ""}`;
      actions = <>
        {packs.map(pk => (
          <Button key={pk} size="xs" variant="secondary"
            onClick={() => onBind?.(pk, need.items.filter(p => p.row.pack_id === pk))}
            title="Say which of your tables and columns this package's metrics read — here, in a dialog">
            {packs.length > 1 ? `Bind ${pk} roles` : "Bind roles"}
          </Button>
        ))}
        {one
          ? <Button size="xs" variant="ghost" onClick={() => onOpen(one, "overview")}>Open</Button>
          : names("Open", "overview")}
      </>;
      break;
    }
    case "duplicate":
      title = one ? `${name(one)} is defined twice` : `${formatCount(n)} metrics are defined twice`;
      detail = "two definitions share a name in one dataset — the newer one is read";
      actions = one
        ? <Button size="xs" variant="secondary" onClick={() => onOpen(one, "edit")}>Open</Button>
        : names("Open", "edit");
      break;
  }
  return (
    <div data-testid={`needs-${need.kind}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        <div className="aug-fs-chrome" style={{ color: "var(--t1)", fontWeight: 500 }}>{title}</div>
        <div className="aug-fs-sm" style={{ color: "var(--t2)" }}>{detail}</div>
      </div>
      <div style={{ ...ROW, gap: 6, justifyContent: "flex-end", flex: "1 1 320px" }}>{actions}</div>
    </div>
  );
}

/** The proposals a person removed — who, when, and a way back. A removal is a decision, so it is listed, never just
 *  absent; folded into one line until opened. */
function RemovedList({ removed, onRestore }: { removed: RemovedProposal[]; onRestore: (r: RemovedProposal) => void }) {
  const [open, setOpen] = useState(false);
  const me = useMe();
  return (
    <div data-testid="metrics-removed">
      <FoldLine open={open} onToggle={() => setOpen((o) => !o)}>{`Removed here · ${removed.length}`}</FoldLine>
      {open && (
        <div style={{ marginTop: 4 }}>
          {removed.map((r, i) => (
            <div key={`${r.schema_name}:${r.name}`} className="aug-fs-chrome"
              style={{ ...ROW, padding: "6px 6px", ...(i ? RULE : {}) }}>
              <span style={{ color: "var(--t1)" }}>{r.label || r.name}</span>
              <span className="aug-fs-sm" style={MUTED}>· {datasetWords(r.schema_name)} · removed by {byWho(r.by, me?.actor)} on {r.at.slice(0, 10)}</span>
              <Button size="xs" variant="ghost" onClick={() => onRestore(r)} style={{ marginLeft: "auto" }}>Restore</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────────────────────────────────────────

function ValidationResultBlock({ result }: { result: MetricValidationResult }) {
  return (
    <div style={{ ...STACK, gap: 4 }} data-testid="metric-validation">
      <div style={ROW}>
        <Chip tone={result.passed ? "up" : "down"}>{result.passed ? "✓ all tests passed" : "✕ tests failed"}</Chip>
        <span className="aug-fs-sm" style={SUPPORT}>{result.message}</span>
      </div>
      {result.results.map((r, i) => (
        <div key={i} className="aug-fs-chrome">
          <span style={{ color: r.passed ? "var(--grn4)" : "var(--red4)" }}>{r.passed ? "✓" : "✕"}</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--t2)", marginLeft: 6, wordBreak: "break-all" }}>{r.test_sql}</span>
          {r.error && <p style={{ ...ERROR, margin: "2px 0 0 16px" }}>{r.error}</p>}
        </div>
      ))}
      {result.results.length === 0 && <Empty>No quality tests defined for this metric.</Empty>}
    </div>
  );
}

function FreshnessResultBlock({ result }: { result: MetricFreshnessResult }) {
  return (
    <div style={ROW} data-testid="metric-freshness">
      <Chip tone={result.ok ? "up" : "amber"}>{result.ok ? "fresh" : "freshness issue"}</Chip>
      <span className="aug-fs-sm" style={SUPPORT}>{result.message}</span>
      {result.sla && <span className="aug-fs-sm" style={MUTED}>SLA: {result.sla}</span>}
    </div>
  );
}

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label className="aug-fs-xs" style={{ color: "var(--t2)" }}>
        {label}
        {required && <span style={{ color: "var(--blue4)", marginLeft: 2 }}>*</span>}
        {hint && <span style={{ ...MUTED, marginLeft: 4 }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** What a suggestion shows before it is copied: what it means, and every way forward — make it this connection's, bind
 *  what it needs, or remove it. Never a dead end (the user, 2026-10-07: "no 'this requires binding' — that's a dead end
 *  with no action possible"). */
function MetricProvenance({ row, onCustomise, onRemove, onBind, busy, error }: {
  row: CatalogueMetric; onCustomise: () => void; onRemove: () => void; onBind?: () => void; busy: boolean; error: string;
}) {
  const unbound = row.state === "needs_binding";
  const [removing, setRemoving] = useState(false);
  const range = row.sane_range && (row.sane_range.min != null || row.sane_range.max != null) ? row.sane_range : null;
  return (
    <div style={{ ...STACK, maxWidth: 900 }} data-testid="metric-provenance">
      <div style={ROW}>
        <Chip title="Its id — what SQL, agents and the API call it"><span style={{ fontFamily: "var(--font-mono)" }}>{row.name}</span></Chip>
        {row.unit && <Chip title="Its unit">{row.unit}</Chip>}
        {row.tables.length > 0 && <Chip title="Tables it reads">{`reads ${row.tables.join(", ")}`}</Chip>}
      </div>
      {row.definition && <p className="aug-fs-ui" style={TEXT}>{row.definition}</p>}
      {row.why_it_matters && <p className="aug-fs-sm" style={SUPPORT}>{row.why_it_matters}</p>}

      {unbound && (
        <p className="aug-fs-sm" style={{ color: "var(--amb4)", margin: 0 }} data-testid="metric-unbound">
          {`Its SQL names ${row.missing_roles.join(", ") || "roles"} — data this connection has not bound to the `
            + `${row.pack_id || "industry"} package.`}
        </p>
      )}

      {row.sql ? (
        <div>
          <Label>{unbound ? "The package's SQL" : "SQL"}</Label>
          <Sql>{row.sql}</Sql>
        </div>
      ) : (
        <p className="aug-fs-sm" style={{ color: "var(--amb4)", margin: 0 }}>
          No SQL was proposed for this one — make it this connection&apos;s and write it.
        </p>
      )}
      {row.state === "formula_rejected" && row.reason && (
        <p className="aug-fs-sm" style={{ color: "var(--amb4)", margin: 0 }}>Its SQL was rejected: {row.reason}</p>
      )}

      {row.grain && <p className="aug-fs-xs" style={{ ...MUTED, margin: 0 }}>Grain — {row.grain}</p>}

      {range && (
        <div style={ROW}>
          <Chip title="Published for the population named beside it">{`published range ${range.min} – ${range.max}`}</Chip>
          {range.basis && <span className="aug-fs-xs" style={MUTED}>{range.basis}</span>}
          <span className="aug-fs-xs" style={MUTED}>Published for the population above — not a measurement of your data.</span>
        </div>
      )}

      {row.anti_patterns.length > 0 && (
        <div>
          <Label>Never</Label>
          <ul className="aug-fs-chrome" style={{ margin: 0, paddingLeft: 16, color: "var(--t2)", display: "flex", flexDirection: "column", gap: 4 }}>
            {row.anti_patterns.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {error && <p className="aug-fs-sm" style={ERROR}>{error}</p>}

      <div style={ROW}>
        <Button onClick={onCustomise} disabled={busy}
          title={unbound ? "Write it over your own columns — the package's SQL is kept beside it as a guide" : undefined}>
          {busy ? "Working…" : unbound ? "Write its SQL for this connection" : "Customise for this connection"}
        </Button>
        {unbound && (
          <Button variant="secondary" onClick={onBind}
            title="Say which of your tables and columns this package's metric reads — here, in a dialog">
            Bind its roles
          </Button>
        )}
        <Button variant="ghost" disabled={busy}
          onClick={() => (removing ? onRemove() : setRemoving(true))}
          style={{ color: "var(--red4)" }}
          title="It is not proposed here again; it can be restored from the foot of the list.">
          {removing ? "Remove — sure?" : "Remove"}
        </Button>
        <span className="aug-fs-xs" style={MUTED}>
          {`A copy for ${datasetWords(row.schema)} of this connection, as a draft. The original is untouched.`}
        </span>
      </div>
    </div>
  );
}

// ── M1: versions kept, and statements written as parts ───────────────────────────────────────────────────────────────

/** What one version changed against the one before it, in the fields a reader checks — at most four lines. */
const VERSION_FIELDS: [keyof Metric, string][] = [
  ["measure", "measure"], ["source", "source"], ["filters", "filters"], ["sql", "statement"], ["label", "label"],
  ["unit", "unit"], ["time_column", "date"], ["status", "state"],
];
function versionChanges(v: MetricVersion, before?: MetricVersion): string[] {
  if (!before) return ["first kept"];
  const show = (x: unknown) => (Array.isArray(x) ? x.join(" and ") || "none" : x == null || x === "" ? "none" : String(x));
  return VERSION_FIELDS
    .filter(([k]) => JSON.stringify(v.definition[k] ?? null) !== JSON.stringify(before.definition[k] ?? null))
    .map(([k, word]) => (k === "sql" ? "the statement changed" : `${word}: ${show(before.definition[k])} → ${show(v.definition[k])}`))
    .slice(0, 4);
}

/** Every kept version of one definition, newest first, each with what it changed; an earlier one can be put back —
 *  saved through the edit door, so an approved metric whose formula it changes goes back for review. */
export function MetricVersions({ metric, onChanged }: { metric: Metric; onChanged: () => void }) {
  const conn = metric.connection ?? "*";
  const schema = metric.schema_name || undefined;
  const [read, setRead] = useState<{ key: string; versions: MetricVersion[] | null; failed: string }>({ key: "", versions: null, failed: "" });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState("");
  const key = `${metric.name}|${conn}|${schema ?? ""}|${tick}`;
  useEffect(() => {
    let alive = true;
    getMetricVersions(metric.name, conn, schema)
      .then((versions) => { if (alive) setRead({ key, versions, failed: "" }); })
      .catch((e: unknown) => { if (alive) setRead({ key, versions: null, failed: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [metric.name, conn, schema, key]);
  const putBack = async (v: MetricVersion) => {
    setBusy(v.version); setSaid(""); setProblem("");
    try {
      await restoreMetricVersion(metric.name, v.version, conn, schema);
      setSaid(`Version ${v.version} is back — saved as a new version${metric.status === "approved" ? "; a changed formula waits for review" : ""}.`);
      setTick((t) => t + 1);
      onChanged();
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };
  if (read.failed) return <ReadFailed what="the versions" error={read.failed} onRetry={() => setTick((t) => t + 1)} />;
  if (read.key !== key || !read.versions) return <Loading what="the versions" />;
  const versions = read.versions;
  return (
    <div style={{ ...STACK, gap: 8 }} data-testid="metric-versions">
      {versions.length === 0
        ? <Empty>No version is kept yet — the next save of this definition is the first.</Empty>
        : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {versions.map((v, i) => (
              <li key={v.version} data-testid="metric-version" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ ...ROW, gap: 8 }}>
                  <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>{`v${v.version}`}</span>
                  {i === 0 && <Chip>current</Chip>}
                  <span className="aug-fs-xs" style={MUTED}>{[formatDateTime(v.at), v.by || "saved by the platform"].join(" · ")}</span>
                  {i > 0 && (
                    <Button size="xs" variant="ghost" style={{ marginLeft: "auto" }} disabled={busy !== null}
                      data-testid="metric-version-put-back" onClick={() => void putBack(v)}>
                      {busy === v.version ? "Putting back…" : "Put back"}
                    </Button>
                  )}
                </span>
                {versionChanges(v, versions[i + 1]).map((line) => (
                  <span key={`${v.version}:${line}`} className="aug-fs-xs" style={MUTED}>{line}</span>
                ))}
              </li>
            ))}
          </ol>
        )}
      {said && <p className="aug-fs-sm" style={{ color: "var(--grn4)", margin: 0 }} data-testid="metric-version-said">{said}</p>}
      {problem && <p className="aug-fs-sm" style={{ ...ERROR, margin: 0 }}>{problem}</p>}
    </div>
  );
}

/** Write this connection's statements as parts where they exactly can be: one table, one measure, a WHERE — and both
 *  give the same figure on the warehouse, each run both ways when the dialog opens. The rest stay statements, and say
 *  why. Splitting keeps each metric's governance: the figure is proven the same. */
export function SplitIntoParts({ connId, onDone }: { connId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [look, setLook] = useState<MetricSplit | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<MetricSplit | null>(null);
  const start = async () => {
    setOpen(true); setLook(null); setFailed(""); setDone(null);
    try { setLook(await structureMetrics(connId, false)); } catch (e: unknown) { setFailed(e instanceof Error ? e.message : String(e)); }
  };
  const apply = async () => {
    setBusy(true); setFailed("");
    try { setDone(await structureMetrics(connId, true)); onDone(); }
    catch (e: unknown) { setFailed(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const shown = done ?? look;
  return (
    <>
      <Button size="xs" variant="ghost" data-testid="metric-split-open" onClick={() => void start()}
        title="Write this connection's statements as parts where they exactly can be, so they can be grouped by any dimension">
        Write as parts
      </Button>
      <FormDialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }} busy={busy} width={820}
        title="Write statements as parts" testId="metric-split">
        <div style={{ ...STACK, gap: 10 }}>
          <p className="aug-fs-sm" style={{ ...MUTED, margin: 0 }}>
            A statement is split only where one table and one measure can be lifted out of it and the parts give the same
            figure on the warehouse — each is run both ways to check. The rest stay statements, and say why.
          </p>
          {failed && <p className="aug-fs-sm" style={{ ...ERROR, margin: 0 }}>{failed}</p>}
          {!shown && !failed && <Loading what="each statement, run both ways" />}
          {shown && (
            <>
              <span className="aug-fs-sm" style={{ color: "var(--t1)" }} data-testid="metric-split-sum">
                {done
                  ? `${countNoun(done.split, "metric")} written as parts; ${countNoun(done.kept, "statement")} kept.`
                  : `${countNoun(shown.split, "metric")} can be written as parts; ${countNoun(shown.kept, "statement")} ${shown.kept === 1 ? "stays as it is" : "stay as they are"}.`}
              </span>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {withUniqueKeys(shown.rows, (r) => `split:${r.name}`).map(([k, r]) => (
                  <li key={k} data-testid="metric-split-row" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ ...ROW, gap: 8 }}>
                      <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{r.label}</span>
                      <Chip tone={r.outcome === "split" ? "up" : "plain"}>{r.outcome === "split" ? "parts" : "statement"}</Chip>
                    </span>
                    <span className="aug-fs-xs" style={MUTED}>
                      {r.outcome === "split" && r.parts
                        ? `${r.parts.measure} over ${r.parts.source}${r.parts.filters.length ? `, where ${r.parts.filters.join(" and ")}` : ""} — the same figure both ways (${r.before == null ? "none" : formatMetricValue(Number(r.before))})`
                        : r.why}
                    </span>
                  </li>
                ))}
              </ol>
              {!done && (
                <span style={{ ...ROW, justifyContent: "flex-end", gap: 8 }}>
                  <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                  <Button size="sm" onClick={() => void apply()} disabled={busy || shown.split === 0} data-testid="metric-split-apply">
                    {busy ? "Writing…" : `Write ${countNoun(shown.split, "metric")} as parts`}
                  </Button>
                </span>
              )}
            </>
          )}
        </div>
      </FormDialog>
    </>
  );
}

// ── M2: one metric grouped by any dimension ─────────────────────────────────────────────────────────────────────────

const GROUP_GRAINS = ["day", "week", "month", "quarter", "year"] as const;
/** M3 — the windows a metric may run across periods with, in words. */
const WINDOW_CHOICES: [string, string][] = [["", "None — each period on its own"], ["cumulative", "A running total"],
  ["trailing", "The last periods, summed"], ["offset", "The figure periods before"], ["first", "Its first reading in each period"],
  ["last", "Its last reading in each period"]];

/** A metric grouped by any dimension its source reaches through the ontology's links, and by a period: compiled by the
 *  engine on a click, run through the object door, the groups largest first, the statement it ran beneath. One that
 *  cannot be grouped says why. */
export function MetricGrouped({ metric }: { metric: Metric }) {
  const conn = metric.connection ?? "*";
  const schema = metric.schema_name || undefined;
  const key = `${metric.name}|${conn}|${schema ?? ""}`;
  const [read, setRead] = useState<{ key: string; dims: MetricDimensions | null; failed: string }>({ key: "", dims: null, failed: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getMetricDimensions(metric.name, conn, schema)
      .then((dims) => { if (alive) setRead({ key, dims, failed: "" }); })
      .catch((e: unknown) => { if (alive) setRead({ key, dims: null, failed: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [metric.name, conn, schema, key, tick]);
  const [by, setBy] = useState("");
  const [grain, setGrain] = useState("");
  // the window for this read: "declared" — the metric's own; "" — none; else one asked here
  const [win, setWin] = useState("declared");
  const [winN, setWinN] = useState("1");
  const [result, setResult] = useState<MetricQueryResult | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setRunning(true); setError("");
    try {
      const window = !grain || win === "declared" ? undefined : win === "" ? {}
        : { kind: win as MetricWindow["kind"], ...(win === "trailing" || win === "offset" ? { n: Number(winN) || 1 } : {}) };
      setResult(await queryMetric({ metric: metric.name, connection_id: conn, schema_name: schema ?? null,
        by: by ? [by] : [], grain: grain || null, ...(window !== undefined ? { window } : {}), limit: 200 }));
    } catch (e: unknown) { setResult(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };
  if (read.failed) return <ReadFailed what="what it may be grouped by" error={read.failed} onRetry={() => setTick((t) => t + 1)} />;
  if (read.key !== key || !read.dims) return <Loading what="what it may be grouped by" />;
  const dims = read.dims;
  if (!dims.groupable) {
    return (
      <p className="aug-fs-sm" style={{ ...MUTED, margin: 0 }} data-testid="metric-grouped-why">
        {`${dims.why.replace(/^./, (c) => c.toUpperCase())}${metric.groupable ? "" : " — Edit › Parts to group it"}.`}
      </p>
    );
  }
  const own = dims.dimensions.filter((d) => !d.via);
  const linked = dims.dimensions.filter((d) => d.via);
  const valueAt = result ? result.columns.length - 1 : 0;
  const most = Math.max(1e-9, ...(result?.rows ?? []).map((x) => Math.abs(Number(x[result ? result.columns.length - 1 : 0] ?? 0))));
  const rows = result ? [...result.rows].sort((a, b) => (grain ? String(a[a.length - 2]).localeCompare(String(b[b.length - 2]))
    : Number(b[valueAt] ?? 0) - Number(a[valueAt] ?? 0))) : [];
  return (
    <div style={{ ...STACK, gap: 10 }} data-testid="metric-grouped">
      <div style={{ ...ROW, gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Grouped by" hint={`${countNoun(dims.dimensions.length, "dimension")}, through ${countNoun(new Set(linked.map((d) => d.via)).size, "link")}`}>
          <SelectField value={by} aria-label="Grouped by" data-testid="metric-grouped-by" onChange={(e) => setBy(e.target.value)}>
            <option value="">Nothing — its one figure</option>
            {own.map((d) => <option key={d.path} value={d.path}>{d.label}</option>)}
            {linked.map((d) => <option key={d.path} value={d.path}>{d.label}</option>)}
          </SelectField>
        </Field>
        <Field label="By period" hint="on its own date">
          <SelectField value={grain} aria-label="By period" onChange={(e) => setGrain(e.target.value)}>
            <option value="">No period</option>
            {GROUP_GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
          </SelectField>
        </Field>
        {grain && (
          <Field label="Window" hint={metric.window ? `its own: ${WINDOW_CHOICES.find(([v]) => v === metric.window?.kind)?.[1].toLowerCase()}` : "across the periods"}>
            <SelectField value={win} aria-label="Window" onChange={(e) => setWin(e.target.value)}>
              <option value="declared">{metric.window ? "Its own window" : "None — each period on its own"}</option>
              {WINDOW_CHOICES.filter(([v]) => v).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
          </Field>
        )}
        {grain && (win === "trailing" || win === "offset") && (
          <Field label="Periods"><Input value={winN} onChange={(e) => setWinN(e.target.value)} aria-label="Periods" style={{ width: 64 }} /></Field>
        )}
        <Button size="sm" variant="secondary" disabled={running} onClick={() => void run()} data-testid="metric-grouped-run">
          {running ? "Reading…" : "Show"}
        </Button>
      </div>
      {error && <p className="aug-fs-sm" style={{ ...ERROR, margin: 0 }} data-testid="metric-grouped-error">{error}</p>}
      {result && (
        <>
          <span className="aug-fs-xs" style={MUTED} data-testid="metric-grouped-sum">
            {`${countNoun(rows.length, "row")}${result.unit_why ? ` · ${result.unit_why}` : ""}${result.caveats.length ? ` · ${result.caveats.join(", ")}` : ""}${result.links.length ? ` · joined through ${result.links.map((l) => `${l.link} (${l.cardinality}${l.treatment ? `, ${l.treatment}` : ""})`).join(", ")}` : ""}`}
          </span>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {rows.slice(0, 200).map((r, i) => (
              // the name, its figure beside it and a bar of its size — read together at any width, never a figure at the far edge
              <li key={`${i}:${r.slice(0, valueAt).join("|")}`} data-testid="metric-grouped-row"
                style={{ display: "grid", gridTemplateColumns: "minmax(120px, 260px) max-content minmax(60px, 240px)", gap: 12, alignItems: "center" }}>
                <span className="aug-fs-sm" style={{ color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.slice(0, valueAt).map((c) => (c == null || c === "" ? "No value" : String(c))).join(" · ") || metric.label}
                </span>
                <span className="aug-fs-sm" style={{ ...NUM, textAlign: "right" }}>
                  {r[valueAt] == null || r[valueAt] === "" ? "—" : formatFigure(Number(r[valueAt]), result.format ?? metric.format, result.unit ?? metric.unit)}
                </span>
                <span aria-hidden style={{ height: 4, borderRadius: 2, background: "var(--accent-a5)",
                  width: `${Math.max(2, (Math.abs(Number(r[valueAt] ?? 0)) / most) * 100)}%` }} />
              </li>
            ))}
          </ol>
          <FoldLine open={showSql} onToggle={() => setShowSql((x) => !x)} testId="metric-grouped-sql-fold">The statement it ran</FoldLine>
          {showSql && <Sql testId="metric-grouped-sql">{result.sql}</Sql>}
        </>
      )}
    </div>
  );
}

// ── M4: the words a metric is known by, and how its figures are shown ───────────────────────────────────────────────

const FORMAT_CHOICES: [string, string][] = [["", "As a number, its unit after it"], ["number", "A number, to its decimals"],
  ["currency", "A currency"], ["percent", "A percent of a fraction (0.25 → 25%)"], ["compact", "Compact (1.2M)"]];

/** The words people call a metric — found by the answer path and by Discover's search as its name is — and how its
 *  figures are shown, declared once and read wherever its figures are drawn. */
export function MetricWords({ metric, onChanged }: { metric: Metric; onChanged: () => void }) {
  const conn = metric.connection ?? "*";
  const [words, setWords] = useState<string[]>(metric.synonyms ?? []);
  const [adding, setAdding] = useState("");
  const [fmt, setFmt] = useState<FigureFormat>(metric.format ?? { format: "" });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState("");
  const act = async (what: () => Promise<void>, done: string) => {
    setBusy(true); setSaid(""); setProblem("");
    try { await what(); setSaid(done); onChanged(); }
    catch (e: unknown) { setProblem(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const add = () => { const t = adding.trim(); if (!t) return;
    void act(async () => { setWords(await putMetricSynonyms(metric.name, conn, [t])); setAdding(""); }, `“${t}” is kept as a word for it.`); };
  const takeOff = (t: string) => void act(async () => { setWords(await putMetricSynonyms(metric.name, conn, [], [t])); }, `“${t}” is taken off.`);
  const saveFormat = () => void act(async () => {
    setFmt((await putMetricFormat(metric.name, conn, fmt.format ? fmt : null)) ?? { format: "" });
  }, fmt.format ? "Its figures are shown so from now on." : "Its figures are shown as numbers again.");
  return (
    <div style={{ ...STACK, gap: 14 }} data-testid="metric-words">
      <Field label="Words people call it" hint="the answer path and Discover's search find it by these as by its name">
        <div style={{ ...ROW, gap: 6, flexWrap: "wrap" }} data-testid="metric-synonyms">
          {words.length === 0 && <span className="aug-fs-sm" style={MUTED}>None yet.</span>}
          {words.map((t) => (
            <Chip key={`syn:${t}`}>{t}
              <Button size="xs" variant="ghost" aria-label={`Take “${t}” off`} disabled={busy} onClick={() => takeOff(t)}
                style={{ marginLeft: 4, height: 16, padding: "0 2px" }}><Icon name="close" size={10} /></Button>
            </Chip>
          ))}
        </div>
        <div style={{ ...ROW, gap: 6 }}>
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Another word" placeholder="turnover"
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} style={{ maxWidth: 260 }} />
          <Button size="sm" variant="secondary" disabled={busy || !adding.trim()} onClick={add} data-testid="metric-synonym-add">Add</Button>
        </div>
      </Field>
      <Field label="How its figures are shown" hint={`e.g. ${formatFigure(1234567.891, fmt.format ? fmt : null, metric.unit)} — wherever its figures are drawn`}>
        <div style={{ ...ROW, gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <SelectField value={fmt.format} aria-label="Format" onChange={(e) => setFmt({ ...fmt, format: e.target.value })}>
            {FORMAT_CHOICES.map(([v, l]) => <option key={v || "plain"} value={v}>{l}</option>)}
          </SelectField>
          {fmt.format === "currency" && (
            <Input value={fmt.currency ?? ""} onChange={(e) => setFmt({ ...fmt, currency: e.target.value.toUpperCase().slice(0, 3) })}
              aria-label="Currency" placeholder="USD" style={{ width: 72 }} />
          )}
          {fmt.format && (
            <Input value={fmt.decimals == null ? "" : String(fmt.decimals)} aria-label="Decimals" placeholder="decimals" style={{ width: 88 }}
              onChange={(e) => setFmt({ ...fmt, decimals: e.target.value === "" ? null : Math.max(0, Math.min(6, Number(e.target.value) || 0)) })} />
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={saveFormat} data-testid="metric-format-save">Save the format</Button>
        </div>
      </Field>
      {said && <p className="aug-fs-sm" style={{ color: "var(--grn4)", margin: 0 }} data-testid="metric-words-said">{said}</p>}
      {problem && <p className="aug-fs-sm" style={{ ...ERROR, margin: 0 }}>{problem}</p>}
    </div>
  );
}

// ── M6: metric view YAML out ────────────────────────────────────────────────────────────────────────────────────────

/** This connection's metrics written as parts, downloaded as metric view YAML (version 1.1) — one document per source;
 *  what is not written (a statement) said beside it. Importing one is the Import tab's (a .yaml file). */
export function ExportMetricView({ connId }: { connId: string }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const go = async () => {
    setBusy(true); setSaid([]);
    try {
      const out = await exportMetricView(connId);
      const url = URL.createObjectURL(new Blob([out.yaml], { type: "application/yaml" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${connId}-metric-views.yaml`; a.click();
      URL.revokeObjectURL(url);
      setSaid(out.said);
    } catch (e: unknown) {
      setSaid([e instanceof Error ? e.message : String(e)]);
    } finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void go()} data-testid="metric-view-export"
        title={said.length ? said.join("\n") : "Download its metrics written as parts as metric view YAML (version 1.1)"}>
        <Icon name="download" size={12} />{busy ? "Writing…" : "Metric view YAML"}
      </Button>
      {said.length > 0 && <span className="aug-fs-xs" style={MUTED} data-testid="metric-view-said" title={said.join("\n")}>
        {said.length === 1 ? said[0] : `${formatCount(said.length)} things not written — ${said[0]}; …`}</span>}
    </span>
  );
}

