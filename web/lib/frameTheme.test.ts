// @vitest-environment jsdom
/**
 * A page of the app inside the coworker's panel wears the coworker's light or dark, and stores nothing (the user,
 * 2026-11-23: "Yes, do it here", to making the side panel follow the coworker's theme).
 */
import { afterEach, describe, expect, it } from "vitest";

import { FRAME_THEME_MESSAGE, followFrameTheme, frameThemeFrom } from "@/lib/frameTheme";
import { THEME_BOOT } from "@/lib/themeBoot";
import { THEME_KEY } from "@/lib/themeSwitch";

const html = () => document.documentElement;

afterEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
  html().className = "";
  window.history.replaceState(null, "", "/");
});

describe("the theme an address asks for", () => {
  it("is heard only by a page inside another, and only as light or dark", () => {
    expect(frameThemeFrom("?theme=light", true)).toBe("light");
    expect(frameThemeFrom("?id=1&theme=dark", true)).toBe("dark");
    expect(frameThemeFrom("?theme=light", false)).toBeNull();
    expect(frameThemeFrom("?theme=purple", true)).toBeNull();
    expect(frameThemeFrom("?themes=light", true)).toBeNull();
  });

  it("is not worn by the app's own page, which keeps the theme it stored", () => {
    localStorage.setItem(THEME_KEY, "dark");
    window.history.replaceState(null, "", "/chart/b6?theme=light");
    new Function(THEME_BOOT)();
    expect(html().getAttribute("data-theme")).toBe("dark");
  });
});

describe("a page inside the coworker's panel", () => {
  /** A window inside another: its own events and document, a parent of its own. */
  const framed = () => {
    const events = new EventTarget();
    const parent = {} as Window;
    const win = Object.assign(events, { parent, document }) as unknown as Window;
    const say = (data: unknown, source: unknown = parent) =>
      events.dispatchEvent(Object.assign(new Event("message"), { data, source }));
    return { win, parent, say };
  };

  it("wears the theme its holder says each time it turns, and stores nothing", () => {
    html().setAttribute("data-theme", "dark");
    const { win, say } = framed();
    const stop = followFrameTheme(win);
    say({ type: FRAME_THEME_MESSAGE, theme: "light" });
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(html().classList.contains("light")).toBe(true);
    say({ type: FRAME_THEME_MESSAGE, theme: "dark" });
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    stop();
    say({ type: FRAME_THEME_MESSAGE, theme: "light" });
    expect(html().getAttribute("data-theme")).toBe("dark");
  });

  it("hears no other window, no other message and no other word", () => {
    html().setAttribute("data-theme", "dark");
    const { win, say } = framed();
    followFrameTheme(win);
    say({ type: FRAME_THEME_MESSAGE, theme: "light" }, {});
    say({ type: "something-else", theme: "light" });
    say({ type: FRAME_THEME_MESSAGE, theme: "neon" });
    expect(html().getAttribute("data-theme")).toBe("dark");
  });

  it("is not listened for on a page that is not inside another", () => {
    const events = new EventTarget();
    const win = Object.assign(events, { document }) as unknown as Window & { parent: Window };
    (win as { parent: Window }).parent = win;
    html().setAttribute("data-theme", "dark");
    followFrameTheme(win);
    events.dispatchEvent(Object.assign(new Event("message"), { data: { type: FRAME_THEME_MESSAGE, theme: "light" }, source: win }));
    expect(html().getAttribute("data-theme")).toBe("dark");
  });
});
