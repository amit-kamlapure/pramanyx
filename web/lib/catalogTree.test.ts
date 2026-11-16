/**
 * Identical catalog-tree requests under way are one request (2026-11-16): the Catalog asks twice as it opens, and a
 * browser holds a second request for the same address until the first answers — the tree showed after twice its wait.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCatalogTree } from "@/lib/api";

const TREE = { sections: [{ id: "connections", label: "Catalogs", entries: [] }] };

describe("getCatalogTree", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins an identical request under way, and asks again once it has answered", async () => {
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => {
      release = () => resolve(new Response(JSON.stringify(TREE), { status: 200 }));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const first = getCatalogTree("default");
    const second = getCatalogTree("default");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.();
    expect(await first).toEqual(TREE);
    expect(await second).toEqual(TREE);
    const third = getCatalogTree("default");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release?.();
    await third;
  });

  it("does not join a request for another workspace", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TREE), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([getCatalogTree("default"), getCatalogTree("other")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a refused request is not kept: the next one asks again", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getCatalogTree("default")).rejects.toThrow("Failed to fetch catalog tree");
    await expect(getCatalogTree("default")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
