"use client";

/**
 * `/sheets/<id>`: a spreadsheet as a REFERENCED ASSET — what an answer read, opened beside it in the coworker's
 * right-hand pane. The sheet itself, with everything that works on it (search, filter, sort, copy, download, views)
 * and without the row that takes it somewhere else: no dashboard, sharing, ontology, combining or chat (the user,
 * 2026-11-14: "we are not showcasing a limited view of the UI, we are showing referenced assets"). A LAYOUT over
 * `SheetView`: same app, same tokens, same auth and the same sharing — a sheet not shared with the reader says so.
 */
import { use } from "react";
import { useRouter } from "next/navigation";

import { SheetView } from "@/components/sheets/SheetView";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

/** A segment may still arrive percent-encoded; a malformed one is used as written. */
function segment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function SheetRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <SheetView key={id} sheetId={segment(id)} asReference
        // A sheet a link column points at opens here, as an asset too; there is no list to go back to.
        onOpen={(next) => { if (next) router.push(`/sheets/${encodeURIComponent(next)}`); }}
        onBack={() => undefined} />
    </main>
  );
}
