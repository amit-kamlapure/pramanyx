// @vitest-environment jsdom
/**
 * Settings ▸ Integrations ▸ Slack bots ▸ Your Slack account (2026-11-26). Pinned: an unlinked person is told what that
 * means and how to link; the code they type is what is sent; a refused code says the server's own reason; a linked
 * account is listed with its member id and can be unlinked; and nothing is sent until there is a code.
 */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getMySlack: vi.fn(),
  linkMySlack: vi.fn(),
  unlinkMySlack: vi.fn(async () => {}),
}));
vi.mock("@/lib/api", () => api);

import { YourSlackAccount } from "./YourSlackAccount";

const HOW = "Write “link” to the Pramanyx bot in Slack; it sends a one-time code by direct message.";

describe("Your Slack account", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("unlinked: says what that means and how to link; Link waits for a code", async () => {
    api.getMySlack.mockResolvedValue({ linked: [], how: HOW });
    render(<YourSlackAccount />);
    expect(await screen.findByText(/Not linked\. What you ask Pramanyx to send you in Slack has nowhere to go/)).toBeInTheDocument();
    expect(screen.getByText(HOW)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });

  it("links with the code typed, then lists the account", async () => {
    api.getMySlack.mockResolvedValueOnce({ linked: [], how: HOW })
      .mockResolvedValueOnce({ linked: [{ external_id: "U9", display: "Amit", linked_at: "2026-11-26T07:00:00+00:00" }], how: HOW });
    api.linkMySlack.mockResolvedValue({ external_id: "U9", display: "Amit", linked_at: "" });
    render(<YourSlackAccount />);
    fireEvent.change(await screen.findByLabelText("Code from the Pramanyx bot"), { target: { value: "abcd-2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(api.linkMySlack).toHaveBeenCalledWith("abcd-2345"));
    expect(await screen.findByRole("status")).toHaveTextContent("Linked Amit.");
    expect(await screen.findByText("Slack member U9 · linked 26 Nov", { exact: false })).toBeInTheDocument();
  });

  it("a refused code says the server's reason; an account is unlinked by its own button", async () => {
    api.getMySlack.mockResolvedValue({ linked: [{ external_id: "U9", display: "Amit", linked_at: "2026-11-26T07:00:00+00:00" }], how: HOW });
    api.linkMySlack.mockRejectedValue(new Error("That code has expired. Ask the bot for a new one."));
    render(<YourSlackAccount />);
    fireEvent.change(await screen.findByLabelText("Code from the Pramanyx bot"), { target: { value: "ZZZZ-ZZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("That code has expired. Ask the bot for a new one.");
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(api.unlinkMySlack).toHaveBeenCalledWith("U9"));
  });
});
