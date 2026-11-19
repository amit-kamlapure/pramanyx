// @vitest-environment jsdom
import { render, screen } from "@/lib/testing";
import { describe, expect, it } from "vitest";

import { AnswerMap } from "@/components/charts/geo/AnswerMap";

describe("a map answer", () => {
  it("draws the map where the rows name places", () => {
    render(<AnswerMap columns={["country", "orders"]} rows={[["Brazil", 4], ["France", 2]]} kind="shapes" fallback={<p>the still chart</p>} />);
    expect(screen.getByTestId("answer-map")).toBeTruthy();
    expect(screen.queryByText("the still chart")).toBeNull();
  });

  it("falls back to the chart where the rows have no honest map", () => {
    render(<AnswerMap columns={["region", "orders"]} rows={[["North", 4], ["South", 2]]} kind="shapes" fallback={<p>the still chart</p>} />);
    expect(screen.getByText("the still chart")).toBeTruthy();
  });
});
