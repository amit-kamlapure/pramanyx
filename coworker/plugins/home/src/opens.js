/**
 * When the questions worth asking show: they drop out of the question box while a person is in it and it is empty,
 * as the first screen the user held this one to does (the user, 2026-11-20: "the eariler had a list coming out
 * because I clicked on the input section"). Under the box, the rest of the screen stays as it is.
 *
 *   enter   focus or a press lands in the box        open when the box is empty
 *   input   the person types (or a pick fills it)    open only while it is still empty
 *   leave   focus leaves the box or the list         stays open only if it went to the other of the two
 *   escape, pick                                     closed
 */
export function nextOpen(was, { kind, empty = false, staysNear = false }) {
  if (kind === "enter" || kind === "input") return Boolean(empty);
  if (kind === "leave") return Boolean(was && staysNear);
  return false;
}
