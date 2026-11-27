/**
 * The card, DRAWN: the built bundle (`coworker/build.sh` writes lib/client.js) is loaded as the shell's module loader
 * loads it, into a page (jsdom, from web/), and an answer is drawn the way the shell draws a tool's result. Every other
 * test here reads a pure helper; 2026-11-25 showed what that misses (a name never declared threw in the page, and the
 * shell dropped every deep report's card for two days). Skipped — and saying why — when the bundle is not built, is
 * older than its sources, or the web app's modules are not installed.
 *
 *   sh coworker/build.sh && node --test coworker/plugins/answer-card/test/*.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..");
const bundle = join(plugin, "lib", "client.js");
const web = join(plugin, "..", "..", "..", "web");

function whyNot() {
  if (!existsSync(bundle)) return "the bundle is not built (sh coworker/build.sh)";
  const built = statSync(bundle).mtimeMs;
  const stale = readdirSync(join(plugin, "src")).find((f) => statSync(join(plugin, "src", f)).mtimeMs > built);
  if (stale) return `the bundle is older than src/${stale} (sh coworker/build.sh)`;
  try { createRequire(join(web, "package.json")).resolve("jsdom"); } catch { return "the web app's modules are not installed"; }
  return "";
}

/** Draw one tool result as the shell would, and return the card's sections' text, top to bottom. */
async function draw(tool, result, click = []) {
  const need = createRequire(join(web, "package.json"));
  const { JSDOM } = need("jsdom");
  const dom = new JSDOM('<!doctype html><body><div id="row"></div><div data-chat-flow-kind="turn-tail"><div data-pramanyx-answers></div></div></body>',
                        { pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  for (const k of ["window", "document", "navigator", "Node", "MutationObserver", "HTMLElement", "HTMLTextAreaElement", "Event",
                   "CustomEvent", "localStorage", "getComputedStyle", "CSS", "Element", "SVGElement", "DOMParser"]) {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  w.HTMLCanvasElement.prototype.getContext = () => null;          // jsdom draws no canvas; the chart draws as SVG
  const React = need("react"), ReactDOM = need("react-dom"), client = need("react-dom/client");
  const modules = { react: React, "react-dom": ReactDOM, "react/jsx-runtime": need("react/jsx-runtime") };
  let loaded = null;
  w.__ModuleLoader__ = { load: ({ factory }) => { loaded = factory((name) => modules[name] ?? {}); } };
  new Function("window", readFileSync(bundle, "utf8"))(w);
  const views = new Map();
  loaded.apply({ slots: { inject: (_n, make) => make(), register: (spec, View) => { if (spec.key) views.set(spec.key, View); return () => {}; } },
                 inject: () => {} });
  const text = JSON.stringify(result, null, 2);
  const root = client.createRoot(document.getElementById("row"));
  await React.act(async () => {
    root.render(React.createElement(views.get(tool), { phase: "result", toolName: tool, callId: "c1",
      block: { kind: "tool-call", name: tool, args: { question: result.question || "" }, text } }));
  });
  await React.act(async () => { await new Promise((r) => setTimeout(r, 300)); });   // the card finds the end of its turn
  for (const label of click) {
    const button = [...document.querySelectorAll("[data-pramanyx-answers] button")].find((b) => b.textContent.trim().startsWith(label));
    await React.act(async () => { button?.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); });
  }
  const card = document.querySelector("[data-pramanyx-answers]").firstElementChild;
  const sections = card ? [...card.children].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()) : [];
  await React.act(async () => root.unmount());
  return { sections, card };
}

const ENVELOPE = {
  version: 2, question: "Why did returns rise in October?", headline: "Returns rose to **9.2%** in October",
  body: "Mostly in footwear, after the new supplier.", grid: null, chart: null,
  caveats: ["October is partial."], follow_ups: ["Which brands?"],
  figures: [{ label: "Return rate", value: "9.2%", note: "October" }],
  exhibits: [{ claim: "Footwear leads the rise", grid: { columns: ["category", "rate"], rows: [["footwear", 0.12], ["bags", 0.05]], caption: "" },
               chart: { chart_type: "bar", chart_config: {} }, caveats: ["Bags is a new line."] }],
  gaps: "Whether exchanges count.",
  provenance: { investigation_id: "inv7", connection_id: "c1", sql: ["SELECT 1"],
                path: { kind: "diagnose", depth: "deep", engine: "analyst", why: "a why" } },
  error: "",
};

const at = (sections, start) => sections.findIndex((s) => s.startsWith(start));

test("a deep answer is drawn from its envelope, in the card's order", { skip: whyNot() || false }, async () => {
  const report = { headline: "Returns rose to 9.2% in October", closing_summary: "Fix the supplier.", recommendations: ["Audit footwear"],
                   phases: [{ phase_id: "drivers", status: "complete", findings: [{ sql: "SELECT 1" }] }] };
  const { sections, card } = await draw("mcp__pramanyx__deep_analysis", {
    question: ENVELOPE.question, connection: "c1", investigation_id: "inv7", status: "complete", envelope: ENVELOPE, report, report_kind: "ada" });
  assert.ok(card.hasAttribute("data-pramanyx-envelope") && card.hasAttribute("data-pramanyx-deep-report"));
  const order = ["Returns rose to 9.2% in October", "Mostly in footwear", "Return rate9.2%October", "Footwear leads the rise",
                 "Bottom lineFix the supplier.", "Recommended actionsAudit footwear",
                 "CaveatsOctober is partial.Bags is a new line.Not settled: Whether exchanges count.",
                 "How it was answered: A why · the analyst · deep", "Follow-ups · 1"];
  const found = order.map((s) => at(sections, s));
  assert.ok(found.every((i) => i >= 0), `every section is drawn: ${JSON.stringify(sections)}`);
  assert.deepEqual(found, [...found].sort((a, b) => a - b), "in the order the envelope is read");
});

test("a quick answer keeps what its result says beside the envelope, and its source opens to its rows and SQL",
     { skip: whyNot() || false }, async () => {
  const envelope = { ...ENVELOPE, headline: "Most orders are shipped", body: "Shipped leads with **40**.", figures: [], exhibits: [], gaps: "",
                     grid: { columns: ["status", "n"], rows: [["shipped", 40], ["returned", 2]], caption: "" },
                     chart: { chart_type: "auto", chart_config: {} },
                     provenance: { investigation_id: "t1", connection_id: "c1", sql: ["SELECT status, COUNT(*) FROM orders GROUP BY 1"],
                                   path: { kind: "describe", depth: "quick", engine: "quick core" } } };
  const result = { question: "orders by status", connection: "c1", envelope, answer: "Most orders are shipped",
                   sql: "SELECT status, COUNT(*) FROM orders GROUP BY 1", columns: ["status", "n"], rows: [["shipped", 40], ["returned", 2]],
                   row_count: 2, narrative: { narrative: "Shipped leads with **40**.", anomalies: ["Returns are low."] },
                   warning: { issues: ["Counts items, not orders."], kind: "" }, investigation_id: "t1", has_receipt: false };
  const { sections } = await draw("mcp__pramanyx__ask", result, ["1 source"]);
  for (const s of ["Most orders are shipped", "!This may not be right: Counts items, not orders.", "Shipped leads with 40.", "2 rows",
                   "What stands outReturns are low.", "CaveatsOctober is partial.", "How it was answered: A figure · the quick answer · quick"]) {
    assert.ok(sections.some((x) => x.includes(s)), `${s} is drawn: ${JSON.stringify(sections)}`);
  }
  assert.ok(sections.at(-1).includes("SELECT status, COUNT(*) FROM orders GROUP BY 1"), "its source shows the SQL");
  // and the same result from a platform before the envelope is drawn as it was
  const { sections: before, card } = await draw("mcp__pramanyx__ask", { ...result, envelope: undefined });
  assert.ok(!card.hasAttribute("data-pramanyx-envelope"));
  assert.ok(before[0] === "Most orders are shipped" && before.some((x) => x.startsWith("What stands out")));
  assert.ok(!before.some((x) => x.startsWith("How it was answered:")), "with no envelope there is no path to say");
});
