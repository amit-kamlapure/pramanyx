/**
 * What a drafted change would do to a dashboard, line by line, for the person to allow or skip. Read from what the platform
 * staged: the pieces it adds or changes, and the pieces it takes off.
 */
export interface ChangeLine { verb: "Add" | "Change" | "Remove"; title: string }
export interface ChangeCard { asks: string; did: string; lines: ChangeLine[] }

interface Placed { title?: string; change?: string }
interface Section extends Placed { cards?: Placed[] }
interface Tab { tab?: string; change?: string; sections?: Section[] }
interface Detail { mode?: string; to?: string[]; outline?: Tab[]; taken_off?: { title?: string; from?: string }[] }

const VERB: Record<string, ChangeLine["verb"]> = { added: "Add", changed: "Change" };
const count = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

export function changeCardOf(detail: Record<string, unknown> | null | undefined): ChangeCard {
  const d = (detail ?? {}) as Detail;
  if (d.mode === "publish") {
    const to = (d.to ?? []).join(", ");
    return { asks: `Publish to ${to}?`, did: `Published to ${to}`, lines: [] };
  }
  const lines: ChangeLine[] = [];
  for (const tab of d.outline ?? []) {
    if (tab.change === "added" && tab.tab) lines.push({ verb: "Add", title: `Tab: ${tab.tab}` });
    for (const section of tab.sections ?? []) {
      // A section "changes" whenever a card in it does, so only a new section is its own line.
      if (section.change === "added" && section.title) lines.push({ verb: "Add", title: `Section: ${section.title}` });
      for (const card of section.cards ?? []) {
        const verb = VERB[card.change ?? ""];
        if (verb && card.title) lines.push({ verb, title: card.title });
      }
    }
  }
  for (const off of d.taken_off ?? []) if (off.title) lines.push({ verb: "Remove", title: off.title });
  if (!lines.length) lines.push({ verb: "Change", title: "The dashboard's arrangement" });
  return { asks: `Apply ${count(lines.length)}?`, did: `Applied ${count(lines.length)}`, lines };
}
