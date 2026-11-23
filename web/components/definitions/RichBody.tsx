"use client";

/**
 * A Definition's body, written as it reads (the user, 2026-11-23) and kept as Markdown: the shared editor (`RichText`)
 * with what a Definition may hold (`DEFINITION_TEXT`, beside the reader that draws it). Every tool of the toolbar it
 * replaced is here — Heading, Subheading, Text, Bold, Italic, the two lists, Link and Table — with the count against the
 * body's bound.
 */
import { DEFINITION_TEXT } from "@/components/definitions/DefinitionBody";
import { RichText } from "@/components/ui/rich-text";
import { uploadDashboardImage } from "@/lib/api";
import { BODY_MAX, bodyImagePath } from "@/lib/definitionBody";

/** A picture taken into the connection's image store (the one a dashboard's pictures are kept in: one store), and the
 *  path the body keeps for it, named by its file. */
async function keepPicture(connection: string, file: File): Promise<{ src: string; alt: string }> {
  const stamp = await uploadDashboardImage(connection, file);
  return { src: bodyImagePath(connection, stamp.object), alt: (file.name || "picture").replace(/\.[a-z0-9]+$/i, "") };
}

export function RichBody({ value, onChange, connection }: { value: string; onChange: (markdown: string) => void; connection?: string }) {
  return (
    <div style={{ paddingTop: 10 }}>
      <RichText kind={DEFINITION_TEXT} label="What it means" placeholder="Write what it means, and how the business uses it"
        max={BODY_MAX} value={value} onChange={onChange} testId="definition-editor"
        onImage={connection ? (file) => keepPicture(connection, file) : undefined} />
    </div>
  );
}
