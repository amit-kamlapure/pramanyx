"use client";

/**
 * ScheduleEditor — the schedule trigger as a person states one, not as cron.
 *
 * The user's screenshot (2026-09-15): the When drawer rendered "Daily" beside a bare
 * text box holding "0 9" — a cron fragment doing the work of a time control, crammed
 * sideways into a 312px rail. This editor states the same fact the way it is said:
 * an occurrence (hourly · daily · weekly · monthly), a real time control, weekday or
 * day-of-month pickers where the occurrence needs one, and a plain-words summary with
 * the clock named — UTC, because that is what the scheduler evaluates today (SP-13
 * moves it to the reader's timezone; lying about that here would arm a 9am that fires
 * at 7). Custom keeps the raw cron one click away: the field is the truth, and a
 * shape this editor cannot say (steps, ranges) round-trips through it untouched.
 *
 * 2026-11-15 — ONCE and EVERY N. There is one scheduler, and the one that was dropped
 * (the agent shell's, in the coworker) could say three things a cron cannot: once at an
 * instant, every N from a start, an ordinal or a number of runs. The field therefore
 * holds a cron OR a recurrence (two lines, `DTSTART` then `RRULE`; the server's
 * `automations/recurrence.py` is its reading). This editor states Once and Every N as a
 * person does; any other recurrence is typed under Custom and kept untouched.
 */

import React from "react";

import { Button } from "@/components/ui/button";
import { inputStyle } from "@/components/automations/AutomationRows";
import { SelectField } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Occurrence = "once" | "every" | "hourly" | "daily" | "weekly" | "monthly" | "custom";
type EveryUnit = "minutes" | "hours" | "days" | "weeks";

export type ScheduleShape = {
  occurrence: Occurrence;
  /** "HH:MM" for once/every/daily/weekly/monthly; minute-of-hour for hourly. */
  time: string;
  minute: number;
  /** Cron weekday numbers, 0/7=Sun … 6=Sat, ascending. Weekly only. */
  weekdays: number[];
  /** 1–28. Monthly only — days every month has, so a schedule never silently skips. */
  dayOfMonth: number;
  /** "YYYY-MM-DD": the day a one-off runs, or the day an every-N schedule starts. */
  date: string;
  /** Every-N only: how many, of what. */
  every: number;
  unit: EveryUnit;
  /** The raw expression, always the saved truth. */
  cron: string;
};

const FREQ_UNIT: Record<string, EveryUnit> = { MINUTELY: "minutes", HOURLY: "hours", DAILY: "days", WEEKLY: "weeks" };
const UNIT_FREQ: Record<EveryUnit, string> = { minutes: "MINUTELY", hours: "HOURLY", days: "DAILY", weeks: "WEEKLY" };
/** The recurrences this editor writes: a start with no clock of its own (it is read in the chain's), then the recurrence. */
const WRITTEN_RECURRENCE = /^DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}\s*\n\s*RRULE:(\S+)$/i;

/** Whether a schedule's expression is a recurrence rather than a cron (the server's own test). */
export function isRecurrence(expression: string): boolean {
  return expression.trimStart().toUpperCase().startsWith("DTSTART");
}

/** Once, or every N from a start — the two recurrences this editor states. Any other recurrence stays custom, untouched. */
function parseRecurrence(text: string, base: ScheduleShape): ScheduleShape {
  const m = WRITTEN_RECURRENCE.exec(text.trim());
  if (!m) return base;
  const parts = new Map(m[6].split(";").filter(Boolean).map(piece => {
    const [key, value = ""] = piece.split("=");
    return [key.toUpperCase(), value.toUpperCase()] as [string, string];
  }));
  const only = (...keys: string[]) => [...parts.keys()].every(k => keys.includes(k));
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const time = `${m[4]}:${m[5]}`;
  if (parts.get("FREQ") === "DAILY" && parts.get("COUNT") === "1" && only("FREQ", "COUNT")) {
    return { ...base, occurrence: "once", date, time };
  }
  const unit = FREQ_UNIT[parts.get("FREQ") ?? ""];
  const every = Number(parts.get("INTERVAL") ?? "1");
  if (unit && only("FREQ", "INTERVAL") && Number.isInteger(every) && every >= 1) {
    return { ...base, occurrence: "every", every, unit, date, time };
  }
  return base;
}

const recurrenceStart = (s: ScheduleShape) => `DTSTART:${s.date.replace(/-/g, "")}T${(s.time || "09:00").replace(":", "")}00`;

const DAY_WORDS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_WORDS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const two = (n: number) => String(n).padStart(2, "0");

/** Parse the cron shapes this platform writes; anything else is `custom`, untouched. */
export function parseCron(cron: string): ScheduleShape {
  const base: ScheduleShape = {
    occurrence: "custom", time: "09:00", minute: 0, weekdays: [1], dayOfMonth: 1,
    date: "", every: 2, unit: "hours",
    cron: cron.trim(),
  };
  if (isRecurrence(cron)) return parseRecurrence(cron, base);
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return base;
  const [m, h, dom, mon, dow] = f;
  const mi = /^\d{1,2}$/.test(m) ? Number(m) : NaN;
  const hi = /^\d{1,2}$/.test(h) ? Number(h) : NaN;
  const ok = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;

  if (ok(mi, 59) && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, occurrence: "hourly", minute: mi };
  }
  if (!ok(mi, 59) || !ok(hi, 23) || mon !== "*") return base;
  const time = `${two(hi)}:${two(mi)}`;
  if (dom === "*" && dow === "*") return { ...base, occurrence: "daily", time };
  if (dom === "*" && /^\d(,\d)*$/.test(dow.replace(/7/g, "0"))) {
    const days = [...new Set(dow.split(",").map(d => Number(d) % 7))].sort();
    if (days.every(d => d >= 0 && d <= 6)) {
      return { ...base, occurrence: "weekly", time, weekdays: days };
    }
    return base;
  }
  if (dow === "*" && /^\d{1,2}$/.test(dom) && Number(dom) >= 1 && Number(dom) <= 28) {
    return { ...base, occurrence: "monthly", time, dayOfMonth: Number(dom) };
  }
  return base;
}

export function toCron(s: ScheduleShape): string {
  const [h, m] = (s.time || "09:00").split(":").map(Number);
  switch (s.occurrence) {
    case "once": return `${recurrenceStart(s)}\nRRULE:FREQ=DAILY;COUNT=1`;
    case "every": return `${recurrenceStart(s)}\nRRULE:FREQ=${UNIT_FREQ[s.unit]};INTERVAL=${Math.max(1, Math.floor(s.every) || 1)}`;
    case "hourly": return `${s.minute} * * * *`;
    case "daily": return `${m} ${h} * * *`;
    case "weekly": return `${m} ${h} * * ${(s.weekdays.length ? s.weekdays : [1]).join(",")}`;
    case "monthly": return `${m} ${h} ${s.dayOfMonth} * *`;
    default: return s.cron;
  }
}

/** The schedule in the words a person would say it — the clock always named.
 *  SP-13: a chain with its own timezone says THAT clock, never "UTC" for a cron
 *  that is not read in UTC. */
export function cronWords(cron: string, tz = ""): string {
  const clock = tz || "UTC";
  const s = parseCron(cron);
  switch (s.occurrence) {
    // The two recurrences this editor states, in the server's own words (`recurrence.Recurrence.said`).
    case "once": return `Once, on ${dayWords(s.date)} at ${s.time} ${clock}`;
    case "every": {
      const every = s.every === 1 ? `Every ${s.unit.slice(0, -1)}` : `Every ${s.every} ${s.unit}`;
      const since = `, from ${dayWords(s.date)}`;
      if (s.unit === "minutes" || s.unit === "hours") return `${every}${since} at ${s.time} ${clock}`;
      const on = s.unit === "weeks" ? ` on ${dayWords(s.date).split(" ")[0]}` : "";
      return `${every}${on} at ${s.time} ${clock}${s.every > 1 ? since : ""}`;
    }
    case "hourly": return `Every hour at minute ${s.minute}`;
    case "daily": return `Every day at ${s.time} ${clock}`;
    case "weekly": {
      const days = s.weekdays.map(d => DAY_WORDS[d]).join(", ");
      return `Every ${days} at ${s.time} ${clock}`;
    }
    case "monthly": return `Monthly on day ${s.dayOfMonth} at ${s.time} ${clock}`;
    default:
      if (isRecurrence(cron)) return `On the recurrence ${cron.trim().split(/\s*\n\s*/)[1] ?? cron.trim()} (${clock})`;
      return cron ? `On the cron schedule ${cron} (${clock})` : "";
  }
}

/** "2026-11-16" as "Mon 16 Nov 2026" — the day itself, whatever clock it is read in. */
function dayWords(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${DAY_WORDS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTH_WORDS[m - 1]} ${y}`;
}

/** A day from now, as "YYYY-MM-DD" — module scope, because reading the clock inside a component is impure. */
function dayFromNow(days: number): string {
  const t = new Date(Date.now() + days * 86_400_000);
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}

/** The next fire, computed only for the shapes whose next fire is trivial arithmetic —
 *  a custom expression gets no guess, because a wrong next-run is worse than none. */
export function nextFireUtc(cron: string, now = new Date()): Date | null {
  const s = parseCron(cron);
  // A recurrence states its own times in its words; its next run is the server's to compute.
  if (s.occurrence === "custom" || s.occurrence === "once" || s.occurrence === "every") return null;
  const [h, m] = (s.time || "09:00").split(":").map(Number);
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    s.occurrence === "hourly" ? now.getUTCHours() : h,
    s.occurrence === "hourly" ? s.minute : m, 0, 0));
  const stepDay = () => t.setUTCDate(t.getUTCDate() + 1);
  if (s.occurrence === "hourly") {
    if (t <= now) t.setUTCHours(t.getUTCHours() + 1);
    return t;
  }
  if (s.occurrence === "daily") {
    if (t <= now) stepDay();
    return t;
  }
  if (s.occurrence === "weekly") {
    const days = s.weekdays.length ? s.weekdays : [1];
    for (let i = 0; i < 8; i++) {
      if (t > now && days.includes(t.getUTCDay())) return t;
      stepDay();
    }
    return t;
  }
  // monthly
  t.setUTCDate(s.dayOfMonth);
  if (t <= now) t.setUTCMonth(t.getUTCMonth() + 1, s.dayOfMonth);
  return t;
}

/** With `className="aug-label"`: 12px semibold sentence case. */
const fieldLabel: React.CSSProperties = { display: "block", marginBottom: 3 };

function DayChips({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  const toggle = (d: number) => {
    const next = value.includes(d) ? value.filter(x => x !== d) : [...value, d].sort();
    // A weekly schedule with no day would never fire while looking armed — the last
    // selected day stays.
    if (next.length) onChange(next);
  };
  return (
    <div role="group" aria-label="Days of the week" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {[1, 2, 3, 4, 5, 6, 0].map(d => {
        const on = value.includes(d);
        return (
          <Button key={d} variant="plain" size="xs" onClick={() => toggle(d)}
            aria-pressed={on} className="aug-fs-xs h-auto font-normal"
            style={{
              padding: "4px 8px", borderRadius: "var(--r-pill)",
              border: `1px solid ${on ? "var(--blue3)" : "var(--b1)"}`,
              background: on ? "var(--blue1, var(--bg-3))" : "var(--bg-1, var(--bg-2))",
              color: on ? "var(--blue4)" : "var(--t2)", fontWeight: on ? 600 : 400,
            }}>
            {DAY_WORDS[d]}
          </Button>
        );
      })}
    </div>
  );
}

export function ScheduleEditor({ cron, onCron, timezone = "" }: {
  cron: string;
  onCron: (cron: string) => void;
  /** SP-13 — the clock this chain's cron is read in ("" = UTC). Display context
   *  only: the editor labels honestly and leaves DST arithmetic to the server. */
  timezone?: string;
}) {
  const s = parseCron(cron);
  // A fresh schedule trigger arrives with no expression at all. Seed the default the
  // rest of the platform already uses (daily at 09:00 UTC) so the editor never shows
  // controls describing a schedule that is not there.
  React.useEffect(() => {
    if (!cron.trim()) onCron("0 9 * * *");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron]);

  const put = (patch: Partial<ScheduleShape>) => onCron(toCron({ ...s, ...patch }));
  // The next-run guess is EXACT arithmetic only — a zoned cron crosses DST, which is
  // the server's trigger to compute, so a non-UTC chain states no client guess.
  const next = timezone && timezone !== "UTC" ? null : nextFireUtc(cron);
  const clock = timezone || "UTC";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label className="aug-label" style={fieldLabel}>Repeats</label>
          <SelectField value={s.occurrence} aria-label="How often"
            onChange={e => {
              const occurrence = e.target.value as Occurrence;
              if (occurrence === "custom") onCron(s.cron || toCron(s));
              // Once is tomorrow until a day is chosen; Every N starts today. Both keep the time already set.
              else if (occurrence === "once") put({ occurrence, date: s.date || dayFromNow(1) });
              else if (occurrence === "every") put({ occurrence, date: s.date || dayFromNow(0) });
              else put({ occurrence });
            }}
            style={inputStyle}>
            <option value="once">Once</option>
            <option value="every">Every…</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom (cron or recurrence)</option>
          </SelectField>
        </div>
        {s.occurrence === "every" && (
          <>
            <div>
              <label className="aug-label" style={fieldLabel}>Every</label>
              <Input type="number" min={1} max={10000} value={s.every} aria-label="How many"
                onChange={e => put({ every: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                style={{ ...inputStyle, width: 72 }} />
            </div>
            <div>
              <label className="aug-label" style={fieldLabel}>Of</label>
              <SelectField value={s.unit} aria-label="Minutes, hours, days or weeks"
                onChange={e => put({ unit: e.target.value as EveryUnit })} style={{ ...inputStyle, width: 104 }}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </SelectField>
            </div>
          </>
        )}
        {(s.occurrence === "once" || s.occurrence === "every") && (
          <>
            <div>
              <label className="aug-label" style={fieldLabel}>{s.occurrence === "once" ? "On" : "Starting"}</label>
              <Input type="date" value={s.date} aria-label={s.occurrence === "once" ? "The day it runs" : "The day it starts"}
                onChange={e => e.target.value && put({ date: e.target.value })}
                style={{ ...inputStyle, width: 140 }} />
            </div>
            <div>
              <label className="aug-label" style={fieldLabel}>At ({clock})</label>
              <Input type="time" value={s.time} aria-label={`Time of day, ${clock}`}
                onChange={e => e.target.value && put({ time: e.target.value })}
                style={{ ...inputStyle, width: 96 }} />
            </div>
          </>
        )}
        {(s.occurrence === "daily" || s.occurrence === "weekly" || s.occurrence === "monthly") && (
          <div>
            <label className="aug-label" style={fieldLabel}>At ({clock})</label>
            <Input type="time" value={s.time} aria-label={`Time of day, ${clock}`}
              onChange={e => e.target.value && put({ time: e.target.value })}
              style={{ ...inputStyle, width: 96 }} />
          </div>
        )}
        {s.occurrence === "hourly" && (
          <div>
            <label className="aug-label" style={fieldLabel}>At minute</label>
            <Input type="number" min={0} max={59} value={s.minute} aria-label="Minute of the hour"
              onChange={e => put({ minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
              style={{ ...inputStyle, width: 72 }} />
          </div>
        )}
        {s.occurrence === "monthly" && (
          <div>
            <label className="aug-label" style={fieldLabel}>On day</label>
            <SelectField value={s.dayOfMonth} aria-label="Day of the month"
              onChange={e => put({ dayOfMonth: Number(e.target.value) })}
              style={{ ...inputStyle, width: 72 }}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d =>
                <option key={d} value={d}>{d}</option>)}
            </SelectField>
          </div>
        )}
      </div>

      {s.occurrence === "weekly" && (
        <div>
          <label className="aug-label" style={fieldLabel}>On</label>
          <DayChips value={s.weekdays} onChange={weekdays => put({ weekdays })} />
        </div>
      )}

      {s.occurrence === "custom" && (
        <div>
          <label className="aug-label" style={fieldLabel}>Cron expression, or a recurrence ({clock})</label>
          {/* Two rows: a cron is one line, a recurrence is two (its start, then the recurrence). */}
          <Textarea rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)" }}
            value={cron} aria-label="Cron expression, or a recurrence"
            onChange={e => onCron(e.target.value)}
            placeholder={"0 9 * * 1-5    or, for what a cron cannot say:\nDTSTART:20261207T090000 ⏎ RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=6"} />
        </div>
      )}

      {/* The schedule read back in words — what a person can check at a glance, with
          the clock named. The next run is stated only when its arithmetic is exact. */}
      <div className="aug-fs-xs" style={{ color: "var(--t3)", lineHeight: 1.5 }}>
        {cronWords(cron, timezone)}
        {next && (
          <> · next run {`${DAY_WORDS[next.getUTCDay()]} ${next.getUTCDate()} ${MONTH_WORDS[next.getUTCMonth()]}, ${two(next.getUTCHours())}:${two(next.getUTCMinutes())} UTC`}</>
        )}
      </div>
    </div>
  );
}
