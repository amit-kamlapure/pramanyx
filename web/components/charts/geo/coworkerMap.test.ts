/**
 * The coworker card's map reads an answer's rows as the app does (`coworker/plugins/answer-card/src/map.ts`): which
 * columns are the points, the figure and the name, or which column names the shapes. Run from here because the card's
 * code imports the app's chart modules by the app's own paths.
 */
import { describe, expect, it } from "vitest";
import { mapLayout, measureOf } from "../../../../coworker/plugins/answer-card/src/map";

// The first live map of a sheet (2026-11-17): the coworker's test cities, as the sheets connection answered them.
const SHEET = {
  columns: ["_row", "city", "latitude", "longitude", "orders"],
  rows: [["1", "Pune", "18.52", "73.86", "420"], ["2", "Mumbai", "19.08", "72.88", "910"],
         ["3", "Bengaluru", "12.97", "77.59", "760"], ["4", "Delhi", "28.61", "77.21", "680"]],
};

describe("the coworker's map reads an answer's rows", () => {
  it("sizes a sheet's points by its figure, never by its row number, and names them by city", () => {
    const layout = mapLayout({ ...SHEET, kind: "points" })!;
    expect(SHEET.columns[layout.measure]).toBe("orders");
    expect(SHEET.columns[layout.label]).toBe("city");
    expect(SHEET.columns[layout.lat!]).toBe("latitude");
    expect(SHEET.columns[layout.lon!]).toBe("longitude");
  });

  it("does not take an id for the figure", () => {
    const columns = ["store_id", "lat", "lng", "revenue"];
    const rows = [[101, 51.5, -0.12, 900], [102, 48.85, 2.35, 700], [103, 52.52, 13.4, 650]];
    expect(columns[measureOf(columns, rows)]).toBe("revenue");
  });

  it("fills the countries a column names, with theLook's spellings", () => {
    const columns = ["country", "revenue"];
    const rows = [["Brasil", 10], ["España", 7], ["United States", 30], ["China", 22]];
    const layout = mapLayout({ columns, rows, kind: "shapes" })!;
    expect(layout.place?.column).toBe("country");
    expect(layout.place?.match.set).toBe("countries");
    expect(columns[layout.measure]).toBe("revenue");
  });

  it("has no map for rows with no position, or places no shape ships for", () => {
    expect(mapLayout({ columns: ["city", "orders"], rows: [["Pune", 1], ["Delhi", 2]], kind: "points" })).toBeNull();
    expect(mapLayout({ columns: ["region", "orders"], rows: [["North", 1], ["South", 2]], kind: "shapes" })).toBeNull();
  });
});
