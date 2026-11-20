/**
 * The chart editor's lists of choices, one place for both callers of the one editor (`queryEditorModel.ts`): an answer's
 * chart and a dashboard card. Kept apart from either component so the model builder can read them without importing a
 * component (and the cycle a component importing the builder would make).
 */
import type { PostprocOp } from "@/lib/api";

export const TRANSFORM_OPTS: { v: PostprocOp | "none"; t: string }[] = [
  { v: "none", t: "None" },
  { v: "pop", t: "Period-over-period" },
  { v: "contribution", t: "Share of total" },
  { v: "rolling", t: "Rolling avg (3)" },
  { v: "cumulative", t: "Cumulative" },
];

// The Customize vocabularies — kept in sync with the Query Builder Customize tab so a card and a query offer the same
// knobs. (Colour palette "Scheme" was removed from the editor — the org-default palette applies; Color-by binding drives
// hue now.)
export const NUMBER_FORMATS: { v: string; t: string }[] = [
  { v: "", t: "Auto" }, { v: ",.0f", t: "1,234" }, { v: ",.2f", t: "1,234.56" }, { v: "$,.0f", t: "$1,234" },
  { v: "$,.2f", t: "$1,234.56" }, { v: "~s", t: "1.2K (compact)" }, { v: ".0%", t: "12%" }, { v: ".1%", t: "12.3%" },
];
/** "Show": every category, or only the largest few (the dashboards study, R12). */
export const TOP_OPTIONS: { v: string; t: string }[] = [
  { v: "", t: "Every category" }, { v: "5", t: "The 5 largest" }, { v: "10", t: "The 10 largest" }, { v: "20", t: "The 20 largest" },
];
export const LEGEND_POS: { v: string; t: string }[] = [
  { v: "", t: "Default" }, { v: "right", t: "Right" }, { v: "bottom", t: "Bottom" }, { v: "top", t: "Top" }, { v: "none", t: "Hidden" },
];
