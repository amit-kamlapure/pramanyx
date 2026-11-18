/**
 * MapLibre, served to a page only when an answer is a map. Only these files, read from the installed package, and only by name:
 * nothing a caller writes in the address is read from disk.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const FILES: Record<string, string> = {
  "maplibre-gl.mjs": "text/javascript; charset=utf-8",
  "maplibre-gl-worker.mjs": "text/javascript; charset=utf-8",
  "maplibre-gl.css": "text/css; charset=utf-8",
};

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!Object.hasOwn(FILES, file)) return new Response("Not a map file", { status: 404 });
  try {
    const body = await readFile(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", file));
    return new Response(body, { headers: { "content-type": FILES[file], "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response("The map files are not installed", { status: 404 });
  }
}
