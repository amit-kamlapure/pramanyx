"use client";

/**
 * A published dashboard on a rhythm (the study's R21): by email or to a Slack channel as a PDF or a PNG, or as its words through an
 * Action Hub trigger. It is a Briefing subscription, so the one scheduler sends it and every send passes the departure gate. Nothing
 * is sent from here: Preview builds what a send would say and sends nothing.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  createBriefSubscription, deleteBriefSubscription, getActionTriggers, getBriefSubscriptions, getSlackBots, previewBriefSubscription,
  type ActionTrigger, type BriefSubscription, type SlackBotSummary,
} from "@/lib/api";

const RHYTHMS = [{ value: "day", label: "Every day" }, { value: "week", label: "Every week" }, { value: "month", label: "Every month" }];
const RHYTHM_WORDS: Record<string, string> = { day: "Every day", week: "Every week", month: "Every month", year: "Every year" };
type Way = "email" | "slack" | "trigger";

/** Where a subscription goes, as a person says it. */
export function destinationWords(s: BriefSubscription, bots: SlackBotSummary[], triggers: ActionTrigger[]): string {
  if (s.email_to) return s.email_to;
  if (s.bot_id) return `${s.channel} as ${bots.find(b => b.id === s.bot_id)?.name ?? "a Slack bot"}`;
  return triggers.find(t => t.id === s.trigger_id)?.name ?? "an Action Hub trigger";
}

export function SubscribeDashboard({ open, onClose, connectionId, dashboardId, title, owner }: {
  open: boolean; onClose: () => void; connectionId: string; dashboardId: string; title: string; owner?: string;
}) {
  const [held, setHeld] = useState<BriefSubscription[]>([]);
  const [bots, setBots] = useState<SlackBotSummary[]>([]);
  const [triggers, setTriggers] = useState<ActionTrigger[]>([]);
  const [period, setPeriod] = useState<BriefSubscription["period"]>("week");
  const [way, setWay] = useState<Way>("email");
  const [format, setFormat] = useState<"pdf" | "png">("pdf");
  const [email, setEmail] = useState("");
  const [bot, setBot] = useState("");
  const [channel, setChannel] = useState("");
  const [trigger, setTrigger] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [preview, setPreview] = useState<{ id: string; words: string } | null>(null);

  const read = useCallback(() => getBriefSubscriptions(connectionId)
    .then(all => setHeld(all.filter(s => s.content === "dashboard" && s.dashboard === dashboardId)))
    .catch(e => setProblem((e as Error).message)), [connectionId, dashboardId]);
  useEffect(() => {
    if (!open) return;
    void read();
    getSlackBots().then(b => { const on = b.filter(x => x.enabled); setBots(on); setBot(v => v || on[0]?.id || ""); }).catch(() => setBots([]));
    getActionTriggers().then(t => { const on = t.filter(x => x.enabled); setTriggers(on); setTrigger(v => v || on[0]?.id || ""); }).catch(() => setTriggers([]));
  }, [open, read]);

  const ready = way === "email" ? !!email.trim() : way === "slack" ? !!bot && !!channel.trim() : !!trigger;
  const subscribe = async () => {
    setBusy(true); setProblem("");
    try {
      await createBriefSubscription({
        conn_id: connectionId, name: `${title} · ${RHYTHM_WORDS[period].toLowerCase()}`, period, content: "dashboard", dashboard: dashboardId,
        ...(owner ? { dashboard_owner: owner } : {}), file_format: format, trigger_id: way === "trigger" ? trigger : "",
        ...(way === "email" ? { email_to: email.trim() } : {}), ...(way === "slack" ? { bot_id: bot, channel: channel.trim() } : {}),
      });
      setEmail(""); setChannel("");
      toast.success("Subscribed. The first send goes at its next time.");
      await read();
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try { await deleteBriefSubscription(id); if (preview?.id === id) setPreview(null); await read(); }
    catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const look = async (id: string) => {
    setBusy(true);
    try {
      const out = await previewBriefSubscription(id);
      setPreview({ id, words: out.error || out.markdown || "Nothing would be sent." });
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };

  const ways = [{ value: "email", label: "Email" }, { value: "slack", label: "Slack" }, ...(triggers.length ? [{ value: "trigger", label: "Action Hub" }] : [])];
  return (
    <FormDialog open={open} onOpenChange={o => { if (!o) onClose(); }} busy={busy} title={`Subscribe to ${title}`} width={560} testId="dashboard-subscribe"
      description="Sends the version its readers read, for the period just ended. Each figure is said with its period, and a send the departure gate holds does not leave.">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Segmented label="How often" value={period} options={RHYTHMS} onChange={v => setPeriod(v as BriefSubscription["period"])} />
        <Segmented label="Send by" value={way} options={ways} onChange={v => setWay(v as Way)} />
        {way === "email" && <Input aria-label="Email address" type="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} />}
        {way === "slack" && (bots.length ? (
          <div style={{ display: "flex", gap: 8 }}>
            <SelectField aria-label="Slack bot" value={bot} onChange={e => setBot(e.target.value)} style={{ flex: 1 }}>
              {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </SelectField>
            <Input aria-label="Slack channel" placeholder="#channel" value={channel} onChange={e => setChannel(e.target.value)} style={{ flex: 1 }} />
          </div>
        ) : <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>No Slack bot is connected yet.</span>)}
        {way === "trigger" && (
          <>
            <SelectField aria-label="Action Hub trigger" value={trigger} onChange={e => setTrigger(e.target.value)}>
              {triggers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
            <span className="aug-fs-sm" style={{ color: "var(--t2)" }}>A trigger carries the words and no file.</span>
          </>
        )}
        {way !== "trigger" && <Segmented label="File" value={format} options={[{ value: "pdf", label: "PDF" }, { value: "png", label: "PNG" }]} onChange={v => setFormat(v as "pdf" | "png")} />}
        {problem && <span className="aug-fs-sm" role="alert" data-testid="dashboard-subscribe-problem" style={{ color: "var(--t1)" }}>{problem}</span>}
        <div><Button size="sm" data-testid="dashboard-subscribe-save" disabled={!ready || busy} onClick={() => void subscribe()}>Subscribe</Button></div>
        {held.length > 0 && (
          <div data-testid="dashboard-subscriptions" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--b1)", paddingTop: 10 }}>
            {held.map(s => (
              <div key={s.id} data-testid="dashboard-subscription" className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--t1)" }}>{RHYTHM_WORDS[s.period]} · {destinationWords(s, bots, triggers)}</span>
                {s.last_status && <span style={{ color: "var(--t3)" }}>Last send: {s.last_status}</span>}
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => void look(s.id)}>Preview</Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => void remove(s.id)}>Remove</Button>
              </div>
            ))}
            {preview && <pre className="aug-fs-sm" data-testid="dashboard-subscribe-preview" style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--t2)" }}>{preview.words}</pre>}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
