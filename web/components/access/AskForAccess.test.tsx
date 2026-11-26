// @vitest-environment jsdom
/**
 * Ask for access (Discover's C5, 2026-11-26): a refusal that names what was refused offers to ask its maker, with a
 * reason; once asked, it says so instead of offering again.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AskForAccess } from "./AskForAccess";

const ASK = { id: "ar1", thing: "canvas", thing_id: "cv1", name: "Margins", asker: "dan", reason: "Q3", to: ["ana"],
  to_admins: false, status: "pending", why: "", asked_at: "2026-11-26T10:00:00Z", answered_at: null, answered_by: "" };
afterEach(() => vi.unstubAllGlobals());

describe("asking for a thing you were refused", () => {
  it("offers to ask, sends the reason, and then says who was asked", async () => {
    const sent: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).includes("/access-requests/mine")) return new Response(JSON.stringify({ pending: null }));
      return new Response(JSON.stringify({ ...ASK, already: false }), { status: 201 });
    }));
    render(<AskForAccess thing="canvas" id="cv1" />);
    fireEvent.click(await screen.findByTestId("access-ask-open"));
    fireEvent.change(screen.getByLabelText("Why you need it"), { target: { value: "Q3" } });
    fireEvent.click(screen.getByTestId("access-ask-send"));
    expect(await screen.findByTestId("access-asked")).toHaveTextContent("Asked ana — waiting for their answer");
    expect(sent.find((s) => s.url.endsWith("/access-requests"))?.body).toEqual({ thing: "canvas", id: "cv1", reason: "Q3" });
  });

  it("says an ask already made, and asks nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pending: { ...ASK, to: [], to_admins: true } }))));
    render(<AskForAccess thing="sheet" id="s1" />);
    expect(await screen.findByTestId("access-asked")).toHaveTextContent("Asked the admins");
    await waitFor(() => expect(screen.queryByTestId("access-ask-open")).toBeNull());
  });
});
