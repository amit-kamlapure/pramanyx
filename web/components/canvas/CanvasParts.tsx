"use client";

/**
 * Two parts of a Data Canvas's Configure (the user, 2026-11-20: "Settings seems duplicate - add artefact to it as
 * subtab"): the documents pinned to it, and what was saved from its conversations. Both were their own places — the
 * pinned documents in a Settings pop-over beside Configure, the artifacts in a view of their own — and are Configure's
 * Documents and Artifacts tabs now.
 */
import { useEffect, useState } from "react";

import { Chip, Empty, Label, MUTED, NUM, ONE_LINE, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import {
  deleteCanvasArtifact, getCanvasArtifacts, getCanvasDocuments, listDocuments, updateCanvas,
  type Canvas, type CanvasArtifact, type CanvasDocument, type DocumentEntry,
} from "@/lib/api";
import { dayMonth } from "@/lib/canvasList";
import { formatCount } from "@/lib/format";

const HIDDEN_UNTIL_HOVER = "opacity-0 group-hover/run:opacity-100 focus-visible:opacity-100 transition-opacity";

/** Bind uploaded documents to this canvas.
 *
 *  A canvas scopes DATA — a connection, a schema, a set of tables. This is the prose
 *  that belongs with it: the spec, the policy, last quarter's report. Work done here
 *  is then grounded in both, without anyone having to hope a similarity search
 *  surfaces the right file.
 *
 *  Pinned, not restrictive. Binding a document ADDS it to what is always in reach and
 *  leaves the rest of the corpus searchable — unlike an agent's documents, which fence
 *  it in. The wording below says so, because the two are easy to confuse and the
 *  consequence of guessing wrong is a workspace that quietly sees less than expected. */
export function CanvasDocuments({ canvas, onSaved }: {
  canvas: Canvas;
  onSaved: (updated: Canvas) => void;
}) {
  const [pinned, setPinned] = useState<CanvasDocument[]>([]);
  const [all, setAll] = useState<DocumentEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCanvasDocuments(canvas.id).then(setPinned).catch(() => setPinned([]));
    listDocuments().then(setAll).catch(() => setAll([]));
  }, [canvas.id]);

  const setBinding = async (docIds: string[]) => {
    setBusy(true);
    try {
      onSaved(await updateCanvas(canvas.id, { doc_ids: docIds }));
      setPinned(await getCanvasDocuments(canvas.id));
    } catch {
      /* the tab stays as it was; the previous binding is still what is shown */
    } finally {
      setBusy(false);
    }
  };

  const pinnedIds = pinned.map(d => d.doc_id);
  const unpinned = all.filter(d => !pinnedIds.includes(d.doc_id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Label right={pinned.length ? <span style={NUM}>{formatCount(pinned.length)}</span> : undefined}>Pinned documents</Label>

      {pinned.length === 0 && (
        <Empty>None pinned · a pinned document is always in reach here; the rest stay searchable.</Empty>
      )}

      {pinned.map(doc => (
        <div key={doc.doc_id} className="aug-fs-sm" style={{ ...ROW, flexWrap: "nowrap" }}>
          {/* A binding whose document was deleted is SHOWN, not hidden — otherwise a
              workspace loses context with nothing to see. */}
          <span style={{ ...ONE_LINE, flex: 1, color: doc.missing ? "var(--t3)" : "var(--t2)" }}>
            {doc.missing ? doc.doc_id : (doc.title || doc.filename)}
          </span>
          {doc.missing && <Chip tone="amber">deleted</Chip>}
          <Button variant="ghost" size="xs" type="button" disabled={busy}
            onClick={() => setBinding(pinnedIds.filter(id => id !== doc.doc_id))}>
            Unpin
          </Button>
        </div>
      ))}

      {unpinned.length > 0 && (
        <SelectField value="" disabled={busy}
          onChange={e => { if (e.target.value) setBinding([...pinnedIds, e.target.value]); }}>
          <option value="">Pin a document…</option>
          {unpinned.map(doc => (
            <option key={doc.doc_id} value={doc.doc_id}>{doc.title || doc.filename}</option>
          ))}
        </SelectField>
      )}

      {all.length === 0 && <Empty>No documents uploaded yet — add them in Documents.</Empty>}
    </div>
  );
}

export function CanvasArtifacts({ canvasId }: { canvasId: string }) {
  const [items, setItems] = useState<CanvasArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed read used to read as "No artifacts saved yet".
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);

  useEffect(() => {
    setLoading(true);
    getCanvasArtifacts(canvasId)
      .then(list => { setItems(list); setFailed(null); })
      .catch(e => { setItems([]); setFailed(e instanceof Error ? e.message : String(e)); })
      .finally(() => setLoading(false));
  }, [canvasId, reload]);

  async function handleRemove(id: string) {
    setRemoving(id);
    setRemoveFailed(false);
    const prev = items;
    setItems(list => list.filter(it => it.id !== id));
    try { await deleteCanvasArtifact(canvasId, id); }
    catch { setItems(prev); setRemoveFailed(true); }
    finally { setRemoving(null); }
  }

  return (
    <div data-testid="canvas-artifacts" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Label right={items.length ? <span style={NUM}>{formatCount(items.length)}</span> : undefined}>Saved from its conversations</Label>
      <div data-testid="canvas-artifacts-card">
        {removeFailed && (
          <div role="alert" className="aug-fs-sm" style={{ color: "var(--t2)", marginBottom: 6 }}>
            Could not remove that artifact — it is still here.
          </div>
        )}
        {loading ? <Loading what="the artifacts" />
          : failed !== null ? <ReadFailed what="this canvas's artifacts" error={failed} onRetry={() => setReload(n => n + 1)} />
          : items.length === 0 ? <Empty>Nothing saved on this canvas yet.</Empty>
          : items.map((item, i) => (
            <div key={item.id} data-testid="canvas-artifact-row" className="group/run"
              style={{ ...(i ? RULE : {}), display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 12,
                alignItems: "center", padding: "7px 2px", opacity: removing === item.id ? 0.4 : 1 }}>
              <div style={{ ...ROW, flexWrap: "nowrap", minWidth: 0 }}>
                <span className="aug-fs-chrome" title={item.description || item.question || item.title}
                  style={{ ...ONE_LINE, color: "var(--t1)" }}>{item.title}</span>
                <Chip>{item.kind}</Chip>
              </div>
              <span className="aug-fs-sm" style={{ ...MUTED, ...NUM, whiteSpace: "nowrap" }}>
                {item.created_at ? dayMonth(item.created_at) : ""}
              </span>
              <Button variant="ghost" size="icon-xs" title="Remove artifact" aria-label={`Remove ${item.title}`}
                disabled={removing === item.id} className={HIDDEN_UNTIL_HOVER} onClick={() => handleRemove(item.id)}>
                <Icon name="trash" size={13} />
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}

