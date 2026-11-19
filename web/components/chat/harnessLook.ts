/**
 * The coworker's way of laying out a conversation (the user, 2026-11-19: "the user experience is equivalent to that of the
 * harness"), worn by the Ask panel and, later, by Data Canvas. Read by the parts of an answer that look different in it; the
 * conversation that wears it says so once, at its root.
 */
import { createContext, useContext } from "react";

import type { AnswerSource } from "@/lib/answerSources";

export interface HarnessLook {
  on: boolean;
  /** Opens what an answer stood on, inside the conversation's own space. */
  openSource?: (source: AnswerSource) => void;
}

export const HarnessContext = createContext<HarnessLook>({ on: false });

export const useHarness = (): HarnessLook => useContext(HarnessContext);
