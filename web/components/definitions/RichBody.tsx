"use client";

/**
 * A Definition's body, written as it reads (the user, 2026-11-23) and kept as Markdown: the shared editor (`RichText`)
 * with what a Definition may hold (`DEFINITION_TEXT`, beside the reader that draws it). Every tool of the toolbar it
 * replaced is here — Heading, Subheading, Text, Bold, Italic, the two lists, Link and Table — with the count against the
 * body's bound.
 */
import { DEFINITION_TEXT } from "@/components/definitions/DefinitionBody";
import { RichText } from "@/components/ui/rich-text";
import { BODY_MAX } from "@/lib/definitionBody";

export function RichBody({ value, onChange }: { value: string; onChange: (markdown: string) => void }) {
  return (
    <div style={{ paddingTop: 10 }}>
      <RichText kind={DEFINITION_TEXT} label="What it means" placeholder="Write what it means, and how the business uses it"
        max={BODY_MAX} value={value} onChange={onChange} testId="definition-editor" />
    </div>
  );
}
