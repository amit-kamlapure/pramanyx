// @vitest-environment jsdom
/**
 * The Definition page, laid out as a Page (2026-11-23, the reference Page the user showed): its name, Area, owner, synonyms,
 * description, a body under a toolbar, related assets and sources; Cancel / Save as draft / Publish for its owner, a
 * suggested edit for anyone else (2026-11-17), the owner deciding on one. The API is stubbed.
 */
import { Suspense } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import DefinitionRoute from "@/app/definitions/[term]/page";
import { DefinitionView } from "@/components/definitions/DefinitionView";
import { editorOf, measureNothing } from "@/components/ui/richTextTesting";
import { act, change, fireEvent, render, screen, waitFor, within } from "@/lib/testing";

const base = { statement: { text: "## Definition\nPaid in the last 30 days." }, tier: "approved", state: "published", author: "user:ana",
  approved_by: "user:ana", approved_on: "2026-11-17", aliases: ["paying customer"], links: [{ kind: "metric", ref: "active_customers", label: "Active customers" }],
  description: "A customer who pays", sources: [{ kind: "url", ref: "https://wiki.example/active", label: "Finance wiki" }],
  suggestions: [], versions: [] };
const FINANCE = { ...base, term: "Active customer", area: "finance", owner: "user:ana" };
const MARKETING = { ...base, term: "Active customer", area: "marketing", owner: "user:bo", tier: "declared", state: "draft",
  statement: { text: "Opened an email in 90 days." }, aliases: [], links: [], description: "", sources: [],
  suggestions: [{ id: "s1", by: "user:cai", at: "2026-11-17", why: "we count clicks", text: "Clicked an email in 90 days." }] };

const SEARCH = { items: [{ kind: "canvas", id: "d52cdcd4", name: "The Look Analytics", line: "", connection_id: "shop",
  connection_name: "theLook", area: "other", area_how: "", owner: "", updated_at: "", state: "", certification: null,
  href: "/?tab=canvas-workspace&conn=shop&canvas=d52cdcd4", detail: {}, matched: ["its name"] }],
  total: 1, by_meaning: true, withheld: {}, said: [] };

function serve(me: string, rows: unknown[], posted: { path: string; body: Record<string, unknown> }[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/record/you")) return new Response(JSON.stringify({ principal: me }));
    if (path.startsWith("/discover/search")) return new Response(JSON.stringify(SEARCH));
    if (path.startsWith("/rbac/directory")) return new Response(JSON.stringify([{ email: "dee@shop.example", name: "Dee", active: true }]));
    if (path.startsWith("/areas/")) return new Response(JSON.stringify({ placed: { tables: {}, metrics: {}, connection: null }, areas: [
      { id: "finance", name: "Finance", question: "", parent: "", business_owners: [], technical_owners: [], source: "organisation", pack_id: "" },
      { id: "marketing", name: "Marketing", question: "", parent: "", business_owners: [], technical_owners: [], source: "organisation", pack_id: "" }] }));
    if (init?.method === "POST") {
      posted.push({ path: path.split("?")[0], body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ...FINANCE, suggested: path === "/record/definitions" && me === "user:cai" ? { id: "s9" } : null }));
    }
    return new Response(JSON.stringify(rows));
  }));
  return posted;
}

const show = async (area = "") => {
  const params = Promise.resolve({ term: "Active%20customer" });
  const searchParams = Promise.resolve({ conn: "shop", ...(area ? { area } : {}) });
  await act(async () => {
    render(<Suspense fallback="…"><DefinitionRoute params={params} searchParams={searchParams} /></Suspense>);
  });
};

afterEach(() => vi.unstubAllGlobals());
beforeAll(measureNothing);

/** Write the body as typing would land in it (it is written as it reads — `RichBody`). */
async function writeBody(markdown: string) {
  const editor = await editorOf();
  await act(async () => { editor.commands.setContent(markdown, { contentType: "markdown" }); });
}

describe("the Definition page, as a Page", () => {
  it("shows a published definition: its Area, owner, synonyms, description, body, related assets and sources", async () => {
    serve("user:ana", [FINANCE, MARKETING]);
    await show("finance");
    expect(await screen.findByText("Paid in the last 30 days.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Definition" })).toBeInTheDocument();            // its body's own section
    expect(screen.getByTestId("definition-state")).toHaveTextContent("Published");
    expect(within(screen.getByTestId("definition-page")).getAllByText("Finance").length).toBeGreaterThan(0);
    expect(screen.getByText("ana (you)")).toBeInTheDocument();
    expect(screen.getByTestId("definition-aliases")).toHaveTextContent("paying customer");
    expect(screen.getByTestId("definition-description")).toHaveTextContent("A customer who pays");
    expect(screen.getByRole("link", { name: "metric Active customers" })).toHaveAttribute("href", "/metrics/active_customers?conn=shop");
    expect(within(screen.getByTestId("definition-sources")).getByRole("link", { name: "Finance wiki" }))
      .toHaveAttribute("href", "https://wiki.example/active");
    expect(screen.getByTestId("definition-areas")).toHaveTextContent("2 areas");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();                  // Ana owns it
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  });

  it("offers anyone else a suggested edit, and only its owner accepts one", async () => {
    const posted = serve("user:cai", [FINANCE, MARKETING]);
    await show("marketing");
    expect(await screen.findByText("Opened an email in 90 days.")).toBeInTheDocument();
    expect(screen.getByTestId("definition-state")).toHaveTextContent("Draft");
    expect(screen.getByTestId("definition-suggestions")).toHaveTextContent("Clicked an email in 90 days.");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();                 // not Cai's to decide
    fireEvent.click(screen.getByRole("button", { name: "Suggest an edit" }));
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();                // not Cai's to publish
    await writeBody("Clicked in 60 days.");
    fireEvent.click(screen.getByRole("button", { name: "Suggest this edit" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions"));
    expect(posted[0].body).toMatchObject({ connection_id: "shop", term: "Active customer", area: "marketing" });
    expect(String(posted[0].body.text).trim()).toBe("Clicked in 60 days.");
    expect(await screen.findByRole("status")).toHaveTextContent("as a suggested edit");
  });

  it("lets its owner accept a suggestion", async () => {
    const posted = serve("user:bo", [MARKETING]);
    await show("marketing");
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions/suggestions/decide"));
    expect(posted[0].body).toMatchObject({ suggestion_id: "s1", accept: true, area: "marketing" });
  });

  it("lets its owner edit a draft's description and synonyms, and keep it as a draft", async () => {
    const posted = serve("user:bo", [MARKETING]);
    await show("marketing");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Who engages with email" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a synonym" }));
    const word = screen.getByLabelText("A synonym");
    fireEvent.change(word, { target: { value: "engaged" } });
    fireEvent.keyDown(word, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions"));
    expect(posted[0].body).toMatchObject({ description: "Who engages with email", aliases: ["engaged"], area: "marketing" });
    expect(posted.some(p => p.path === "/record/definitions/approve")).toBe(false);
  });

  it("drafts a description with the model at the owner's press, says so, and keeps nothing until it is saved", async () => {
    const posted = serve("user:bo", [MARKETING]);
    await show("marketing");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions/suggest-description"));
    expect(posted[0].body).toMatchObject({ term: "Active customer", area: "marketing", text: "Opened an email in 90 days." });
    await waitFor(() => expect(screen.getByLabelText("Description")).toHaveValue("A customer who pays"));
    expect(screen.getByTestId("description-drafted")).toHaveTextContent("Drafted by the model");
    expect(posted).toHaveLength(1);                                        // nothing kept yet
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "A customer who pays, monthly" } });
    expect(screen.queryByTestId("description-drafted")).toBeNull();        // the person's own words now
  });

  it("lets its owner hand it to another person, and offers anyone else no such door", async () => {
    let posted = serve("user:cai", [FINANCE]);
    await show("finance");
    await screen.findByText(/Published by ana/);
    expect(screen.queryByRole("button", { name: "Hand to…" })).toBeNull();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    posted = serve("user:ana", [{ ...FINANCE, handed: [{ on: "2026-11-20", by: "user:bo", from: "user:bo", to: "user:ana" }] }]);
    await show("finance");
    expect(await screen.findByTestId("definition-handed")).toHaveTextContent("handed on by bo");
    fireEvent.click(await screen.findByRole("button", { name: "Hand to…" }));
    fireEvent.change(screen.getByLabelText("Hand it to"), { target: { value: "dee" } });
    fireEvent.click(screen.getByRole("button", { name: "Hand it on" }));
    await waitFor(() => expect(posted[0]?.path).toBe("/record/definitions/owner"));
    expect(posted[0].body).toMatchObject({ to: "dee", term: "Active customer", area: "finance", connection_id: "shop" });
    expect(await screen.findByText("Handed to dee: they answer for it now")).toBeInTheDocument();
  });
});

describe("a new Definition", () => {
  it("opens on the Page's two sections, asks its name, and publishes in one step: written, then approved", async () => {
    const posted = serve("user:ana", []);
    const onNamed = vi.fn();
    await act(async () => { render(<DefinitionView term="" connection="shop" inApp onNamed={onNamed} />); });
    const body = await screen.findByRole("textbox", { name: "What it means" });
    expect(screen.queryByText("Reading…")).toBeNull();                                      // nothing to read yet
    expect([...body.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Definition", "Business use"]);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();                 // no name, the template alone
    fireEvent.change(screen.getByLabelText("Its name"), { target: { value: "Repeat buyer" } });
    await writeBody("## Definition\n\nOrdered twice or more.\n\n## Business use\n\nLoyalty.");
    change(screen.getByLabelText("Area"), { target: { value: "marketing" } });
    // a related asset, found as Discover finds it
    fireEvent.click(screen.getByRole("button", { name: "Add related asset" }));
    fireEvent.change(screen.getByLabelText("Find a related asset"), { target: { value: "look" } });
    fireEvent.click(await screen.findByText("The Look Analytics", {}, { timeout: 2000 }));
    // a source on the web
    fireEvent.click(screen.getByRole("button", { name: "Add a web address" }));
    fireEvent.change(screen.getByLabelText("Its address"), { target: { value: "https://wiki.example/repeat" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(posted.map(p => p.path)).toEqual(["/record/definitions", "/record/definitions/approve"]));
    expect(String(posted[0].body.text).replace(/\n+/g, "\n").trim()).toBe("## Definition\nOrdered twice or more.\n## Business use\nLoyalty.");
    expect(posted[0].body).toMatchObject({
      term: "Repeat buyer", area: "marketing",
      links: [{ kind: "canvas", ref: "d52cdcd4", label: "The Look Analytics", href: "/?tab=canvas-workspace&conn=shop&canvas=d52cdcd4" }],
      sources: [{ kind: "url", ref: "https://wiki.example/repeat", label: "" }] });
    expect(onNamed).toHaveBeenCalledWith("Repeat buyer", "marketing");
  });

  it("is left unwritten on Cancel", async () => {
    serve("user:ana", []);
    const onCancel = vi.fn();
    await act(async () => { render(<DefinitionView term="" connection="shop" inApp onCancel={onCancel} />); });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
