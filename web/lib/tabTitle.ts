/**
 * What a browser tab says: what is open, and nothing else (the user, 2026-11-23, of the app's tab beside the coworker's —
 * "we need to be mindful of what appears as tab text", and of the choices put to them: "'Whats Open' only.. I will add a
 * new logo to Coworker later which make the distinction very clear"). Until then every tab of the app said "Pramanyx —
 * Autonomous Intelligence Platform", whatever was open.
 *
 * What is open is read from what the page already says it shows — the subject the Ask panel answers about
 * (`usePageSubject`, `lib/askSubject.ts`): a dashboard's title, a sheet's, a table's, a query's. A Data Canvas, which
 * says no subject, names itself; otherwise the page's own name from the rail (`lib/navDestinations.ts`). The coworker
 * names its tabs by the same rule (`coworker/plugins/brand/src/tab.js`).
 */
import type { AskSubject } from "@/lib/askSubject";
import { NAV_DESTINATIONS } from "@/lib/navDestinations";

/** Pages the rail does not list by these ids, by the name they are known by. */
const PAGES: Record<string, string> = {
  chat: "Ask", "canvas-workspace": "Data Canvas", query: "SQL Editor", data: "Data", settings: "Settings",
  operations: "Operations", agents: "Agents", fleet: "Agent runs", record: "Record",
};

/** A page's name from its id: the rail's word for it, else the name it is known by, else "Pramanyx". */
export function pageName(section: string): string {
  for (const destination of NAV_DESTINATIONS) {
    const found = destination.sections.find((s) => s.id === section);
    if (found) return found.label;
  }
  return PAGES[section] ?? "Pramanyx";
}

/** The name of the thing a page shows, when it shows one thing. */
export function subjectName(subject: AskSubject | null): string {
  if (!subject) return "";
  if (subject.kind === "dashboard" || subject.kind === "sheet") return subject.title;
  if (subject.kind === "query") return subject.title;
  if (subject.kind === "table") return subject.table.split(".").pop() ?? subject.table;
  return "";
}

/** The tab's words: the open thing's name, or the open canvas's, or the page's. */
export function tabTitle(section: string, onPage: AskSubject | null, canvasName?: string | null): string {
  return subjectName(onPage).trim() || (canvasName ?? "").trim() || pageName(section);
}
