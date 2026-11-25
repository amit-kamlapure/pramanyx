/**
 * What a browser can show of a stored file as itself (C4, 2026-11-25: "Catalog extras: … more file previews").
 *
 * `frame` — the browser's own viewer in a frame (a PDF); `image` — drawn as an image; `text` — read as text and shown as
 * written. HTML and SVG are never drawn: on the platform's own origin their script would run, and the server sends
 * them, and any type not drawn here, as a download (`routers/volumes.object_headers`). `null` — download only.
 */
export type PreviewKind = "frame" | "image" | "text";

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const TEXTS = new Set(["txt", "md", "markdown", "csv", "tsv", "json"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "application/json"]);

/** How much of a text file is shown — the rest is in the download. */
export const TEXT_SHOWN = 200_000;

export function previewKind(name: string, mime?: string | null): PreviewKind | null {
  const type = (mime ?? "").split(";")[0].trim().toLowerCase();
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (type === "image/svg+xml" || ext === "svg" || type === "text/html" || ext === "html" || ext === "htm") return null;
  if (type === "application/pdf" || ext === "pdf") return "frame";
  if ((type.startsWith("image/") && IMAGES.has(type.slice(6).replace("jpeg", "jpg"))) || IMAGES.has(ext)) return "image";
  if (TEXT_TYPES.has(type) || TEXTS.has(ext)) return "text";
  return null;
}
