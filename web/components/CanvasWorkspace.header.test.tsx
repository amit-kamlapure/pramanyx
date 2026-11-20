// @vitest-environment jsdom

/**
 * An open Data Canvas: its header, what it is for, and the chrome around what the person made.
 *
 * The canvas is for questions and deep analysis (Arc CT, §6 item 36(l)): Chat, its Briefing (Arc BC, 2026-10-30 — the
 * dataset's own edition for a canvas on every table, its own for one that names tables), History and Artifacts. A
 * dashboard is a person's, in the Briefing page. The header's give-and-take was fixed while the canvas
 * briefly had a fourth tab, and stands on its own. Redone to CLARITY (2026-10-12): the header says the name, what it is
 * in a line and its facts as chips; the landing no longer repeats them; a question asked many times is one history row;
 * a read that failed says so instead of showing an empty list.
 */
import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasWorkspace } from "@/components/CanvasWorkspace";
import { DEEP_ANALYSIS_MODE, type Canvas, type Connection } from "@/lib/api";

const api = vi.hoisted(() => ({
  getSystemFlags: vi.fn().mockResolvedValue({}),
  getCanvasHistory: vi.fn(),
  getCanvasArtifacts: vi.fn(),
  getCanvasDocuments: vi.fn(),
  cloneCanvas: vi.fn(),
}));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getSystemFlags: api.getSystemFlags,
  getCanvasHistory: api.getCanvasHistory,
  getCanvasArtifacts: api.getCanvasArtifacts,
  getCanvasDocuments: api.getCanvasDocuments,
  cloneCanvas: api.cloneCanvas,
  listDocuments: vi.fn().mockResolvedValue([]),
  deleteCanvasArtifact: vi.fn().mockResolvedValue(undefined),
  updateCanvas: vi.fn(),
}));
// The board is what the person made; the test holds what the canvas hands it — the landing — and nothing it draws.
vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: ({ capabilities, initialQuestion, initialMode }: { capabilities?: React.ReactNode; initialQuestion?: string; initialMode?: string }) =>
    <div data-testid="chat" data-question={initialQuestion} data-mode={initialMode}>{capabilities}</div>,
}));
vi.mock("@/components/brief/BriefingEdition", () => ({
  BriefingEdition: (p: { canvasId?: string; connectionId: string; workspaceId?: string; onDeepAnalysis?: (q: string) => void }) => (
    <div data-testid="edition" data-canvas={p.canvasId} data-conn={p.connectionId} data-workspace={p.workspaceId}>
      <span role="button" tabIndex={0} onClick={() => p.onDeepAnalysis?.("Why did returns fall?")}>Take it deeper</span>
    </div>
  ),
}));
vi.mock("@/components/HistoryDetailPanel", () => ({ HistoryDetailPanel: () => null }));
vi.mock("@/components/ConfigurePanel", () => ({ ConfigurePanel: () => <div data-testid="configure" /> }));
vi.mock("@/lib/canvasSharing", () => ({
  readCanvasSharing: vi.fn().mockResolvedValue({ sharing: "workspace", shared_with: [], maker: "ana", access: "own", why: "made it",
    may_change: true, people: ["bo"], groups: [] }),
  saveCanvasSharing: vi.fn(),
}));
vi.mock("@/lib/certification", async (original) => ({
  ...(await original<typeof import("@/lib/certification")>()),
  readCertification: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/components/LifecyclePanel", () => ({ LifecyclePanel: () => null }));

const CANVAS: Canvas = {
  id: "cv1", name: "Returns", description: "", is_legacy: false, created_at: "", updated_at: "",
  scopes: [{ connection_id: "thelook", schema_name: "thelook", tables: ["thelook.order_items"] }],
};
const CONNECTIONS = [{ id: "thelook", name: "theLook", conn_type: "bigquery" }] as unknown as Connection[];

beforeEach(() => {
  api.getCanvasHistory.mockReset().mockResolvedValue([]);
  api.getCanvasArtifacts.mockReset().mockResolvedValue([]);
  api.getCanvasDocuments.mockReset().mockResolvedValue([]);
});

const show = (canvas: Canvas = CANVAS, connections: Connection[] = CONNECTIONS, onOpenCanvas = vi.fn()) =>
  render(<Theme><CanvasWorkspace canvas={canvas} connections={connections} onClose={vi.fn()} onCanvasUpdate={vi.fn()} workspaceId="default"
    onOpenCanvas={onOpenCanvas} /></Theme>);
const more = async () => {
  fireEvent.keyDown(screen.getByTestId("canvas-more"), { key: "Enter" });
  return screen.findAllByRole("menuitem");
};
const settle = () => new Promise(r => setTimeout(r, 10));

describe("the Data Canvas", () => {
  // The user, 2026-11-20, beside another product's data space: one click to Configure, Settings folded into it with the
  // artifacts, no Briefing at the top left, Clone, Share and Certify, History as an icon, a new chat as a pencil.
  it("opens on the conversation, its doors on the header: a new conversation, History, Configure, Share and ⋮", async () => {
    show();
    await settle();
    for (const door of ["canvas-new-chat", "canvas-history-door", "canvas-configure", "canvas-share", "canvas-more"]) {
      expect(screen.getByTestId(door)).toBeInTheDocument();
    }
    expect(screen.getByTestId("canvas-new-chat")).toHaveAttribute("aria-label", "New conversation");
    for (const gone of ["Chat", "Briefing", "Artifacts", "Tools", "Settings…"]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();          // no row of views, no Tools menu
    }
    expect(screen.queryByTestId("canvas-to-chat")).toBeNull();                   // it is in the conversation already
    expect((await more()).map(i => i.textContent)).toEqual(["Briefing", "Clone", "Certify or deprecate…"]);
    expect(api.getSystemFlags).not.toHaveBeenCalled();
  });

  it("reads the canvas's Briefing only once it is opened from ⋮, and takes a question from it into deep analysis", async () => {
    show();
    await settle();
    expect(screen.queryByTestId("edition")).toBeNull();                                    // opening a canvas reads none
    fireEvent.click((await more()).find(i => i.textContent === "Briefing")!);
    const edition = await screen.findByTestId("edition");
    expect(edition.dataset).toMatchObject({ canvas: "cv1", conn: "thelook", workspace: "default" });
    expect(screen.getByTestId("canvas-to-chat")).toHaveTextContent("Conversation");       // the way back
    fireEvent.click(screen.getByRole("button", { name: "Take it deeper" }));
    expect(screen.queryByTestId("canvas-to-chat")).toBeNull();
    expect(screen.getByTestId("chat").dataset).toMatchObject({ question: "Why did returns fall?", mode: DEEP_ANALYSIS_MODE });
  });

  it("opens Configure on one click, and History is a door that toggles back to the conversation", () => {
    show();
    expect(screen.queryByTestId("configure")).toBeNull();
    fireEvent.click(screen.getByTestId("canvas-configure"));
    expect(screen.getByTestId("configure")).toBeInTheDocument();
    const history = screen.getByRole("button", { name: "History" });
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("canvas-back")).toHaveAttribute("title", "Back to all canvases");
  });

  it("clones it from ⋮ and opens the copy; a clone that fails says so", async () => {
    const onOpen = vi.fn();
    api.cloneCanvas.mockResolvedValueOnce({ ...CANVAS, id: "cv2", name: "Returns (copy)" });
    show(CANVAS, CONNECTIONS, onOpen);
    fireEvent.click((await more()).find(i => i.textContent === "Clone")!);
    await settle();
    expect(api.cloneCanvas).toHaveBeenCalledWith("cv1");
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "cv2" }));
    api.cloneCanvas.mockRejectedValueOnce(new Error('"Returns" is not shared with you.'));
    fireEvent.click((await more()).find(i => i.textContent === "Clone")!);
    expect(await screen.findByRole("alert")).toHaveTextContent('Not cloned — "Returns" is not shared with you.');
  });

  it("shares it from Share: who it is shared with, and its owner's choice", async () => {
    show({ ...CANVAS, created_by: "user:ana", access: "own" });
    fireEvent.click(screen.getByTestId("canvas-share"));
    const pop = await screen.findByTestId("canvas-share-pop");
    expect(pop).toHaveAttribute("aria-label", "Share · Returns");
    expect(await screen.findByText(/can read and edit this canvas/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Only people chosen" })).toBeInTheDocument();     // its owner may choose
  });

  it("certifies it from ⋮, the form opening beside its name", async () => {
    show();
    fireEvent.click((await more()).find(i => i.textContent === "Certify or deprecate…")!);
    expect(await screen.findByRole("button", { name: "Certified" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deprecated" })).toBeInTheDocument();
  });
});

describe("the header, when the row is short of room", () => {
  // jsdom measures nothing, so this holds what the row is TOLD to do; that it does it was seen
  // in a browser at 1176px, where a long name and four tabs had made the row wider than its
  // box and the workspace slid sideways under the sidebar.
  it("lets the description give way first, then the connection's chip, then the name — and nothing else", () => {
    show({ ...CANVAS, name: "E-Commerce Operations Overview", description: "Orders, items and returns for the online shop." });
    // on the landing the description is the landing's; in any other view it stands beside the name
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    const name = screen.getByTestId("canvas-name");
    expect(name).toHaveTextContent("E-Commerce Operations Overview");
    expect(name).toHaveAttribute("title", "E-Commerce Operations Overview");     // the whole name, on hover
    expect(name).toHaveStyle({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    expect(name).toHaveStyle({ minWidth: "64px", flexShrink: "1" });              // room for a word
    // What it is, in one line — the first to give way, whole on hover.
    const what = screen.getByTestId("canvas-what");
    expect(what).toHaveAttribute("title", "Orders, items and returns for the online shop.");
    // a basis of 0: it takes only the room the name and chips leave, so it never cuts the name
    expect(what).toHaveStyle({ minWidth: "0", flexGrow: "1", flexShrink: "1", flexBasis: "0%", overflow: "hidden", whiteSpace: "nowrap" });
    // The connection's chip gives way next, and says the whole of itself on hover.
    const chip = screen.getByTestId("canvas-connection");
    expect(chip).toHaveStyle({ flexShrink: "3", minWidth: "56px", overflow: "hidden" });
    expect(chip).toHaveAttribute("title", "theLook · BigQuery");
    expect(chip).toHaveTextContent("theLook");
    expect(screen.getByTestId("canvas-doors")).toHaveStyle({ flexShrink: "0" });
  });

  it("says a canvas's connection is gone, in amber, once the connections are known", () => {
    show({ ...CANVAS, scopes: [{ connection_id: "removed", schema_name: null, tables: [] }] });
    expect(screen.getByTestId("canvas-connection-gone")).toHaveTextContent("connection gone");
  });

  it("reads a connection of another workspace as there, not gone, and names it", () => {
    // 2026-10-12: judged against this workspace's connections alone, two live canvases read "connection gone".
    const other = { ...CONNECTIONS[0], id: "duck", name: "DuckDB", conn_type: "duckdb" } as Connection;
    render(<Theme><CanvasWorkspace canvas={{ ...CANVAS, scopes: [{ connection_id: "duck", schema_name: "main", tables: [] }] }}
      connections={CONNECTIONS} allConnections={[...CONNECTIONS, other]} onClose={vi.fn()} onCanvasUpdate={vi.fn()} /></Theme>);
    expect(screen.queryByTestId("canvas-connection-gone")).toBeNull();
    expect(screen.getByTestId("canvas-head")).toHaveTextContent("DuckDB");
  });

  it("says nothing is gone while the connections are not read yet", () => {
    show(CANVAS, []);
    expect(screen.queryByTestId("canvas-connection-gone")).toBeNull();
  });

  it("says a pinned document that was deleted, in amber", async () => {
    api.getCanvasDocuments.mockResolvedValue([{ doc_id: "d1", missing: false }, { doc_id: "d2", missing: true }]);
    show({ ...CANVAS, doc_ids: ["d1", "d2"] });
    expect(await screen.findByTestId("canvas-docs-missing")).toHaveTextContent("2 documents pinned · 1 deleted");
  });
});

describe("the landing", () => {
  // The user, 2026-11-20, beside another product's data space: "Are we in 1990?" … "DBX does so grand!" — it opened on a line
  // counting tables, with their names in a hover, over two chips naming a Quick/Agent choice the conversation no longer has.
  it("opens on the canvas itself: its name large, what it is for, and the tables it reads, named", () => {
    show({ ...CANVAS, description: "Orders, items and returns." });
    expect(screen.getByTestId("canvas-landing-name")).toHaveTextContent("Returns");
    expect(screen.getByTestId("canvas-landing-name")).toHaveClass("aug-fs-hero");
    expect(screen.getByTestId("canvas-landing-what")).toHaveTextContent("Orders, items and returns.");
    expect(screen.getByTestId("canvas-landing-reads")).toHaveTextContent("Reads 1 table · order_items");
    const landing = screen.getByTestId("canvas-landing");
    expect(landing).not.toHaveTextContent("Quick");
    expect(landing).not.toHaveTextContent("What do you want to know");
    expect(landing.querySelector("[title]")).toBeNull();                 // nothing it says hides in a hover
    // said once: while the landing says what the canvas is for, the header does not
    expect(screen.queryByTestId("canvas-what")).toBeNull();
  });

  it("names a table by its own name, with its schema only where two schemas share it, and shows the rest on asking", () => {
    const tables = ["luxexperience.customers", "main.customers", ...Array.from({ length: 12 }, (_, i) => `main.t${i + 1}`)];
    show({ ...CANVAS, scopes: [{ connection_id: "thelook", schema_name: null, tables }] });
    const reads = screen.getByTestId("canvas-landing-reads");
    expect(reads).toHaveTextContent("Reads 14 tables · luxexperience.customers · main.customers · t1 ·");
    expect(reads).not.toHaveTextContent("t9");
    fireEvent.click(screen.getByTestId("canvas-landing-all"));
    expect(reads).toHaveTextContent("t12");
    expect(screen.getByTestId("canvas-landing-all")).toHaveTextContent("Show fewer");
  });

  it("says a canvas over all of a connection reads every table of it", () => {
    show({ ...CANVAS, scopes: [{ connection_id: "thelook", schema_name: null, tables: [] }] });
    expect(screen.getByTestId("canvas-landing-reads")).toHaveTextContent("Reads every table of theLook.");
  });
});

describe("the history", () => {
  it("says a question asked many times once, with its count", async () => {
    const run = (id: string, at: string) => ({ id, question: "What was total revenue in July 2026?", status: "complete",
      started_at: at });
    api.getCanvasHistory.mockResolvedValue([run("r1", "2026-10-03T14:23:57Z"), run("r2", "2026-10-03T13:53:57Z"),
      run("r3", "2026-10-01T13:53:57Z")]);
    show();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const rows = await screen.findAllByTestId("canvas-history-row");
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId("canvas-history-count")).toHaveTextContent("×3");
    expect(screen.getByTestId("canvas-history-meta")).toHaveTextContent("3 runs · 1 question");
    // What it leaves out is said: other canvases' runs, and deep analyses that did not finish.
    expect(screen.getByTestId("canvas-history-scope")).toHaveAttribute("title",
      expect.stringContaining("did not finish"));
  });

  it("says a failed read failed — never that nothing was asked", async () => {
    api.getCanvasHistory.mockRejectedValue(new Error("history store locked"));
    show();
    expect(await screen.findByText(/Could not read this canvas's history — history store locked/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing asked on this canvas yet.")).toBeNull();
  });
});

describe("the artifacts, Configure's tab now", () => {
  it("says a failed read failed — never that nothing was saved", async () => {
    const { CanvasArtifacts } = await import("@/components/canvas/CanvasParts");
    api.getCanvasArtifacts.mockRejectedValue(new Error("Failed to fetch artifacts"));
    render(<Theme><CanvasArtifacts canvasId="cv1" /></Theme>);
    expect(await screen.findByText(/Could not read this canvas's artifacts/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing saved on this canvas yet.")).toBeNull();
  });
});

describe("inside the app's shell (2026-11-10)", () => {
  it("folds the line into the shell's rows, and \"‹ Data Canvas\" before the title is the way back", async () => {
    const { PageChromeProvider, PageHeader } = await import("@/components/shell/PageChrome");
    const onClose = vi.fn();
    render(
      <Theme>
        <PageChromeProvider pageKey="canvas-workspace">
          <PageHeader place={[{ label: "Ask", id: "canvases" }, { label: "Data Canvas", id: "canvases" }, { label: "Returns" }]}
            fallbackTitle="Returns" />
          <CanvasWorkspace canvas={{ ...CANVAS, description: "Orders and returns" }} connections={CONNECTIONS}
            onClose={onClose} onCanvasUpdate={vi.fn()} workspaceId="default" />
        </PageChromeProvider>
      </Theme>,
    );
    await settle();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Returns");
    expect(screen.queryByTestId("canvas-what")).toBeNull();            // the landing says what it is for…
    expect(screen.getByTestId("canvas-doors").closest(".aug-title-actions")).toBeTruthy();   // the doors, with the page's actions
    expect(document.querySelector(".aug-page-toolbar [data-testid='canvas-doors']")).toBeNull(); // no row of views under it
    expect(screen.queryByTestId("canvas-back")).toBeNull();            // the breadcrumb is the way back now
    fireEvent.click(screen.getByRole("button", { name: "Back to Data Canvas" }));
    expect(onClose).toHaveBeenCalledTimes(1);                           // as "← Data Canvas" did: the canvas is closed
    fireEvent.click(screen.getByRole("button", { name: "History" }));   // History is a door on the title row
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("canvas-what").closest(".aug-title-facts")).toBeTruthy();   // …away from it, the header
  });
});
