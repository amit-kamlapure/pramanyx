// @vitest-environment jsdom
/**
 * Group conversations (2026-11-17): the line above a conversation says who is in it; its owner adds people from the
 * organisation's people; someone added may leave; without sign-in the form says adding takes effect once it is on.
 */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadPeople as People } from "@/lib/threads";

const api = vi.hoisted(() => ({ setThreadMembers: vi.fn(), leaveThread: vi.fn(), readDirectory: vi.fn() }));
vi.mock("@/lib/threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/threads")>()),
  ...api,
}));

const { ThreadPeople } = await import("./ThreadPeople");
const { isShared, whoIsIn } = await import("@/lib/threads");

const ANA: People = { owner: "ana@acme.test", members: [], askers: ["ana@acme.test"], you: "ana@acme.test", single_person: false };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.readDirectory.mockResolvedValue([
    { email: "ana@acme.test", name: "Ana", active: true },
    { email: "bo@acme.test", name: "Bo", active: true },
    { email: "gone@acme.test", name: "Gone", active: false },
  ]);
});

describe("who is in a conversation", () => {
  it("says it from this page's side", () => {
    expect(whoIsIn(ANA)).toBe("Just you");
    expect(whoIsIn({ ...ANA, members: ["bo@acme.test"] })).toBe("You and bo@acme.test");
    expect(whoIsIn({ ...ANA, members: ["bo@acme.test", "cy@acme.test"], you: "bo@acme.test" }))
      .toBe("ana@acme.test's conversation, with you and cy@acme.test");
    expect(isShared(ANA)).toBe(false);
    expect(isShared({ ...ANA, members: ["bo@acme.test"] })).toBe(true);
  });

  it("lets its owner add the organisation's people", async () => {
    api.setThreadMembers.mockResolvedValue(["bo@acme.test"]);
    const onChange = vi.fn();
    render(<ThreadPeople sessionId="s1" people={ANA} onChange={onChange} onLeft={vi.fn()} />);
    expect(screen.getByTestId("thread-people-line")).toHaveTextContent("Just you");
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Bo" }));
    expect(screen.queryByRole("checkbox", { name: "Ana" })).toBeNull();       // not yourself
    expect(screen.queryByRole("checkbox", { name: "Gone" })).toBeNull();      // nor someone no longer here
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setThreadMembers).toHaveBeenCalledWith("s1", ["bo@acme.test"]));
    expect(onChange).toHaveBeenCalledWith({ ...ANA, members: ["bo@acme.test"] });
  });

  it("lets someone added leave", async () => {
    api.leaveThread.mockResolvedValue(undefined);
    const onLeft = vi.fn();
    render(<ThreadPeople sessionId="s1" people={{ ...ANA, members: ["bo@acme.test"], you: "bo@acme.test" }}
      onChange={vi.fn()} onLeft={onLeft} />);
    expect(screen.queryByRole("button", { name: "Add people" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
    expect(api.leaveThread).toHaveBeenCalledWith("s1");
  });

  it("says, without sign-in, that adding people takes effect once it is on", async () => {
    render(<ThreadPeople sessionId="s1" people={{ ...ANA, single_person: true }} onChange={vi.fn()} onLeft={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));
    expect(await screen.findByTestId("thread-single-person")).toHaveTextContent("once sign-in is on");
  });
});
