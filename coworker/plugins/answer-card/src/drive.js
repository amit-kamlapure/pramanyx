/**
 * The person's own Drive, searched from the conversation (punch list 91, 2026-11-18): what `search_my_drive` returned,
 * read into what its step shows — each file by name with its link, or why nothing was searched. A link goes only to
 * Google's own Drive and Docs pages; anything else is shown as a name without one.
 */
const GOOGLE = /^https:\/\/(docs|drive|sheets|slides)\.google\.com\//;

/** `{ files: [{name, type, modified, link}] }`, or `{ failed: why }`. */
export function driveFilesOf(text) {
  let got = null;
  try { got = JSON.parse(String(text || "")); } catch { got = null; }
  if (!got || typeof got !== "object") return { failed: "Drive was not searched." };
  if (got.searched !== true) return { failed: String(got.why || "Drive was not searched.") };
  const files = (Array.isArray(got.files) ? got.files : []).map((f) => ({
    name: String(f?.name || "Untitled"),
    type: kindOf(String(f?.type || "")),
    modified: String(f?.modified || "").slice(0, 10),
    link: GOOGLE.test(String(f?.link || "")) ? String(f.link) : "",
  }));
  return { files };
}

/** A Drive file's type, as a person says it. */
export function kindOf(mime) {
  const google = { spreadsheet: "Sheet", document: "Doc", presentation: "Slides", folder: "Folder", form: "Form" };
  const own = /^application\/vnd\.google-apps\.(\w+)$/.exec(mime);
  if (own) return google[own[1]] || own[1];
  if (mime === "application/pdf") return "PDF";
  if (/spreadsheetml|ms-excel|csv/.test(mime)) return "Spreadsheet";
  if (/presentationml|powerpoint/.test(mime)) return "Presentation";
  if (/wordprocessingml|msword/.test(mime)) return "Document";
  if (mime.startsWith("image/")) return "Image";
  return "";
}
