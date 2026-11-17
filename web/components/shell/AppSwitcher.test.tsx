// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Door = { available: boolean; url?: string | null; can_start?: boolean; reason?: string };
const door = vi.hoisted(() => ({ answer: { available: false } as Door, started: { available: false } as Door,
                                 asked: 0, minted: 0, starts: 0 }));
vi.mock("@/lib/api", () => ({
  fetchCoworkerDoor: () => { door.asked += 1; return Promise.resolve(door.answer); },
  mintCoworkerDelegation: () => { door.minted += 1; return Promise.resolve("person-token"); },
  startMyCoworker: () => { door.starts += 1; return Promise.resolve(door.started); },
}));

import { AppSwitcher, coworkerHref } from "@/components/shell/AppSwitcher";

describe("the way to the coworker", () => {
  beforeEach(() => { door.asked = 0; door.minted = 0; door.starts = 0; });
  afterEach(cleanup);

  it("draws nothing when no coworker is running", async () => {
    door.answer = { available: false };
    const { container } = render(<AppSwitcher connectionId="c1" theme="dark" />);
    await waitFor(() => expect(door.asked).toBe(1));
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing for a coworker that gave no address", async () => {
    door.answer = { available: true, url: null };
    const { container } = render(<AppSwitcher />);
    await waitFor(() => expect(door.asked).toBe(1));
    expect(container.innerHTML).toBe("");
  });

  it("draws nine dots when one is running, and they open the two places", async () => {
    door.answer = { available: true, url: "http://127.0.0.1:3090/?token=abc" };
    render(<AppSwitcher connectionId="c1" theme="light" />);
    const dots = await screen.findByRole("button", { name: "Switch to" });
    expect(dots.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(dots);
    expect(dots.getAttribute("aria-expanded")).toBe("true");
    const here = screen.getByText("Pramanyx").closest("[role=menuitem]");
    expect(here?.getAttribute("aria-current")).toBe("page");
    expect(here?.tagName).toBe("DIV");                       // where you are is not a link to it

    const there = screen.getByText("Coworker").closest("a") as HTMLAnchorElement;
    const to = new URL(there.href);
    // The coworker's own entry page, and nothing in the query: its access is not sent in a request line.
    expect(to.origin + to.pathname + to.search).toBe("http://127.0.0.1:3090/pramanyx-enter");
    const carried = new URLSearchParams(to.hash.slice(1));
    expect(carried.get("t")).toBe("abc");
    expect(carried.get("conn")).toBe("c1");
    expect(carried.get("theme")).toBe("light");
    expect(carried.get("back")).toBe(window.location.href);
    // The person rides along once the API has minted their delegation — asked for once, on the first open.
    await waitFor(() => expect(new URLSearchParams(new URL((screen.getByText("Coworker").closest("a") as HTMLAnchorElement).href).hash.slice(1)).get("d")).toBe("person-token"));
    fireEvent.click(dots); fireEvent.click(dots);
    expect(door.minted).toBe(1);
  });

  it("looks again as it opens, so a coworker that stopped is not offered", async () => {
    door.answer = { available: true, url: "http://127.0.0.1:3090/" };
    render(<AppSwitcher />);
    const dots = await screen.findByRole("button", { name: "Switch to" });
    door.answer = { available: false };
    fireEvent.click(dots);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Switch to" })).toBeNull());
    expect(door.asked).toBe(2);
  });

  it("closes on Escape", async () => {
    door.answer = { available: true, url: "http://127.0.0.1:3090/" };
    render(<AppSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch to" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("what is carried to the coworker", () => {
  it("goes to the coworker's entry page, with its access and the rest in the fragment", () => {
    const href = coworkerHref("http://localhost:3090/?token=t0", { connectionId: "abc", theme: "dark", back: "http://localhost:3000/?tab=home" });
    expect(href.startsWith("http://localhost:3090/pramanyx-enter#")).toBe(true);
    const said = new URLSearchParams(href.split("#")[1]);
    expect(said.get("t")).toBe("t0");
    expect(said.get("back")).toBe("http://localhost:3000/?tab=home");
    expect(href.split("#")[0]).not.toContain("t0");
  });

  it("keeps a coworker served under a path under that path", () => {
    expect(coworkerHref("https://localhost/ui/?token=t0", {}).split("#")[0]).toBe("https://localhost/ui/pramanyx-enter");
  });

  it("carries nothing it was not given", () => {
    expect(coworkerHref("http://localhost:3090/", {})).toBe("http://localhost:3090/pramanyx-enter");
  });

  it("returns an address it cannot read as it was given", () => {
    expect(coworkerHref("not an address", { connectionId: "abc" })).toBe("not an address");
  });

  // 2026-11-17 — each person has their own coworker: not running yet, it is offered, started on the click, and opened.
  it("offers a person's own coworker before it runs, starts it on the click, and opens it", async () => {
    door.answer = { available: false, can_start: true };
    door.started = { available: true, url: "http://127.0.0.1:3101/?token=mine", can_start: true };
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, href: window.location.href, assign });
    render(<AppSwitcher connectionId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch to" }));
    const start = screen.getByTestId("app-switcher-start");
    expect(start).toHaveTextContent("Your own coworker: started for you when you open it.");
    fireEvent.click(start);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(door.starts).toBe(1);
    expect(new URL(assign.mock.calls[0][0]).origin + new URL(assign.mock.calls[0][0]).pathname)
      .toBe("http://127.0.0.1:3101/pramanyx-enter");
    vi.unstubAllGlobals();
  });

  it("says why a person's coworker cannot be started", async () => {
    door.answer = { available: false, can_start: true };
    door.started = { available: false, can_start: false, reason: "The coworker's shell is not installed." };
    render(<AppSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch to" }));
    fireEvent.click(screen.getByTestId("app-switcher-start"));
    await waitFor(() => expect(screen.getByTestId("app-switcher-start")).toHaveTextContent("The coworker's shell is not installed."));
  });
});

