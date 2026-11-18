"use client";

/**
 * A dashboard read in from a file another place wrote out (the study's R22). The platform checks all of it first: what does not
 * resolve on this connection is said by name, and nothing is made.
 */
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { importDashboard } from "@/lib/api";

export function ImportDashboard({ connectionId, onImported, onRefused }: {
  connectionId: string;
  onImported: (dashboardId: string, title: string) => void;
  onRefused: (sentences: string[]) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const read = async (file: File) => {
    setReading(true);
    try {
      let doc: unknown;
      try { doc = JSON.parse(await file.text()); } catch { onRefused([`${file.name} is not a JSON file.`]); return; }
      const out = await importDashboard(connectionId, doc);
      if (out.imported) onImported(out.cockpit_id, out.title);
      else onRefused(out.sentences);
    } catch (e) {
      onRefused([(e as Error).message]);
    } finally {
      setReading(false);
      if (box.current) box.current.value = "";
    }
  };
  return (
    <>
      <input ref={box} type="file" accept="application/json,.json" hidden aria-label="A dashboard file" data-testid="dashboard-import-file"
        onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); }} />
      <Button size="sm" variant="outline" data-testid="dashboard-import" disabled={reading} title="Read in a dashboard from a JSON file" onClick={() => box.current?.click()}>
        <Icon name="upload" size={14} /> {reading ? "Reading…" : "Import"}
      </Button>
    </>
  );
}
