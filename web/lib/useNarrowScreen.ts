import { useSyncExternalStore } from "react";

const NARROW = "(max-width: 900px)";

function subscribe(listener: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const isNarrow = () => (typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(NARROW).matches);

/** Whether the screen is too narrow for a panel to sit beside the page: the panel then covers it. */
export const useNarrowScreen = () => useSyncExternalStore(subscribe, isNarrow, () => false);
