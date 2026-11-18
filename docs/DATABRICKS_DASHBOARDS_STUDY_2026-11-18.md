# Databricks AI/BI Dashboards against ours — a study (2026-11-18)

The owner, 2026-11-18, of Databricks AI/BI Dashboards (formerly Lakeview): *"very editable, easy resizing and
formatting.. much to learn from it"* — and the ask that ours become equally good.

**Sources.**

- **Databricks.** Its public documentation only, AWS flavour, read 2026-11-18:
  - the `dashboards/` section and its sub-pages;
  - the AI/BI release notes for 2024–2026;
  - four Databricks blog posts.

  Every claim cites its page inline. The URL list is at the end.
- **The owner's two screenshots of the editor.** They are ground truth where the docs are silent (§1). Nothing was
  signed into, and no detail of ours was sent anywhere.

**Two cautions about the Databricks sources.**

- **They were read through a summarising fetch.** Re-check any number before building on it.
- **The docs conflict with each other in three places:**
  - row limits;
  - whether Gauge is a chart type;
  - the date Genie Code went GA.

**Ours.**

- **The code**, on `claude/answer-defects` at `17136ba`. The dashboard code there is byte-identical to `98511c5`, where
  the reading began. It covers:
  - `web/components/dashboards/`;
  - `web/lib/dashboards/`;
  - the chart editor in `web/components/charts/`;
  - `pramanyx/dashboards/` and `pramanyx/routers/dashboards.py`.
- **The live install, read over HTTP and read-only**: `GET /dashboards` and `GET /dashboards/{id}` with no period, so
  nothing ran. That gave 11 live dashboards of the default person, across four connections (§2.3).
- **The earlier studies**, so this one does not repeat them: `docs/OPENDASHBOARDS_STUDY.md` (the board study,
  2026-11-16) and `docs/GENIE_ONE_STUDY_2026-11-17.md`.

**Status words.**

- **Have**: we already do it.
- **Partial**: we do some of it.
- **Missing**: we do none of it.
- **Refused**: it conflicts with a standing rule of the platform.
- **Decision**: it conflicts with a decision the owner recorded, so only the owner can reopen it.

---

## 1 · Databricks' editor, as the screenshots and docs show it

**The top bar.**

- Left: the dashboard title and a star.
- Right: ⋮, bookmark, refresh ("1h ago"), the warehouse picker, **Publish** and **Share**.

**The tabs under the title.**

- **Data** comes first; it holds the datasets.
- The pages follow. Each page has its own ⋮, and **+** adds one.
- **Global filters** sits above the canvas.

**The canvas.**

- A 12-column grid (since 2026-02-12, six before: [RN 2026](https://docs.databricks.com/aws/en/ai-bi/release-notes/2026)).
  It can be subdivided into 3, 4 or 6
  ([design blog](https://www.databricks.com/blog/design-beautiful-dashboards-aibi)).
- Widgets are placed freely by x/y/width/height
  ([import/export](https://docs.databricks.com/aws/en/dashboards/automate/import-export); the bundle example's layout
  entries are `{widget, position:{x,y,width,height}}`).
- The screenshot shows all of these as widgets on the canvas:
  - a title written as a full-width text widget;
  - a date-range filter;
  - two counters;
  - a stacked bar, a line chart, a heatmap with a gradient legend and a donut;
  - a table with cells coloured by value and pages 1 … 16.

**A selected widget.**

- A thin blue outline.
- **Eight handles**: round corners, and pills at the middle of all four edges.
- **✦** (AI) and **⋮** at its top right.
- Drag handles for resizing and repositioning arrived 2026-01-08
  ([RN 2026](https://docs.databricks.com/aws/en/ai-bi/release-notes/2026)).

**The right panel for the selected widget.** In order:

1. **Widget**: Title ☑ and Description ☐.
2. **Visualization**: the type.
3. The dataset.
4. **Filters**: per-widget static filters.
5. **X axis**: a field chip with ⋮, plus + and −. A swap-axes icon follows.
6. **Y axis**.
7. **Color**: by field, with one swatch per value.
8. **Size**, **Marker** and **Pattern**.
9. **Line shape**: straight, smooth or step.
10. **Tooltip**, **Labels** (a toggle), **Facet** and **Annotation**. Each is a row with **+**.

With nothing selected, the panel shows the dashboard's **Settings**
([settings](https://docs.databricks.com/aws/en/dashboards/manage/settings)). The editor can be collapsed (2026-03-26).

**A floating toolbar at the canvas foot.** It holds, in order:

- AI assistant | select | add visualization | add text box | add filter | add image | undo | redo.

## 2 · Ours today — measured

### 2.1 The builder's anatomy

- **Two modes.** A dashboard opens to be read: View | Edit, History, Publish… and ⋯
  (`BriefingDashboards.tsx:1386`). **Edit** opens the builder (`DashboardBuilder.tsx:127`).
- **While editing:**
  - the left rail folds to its 48 px icons (`BriefingDashboards.tsx:992`, `tokens-v2.css:171`);
  - the shell draws no title row (`:1032`).
- **The builder is three panes:** `232px | canvas | 304px` (`DashboardBuilder.tsx:242`).

| Region | What it holds | Where |
|---|---|---|
| Edit bar (top) | The dashboard picker, **Editing**, "saved hh:mm · version n", Undo, Redo, Preview as a group, History, Publish/App, Retire, **Done** | `DashboardBuilder.tsx:443`, `BriefingDashboards.tsx:1198-1225` |
| Left pane | A **Layout \| Variables** switch (`:245`). **Layout** is the dashboard as a tree of lines (`LayoutTree`, `:78`). **Variables** lists sets, values and choices (`WiringSetup.tsx:191`). Below it, **Add**: "Add a piece" plus eight doors (Card, Note, Question, Image, Finding, From the ontology, Action buttons) (`BriefingDashboards.tsx:1228-1280`) | `DashboardBuilder.tsx:243-273` |
| Selection bar (above the canvas) | The chosen element's kind and name; Move earlier/later; Split (for a section); Duplicate; Take off; **Width** and **Height** steppers (− n +); the checks chip; Fit · n% | `DashboardBuilder.tsx:276-362` |
| Canvas | The dashboard drawn live, at least 1100 px wide, scaled to fit (`MIN_LAYOUT`, `:59`, `:200-204`). Above it, always: "change it in words" (AskChange) and any open composer | `DashboardBuilder.tsx:363-373`, `BriefingDashboards.tsx:1310-1350` |
| Right pane | The setup of the chosen element (`PieceSetup`), or History | `DashboardBuilder.tsx:376-385`, `PieceSetup.tsx:717` |

### 2.2 Resizing and moving — the mechanics

**The grid.**

- Twelve columns. Each row grade is 40 px: a 28 px row plus a 12 px gap (`catalog.ts:84`, `GRADE` `:92`).
- Every kind has a least and a most:

  | Kind | Width (columns) | Height (rows) |
  |---|---|---|
  | Card | 2–12 | 2–16 |
  | ObjectTable | 4–12 | 4–20 |
  | ObjectFigure | 2–6 | 2–4 |

  The full list is at `catalog.ts:100-119`.
- No element may take more than 30 rows (`MAX_ROWS`, `:96`).
- The spec stores grid units only, never pixels.

**Sections that have never been resized.**

- They are laid out by **named size**, not on the grid. The six sizes are small 1×1, wide 2×1, tall 1×2, large 2×2,
  full 3×1 and hero 3×2 (`catalog.ts:71-76`).
- The size is chosen with `SizePick` or a corner drag (`ComposedDashboard.tsx:460`).
- The first resize **moves the whole section onto the grid**. Every element is measured first, so what the reader saw
  is kept (`edit.ts:473` `regrid`).

**Resize handles** (`GridHandles`, `ComposedDashboard.tsx:530-591`):

- **Three handles**: the right edge (columns), the bottom edge (rows) and the bottom-right corner (both)
  (`:579-581`). There are no left or top handles.
- They are drawn **only on hover or focus**: `opacity-0 … group-hover:opacity-100` (`:524`). They are not tied to the
  piece being selected.
- They snap grade by grade within the kind's limits.
- While dragging, a live "w × h" readout shows. Off the grid, a dashed ghost shows where the piece will land
  (`:812-817`). On the grid there are no column guides.

**Keyboard.**

- Alt+arrows: one grade wider, narrower, taller or shorter.
- Alt+Shift+arrows: one place earlier or later (`:704`, `:791-810`).
- The − n + steppers in the selection bar do the same as Alt+arrows (`DashboardBuilder.tsx:111-123`, `:336-341`).

**Moving.**

- **By order, not by place.** A grip on the piece's header (`MoveGrip`, `:649-701`) drops it **before or after**
  another piece. A marker shows where; Escape cancels.
- Sections pack densely (`gridAutoFlow: "row dense"`, `:429-431`), so a later piece fills any hole.
- **There is no x/y.** A piece cannot be left at column 7 with an empty space beside it. This was the owner's call on
  2026-11-16: "drag-to-reorder with dense packing, not free x/y, so the spec format is unchanged"
  (`OPENDASHBOARDS_STUDY.md` §6.3).

**Keeping changes.**

- Every builder change is drawn at once. A burst of changes is kept as **one version**, 900 ms after the last
  (`BriefingDashboards.tsx:712`, `keepSoon` `:954-963`).
- **Undo and Redo** are buttons in the edit bar.
  - The stack holds 50 specs for one sitting (`:971`).
  - Each undo is kept as a version of its own (`:974-985`).
  - The stack is emptied on Done or when another dashboard is opened.
  - **No keyboard shortcut reaches it.**

**What else is missing in the builder.**

- No multi-select.
- No copy or paste.
- Delete does not take a piece off.
- Nothing de-selects a piece: no Escape, and no click on empty canvas. `choose` only ever sets one (`DashboardBuilder.tsx:173`).

**Narrow screens.**

- A section on the grid narrower than 560 px stacks its pieces into one column (`ComposedDashboard.tsx:268`).
- The builder draws the dashboard scaled. At 1600 px wide: 1600 − 48 (rail) − 232 − 304 − 32 (padding) = 984 px of
  canvas, under the 1100 px floor, so the dashboard draws at **about 89%**. At 1440 px it draws at about 75%. Only at
  1920 px is it 100%.

### 2.3 What the live dashboards hold

Read over HTTP from the running install: the 11 live dashboards of its default person, across four connections.

**Elements.**

| Count | What |
|---|---|
| 76 | non-structural elements |
| 53 | Cards (70% of those) |
| 5 | ObjectFigure |
| 3 | ObjectTable |
| 2 each | ObjectDetail, Note, Question |
| 1 each | ObjectChart, ObjectBreakdown, ProcessBoard, AddRow, ObjectFilters, QueryFilters |
| 3 | ActionButton (inside details) |

**Sections, sizes and pages.**

- 24 sections: **22 are still laid out by named size, and only 2 are on the 12-column grid**.
- Seven elements carry w × h.
- 32 carry a named size: wide 15, small 10, full 7.
- 4 of 11 dashboards use tabs (10 tabs in all).
- 0 images, 0 sets, 0 values.
- 0 dashboards are published.

**How the 53 placed cards are drawn.**

- **52 of 53 have no chart type set (auto)**. The other is a treemap.
- **Only 3 of 53 ever had a display setting changed:** labels on 2, orientation on 2, type on 1.
- 16 are a person's own query: figure 5, bar 5, table 4, line 2.

**What this means.** The resize and formatting machinery exists and is almost unused. Before blaming the users, ask
whether the doors are where a person looks. The resize handles appear only on hover. The chart's formatting sits one
tab behind "What it shows" (§3.2).

---

## 3 · Side by side

### 3.1 Canvas, layout and resizing

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Grid | 12 columns since 2026-02-12, 6 before ([RN 2026](https://docs.databricks.com/aws/en/ai-bi/release-notes/2026)). The docs give no row height | 12 columns, 40 px grades, per-kind limits (`catalog.ts:84`, `:100-119`) | **Have**; our limits are stricter and say why |
| Resize handles | Eight handles on the selected widget (screenshot); "drag handles for resizing and repositioning", 2026-01-08 | Three handles (right, bottom, corner), shown on hover or focus only (`ComposedDashboard.tsx:524`, `:579-581`) | **Partial** |
| Live size and snap | Snaps to the grid ([tutorial](https://docs.databricks.com/aws/en/dashboards/tutorials/create-dashboard): "use your mouse to arrange and resize") | Snaps grade by grade, reads out "w × h", dashed ghost off the grid; no column guides | **Have** (no guides) |
| Keyboard resize and move | None documented | Alt+arrows, Alt+Shift+arrows, − n + steppers | **Ahead** |
| Placement | Free x/y/w/h ([import/export](https://docs.databricks.com/aws/en/dashboards/automate/import-export)); Genie Code places into free space (2026-09-03) | By order with dense packing; no x/y (`ComposedDashboard.tsx:429`) | **Decision** (2026-11-16) |
| Move | Drag the widget | Drag by the header grip, before or after a piece (`:649`); ↑/↓ in the selection bar | **Have** |
| Multi-select | Cmd/Ctrl-click; the selection moves together (2026-08-20; [manage](https://docs.databricks.com/aws/en/dashboards/manage/)) | None | **Missing** |
| Clone | Right-click → Clone, placed below ([manage](https://docs.databricks.com/aws/en/dashboards/manage/)) | **Duplicate** in the selection bar (`DashboardBuilder.tsx:318-323`, `edit.ts:759`) | **Have** |
| Copy and paste | Cmd-C/V for a widget or a page, within a dashboard and across dashboards ([manage § keyboard shortcuts](https://docs.databricks.com/aws/en/dashboards/manage/)) | None. `canvasClipboard.ts` exists, for automations only | **Missing** |
| Shortcuts | Undo Cmd-Z, redo Cmd-Shift-Z (Cmd/Ctrl+Y per the [Oct 2025 roundup](https://www.databricks.com/blog/whats-new-aibi-october-2025-roundup)), copy, paste, Delete | Alt+arrows only | **Missing** |
| Undo and redo | Toolbar and keys, canvas since 2025-07-24; Data tab 2026-05-07; one step per Genie Code response ([RN 2025](https://docs.databricks.com/aws/en/ai-bi/release-notes/2025), [RN 2026](https://docs.databricks.com/aws/en/ai-bi/release-notes/2026)) | Edit-bar buttons, 50 steps per sitting, each undo kept as a version (`BriefingDashboards.tsx:971-985`) | **Partial** (no keys) |
| Structure | Flat canvas per page | Cockpit › Tabs › Tab › Section, and sections split into columns, rows or tabs up to 3 deep (`catalog.ts:86-91`); a layout tree | **Ahead** (and more to learn) |
| Canvas room | No left pane; the editor collapses | 232 px left pane plus 304 px right; the dashboard draws at ~89% at 1600 px (§2.2) | **Partial** |
| Mobile | Portrait reflows to one column; the author has no mobile editor ([concepts](https://docs.databricks.com/aws/en/dashboards/concepts)) | A section under 560 px stacks (`ComposedDashboard.tsx:268`) | **Have** |
| Limits | 15 pages, 100 widgets per page, 100 datasets ([limits](https://docs.databricks.com/aws/en/dashboards/limits)) | 8 tabs, 200 elements, 60 cards (`rules.ts:36-38`) | n/a |

### 3.2 Selecting and the inspector

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Select on click; a panel on the right | Yes ([visualizations](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/)) | Yes. A pointer-down anywhere in a piece chooses it (`ComposedDashboard.tsx:787`), and `PieceSetup` fills the right pane | **Have** |
| Nothing selected | The dashboard's Settings ([settings](https://docs.databricks.com/aws/en/dashboards/manage/settings)) | "Choose a piece…" (`PieceSetup.tsx:743-748`). The Cockpit line in the tree holds the name only | **Partial** |
| Widget title and description | Toggles; rich-text toolbar (20 fonts, alignment, links, Markdown); `@` live references (2026-09-17) | A card's title is the card store's. A placement has no title override and no description | **Missing** |
| One panel for a chart | Visualization, then encodings (X, Y, Color, Size, Marker, Pattern, Line shape, Tooltip, Labels, Facet, Annotation), each field with ⋮ for scale, transform and format | A card gets three tabs: **What it shows · Chart · SQL** (`PieceSetup.tsx:793-799`). **Chart** docks our `VizEditorPanel`: Visualization, X, Y (number format, axis title, aggregation), Color (field, scale, name, legend), Labels, Tooltip, Orientation, Transform, Annotation (`VizEditorPanel.tsx:244-406`). Object pieces have their own setups; a person's own query has `QuerySetup` | **Partial**: three inspectors for one concept (board study §6.2 #4), and formatting is a tab away |
| The statement behind a chart | Kebab → **View visualization query**, in draft ([manage](https://docs.databricks.com/aws/en/dashboards/manage/)) | The **SQL** tab: the statement as it RAN, its values bound beside it (`CardInspector.tsx:45`) | **Ahead** |
| Actions on the widget | ⋮ and ✦ on the selected widget; right-click menu | A fixed selection bar above the canvas. Tile doors (refresh, alert, evidence, take off, size) appear on hover only (`DashboardTile.tsx:198`) | **Partial**. The bar follows our rule; the hover-only doors break "an action looks like a button at rest" |
| Collapse the panel | Since 2026-03-26 | No | **Missing** |

### 3.3 Adding things

| Capability | Databricks | Ours | State |
|---|---|---|---|
| A canvas toolbar | Floating, at the canvas foot: AI, select, visualization, text, filter, image, undo, redo (screenshot; [tutorial](https://docs.databricks.com/aws/en/dashboards/tutorials/create-dashboard), [text](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/text-widgets), [image](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/image-widgets)) | The left pane's **Add**: "Add a piece" (a modal `PiecePicker`, `PiecePicker.tsx:302`) plus eight doors, each opening a composer above the canvas. Undo and redo sit in the top bar | **Partial**: two ways in, nine doors, one of them modal |
| Where a new thing lands | Dragged to a place, or put where there is room | Appended to the chosen section, or to the section the chosen piece is in (`DashboardBuilder.tsx:236-237`) | **Partial** |
| Add, then configure on the right | Drop a widget, then set it up in the panel | A picker or composer first; the piece is placed afterwards | **Partial** |

### 3.4 Visualization types and encodings

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Types | 22: area, bar, box, bubble, choropleth, cohort, combo, counter, custom (Vega-Lite, Preview), funnel, Gantt, heatmap, histogram, line, path map, pie, pivot, point map, Sankey, scatter, table, waterfall ([types](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/types)) | 31 kinds plus table and pivot in the answer engine (`chartTypeInference.ts:37-73`), among them lollipop, leaderboard, dumbbell, slope, bullet, cohort and interval. A person's own query draws 6 itself and the rest through the engine (`queries.py:24`, `CardInspector.tsx:75`) | **Ahead** in kinds |
| Line shape: straight, smooth, step | 2026-09-10 | None | **Missing** |
| Marker, pattern (dashed or dotted by field), size | Yes ([visualizations](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/)) | None for line markers or patterns | **Missing** |
| Axes | Range (default, per facet, custom), reverse, linear or log, format, label angle, sort (alphabetical, by field, custom drag up to 500), top N | Titles, orientation swap, number format. No range, log, sort or top N on a card (ObjectChart has `top` 3–6) | **Partial** |
| Annotations | Constant, aggregate or custom; horizontal or vertical; label and colour | Reference lines (value or average) in the editor (`VizEditorPanel.tsx:244`) | **Partial** |
| Facet | Grid or slideshow, up to 50 subcharts | The small-multiples kind | **Partial** |
| Labels, tooltip, legend | Labels per series; tooltip fields; legend top, bottom, left or right | Labels on or off; tooltip on or off; legend default, right, bottom, top or hidden (`ResultChartCard.tsx:63-65`) | **Have** |
| Dual axis | Combo with dual axis | Refused (`chartTypeInference.ts:44`, "§6 bans dual axes") | **Refused** (ours) |
| Forecast | AI Forecast on a line (Preview) | `line-forecast` with a band | **Have** |

### 3.5 Formatting

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Number format | Type (none, currency, percent); abbreviation (none, compact, scientific); decimals (max, exact, all, n); group separator; negatives as (123.45) since 2026-03-12; bytes; locale per dashboard ([visualizations](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/), [settings](https://docs.databricks.com/aws/en/dashboards/manage/settings)) | Eight d3 presets on a chart (`ResultChartCard.tsx:59-62`). A figure is written by its metric's unit (`DashboardTile.tsx:119` `figureText` → `formatMetric`). Object pieces: `number` or `money` (`catalog.ts:258`) | **Partial**. Our unit-driven default is better governed, but a person cannot set decimals or compact on a figure |
| Dates | Granularity in tables; DD-MM-YYYY (2026-02-26) | The house formatter only | **Partial** |
| Counter | Comparison (field and offset), conditional formatting, sparkline, a format template | Figure tile: the change against the compared window "at equal age", the limit and whether it is over it (red edge), the alert bell; trend tile with a sparkline (`DashboardTile.tsx:292`, `:411`) | **Have** (ahead on honesty) |
| Conditional formatting | Table font and background rules; colour scale on pivot values; counter rules ([tables](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/tables)) | Rows a **declared segment** admits, marked in a tone (`catalog.ts:283-287`); a figure over its limit; share bars in a breakdown. No colour scale or data bars on a table column | **Partial**. Ours is governed rules only |
| Table | Columns hidden by default; show, hide and reorder; row numbers; freeze N; rows per page; banded rows; header style; alignment; px width; image, HTML and JSON cells; link template `{{@}}`; search box | ObjectTable: up to 8 columns, sort, segment, marked rows, pages with "1–25 of N" (`OntologyPieces.tsx:824-830`); a rows table through the engine | **Partial** |
| Series colours | A hex/RGB picker per series; **consistent colours** for a value across widgets (2026-08-20); value → colour mapping in the theme (2026-09-03) | Six CVD-checked series slots (`palette.ts:31`); an org-level named palette (`chartPalettes.ts:8`, `OrgSettingsPanel.tsx:372`); colour by a field | **Partial**. No per-value colour, no consistency across cards |
| Themes and fonts | Per-dashboard theme (workspace, preset or custom); JSON import and export; the admin theme editor sets canvas background, widget border, radius, padding, margin, shadow and fonts for five categories ([settings](https://docs.databricks.com/aws/en/dashboards/manage/settings), [themes](https://docs.databricks.com/aws/en/ai-bi/admin/themes)) | One theme, light or dark, platform-wide | **Refused** (ONE theme; CLARITY no-shadow) |

### 3.6 Text and image widgets

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Text | Rich text and Markdown; headings; images by URL; tables (2026-01-15); vertical alignment; parameter references; 50,000 characters ([text](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/text-widgets)) | **Note**: a person's own words, Markdown subset only (`p ul ol li strong em a br`, `NoteProse.tsx:17`), 2,000 characters (`catalog.ts:65`), author and date stamped by the server; never a model's | **Partial**. **No headings**, so the screenshot's full-width title cannot be built |
| Image | Upload, URL or workspace image; PNG, JPEG, WebP, SVG; fit or fill; light and dark variants (2026-07-23, [image](https://docs.databricks.com/aws/en/dashboards/manage/visualizations/image-widgets)) | **Image**: upload of PNG, JPEG, GIF, WebP or SVG up to 5 MB, with a caption and a stamp (`BriefingDashboards.tsx:186`) | **Have** (no URL, fit/fill or dark variant) |

### 3.7 Filters, parameters, cross-filtering, drill

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Scopes | Global (a pane, every page), page (filter widgets), widget (static) ([filters](https://docs.databricks.com/aws/en/dashboards/manage/filters/)) | **Five mechanisms**, each reaching a different subset (below) | **Partial**: no single filter concept |
| Filter widget types | Single, multiple, date, date range, text entry, range slider; field vs parameter ([filter types](https://docs.databricks.com/aws/en/dashboards/manage/filter-types)) | Values with counts in a filter column; month grain on a query table; reader values (choices, typed, lists); sliders in a What-if; search | **Have** in kind |
| One filter over many datasets | Several fields, one per dataset; associative narrowing ([field filters](https://docs.databricks.com/aws/en/dashboards/manage/filters/field-filters)) | No | **Missing** |
| Ignored filters per widget | Global and page tiers (2026-09-24) | No. A card the focus cannot cut *says why* ("Not cut by …", board study S6) | **Partial** (ours is honest, but not chosen) |
| Active filter bar | Every non-All filter and every cross-filter, each clearable (2026-03-12, 2026-04-02) | `FocusBar` shows cross-filter chips only (`ComposedDashboard.tsx:1241`). Object ticks have their own `FilterBar`; values their own `ValuesBar` | **Partial** |
| Apply button, defaults, URL state | Instantly or with an Apply button; default values; `f_<page>~<widget>=` in the URL | Defaults in the values; focus kept in the reader's browser per dashboard (`focus.ts`) | **Partial** |
| Cross-filtering | Click a mark or a legend item; most chart types; line, area and combo since 2026-06-11 | A click is traced off the card's own SQL to a table and column, and every other card is re-asked server-side, at most 6 values (`focus.ts:16`) | **Have**, narrow: 1 of 11 cards cut on theLook until a join can be cut through |
| Drill-through | Right-click → **Drill to** a page, its filters prefilled | A **Drawer** opens beside the page on a chosen object; ObjectDetail; "Why" opens the finding | **Partial**: no drill to a tab |
| Parameters | `:keyword`; string, date, number, ranges, multi; static per widget ([parameters](https://docs.databricks.com/aws/en/dashboards/manage/filters/parameters)) | Values `{{name}}` read by a query or a set's condition. A reader control nothing reads is refused at publish (board study L1) | **Have** (ahead on refusing dead controls) |
| Field-swap variables | ([variables](https://docs.databricks.com/aws/en/dashboards/manage/filters/dashboard-variables)) | No | **Missing** (low) |

The five filter mechanisms:

1. The **period** (`PeriodPicker.tsx:19-29`) cuts every card.
2. The **filter column**, either `ObjectFilters` (an entity's pieces) or `QueryFilters` (the query cards that read the
   table) (`ComposedDashboard.tsx:165-217`).
3. **Reader values** (`ValuesBar`).
4. **Search** (`ObjectSearch`).
5. **Focus**, the cross-filter.

### 3.8 Pages and data

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Pages | Up to 15; + to add; double-click to rename; clone; delete; copy and paste; **Hide from published** (2026-08-27) ([manage](https://docs.databricks.com/aws/en/dashboards/manage/)) | Tabs, up to 8 (`rules.ts:37`). **The builder cannot add one.** A section's "In the tab" picks only tabs that exist (`PieceSetup.tsx:779`). Only the review of a model's draft offers "A new tab…" (`DashboardArrange.tsx:155`) | **Partial** (a door is missing) |
| Data tab | Datasets (SQL, UC table, metric view, local metric view, upload), each with a results table; relationships GA 2026-10-29; custom calculations, up to 200 per dataset ([datasets](https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/datasets), [calculations](https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/custom-calculations/)) | Cards in the card store, each its own guarded SQL, approved metric or finding. The **Variables** tab holds sets, values and choices. No shared dataset feeds several widgets | **Partial**. Governed by design; no Data view of every statement |
| Conditional visibility | None | A section, card, note or image may be shown by a condition, and says how many wait on one (`catalog.ts:635`) | **Ahead** |

### 3.9 AI on a dashboard

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Authoring agent | **Genie Code** in a side pane: datasets, every visualization option, filters, pages, layout, "beautify"; Allow/Decline approvals; each response one undo step ([agent](https://docs.databricks.com/aws/en/dashboards/manage/dashboard-agent)) | **AskChange**, always shown above the canvas: one model run, a staged proposal kept or discarded; never writes a note or picks an image (`BriefingDashboards.tsx:514`, `pramanyx/dashboards/ask.py`). **New dashboard** drafts from an area in words | **Partial**. Ours is safer (a proposal, re-validated); no per-widget scope and no step |
| ✦ on a widget | On the selected widget (screenshot) | None | **Missing** |
| Ask Genie (readers) | On published dashboards; scoped to one chart; "explain this change"; up to 30 datasets; reads whole datasets ([Genie](https://docs.databricks.com/aws/en/dashboards/genie-spaces)) | "Ask about these / this set" on object pieces opens the Data Canvas (`AskAbout.tsx`); a **Question** piece answered on a rhythm; "Why" opens the finding | **Partial**. No "ask about this dashboard" or "this card" |

### 3.10 Lifecycle

| Capability | Databricks | Ours | State |
|---|---|---|---|
| Draft and published | Autosaved draft; publish a snapshot with an optional changelog; **Discard changes** ([concepts](https://docs.databricks.com/aws/en/dashboards/concepts), [manage](https://docs.databricks.com/aws/en/dashboards/manage/)) | Every burst is a version; publishing to groups or roles is a version; readers read the version last published; "Draft · readers see version n" (`versions.py` header, `PublishPanel` `BriefingDashboards.tsx:569`) | **Have** |
| Version history | **No UI.** Discard changes, a revert API, Git folders ([git](https://docs.databricks.com/aws/en/dashboards/automate/git-support)) | History: each version with what changed, in words, and **Go back to this** (`BriefingDashboards.tsx:1092-1124`) | **Ahead** |
| Sharing | CAN VIEW, RUN, EDIT, MANAGE; account users view-only; individual vs shared data permissions ([share](https://docs.databricks.com/aws/en/dashboards/share/share)) | Publish to groups you belong to or roles you hold; read-only for readers; "Start my dashboard from this". **Preview as a group** shows what row policies and masks withhold | **Partial** (no co-editing); **ahead** on preview |
| Schedules and subscriptions | Email PDF; Slack and Teams PNG plus PDF; CSV or Excel per widget; up to 100 subscribers; 9 MB ([schedule](https://docs.databricks.com/aws/en/dashboards/share/schedule-subscribe)) | Briefing subscriptions exist (`routers/briefs.py`). **Dashboards have none.** PDF export exists for reports (`pramanyx/export/pdf.py`) | **Missing** |
| Export and import | `.lvdash.json`; REST API; bundles ([import/export](https://docs.databricks.com/aws/en/dashboards/automate/import-export), [API](https://docs.databricks.com/api/workspace/lakeview)) | The spec is already JSON (json-render). No export or import door | **Missing** |
| Downloads | Per widget: CSV, TSV, Excel, PNG; PDF of pages | PNG from the chart editor only | **Partial** |
| Embedding | iframe, and external with tokens ([embedding](https://docs.databricks.com/aws/en/dashboards/share/embedding/)) | None for dashboards (`web/app/embed/` holds agents only) | **Missing** (low) |
| Refresh, favourite | Refresh "1h ago"; star; bookmarks (10 shared, 20 private) | **Read again** and "last read …"; no star | **Partial** |
| Certification | No | Certified or Deprecated by a curator (`CertificationMark`, `BriefingDashboards.tsx:1383`) | **Ahead** |

### 3.11 Where we are already ahead — keep these through any redesign

| Ours | Why it matters | Where |
|---|---|---|
| Every number is a governed card (approved metric, trusted query or finding) run through the guards | Databricks' viewers "can access all data in a dataset", columns no chart shows included ([datasets](https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/datasets)) | `pramanyx/dashboards/cards.py`, `routers/cards.py:401` |
| History in words, and any version restored | Databricks has no history UI | `versions.py`, `BriefingDashboards.tsx:1092` |
| Preview as a group, with what is withheld said | Databricks' filters "are not access control" ([filters](https://docs.databricks.com/aws/en/dashboards/manage/filters/)) | `BriefingDashboards.tsx:1207`, `:1310-1328` |
| The checks chip: what read cleanly, what is still reading, what to fix | A broken widget is found before readers find it | `DashboardBuilder.tsx:393` |
| "Not cut by X: why" on a card a filter cannot reach | Withheld is said, never implied | board study §6.3 S6 |
| The layout tree, keyboard resize and move, refused changes said in the rules' own words | Precision and accessibility | `DashboardBuilder.tsx:78`, `:176-183` |
| Ontology release pinning; conditional sections; process boards, object pieces, action buttons, What-if, add-a-row | Operational apps, not just charts | `PinStrip.tsx`, `catalog.ts` |
| A period said as final, provisional or to date; a change compared at equal age | "A dashboard's figures are only for its own period" | `PeriodPicker.tsx`, `DashboardTile.tsx:226` |

---

## 4 · What the comparison found

1. **Resizing is fine underneath and hard to find on top.** The grid, limits, snap, readout and keyboard are as good
   as Databricks'. But:
   - the handles are three, not eight;
   - they show only on hover, not on selection;
   - live, 22 of 24 sections have never been resized onto the grid.
2. **There is no canvas toolbar.** Adding is nine doors in a side pane. One of them opens a modal picker, and the
   others open composers above the canvas. Databricks adds with four buttons and configures on the right.
3. **No keyboard for editing.** Undo, redo, delete, duplicate, copy, paste and escape are all mouse-only. Databricks
   has the standard set.
4. **Formatting is a tab away and thin.**
   - The card's chart editor is behind **Chart**, and 3 of 53 live cards were ever formatted.
   - Missing outright: per-widget titles and descriptions, decimals and compact on a figure, per-value colours,
     consistent colours across cards, line shape, markers, axis range, log scale, sort, and conditional colour scales
     or data bars on table columns.
5. **Three inspectors for one concept.** An answer's `VizConfig`, a person's own query's `shown`, and each object
   piece's props. Databricks has one panel shape for every chart.
6. **Filters are five mechanisms, with no single bar.** A reader cannot see in one place everything a dashboard is
   cut by. Nor is there one filter that narrows cards and pieces alike.
7. **Pages exist, but the builder cannot add one.** The door is only in the review of a model's draft.
8. **The canvas loses room to the left pane.** At 1600 px the dashboard draws at about 89%.
9. **No subscriptions, export, import or per-widget download.** These are lifecycle gaps, behind the editing ones.
10. **AI is one input box.** Databricks scopes AI to a widget (✦) and to a reader's question (Ask Genie). Our proposal
    flow is the safer engine to put behind both.

---

## 5 · Recommendations, ranked

**Sizes.**

- **S**: about a day.
- **M**: two to four days.
- **L**: a week or more.

**What every slice must do.** It merges on, with no flag. It is shown working on theLook before its PR, and a frontend
change passes the four gates.

**The rule column checks each item against the platform's standing rules.**

- The rail stays.
- ONE theme.
- No flags.
- Full width.
- No pop-up on every click.
- An action looks like a button at rest.
- Frames only around exhibits, fields, buttons and code.
- A feature may move but never vanish.
- No Data Canvas in the coworker.
- A dashboard's figures are only for its own period.

| # | What a person sees | Why | Where in our code | Size | Depends on | Rule check |
|---|---|---|---|---|---|---|
| **R1** | **The selected piece wears eight handles at rest:** four corners and four mid-edge pills, in the accent. Other pieces show them faintly on hover. A left or top drag changes the width or height just as the right or bottom does (the piece keeps its place in the flow, and the handle's title says so) | The owner's "easy resizing". Only 2 of 24 live sections were ever resized | `ComposedDashboard.tsx` `GridHandles` `:530-591`, `HANDLE` `:524`, `Cell` `:712`, keyed on `selected` (in context already) | S | — | Fixes a breach of *an action looks like a button at rest* |
| **R2** | **A canvas toolbar docked at the canvas foot:** Ask · Add chart · Add text · Add filter · Add image · Undo · Redo, plus "More" for Question, Action buttons, Finding and Your own query. **Add places, then configures.** A new piece is placed in the chosen section and chosen, and the right panel asks what it shows (the picker's list, drawn in the panel) | Databricks' four-button flow. Retires the modal picker and the nine side-pane doors | A new `CanvasToolbar` in `DashboardBuilder.tsx` beside `builder-canvas` (`:363`). Handlers from `BriefingDashboards.tsx:1228-1280`. `PiecePicker` rendered in the panel instead of a `Dialog` (`PiecePicker.tsx:302`). Undo and redo mirrored from the `EditBar` | M | R6 for the panel | Same surface and theme, hairline, **no shadow** (CLARITY), a fixed bar not a pop-up. The Add list **moves** into it and vanishes from nothing |
| **R3** | **Keyboard:** ⌘/Ctrl-Z undo; ⇧⌘Z or Ctrl-Y redo; Delete or Backspace takes the piece off (undoable); ⌘D duplicates; Esc lets go of the selection, a second Esc chooses its section; ⌘C/⌘V copy and paste a piece within the dashboard and into another of the person's | Standard editor muscle memory, all in Databricks' documented set | A keydown on the builder root that ignores inputs. Reuses `duplicate` (`edit.ts:759`), `takeOffAll` (`:583`), `undo`/`redo` (`BriefingDashboards.tsx:974-985`). Clipboard as module state, like `lib/canvasClipboard.ts`. A pasted Card is the same card id; a pasted Note is re-stamped as the paster's | S (paste across dashboards M) | — | — |
| **R4** | **A click in the builder chooses; it does not filter.** Today a click on a bar both chooses the card (`ComposedDashboard.tsx:787`) and sets the focus, re-running every other card. Cross-filtering stays live in View, and in the builder by Alt-click | Choosing a chart should not reshape the dashboard under the author | `BriefingDashboards.tsx` passes `focus`/`onFocus` to the builder's `ComposedDashboard` (`:1358-1360`) | S | Check on the page first: measured in code only | — |
| **R5** | **Column guides while dragging:** twelve faint columns and the row grades of the section under the drag, in the builder only | Shows where the snap lands. The ghost exists only off the grid today | `GridHandles` and `MoveGrip` in `ComposedDashboard.tsx` | S | R1 | The guides are not frames: a 1 px tint, gone on release |
| **R6** | **One panel for a chosen card that opens on its look.** The order: **Widget** (title shown, title override, description), **Visualization**, the encodings, **Format**, then **Setup** (edge, section, query setup) and **SQL** below or as tabs. With nothing chosen: the dashboard's settings (name, period default, filter column) | Formatting is a tab away today, and 3 of 53 live cards were ever formatted | `PieceSetup.tsx:790-812`; `CardInspector.tsx` `ChartDock`; `VizEditorPanel` docked | S–M | R7 for title and description | A panel, not a pop-up |
| **R7** | **The left pane folds to a strip.** The layout tree and Variables stay one click away, so the canvas gets 232 px back and draws at 100% from about 1400 px | Full-width pages; Databricks has no left pane | `DashboardBuilder.tsx:242`, the grid template | S | — | The feature moves (a fold), never vanishes |
| **R8** | **A placement's own title and description:** a title (defaulting to the card's) that can be hidden, and a description in the Note subset | The screenshot's Title ☑ / Description ☐ | Catalog v14: `Card` gains `title`, `description`, `show_title` (`catalog.ts:324-331`); `validate.py` holds a model-written title to the numerals law (`READER_TEXT`, `catalog.ts:640`); `Title` in `DashboardTile.tsx:172` | M | — | A person's words, stamped like a Note |
| **R9** | **Number format per placement:** decimals (auto, 0, 1, 2), compact (K, M, B), negatives in parentheses. Percent and currency are offered only where the metric's unit is one; the currency symbol is the organisation's | Today a figure cannot be shown as "$1.2M" or to one decimal | `VizConfig` (`vizConfig.ts:26`) gains structured fields in place of the d3 presets (`ResultChartCard.tsx:59-62`); `figureText` (`DashboardTile.tsx:119`); `FIGURE_FORMATS` (`catalog.ts:258`) | M | — | Display only: the unit stays the metric's, and a ratio is never written as money |
| **R10** | **Conditional colour on tables and figures, from governed rules only:** a colour scale or data bar on a numeric column (the screenshot's table); cells and figures coloured by the metric's warning and critical thresholds; rows by a declared segment (have) | The screenshot's most visible formatting | `ObjectTablePiece` (`OntologyPieces.tsx:683`), the rows table in `ResultChartCard`, `limitsOf` (`DashboardTile.tsx:111`) | M | — | Colours from the six series or the tones, never a free hex. No ad-hoc formula: the rule is a threshold or a segment the ontology declares |
| **R11** | **Colour per value, the same on every card:** the Color channel lists each value with its swatch (the screenshot); a choice is kept on the dashboard and every card colouring by that field honours it | Consistent colours (Databricks, 2026-08-20) | Spec gains `colors: {field: {value: slot}}`; `VizEditorPanel` Color channel (`:374-386`); the Vega config | M | — | Slots from the CVD-checked palette only (`palette.ts`, `lint:palette`). A mapping, not a theme |
| **R12** | **Chart options we lack:** line shape (straight, smooth, step); markers; dashed by field; axis range and log; category sort; top N on any card; a legend click that filters | Every one is a row in the screenshot's panel | `vega/forms.ts`, `VizConfig`, `VizEditorPanel` channels | S each | R6 | Dual axes stay refused |
| **R13** | **Headings in a Note** (two levels), so a full-width title or a section header is a Note. The 2,000 cap, links and the no-images rule stay | The screenshot's title widget | `NoteProse.tsx:17` (`ALLOWED`) | S | — | A person's own words. Frames only around exhibits: a heading note draws no frame |
| **R14** | **One "Filtered by" bar:** the period, filter-column ticks, reader values, search words and cross-filter chips, each clearable, and Clear all | A reader sees in one place everything the dashboard is cut by | Merge `FocusBar` (`ComposedDashboard.tsx:1241`), `FilterBar` and `ValuesBar` | M | — | Withheld is said. The period is always shown |
| **R15** | **"Not cut by the dashboard's filters"** chosen per card, and said on it | Databricks' ignored filters | A Card prop; the focus run skips it; `NotFiltered` says it | S | R14 | Said, never implied |
| **R16** | **Cut through a join**, so a click on a channel reaches revenue | The cross-filter cuts 1 of 11 cards on theLook | `pramanyx/dashboards/focus.py` with the declared relationships | M | — | Says which column it used (board study §6.3) |
| **R17** | **Open on a tab with this chosen:** when a mark is chosen, the bar offers "Open on ‹tab›" | Databricks' drill-through, without a context menu | `focus.ts` (the focus already spans tabs), `DashboardTabs` (`ComposedDashboard.tsx:219`) | S–M | R14, R18 | In the fixed bar, not a pop-up |
| **R18** | **Pages in the builder:** the tabs above the canvas with **+**; double-click to rename; in the selection bar, duplicate page, take off, **Hide from readers** | The builder cannot add a page today | `DashboardBuilder.tsx`; `moveSectionToNewTab` (`edit.ts:525`); a Tab prop `hidden` (catalog v14) honoured by the published read | S–M | — | The draft review's "A new tab…" stays (it moves, it does not vanish) |
| **R19** | **Change this in words (✦):** AskChange scoped to the chosen piece, from the toolbar's Ask or the selection bar. A kept proposal is one undo step | The screenshot's ✦; Genie Code's undo unit | `ask.py` gains a target key; `AskChange` moves into the right panel | S–M | R2 | It never writes a note or picks an image (existing law). The panel, not a pop-up |
| **R20** | **Ask about this dashboard or this card** (readers): opens the Data Canvas with the cards and the period as its subject | Ask Genie | `lib/askSubject.ts`, `AskAbout.tsx` | M | — | **The answer is held to the dashboard's period. It opens the platform's Data Canvas, never a Data Canvas inside the coworker** |
| **R21** | **Subscribe to a dashboard:** a PDF or PNG of the *published* version on a rhythm, by email or Slack | Databricks' schedules | The Briefing subscriptions (`routers/briefs.py`) plus `export/pdf.py` and `chart_ssr`; every send through the departure gate | L | — | **Each figure is said with its period.** A send is held as Slack sends are |
| **R22** | **Export and import a dashboard as JSON** (the spec plus card references; an import is validated, and a card it cannot resolve is refused by name) | `.lvdash.json` parity; moving a dashboard between connections | `routers/dashboards.py`; `validate.py` | M | — | Provenance: imported cards keep their source or are refused |
| **R23** | **Per-card downloads:** CSV of the rows and PNG of the chart, on the card's doors | Databricks' per-widget downloads; our own "tables Copy + CSV" rule | `TableActions.tsx`, `chartExport.ts` | S | — | — |
| **R24** | **Star a dashboard** | Small and expected | the dashboard list, `TabStrip` | S | — | — |
| **R25** | **The hover rule on a line chart** (the owner, 2026-11-18: "the dotted lines.. such a nice touch"): a dashed rule at the nearest x, a ring on the nearest line, and one tooltip with the date and every series' value there, largest first, each with its colour swatch | Today a line's tooltip is per point, one series at a time (`resolveSpec.ts:612-614`, a `point` layer with `tooltip: true`); reading several series at one date needs a hover per line | A Vega-Lite layer in `resolveSpec.ts`/`forms.ts`: `pivot` the series by x, a `rule` with a `nearest` point param on `pointermove` (`strokeDash`), a `point` filtered by it; the sorted, swatched rows through a `vega-tooltip` handler (already a dependency) | S–M | — | Colours are the series' own slots; the tooltip says each value with its unit, as the axis does |
| **R26** | **A paged table** (the owner, 2026-11-18: "A paged table? Wonderful."): a table piece shows a page of rows and numbered pages beneath — ‹ 1 2 3 4 5 … 16 › — the current one marked, each a button at rest | A long result on a dashboard either scrolls inside its box or is cut; pages say how much there is and keep the box's height | The objects table and a card's rows table (`OntologyPieces.tsx` `ObjectTablePiece`, `ResultChartCard`); the rows already held, or the next page read through the door | S–M | — | Withheld is said: the count of rows and pages is the result's own, never a guess |

---

## 6 · Build order

| Slice | Contents | Size | What it proves on theLook |
|---|---|---|---|
| **A — the editing feel (first)** | R1 handles at rest · R2 canvas toolbar, add-then-configure · R3 keyboard and undo/redo keys · R6 one panel that opens on the look · R7 the left pane folds · R4 a click chooses · R5 guides | ~2 weeks | Build Executive Cockpit's top row by keyboard and toolbar alone. Resize one card by each of the eight handles. Undo every step back to the start. Each burst is one version in History |
| **B — formatting** | R8 title and description · R9 number format · R10 conditional colour · R11 colour per value · R12 chart options · R13 note headings · R25 the hover rule · R26 paged tables | ~2–3 weeks | The screenshot's table and line chart rebuilt from theLook's own cards, with a colour scale and swatches, and no colour outside the palette |
| **C — filters and interaction** | R14 one bar · R15 not-cut cards · R16 cut through a join · R17 open on a tab | ~2 weeks | A click on Email cuts revenue through `users`, said with the column it used |
| **D — pages and AI** | R18 pages in the builder · R19 ✦ in words · R20 ask about this dashboard | ~1–2 weeks | A page added, hidden from readers, and absent from the published read. An ask held to the period |
| **E — lifecycle** | R21 subscriptions · R22 export and import · R23 downloads · R24 star | ~2–3 weeks | A held Slack send with the period said. An export imported into a second connection, one card refused by name |

The first slice touches four files deeply (`DashboardBuilder.tsx`, `ComposedDashboard.tsx`, `PieceSetup.tsx`,
`BriefingDashboards.tsx`) and needs no change to the spec format or the validator. That is why it goes first: the
whole of the owner's "very editable, easy resizing" is reachable without a vocabulary version.

## 7 · Refused, and decisions only the owner can reopen

| Databricks has | Our verdict | Why |
|---|---|---|
| Per-dashboard themes, fonts, canvas background, widget radius, padding and shadow ([themes](https://docs.databricks.com/aws/en/ai-bi/admin/themes)) | **Refused** | ONE theme; CLARITY's no-shadow rule. A colour **mapping** (R11) is not a theme and is offered |
| Free x/y placement with gaps, and multi-select group move | **Decision** | 2026-11-16: drag-to-reorder with dense packing, spec unchanged. Reopening it costs L: catalog v14 x/y, a packer, the validator, and migrating 24 live sections |
| `@` live field references inside text | **Refused as text** | A Note measures nothing and cites nothing (`catalog.ts:340`). A live figure belongs in a figure piece, beside the words |
| Custom Vega-Lite visualizations written by the author | **Decision** (lean refuse) | It bypasses the palette validator, the click contract (`selection.ts`) and the drawn-chart checks |
| Co-editing (CAN EDIT) | **Decision** | A dashboard is a person's own (§6 item 36): "nobody else sees it or changes it". Publishing an App is the sharing |
| Dual-axis combo | **Refused** (existing) | `chartTypeInference.ts:44` |
| An AI that writes notes or picks images | **Refused** (existing) | `ask.py` header |
| A feature flag to stage any of the above | **Refused** | No feature flags. Each slice merges on, proven live |

## 8 · Adjacent defects found while reading (one line each)

1. Tile doors, note and image doors, and the grid handles are invisible until hover (`DashboardTile.tsx:198`,
   `StaticTile.tsx:54`, `ComposedDashboard.tsx:497`, `:524`). This breaks *an action looks like a button at rest*.
2. The builder cannot add a page. Only the draft review can (`DashboardArrange.tsx:155` vs `PieceSetup.tsx:779`).
3. "Add a piece" is a modal dialog opened by one click (`PiecePicker.tsx:302`). The rule is select on click, with the
   detail in a panel.
4. There are two ways to add the same things: the side pane's eight doors, and the picker, which hands back to the
   same composers (`BriefingDashboards.tsx:1334-1340`).
5. Nothing de-selects a piece in the builder (`DashboardBuilder.tsx:173`).
6. A click on a mark in the builder both chooses the card and cross-filters the dashboard (`BriefingDashboards.tsx:1358-1360`).
   Measured in code; not yet seen on the page.
7. The undo stack is emptied on Done and on opening another dashboard. Versions remain, so History recovers it, but
   the step back is gone.
8. A Note cannot hold a heading (`NoteProse.tsx:17`), and a dashboard's title is never drawn on it
   (`ComposedDashboard.tsx:166-168`). So no dashboard can open with the title-and-intro text the screenshot leads with.

---

## Databricks sources (read 2026-11-18)

**Documentation** (base `https://docs.databricks.com/aws/en/`):

- **Overview:** `dashboards/` · `dashboards/concepts` · `dashboards/manage/` (keyboard shortcuts, pages, multi-select) ·
  `dashboards/tutorials/create-dashboard` · `dashboards/limits` · `dashboards/caching`
- **Visualizations:** `dashboards/manage/visualizations/` · `…/visualizations/types` · `…/visualizations/tables` ·
  `…/visualizations/text-widgets` · `…/visualizations/image-widgets` · `…/visualizations/maps` ·
  `…/visualizations/custom-visualizations`
- **Settings and themes:** `dashboards/manage/settings` · `ai-bi/admin/themes`
- **Filters:** `dashboards/manage/filters/` · `dashboards/manage/filter-types` · `…/filters/field-filters` ·
  `…/filters/parameters` · `…/filters/dashboard-variables`
- **Data modelling:** `dashboards/manage/data-modeling/datasets` · `…/custom-calculations/` · `…/local-metric-views` ·
  `…/dashboard-relationships/`
- **Sharing:** `dashboards/share/share` · `dashboards/share/schedule-subscribe` · `dashboards/share/embedding/`
- **AI:** `dashboards/genie-spaces` · `dashboards/manage/dashboard-agent`
- **Automation:** `dashboards/automate/import-export` · `dashboards/automate/git-support`
- **Release notes:** `ai-bi/release-notes/2024` · `ai-bi/release-notes/2025` · `ai-bi/release-notes/2026`

**The REST API:** https://docs.databricks.com/api/workspace/lakeview

**Blogs:**

- https://www.databricks.com/blog/design-beautiful-dashboards-aibi (2026-06-17)
- https://www.databricks.com/blog/whats-new-aibi-february-2026-roundup
- https://www.databricks.com/blog/whats-new-aibi-october-2025-roundup
- https://www.databricks.com/blog/whats-new-aibi-july-2025-roundup
