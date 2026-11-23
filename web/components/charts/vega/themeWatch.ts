/**
 * When the page turns light or dark, every chart is drawn again from the page's colours — one rule for the app's charts
 * (a Data Canvas, the Ask panel, a dashboard) and the coworker's (the user, 2026-11-23, of a coworker chart whose labels
 * stayed in the dark theme's grey on a light page: "when the mode changes (dark/white), the graph text is not visible..
 * make these changes global i.e. across data canvas, ask and coworker.. ideally it should be kind like one engine").
 *
 * A chart's frame — its text, axes and grid — is read from the page when it is drawn (`readVegaTokens`, the coworker's
 * `tokensFor`), so it is right only until the theme turns. Each place said "turned" its own way, or not at all: the app's
 * chart watched `<html data-theme>`, and the coworker's watched nothing, while its shell turns `<body
 * data-ds-dark-theme>`. This watches every one of them, and the system's own setting for a page that follows it.
 *
 * Plain TypeScript with no React: the coworker bundles it from here.
 */

/** The attributes a theme is turned by: the app's on `<html>`, the coworker shell's on `<html>` and `<body>`. */
const ON_ROOT = ["data-theme", "class", "data-ds-theme-source"];
const ON_BODY = ["data-ds-dark-theme", "data-theme", "class"];

/** Call `turned` (once per frame at most) whenever the page turns light or dark. Returns the function that stops it. */
export function watchTheme(turned: () => void): () => void {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return () => {};
  let frame = 0;
  const once = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; turned(); });
  };
  const watch = new MutationObserver(once);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ON_ROOT });
  if (document.body) watch.observe(document.body, { attributes: true, attributeFilter: ON_BODY });
  const system = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  system?.addEventListener?.("change", once);
  return () => {
    watch.disconnect();
    system?.removeEventListener?.("change", once);
    if (frame) window.cancelAnimationFrame(frame);
  };
}
