/**
 * The study's step 2: when an admin adds a warehouse that keeps a query history, the question of reading it — asked
 * once, and only where it can be answered and has something to read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getOrgAllows: vi.fn(),
  getMyAccess: vi.fn(),
  getQueryHistoryReadiness: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), ...api }));

import { queryHistoryOffer } from "./AddDataPanel";

const READY = { engine: "postgres", ok: true, applies: true, source: "pg_stat_statements", note: "", fix: "",
                can_enable: false, sentence: "Query history: ready" };
const unset = { read_query_history: { allowed: false, set: false } };

describe("the offer to read a warehouse's query history", () => {
  beforeEach(() => {
    api.getOrgAllows.mockResolvedValue(unset);
    api.getMyAccess.mockResolvedValue({ permissions: ["admin.manage_org"] });
    api.getQueryHistoryReadiness.mockResolvedValue(READY);
  });

  it("is made to an admin, while the choice is open, for an engine that keeps a history", async () => {
    expect(await queryHistoryOffer("c1")).toEqual(READY);
  });

  it("is not made once the choice has been made, either way", async () => {
    api.getOrgAllows.mockResolvedValue({ read_query_history: { allowed: false, set: true } });
    expect(await queryHistoryOffer("c1")).toBeNull();
  });

  it("is not made to a person who cannot answer it", async () => {
    api.getMyAccess.mockResolvedValue({ permissions: ["resource.read"] });
    expect(await queryHistoryOffer("c1")).toBeNull();
  });

  it("is not made for an engine with no history to read", async () => {
    api.getQueryHistoryReadiness.mockResolvedValue({ ...READY, applies: false });
    expect(await queryHistoryOffer("c1")).toBeNull();
  });

  it("is made where no one is signed in, the install's one person deciding", async () => {
    api.getMyAccess.mockRejectedValue(new Error("no identity"));
    expect(await queryHistoryOffer("c1")).toEqual(READY);
  });
});
