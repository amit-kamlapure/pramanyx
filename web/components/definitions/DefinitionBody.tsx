"use client";

/**
 * A Definition's body, drawn: the Markdown its toolbar writes (`lib/definitionBody.ts`) — headings, paragraphs, lists,
 * bold and italic, links, tables. No images and no raw HTML: a Definition is read into answers, and the page vouches for
 * what it shows. A link to the web opens in a new tab; a link to a page of the app opens it in place.
 */
import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { openInApp } from "@/lib/addressOnce";
import { bodyHref } from "@/lib/definitionBody";

const ALLOWED = ["h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "a", "br", "code", "blockquote",
  "table", "thead", "tbody", "tr", "th", "td", "hr"];

type El = { children?: ReactNode };

const CELL = { padding: "6px 10px", textAlign: "left" as const, borderTop: "1px solid var(--b0)" };

const COMPONENTS = {
  h1: ({ children }: El) => <h2 className="aug-fs-h1" style={{ margin: "8px 0 2px", fontWeight: 600, color: "var(--t1)" }}>{children}</h2>,
  h2: ({ children }: El) => <h3 className="aug-fs-h2" style={{ margin: "8px 0 2px", fontWeight: 600, color: "var(--t1)" }}>{children}</h3>,
  h3: ({ children }: El) => <h4 className="aug-fs-ui" style={{ margin: "6px 0 2px", fontWeight: 600, color: "var(--t1)" }}>{children}</h4>,
  h4: ({ children }: El) => <h4 className="aug-fs-ui" style={{ margin: "6px 0 2px", fontWeight: 600, color: "var(--t2)" }}>{children}</h4>,
  p: ({ children }: El) => <p style={{ margin: 0 }}>{children}</p>,
  ul: ({ children }: El) => <ul style={{ margin: 0, paddingLeft: 20, listStyle: "disc" }}>{children}</ul>,
  ol: ({ children }: El) => <ol style={{ margin: 0, paddingLeft: 20, listStyle: "decimal" }}>{children}</ol>,
  li: ({ children }: El) => <li>{children}</li>,
  strong: ({ children }: El) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  em: ({ children }: El) => <em>{children}</em>,
  code: ({ children }: El) => <code style={{ fontFamily: "var(--font-mono)", background: "var(--gray-a3)", borderRadius: 4, padding: "0 4px" }}>{children}</code>,
  blockquote: ({ children }: El) => <blockquote style={{ margin: 0, paddingLeft: 12, color: "var(--t2)", boxShadow: "inset 2px 0 0 var(--b1)" }}>{children}</blockquote>,
  table: ({ children }: El) => <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", minWidth: 280 }}>{children}</table></div>,
  th: ({ children }: El) => <th className="aug-fs-sm" style={{ ...CELL, borderTop: 0, color: "var(--t3)", fontWeight: 600 }}>{children}</th>,
  td: ({ children }: El) => <td style={CELL}>{children}</td>,
  a: ({ children, href }: El & { href?: string }) => {
    const safe = bodyHref(href);
    if (!safe) return <span>{children}</span>;
    if (safe.inApp) {
      const open = (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); openInApp(safe.href);
      };
      return <a href={safe.href} onClick={open} style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>{children}</a>;
    }
    return <a href={safe.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>{children}</a>;
  },
};

export function DefinitionBody({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="aug-fs-ui" data-testid="definition-body"
      style={{ display: "flex", flexDirection: "column", gap: 8, color: "var(--t1)", lineHeight: 1.6, minWidth: 0, overflowWrap: "anywhere" }}>
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} allowedElements={ALLOWED} unwrapDisallowed components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
