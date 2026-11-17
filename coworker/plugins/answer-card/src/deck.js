/**
 * A conversation's answers as one deck (punch list 92, 2026-11-18). The person asks for slides of the conversation; the
 * agent names the answers to `deck_of_answers`, and Pramanyx builds the deck from their stored reports (`GET
 * /exports/answers`) — never from slides the model made. What the tool returned is read here into what the step shows:
 * the deck's title, its answers in order, the ones that could not be read, and the download through this page's relay.
 */
const DOWNLOAD = /^\/exports\/answers\?ids=[^#\s]+$/;

/** The step's reading of a `deck_of_answers` result: `{ title, answers, missing, href }`, or `{ failed: why }`. */
export function deckOf(text) {
  let got = null;
  try { got = JSON.parse(String(text || "")); } catch { got = null; }
  const deck = got && typeof got === "object" ? got.deck : null;
  const missing = Array.isArray(got?.missing) ? got.missing.map(String) : [];
  if (!deck || typeof deck !== "object") return { failed: String(got?.why || "The platform did not make it."), missing };
  const download = String(deck.download || "");
  if (!DOWNLOAD.test(download)) return { failed: "The platform did not say where to download it.", missing };
  const answers = (Array.isArray(deck.answers) ? deck.answers : [])
    .map((a) => ({ id: String(a?.id || ""), question: String(a?.question || "") })).filter((a) => a.id);
  return { title: String(deck.title || ""), answers, missing, href: `/pramanyx${download}` };
}
