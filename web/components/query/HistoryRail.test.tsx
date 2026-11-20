// @vitest-environment jsdom
/**
 * The SQL editor's history rail lists what the person ran — their statement, not the row cap's
 * `SELECT * FROM (…) __q LIMIT n` the run wrapped it in, which is what the audit row holds. The audit read is stubbed;
 * the assertions are about what a row says and what a click hands back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRecord } from "@/lib/api";
import { fireEvent, render, screen } from "@/lib/testing";

const api = vi.hoisted(() => ({ getQueryHistory: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { HistoryRail } from "./HistoryRail";

const run = (id: string, sql: string): AuditRecord => ({
  id, ts: new Date(Date.now() - 3 * 3600_000).toISOString(), connection_id: "8233e4fd",
  hypothesis_id: "query_workbench", sql_digest: sql, sql_full: sql, verdict: "safe", row_count: 5, duration_ms: 768.86,
  error: null,
});

beforeEach(() => { api.getQueryHistory.mockReset(); });

describe("the history rail", () => {
  it("shows and reopens the statement the person wrote, not the run's __q wrapper", async () => {
    api.getQueryHistory.mockResolvedValue([
      run("a", "SELECT * FROM (SELECT country, COUNT(*) FROM users GROUP BY 1) __q LIMIT 501"),
    ]);
    const onRestore = vi.fn();
    render(<HistoryRail connId="8233e4fd" refreshKey={0} onRestore={onRestore} />);
    const row = await screen.findByText("SELECT country, COUNT(*) FROM users GROUP BY 1");
    expect(screen.queryByText(/__q/)).toBeNull();
    fireEvent.click(row);
    expect(onRestore).toHaveBeenCalledWith("SELECT country, COUNT(*) FROM users GROUP BY 1");
  });

  // "+ → Open existing" is gone (the user, 2026-11-20); its search is here, over the runs and the saved queries.
  it("searches the runs by what they said and the saved queries by name or SQL, and opens either", async () => {
    api.getQueryHistory.mockResolvedValue([run("a", "SELECT state FROM orders"), run("b", "SELECT city FROM customers")]);
    const onRestore = vi.fn();
    const onOpenSaved = vi.fn();
    const saved = [
      { id: "q1", connection_id: "8233e4fd", name: "Orders by state", sql: "SELECT 1", spec: {}, created_at: "", updated_at: "" },
      { id: "q2", connection_id: "8233e4fd", name: "Revenue", sql: "SELECT sum(x) FROM payments", spec: {}, created_at: "", updated_at: "" },
    ];
    render(<HistoryRail connId="8233e4fd" refreshKey={0} onRestore={onRestore} saved={saved} onOpenSaved={onOpenSaved} />);
    await screen.findByText("SELECT city FROM customers");
    expect(screen.queryByTestId("history-saved-hits")).toBeNull();            // no search: the runs, as before
    fireEvent.change(screen.getByTestId("history-search"), { target: { value: "orders" } });
    expect(screen.getByTestId("history-saved-hits")).toHaveTextContent("Orders by state");
    expect(screen.queryByText("Revenue")).toBeNull();
    expect(screen.queryByText("SELECT city FROM customers")).toBeNull();
    fireEvent.click(screen.getByText("Orders by state"));
    expect(onOpenSaved).toHaveBeenCalledWith(saved[0]);
    fireEvent.click(screen.getByText("SELECT state FROM orders"));
    expect(onRestore).toHaveBeenCalledWith("SELECT state FROM orders");
    fireEvent.change(screen.getByTestId("history-search"), { target: { value: "zzz" } });
    expect(screen.getByText(/Nothing run or saved here says/)).toBeInTheDocument();
  });
});
