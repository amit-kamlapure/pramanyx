"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PramanyxMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { fetchCoworkerDoor, mintCoworkerDelegation, startMyCoworker, type CoworkerDoor } from "@/lib/api";

/**
 * The nine dots: the way from the app to the coworker, and the place a person learns there is one.
 *
 * The coworker is a second page of the platform — a chat that works a question through — served beside the app by
 * its own process. The dots are drawn only while one is running: the API is told so by the coworker itself and
 * forgets it two minutes after the last time, so this never offers a way in that leads nowhere. No coworker, no
 * dots, and the top bar is as it was.
 *
 * What is carried across, so the person arrives where they were: the connection in the top bar, light or dark,
 * and this page's own address as the way back. They ride in the address's fragment — the coworker drops a query
 * string on arrival, and a fragment is never sent to a server. The coworker's access rides there too, and so does
 * the person: a short-lived delegation the API mints for whoever is signed in here (`security/delegation.py`), so
 * what the coworker does for them is recorded under them, and reads only what they may read.
 */
export type Carried = { connectionId?: string; theme?: string; back?: string; delegation?: string };

/**
 * The address the dots open: the coworker's own entry page, with the coworker's access and what is carried in the
 * fragment. Not the coworker's address itself — its sign-in is a cookie a browser withholds on an arrival from
 * another site, which the app is, and opened directly it answers "authentication required". The entry page is on
 * the coworker's address and makes the move from there (`coworker/plugins/home`, "the way in from the app").
 * An address that will not parse is returned as it is.
 */
export function coworkerHref(url: string, carried: Carried): string {
  try {
    const at = new URL(url);
    const to = new URL("pramanyx-enter", at);
    const said = new URLSearchParams();
    const access = at.searchParams.get("token");
    if (access) said.set("t", access);
    if (carried.delegation) said.set("d", carried.delegation);
    if (carried.connectionId) said.set("conn", carried.connectionId);
    if (carried.theme) said.set("theme", carried.theme);
    if (carried.back) said.set("back", carried.back);
    to.hash = said.toString();
    return to.toString();
  } catch {
    return url;
  }
}

const row: React.CSSProperties = {
  display: "flex", gap: 10, alignItems: "center", padding: "8px 9px", borderRadius: "var(--r2)",
  color: "var(--t1)", textDecoration: "none",
};
const tile: React.CSSProperties = {
  width: 32, height: 32, flex: "none", borderRadius: "var(--r2)", border: "1px solid var(--b2)", background: "var(--bg-1)",
  display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
};

export function AppSwitcher({ connectionId, theme }: { connectionId?: string; theme?: string }) {
  const [door, setDoor] = useState<CoworkerDoor | null>(null);
  const [open, setOpen] = useState(false);
  // The person, handed to the coworker. Asked for once, when the menu first opens: a page that never opens it mints
  // nothing. No delegation (refused, or the API is older) still opens the coworker — as nobody in particular.
  const [delegation, setDelegation] = useState<string | undefined>(undefined);
  const asked = useRef(false);
  const host = useRef<HTMLDivElement | null>(null);
  // Each person has their own coworker (2026-11-17). Not running yet, it is started on the click and opened when it
  // says where it is — the first start sets up its home, so it takes a minute.
  const [starting, setStarting] = useState<"" | "starting" | "failed">("");
  const [startNote, setStartNote] = useState("");

  const look = useCallback(() => {
    fetchCoworkerDoor().then(setDoor).catch(() => setDoor(null));
  }, []);
  // Looked for when the page opens, when a person comes back to its tab, and every half minute: a coworker
  // started after this page loaded was never offered, because the page had asked once and been told "none".
  useEffect(() => {
    look();
    const again = window.setInterval(look, 30_000);
    const back = () => { if (document.visibilityState === "visible") look(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", look);
    return () => { window.clearInterval(again); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", look); };
  }, [look]);

  // Closed by a click anywhere else and by Escape, like every menu a button opens here.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (host.current && !host.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  if (!(door?.available && door.url) && !door?.can_start) return null;
  const hrefOf = (url: string) => coworkerHref(url, {
    connectionId, theme, delegation, back: typeof window === "undefined" ? undefined : window.location.href,
  });
  const href = door.available && door.url ? hrefOf(door.url) : null;
  const startMine = async () => {
    setStarting("starting"); setStartNote("");
    try {
      const first = await startMyCoworker();
      if (first.available && first.url) { window.location.assign(hrefOf(first.url)); return; }
      if (!first.can_start) { setStarting("failed"); setStartNote(first.reason || "Your coworker could not be started."); return; }
      const until = Date.now() + 180_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2_000));
        const now = await fetchCoworkerDoor().catch(() => null);
        if (now?.available && now.url) { setDoor(now); window.location.assign(hrefOf(now.url)); return; }
      }
      setStarting("failed"); setStartNote("Your coworker did not start within three minutes; its log is in its own folder.");
    } catch (e) {
      setStarting("failed"); setStartNote(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div ref={host} style={{ position: "relative" }}>
      <Button variant="ghost" size="icon-xs" aria-label="Switch to" title="Switch to the coworker" aria-expanded={open} data-testid="app-switcher"
        // Drawn as the top bar's other controls are — a soft fill and full-strength ink, no outline (2026-11-20) — where
        // a bare grey glyph beside the avatar went unseen.
        style={{ width: 26, height: 26, borderRadius: "var(--r2)", background: "var(--bg-hover)", color: "var(--t1)" }}
        // Looked at again as it opens: a coworker that stopped since the page loaded is not offered.
        onClick={() => {
          if (!open) look();
          if (!open && !asked.current) {
            asked.current = true;
            mintCoworkerDelegation().then((d) => setDelegation(d ?? undefined)).catch(() => { asked.current = false; });
          }
          setOpen((was) => !was);
        }}>
        <Icon name="apps" size={16} />
      </Button>
      {open && (
        <div role="menu" aria-label="Switch to" style={{
          position: "absolute", right: 0, top: 30, zIndex: 60, width: 300,
          background: "var(--bg-3)", border: "1px solid var(--b2)", borderRadius: "var(--r2)",
          boxShadow: "var(--shadow-sm)", padding: 8, display: "flex", flexDirection: "column", gap: 2,
        }}>
          <span className="aug-fs-xs" style={{ color: "var(--t3)", padding: "2px 9px 6px" }}>Switch to</span>
          <div role="menuitem" aria-current="page" style={{ ...row, background: "var(--bg-2)" }}>
            <span style={{ ...tile, background: "transparent", border: "none", color: "var(--t1)" }} aria-hidden><PramanyxMark size={22} /></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span className="aug-fs-sm" style={{ fontWeight: 600 }}>Pramanyx</span>
              <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>The platform. You are here.</span>
            </span>
          </div>
          {href ? (
            <a role="menuitem" href={href} className="aug-switch-row" style={row}>
              <span className="aug-fs-chrome" style={tile} aria-hidden>C</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span className="aug-fs-sm" style={{ fontWeight: 600 }}>Coworker</span>
                <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>Your own: ask, and have it worked through.</span>
              </span>
            </a>
          ) : (
            <button type="button" role="menuitem" className="aug-switch-row" data-testid="app-switcher-start"
              disabled={starting === "starting"} onClick={() => { void startMine(); }}
              style={{ ...row, background: "transparent", border: "none", textAlign: "left", cursor: "pointer", font: "inherit" }}>
              <span className="aug-fs-chrome" style={tile} aria-hidden>C</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span className="aug-fs-sm" style={{ fontWeight: 600 }}>Coworker</span>
                <span className="aug-fs-xs" style={{ color: starting === "failed" ? "var(--amb4)" : "var(--t3)" }}>
                  {starting === "starting" ? "Starting your own coworker — a minute the first time…"
                    : starting === "failed" ? startNote
                    : "Your own coworker: started for you when you open it."}
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
