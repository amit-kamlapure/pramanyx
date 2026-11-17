/**
 * A map answer, drawn in the coworker's card (the maps step, 2026-11-17).
 *
 * MapLibre GL draws it, loaded from this page's own server only when an answer is a map: a page with no map fetches
 * none of it. What is drawn comes from the answer's own rows, in this browser — points where the rows carry a latitude
 * and a longitude, filled shapes where a column names countries or US states (`web/components/charts/geo/places.ts`,
 * the matcher the app's own maps use). The shapes are the install's, served by this page's server. None of the rows
 * leaves.
 *
 * Under them is the organisation's base map (`GET /org-settings/base-map`): none by default, so the shapes sit on a
 * blank ground with the world's outline for bearing; or OpenFreeMap's public tiles, or the organisation's own tile
 * server, from which the browser fetches the map squares a person views. The card says which, and what leaves.
 *
 * Everything a row says reaches the page as text, never as markup: a place name is data.
 */
import { classifyColumns, isIdLike, LAT_COL, LON_COL, plottedMeasures } from "@/components/charts/columnRoles";
import { placeColumn, SHAPES, type ShapeSet } from "@/components/charts/geo/places";
import { cleanLabel } from "@/lib/format";

/** The page's own server, which serves MapLibre, the shapes and the setting (`lib/index.js`). */
const HERE = "/pramanyx-map";
const HEIGHT = 380;
const NAMED = 5;

export interface MapTokens {
  palette: string[];
  t1: string;
  t3: string;
  surface: string;
  font: string;
}

export interface MapRequest {
  columns: string[];
  rows: unknown[][];
  kind: "points" | "shapes";
  column_units?: Record<string, string> | null;
}

interface Base { kind: "none" | "openfreemap" | "own"; light: string; dark: string; says: string }

const UNREAD: Base = { kind: "none", light: "", dark: "", says: "No base map: the organisation's setting could not be read." };

// ── what this page loads once ─────────────────────────────────────────────────────────────────────────────────────

/**
 * MapLibre's controls and hover box wear the page's own ground and ink — one theme, never a white box on a dark page.
 * The colours are the card's tokens, set on each map's frame as variables.
 */
const THEMED = `
.pramanyx-map .maplibregl-ctrl-attrib, .pramanyx-map .maplibregl-ctrl-attrib.maplibregl-compact,
.pramanyx-map .maplibregl-ctrl-group { background: var(--pm-ground); color: var(--pm-ink); }
.pramanyx-map .maplibregl-ctrl-attrib a { color: var(--pm-ink); }
.pramanyx-map .maplibregl-ctrl-attrib-button, .pramanyx-map .maplibregl-ctrl-icon { filter: var(--pm-invert); }
.pramanyx-map .maplibregl-ctrl-group button + button { border-top-color: var(--pm-edge); }
.pramanyx-map .maplibregl-ctrl-group:not(:empty) { box-shadow: 0 0 0 1px var(--pm-edge); }
.pramanyx-map .maplibregl-popup-content { background: var(--pm-ground); color: var(--pm-ink); padding: 6px 8px;
  box-shadow: 0 0 0 1px var(--pm-edge), 0 2px 8px rgba(0, 0, 0, 0.18); }
.pramanyx-map .maplibregl-popup-tip { display: none; }
`;

let library: Promise<any> | null = null;
/** MapLibre, from this page's server. Its worker sits beside it there and is found from its own address. */
function maplibre(): Promise<any> {
  if (!library) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${HERE}/maplibre-gl.css`;
    document.head.appendChild(css);
    const themed = document.createElement("style");
    themed.textContent = THEMED;
    document.head.appendChild(themed);
    const url = new URL(`${HERE}/maplibre-gl.mjs`, location.href).href;
    library = import(/* @vite-ignore */ url).then((m) => {
      m.setWorkerUrl?.(new URL(`${HERE}/maplibre-gl-worker.mjs`, location.href).href);
      return m;
    });
    library.catch(() => { library = null; });
  }
  return library;
}

let base: { at: number; read: Promise<Base> } | null = null;
/** The organisation's base map, read again after a minute so an admin's change reaches an open page. */
function baseMap(): Promise<Base> {
  if (!base || Date.now() - base.at > 60_000) {
    base = {
      at: Date.now(),
      read: fetch(`${HERE}/base`, { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : UNREAD))
        .then((b) => (b && typeof b.kind === "string" ? b : UNREAD))
        .catch(() => UNREAD),
    };
  }
  return base.read;
}

const shapes = new Map<ShapeSet, Promise<any>>();
function shapesOf(set: ShapeSet): Promise<any> {
  if (!shapes.has(set)) {
    const read = fetch(`${HERE}/shapes/${set}.json`).then((r) => {
      if (!r.ok) throw new Error(`the ${SHAPES[set].label} shapes could not be read (${r.status})`);
      return r.json();
    });
    read.catch(() => shapes.delete(set));
    shapes.set(set, read);
  }
  return shapes.get(set)!;
}

// ── reading the rows ──────────────────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A sheet's row number (`_row`) and its kin: a position in the file, never a figure to draw. */
const ROW_NUMBER = /^_?row(_?(num|number|no|idx|index))?$/i;

/**
 * The measure: among the number columns that are not a coordinate, an id or a row number, the one the app's charts
 * would plot first (`plottedMeasures`). The first live map of a sheet sized its cities by `_row`, 1 to 10.
 */
export function measureOf(columns: string[], rows: unknown[][]): number {
  const { numericIdxs } = classifyColumns(columns, rows);
  const figures = numericIdxs.filter((i) => {
    const c = columns[i] ?? "";
    return !LAT_COL.test(c) && !LON_COL.test(c) && !isIdLike(c) && !ROW_NUMBER.test(c);
  });
  return figures.length ? plottedMeasures(columns, rows, figures)[0] ?? -1 : -1;
}

interface Layout {
  kind: "points" | "shapes";
  measure: number;
  label: number;
  lat?: number;
  lon?: number;
  place?: ReturnType<typeof placeColumn>;
}

/** How these rows can be a map, or null when they cannot — the card then says so and shows the table. */
export function mapLayout(req: MapRequest): Layout | null {
  const { columns, rows } = req;
  if (!columns.length || !rows.length) return null;
  const { catIdxs } = classifyColumns(columns, rows);
  const measure = measureOf(columns, rows);
  if (req.kind === "points") {
    const lat = columns.findIndex((c) => LAT_COL.test(c));
    const lon = columns.findIndex((c) => LON_COL.test(c));
    if (lat < 0 || lon < 0) return null;
    const named = catIdxs.find((i) => !isIdLike(columns[i] ?? "") && !ROW_NUMBER.test(columns[i] ?? ""));
    return { kind: "points", measure, label: named ?? catIdxs[0] ?? -1, lat, lon };
  }
  const place = placeColumn(columns, rows, catIdxs);
  if (!place || measure < 0) return null;
  return { kind: "shapes", measure, label: place.index, place };
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** `colour` at `alpha`, for a colour written as hex or rgb(); the colour itself when it is written another way. */
function alpha(colour: string, a: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(colour);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})` : colour;
}

/** Whether the page is dark: its text is lighter than mid-grey. */
function darkPage(ink: string): boolean {
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(ink) ?? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ink);
  if (!m) return false;
  const [r, g, b] = m.slice(1, 4).map((x) => (x.length === 2 && /[a-f]/i.test(x) ? parseInt(x, 16) : Number(x)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

function formatter(unit: string | undefined): (v: number) => string {
  const currency = unit && /^[A-Z]{3}$/.test(unit) ? unit : "";
  const f = new Intl.NumberFormat(undefined, currency
    ? { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }
    : { notation: "compact", maximumFractionDigits: 2 });
  return (v) => (currency || !unit ? f.format(v) : `${f.format(v)} ${unit}`);
}

/** The corners of everything in `geometry`'s coordinates, folded into `box` ([west, south, east, north]). */
function extend(box: number[], coords: any, skipEast: boolean): void {
  if (typeof coords?.[0] === "number") {
    const [x, y] = coords;
    if (skipEast && x > 0) return;          // the Aleutians past 180° would stretch the US across the world
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    return;
  }
  for (const c of coords ?? []) extend(box, c, skipEast);
}

function el(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const n = document.createElement(tag);
  Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Draw the map for `req` into `box`. Returns what removes it, or null when the rows have no honest map — the same
 * verdict the app's own map reaches for them.
 */
export function drawMap(box: HTMLElement, req: MapRequest, tokens: MapTokens): (() => void) | null {
  const layout = mapLayout(req);
  if (!layout) return null;
  const { columns, rows } = req;
  const accent = tokens.palette[0] ?? tokens.t1;
  const measureName = layout.measure >= 0 ? columns[layout.measure] : "";
  const fmt = formatter(measureName ? req.column_units?.[measureName] : undefined);

  const frame = el("div", { position: "relative", width: "100%", height: `${HEIGHT}px`, borderRadius: "4px", overflow: "hidden" });
  frame.className = "pramanyx-map";
  const dark = darkPage(tokens.t1);
  frame.style.setProperty("--pm-ground", tokens.surface);
  frame.style.setProperty("--pm-ink", tokens.t1);
  frame.style.setProperty("--pm-edge", alpha(tokens.t1, 0.18));
  frame.style.setProperty("--pm-invert", dark ? "invert(1)" : "none");
  const legend = el("div", { display: "flex", alignItems: "center", gap: "8px", padding: "6px 0 0", fontSize: "12px", color: tokens.t3 });
  const notes = el("div", { display: "flex", flexDirection: "column", gap: "2px", padding: "4px 0 0", fontSize: "12px", color: tokens.t3 });
  box.replaceChildren(frame, legend, notes);
  const say = (text: string) => notes.appendChild(el("div", {}, text));

  let map: any = null;
  let gone = false;

  (async () => {
    const [lib, chosen] = await Promise.all([maplibre(), baseMap()]);
    if (gone) return;
    const styleUrl = chosen.kind === "none" ? "" : (dark ? chosen.dark : chosen.light) || chosen.light;
    const world = new URL(`${HERE}/shapes/countries.json`, location.href).href;
    const style = styleUrl || {
      version: 8,
      sources: { world: { type: "geojson", data: world, attribution: SHAPES.countries.credit } },
      layers: [
        { id: "ground", type: "background", paint: { "background-color": tokens.surface } },
        { id: "land", type: "fill", source: "world", paint: { "fill-color": alpha(tokens.t1, 0.06) } },
        { id: "borders", type: "line", source: "world", paint: { "line-color": alpha(tokens.t1, 0.2), "line-width": 0.5 } },
      ],
    };

    // ── the answer's own features ──
    const box4 = [Infinity, Infinity, -Infinity, -Infinity];
    let data: any;
    let low = Infinity, high = -Infinity;
    if (layout.kind === "points") {
      const features: any[] = [];
      let unplaced = 0;
      for (const r of rows) {
        const lat = num(r[layout.lat!]), lon = num(r[layout.lon!]);
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { unplaced += 1; continue; }
        const v = layout.measure >= 0 ? num(r[layout.measure]) : null;
        if (v !== null) { low = Math.min(low, v); high = Math.max(high, v); }
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
                        properties: { v, label: layout.label >= 0 ? String(r[layout.label] ?? "") : "" } });
        extend(box4, [lon, lat], false);
      }
      data = { type: "FeatureCollection", features };
      say(`${features.length.toLocaleString()} ${features.length === 1 ? "point" : "points"}` +
          (unplaced ? `; ${unplaced.toLocaleString()} ${unplaced === 1 ? "row has" : "rows have"} no position and ${unplaced === 1 ? "is" : "are"} not on the map.` : "."));
    } else {
      const { match } = layout.place!;
      const set = match.set;
      const all = await shapesOf(set);
      if (gone) return;
      const valueOf = new Map<string, number>();
      const saidAs = new Map<string, string>();
      const repeated: string[] = [];
      for (const r of rows) {
        const said = String(r[layout.label] ?? "").trim();
        const shape = match.shapes.get(said);
        const v = num(r[layout.measure]);
        if (!shape || v === null) continue;
        // Two rows for one place ("Spain" and "España"): the first row's figure is drawn and the other is named, not
        // added — whether two figures add up is the question's to say, not the map's.
        if (valueOf.has(shape)) { repeated.push(`"${said}" is drawn as ${shape}, which the row "${saidAs.get(shape)}" already fills; its figure, ${fmt(v)}, is not on the map.`); continue; }
        valueOf.set(shape, v);
        saidAs.set(shape, said);
        low = Math.min(low, v); high = Math.max(high, v);
      }
      const features = (all.features ?? []).filter((f: any) => valueOf.has(f.properties?.name)).map((f: any) => {
        extend(box4, f.geometry?.coordinates, set === "us_states");
        return { ...f, properties: { ...f.properties, v: valueOf.get(f.properties.name), label: f.properties.name } };
      });
      data = { type: "FeatureCollection", features };
      const n = match.distinct;
      say(`${match.shapes.size.toLocaleString()} of ${n.toLocaleString()} places matched ${SHAPES[set].label === "countries" ? "a country" : "a US state"}.`);
      if (match.unmatched.length) {
        const named = match.unmatched.slice(0, NAMED).join(", ");
        const more = match.unmatched.length - NAMED;
        say(`Not on the map, no shape ships for them: ${named}${more > 0 ? ` and ${more.toLocaleString()} more` : ""}.`);
      }
      for (const line of repeated.slice(0, NAMED)) say(line);
      if (repeated.length > NAMED) say(`${(repeated.length - NAMED).toLocaleString()} more rows name a place already drawn.`);
    }
    say(chosen.says);

    map = new lib.Map({
      container: frame, style, attributionControl: { compact: true },
      bounds: Number.isFinite(box4[0]) ? [[box4[0], box4[1]], [box4[2], box4[3]]] : undefined,
      fitBoundsOptions: { padding: 28, maxZoom: layout.kind === "points" ? 9 : 5 },
      center: Number.isFinite(box4[0]) ? undefined : [0, 20], zoom: Number.isFinite(box4[0]) ? undefined : 0.6,
      dragRotate: false, pitchWithRotate: false, cooperativeGestures: true,
    });
    map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      if (gone) return;
      const credit = layout.kind === "shapes" ? SHAPES[layout.place!.match.set].credit : "";
      map.addSource("answer", { type: "geojson", data, ...(credit && styleUrl ? { attribution: credit } : {}) });
      const spread = Number.isFinite(low) && high > low;
      if (layout.kind === "points") {
        const sized = Number.isFinite(low) && high > Math.max(low, 0);
        map.addLayer({
          id: "answer", type: "circle", source: "answer",
          paint: {
            "circle-color": accent, "circle-opacity": 0.78,
            "circle-stroke-color": tokens.surface, "circle-stroke-width": 1,
            "circle-radius": sized
              ? ["interpolate", ["linear"], ["sqrt", ["max", ["coalesce", ["get", "v"], 0], 0]], Math.sqrt(Math.max(low, 0)), 3, Math.sqrt(high), 14]
              : 5,
          },
        });
      } else {
        map.addLayer({
          id: "answer", type: "fill", source: "answer",
          paint: {
            // A magnitude's ramp, as the app's (`vega/config.ts`): the first series colour, from faint to full.
            "fill-color": spread ? ["interpolate", ["linear"], ["get", "v"], low, alpha(accent, 0.12), high, accent] : accent,
            "fill-opacity": 0.85,
          },
        });
        map.addLayer({ id: "answer-edge", type: "line", source: "answer",
                       paint: { "line-color": alpha(tokens.t1, 0.35), "line-width": 0.6 } });
      }
      // What a place says on hover, written as text.
      const tip = new lib.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      map.on("mousemove", "answer", (e: any) => {
        const p = e.features?.[0]?.properties ?? {};
        const body = el("div", { font: `12px ${tokens.font}` });
        if (p.label) body.appendChild(el("div", { fontWeight: "600" }, String(p.label)));
        if (measureName && p.v != null && p.v !== "null") body.appendChild(el("div", {}, `${cleanLabel(measureName)}: ${fmt(Number(p.v))}`));
        if (!body.childNodes.length) return;
        map.getCanvas().style.cursor = "default";
        tip.setLngLat(e.lngLat).setDOMContent(body).addTo(map);
      });
      map.on("mouseleave", "answer", () => tip.remove());
    });
    map.on("error", (e: any) => {
      // A base map that cannot be reached leaves the answer's own layer drawn; say it once.
      if (styleUrl && !notes.dataset.unreached && /style|tile|source/i.test(String(e?.error?.message ?? ""))) {
        notes.dataset.unreached = "1";
        say("The base map could not be reached; the answer's own shapes and points are drawn without it.");
      }
    });

    // ── the legend ──
    if (measureName && Number.isFinite(low)) {
      legend.appendChild(el("span", { color: tokens.t1 }, cleanLabel(measureName)));
      if (layout.kind === "shapes") {
        legend.appendChild(el("span", {}, fmt(low)));
        legend.appendChild(el("span", { width: "120px", height: "8px", borderRadius: "2px",
                                        background: `linear-gradient(90deg, ${alpha(accent, 0.12)}, ${accent})` }));
        legend.appendChild(el("span", {}, fmt(high)));
      } else {
        legend.appendChild(el("span", {}, `circle size, ${fmt(low)} to ${fmt(high)}`));
      }
    }
  })().catch((err) => {
    if (gone) return;
    frame.replaceChildren(el("div", { padding: "12px 0", fontSize: "12.5px", color: tokens.t3 },
      `The map could not be drawn here (${err instanceof Error ? err.message : String(err)}). The table has the rows.`));
  });

  return () => {
    gone = true;
    try { map?.remove(); } catch { /* already gone with its page */ }
    box.replaceChildren();
  };
}
