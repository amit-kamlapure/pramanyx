"use client";

/**
 * Words written as they read, and kept as Markdown (the user's choice of editor, 2026-11-23) — one editor for every place
 * a person writes formatted words: a Definition's body, a dashboard note, an Area's description.
 *
 * Each place says what it may hold (`RichTextKind`), from what its own reader draws: a note is drawn from a narrower
 * Markdown than a Definition, so a note's editor offers no table and no link into the app. What is written is stored as
 * Markdown, as it always was, so nothing that reads it changes. A link's address is asked in the toolbar itself, never
 * in a pop-up, and only one its reader would draw is taken.
 */
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent } from "react";
import { EditorContent, Node as EditorNode, mergeAttributes, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { formatCount } from "@/lib/format";
import { withUniqueKeys } from "@/lib/listKeys";

type Level = 1 | 2 | 3 | 4;

/** What one place's words may hold — what its reader draws, and nothing it would not. */
export interface RichTextKind {
  /** The heading levels offered, each by the name its toolbar gives it; none, and there are no headings. */
  headings: { label: string; level: Level }[];
  lists: boolean;
  table: boolean;
  /** Inline code, quotes and rules. */
  code: boolean;
  quote: boolean;
  rule: boolean;
  /** The link a place may carry, as its reader would draw it — or null for one it would not; no function, no links. */
  linkHref: ((href: string) => string | null) | null;
  /** What the address box suggests. */
  linkHint?: string;
  /** Images a place keeps: where one it keeps is read from to be drawn, or null for one it would not. Absent, no images
   *  (2026-11-24: a Definition's body holds pictures uploaded to its connection). */
  imageShown?: (src: string) => string | null;
}

/** A picture in the words, kept as Markdown (`![words](path)`): the path a place keeps, drawn from where `shown` says. */
function imageNode(shown: (src: string) => string | null) {
  return EditorNode.create({
    name: "image", inline: true, group: "inline", atom: true, draggable: true,
    addAttributes() { return { src: { default: "" }, alt: { default: "" } }; },
    // the path kept rides on the drawn picture, so the editor reading its own page keeps the path, not the address
    parseHTML() {
      return [{ tag: "img[src]", getAttrs: (el: HTMLElement) => ({ src: el.getAttribute("data-kept") || el.getAttribute("src") || "",
        alt: el.getAttribute("alt") || "" }) }];
    },
    renderHTML({ HTMLAttributes }) {
      const kept = String(HTMLAttributes.src ?? "");
      return ["img", mergeAttributes(HTMLAttributes, { src: shown(kept) ?? "", "data-kept": kept })];
    },
    markdownTokenName: "image",
    parseMarkdown: (token, helpers) => helpers.createNode("image", { src: String(token.href ?? ""), alt: String(token.text ?? "") }),
    renderMarkdown: (node) => `![${String(node.attrs?.alt ?? "").replace(/[[\]]/g, "")}](${String(node.attrs?.src ?? "")})`,
  });
}

/** What the editor understands, for one kind of words. */
export function richTextExtensions(kind: RichTextKind, placeholder = "") {
  const levels = kind.headings.map((h) => h.level);
  const href = kind.linkHref;
  return [
    StarterKit.configure({
      underline: false, strike: false, codeBlock: false,
      code: kind.code ? {} : false, blockquote: kind.quote ? {} : false, horizontalRule: kind.rule ? {} : false,
      bulletList: kind.lists ? {} : false, orderedList: kind.lists ? {} : false, listItem: kind.lists ? {} : false,
      listKeymap: kind.lists ? {} : false,
      heading: levels.length ? { levels } : false,
      link: href ? { openOnClick: false, autolink: true, defaultProtocol: "https", isAllowedUri: (url: string) => !!href(url) } : false,
    }),
    ...(kind.table ? [TableKit.configure({ table: { resizable: false } })] : []),
    ...(kind.imageShown ? [imageNode(kind.imageShown)] : []),
    Placeholder.configure({ placeholder }),
    Markdown,
  ];
}

const MARKS: { name: "bold" | "italic"; label: string; text: string }[] = [
  { name: "bold", label: "Bold", text: "B" }, { name: "italic", label: "Italic", text: "I" },
];
const LISTS: { name: "bulletList" | "orderedList"; label: string; icon: IconName }[] = [
  { name: "bulletList", label: "Bulleted list", icon: "list" }, { name: "orderedList", label: "Numbered list", icon: "num" },
];

const blockOf = (e: Editor, kind: RichTextKind): string => {
  const h = kind.headings.find((x) => e.isActive("heading", { level: x.level }));
  return h ? `h${h.level}` : e.isActive("paragraph") ? "text" : "";
};

export function RichText({ kind, value, onChange, onBlur, onImage, label, placeholder = "", max, autoFocus = false, minHeight = 220, testId = "rich-text" }: {
  kind: RichTextKind;
  /** The words, as Markdown. */
  value: string;
  onChange: (markdown: string) => void;
  /** Left: a place that keeps its words when the person moves on (a panel's field). The toolbar is part of the field:
   *  focus that moves to its buttons, its heading menu or its link's address has not left it. */
  onBlur?: () => void;
  /** Takes a picture the person chose where the place keeps pictures, and says what the words keep for it — for a kind
   *  with `imageShown`; without it there is no Image button. A refusal (its reason) is said under the toolbar. */
  onImage?: (file: File) => Promise<{ src: string; alt: string }>;
  /** Its name, as a reader of the page hears it. */
  label: string;
  placeholder?: string;
  /** The most it holds, as Markdown: counted beside the toolbar, red past it. */
  max?: number;
  autoFocus?: boolean;
  minHeight?: number;
  testId?: string;
}) {
  // the last Markdown this editor wrote: a value that comes back as it was written is not set again (it would move the
  // caret); one changed from outside — a draft reset, an accepted suggestion, an undo — is
  const wrote = useRef(value);
  const blurred = useRef(onBlur);
  useEffect(() => { blurred.current = onBlur; }, [onBlur]);
  const editor = useEditor({
    extensions: richTextExtensions(kind, placeholder),
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true", class: "aug-rich-text",
      style: `--rich-min: ${minHeight}px` } },
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
      block: blockOf(e, kind), bold: e.isActive("bold"), italic: e.isActive("italic"), bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"), link: e.isActive("link"), table: e.isActive("table"),
    } : null,
  });
  const [linking, setLinking] = useState(false);
  const [picturing, setPicturing] = useState(false);
  const [pictureSaid, setPictureSaid] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const picked = (file: File | undefined) => {
    if (!file || !onImage || !editor) return;
    setPicturing(true); setPictureSaid("");
    onImage(file)
      .then(({ src, alt }) => { editor.chain().focus().insertContent({ type: "image", attrs: { src, alt } }).run(); })
      .catch((e) => setPictureSaid(String((e as Error)?.message ?? e)))
      .finally(() => { setPicturing(false); if (picker.current) picker.current.value = ""; });
  };
  const [address, setAddress] = useState("");
  const linked = kind.linkHref ? kind.linkHref(address.trim()) : null;

  const setBlock = (b: string) => {
    if (!editor || !b) return;
    const c = editor.chain().focus();
    (b === "text" ? c.setParagraph() : c.setHeading({ level: Number(b.slice(1)) as Level })).run();
  };
  const putLink = () => {
    if (!editor || !linked) return;
    const c = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      c.insertContent({ type: "text", text: linked, marks: [{ type: "link", attrs: { href: linked } }] }).run();
    } else c.setLink({ href: linked }).run();
    setLinking(false); setAddress("");
  };
  const on = (pressed: boolean | undefined) => (pressed ? "aug-btn-on" : undefined);
  // A toolbar button acts on the words chosen, so pressing it leaves the focus, and the choice, in the words. Before
  // this, the press moved focus to the button: a field that keeps its words when left (a dashboard note's, in the
  // panel) kept them, gave the editor its words back, and the choice was gone before Italic reached it (seen live,
  // 2026-11-24).
  const keep = (e: ReactMouseEvent) => e.preventDefault();
  // the field is left when focus goes somewhere that is not the field: its toolbar is part of it
  const left = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) blurred.current?.();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid={testId} onBlur={left}>
      <div role="toolbar" aria-label="Format" style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {kind.headings.length > 0 && (
          <SelectField bespoke aria-label="Heading" value={state?.block ?? ""} onChange={(e) => setBlock(e.target.value)}>
            <option value="" disabled>Heading…</option>
            {withUniqueKeys(kind.headings, (h) => `h${h.level}`).map(([key, h]) => <option key={key} value={`h${h.level}`}>{h.label}</option>)}
            <option value="text">Text</option>
          </SelectField>
        )}
        {withUniqueKeys(MARKS, (m) => m.name).map(([key, m]) => (
          <Button key={key} size="icon-xs" variant="outline" aria-label={m.label} title={m.label} aria-pressed={!!state?.[m.name]}
            className={on(state?.[m.name])} onMouseDown={keep}
            onClick={() => editor?.chain().focus()[m.name === "bold" ? "toggleBold" : "toggleItalic"]().run()}>
            <span style={{ fontWeight: m.text === "B" ? 700 : 400, fontStyle: m.text === "I" ? "italic" : "normal" }}>{m.text}</span>
          </Button>
        ))}
        {kind.lists && withUniqueKeys(LISTS, (l) => l.name).map(([key, l]) => (
          <Button key={key} size="icon-xs" variant="outline" aria-label={l.label} title={l.label} aria-pressed={!!state?.[l.name]}
            className={on(state?.[l.name])} onMouseDown={keep}
            onClick={() => editor?.chain().focus()[l.name === "bulletList" ? "toggleBulletList" : "toggleOrderedList"]().run()}>
            <Icon name={l.icon} size={13} />
          </Button>
        ))}
        {kind.linkHref && (
          <Button size="icon-xs" variant="outline" aria-label="Link" title="Link" aria-pressed={linking || !!state?.link}
            className={on(linking || state?.link)} onMouseDown={keep}
            onClick={() => {
              if (linking) { setLinking(false); return; }
              setAddress(String(editor?.getAttributes("link").href ?? ""));
              setLinking(true);
            }}>
            <Icon name="link" size={13} />
          </Button>
        )}
        {kind.imageShown && onImage && (
          <>
            <Button size="icon-xs" variant="outline" aria-label="Image" title="A picture: PNG, JPEG, GIF, WebP or SVG, up to 5 MB"
              disabled={picturing} onMouseDown={keep} onClick={() => picker.current?.click()}>
              <Icon name="image" size={13} />
            </Button>
            <input ref={picker} type="file" hidden aria-label="Choose a picture" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              onChange={(e) => picked(e.target.files?.[0])} />
          </>
        )}
        {kind.table && (
          <Button size="icon-xs" variant="outline" aria-label="Table" title="Table" disabled={!!state?.table} onMouseDown={keep}
            onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>
            <Icon name="table" size={13} />
          </Button>
        )}
        {linking && (
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
            <Input bespoke autoFocus aria-label="The link's address" placeholder={kind.linkHint ?? "https://…"} value={address}
              style={{ width: 280 } as CSSProperties} onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); putLink(); } if (e.key === "Escape") setLinking(false); }} />
            <Button size="xs" disabled={!linked} onClick={putLink}>Add link</Button>
            {state?.link && (
              <Button size="xs" variant="outline" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinking(false); }}>
                Remove
              </Button>
            )}
          </span>
        )}
        {max !== undefined && (
          <>
            <span style={{ flex: 1 }} />
            <span className="aug-fs-xs" style={{ color: value.length > max ? "var(--red4)" : "var(--t3)", fontVariantNumeric: "tabular-nums" }}>
              {formatCount(value.length)} / {formatCount(max)}
            </span>
          </>
        )}
      </div>
      {pictureSaid && <div className="aug-fs-sm" role="alert" style={{ color: "var(--red4)" }}>{pictureSaid}</div>}
      <EditorContent editor={editor} />
    </div>
  );
}
