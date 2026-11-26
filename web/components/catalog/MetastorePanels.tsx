"use client";

/**
 * Catalog — metastore panels.
 *
 *  • VolumesPanel      — the governed unstructured tier: browse/create volumes,
 *                        upload/download/delete objects under a catalog.
 *  • PermissionsPanel  — workspace access to a catalog: membership ∪ explicit grants,
 *                        with grant/revoke of the explicit layer.
 *
 * Both wire to the /metastore endpoints. Styled with the app's .aug-* classes +
 * design tokens (var(--…)), matching CatalogScreen.
 */
import { useEffect, useState } from "react";
import { previewKind, TEXT_SHOWN, type PreviewKind } from "@/lib/filePreview";
import {
  createVolume, listVolumes, listVolumeObjects, uploadVolumeObject,
  deleteVolumeObject, volumeObjectContentUrl,
  getWorkspaces, listWorkspaceGrants, grantWorkspaceCatalog, revokeWorkspaceCatalog,
  type MetastoreVolume, type MetastoreVolumeObject, type Workspace,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── Volumes ────────────────────────────────────────────────────────────────────

export function VolumesPanel({ catalogId }: { catalogId: string }) {
  const [volumes, setVolumes] = useState<MetastoreVolume[]>([]);
  const [selected, setSelected] = useState<string>("");   // volume id
  const [objects, setObjects] = useState<MetastoreVolumeObject[]>([]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadVolumes = () => {
    listVolumes(catalogId)
      .then(vs => { setVolumes(vs); if (vs.length && !vs.find(v => v.id === selected)) setSelected(vs[0].id); })
      .catch(e => setErr(String(e.message ?? e)));
  };
  useEffect(() => { setSelected(""); loadVolumes(); /* eslint-disable-next-line */ }, [catalogId]);
  useEffect(() => { if (selected) listVolumeObjects(selected).then(setObjects).catch(() => setObjects([])); else setObjects([]); }, [selected]);

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true); setErr("");
    try { const v = await createVolume(catalogId, newName.trim()); setNewName(""); loadVolumes(); setSelected(v.id); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  const onUpload = async (file: File) => {
    if (!selected) return;
    setBusy(true); setErr("");
    try { await uploadVolumeObject(selected, file); listVolumeObjects(selected).then(setObjects); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  const onDelete = async (objId: string) => {
    await deleteVolumeObject(selected, objId);
    listVolumeObjects(selected).then(setObjects);
  };

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      {/* volume list — the one rule kept is between it and the objects, worked side by side (--divide, 2026-11-20) */}
      <div style={{ width: 220, borderRight: "0.5px solid var(--divide)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <Input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && create()} placeholder="New volume…"
              style={{ flex: 1 }} />
            <Button variant="default" size="xs" disabled={busy || !newName.trim()} onClick={create}>Add</Button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {volumes.length === 0 && <p style={{ padding: 12, fontSize: 11, color: "var(--t3)" }}>No volumes yet.</p>}
          {volumes.map(v => (
            <div key={v.id} onClick={() => setSelected(v.id)}
              style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "0.5px solid var(--b0)",
                background: v.id === selected ? "var(--bg-1)" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
              <IcoVolume />
              <span className="aug-fs-chrome" style={{ color: "var(--t1)", fontWeight: v.id === selected ? 600 : 400 }}>{v.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* object list for the selected volume */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!selected ? (
          <p style={{ padding: 20, fontSize: 12, color: "var(--t3)" }}>Select or create a volume to manage its objects.</p>
        ) : (
          <>
            <div style={{ padding: "10px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "var(--t2)" }}>{objects.length} object{objects.length !== 1 ? "s" : ""}</span>
              <label className="aug-btn aug-btn-sm aug-btn-primary" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Uploading…" : "Upload object"}
                <input type="file" style={{ display: "none" }} disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
            {err && <p style={{ padding: "8px 16px", fontSize: 11, color: "var(--red4)" }}>{err}</p>}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {objects.length === 0 && <p style={{ padding: 20, fontSize: 12, color: "var(--t3)" }}>No objects. Upload a file to get started.</p>}
              {objects.map(o => {
                const kind = previewKind(o.name, o.mime_type);
                const url = volumeObjectContentUrl(selected, o.id);
                return (
                  <div key={o.id} style={{ borderBottom: "0.5px solid var(--b0)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 130px 170px", padding: "10px 16px", alignItems: "center", gap: 8 }}>
                      <span className="aug-fs-chrome" style={{ color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                      <span className="aug-fs-xs" style={{ color: "var(--t3)", textAlign: "right" }}>{fmtBytes(o.size_bytes)}</span>
                      <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>{o.mime_type}</span>
                      <span style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                        {kind && (
                          <Button variant="ghost" size="xs" aria-expanded={previewing === o.id}
                            onClick={() => setPreviewing(p => (p === o.id ? null : o.id))}>
                            {previewing === o.id ? "Hide" : "Preview"}
                          </Button>
                        )}
                        <a href={url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: "var(--blue4)", textDecoration: "none" }}>Download</a>
                        <Button variant="ghost" size="xs" onClick={() => onDelete(o.id)} style={{ fontSize: 11, color: "var(--red4)", cursor: "pointer" }}>Delete</Button>
                      </span>
                    </div>
                    {kind && previewing === o.id && <ObjectPreview url={url} name={o.name} kind={kind} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A volume object shown as itself (C4, 2026-11-25): an image drawn, a PDF in the browser's viewer, text as written
 *  (the first 200 KB). Which is which is `previewKind`'s one rule; anything else is the download's. */
export function ObjectPreview({ url, name, kind }: { url: string; name: string; kind: PreviewKind }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (kind !== "text") return;
    let live = true;
    fetch(url).then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(t => { if (live) setText(t); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url, kind]);
  const box: React.CSSProperties = { margin: "0 16px 12px", borderRadius: "var(--r2)", background: "var(--bg-2)", maxHeight: "28rem", overflow: "auto" };
  if (kind === "image") return (
    <div style={{ ...box, padding: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored object the API serves, not a page asset */}
      <img src={url} alt={name} style={{ maxWidth: "100%", display: "block" }} />
    </div>
  );
  if (kind === "frame") return <iframe src={url} title={name} style={{ ...box, width: "calc(100% - 32px)", height: "28rem", border: 0, display: "block" }} />;
  if (failed) return <p className="aug-fs-xs" style={{ margin: "0 16px 12px", color: "var(--t3)" }}>It could not be read here — the download has it.</p>;
  if (text === null) return <p className="aug-fs-xs" style={{ margin: "0 16px 12px", color: "var(--t3)" }}>Reading it…</p>;
  return (
    <div style={box} data-testid="volume-object-text">
      <pre className="aug-fs-xs" style={{ margin: 0, padding: 10, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", color: "var(--t2)" }}>
        {text.slice(0, TEXT_SHOWN)}
      </pre>
      {text.length > TEXT_SHOWN && <p className="aug-fs-xs" style={{ margin: 0, padding: "0 10px 10px", color: "var(--t3)" }}>The first 200 KB — the download has the rest.</p>}
    </div>
  );
}

// ── Permissions (grants) ────────────────────────────────────────────────────────

export function PermissionsPanel({ catalogId }: { catalogId: string }) {
  const [rows, setRows] = useState<{ ws: Workspace; member: boolean; granted: boolean }[]>([]);
  const [busy, setBusy] = useState("");

  const load = async () => {
    const wss = await getWorkspaces();
    const out = await Promise.all(wss.map(async ws => {
      const granted = (await listWorkspaceGrants(ws.id).catch((): string[] => [])).includes(catalogId);
      return { ws, member: (ws.connection_ids || []).includes(catalogId), granted };
    }));
    setRows(out);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [catalogId]);

  const toggle = async (wsId: string, granted: boolean) => {
    setBusy(wsId);
    try {
      if (granted) await revokeWorkspaceCatalog(wsId, catalogId);
      else await grantWorkspaceCatalog(wsId, catalogId);
      await load();
    } catch (e) {
      // A silent failure skipped load() and the grant appeared unchanged.
      window.alert(e instanceof Error ? e.message : "Grant change failed");
    } finally { setBusy(""); }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
      <p style={{ fontSize: 12, color: "var(--t2)", marginBottom: 16, maxWidth: 620, lineHeight: 1.5 }}>
        Which workspaces can access this catalog. The gate is <b style={{ color: "var(--t1)" }}>membership ∪ explicit grants</b> —
        a member sees it via its connection list; an <b style={{ color: "var(--t1)" }}>explicit grant</b> adds access beyond membership and is durable across membership edits.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 110px", padding: "5px 4px", borderBottom: "0.5px solid var(--b1)" }}>
        {["Workspace", "Access", ""].map(h => (
          <span key={h} style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>{h}</span>
        ))}
      </div>
      {rows.map(({ ws, member, granted }) => (
        <div key={ws.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 110px", padding: "11px 4px", borderBottom: "0.5px solid var(--b0)", alignItems: "center" }}>
          <span className="aug-fs-chrome" style={{ color: "var(--t1)" }}>{ws.name}{ws.is_default ? " (default)" : ""}</span>
          <span style={{ display: "flex", gap: 6 }}>
            {member && <span className="aug-tag aug-tag-blue" style={{ fontSize: 11 }}>Member</span>}
            {granted && <span className="aug-tag aug-tag-green" style={{ fontSize: 11 }}>Granted</span>}
            {!member && !granted && <span style={{ fontSize: 11, color: "var(--t3)" }}>No access</span>}
          </span>
          <span style={{ justifySelf: "end" }}>
            {granted ? (
              <Button variant="ghost" size="xs" disabled={busy === ws.id} onClick={() => toggle(ws.id, true)}>Revoke</Button>
            ) : (
              <Button variant="default" size="xs" disabled={busy === ws.id} onClick={() => toggle(ws.id, false)}>Grant</Button>
            )}
          </span>
        </div>
      ))}
      {rows.length === 0 && <p style={{ padding: "16px 4px", fontSize: 12, color: "var(--t3)" }}>No workspaces.</p>}
    </div>
  );
}

function IcoVolume() {
  return (
    <span style={{ color: "var(--vio4)", flexShrink: 0, display: "inline-flex" }}>
      <Icon name="table" size={14} />
    </span>
  );
}
