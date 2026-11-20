/**
 * Dates written as a person chose (the user, 2026-11-20, on Operations: "month format YYYY-MM"): one list of ways,
 * the same list the server holds a chart change to, each read in UTC so a day never moves.
 */
import { describe, expect, it } from "vitest";

import { DATE_FORMAT_WORDS, DATE_FORMATS, formatDateAs } from "./format";

describe("formatDateAs", () => {
  it("writes a day, a month and a timestamp each way on the list", () => {
    expect(formatDateAs("2026-11-20", "YYYY-MM")).toBe("2026-11");
    expect(formatDateAs("2026-11", "MMM YYYY")).toBe("Nov 2026");
    expect(formatDateAs("2026-01-05T23:30:00Z", "DD MMM YYYY")).toBe("05 Jan 2026");
    expect(formatDateAs("2026-01-05 23:30:00+00", "MMM D, YYYY")).toBe("Jan 5, 2026");
    expect(formatDateAs("2026-08-31", "YYYY-QQ")).toBe("2026 Q3");
    expect(formatDateAs("2026-12-31", "YYYY")).toBe("2026");
    expect(formatDateAs("2026-03-01", "YYYY-MM-DD")).toBe("2026-03-01");
  });

  it("leaves what is not a date to whoever called it", () => {
    expect(formatDateAs("Shipped", "YYYY-MM")).toBeNull();
    expect(formatDateAs(null, "YYYY-MM")).toBeNull();
    expect(formatDateAs("", "YYYY-MM")).toBeNull();
    expect(formatDateAs(42, "YYYY-MM")).toBeNull();
  });

  it("shows each way by an example a person can recognise, and the example is what it writes", () => {
    for (const f of DATE_FORMATS) expect(formatDateAs("2026-11-20", f)).toBe(DATE_FORMAT_WORDS[f]);
  });
});
