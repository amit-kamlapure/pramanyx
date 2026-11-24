// 2026-11-25: a deep report's card called `said`, a name its file never declared. The bundle builds without a word
// about it, so every deep report with a summary threw in the page, and the shell dropped the card — for two days,
// unseen, because no test draws a card. Every browser source of every coworker plugin is read here for a name it
// uses and never declares: what the page provides (its globals), and `require`, which the shell's module loader
// hands each bundle, are the only names a plugin may use without declaring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugins = join(here, "..", "..");
const web = join(plugins, "..", "..", "web");

/** The page's own names: what any JavaScript has, what a browser adds that these sources use, and the loader's. */
const PAGE = ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "screen",
  "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia", "devicePixelRatio",
  "innerWidth", "innerHeight", "alert", "confirm", "ResizeObserver", "MutationObserver", "IntersectionObserver",
  "Element", "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLCanvasElement", "SVGElement", "Node",
  "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "XMLSerializer", "FileReader", "Image",
  "Blob", "File", "FormData", "Worker", "self", "CSS", "ClipboardItem", "DataTransfer", "require"];

function sources() {
  const out = [];
  for (const plugin of readdirSync(plugins)) {
    let files = [];
    try { files = readdirSync(join(plugins, plugin, "src")).filter((f) => f.endsWith(".js")); } catch { continue; }
    for (const f of files) out.push(join(plugin, "src", f));
  }
  return out;
}

test("no coworker plugin uses a name it never declares", (t) => {
  let Linter;
  try { ({ Linter } = createRequire(join(web, "package.json"))("eslint")); } catch {
    t.skip("the web app's modules are not installed (npm install in web/)");
    return;
  }
  const files = sources();
  assert.ok(files.length >= 5, `the plugins' sources were found (${files.length})`);
  const globals = Object.fromEntries([...Object.getOwnPropertyNames(globalThis), ...PAGE].map((n) => [n, "readonly"]));
  const linter = new Linter({ configType: "flat" });
  const found = files.flatMap((f) => linter.verify(readFileSync(join(plugins, f), "utf8"), [{
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals }, rules: { "no-undef": "error" },
  }]).map((m) => `${f}:${m.line} ${m.message}`));
  assert.deepEqual(found, []);
});
