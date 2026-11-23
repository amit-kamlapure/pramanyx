"use client";

/**
 * A Definition's body, written as it reads (the user, 2026-11-23). It replaces Markdown typed into a box with a Preview
 * beside it: what is written is what is read.
 *
 * Kept as Markdown all the same: the body is stored, read into answers and drawn by
 * `DefinitionBody` as Markdown, so nothing that reads a Definition changes. And only what that reader draws can be
 * written — headings, paragraphs, bold, italic, inline code, lists, quotes, rules, links and tables; no underline,
 * strikethrough, code block or image. A link is the web or a page of the app (`lib/definitionBody.bodyHref`), as before.
 *
 * Every tool of the toolbar it replaces is here: Heading, Subheading, Text, Bold, Italic, the two lists, Link and Table,
 * and the count against the body's bound. A link's address is asked in the toolbar itself, never in a pop-up.
 */
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { BODY_MAX, bodyHref } from "@/lib/definitionBody";
import { formatCount } from "@/lib/format";
import { withUniqueKeys } from "@/lib/listKeys";

/** What a body may hold, as the editor's extensions: what `DefinitionBody` draws, and nothing it would not. */
export function bodyExtensions(placeholder = "") {
  return [
    StarterKit.configure({
      underline: false, strike: false, codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", isAllowedUri: (url: string) => !!bodyHref(url) },
    }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ];
}

type Block = "" | "heading" | "subheading" | "text";

const blockOf = (e: Editor): Block =>
  e.isActive("heading", { level: 2 }) || e.isActive("heading", { level: 1 }) ? "heading"
  : e.isActive("heading", { level: 3 }) || e.isActive("heading", { level: 4 }) ? "subheading"
  : e.isActive("paragraph") ? "text" : "";

const MARKS: { name: "bold" | "italic"; label: string; text: string }[] = [
  { name: "bold", label: "Bold", text: "B" }, { name: "italic", label: "Italic", text: "I" },
];
const LISTS: { name: "bulletList" | "orderedList"; label: string; icon: IconName }[] = [
  { name: "bulletList", label: "Bulleted list", icon: "list" }, { name: "orderedList", label: "Numbered list", icon: "num" },
];

export function RichBody({ value, onChange, label = "What it means", placeholder = "Write what it means, and how the business uses it" }: {
  /** The body, as Markdown. */
  value: string;
  onChange: (markdown: string) => void;
  label?: string;
  placeholder?: string;
}) {
  // the last Markdown this editor wrote: a value that comes back as it was written is not set again (it would move the
  // caret); one changed from outside — a draft reset, an accepted suggestion — is
  const wrote = useRef(value);
  const editor = useEditor({
    extensions: bodyExtensions(placeholder),
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true", class: "aug-rich-body" } },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown();
      wrote.current = md;
      onChange(md);
    },
  });
  useEffect(() => {
    if (!editor || value === wrote.current) return;
    wrote.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      block: blockOf(e), bold: e.isActive("bold"), italic: e.isActive("italic"), bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"), link: e.isActive("link"), table: e.isActive("table"),
    } : null,
  });
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState("");
  const addressOk = !!bodyHref(address.trim());

  const setBlock = (b: Block) => {
    if (!editor || !b) return;
    const c = editor.chain().focus();
    (b === "heading" ? c.setHeading({ level: 2 }) : b === "subheading" ? c.setHeading({ level: 3 }) : c.setParagraph()).run();
  };
  const startLink = () => {
    if (!editor) return;
    setAddress(String(editor.getAttributes("link").href ?? ""));
    setLinking(true);
  };
  const putLink = () => {
    if (!editor || !addressOk) return;
    const href = bodyHref(address.trim())?.href ?? "";
    const c = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) c.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else c.setLink({ href }).run();
    setLinking(false); setAddress("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10 }} data-testid="definition-editor">
      <div role="toolbar" aria-label="Format" style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <SelectField bespoke aria-label="Heading" value={state?.block ?? ""} onChange={(e) => setBlock(e.target.value as Block)}>
          <option value="" disabled>Heading…</option>
          <option value="heading">Heading</option>
          <option value="subheading">Subheading</option>
          <option value="text">Text</option>
        </SelectField>
        {withUniqueKeys(MARKS, (m) => m.name).map(([key, m]) => (
          <Button key={key} size="icon-xs" variant="outline" aria-label={m.label} title={m.label} aria-pressed={!!state?.[m.name]}
            className={state?.[m.name] ? "aug-btn-on" : undefined}
            onClick={() => editor?.chain().focus()[m.name === "bold" ? "toggleBold" : "toggleItalic"]().run()}>
            <span style={{ fontWeight: m.text === "B" ? 700 : 400, fontStyle: m.text === "I" ? "italic" : "normal" }}>{m.text}</span>
          </Button>
        ))}
        {withUniqueKeys(LISTS, (l) => l.name).map(([key, l]) => (
          <Button key={key} size="icon-xs" variant="outline" aria-label={l.label} title={l.label} aria-pressed={!!state?.[l.name]}
            className={state?.[l.name] ? "aug-btn-on" : undefined}
            onClick={() => editor?.chain().focus()[l.name === "bulletList" ? "toggleBulletList" : "toggleOrderedList"]().run()}>
            <Icon name={l.icon} size={13} />
          </Button>
        ))}
        <Button size="icon-xs" variant="outline" aria-label="Link" title="Link" aria-pressed={linking || !!state?.link}
          className={linking || state?.link ? "aug-btn-on" : undefined} onClick={() => (linking ? setLinking(false) : startLink())}>
          <Icon name="link" size={13} />
        </Button>
        <Button size="icon-xs" variant="outline" aria-label="Table" title="Table" disabled={!!state?.table}
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>
          <Icon name="table" size={13} />
        </Button>
        {linking && (
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
            <Input bespoke autoFocus aria-label="The link's address" placeholder="https://… or a page of the app (/?tab=…)" value={address}
              style={{ width: 300 }} onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); putLink(); } if (e.key === "Escape") setLinking(false); }} />
            <Button size="xs" disabled={!addressOk} onClick={putLink}>Add link</Button>
            {state?.link && <Button size="xs" variant="outline" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinking(false); }}>Remove</Button>}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="aug-fs-xs" style={{ color: value.length > BODY_MAX ? "var(--red4)" : "var(--t3)" }}>
          {formatCount(value.length)} / {formatCount(BODY_MAX)}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
