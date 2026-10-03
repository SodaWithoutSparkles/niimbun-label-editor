# Label Editor — UI Shell Spec

**Status:** FINAL for P3 (owner design chat, 2026-10-04).
**Owner:** owner → Coordinator. **Consumers:** phase3_action-plan.md, ui-designer (if/when asked), implementers.
**Precedence:** this file overrides the shell direction in `agent/memory/ui-design-workflow.md` where they differ (right-side
object config moved to the bottom multi-function panel; layers alone on the right). All other plan invariants stand.

## 0. Source

Owner-supplied screenshots + an mspaint sketch (2026-10-04):
1–2. NIIMBOT official label editor — left object palette + data-source list, centre label with mm ruler / zoom / rotate-label,
     right panel toggling *label settings* vs *element settings*, object toolbar (undo/redo/align/rotate/mirror/lock).
3–4. Current base template (drawing app) — what we are moving away from.
5.   Target layout: thin `Tools` rail top-left, `Preview` top-centre, `Multi-func panel` bottom spanning left→preview width,
     `object/layers` lower-right.

The official app and niim.blue are **peers, not ceilings** (plan decision 42). Where this shell beats them, it is intentional.

## 1. Non-negotiable anchors

- Header and status bar stay (present in every reference; omitted from the sketch by oversight only).
- The label document (`LabelDoc`, `hm` units) is the single source of truth. **No panel, view control, or rotation
  ever mutates it** except through explicit document commands (invariant 1, 2).
- View transform is view-only: `hm → CSS px × zoom`, plus `/ out` rotation. The saved document and the print/output
  raster are always in physical orientation (invariant 7; print raster ≡ preview raster).
- All product strings go through `t()` with typed keys (plan decision 40). Classes via `cn()`.
- All dialogs use the shared `Modal` / `dialogService` (dialogs.md). Global `keydown`/`paste`/`drop` handlers bail while
  `dialog[open]` exists (incl. the status-bar popup if it is a dialog — otherwise guard separately).

## 2. Shell layout

```
+-------------------------------------------------------------------+
| Header: [File][Edit][View]          [connection][Save][Print]     |   fixed height
+--------+--------------------------------------+-------------------+
| Insert |     Preview                          |  View controls    |
| Text   |     editable · draggable · WYSIWYG   |  grid·snap·zoom   |
| Image  |     row-N resolved                   |  −/+/fit/real     |
| Shape▾ |     marquee select                   |  rotate-view      |
| QR     |                                      |  rulers           |
| Barcode|                                      |-------------------|
+--------+--------------------------------------+  object / layers  |
| MFP: [Object] [Data source] [JS*]            |  eye | lock       |
|      (bulk mode on multi-select)             |  dimmed inherit.  |
+--------+--------------------------------------+-------------------+
| Status bar: zoom% · dpi · [Row ▾ popup] · connection              |
+-------------------------------------------------------------------+
```

### Regions

| Region          | Grid slot        | Notes                                                                 |
| --------------- | ---------------- | --------------------------------------------------------------------- |
| Header          | full width, top  | menus left, actions/chips right                                       |
| Insert rail     | row A, far left  | narrow (~48 px), **top only** (height = preview row)                  |
| Preview         | row A, centre    | flex-grows; the single editing surface                                |
| View controls   | row A, far right | right column, height = preview row                                    |
| MFP             | row B, left→preview | spans under the insert rail and preview; height = right column row B |
| Object / layers | row B, far right | right column, height = MFP row                                        |
| Status bar      | full width, bottom | fixed height                                                        |

- **Right column width** (~280 px) is shared by View controls (row A) and Object/layers (row B) so they align.
- **Row A / row B split:** default ~55 / 45. Tunable constant. Draggable splitters and per-orientation panel presets
  are **parked** (§12). MFP may become collapsible later; not v1.
- Editor only. The gallery view keeps `NavSidebar` + `GalleryView` and is unaffected by this shell.

## 3. Header

- Left: menus — `File`, `Edit`, `View`. (Confirm exact top-level set during P3; `Edit` is required.)
- **Undo / redo / clone / delete / group** live in **Edit** (+ shortcuts). No undo/redo buttons on screen.
- **Global settings** live in **Options / Global settings** (existing settings window via OptionsMenu or `Ctrl/Cmd+,`).
- Right: connection chip, `Save`, `Print`.
- No object-manipulation toolbar (align/rotate/mirror/lock relocated: align → MFP, lock/visible → layers).

## 4. Insert rail (tool model)

Rail entries are **one-shot insert actions**, not persistent modes:

`Text`, `Image`, `Shape ▾` (line / rectangle / ellipse / polygon), `QR`, `Barcode`.

- **Select is the resting state.** There is no select button; after placing an object the app returns to select.
- Armed action → crosshair cursor. `Esc` cancels back to select.
- **Click-to-place** with a sensible default size (then resize via handles) — not drag-to-create. Simplest one-shot model;
  matches the official app. (Flag if drag-to-create is wanted for text/shape.)
- Newly placed object is **auto-selected** and shown in the MFP Object tab.
- `Group` is **not** a rail action — it is an operation on selection (`Ctrl/Cmd+G`).
- Replaces the template's 8-tool persistent rail + `ToolSettingsModal`; `toolsSlice` semantics change from
  "active tool persists" to "armed insert action, auto-clears".

## 5. Preview (edit surface)

- Editable + draggable: click to select, drag to move, Transformer handles to transform. WYSIWYG.
- Shows the **resolved row-N** scene (resolver output for `data.sampleRowIndex`), rendered by the shared node factory.
  It is an editor projection, **not** the print raster (invariant 7) — never pixel-compared against print.
- Row N uses the current sample row. Empty string → placeholder text (e.g. `{empty}`), so an object never renders blank.
- Marquee drag-select on empty canvas; shift-click adds/toggles (see §10).
- Non-printable region overlay + keep-out warnings + snap guides apply here (plan §Editor).
- **View rotation** toggles the label's on-screen orientation; output stays physical (§8).

## 6. View controls (right column, row A)

Controls: **grid toggle, snap toggle, zoom − / + / fit / real, rotate-view, rulers toggle.**

- `fit` = scale to fit the preview viewport.
- `real` = absolute physical-size estimate, computed (not relative):
  - `px per mm = ppi / 25.4`, with `ppi` from the screen-DPI calibration setting (default `96`).
  - zoom (px per `hm`) `= ppi / 25.4 / 100`. At default 96: `≈ 0.037795`.
  - `devicePixelRatio` sets the **backing render resolution**, not the zoom; the label still measures
    `mm / 25.4 × ppi` CSS px on screen.
  - Best effort — browsers cannot report true screen DPI. The `96`/calibrated constant is the only knob.
- `rotate-view` is view-only and **does not** touch the document. Default view orientation auto-picks the label's long
  axis horizontal (comfortable on a landscape screen); user can toggle. Portrait cable-tag case: design rotated,
  print physical.
- Rulers: mm ruler on the top and left edges of the preview.

## 7. Object / layers panel (right column, row B)

- Photoshop-style list over the flat `nodes[]` tree (drag-reorder/reparent is P3 scope).
- Per-row: **eye** (visible) and **lock** icons.
- **Inherited state is dimmed**: `effectiveVisible` / `effectiveLocked` (parent hidden/locked dims the child row).
- Selection here mirrors canvas selection; multi-select supported.
- This panel owns visible/lock; the MFP Object tab does not duplicate them.

## 8. Multi-function panel (MFP)

Tabs, fixed base + contextual:

| Tab             | Visibility                                   | Content                                                                                   |
| --------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Object**      | always; default                              | selected object's settings; **bulk mode** on multi-select (§10)                            |
| **Data source** | always                                       | CSV attach/import/rename, columns, virtualized preview table, sample-row pick, globals      |
| **JS**          | only when selection's `ContentSource.kind === 'template'` | template source editor + fallback value                                        |

- **JS tab gating:** appears for template sources but is **disabled-with-reason** when the document is untrusted
  (`ask` / `never` in the IDB trust store) — user must see *why*, not a vanished tab. Until P6 ships the trust store,
  render JS as a disabled stub (plan rule: ship fields, wire only what the phase can act on).
- **Object tab fields:** transform (`x`, `y`, `rotDeg`, `scaleX`, `scaleY` via `PopoverSlider`); **align** tools;
  content source picker (`static` / `csv` / `template` + fallback); quantizer hint; type-specific props
  (text: font/size/style/align/spacing/letter/direction; shape: kind/stroke/fill; image: resource ref + resolution;
  qr/barcode: payload `ContentSource` + symbology options). Fields scroll within the tab.
- Panel height is limited — every tab scrolls internally.

## 9. Status bar

- Contents: `zoom %`, `dpi`, **row selector button → popup**, connection chip (duplicated from header per plan).
- **Row selector popup** (VSCode-style status-bar button): current row (`sampleRowIndex` / row count), prev/next, jump;
  "no CSV" empty state when `data.csv` is absent.
- Print progress may surface here during a job (or in the print dialog — decide at P7).

## 10. Selection & bulk edit

- Selection: click select; shift-click add/toggle; **marquee drag-select** (required); `Esc` clears.
- Multi-select switches the MFP Object tab into **bulk mode**:
  - **Same-type selection** → show that type's shared props (all text → font/size/bold/etc.).
  - **Mixed selection** → show only universal props (**visible / lock / align**).
  - No intersection / mixed values: out of scope for v1 — do not invent per-field mixed-value display.
- Extends the template's single-selection Transformer — **real P3 scope**, name it in the action plan.

## 11. Global settings additions

- New **Display / Calibration** row: `Screen DPI` numeric input (`Input` + `SettingRow` from the form kit), default `96`.
- Stored in the persisted **global settings store** (localStorage) — a machine/screen property, **never** document data,
  never IDB.
- `real` zoom reads this value (§6).
- Parked: interactive calibration — drag an on-screen ruler until it matches a physical ruler; writes the same field.

## 12. Decision register (2026-10-04)

| #  | Decision                                                                                                  |
| -- | --------------------------------------------------------------------------------------------------------- |
| 1  | Header + status bar kept; global settings via Header→Options→Global settings.                              |
| 2  | Undo/redo/clone/etc via Header→Edit (+ shortcuts); no on-screen toolbar.                                   |
| 3  | Align lives in MFP→Object.                                                                                 |
| 4  | visible/lock per-row in layers, Photoshop-style; inherited state dimmed.                                   |
| 5  | Preview = editable, draggable, WYSIWYG row-N.                                                              |
| 6  | Row selector = status-bar button → popup; sample one row; empty → placeholder.                             |
| 7  | Rotate-view = view transform only; output/preview raster stays physical.                                    |
| 8  | View controls in right column top: grid, snap, zoom −/+/fit/real, rotate-view, rulers.                     |
| 9  | MFP tabs: Object + Data source fixed; JS contextual (template source, trust-gated); multi-select → bulk.   |
| 10 | Bulk edit: same-type props; mixed → universal (visible/lock/align).                                        |
| 11 | Insert is one-shot; select is resting state; marquee + shift-click multi-select.                           |
| 12 | Screen-DPI calibration in global settings; `real` zoom uses it; park interactive ruler calibration.        |

## 13. Plan alignment

- Does not violate any of the eleven invariants. Rotation/zoom/pan remain pure view state (invariants 1, 2, 7).
- `sampleRowIndex` (P2 doc field) drives the preview row; row selector edits it.
- `effectiveVisible` / `effectiveLocked` (plan derived semantics) drive layer dimming.
- JS tab reads the P6 `trust` store; stub until P6.
- i18n: new keys for rail entries, tab labels, view controls, status-bar row popup, calibration setting.

## 14. P3 scope call-outs

- Replace template shell components `LeftSidebar` / `RightSidebar` / `ToolSettingsModal` and the centre
  `DrawingCanvas` wrapper with: Insert rail, Preview, View controls, MFP, Object/layers.
- Extend selection machinery to **multi-select + bulk** (plan currently single-selection Transformer).
- One-shot insert semantics in `toolsSlice`.
- View transform gains **rotation** (view-only).
- JS tab + row selector ship as **stubs** (P6 wires trust + CSV).

## 15. Parked / out of scope (v1)

- Draggable splitters / user-configurable panel sizes.
- Two auto-selected panel presets (portrait/landscape) — rotate-view makes them mostly unnecessary; revisit only if
  editing proves cramped.
- Interactive ruler-drag calibration.
- Per-field mixed-value display in bulk edit.
- Non-printable guides beyond the region overlay (unchanged from plan).
