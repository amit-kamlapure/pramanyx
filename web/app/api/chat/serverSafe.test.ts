/**
 * The chat route runs on the server, so nothing it loads may be a browser module (2026-11-19: the turn's shared code
 * read one value from `lib/api.ts`, which installs browser interceptors from a "use client" module as it loads, and every
 * question answered 500 while every test passed, because the tests run with a window). This walks what the route loads,
 * import by import, type-only imports aside, and refuses any file that opens with "use client".
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const WEB = resolve(__dirname, "../../..");

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? resolve(WEB, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;                                                     // a package
  for (const file of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) {
    if (existsSync(file) && /\.tsx?$/.test(file)) return file;
  }
  return null;
}

/** The modules a file loads when it runs: every import but `import type` and one whose every name is a type. */
function loads(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const [, typeOnly, names, spec] = m;
    if (typeOnly) continue;
    const braced = /^\{([^}]*)\}$/.exec(names.trim());
    if (braced && braced[1].split(",").map(n => n.trim()).filter(Boolean).every(n => n.startsWith("type "))) continue;
    const to = resolveImport(file, spec);
    if (to) out.push(to);
  }
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    const to = resolveImport(file, m[1]);
    if (to) out.push(to);
  }
  return out;
}

function reached(start: string): Map<string, string> {
  const seen = new Map<string, string>([[start, ""]]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const next of loads(file)) {
      if (!seen.has(next)) { seen.set(next, file); queue.push(next); }
    }
  }
  return seen;
}

describe("the chat route on the server", () => {
  it("loads no browser module, however far down the imports", () => {
    const route = resolve(WEB, "app/api/chat/route.ts");
    const all = reached(route);
    const browser = [...all.keys()].filter(f => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    const path = (f: string): string => { const chain = [f]; while (all.get(chain[0])) chain.unshift(all.get(chain[0]) as string); return chain.map(c => c.slice(WEB.length + 1)).join(" → "); };
    expect(browser.map(path)).toEqual([]);
    expect(all.size).toBeGreaterThan(3);                                       // the walk did walk
  });
});
