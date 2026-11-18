"use client";

/**
 * A paged table's pages (study R26; the owner, 2026-11-18: "A paged table? Wonderful."): ‹ 1 2 3 4 5 … 16 › under the
 * rows, the page shown marked, each a button at rest. A table on a dashboard keeps its box's height and says how much
 * there is, where it scrolled inside its box or was cut.
 *
 * The count of pages is the table's own: from a total the read gave, or the rows held. A table that does not know
 * its total pages forward one at a time and draws no last page it cannot name.
 */
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** The pages drawn as numbers, and the gaps between them: never more than seven places. */
export function pagesShown(current: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap", pages];
  if (current >= pages - 3) return [1, "gap", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, "gap", current - 1, current, current + 1, "gap", pages];
}

export function NumberedPager({ page, pages, onPage, more = false, testid = "table-pager" }: {
  /** The page shown, from 1. */
  page: number;
  /** How many pages there are; null when the total is not known. */
  pages: number | null;
  onPage: (page: number) => void;
  /** With no known total: whether there is a page after this one. */
  more?: boolean;
  testid?: string;
}) {
  const hasNext = pages != null ? page < pages : more;
  if (pages != null && pages <= 1) return null;
  return (
    <nav aria-label="Pages" data-testid={testid} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <Button size="icon-xs" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="chevl" />
      </Button>
      {pages != null && pagesShown(page, pages).map((p, i) => p === "gap"
        ? <span key={`gap-${i}`} aria-hidden className="aug-fs-xs" style={{ color: "var(--t3)", padding: "0 2px" }}>…</span>
        : (
          <Button key={p} size="xs" variant={p === page ? "secondary" : "ghost"} aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`} onClick={() => p !== page && onPage(p)}
            style={{ minWidth: 24, paddingInline: 6, fontVariantNumeric: "tabular-nums" }}>
            {p}
          </Button>
        ))}
      <Button size="icon-xs" variant="ghost" aria-label="Next page" disabled={!hasNext} onClick={() => onPage(page + 1)}>
        <Icon name="chevr" />
      </Button>
    </nav>
  );
}
