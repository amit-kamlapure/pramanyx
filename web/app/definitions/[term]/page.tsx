"use client";

/**
 * `/definitions/<word>?conn=<connection>[&area=<area>]`: what a business word means on a connection, as a page of its own
 * (`components/definitions/DefinitionView.tsx`, which the Semantic Layer also shows inside the app).
 *
 * Since 2026-11-17 (the ontology study): anyone drafts a word nobody has defined and owns it; its OWNER
 * edits and publishes it; anyone else's change is a SUGGESTED EDIT the owner accepts or declines, and the published
 * wording stands until then. One word may mean one thing in one area of the business and another in the next — each its own
 * definition, chosen here. It carries the other names people use for it and what it refers to. Opened beside an answer
 * that was given it (the coworker's right-hand pane), and where a person writes, suggests or publishes one.
 */
import { use } from "react";

import { DefinitionView } from "@/components/definitions/DefinitionView";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

// Opened in a frame or a new tab, where the workbench never installed the authenticated fetch — so the page
// installs it itself, before its first request (the install is idempotent).
if (typeof window !== "undefined") installAuthFetch(getApiBase());

function segment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function DefinitionRoute({ params, searchParams }: {
  params: Promise<{ term: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const term = segment(use(params).term);
  const query = use(searchParams);
  return <DefinitionView term={term} connection={typeof query.conn === "string" ? query.conn : ""}
    initialArea={typeof query.area === "string" ? query.area : ""} />;
}
