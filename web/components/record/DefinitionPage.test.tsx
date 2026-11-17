// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DefinitionRoute from "@/app/definitions/[term]/page";

const base = { statement: { text: "Paid in the last 30 days." }, tier: "approved", state: "published", author: "user:ana",
  approved_by: "user:ana", approved_on: "2026-11-17", aliases: ["paying customer"], links: [{ kind: "metric", ref: "active_customers", label: "Active customers" }],
  suggestions: [], versions: [] };
const FINANCE = { ...base, term: "Active customer", domain: "Finance", owner: "user:ana" };
const MARKETING = { ...base, term: "Active customer", domain: "Marketing", owner: "user:bo", tier: "declared", state: "draft",
  statement: { text: "Opened an email in 90 days." }, aliases: [], links: [],
  suggestions: [{ id: "s1", by: "user:cai", at: "2026-11-17", why: "we count clicks", text: "Clicked an email in 90 days." }] };

function serve(me: string, rows: unknown[], posted: { path: string; body: Record<string, unknown> }[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/record/you")) return new Response(JSON.stringify({ principal: me }));
    if (init?.method === "POST") {
      posted.push({ path: path.split("?")[0], body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ...FINANCE, suggested: path === "/record/definitions" && me !== "user:ana" ? { id: "s9" } : null }));
    }
    return new Response(JSON.stringify(rows));
  }));
  return posted;
}

const show = async (domain = "") => {
  const params = Promise.resolve({ term: "Active%20customer" });
  const searchParams = Promise.resolve({ conn: "shop", ...(domain ? { domain } : {}) });
  await act(async () => {
    render(<Suspense fallback="…"><DefinitionRoute params={params} searchParams={searchParams} /></Suspense>);
  });
};

afterEach(() => vi.unstubAllGlobals());

describe("the Definition page (2026-11-17)", () => {
  it("shows a published definition with its domain, other names and what it refers to, and the domains it has", async () => {
    serve("user:ana", [FINANCE, MARKETING]);
    await show("Finance");
    expect(await screen.findByText("Paid in the last 30 days.")).toBeInTheDocument();
    expect(screen.getByTestId("definition-state")).toHaveTextContent("Published");
    expect(screen.getByText("in Finance")).toBeInTheDocument();
    expect(screen.getByTestId("definition-aliases")).toHaveTextContent("Also called paying customer");
    expect(screen.getByRole("link", { name: "metric Active customers" })).toHaveAttribute("href", "/metrics/active_customers?conn=shop");
    expect(screen.getByTestId("definition-domains")).toHaveTextContent("2 domains");
    expect(screen.getByRole("button", { name: "Change it" })).toBeInTheDocument();        // Ana owns it
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  });

  it("offers anyone else a suggested edit, and only its owner accepts one", async () => {
    const posted = serve("user:cai", [FINANCE, MARKETING]);
    await show("Marketing");
    expect(await screen.findByText("Opened an email in 90 days.")).toBeInTheDocument();
    expect(screen.getByTestId("definition-state")).toHaveTextContent("Draft");
    expect(screen.getByTestId("definition-suggestions")).toHaveTextContent("Clicked an email in 90 days.");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();                 // not Cai's to decide
    fireEvent.click(screen.getByRole("button", { name: "Suggest an edit" }));
    fireEvent.change(screen.getByLabelText("What “Active customer” means here"), { target: { value: "Clicked in 60 days." } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest this edit" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions"));
    expect(posted[0].body).toMatchObject({ connection_id: "shop", term: "Active customer", domain: "Marketing", text: "Clicked in 60 days." });
    expect(await screen.findByRole("status")).toHaveTextContent("as a suggested edit");
  });

  it("lets its owner accept a suggestion", async () => {
    const posted = serve("user:bo", [MARKETING]);
    await show("Marketing");
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions/suggestions/decide"));
    expect(posted[0].body).toMatchObject({ suggestion_id: "s1", accept: true, domain: "Marketing" });
  });
});
