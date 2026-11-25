// @vitest-environment jsdom
/** A volume object shown as itself (C4, 2026-11-25): text read and shown as written, an image drawn. */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ObjectPreview } from "@/components/catalog/MetastorePanels";

afterEach(() => vi.unstubAllGlobals());

describe("a volume object's preview", () => {
  it("reads text and shows it as written", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"rows": 3}', { status: 200 })));
    render(<ObjectPreview url="/o/1/content" name="config.json" kind="text" />);
    await waitFor(() => expect(screen.getByTestId("volume-object-text").textContent).toContain('{"rows": 3}'));
  });

  it("says so when the text cannot be read, and draws an image as an image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { unmount } = render(<ObjectPreview url="/o/2/content" name="rows.tsv" kind="text" />);
    await waitFor(() => screen.getByText(/the download has it/));
    unmount();
    render(<ObjectPreview url="/o/3/content" name="map.png" kind="image" />);
    expect(screen.getByAltText("map.png").getAttribute("src")).toBe("/o/3/content");
  });
});
