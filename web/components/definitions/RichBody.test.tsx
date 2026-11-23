// @vitest-environment jsdom
/**
 * A Definition's body written as it reads (the user's choice, 2026-11-23), and kept as Markdown: it reads
 * Markdown in, writes Markdown out, and every tool of the toolbar it replaced is here — Heading, Subheading, Text, Bold,
 * Italic, the two lists, Link (the web or a page of the app, nothing else) and Table — with the count against the bound.
 */
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { RichBody } from "@/components/definitions/RichBody";
import { editorOf, measureNothing } from "@/components/ui/richTextTesting";
import { act, change, fireEvent, render, screen, waitFor } from "@/lib/testing";

beforeAll(measureNothing);

function Harness({ start, onChange }: { start: string; onChange: (md: string) => void }) {
  const [value, setValue] = useState(start);
  return <RichBody value={value} onChange={(md) => { setValue(md); onChange(md); }} />;
}

const BODY = "## Definition\n\nA customer with **more than one** order.\n\n- paid\n- shipped\n\n| Status | Counts |\n| --- | --- |\n| paid | yes |";

describe("the body, as it reads", () => {
  it("draws the Markdown it is given as headings, emphasis, lists and tables", async () => {
    render(<Harness start={BODY} onChange={() => {}} />);
    const box = await screen.findByRole("textbox", { name: "What it means" });
    expect(box.querySelector("h2")?.textContent).toBe("Definition");
    expect(box.querySelector("strong")?.textContent).toBe("more than one");
    expect(box.querySelectorAll("ul li")).toHaveLength(2);
    expect(box.querySelector("table th")?.textContent).toBe("Status");
    expect(screen.getByText(`${BODY.length} / 4,000`)).toBeInTheDocument();
  });

  it("writes Markdown back: what is written is what is stored", async () => {
    const onChange = vi.fn();
    render(<Harness start={BODY} onChange={onChange} />);
    const editor = await editorOf();
    await act(async () => { editor.commands.setContent("## Business use\n\nLoyalty, *mostly*.", { contentType: "markdown" }); });
    expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/^## Business use\n+Loyalty, \*mostly\*\.\s*$/));
  });
});

describe("the toolbar", () => {
  const md = (onChange: ReturnType<typeof vi.fn>) => String(onChange.mock.calls.at(-1)?.[0] ?? "");

  it("makes the line a heading, a subheading, or text again", async () => {
    const onChange = vi.fn();
    render(<Harness start="Orders twice" onChange={onChange} />);
    const editor = await editorOf();
    await act(async () => { editor.commands.selectAll(); });
    change(screen.getByLabelText("Heading"), { target: { value: "h3" } });
    await waitFor(() => expect(md(onChange)).toMatch(/^### Orders twice/));
    change(screen.getByLabelText("Heading"), { target: { value: "text" } });
    await waitFor(() => expect(md(onChange)).toMatch(/^Orders twice/));
  });

  it("makes the chosen words bold or italic, and a list of the lines", async () => {
    const onChange = vi.fn();
    render(<Harness start="paid" onChange={onChange} />);
    const editor = await editorOf();
    await act(async () => { editor.commands.selectAll(); });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(md(onChange)).toContain("**paid**"));
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    await waitFor(() => expect(md(onChange)).toMatch(/^- \*\*paid\*\*/));
  });

  it("links to the web or a page of the app, and to nothing else", async () => {
    const onChange = vi.fn();
    render(<Harness start="see the wiki" onChange={onChange} />);
    const editor = await editorOf();
    await act(async () => { editor.commands.setTextSelection({ from: 9, to: 13 }); });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const address = screen.getByLabelText("The link's address");
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    const add = screen.getByRole("button", { name: "Add link" });
    expect(add).toBeDisabled();
    fireEvent.change(address, { target: { value: "https://wiki.example/x" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(md(onChange)).toContain("see the [wiki](https://wiki.example/x)"));
  });

  it("puts in a table", async () => {
    const onChange = vi.fn();
    render(<Harness start="Rates" onChange={onChange} />);
    await editorOf();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    await waitFor(() => expect(md(onChange)).toMatch(/\|[^\n]*\|\n\| ?-+/));
  });
});
