// @vitest-environment jsdom
/**
 * Review (Phase 3, 2026-11-17): the list leads; each row says what it is, how busy, its area and who it is for, and
 * opens the page it is decided on; an area narrows the list; a source not read is said; an empty list says nothing
 * waits.
 */
import { change, fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Review } from "@/lib/review";

const readReview = vi.fn();
vi.mock("@/lib/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/review")>()),
  readReview: (...a: unknown[]) => readReview(...a),
}));

const { ReviewQueue } = await import("./ReviewQueue");

const REVIEW: Review = {
  connection_id: "c1", total: 3, unplaced: 1,
  by_kind: { gap: 1, candidate: 1, conflict: 1 },
  sources: { framing_miss: 1, definitions: 1, rival_meanings: 1 }, unread: ["import"],
  areas: [{ id: "finance", name: "Finance", owners: ["user:ana"], waiting: 2 },
          { id: "marketing", name: "Marketing", owners: [], waiting: 1 }],
  items: [
    { id: "framing_miss:a", source: "framing_miss", kind: "gap", title: "net sales by store", detail: "Framed on no definition.",
      area: "", count: 4, complaints: 0, at: "2026-11-16", owners: [],
      resolve: { href: "/?tab=semantic&semtab=definitions&conn=c1", action: "Add the words it used" } },
    { id: "definition_draft:b", source: "definition_draft", kind: "candidate", title: "“Big city”, a draft",
      detail: "Drafted by the coworker.", area: "finance", count: null, complaints: 0, at: "2026-11-17",
      owners: ["user:ana"], resolve: { href: "/definitions/Big%20city?conn=c1", action: "Publish it, or change it" } },
    { id: "divergence:c", source: "divergence", kind: "conflict", title: "Answered 2 ways: revenue last month",
      detail: "", area: "finance,marketing", count: 3, complaints: 0, at: "", owners: ["user:ana"],
      resolve: { href: null, action: "Settle it by approving one answer as a trusted query" } },
  ],
};

beforeEach(() => {
  readReview.mockReset();
  readReview.mockResolvedValue(REVIEW);
});

describe("Review", () => {
  it("leads with the list: what each row is, how busy, its area, who it is for, and where it is decided", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<ReviewQueue connId="c1" />);
    expect(await screen.findByTestId("review-summary")).toHaveTextContent("3 wait: 1 gap, 1 to decide, 1 conflict · 1 in no area");
    const gap = screen.getByTestId("review-row-framing_miss");
    expect(gap).toHaveTextContent("Gap");
    expect(gap).toHaveTextContent("asked 4 times · No area: for whoever curates this connection");
    const draft = screen.getByTestId("review-row-definition_draft");
    expect(draft).toHaveTextContent("Finance · For user:ana");
    fireEvent.click(screen.getByRole("button", { name: "Publish it, or change it" }));
    expect(assign).toHaveBeenCalledWith("/definitions/Big%20city?conn=c1");
    expect(screen.getByTestId("review-row-divergence")).toHaveTextContent("Finance · Marketing");
    expect(screen.getByTestId("review-row-divergence")).toHaveTextContent("no page for it yet");
    expect(screen.getByTestId("review-unread")).toHaveTextContent("Not read: imports.");
    vi.unstubAllGlobals();
  });

  it("narrows to one area", async () => {
    render(<ReviewQueue connId="c1" />);
    const pick = await screen.findByLabelText("Area");
    change(pick, { target: { value: "finance" } });
    await waitFor(() => expect(readReview).toHaveBeenLastCalledWith("c1", "finance"));
  });

  it("says nothing waits", async () => {
    readReview.mockResolvedValue({ ...REVIEW, items: [], total: 0, unplaced: 0, unread: [],
                                    by_kind: { gap: 0, candidate: 0, conflict: 0 } });
    render(<ReviewQueue connId="c1" />);
    expect(await screen.findByText("Nothing waits on anyone for this connection's knowledge.")).toBeTruthy();
    expect(screen.getByTestId("review-summary")).toHaveTextContent("Nothing waits");
  });
});
