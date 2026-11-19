/**
 * What the Ask composer offers while a person writes (Stage 1 of the plan, the user, 2026-11-19: "@ for objects, / for
 * commands, ↑↓ for history"). Kept apart from the box that draws it, so what it offers is decided by what was typed alone.
 *
 * - `@word` anywhere offers the connection's objects to mention: its tables and its metrics, by name.
 * - `/word` at the very start offers the composer's commands.
 * - With nothing on offer, ↑ and ↓ walk the questions already asked in the conversation, and back to what was being written.
 */

/** Something the composer can offer: an object to mention, or a command. */
export interface Offer {
  /** What is written in the question when it is chosen (`main.orders`, `gross_revenue`), or the command's name. */
  value: string;
  /** What the list shows. */
  label: string;
  /** A word on what it is: "table", "metric", or what a command does. */
  hint: string;
}

/** What is being offered, and the stretch of the text the choice replaces. */
export interface Assist {
  kind: "mention" | "command";
  query: string;
  start: number;
  end: number;
  offers: Offer[];
}

/** The most a list shows at once: enough to choose from, short enough to read. */
export const MOST_OFFERS = 8;

const MENTION = /(^|\s)@([\w.]*)$/;
const COMMAND = /^\/(\w*)$/;

const matching = (offers: Offer[], query: string): Offer[] => {
  const q = query.toLowerCase();
  const starts = offers.filter(o => o.value.toLowerCase().startsWith(q) || o.label.toLowerCase().startsWith(q));
  const within = offers.filter(o => !starts.includes(o) && (o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)));
  return [...starts, ...within].slice(0, MOST_OFFERS);
};

/** What the text before the caret asks for, if anything: a mention being written, or a command at the start. */
export function assistAt(text: string, caret: number, objects: Offer[], commands: Offer[]): Assist | null {
  const before = text.slice(0, caret);
  const command = COMMAND.exec(before);
  if (command && commands.length) {
    const offers = matching(commands, command[1]);
    return offers.length ? { kind: "command", query: command[1], start: 0, end: caret, offers } : null;
  }
  const mention = MENTION.exec(before);
  if (mention) {
    const start = caret - mention[2].length - 1;
    const offers = matching(objects, mention[2]);
    return offers.length ? { kind: "mention", query: mention[2], start, end: caret, offers } : null;
  }
  return null;
}

/** The text with a mention chosen: `@` and the object's name, then a space to carry on writing. */
export function mentionIn(text: string, assist: Assist, offer: Offer): { text: string; caret: number } {
  const written = `@${offer.value} `;
  const after = text.slice(assist.end).replace(/^\s+/, "");
  return { text: `${text.slice(0, assist.start)}${written}${after}`, caret: assist.start + written.length };
}

/** The text with a command taken out once it is chosen: what was written after it stays. */
export function withoutCommand(text: string, assist: Assist): string {
  return text.slice(assist.end).replace(/^\s+/, "");
}

/**
 * One step through the questions already asked: `at` is where the walk stands (-1, what is being written), `history` the
 * questions oldest first. ↑ goes back, ↓ comes forward, and past the newest it returns to what was being written.
 */
export function historyStep(history: string[], at: number, direction: "back" | "forward"): number {
  if (!history.length) return -1;
  if (direction === "back") return at === -1 ? history.length - 1 : Math.max(0, at - 1);
  if (at === -1) return -1;
  return at + 1 >= history.length ? -1 : at + 1;
}

/** The questions a conversation has asked, oldest first, each once (the latest asking kept). */
export function askedBefore(questions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...questions].reverse()) {
    const t = q.trim();
    if (t && !seen.has(t)) { seen.add(t); out.unshift(t); }
  }
  return out;
}
