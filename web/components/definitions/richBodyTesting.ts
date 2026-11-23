/**
 * For tests of a page that writes a Definition's body (`RichBody`): jsdom draws nothing, so the selection
 * ProseMirror measures when it focuses is given a size of nothing; and the editor is reached through its element,
 * where the editor keeps it, to write the body as typing would land.
 */
import type { Editor } from "@tiptap/react";
import { screen } from "@testing-library/react";

export function measureNothing(): void {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getBoundingClientRect = rect as never;
  Range.prototype.getClientRects = (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as never;
  document.elementFromPoint = (() => null) as never;
}

export async function editorOf(name = "What it means"): Promise<Editor> {
  const el = await screen.findByRole("textbox", { name });
  return (el as unknown as { editor: Editor }).editor;
}
