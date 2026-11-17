// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CertificationMark } from "./CertificationMark";

const target = { kind: "table" as const, ref: "orders", connectionId: "shop", schema: "main" };

afterEach(() => vi.unstubAllGlobals());

describe("the organisation's word on an asset (2026-11-17)", () => {
  it("shows a deprecation with who and why, and a deprecation cannot be saved without why", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        sent.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ certification: { securable: "table:shop.main.orders", status: "deprecated",
          why: "use orders_v2", by: "user:ana", at: "2026-11-17T10:00:00Z" } }));
      }
      return new Response(JSON.stringify({ certification: null }));
    }));
    render(<CertificationMark target={target} />);
    fireEvent.click(await screen.findByRole("button", { name: "Certify or deprecate" }));
    fireEvent.click(screen.getByRole("button", { name: "Deprecated" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();             // why is required
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "use orders_v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("certification-chip")).toHaveTextContent("Deprecated"));
    expect(screen.getByTestId("certification-chip")).toHaveAttribute("title", "Deprecated by ana on 2026-11-17: use orders_v2");
    expect(sent[0]).toMatchObject({ kind: "table", ref: "orders", connection_id: "shop", schema: "main", status: "deprecated", why: "use orders_v2" });
  });

  it("says the server's refusal, and asks nothing when the list already read it", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ detail: "only a curator — the organisation's owner or an admin — certifies or deprecates this" }), { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    render(<CertificationMark target={target} initial={{ securable: "x", status: "certified", why: "", by: "user:bo", at: "" }} compact />);
    expect(screen.getByTestId("certification-chip")).toHaveTextContent("Certified");
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only a curator");
  });
});
