// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerSources, SourceBeside } from "@/components/chat/AnswerSources";

const getReceiptSources = vi.fn();
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), getReceiptSources: (...a: unknown[]) => getReceiptSources(...a) }));
beforeEach(() => { getReceiptSources.mockReset(); });
const READ = { receipt_id: "r1", connection_id: "c1", metrics: [{ name: "net_revenue", departed: false }], definitions: [], objects: ["A", "B", "C", "D", "E", "F"] };

describe("the marks under an answer", () => {
  it("open what the answer stood on, the first few objects and the rest behind one more", async () => {
    getReceiptSources.mockResolvedValue(READ);
    const onOpen = vi.fn();
    render(<AnswerSources receiptId="r1" connectionId="c1" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getAllByTestId("answer-source")).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "net_revenue" }));
    expect(onOpen.mock.calls[0][0].page).toBe("/metrics/net_revenue?conn=c1");
    fireEvent.click(screen.getByRole("button", { name: "2 more" }));
    expect(screen.getAllByTestId("answer-source")).toHaveLength(7);
  });

  it("draw nothing for an answer that names no source, and say so when they cannot be read", async () => {
    getReceiptSources.mockResolvedValueOnce({ ...READ, metrics: [], objects: [] });
    const { unmount } = render(<AnswerSources receiptId="r1" connectionId="c1" onOpen={vi.fn()} />);
    await waitFor(() => expect(getReceiptSources).toHaveBeenCalled());
    expect(screen.queryByTestId("answer-sources")).toBeNull();
    unmount();
    getReceiptSources.mockRejectedValueOnce(new Error("no"));
    render(<AnswerSources receiptId="r2" connectionId="c1" onOpen={vi.fn()} />);
    expect(await screen.findByTestId("answer-sources-unread")).toBeTruthy();
  });
});

describe("a source beside the conversation", () => {
  it("shows only that thing's page, and closes", () => {
    const onClose = vi.fn();
    render(<SourceBeside source={{ key: "m", kind: "metric", label: "net_revenue", title: "", page: "/metrics/net_revenue?conn=c1" }} onClose={onClose} />);
    expect(screen.getByRole("complementary", { name: "net_revenue, beside the conversation" })).toBeTruthy();
    expect(document.querySelector("iframe")).toHaveAttribute("src", "/metrics/net_revenue?conn=c1");
    fireEvent.click(screen.getByTestId("source-beside-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
