"use client";

/**
 * Under a Slack bot: what was said in the channels it is in, read as knowledge (`connectors/knowledge/slack.py`) —
 * one document a day per channel, readable by that channel's members only. Reading is a person's click; the line says
 * what was read, for whom, and what Slack refused, with the permission it named.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSlackKnowledgeStatus, syncSlackKnowledge, type SlackKnowledgeStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function SlackKnowledgeRow({ botId }: { botId: string }) {
  const [status, setStatus] = useState<SlackKnowledgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const read = useCallback(async () => {
    try { setStatus(await getSlackKnowledgeStatus(botId)); } catch (e) { setErr(e instanceof Error ? e.message : "Reading failed"); }
  }, [botId]);
  useEffect(() => { void read(); }, [read]);

  const go = async () => {
    setBusy(true); setErr("");
    try {
      await syncSlackKnowledge(botId);
      // The read runs in the background; look again shortly, then once more.
      window.setTimeout(() => void read(), 4000);
      window.setTimeout(() => { void read(); setBusy(false); }, 15000);
    } catch (e) { setErr(e instanceof Error ? e.message : "The read was refused"); setBusy(false); }
  };

  const said = !status ? "" : status.refused ? status.refused
    : status.last_sync ? `${status.pages_indexed} channel-days read from ${status.channels.map(c => `#${c.name}`).join(", ") || "no channel"} · ${formatDateTime(status.last_sync)}`
    : "Not read yet. Only the channels the bot was invited to are read, and each is readable here by its members only.";
  return (
    <div data-testid="slack-knowledge" className="aug-fs-xs" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, paddingLeft: 38, color: "var(--t2)" }}>
      <span style={{ flex: 1, minWidth: 0, color: status?.refused ? "var(--amb4)" : "var(--t2)" }}>{err || said}</span>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void go()}
        title="Read what was said in the channels this bot is in, readable here by each channel's members only">
        {busy ? "Reading…" : status?.last_sync ? "Read again" : "Read its channels"}
      </Button>
    </div>
  );
}
