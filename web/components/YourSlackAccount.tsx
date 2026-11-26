"use client";

/**
 * Settings ▸ Integrations ▸ Slack bots ▸ Your Slack account (2026-11-26; the user chose "From Slack, confirmed in app").
 *
 * The person's own Slack account, linked by a one-time code: they write "link" to the Pramanyx bot in Slack, the
 * platform sends the code to that Slack account by direct message, and it is entered here while signed in. Once linked,
 * what they ask Pramanyx to send them in Slack (`@me`) reaches them there. Theirs alone — nobody else's accounts are
 * listed, and only they unlink theirs. Where the code is entered is said once on the server (`LINK_PLACE`).
 */
import { useCallback, useEffect, useState } from "react";

import { BrandTile } from "@/components/BrandLogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Chip, Empty, MUTED, ONE_LINE, ROW, RULE } from "@/components/clarity/kit";
import { getMySlack, linkMySlack, unlinkMySlack, type MySlackAccount } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { dayMonth } from "@/lib/monitorSummary";

export function YourSlackAccount() {
  const [linked, setLinked] = useState<MySlackAccount[] | null>(null);
  const [how, setHow] = useState("");
  const [unread, setUnread] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  /** What the last link or unlink did, or why it did not — said, then left until the next one. */
  const [said, setSaid] = useState("");

  const shown = useCallback((got: { linked: MySlackAccount[]; how: string }) => {
    setLinked(got.linked);
    setHow(got.how);
    setUnread("");
  }, []);
  const notRead = useCallback((e: unknown) => setUnread(e instanceof Error ? e.message : String(e)), []);
  const read = useCallback(() => getMySlack().then(shown, notRead), [shown, notRead]);
  useEffect(() => {
    let live = true;
    getMySlack().then((got) => { if (live) shown(got); }, (e) => { if (live) notRead(e); });
    return () => { live = false; };
  }, [shown, notRead]);

  const link = async () => {
    setBusy(true);
    setSaid("");
    try {
      const made = await linkMySlack(code);
      setSaid(`Linked ${made.display || made.external_id}. What you ask Pramanyx to send you in Slack now reaches you there.`);
      setCode("");
      await read();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (account: MySlackAccount) => {
    setBusy(true);
    setSaid("");
    try {
      await unlinkMySlack(account.external_id);
      setSaid(`Unlinked ${account.display || account.external_id}. Nothing meant for you is sent there now.`);
      await read();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label="Your Slack account" testId="your-slack-account"
      right={<Chip title="Only you see and unlink your own accounts">yours alone</Chip>}>
      {unread ? <Empty>{unread}</Empty>
        : linked === null ? <Empty>Reading…</Empty>
        : linked.length === 0 ? <Empty>Not linked. What you ask Pramanyx to send you in Slack has nowhere to go until it is.</Empty>
        : linked.map((a, i) => (
          <div key={a.external_id} data-testid="your-slack-row"
            style={{ ...(i ? RULE : {}), padding: "9px 2px", display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto",
              gap: 10, alignItems: "center" }}>
            <BrandTile type="slack" />
            <div style={{ minWidth: 0 }}>
              <div className="aug-fs-chrome" style={{ ...ONE_LINE, fontWeight: 600, color: "var(--t1)" }}>
                {a.display || a.external_id}
              </div>
              <div className="aug-fs-sm" style={{ ...MUTED, ...ONE_LINE }} title={formatDateTime(a.linked_at)}>
                {`Slack member ${a.external_id} · linked ${dayMonth(a.linked_at)}`}
              </div>
            </div>
            <Button variant="secondary" size="xs" disabled={busy} onClick={() => void unlink(a)}>Unlink</Button>
          </div>
        ))}
      <form style={{ ...ROW, padding: "10px 2px 2px" }}
        onSubmit={(e) => { e.preventDefault(); if (code.trim() && !busy) void link(); }}>
        <Input aria-label="Code from the Pramanyx bot" placeholder="ABCD-2345" value={code} autoComplete="one-time-code"
          onChange={(e) => setCode(e.target.value)} style={{ width: 140 }} />
        <Button type="submit" variant="secondary" size="xs" disabled={busy || !code.trim()}>Link</Button>
        {how && <span className="aug-fs-sm" style={MUTED}>{how}</span>}
      </form>
      {said && <div role="status" className="aug-fs-sm" style={{ padding: "6px 2px 0" }}>{said}</div>}
    </Card>
  );
}
