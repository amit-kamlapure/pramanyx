"use client";

/**
 * A Definition's body, drawn: the Markdown its toolbar writes (`lib/definitionBody.ts`) — headings, paragraphs, lists,
 * bold and italic, links, tables, and pictures uploaded to its connection (2026-11-24). No raw HTML and no picture from
 * anywhere else: a Definition is read into answers, the page vouches for what it shows, and a picture from another host
 * would tell that host who reads it. A link to the web opens in a new tab; a link to a page of the app opens it in place.
 */
import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { RichTextKind } from "@/components/ui/rich-text";
import { openInApp } from "@/lib/addressOnce";
import { getApiBase } from "@/lib/config";
import { bodyHref, keptImagePath } from "@/lib/definitionBody";

/** Where a picture a body keeps is read from: its connection's store, through the API, with the reader's own access. */
export function bodyImageUrl(src: string | null | undefined): string | null {
  const path = keptImagePath(src, getApiBase());
  return path ? `${getApiBase()}${path}` : null;
}

/** What a Definition's body may hold when written (`RichText`): what this reader draws — and an Area's description, which
 *  it draws too, holds less (`discover/AreaCuration.AREA_TEXT`). */
/** Prose a page shows under something's name — an Area's description, a metric's caveats: paragraphs, bold, italics,
 *  lists and links (the web or a page of the app), no heading and no table. Drawn by this reader too. */
export const PROSE_TEXT: RichTextKind = {
  headings: [], lists: true, table: false, code: false, quote: false, rule: false,
  linkHref: (h) => bodyHref(h)?.href ?? null, linkHint: "https://… or a page of the app (/?tab=…)",
};

export const DEFINITION_TEXT: RichTextKind = {
  headings: [{ label: "Heading", level: 2 }, { label: "Subheading", level: 3 }],
  lists: true, table: true, code: true, quote: true, rule: true,
  linkHref: (h) => bodyHref(h)?.href ?? null, linkHint: "https://… or a page of the app (/?tab=…)",
  imageShown: bodyImageUrl,
};

const ALLOWED = ["h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "a", "br", "code", "blockquote",
  "table", "thead", "tbody", "tr", "th", "td", "hr", "img"];

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
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => {
    const url = typeof src === "string" ? bodyImageUrl(src) : null;
    // a picture from anywhere but its connection's store is not drawn, and the page says so where it stood
    if (!url) return <span className="aug-fs-sm" style={{ color: "var(--t3)" }}>[a picture this page does not show{alt ? `: ${alt}` : ""}]</span>;
    // eslint-disable-next-line @next/next/no-img-element -- an uploaded file, read from the API with the reader's own access
    return <img src={url} alt={alt ?? ""} data-testid="definition-image" style={{ display: "block", maxWidth: "100%", height: "auto", borderRadius: "var(--r2)" }} />;
  },
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
