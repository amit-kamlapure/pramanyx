// @vitest-environment jsdom
/**
 * The schema provider wraps every page and says only which connection is selected; the schema is read by the component
 * that asks for it (2026-11-23). Reading in the provider fetched the connection's whole schema on every page load.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";
import { SchemaProvider, useSchema } from "@/lib/schema-context";

afterEach(() => vi.unstubAllGlobals());

const schemaReads = () => {
  const spy = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify({ tables: [{ name: "orders", columns: [] }] })));
  vi.stubGlobal("fetch", spy);
  return () => spy.mock.calls.map(([url]) => String(url)).filter(u => u.includes("/schema/rich"));
};

function Tables() {
  const { schema, connId } = useSchema();
  return <p>{connId}: {schema ? schema.tables.map(t => t.name).join(",") : "reading"}</p>;
}

describe("the schema provider", () => {
  it("reads nothing for a page that does not ask", async () => {
    const reads = schemaReads();
    render(<Providers><SchemaProvider connId="c1"><p>Discover</p></SchemaProvider></Providers>);
    await new Promise(r => setTimeout(r, 20));
    expect(reads()).toEqual([]);
  });

  it("reads the selected connection's schema for a component that asks", async () => {
    const reads = schemaReads();
    render(<Providers><SchemaProvider connId="c1"><Tables /></SchemaProvider></Providers>);
    expect(await screen.findByText("c1: orders")).toBeInTheDocument();
    await waitFor(() => expect(reads()).toHaveLength(1));
    expect(reads()[0]).toContain("/connections/c1/schema/rich");
  });
});
