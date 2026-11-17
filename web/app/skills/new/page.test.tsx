// @vitest-environment jsdom
/**
 * Punch list 88: a deep analysis kept as a skill, on its own page beside a coworker conversation. It shows the approved
 * metrics the skill is held to; one that computes an approved metric otherwise is said and cannot be kept; only the
 * button keeps it.
 */
import { act, Suspense } from "react";
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const { default: NewSkillRoute } = await import("./page");

const CANDIDATE = { id: "s1", display_name: "Revenue by region", description: "Revenue by region, last month.", entity: "Order",
  action_type: "aggregate", sql_template: "SELECT region, SUM(sale_price) FROM orders WHERE status = {status}", parameters: [
    { name: "status", display_name: "Status", data_type: "text", required: true, description: "", default_value: null }],
  business_rules_enforced: [], returns: "rows", source_table: "orders", origin: "learned", metrics: ["revenue"] };

afterEach(() => vi.unstubAllGlobals());

function stub(proposal: object, saved: object = { ok: true, id: "s1", metrics: ["revenue"] }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(String(url).includes("/propose") ? proposal : saved));
  }));
  return calls;
}

async function open() {
  await act(async () => {
    render(<Suspense fallback={null}><NewSkillRoute searchParams={Promise.resolve({ conn: "c1", inv: "inv9" })} /></Suspense>);
  });
}

describe("keeping a deep analysis as a skill", () => {
  it("shows what it is held to and keeps it only on the person's click", async () => {
    const calls = stub({ candidate: CANDIDATE, computed_otherwise: [] });
    await open();
    expect(await screen.findByTestId("skill-held-to")).toHaveTextContent("Held to the approved metric revenue.");
    expect(screen.getByText("Its inputs: status.")).toBeInTheDocument();
    expect(calls.filter((c) => c.init?.method === "POST" && !c.url.includes("/propose"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep as a skill" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Kept as the skill “Revenue by region”, held to revenue."));
    const save = calls.find((c) => c.url.includes("/ontology/skills?"))!;
    expect(save.url).toContain("connection_id=c1");
    expect(JSON.parse(String(save.init!.body)).id).toBe("s1");
  });

  it("says a skill that computes an approved metric otherwise cannot be kept", async () => {
    stub({ candidate: { ...CANDIDATE, metrics: [] }, computed_otherwise: ["margin"] });
    await open();
    expect(await screen.findByTestId("skill-computed-otherwise")).toHaveTextContent("It computes margin otherwise than the approved definition");
    expect(screen.getByRole("button", { name: "Keep as a skill" })).toBeDisabled();
    expect(screen.getByTestId("skill-held-to")).toHaveTextContent("It uses no approved metric.");
  });
});
