/**
 * The shell's own reads wait for the page's (2026-11-23).
 *
 * A browser keeps only a few connections to a server, and the built-in browser pane keeps one small set for the app's
 * code and its API together. At load, the rail's counts and the top bar's runs went out in the same moment as the
 * page's own read and its code, and the page queued behind them: Discover's code waited 3.5 s for a connection. What
 * only decorates the frame is asked once the browser is next idle after the first draw, so the page's asks are on
 * their way first; at most `atMost` ms later, whatever the page is doing.
 */
export function whenIdle(run: () => void, atMost = 1500): () => void {
  if (typeof window === "undefined") {
    run();
    return () => {};
  }
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => run(), { timeout: atMost });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(run, 150);
  return () => window.clearTimeout(t);
}
