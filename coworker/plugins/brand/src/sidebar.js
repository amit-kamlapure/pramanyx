/**
 * The coworker sidebar's width (the user, 2026-11-25: "Make it 264px"). Apart from the client, so a test can load it.
 *
 *   node --test coworker/plugins/brand/test/
 */
/** The sidebar's width: 264, the narrowest the shell's own range allows (the user, 2026-11-25). */
export const SIDEBAR_PX = 264;
/** Below this the shell folds the sidebar by itself and keeps no width of its own for it. */
const SIDEBAR_FOLDS_BELOW = 1024;

/**
 * The sidebar at {@link SIDEBAR_PX}. The shell starts it at 280 and goes back to 280 each time it is opened again, so
 * it is set once now and again on every reopening — through the shell's own width action, so its edge still drags
 * (264–420) and nothing is drawn over the shell's layout. Its face for plugins names no width, so the action is
 * reached through the face's `panels`; were that gone, the shell's 280 simply stands.
 * @param layout - the shell's `ctx.layout`.
 * @returns undo.
 */
export function narrowTheSidebar(layout, root = typeof document === "undefined" ? null : document.body) {
  const panels = layout?.panels;
  if (typeof panels?.setSidebar !== "function") return () => {};
  panels.setSidebar(SIDEBAR_PX);
  if (!root || typeof MutationObserver === "undefined") return () => {};
  // opened again: the frame's mark of a closed sidebar went away (a record is only made for a change), and the
  // shell has put 280 back
  const watch = new MutationObserver((changes) => {
    if (window.innerWidth < SIDEBAR_FOLDS_BELOW) return;
    if (changes.some((c) => !c.target.hasAttribute("data-sidebar-collapsed"))) panels.setSidebar(SIDEBAR_PX);
  });
  watch.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-sidebar-collapsed"] });
  return () => watch.disconnect();
}
