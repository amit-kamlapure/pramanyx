// A CONVERSATION THAT CANNOT GET STUCK (the user, 2026-11-20: "Make sure that conversations do not get stuck.. make
// provision for it"). Seen that day: a "/compact" run in an empty conversation on 18 Nov left one line in it. The shell
// then disagreed with itself about that conversation: its list counted it blank (no messages), so every load and every
// "New conversation" reopened it as the connection's blank one; its page counted the line as content, so it never drew
// the first screen. The coworker opened on a near-empty chat ("compact · No compactable history yet.") for two days.
//
// The rule, pure so the tests read it: a conversation is stuck when, read once as it opens and has finished loading,
// the shell lists it as blank but draws it as begun. Such a conversation holds no message by the shell's own account.
// It is archived (the shell's own Archive: kept, never deleted) and a fresh one is opened in the same place. The reading
// is taken once, as the conversation opens, and never again: a conversation a person starts writing in is never read
// as stuck, however the shell's two accounts race while the first message goes out.

/** The page's phase while it loads; any other is settled. */
export const SETTLING = "settling";

/** Whether an opened conversation is stuck: the shell lists it as blank, and its page, settled, draws it as begun. */
export function isStuck(summary, phase) {
  return Boolean(summary) && summary.blank === true && phase === "active";
}

/** The workspace (one per connection) a conversation is filed in, or undefined. */
export function workspaceOf(items, sessionId) {
  const found = (Array.isArray(items) ? items : []).find((w) => Array.isArray(w?.sessionIds) && w.sessionIds.includes(sessionId));
  return found?.workspaceId;
}

/**
 * Read an opened conversation once it has settled, and retire it if it is stuck. `read()` gives `{ summary, phase }`
 * now; `retire(id)` archives it and opens a fresh one. Gives up after `tries` readings that are still settling. Each
 * conversation is decided once per page (`decided`), so a retired one is never retired twice and a good one is never
 * read again.
 */
export async function unstick(sessionId, { read, retire, decided, wait = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 24, every = 250 }) {
  if (!sessionId || decided.has(sessionId)) return "decided";
  for (let i = 0; i < tries; i += 1) {
    const { summary, phase } = read();
    if (phase && phase !== SETTLING && summary) {
      decided.add(sessionId);
      if (!isStuck(summary, phase)) return "fine";
      await retire(sessionId);
      return "retired";
    }
    await wait(every);
  }
  return "unread";
}
