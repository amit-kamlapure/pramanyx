/** What the Ask composer offers while a person writes: @ for objects, / for commands, ↑↓ for history. */
import { describe, expect, it } from "vitest";

import { askedBefore, assistAt, historyStep, mentionIn, mentionOffers, MOST_OFFERS, withoutCommand, type Offer } from "@/lib/composerAssist";

const OBJECTS: Offer[] = [
  { value: "main.orders", label: "main.orders", hint: "table" },
  { value: "main.order_items", label: "main.order_items", hint: "table" },
  { value: "main.netflix_titles", label: "main.netflix_titles", hint: "table" },
  { value: "gross_revenue", label: "Gross revenue", hint: "metric" },
];
const COMMANDS: Offer[] = [
  { value: "quick", label: "/quick", hint: "answer this one quickly" },
  { value: "agent", label: "/agent", hint: "investigate it in depth" },
  { value: "new", label: "/new", hint: "a new conversation" },
];

describe("@ for objects", () => {
  it("offers the objects a word after @ names, those that start with it first", () => {
    const text = "How many rows in @ord";
    const a = assistAt(text, text.length, OBJECTS, COMMANDS);
    expect(a?.kind).toBe("mention");
    expect(a?.offers.map(o => o.value)).toEqual(["main.orders", "main.order_items"]);
    expect(assistAt("@gross", 6, OBJECTS, COMMANDS)?.offers.map(o => o.value)).toEqual(["gross_revenue"]);   // by label too
  });

  it("writes the chosen name in, with a space to go on, and offers nothing inside a word or an address", () => {
    const text = "Compare @ord with last year";
    const a = assistAt(text, "Compare @ord".length, OBJECTS, COMMANDS)!;
    expect(mentionIn(text, a, OBJECTS[0])).toEqual({ text: "Compare @main.orders with last year", caret: "Compare @main.orders ".length });
    expect(assistAt("mail me at ana@ord", 18, OBJECTS, COMMANDS)).toBeNull();
    expect(assistAt("@zzz", 4, OBJECTS, COMMANDS)).toBeNull();
  });

  it("offers no more than a list can show", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ value: `t${i}`, label: `t${i}`, hint: "table" }));
    expect(assistAt("@t", 2, many, COMMANDS)?.offers).toHaveLength(MOST_OFFERS);
  });
});

describe("/ for commands", () => {
  it("offers commands only at the very start, and takes the command out once chosen", () => {
    const a = assistAt("/qu", 3, OBJECTS, COMMANDS)!;
    expect(a.kind).toBe("command");
    expect(a.offers.map(o => o.value)).toEqual(["quick"]);
    expect(withoutCommand("/qu why did returns rise?", { ...a, end: 3 })).toBe("why did returns rise?");
    expect(assistAt("why /qu", 7, OBJECTS, COMMANDS)).toBeNull();
    expect(assistAt("/", 1, OBJECTS, [])).toBeNull();                       // no commands, nothing offered
  });
});

describe("↑↓ for history", () => {
  it("walks back through what was asked, and forward past the newest to what was being written", () => {
    const asked = ["a", "b", "c"];
    expect(historyStep(asked, -1, "back")).toBe(2);
    expect(historyStep(asked, 2, "back")).toBe(1);
    expect(historyStep(asked, 0, "back")).toBe(0);
    expect(historyStep(asked, 1, "forward")).toBe(2);
    expect(historyStep(asked, 2, "forward")).toBe(-1);
    expect(historyStep([], -1, "back")).toBe(-1);
  });

  it("holds each question once, at its latest asking", () => {
    expect(askedBefore(["a", "b", " a ", "", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("what @ can name (Stage 2)", () => {
  it("offers tables, metrics, the person's dashboards, their cards with the dashboard they are on, and columns last", () => {
    const offers = mentionOffers(
      [{ name: "main.orders", columns: [{ name: "status" }, { name: "created_at" }] }],
      [{ name: "gross_revenue", label: "Gross revenue" }],
      { dashboards: [{ title: "Operations" }], cards: [{ title: "Orders by day", on: "Operations" }] },
    );
    expect(offers.map(o => `${o.hint}:${o.value}`)).toEqual([
      "table:main.orders", "metric:gross_revenue", "dashboard:Operations", "card · Operations:Orders by day",
      "column:main.orders.status", "column:main.orders.created_at",
    ]);
    // a table is found before its own columns
    expect(assistAt("@main.or", 8, offers, COMMANDS)?.offers[0].value).toBe("main.orders");
    expect(assistAt("@main.orders.st", 15, offers, COMMANDS)?.offers.map(o => o.value)).toEqual(["main.orders.status"]);
  });
});
