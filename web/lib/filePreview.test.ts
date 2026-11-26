import { describe, expect, it } from "vitest";
import { previewKind } from "./filePreview";

describe("what a browser shows of a stored file as itself (C4, 2026-11-25)", () => {
  it("draws images, frames a PDF and reads text", () => {
    expect(previewKind("map.png", "image/png")).toBe("image");
    expect(previewKind("photo.JPG", "")).toBe("image");
    expect(previewKind("report.pdf", "application/pdf")).toBe("frame");
    expect(previewKind("rows.tsv", "text/tab-separated-values")).toBe("text");
    expect(previewKind("config.json", "application/json; charset=utf-8")).toBe("text");
  });
  it("never draws HTML or SVG, and leaves the rest to the download", () => {
    expect(previewKind("page.html", "text/html")).toBeNull();
    expect(previewKind("logo.svg", "image/svg+xml")).toBeNull();
    expect(previewKind("innocent.png", "image/svg+xml")).toBeNull();
    expect(previewKind("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBeNull();
  });
});
