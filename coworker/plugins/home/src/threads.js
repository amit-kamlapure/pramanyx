// The platform's conversations this coworker lists (pure, so the tests read them): the group conversations its person
// is in, and their own held in the app. See `client.js` for the pages.

/**
 * CONVERSATIONS WITH OTHERS (group conversations, 2026-11-17): the platform's, where each person is known.
 */
export function withOthers(threads) {
  return (Array.isArray(threads) ? threads : []).filter((t) => t && t.shared);
}

/**
 * ONE RECORD FOR BOTH PLACES (2026-11-20; the user: "One record for all"). The person's own conversations held in the
 * app — the Ask panel beside their work, a Data Canvas — are the platform's record, as this coworker's turns now are too
 * (filed there as `coworker:<session>`). This page lists the app's ones and opens one as the app's own thread, in a
 * frame, as a conversation with others opens: the same answers, and asked on there. The coworker's own are in the list
 * on the left already, so they are not listed twice.
 */
export function inTheApp(threads) {
  return (Array.isArray(threads) ? threads : []).filter((t) => t && !t.shared && !String(t.session_id || "").startsWith("coworker:"));
}
