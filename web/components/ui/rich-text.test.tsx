// @vitest-environment jsdom
/**
 * One editor for every place a person writes formatted words (2026-11-23), each place holding only what its reader
 * draws: a note no table and no link into the app, with a title and a heading as `#` and `##`; an Area's description no
 * heading and no table; a Definition all of them.
 */
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { NOTE_TEXT } from "@/components/dashboards/NoteProse";
import { DEFINITION_TEXT } from "@/components/definitions/DefinitionBody";
import { AREA_TEXT } from "@/components/discover/AreaCuration";
import { RichText, type RichTextKind } from "@/components/ui/rich-text";
import { editorOf, measureNothing } from "@/components/ui/richTextTesting";
import { act, change, fireEvent, render, screen, waitFor } from "@/lib/testing";

beforeAll(measureNothing);

function Harness({ kind, start, onChange }: { kind: RichTextKind; start: string; onChange: (md: string) => void }) {
  const [value, setValue] = useState(start);
  return <RichText kind={kind} label="Words" value={value} onChange={(md) => { setValue(md); onChange(md); }} />;
}

const tools = () => screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("what each place may hold", () => {
  it("a Definition: headings, lists, links and tables", async () => {
    render(<Harness kind={DEFINITION_TEXT} start="x" onChange={() => {}} />);
    await editorOf("Words");
    expect(tools()).toEqual(["Bold", "Italic", "Bulleted list", "Numbered list", "Link", "Table"]);
    expect(screen.getByLabelText("Heading")).toBeInTheDocument();
  });

  it("a note: a title and a heading, lists and links to the web — no table, no link into the app", async () => {
    const onChange = vi.fn();
    render(<Harness kind={NOTE_TEXT} start="Q4 targets" onChange={onChange} />);
    const editor = await editorOf("Words");
    expect(tools()).toEqual(["Bold", "Italic", "Bulleted list", "Numbered list", "Link"]);
    await act(async () => { editor.commands.selectAll(); });
    change(screen.getByLabelText("Heading"), { target: { value: "h1" } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/^# Q4 targets/)));
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("The link's address"), { target: { value: "/?tab=discover" } });
    expect(screen.getByRole("button", { name: "Add link" })).toBeDisabled();        // a note's links are the web's
    fireEvent.change(screen.getByLabelText("The link's address"), { target: { value: "https://wiki.example/q4" } });
    expect(screen.getByRole("button", { name: "Add link" })).toBeEnabled();
  });

  it("an Area's description: paragraphs, emphasis, lists and links — no heading, no table", async () => {
    render(<Harness kind={AREA_TEXT} start="x" onChange={() => {}} />);
    await editorOf("Words");
    expect(tools()).toEqual(["Bold", "Italic", "Bulleted list", "Numbered list", "Link"]);
    expect(screen.queryByLabelText("Heading")).toBeNull();
  });

  it("reads a Markdown it may not hold as the words it can: a note's table stays its words", async () => {
    const onChange = vi.fn();
    render(<Harness kind={NOTE_TEXT} start={"| a | b |\n| --- | --- |\n| 1 | 2 |"} onChange={onChange} />);
    const box = await screen.findByRole("textbox", { name: "Words" });
    expect(box.querySelector("table")).toBeNull();
  });
});

/** A field that keeps its words when left, trimmed, and shows what it kept — a dashboard note's, in the panel. */
function KeptWhenLeft({ start, onLeave }: { start: string; onLeave: (kept: string) => void }) {
  const [text, setText] = useState(start);
  return <RichText kind={NOTE_TEXT} label="Words" value={text} onChange={setText}
    onBlur={() => { const kept = text.trim(); onLeave(kept); setText(kept); }} />;
}

describe("a field kept when it is left", () => {
  it("a toolbar press acts on the words chosen: it leaves the focus in them, and is not leaving the field", async () => {
    const onLeave = vi.fn();
    render(<KeptWhenLeft start={"Each row is one product.\n\n"} onLeave={onLeave} />);
    const editor = await editorOf("Words");
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: 5 }); });
    const italic = screen.getByRole("button", { name: "Italic" });
    expect(fireEvent.mouseDown(italic)).toBe(false);               // the press does not take the focus
    fireEvent.focusOut(editor.view.dom, { relatedTarget: italic }); // nor does focus moving to the toolbar leave the field
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(italic);
    await waitFor(() => expect(editor.getMarkdown()).toMatch(/^\*Each\* row is one product\./));
    fireEvent.focusOut(editor.view.dom, { relatedTarget: document.body });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenLastCalledWith("*Each* row is one product.");
  });
});
