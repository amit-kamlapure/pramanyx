// @vitest-environment jsdom
/**
 * Punch list 82: an upload says who reads it, and only its owner is offered Share — to keep it, to share it with
 * people they choose, or with everyone. What is saved is what the owner's door takes.
 */
import { choose, fireEvent, render, screen, waitFor } from "@/lib/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentAbout, DocumentReaders } from "./ShareDocument";
import type { DocumentAccess } from "@/lib/documentAccess";

const PRIVATE: DocumentAccess = { sharing: "chosen", shared_with: [{ kind: "person", id: "ana@example.com" }],
  source: "upload", owner: "ana@example.com", why: "uploaded by ana@example.com; private to them until they share it" };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(answer: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer(String(url), init)));
  }));
  return calls;
}

describe("who reads an uploaded document", () => {
  it("tells its owner only they read it, and shares it with everyone at their word", async () => {
    const calls = stubFetch((url) => (url.includes("/rbac/directory") ? []
      : { doc_id: "d1", access: { sharing: "org", source: "upload", owner: "ana@example.com" } }));
    const onShared = vi.fn();
    render(<DocumentReaders docId="d1" name="Q3 plan.pdf" access={PRIVATE} yours onShared={onShared} />);
    expect(screen.getByTestId("document-readers-words")).toHaveTextContent("Only you can read it");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Everyone in the organisation" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onShared).toHaveBeenCalledWith(expect.objectContaining({ sharing: "org" })));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toContain("/documents/d1/access");
    expect(JSON.parse(String(put.init!.body))).toEqual({ sharing: "org" });
  });

  it("shares with the people the owner chooses, typed or picked", async () => {
    const calls = stubFetch((url) => (url.includes("/rbac/directory")
      ? [{ email: "ben@example.com", name: "Ben", active: true }, { email: "ana@example.com", name: "Ana", active: true }]
      : { access: { ...PRIVATE, shared_with: [...PRIVATE.shared_with!, { kind: "person", id: "ben@example.com" }] } }));
    render(<DocumentReaders docId="d1" name="Q3 plan.pdf" access={PRIVATE} yours onShared={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(await screen.findByRole("radio", { name: "People I choose" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Ben" }));
    expect(screen.queryByRole("checkbox", { name: "Ana" })).toBeNull();          // the owner always reads it
    fireEvent.change(screen.getByLabelText("Emails"), { target: { value: "cy@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init?.method === "PUT")!.init!.body));
    expect(body).toEqual({ sharing: "chosen", people: ["ben@example.com", "cy@example.com"], groups: [] });
  });

  it("offers no Share to someone who is not its owner, and says nothing of a page that is not an upload", () => {
    const { rerender } = render(<DocumentReaders docId="d1" name="x" access={{ ...PRIVATE, sharing: "org" }} yours={false} onShared={() => {}} />);
    expect(screen.getByTestId("document-readers-words")).toHaveTextContent("Shared with everyone by ana@example.com");
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    rerender(<DocumentReaders docId="d1" name="x" access={{ sharing: "chosen", source: "confluence-restrictions" }} yours={false} onShared={() => {}} />);
    expect(screen.queryByTestId("document-readers")).toBeNull();
  });
});

describe("which data an upload is about (2026-11-25)", () => {
  const CONNS = [{ id: "duckdb", name: "DuckDB" }, { id: "thelook", name: "theLook" }];

  it("says it to a reader who may not change it", () => {
    render(<DocumentAbout docId="d1" name="Superstore handbook" connectionId="duckdb" connections={CONNS} maySay={false} onSaid={vi.fn()} />);
    expect(screen.getByTestId("document-about").textContent).toBe("For DuckDB only");
  });

  it("lets its owner or an admin keep it to one connection, through the door", async () => {
    const calls = stubFetch(() => ({ doc_id: "d1", about: { connection_id: "duckdb", by: "user:amit", at: "x" } }));
    const onSaid = vi.fn();
    render(<DocumentAbout docId="d1" name="Superstore handbook" connectionId={null} connections={CONNS} maySay onSaid={onSaid} />);
    await choose(screen.getByLabelText("Which data Superstore handbook is about"), "duckdb");
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith({ connection_id: "duckdb", by: "user:amit", at: "x" }));
    expect(calls[0].url).toContain("/documents/d1/about");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ connection_id: "duckdb" });
  });
});
