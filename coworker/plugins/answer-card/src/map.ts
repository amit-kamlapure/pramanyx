/**
 * A map answer in the coworker's card: the shared map (`web/components/charts/geo/mapDrawing.ts`), with MapLibre, the shapes and the
 * organisation's base map served by this page's own server (`lib/index.js`).
 */
import { drawAnswerMap, mapHost, type MapRequest, type MapTokens } from "@/components/charts/geo/mapDrawing";

export { mapLayout, measureOf, type MapRequest, type MapTokens } from "@/components/charts/geo/mapDrawing";

const HERE = "/pramanyx-map";
const HOST = mapHost({ files: HERE, baseUrl: () => `${HERE}/base`, shapeUrl: (set) => `${HERE}/shapes/${set}.json` });

/** Draw the map for `req` into `box`. Returns what removes it, or null when the rows have no honest map. */
export function drawMap(box: HTMLElement, req: MapRequest, tokens: Omit<MapTokens, "small">): (() => void) | null {
  return drawAnswerMap(box, req, { ...tokens, small: "12px" }, HOST);
}
