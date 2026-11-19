/** The dashboard's Data tab, as the builder shows it beside the pages (the user, 2026-11-19, of a peer product's editor:
 *  "Data | Summary | +", the data that backs the dashboard on a page of its own). Kept apart from the dashboard's own
 *  drawing, so the builder reads it without the dashboard. */
import { createContext } from "react";

export interface DataTab {
  /** Show the Data view in place of the canvas. */
  show: () => void;
  /** A page asked for from the Data view: the canvas opens on it, once, counted so the same page asked again opens it. */
  page: { name: string; n: number } | null;
}

export const DataTabShown = createContext<DataTab | null>(null);

interface Holder { type: string; props?: unknown; children?: string[] }

/** The dashboard's pages as a reader may open them, in order: a page hidden from readers is drawn only in the builder. */
export function pagesOf(elements: Record<string, Holder | undefined>, building: boolean): { key: string; name: string; label: string; hidden: boolean }[] {
  const holder = Object.values(elements).find(el => el?.type === "Tabs");
  return (holder?.children ?? []).map(key => {
    const props = elements[key]?.props as { name: string; label: string; hidden?: boolean | null };
    return { key, name: props.name, label: props.label, hidden: props.hidden === true };
  }).filter(t => building || !t.hidden);
}
