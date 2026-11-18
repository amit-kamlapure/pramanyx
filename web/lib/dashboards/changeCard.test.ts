import { describe, expect, it } from "vitest";

import { changeCardOf } from "./changeCard";

describe("what a drafted change would do", () => {
  it("lists what is added, changed and taken off, and no section merely because a card in it moved", () => {
    const card = changeCardOf({
      mode: "edit",
      outline: [{ tab: "", change: "", sections: [
        { title: "Sales", change: "changed", cards: [{ title: "Revenue", change: "changed" }, { title: "Orders", change: "" }, { title: "Margin", change: "added" }] },
        { title: "Returns", change: "added", cards: [] },
      ] }],
      taken_off: [{ title: "Old note", from: "Sales" }],
    });
    expect(card.lines).toEqual([
      { verb: "Change", title: "Revenue" }, { verb: "Add", title: "Margin" }, { verb: "Add", title: "Section: Returns" }, { verb: "Remove", title: "Old note" },
    ]);
    expect(card.asks).toBe("Apply 4 changes?");
    expect(card.did).toBe("Applied 4 changes");
  });

  it("says who a publish reaches", () => {
    expect(changeCardOf({ mode: "publish", to: ["Sales", "Finance"] })).toEqual({ asks: "Publish to Sales, Finance?", did: "Published to Sales, Finance", lines: [] });
  });

  it("still says something when only the arrangement moved", () => {
    const card = changeCardOf({ mode: "edit", outline: [{ sections: [{ title: "Sales", change: "changed", cards: [{ title: "Revenue", change: "" }] }] }] });
    expect(card.lines).toEqual([{ verb: "Change", title: "The dashboard's arrangement" }]);
    expect(card.asks).toBe("Apply 1 change?");
  });
});
