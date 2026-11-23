/**
 * Identical reads asked at the same moment share one request (2026-11-23).
 *
 * A cold load asked the API for the same thing more than once at the same moment: two components each reading the
 * workspace's settings or its runs, and in development React runs every effect twice on mount, so every start-up read
 * went out twice. Each one held one of the few connections a browser keeps to a server, and the page's own read
 * queued behind them.
 *
 * So a plain read — a GET to the API, with no body, no abort signal and no option but its headers — that is already on
 * its way is not sent again: the second asker waits for the first's answer and gets its own copy of it. Only while it
 * is on its way: once answered, the next ask goes out afresh, so nothing here is a cache.
 *
 * A write ends every share under way. A read asked after a save must see the save, never an answer that was already on
 * its way before it.
 *
 * Installed OUTERMOST (`app/page.tsx`, after the workspace header), so a read is keyed as its caller asked for it, with
 * the workspace the transport will stamp on it.
 */
import { getApiBase } from "./config";
import { getActiveWorkspace } from "./workspace";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const READ = new Set(["GET", "HEAD"]);

function urlOf(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return null;                                     // a Request carries its own body and signal: never shared
}

/** The key two reads share by, or null for a request that is not a plain read of the API. */
export function shareKey(input: RequestInfo | URL, init: RequestInit | undefined, apiBase: string, workspace: string): string | null {
  const url = urlOf(input);
  if (!url || !url.startsWith(apiBase)) return null;
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;
  if (init && Object.keys(init).some(k => k !== "method" && k !== "headers")) return null;   // a signal, a body, a cache mode
  const headers = new Headers(init?.headers);
  if ((headers.get("accept") ?? "").includes("event-stream")) return null;
  const said = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join("\n");
  return `${workspace}\n${url}\n${said}`;
}

/** `fetch`, with an identical read already on its way shared rather than sent again. */
export function sharingReads(original: Fetch, apiBase: () => string, workspace: () => string): Fetch {
  const onTheirWay = new Map<string, Promise<Response>>();
  return (input, init) => {
    const base = apiBase();
    const key = shareKey(input, init, base, workspace());
    if (!key) {
      const url = urlOf(input) ?? (input as Request).url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.startsWith(base) && !READ.has(method)) onTheirWay.clear();
      return original(input, init);
    }
    let shared = onTheirWay.get(key);
    if (!shared) {
      const sent = original(input, init);
      shared = sent;
      onTheirWay.set(key, sent);
      const settled = () => { if (onTheirWay.get(key) === sent) onTheirWay.delete(key); };
      sent.then(settled, settled);
    }
    // each asker reads its own copy; the answer itself is never read, so a copy can always be made
    return shared.then(r => r.clone());
  };
}

let installed = false;

export function installSharedReads(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.fetch = sharingReads(window.fetch.bind(window), getApiBase, getActiveWorkspace);
}
