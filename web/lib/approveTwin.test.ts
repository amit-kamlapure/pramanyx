/**
 * One measure, one approved definition (2026-10-08). Approving a metric that measures exactly what an
 * approved one does is refused with the other's name (409 same_as_approved); the person is asked, and only
 * a yes approves it anyway.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApproveTwinQuestion, transitionMetric } from "@/lib/api";

const twin = { detail: { reason: "same_as_approved", twin: { name: "return_rate", label: "Return rate" },
  message: "Item Return Rate measures exactly what Return rate measures — the same figure in each of the last 6 months, from the same tables" } };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("approving a second definition of one measure", () => {
  it("asks, and approves it anyway only on a yes", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? respond(409, twin) : respond(200, { metric: {}, audit: {} });
    }));
    const asked: string[] = [];
    setApproveTwinQuestion(m => { asked.push(m); return true; });
    await transitionMetric("item_return_rate", "approve", "thelook");
    expect(asked[0]).toContain("measures exactly what Return rate measures");
    expect(bodies[0].approve_anyway).toBeUndefined();
    expect(bodies[1]).toMatchObject({ action: "approve", connection: "thelook", approve_anyway: true });
  });

  it("a no approves nothing and says why", async () => {
    const calls = vi.fn(async () => respond(409, twin));
    vi.stubGlobal("fetch", calls);
    setApproveTwinQuestion(() => false);
    await expect(transitionMetric("item_return_rate", "approve", "thelook")).rejects.toThrow("measures exactly what Return rate measures");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("any other refusal is said as itself, never asked about", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(409, { detail: "already approved" })));
    const ask = vi.fn(() => true);
    setApproveTwinQuestion(ask);
    await expect(transitionMetric("x", "approve", "thelook")).rejects.toThrow("already approved");
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("approving a metric whose formula does not do what its name says (2026-11-26)", () => {
  const disagree = { detail: { reason: "name_and_formula_disagree", said: ["named daily, but it counts over the whole period asked"],
    message: "Daily Active Users's formula does not do what its name says: named daily, but it counts over the whole period asked. It was written by the Explorer (a model)." } };

  it("asks having said why, and sends that it was read; both refusals in turn are asked about", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? respond(409, disagree) : bodies.length === 2 ? respond(409, twin) : respond(200, { metric: {}, audit: {} });
    }));
    const asked: string[] = [];
    setApproveTwinQuestion(m => { asked.push(m); return true; });
    await transitionMetric("daily_active_users", "approve", "thelook");
    expect(asked[0]).toContain("written by the Explorer (a model)");
    expect(bodies[1]).toMatchObject({ name_read: true });
    expect(bodies[2]).toMatchObject({ name_read: true, approve_anyway: true });
  });
});

