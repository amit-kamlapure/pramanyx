import { describe, expect, it } from "vitest";

import { GET } from "./route";

const get = (file: string) => GET(new Request("http://x.test/"), { params: Promise.resolve({ file }) });

describe("the map's files", () => {
  it("serves MapLibre's own files with their types", async () => {
    const script = await get("maplibre-gl.mjs");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect((await get("maplibre-gl.css")).headers.get("content-type")).toContain("text/css");
  });

  it("serves nothing a caller names beyond them", async () => {
    for (const file of ["../package.json", "..%2Fpackage.json", "maplibre-gl.d.ts", "constructor", "__proto__"]) expect((await get(file)).status).toBe(404);
  });
});
