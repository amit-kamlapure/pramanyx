// @vitest-environment jsdom
/** Definitions, together (2026-11-25): who says a Definition is right, and what people said about it. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DefinitionComments, RightVotes, rightWords, withMention } from "@/components/definitions/DefinitionTalk";

const where = { connection: "c1", term: "Repeat buyer", area: "customers" };
afterEach(() => vi.unstubAllGlobals());

function answering(routes: Record<string, unknown>, sent: { url: string; body?: unknown }[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), { status: key ? 200 : 404 });
  }));
  return sent;
}

describe("who says a Definition is right", () => {
  it("is said in words, none as none", () => {
    expect(rightWords(0)).toBe("No one has said it is right yet");
    expect(rightWords(1)).toBe("1 person says this is right");
    expect(rightWords(4)).toBe("4 people say this is right");
  });

  it("says the count and takes the person's own vote back", async () => {
    const sent = answering({ "/votes?": { right: 2, by: ["ana", "bo"], mine: true },
                             "/vote": { right: 1, by: ["bo"], mine: false } });
    render(<RightVotes {...where} />);
    await waitFor(() => screen.getByText("2 people say this is right"));
    fireEvent.click(screen.getByRole("button", { name: "You said it is right" }));
    await waitFor(() => screen.getByText("1 person says this is right"));
    expect(sent.find((s) => s.url.endsWith("/record/definitions/vote"))?.body)
      .toEqual({ connection_id: "c1", term: "Repeat buyer", area: "customers", right: false });
  });
});

describe("what people said about a Definition", () => {
  it("lists comments, offers Take back only on the person's own, and sends a new one", async () => {
    const sent = answering({ "/comments?": [
      { id: "a1", text: "Does a return count?", by: "user:dee", at: "2026-11-25T08:00:00Z", mentions: [] },
      { id: "a2", text: "Only completed orders.", by: "user:ana", at: "2026-11-25T09:00:00Z", mentions: [] },
    ], "/definitions/comments": { id: "a3" } });
    render(<DefinitionComments {...where} me="user:ana" />);
    await waitFor(() => screen.getByText("Only completed orders."));
    expect(screen.getAllByRole("button", { name: "Take back" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Agreed @dee" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/record/definitions/comments")
      && (s.body as { text: string }).text === "Agreed @dee")).toBe(true));
  });
});

describe("mentioning someone (Discover's P1, 2026-11-26)", () => {
  it("offers the organisation's people as an @ is typed, and puts the one chosen in the comment", async () => {
    const sent = answering({ "/comments?": [], "/people?": [
      { ref: "user:dee@example.com", name: "Dee Rao", email: "dee@example.com", source: "directory" }] });
    render(<DefinitionComments {...where} me="user:ana" />);
    await waitFor(() => screen.getByText("No one has commented yet."));
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Does a return count? @de" } });
    const offered = await screen.findByRole("listbox", { name: "People to mention" });
    expect(sent.some((x) => x.url.includes("/people?q=de"))).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: "Dee Rao · dee@example.com" }));
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("Does a return count? @dee@example.com ");
    await waitFor(() => expect(offered.isConnected).toBe(false));
  });

  it("names a member with no email by the name they sign in with alone", async () => {
    answering({ "/comments?": [], "/people?": [{ ref: "user:amit", name: "amit", email: "", source: "member" }] });
    render(<DefinitionComments {...where} me="user:dee" />);
    await waitFor(() => screen.getByText("No one has commented yet."));
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "@am" } });
    expect(await screen.findByRole("option", { name: "amit" })).toBeTruthy();
  });

  it("replaces only the @ being typed", () => {
    const p = { ref: "user:bo", name: "bo", email: "", source: "named" as const };
    expect(withMention("cc @ana and @b", p)).toBe("cc @ana and @bo ");
    expect(withMention("@", p)).toBe("@bo ");
  });
});
