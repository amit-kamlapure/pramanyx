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
