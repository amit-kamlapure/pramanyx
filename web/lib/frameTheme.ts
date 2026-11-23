/**
 * A page of the app shown inside another page's panel wears that page's light or dark (the user, 2026-11-23, "Yes, do
 * it here", to making the coworker's side panel follow its theme). The coworker opens the app's own pages beside a
 * conversation — the chart editor, a report, a metric, a sheet — and each took the theme this browser stored for the
 * app, so a light editor could stand beside a dark conversation, and a switch in the coworker left it as it was.
 *
 * The page that holds the panel says its theme twice: in the address, for the first paint (`?theme=`, read before the
 * page paints by the boot script, `lib/themeBoot.ts`), and in a message each time it turns. Either is heard only while
 * the page is inside another (`window.parent !== window`), only from that page, and only as "light" or "dark"; it is
 * worn by this page alone — the person's own setting for the app is not written (`applyTheme` stores nothing).
 */
import { applyTheme } from "@/lib/themeSwitch";

/** The address's word for the holder's theme, and the message that says it turned. */
export const FRAME_THEME_PARAM = "theme";
export const FRAME_THEME_MESSAGE = "pramanyx:theme";

/** `?theme=light` or `dark` in an address's query, as the boot script reads it. */
export const FRAME_THEME_QUERY = /[?&]theme=(light|dark)(?:&|$)/;

/** The theme a framed page's address asks for, or null — and always null for a page that is not inside another. */
export function frameThemeFrom(search: string, framed: boolean): "light" | "dark" | null {
  if (!framed) return null;
  const m = FRAME_THEME_QUERY.exec(search);
  return m ? (m[1] as "light" | "dark") : null;
}

/** Wear the theme the holding page says, each time it says it. Returns the function that stops listening. */
export function followFrameTheme(win: Window = window): () => void {
  if (win.parent === win) return () => {};
  const heard = (e: MessageEvent) => {
    if (e.source !== win.parent) return;
    const said = e.data as { type?: unknown; theme?: unknown } | null;
    if (!said || said.type !== FRAME_THEME_MESSAGE) return;
    if (said.theme === "light" || said.theme === "dark") applyTheme(said.theme, win.document);
  };
  win.addEventListener("message", heard);
  return () => win.removeEventListener("message", heard);
}
