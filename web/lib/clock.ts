/**
 * The person's clock, on every request to the API (2026-11-17).
 *
 * "Yesterday means day before current date.. based on the users time setting" — one definition for the whole
 * platform (`pramanyx/kernel/clock.py`). The server reads a zone the person set for themselves first; this sends the
 * zone the browser is in, which it falls back to, so "yesterday" asked from here is this person's yesterday and never
 * the server's or UTC's.
 */
export const CLOCK_HEADER = "X-Pramanyx-Clock";

/** The IANA zone this browser is in, or "" when it cannot say. */
export function browserClock(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

let installed = false;

/** Stamp `X-Pramanyx-Clock` on every request to the API base. Idempotent; a caller that set it itself wins. */
export function installClockHeader(apiBase: string): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const zone = browserClock();
  if (!zone) return;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    } catch {
      return original(input, init);
    }
    // Only our own API: a relative URL is same-origin; anything else could be a third party.
    if (!(url.startsWith(apiBase) || url.startsWith("/"))) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(CLOCK_HEADER)) headers.set(CLOCK_HEADER, zone);
    return original(input, { ...init, headers });
  };
}
