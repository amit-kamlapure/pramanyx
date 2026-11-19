import { describe, expect, it } from "vitest";

import { addressIsMine, claimChatAddress } from "@/components/ChatPanel";

const at = (query: string) => new URLSearchParams(query);

describe("which chat a reload resumes", () => {
  it("gives a canvas's conversation to that canvas's chat, never to the Ask screen behind it", () => {
    const canvas = at("tab=canvas-workspace&canvas=c1&chat=s1");
    expect(addressIsMine(canvas, "main")).toBe(false);
    expect(addressIsMine(canvas, "canvas:c2")).toBe(false);
    expect(addressIsMine(canvas, "canvas:c1")).toBe(true);
    expect(addressIsMine(at("tab=chat&chat=s1"), "main")).toBe(true);
    expect(addressIsMine(at("chat=s1"), "main")).toBe(true);
    expect(addressIsMine(at("chat=s1"), "canvas:c1")).toBe(false);
    expect(addressIsMine(at("tab=canvas-workspace&canvas=c1"), undefined)).toBe(true);
  });

  it("is claimed once per page load, by the panel mounted on its screen whichever mounted first", () => {
    const canvas = at("tab=canvas-workspace&canvas=c1&chat=s1");
    expect(claimChatAddress(canvas, "main")).toBeNull();
    expect(claimChatAddress(canvas, "canvas:c1")).toBe("s1");
    expect(claimChatAddress(canvas, "canvas:c1")).toBeNull();
  });
});
