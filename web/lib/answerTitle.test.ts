/**
 * The one title-and-bold rule (`answerTitle.ts`), read by the coworker's card, a Data Canvas and the Ask panel.
 * Seen live 2026-11-23: a coworker card's bold headline ran on into "— caution: this total multiplies a measure by an
 * id/key column, so the magnitude is not trustworthy."
 */
import { describe, expect, it } from "vitest";

import { boldable, splitCautions, titleOf } from "@/lib/answerTitle";

describe("an answer's title", () => {
  it("is the answer's sentence, and a caution written onto it is said apart", () => {
    const got = titleOf("Shipped orders total 38,107 — caution: this total multiplies a measure by an id/key column, so the magnitude is not trustworthy.");
    expect(got.title).toBe("Shipped orders total 38,107");
    expect(got.cautions).toEqual(["This total multiplies a measure by an id/key column, so the magnitude is not trustworthy."]);
    expect(got.rest).toBe("");
  });

  it("splits each of several cautions, in the order they were written", () => {
    const { said, cautions } = splitCautions("Revenue was €1.2M — caution: a measure may be summed at the wrong grain (per-unit vs per-line); verify the total — caution: timestamp bounded by a date-only literal");
    expect(said).toBe("Revenue was €1.2M");
    expect(cautions).toEqual([
      "A measure may be summed at the wrong grain (per-unit vs per-line); verify the total.",
      "Timestamp bounded by a date-only literal.",
    ]);
  });

  it("is the first line of a markdown answer, without its bold or heading marks, the rest kept as written", () => {
    const got = titleOf("**Complete** leads with **31,021 orders**.\n\n- Shipped: 38,107\n- Cancelled: 12,345");
    expect(got.title).toBe("Complete leads with 31,021 orders.");
    expect(got.rest).toBe("- Shipped: 38,107\n- Cancelled: 12,345");
    expect(titleOf("## Orders by status\nComplete leads.").title).toBe("Orders by status");
  });

  it("is the first sentence of a long paragraph", () => {
    const long = `Shipped orders reached 38,107 in 2024, the most of any status by a wide margin over the year. ${"Then more words follow here. ".repeat(8)}`;
    const got = titleOf(long);
    expect(got.title).toBe("Shipped orders reached 38,107 in 2024, the most of any status by a wide margin over the year.");
    expect(got.rest.startsWith("Then more words")).toBe(true);
  });

  it("is nothing when the text opens on a lead-in, a list, a table or code — it is read as written", () => {
    const lead = "The top three categories by revenue are:\n- Jeans\n- Outerwear";
    expect(titleOf(lead)).toEqual({ title: "", cautions: [], rest: lead });
    for (const text of ["- Jeans: 1.2M\n- Outerwear: 0.9M", "| a | b |\n|---|---|", "```sql\nSELECT 1\n```", "1. First"]) {
      expect(titleOf(text).title).toBe("");
      expect(titleOf(text).rest).toBe(text);
    }
    expect(titleOf("")).toEqual({ title: "", cautions: [], rest: "" });
  });
});

describe("what is bold", () => {
  it("is a figure, a name or a short phrase, never a sentence", () => {
    expect(boldable("38,107 orders")).toBe(true);
    expect(boldable("Complete")).toBe(true);
    expect(boldable("Shipped orders are the largest group by far this year")).toBe(false);
    expect(boldable("  ")).toBe(false);
  });
});
