// @vitest-environment jsdom
/** The workspace chosen after a page read (2026-11-25): the Atlas read every connection before the app chose one, then
 *  its Area's tables read the chosen workspace's, and the two disagreed. A change is said on `window`; no change is not. */
import { describe, expect, it } from "vitest";

import { getActiveWorkspace, setActiveWorkspace, WORKSPACE_EVENT } from "./workspace";

describe("the active workspace, said when it changes", () => {
  it("says each change with the new id, and says nothing when the same one is set again", () => {
    const said: string[] = [];
    const hear = (e: Event) => said.push((e as CustomEvent<string>).detail);
    window.addEventListener(WORKSPACE_EVENT, hear);
    try {
      setActiveWorkspace("default");
      setActiveWorkspace("default");
      setActiveWorkspace("lux");
      setActiveWorkspace(null);
      setActiveWorkspace(undefined);
    } finally {
      window.removeEventListener(WORKSPACE_EVENT, hear);
    }
    expect(said).toEqual(["default", "lux", ""]);
    expect(getActiveWorkspace()).toBe("");
  });
});
