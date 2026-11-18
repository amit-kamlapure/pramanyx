/**
 * The host half: what the coworker's page shows before any plugin has loaded — while it opens, and when it could not.
 *
 * The shell draws that screen itself, before a plugin's browser half can run: a card with "HARNESS", a spinner and
 * "Loading plugins…", and on a failure "Failed to load plugins" over the raw error (the user, 2026-11-18: "This should
 * be well designed with Pramanyx logo and subtler message.. also on the loading part if it takes time"). The shell lets
 * a host plugin add rows to the page's head (`webserver/index-inject`), and two do it here:
 *
 *   - a style, scoped to the shell's boot card (`[data-dsh-boot]`): Pramanyx's ground, greys, type and accent;
 *   - a small script that dresses the card as the shell builds it: the mark and the name in place of "HARNESS";
 *     "Opening your coworker…" in place of "Loading plugins…", a quieter line if it takes a while and one that says to
 *     reload if it takes too long; and on a failure, "The coworker couldn't open" with Reload, the raw error folded
 *     under Details for whoever fixes it.
 *
 * Matched by the part of the class name the shell writes by hand (`_wordmark_`, `_hint_`, `_failed_`…); if that
 * changes, the shell's own screen simply shows again. Nothing here runs once the page has opened.
 */
import { readFileSync } from "node:fs";

const MARK = `data:image/png;base64,${readFileSync(new URL("../assets/mark.png", import.meta.url)).toString("base64")}`;

/** What the card says, as the coworker opens or fails to. */
export const WORDS = {
  opening: "Opening your coworker…",
  slow: "Still opening. After a restart this takes a little longer.",
  stuck: "This is taking longer than it should. If it stays here, reload the page.",
  failed: "The coworker couldn't open",
  failedWhy: "Reload to try again. If it keeps happening, the details say what failed, for whoever fixes it.",
  reload: "Reload",
  details: "Details",
};
/** When the quieter lines come, in milliseconds after the card appears. */
export const SLOW_AFTER = 6000;
export const STUCK_AFTER = 20000;

/** The card in the app's look: its dark ground and greys (as `src/client.js` sets them), the accent, Source Sans 3. */
export const STYLE = `
[data-dsh-boot] {
  --dsw-alias-brand-primary: #2b7fa3;
  font-family: "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
body[data-ds-dark-theme] [data-dsh-boot] {
  --dsw-alias-bg-base: #111113;
  --dsw-alias-label-primary: #edeef0;
  --dsw-alias-label-secondary: #b0b4ba;
  --dsw-alias-label-tertiary: #8b9099;
  --dsw-alias-border-l2: rgb(255 255 255 / 10%);
  --dsw-alias-brand-primary: #46a0c4;
}
[data-dsh-boot] [class*="_card_"] { gap: 18px; }
[data-dsh-boot] [data-pramanyx-name] {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  letter-spacing: 0; font-size: 15px; line-height: 20px; font-weight: 600;
}
[data-dsh-boot] [data-pramanyx-mark] {
  display: inline-block; width: 36px; height: 36px; background: currentColor;
  -webkit-mask: url("${MARK}") center / contain no-repeat; mask: url("${MARK}") center / contain no-repeat;
}
[data-dsh-boot] [class*="_hint_"] { font-size: 13px; line-height: 19px; text-align: center; max-width: 320px; }
[data-dsh-boot] [data-pramanyx-later] {
  display: block; margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #8b9099);
}
[data-dsh-boot] [class*="_failed_"] { max-width: 380px; align-items: center; text-align: center; gap: 10px; }
[data-dsh-boot] [class*="_failedTitle_"] { font-size: 15px; }
[data-dsh-boot] [data-pramanyx-why] { font-size: 13px; line-height: 19px; color: var(--dsw-alias-label-secondary, #b0b4ba); }
[data-dsh-boot] [data-pramanyx-doors] { display: flex; gap: 8px; justify-content: center; margin-top: 4px; }
[data-dsh-boot] [data-pramanyx-doors] button {
  font: inherit; font-size: 13px; height: 30px; padding: 0 12px; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-primary, #edeef0);
  border: 1px solid var(--dsw-alias-border-l2, rgb(255 255 255 / 10%));
}
[data-dsh-boot] [data-pramanyx-doors] button[data-primary] {
  border-color: var(--dsw-alias-brand-primary, #46a0c4); color: var(--dsw-alias-brand-primary, #46a0c4);
}
[data-dsh-boot] [data-pramanyx-details] {
  display: none; width: 100%; box-sizing: border-box; text-align: left; margin-top: 6px; padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(255 255 255 / 10%)); border-radius: 6px;
}
[data-dsh-boot] [data-pramanyx-details][data-open] { display: block; }
[data-dsh-boot] [data-pramanyx-details] [class*="_failedItem_"] { font-size: 11.5px; }
`;

/** The script that dresses the card. Classic, and run before the shell's own module, so it sees the card appear. */
export const SCRIPT = `(function () {
  var W = ${JSON.stringify(WORDS)};
  var slowAfter = ${SLOW_AFTER}, stuckAfter = ${STUCK_AFTER};
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  function dress(boot) {
    var name = boot.querySelector('[class*="_wordmark_"]');
    if (name && !name.hasAttribute("data-pramanyx-name")) {
      name.setAttribute("data-pramanyx-name", "");
      name.textContent = "";
      name.append(el("span", { "data-pramanyx-mark": "", role: "img", "aria-label": "Pramanyx" }), el("span", {}, "Pramanyx"));
    }
    var hint = boot.querySelector('[class*="_hint_"]');
    if (hint && !hint.hasAttribute("data-pramanyx-hint")) {
      hint.setAttribute("data-pramanyx-hint", "");
      hint.setAttribute("role", "status");
      hint.textContent = W.opening;
      var later = el("span", { "data-pramanyx-later": "" });
      setTimeout(function () { if (hint.isConnected) { later.textContent = W.slow; hint.append(later); } }, slowAfter);
      setTimeout(function () { if (hint.isConnected) later.textContent = W.stuck; }, stuckAfter);
    }
    var failed = boot.querySelector('[class*="_failed_"]');
    if (failed && !failed.hasAttribute("data-pramanyx-failed")) {
      failed.setAttribute("data-pramanyx-failed", "");
      failed.setAttribute("role", "alert");
      var title = failed.querySelector('[class*="_failedTitle_"]');
      if (title) title.textContent = W.failed;
      var details = el("div", { "data-pramanyx-details": "", id: "pramanyx-boot-details" });
      [].slice.call(failed.querySelectorAll('[class*="_failedItem_"]')).forEach(function (item) { details.append(item); });
      var reload = el("button", { type: "button", "data-primary": "" }, W.reload);
      reload.addEventListener("click", function () { location.reload(); });
      var more = el("button", { type: "button", "aria-expanded": "false", "aria-controls": "pramanyx-boot-details" }, W.details);
      more.addEventListener("click", function () {
        var open = !details.hasAttribute("data-open");
        if (open) details.setAttribute("data-open", ""); else details.removeAttribute("data-open");
        more.setAttribute("aria-expanded", String(open));
      });
      var doors = el("div", { "data-pramanyx-doors": "" });
      doors.append(reload, more);
      failed.append(el("div", { "data-pramanyx-why": "" }, W.failedWhy), doors, details);
    }
  }
  var seen = false;
  var watch = new MutationObserver(function () {
    var boot = document.querySelector("[data-dsh-boot]");
    if (boot) { seen = true; dress(boot); }
    else if (seen) watch.disconnect();          // the page has opened: nothing more to dress
  });
  watch.observe(document.documentElement, { childList: true, subtree: true });
  window.pramanyxBootDress = dress;             // what a check of this screen calls on a card it builds
})();`;

/** The rows the page's head takes, before the shell's own scripts. */
export function bootRows() {
  return [{ kind: "style", text: STYLE }, { kind: "script", placement: "head", text: SCRIPT }];
}

export function apply(ctx) {
  ctx.on("webserver/index-inject", (table) => { table.push(...bootRows()); });
}
