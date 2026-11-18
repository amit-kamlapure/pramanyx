// A schedule's card reads where the schedule stands each time it is drawn; this says when it reads it again while it
// stays on the page. Kept apart from the card so it is tested without a page.

/**
 * When to read a schedule again while its card is on the page (2026-11-18; the user: "Make sure that conversations
 * load without the user needing to refresh the page"): a little after its next run is due — and again every 20
 * seconds while that run has not been recorded, for ten minutes — and while a run's answer is still being worked
 * out. Null when nothing is coming: an ended, switched-off or removed schedule, or one whose next run is far off
 * and not yet due. Its time is in milliseconds from `at`.
 */
export function readAgainIn(now, at = Date.now()) {
  if (!now) return null;
  const runs = Array.isArray(now.runs) ? now.runs : [];
  if (runs.some((run) => (run.steps ?? []).some((step) => step.answering))) return 20_000;   // a once-only one has ended
  if (now.state === "ended" || now.state === "off") return null;
  const next = Date.parse(String(now.next_run || ""));
  if (!Number.isFinite(next)) return null;
  if (at - next > 10 * 60_000) return null;            // long past: the platform did not run it; nothing to wait for
  return Math.min(Math.max(20_000, next - at + 15_000), 2 ** 31 - 1);
}

/** How long until `next`, in the fewest words: "in 28 min", "in 2 h 5 min", "in 3 days", "now". "" for no time. */
export function untilWords(next, at = Date.now()) {
  const due = Date.parse(String(next || ""));
  if (!Number.isFinite(due)) return "";
  const minutes = Math.round((due - at) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

const STEP_SAYS = {
  investigate: "asks the question", synthesize: "writes it up", metric_value: "reads the metric",
  trusted_query: "runs the trusted query", expectations: "checks the table's expectations",
  subchain: "runs another automation", kinetic_action: "takes the declared action",
};
const SENDS = { email: "emails it", slack_post: "posts it to Slack", notify: "sends a notification" };

/** What happens when it runs, in one sentence — or what will not, for one that is switched off or has ended. */
export function whatHappens(now) {
  if (!now) return "";
  if (now.state === "ended") return "";
  if (now.state === "off") return "Switched off: it does not run until it is switched on again.";
  const steps = Array.isArray(now.steps) ? now.steps : [];
  const does = steps.filter((kind) => STEP_SAYS[kind]).map((kind) => STEP_SAYS[kind]);
  const sends = steps.filter((kind) => SENDS[kind]).map((kind) => SENDS[kind]);
  const first = does.length ? `Each run ${does.join(", then ")}` : "Each run does its steps";
  return `${first}, and what it finds shows here${sends.length ? `; it also ${sends.join(" and ")}` : ""}.`;
}

/** Where the schedule stands, in a few words, for the card's status line. */
export function statusWords(now, at = Date.now()) {
  if (now === null) return "Removed";
  if (!now) return "";
  if (now.state === "ended") return now.last_run_at ? "Ended · it ran its last run" : "Ended";
  if (now.state === "off") return "Switched off";
  const next = untilWords(now.next_run, at);
  if (now.state === "muted") return next ? `Muted · first run ${next}` : "Muted";
  return next ? `Next run ${next}` : "On";
}
