# Label Editor v1 — Authoritative Plan

**Status:** FINAL (Phase 0 complete). Handoff to `coordinator`.
**Date:** 2026-09-29
**Owner:** Build (CTO) → Coordinator.

## Sources (authoritative order)

1. `docs/references/chat-export-1790619789248.json` — original design dialogue, plan v0→v0.3. v0.2 blueprint (node tree, RGBA pipeline, world coords, region clipping, trust boundary) + v0.3 verified printer flow are the architectural baseline.
2. `docs/references/gpt-review.md` — external critique + owner resolutions. Resolves the chat's open conflicts (see Decisions).
3. Existing skeleton survey (2026-09-29) — `src/` is a drawing-app template; reuse map below.
4. Owner decisions 2026-09-29 — red/black post-v1 (mono dithering stays in v1); keep shell + strip; semantic commits per phase.
5. Template delta survey (2026-10-02) — post-survey template improvements (i18n, shared Modal + promise dialog service, settings window + versioned persisted store, form kit, Vitest wiring, review fixes) folded into the reuse map below. Verified: nothing on the strip list is stripped yet — that is P1–P3 work, not done.

## Product definition

A label editor for NIIMBOT thermal printers, better than niim.blue. Not a form editor — a small declarative label publishing system:

> arbitrary physical label geometry (regions, F-shaped tags) + a vector-ish editor + variable-data (CSV) + programmable templates (JS, trusted) + QR/barcodes + direct multi-page printing through niimbluelib.

**Killer workflow (v1 definition of done):**
create a strange-shaped label → design it (text/image/QR) → attach CSV → bind + template text/QR → preview row 37 → print 100 different labels directly.

## Non-goals (v1) — parking lot

Red/black + red-grayscale color spaces (`PageColorType.DoubleColor`), MDI icons, advanced SVG import, font bundling on export, complex group scale/rotate ops, fold-mirror view, mobile layout, LOD caching, hostile-document sandboxing (see threat model). Seams for parked items still ship in v1 as interfaces (see Phases · Scaffolding rule).

## Constitution — eleven invariants

Every phase must obey these. Reviewer checks them explicitly.

1. The JSON document is the single source of truth.
2. Rendering never mutates the document.
3. Template execution never mutates the document or its context.
4. The node hierarchy has exactly one representation: flat `nodes[]` + `parentId`. Layers and groups are UI views of that tree, never separate data.
5. All geometry uses integer hundredths of a millimeter (`hm`). No floats in the document.
6. Printable area = `union(label.regions)`, applied as a clip. Pixels outside are always blank. The transport payload stays the full backing rectangle (niim.blue-compatible: odd shapes go out as their outer rect) — regions mask pixels, they never change raster dimensions.
7. Preview and print rasters are bit-identical — same `resolve → createKonvaNode → rasterize → clip → quantize` path, same dimensions, no alternate code path. The editor shares resolve and the node factory, but its raster is a viewport projection (`hm → CSS px × zoom`), so it is never pixel-compared against the print raster. (Owner: "Print preview stage raster = printer raster; editor stage raster is not.")
8. Printer adapters receive fully resolved bit planes only. They know nothing of nodes, CSV, or templates.
9. Batch rendering is lazy (async sequence) and bounded in memory. Never raster a whole job at once.
10. A template evaluates exactly once per label instance per render pass, with a deterministic, frozen context.
    - Print preview and the actual print run the same resolve for the same context — preview is a faithful prediction, not an approximation.
    - Different row indexes (or a different globals snapshot) legitimately produce different values; the same context always produces the same value.
    - Templates never fetch. Globals are prefetched once per job, frozen, and deep-cloned into the worker.
11. Scriptable documents follow the Office-macro model: template trust is a **local user decision stored in IDB, never document data**. A document containing template sources is untrusted by default: on open the app consults the trust store (`always` → run, `never` → blocked, otherwise prompt). Allow/Deny at the prompt lasts for the session only; `Always allow` / `Never allow` persist. `never` blocks everywhere — including the machine that authored the document — until the user changes it in settings. Trust is keyed on `meta.id`, so **import and duplicate always re-assign the id**: an imported document can never claim a trusted id, and a duplicate inherits the source document's trust record explicitly (never implicitly by keeping the id). Documents with no template sources are never prompted — nothing executable, nothing to trust.

## Architecture

```
Label Document (.lbl.json.gz = gzip JSON, hm units, version 1)
   ├── geometry   backing size + regions[] + nodes[]
   ├── resources  fonts (refs + fingerprints), images
   └── data       csv ref, sample row, globals specs
        │
        ▼
Resolver ─── TemplateEngine (Web Worker, trusted JS, frozen ctx)
        │
        ▼
   Scene graph (resolved nodes)
        │                      ┌─ Editor renderer (react-konva, interactive)
        ├──────────────────────┼─ Preview renderer (offscreen, plain Konva)
        │                      └─ Print renderer  (offscreen, plain Konva)
        ▼
RGBA intermediate canvas @ target DPI
        │   clip to union(regions); outside → blank
        ▼
ColorSpace conversion   (Mono in v1; RedBlack/RedGrayscale post-v1)
        ▼
Quantizer / dither      (threshold | Floyd–Steinberg | Stucki | Atkinson;
        │                per-object policy hints applied as masks)
        ▼
Bit planes → ImageEncoder → PrinterTransport
        │                (niimbluelib adapter | MockTransport)
        ▼
   NIIMBOT printer
```

`src/core/` (doc model, hm math, resolver, color pipeline) contains **zero React imports** — it is the headless engine; the editor is just one consumer. This keeps mobile and Node export open later.

## Data model (LabelDoc, version 1)

Fresh schema — starts at `version: 1` (the chat's `version: 2` was its own iteration numbering, superseded).

```ts
type hm = number;                    // integer hundredths of a millimeter; mm = hm / 100

type Region =
  | { kind: 'rect';        x: hm; y: hm; w: hm; h: hm }
  | { kind: 'roundedRect'; x: hm; y: hm; w: hm; h: hm; r: hm }
  | { kind: 'circle';      cx: hm; cy: hm; r: hm }
  | { kind: 'polygon';     points: [hm, hm][]; closed: boolean };

type NodeType = 'group' | 'text' | 'image' | 'shape' | 'qr' | 'barcode';

interface BaseNode {
  id: string; parentId: string | null;    // null = root; array order = z-order
  type: NodeType; name?: string;
  visible: boolean; locked: boolean;
  transform: { x: hm; y: hm; rotDeg: number; scaleX: number; scaleY: number };
}                                       // + type-specific fields (text props, shape
                                         //   kind, image resource ref, qr payload…)

type ContentSource =
  | { kind: 'static';   value: string }
  | { kind: 'csv';      column: string; fallback: string }
  | { kind: 'template'; code: string;  fallback: string };

interface FontRef {
  fontId: string; familyName: string; name: string; alt?: string;   // name = user-facing, editable; alt = free-text "what this was"
  source:
    // non-portable by design → ⚠ badge
    | { kind: 'system';   descriptor: string }
    // sha256 once at import; never re-hash; ⚠ badge if missing
    | { kind: 'imported'; asset: AssetRef; fingerprint?: string };
}

interface GlobalSpec { name: string; url: string; extract: string; expiresAt: number }  // expiresAt = epoch seconds (UTC); prefetch once per job, deep-clone into template worker

// Binary-ish assets (fonts, images, SVGs, CSVs) all use one reference shape. Any of these
// provenances is legal in the document; the format supports all from day one.
// Provenances:
//   inline   = data URL — self-contained document
//   remote   = http(s) URL fetched at load
//   local    = IDB lookup in the `resources` or `csvs` store (resourceId is the store key)
//   external = not carried by the document at all — the asset travels alongside it
//              (e.g. `.lbl.json.gz` + assets handed over as one zip) or the user re-imports it.
//              Doc keeps only mediaType + optional fingerprint, so the receiver knows what
//              was used and can verify what they supply.
// `fingerprint` (all kinds): sha256 of the asset bytes. Computed ONCE at import, never
// re-hashed. Present → verify on load, mismatch = warn "asset differs from document record".
type AssetRef =
  | { kind: 'inline';   mediaType: string; dataUrl: string }
  | { kind: 'remote';   mediaType: string; url: string }
  | { kind: 'local';    mediaType: string; resourceId: string; fingerprint?: string }
  | { kind: 'external'; mediaType: string; filename: string; fingerprint?: string };

// Every resource carries a user-facing `name` and optional `alt` ("what this was") so a
// missing/replaceable asset is identifiable later. Default `name` is auto-filled on import (filename or `image-N`), but editable. Renaming never breaks references.
interface ImageRef { imageId: string; name: string; alt?: string; source: AssetRef; widthPx: number; heightPx: number }
interface CsvRef   { csvId: string;   name: string; alt?: string; source: AssetRef }

interface LabelDoc {
  version: 1;
  meta: {
    id: string; name: string; createdAt: number; updatedAt: number;    // epoch seconds (UTC)
    // Cosmetic preview so the gallery can show something without executing templates or
    // fetching anything. RASTER ONLY (PNG/WebP/JPG) — never SVG, never HTML, never a data URL
    // that could script. May be stale; never used for measurement or rendering.
    // Validation: raster mime only, ≤ 512 px longest side, ≤ 64 KB decoded — reject otherwise.
    // Auto updates on save/export. Not user overridable. 
    thumb?: { mediaType: string; dataUrl: string; at: number };
  };
  label: {
    backingW: hm; backingH: hm;
    dpi: number = 300;  // printer-reported dots per inch; user-overridable; common: 203 or 300; validated clamp 100–1200 
    regions: Region[];
    printDirection: 'top' | 'right' | 'bottom' | 'left';
  };
  nodes: BaseNode[];
  data: { csv?: CsvRef; sampleRowIndex: number; globals: GlobalSpec[] };
  resources: { fonts: FontRef[]; images: ImageRef[] };
}
```

**Derived semantics (never stored):**
- `effectiveVisible(n) = n.visible && effectiveVisible(parent)`
- `effectiveLocked(n)  = n.locked  || effectiveLocked(parent)`
- `effectiveTransform(n) = parentTransform × localTransform`
- children derived from `parentId`; never stored separately.

**F-tag preset** (`ftagSpare-25x78`, backing 2500×7800 hm):
- `flag`: roundedRect x0 y0 w2500 h3800 r200
- `tail`: roundedRect x0 y3400 w1975 h4400 r200
- `tab`: roundedRect x1575 y0 w600 h7800 r200

> **Corrected by the owner, 2026-10-03:** the preset is now a 3-region union
> (was 4). Abutting `roundedRect`s lose a corner half-disc at every shared seam,
> punching notches into the `union(regions)` clip. The fix: the flag is one
> region (two halves can never tile), and the tail overlaps its neighbours by
> ≥ 2r (`y3400`, `w1975`). Silhouette intent unchanged: 25×78, lower-right notch
> OUT, tab column x∈[1575,2175] IN. See `src/core/doc/factory.ts` `ftagSpareRegions()`.

**v1 node set:** text, image, shape (line, rectangle, ellipse, polygon), qr, barcode, group. QR/barcode payloads are `ContentSource` (templatable).

**Region semantics:** `regions` is consumed only as `union(regions)` — a printable-area clip. Regions carry no role, id, or zone label; `flag`/`tail`/`tab` in the preset are just descriptive comment names for three physical areas of one printable union. No object is ever assigned to a region.

> **⚠ P4 clip requirement — union MUST use NONZERO winding (added 2026-10-03).** Region rectangles may now **overlap on purpose** (the F-tag preset's tail overlaps the flag and tab by ≥ 2r to cover shared rounded corners). Under even-odd (default `fill` in some APIs / `ctx.clip('evenodd')`) every overlap band becomes a **hole**, re-creating the exact clip defect the 2026-10-03 geometry fix removed. The P4 renderer **must** clip with nonzero winding (e.g. canvas `ctx.clip()` default is nonzero — do NOT pass `'evenodd'`; SVG `fill-rule="nonzero"`), or equivalently merge regions into a single path before clipping. Pin this with a P4 test: overlapping regions must produce no interior holes.

## Storage

IndexedDB `labeleditor.v1` (via `idb`):
- `labels`: labelId → `{ meta, docGz: Uint8Array }`
- `resources`: font binaries, images
- `csvs`: `{ id, name, columns[], rows: string[][] }` — cap ~50k rows with warning. `name` = original import filename; the doc-level `CsvRef.name` is the user-editable display name (may differ).
- `thumbs`: PNG blobs, regenerated at idle time — **local thumbs always win** over any thumb carried in the document.
- `trust`: docId → `'ask' | 'always' | 'never'` — template trust decisions. Absent = `'ask'`.

**Trust is local state, not document data (invariant 11):** the `trust` store is keyed by document id and is written only by the user, never by import. `always` = run templates silently; `never` = templates stay disabled everywhere, including the machine that authored the document, until the user re-enables the doc in settings; absent/`ask` = prompt on open. Allow/Deny at the prompt applies to the current session only — persisting needs `Always allow` / `Never allow`. Settings lists stored decisions with revoke/reset. **Import and duplicate mint a new `meta.id`**, so a document can never arrive carrying a trusted id; duplicate copies the source's trust record to the new id explicitly.

**Thumbnails (cosmetic, three tiers):** gallery cards never execute templates and never fetch the network — they are pure data. Card art resolution order: (1) local IDB thumb (regenerated at idle after a permitted render), (2) the document's own `meta.thumb` (raster only, may be stale, used as-is), (3) generated placeholder — backing outline + region union silhouette + name. A document containing templates that is not trusted renders only tiers (2)/(3) — no resolve, no fetch, ever. The in-document thumb exists so a zip handover (external assets, no local thumbs, no network) still shows a real-looking gallery.

File format: single `.lbl.json.gz` = gzip JSON document. Save/load reuses `src/utils/compress.ts` (CompressionStream gzip) and the FS-Access/download patterns from `src/utils/saveProject.ts`. Plain JSON integers — no typed arrays (gzip handles them). Autosave moves from localStorage to IDB (the template's localStorage autosave is write-only and unreadable — drop it).

**Asset provenance (format-level, decide policy later):** every binary/table asset (fonts, images, SVGs, CSVs) references one of four `AssetRef` provenances — `inline` data URL (self-contained), `remote` http(s) URL, `local` IDB resource, or `external` (asset not carried by the document; travels as a sibling file in a zip handover, or the user re-imports it). The format supports all four now; which provenance the export flow emits is a P8 policy decision. `external` is the escape hatch for "CSV too big to inline, still recorded in the doc".

**Asset identity:** every `FontRef` / `ImageRef` / `CsvRef` carries a user-editable `name` and an optional `alt` description. Auto-filled (filename, or `image-N`) on import, but editable so that when an asset is missing, the replace dialog can say what it was and which nodes used it. Names are document data, not storage keys — renaming never breaks references.

## Rendering pipeline

1. **Resolve** — document + context `{ index, total, row, rowCount, now, label, globals, fmt }` → scene graph.
2. **Rasterize** — `createKonvaNode(resolvedObject)` factory (plain Konva, offscreen) → RGBA intermediate at target DPI. The same factory serves editor, preview, and print; preview and print rasters are bit-identical (invariant 7).
3. **Clip** — `union(regions)`; outside → blank (invariant 6). Raster dimensions stay the full backing rect — the same payload niim.blue sends for odd shapes.
4. **ColorSpace** — `Mono` in v1. Interface ready for `RedBlack` / `RedGrayscale` (post-v1).
5. **Quantize/dither** — `threshold | floydSteinberg | stucki | atkinson`, independent of color space. Per-object policy hints (text/qr/barcode → threshold; image → FS) applied as per-object masks inside one unified pass, so overlapping semi-transparent objects dither as final pixels. **Mono still ships all four ditherers in v1** (owner decision). Dither and color space are orthogonal: a future 16-level grayscale space dithers within its own palette; the quantizer consumes whatever channel values the color space emits.
6. **Encode** — `ImageEncoder.encodeCanvas(canvas, pageColor, printDirection)` → bit plane → transport.

Golden-pixel unit tests per quantizer. Preview and print share this exact path (invariant 7).

## Template system

- **Threat model (owner-settled):** templates are trusted user code — the Office-macro boundary. Disabled by default; only the user's trust record (IDB `trust` store, invariant 11) enables them. The browser sandbox + worker + an app with no secrets makes this sufficient. Do NOT build a hostile sandbox.
- `interface TemplateEngine { evaluate(source, context): Promise<Value> }`; first impl `JavaScriptTemplateEngine`.
- Dedicated Web Worker: `{code, ctx} → {ok, value | error}`; code wrapped as `return (ctx) => {...}`; **250 ms timeout** → worker reset + error badge on the object.
- Context deep-frozen via throwing Proxy (mutation throws, test asserts); no DOM/app refs; no dynamic `import()`; no network.
- **`ctx.now`** = `Date.now()` (ms) at resolve time — template-resolution detail only, never stored. Document `meta` timestamps stay epoch seconds; the two clocks are independent by design (a doc never records when a template ran).
- **Globals:** host prefetches each `GlobalSpec` **once per job** (concurrency cap, timeout, shared cache keyed by `expiresAt`), freezes, deep-clones into the worker as `globals.<name>`. Templates never fetch.

## Print pipeline

`interface PrinterTransport { connect(); disconnect(); print(job); onStatus(...) }` — the app knows nothing of BLE/USB/packets. Two impls: `niimbotAdapter` (wraps @mmote/niimbluelib) and `MockTransport` (dev + tests).

Verified flow (v0.3 + scout verification 2026-09-29 against niimbluelib 0.47.0 source):
`client.protocol.newPrintTask(taskType, { totalPages, density, labelType, pageColor, statusPollIntervalMs: 100, statusTimeoutMs: 8000 })` → `printInit()` → loop { `printPage(encoded, quantity)`; `waitForPageFinished()` } → `waitForFinished()` → **`printEnd()` in `finally`** (resets state, cuts paper). `totalPages = Σ quantity` — the library validates and throws if exceeded.

- **Transports (verified):** `instantiateClient("bluetooth" | "serial" | "capacitor-ble" | "virtual")`. Web Bluetooth ✅, Web Serial ✅ (**no Web USB client exists** — USB-connected printers go through Web Serial; niim.blue's original implementation proves this — the printer exposes USB internally as a serial interface). The lib's `"virtual"` client informs our MockTransport.
- **Precedent (niim.blue):** the official app runs multi-page jobs and odd-shaped labels through the same library, sending odd shapes as their outer bounding rectangle. Multi-page and odd-shape behavior is taken as proven; P1 only checks Vite/rolldown interop against pinned 0.47.0 and locks the adapter API.

- **Sequence generator** (lazy async, invariant 9): grouped (AABBCC) = one `printPage` per record with `quantity = copies`; interleaved (ABCABC) = records×copies pages at `quantity: 1` (packet-rate bound, slow — warn above ~50 pages).
- **Backpressure:** render → encode → send → wait → next row. One active job at a time; cancel = abort + `printEnd()`.
- **Progress:** `client.on('printprogress', e => { page, pagesTotal, pagePrintProgress, pageFeedProgress })`.
- `PageColorType` (verified): `SingleColor=0, DoubleColor=1, SingleColorAlt=2, MultiorderColor=3` — `DoubleColor` exists for post-v1 red/black.

## Editor

- **World coordinates:** the document stores `hm` only. Editor applies viewport transform (hm → CSS px × zoom); printer applies hm → printer dots. Zoom never mutates the document.
- **Canvas:** fixed backing-rect stage (not infinite pan). Region overlay shows non-printable areas; keep-out warnings when objects intersect them; snap guides. No LOD system — one rule: effective bitmap resolution = `min(source, required by current viewport)`.
- **Panels:** node tree (layers/groups = drag-to-reorder/reparent UI over `parentId`); inspector (transform, visible/locked, content source picker, quantizer hint — form kit + PopoverSlider); reuse the template's menu shell, notifications, shortcuts, Transformer/selection machinery, textarea-overlay text editing.
- **Template conventions (inherit, 2026-10-02):** all dialogs = shared `Modal` / `dialogService` (promise-based, StrictMode-idempotent); every product UI string through `t()` with typed keys (decision 40), dynamic keys via the literal-map pattern; class names via `cn()`; global `keydown`/`paste`/`drop` handlers must bail while `dialog[open]` exists.
- **Undo/redo:** snapshot-based on the document slice only, capped. Never serialized into the save file (fixes the template's bloat bug).
- **Fonts:** system = descriptor reference (⚠ non-portable); imported = upload/URL → **SHA-256 once** via Web Crypto → stored in IDB; missing → fallback font + amber badge. Never re-hash. UI shows `✓ imported / ⚠ system / ⚠ missing`.
- **Roll-size & dpi mismatch:** if a connected printer reports roll dimensions or dpi that differ from the label's, show a non-blocking non-disruptive (no dialogue no pop-up) warning (yellow dimension field with a warning icon + hover tip). Printer-reported values never gate printing.
- **Connection chip** top-right (gallery + editor): transport status.

## Testing

- **Vitest (unit):** already wired (happy-dom + jest-dom, `vitest.config.ts` merges the vite config, 9 template tests, tests typechecked per tsconfig) — extend, don't recreate. Unit list: hm math round-trip; region union clipping; golden pixels per quantizer; gzip round-trip; frozen template context (mutation throws); globals prefetch cache (`expiresAt`) behavior; sequence generator patterns; resolver snapshots; adapter against MockTransport.
- **Playwright (e2e, MockTransport):** create → edit → reorder layers → attach CSV → trust gate → preview row N → print; assert page count, order, progress, cancel.
- **Hardware smoke (manual, per phase where relevant):** owner runs adapter flows on a real printer (Web Bluetooth or Web Serial; fake-NFC trick bypasses paper checks).

## Dependencies

Existing (keep): react 19, react-dom, konva, react-konva, zustand, tailwind 4 (via `@tailwindcss/postcss`), lucide-react, clsx, tailwind-merge (`cn()`), i18next + react-i18next (kept — decision 40), vite (rolldown), typescript 5.9. Dev/test already wired: vitest + happy-dom + @testing-library/*. **Package manager: `bun`** — `bun.lock` tracked, `bun run test`, never `bun test`, never npm.

Add (all verified on npm 2026-09-29):

| package                      | version         | purpose                                | note                                                                                                                                                                                                                  |
| ---------------------------- | --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mmote/niimbluelib`         | 0.47.0          | printer comms, PrintTask, ImageEncoder | **CJS-only** (no ESM build) — Vite/rolldown interop must be verified at P1. Hard deps incl. `@capacitor/core` (pulls Capacitor into the web bundle — check size/impact at P1). `newPrintTask` is on `client.protocol` |
| `papaparse`                  | 5.7.0           | CSV import                             | CJS; types via `@types/papaparse`                                                                                                                                                                                     |
| `qrcode`                     | 1.5.4           | QR generation                          | browser map: `toCanvas`/`toDataURL`; types via `@types/qrcode`                                                                                                                                                        |
| `jsbarcode` **or** `bwip-js` | 3.12.3 / 4.11.4 | barcodes (CODE128, EAN-13)             | spike at P5: jsbarcode = smaller but stale; bwip-js = active, more symbologies, larger                                                                                                                                |
| `idb`                        | 8.0.3           | IndexedDB wrapper                      | ESM + typed                                                                                                                                                                                                           |
| `immer`                      | 11.1.18         | zustand immutable updates              | ESM + typed                                                                                                                                                                                                           |
| `fflate`                     | 0.8.3           | gzip fallback                          | `./browser` export, typed                                                                                                                                                                                             |

## Reuse / strip map (from skeleton survey)

**Keep (adapt) — refreshed 2026-10-02:** MainLayout/Header/BottomBar shell, NotificationCenter, ErrorBoundary, KeyboardShortcuts (global handler already guards on `dialog[open]`); settings window (`SettingsModal` + section registry — old ShortcutConfigModal absorbed into `ShortcutsSection`); ColorPicker (minimal), PopoverSlider (currently unused — inspector revives it); store slice pattern + `createSafeStorage` + versioned persisted store (`partialize`/`migrate`/`preferenceValidation` — precedent for the IDB layer and doc versioning); shared `Modal` + promise `dialogService` (`confirm`/`promptText`/`alert`, StrictMode-idempotent, one pending at a time) + `DialogHost` — every product dialog; form control kit (`Input`/`Select`/`Toggle`/`SettingRow`); i18n wiring (decision 40); `cn()`; `compress.ts`; `saveProject.ts` FS-Access/download patterns + pure export helpers (`hooks/export/{capture,download,utils}.ts` — reused by P8 export + thumbnail write); Konva engine primitives — useCanvasNavigation (adapt to fixed canvas), Transformer selection/drag commit pattern, TextEditorOverlay textarea approach, image drag/drop/paste.

**Strip:** useDrawingTools + shapeHelpers draw state machines, callout/star/arrow tools, drawing toolSettings, color presets model (`ColorPreset`/colorsSlice/DualColorPicker), ExportModal **UI** (pure export helpers stay), SaveFile drawing coupling (`SaveFile` type + `buildSaveFile` — superseded by LabelDoc), localStorage autosave (`autosave_project`), dead `polygon` CanvasItem type (superseded by real Region/node polygon). Verified 2026-10-02: none of this is stripped yet — stripping is P1–P3 work.

**Build new:** everything in the architecture diagram — src/core, src/print, src/templates, src/data, IDB layer, gallery view, node tree, inspector, preview dialog, job runner.

## Phases

Each phase = one coordinator cycle: `phase{N}_action-plan.md` → implement (parallel subagents where independent) → review (`review` / `review-fast`) → fix (≤2 rounds) → semantic commit → update state.md. No week estimates — phase size is bounded by scope and review, not calendar.

| #   | Phase                                             | Scope (from chat milestones)                                                                                                                                                                                                                                                                                                                                                                  | Exit criteria                                                                                                                         |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Foundation & comms spike (M0)                     | deps via `bun add` (Vitest already wired — `bun run test`) + `.gitignore` += `agent/*/state.md`; `src/core/hm.ts`; `src/print/` PrinterTransport + niimbotAdapter + MockTransport; multi-page spike (hardcoded 3-page canvas → mock, then real printer)                                                                                                                                                                                    | Multi-page spike green against MockTransport; hardware smoke owner-run when convenient (advisory); adapter API locked; hm tests green |
| P2  | Document model + storage + gallery (M1+M2)        | LabelDoc v1 types + validation (incl. dpi clamp 100–1200 + raster-pixel cap); IDB stores (settings-store `partialize`/`migrate`/`preferenceValidation` pattern as precedent); `.lbl.json.gz` save/load; gallery UI (grid + pseudo-card + connection chip; render-only — never runs templates or network; thumb → doc thumb → placeholder); create dialog (shared `Modal` + form kit) with size/preset picker incl. `ftagSpare-25x78` + custom regions editor + roll-size mismatch warning                                                                                                                                                   | Create F-tag label → persists in IDB → reopens after reload                                                                           |
| P3  | Editor core (M2/M3)                               | world-coord viewport; fixed backing + region overlay + keep-out + snap; node tree panel; inspector; selection/move/transform/clone/z-order; undo/redo (document snapshots); static text (system fonts) + line/rect/ellipse/polygon + groups render in editor                                                                                                                                  | Design an F-tag label with text/shapes comfortably; undo works; reload preserves                                                      |
| P4  | Render pipeline + color (M4) — **vertical slice** | resolver; `createKonvaNode` factory (plain Konva offscreen); RGBA intermediate + region clip; ColorSpace (Mono) × 4 quantizers + policy hints; golden tests; single-label print end-to-end (mock + real)                                                                                                                                                                                      | WYSIWYG: preview raster ≡ print raster (golden test); one weird label prints on hardware                                              |
| P5  | Objects + fonts + assets (M5)                     | image objects (resource store, resolution cap rule); QR + barcode (templatable); imported fonts (SHA-256 once, badges, fallback); asset name/alt fields + rename UI; barcode lib spike                                                                                                                                                                                                        | text/image/QR/barcode place, render, print; font badges correct; assets identifiable by name                                          |
| P6  | CSV + templates (M6)                              | PapaParse import + virtualized preview + cap; bindings by column name + fallbacks; template worker (frozen ctx, timeout, reset); **trust gate UI** (reads/writes IDB `trust` store; allow/deny once + always/never — prompt via `dialogService`; settings list with revoke as a `SettingsModal` section); globals prefetch once per job                                                                                                                                                                                                             | Attach CSV → bind text/QR → editor previews row N                                                                                     |
| P7  | Preview + batch print (M7)                        | virtualized preview dialog (LRU ~32, concurrency 2, ~50 dpi); lazy grouped/interleaved sequences; job runner (progress, cancel, `printEnd()` finally, backpressure, one-job guard, >50 interleaved warning); per-row quantity incl. `$times` column (ref `PrintPreview.svelte`); print-task override UI + capability gating; print knobs (speed, invert, mirror, offset inner/outer, printhead-overflow warning)                                                                                                                                                                                   | 100-label CSV job prints reliably; mid-job cancel is clean                                                                            |
| P8  | Import/export + e2e + polish (M8)                 | `.lbl.json.gz` export/import with font warnings + trust gate on import; asset-provenance policy (which of inline/remote/local/external is emitted; zip handover with `external`; warn on unresolvable `local`/`remote`); CSV inclusion policy on export (inline rows vs external ref); idle thumbnails (write `meta.thumb` on save/export; regenerate local IDB thumbs at idle); split labels (liner stock, ref `types.ts`); system-printer path; ZPL + PDF import; Playwright e2e suite; a11y + perf pass; promote docs to `docs/`; README/title updates | v1.0 tagged; e2e green                                                                                                                |

**Post-v1 parking lot:** RedBlackColorSpace (+ DoubleColor protocol verification on real hardware), RedGrayscale, MDI icons, advanced SVG import, font bundling on export, group scale/rotate, fold-mirror, mobile, LOD caching if profiling demands.

**Scaffolding rule:** parked features keep their seams in v1 — interfaces, registries, enum values, and type slots ship now (`ColorSpace` interface with only `Mono` implemented, `PageColorType.DoubleColor` typed but unused, quantizer registry extensible). Only implementations are deferred, so post-v1 additions are drop-in.

## Decisions log (ambiguity → resolution)

| #   | Ambiguity (chat)                            | Resolution                                                                                                                                                           | Source                                  |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Per-object binarization vs unified pipeline | Unified RGBA intermediate; per-object quantizer **policy hints** as masks                                                                                            | owner, gpt-review §4                    |
| 2   | Red/black in v1?                            | Architecture (color space ≠ quantizer) in v1; RedBlack impl **post-v1**; all 4 ditherers ship in mono v1                                                             | owner 2026-09-29                        |
| 3   | Template threat model                       | Trusted user code + explicit trust gate (Office-macro model); worker + timeout; no hostile sandbox                                                                   | owner, gpt-review §6                    |
| 4   | Template language                           | `TemplateEngine` interface, `JavaScriptTemplateEngine` first; `{{ }}` sugar optional later                                                                           | owner, gpt-review §7                    |
| 5   | Hierarchy duplication                       | Flat `nodes[]` + `parentId` only; layers/groups = UI views; groups are nodes                                                                                         | owner, gpt-review §8/9                  |
| 6   | Font identity                               | Imported: sha256 once at import; system: descriptor (non-portable, ⚠)                                                                                                | owner + GPT follow-up                   |
| 7   | Editor coords                               | World hm coords; viewport transform; no LOD system, min-resolution rule                                                                                              | owner, gpt-review §16                   |
| 8   | JSON ints vs Int32Array                     | Plain JSON integers + gzip                                                                                                                                           | GPT §2, v0.2                            |
| 9   | Konva mode                                  | react-konva for editor; plain Konva offscreen for preview/print; shared node factory                                                                                 | CTO (reconciles chat v0 + skeleton)     |
| 10  | Doc version field                           | `version: 1` (fresh schema)                                                                                                                                          | CTO                                     |
| 11  | MDI / advanced SVG                          | Post-v1; image object may accept SVG trivially if free                                                                                                               | GPT §14                                 |
| 12  | Fold/mirror (v0/v0.1)                       | Post-v1; keep-out warnings + snap guides cover the need                                                                                                              | CTO, killer-workflow-driven             |
| 13  | Group transform ops                         | Move/reorder/reparent in v1; group scale/rotate post-v1                                                                                                              | GPT §14                                 |
| 14  | First milestone shape                       | Vertical slice: P4 = print one weird label                                                                                                                           | GPT bottom line + owner killer workflow |
| 15  | Skeleton                                    | Keep shell + strip drawing-specific code                                                                                                                             | owner 2026-09-29                        |
| 16  | Commits                                     | Semantic commit per reviewed phase                                                                                                                                   | owner 2026-09-29                        |
| 17  | Barcode library                             | Spike decides jsbarcode vs bwip-js at P5                                                                                                                             | CTO                                     |
| 18  | Roll-size mismatch warning                  | Restored: non-blocking warning only; printing never gated on printer-reported roll dims                                                                              | owner 2026-09-29, chat update #7        |
| 19  | Polygon shape node                          | In v1: shape = line, rectangle, ellipse, polygon                                                                                                                     | owner 2026-09-29                        |
| 20  | File format & dates                         | `.lbl.json.gz`; `meta` dates = epoch seconds                                                                                                                         | owner 2026-09-29                        |
| 21  | Week estimates                              | Dropped — meaningless under AI-driven execution                                                                                                                      | owner 2026-09-29                        |
| 22  | Parked features                             | Keep full scaffolding in v1 (interfaces/registries/enums); defer only implementations                                                                                | owner 2026-09-29                        |
| 23  | Asset references                            | One `AssetRef` shape with four provenances — inline data URL / remote URL / local IDB ref / external sibling file. Format supports all four now; export policy at P8 | owner 2026-09-29                        |
| 24  | Template `now`                              | `ctx.now = Date.now()` (ms) at resolve time; never stored. Document `meta` = epoch seconds                                                                           | owner 2026-09-29                        |
| 25  | Region roles                                | `regions` consumed only as `union()` clip — no roles, ids, or zone assignment                                                                                        | owner 2026-09-29                        |
| 26  | Doc date precision                          | Epoch seconds — document never records sub-second edit times                                                                                                         | owner 2026-09-29                        |
| 27  | Validation library                          | zod acceptable; final pick (zod vs hand-rolled) at P2                                                                                                                | owner 2026-09-29 ("zod can work, idk")  |
| 28  | CSV resource                                | CSV participates in `AssetRef` like every other asset; `data.csv: CsvRef`                                                                                            | owner 2026-09-29                        |
| 29  | Asset naming                                | All resource refs carry `name` + optional `alt` ("what this was") so replacements are identifiable                                                                   | owner 2026-09-29                        |
| 30  | Fingerprints                                | Optional sha256 per `AssetRef` kind; computed once at import when bytes are available; verify on load when present; never re-hashed                                  | owner 2026-09-29                        |
| 31  | External provenance                         | `AssetRef.external` — asset not carried by the doc (zip sibling or user re-import); doc records mediaType + optional fingerprint                                     | owner 2026-09-29                        |
| 32  | Document trust state                        | Stored in IDB `trust` store keyed by doc id — never document data. Values always / never / ask. `never` blocks everywhere incl. authoring machine until re-enabled in settings; prompt allow/deny = session only | owner 2026-09-29                        |
| 33  | Globals expiry                              | `GlobalSpec.expiresAt` (epoch seconds) replaces relative `ttlSec`                                                                                                    | owner 2026-09-29                        |
| 34  | dpi field                                   | `number` (was 203/300/450 literal union) — printer-reported, user-overridable, common 203 or 300                                                                     | owner 2026-09-29                        |
| 35  | dpi validation & mismatch                   | Clamp 100–1200 (rounded); raster-pixel cap; doc-vs-printer dpi mismatch → same non-blocking warning as roll size                                                     | owner 2026-09-29                        |
| 36  | Font source naming                          | `FontRef.source.embedded` → `imported` (asset may be inline/remote/local/external); the duplicate `remote` variant is removed                                          | owner 2026-09-29                        |
| 37  | Gallery rendering                           | Never executes templates, never fetches network. Card art: local thumb → doc `meta.thumb` → geometry placeholder                                        | owner 2026-09-29                        |
| 38  | Thumb in document format                    | Yes: `meta.thumb` (raster-only data URL, cosmetic, may be stale). Justified by zip handover with external assets + untrusted docs                     | owner 2026-09-29                        |
| 39  | Id re-assignment & trust inheritance        | Import and duplicate mint a new `meta.id`; duplicate explicitly copies source's trust record; import never carries trust                               | owner 2026-09-29                        |
| 40  | i18n                                       | Keep react-i18next: all product UI strings through `t()` with typed keys; dynamic strings via the literal-map pattern                                  | owner 2026-10-02                        |
| 41  | Reuse map refresh                          | Template delta folded in: Modal/dialogService, settings window + persisted store, form kit, i18n, Vitest kept; pure export helpers kept, ExportModal UI stripped | CTO 2026-10-02                          |
| 42  | Reference is not a ceiling                  | niim.blue (`references/niimblue`) reviewed 2026-10-03 as a peer, not a target. Beyond-reference features are **intentional differentiation**, not over-scope to trim: trusted JS template engine (worker/frozen ctx/timeout/trust gate), per-object quantizer policy masks, Globals prefetch, AssetRef provenances+fingerprint+name/alt, union(regions) clip + node tree. Rule: each differentiator stays isolated behind its interface and never blocks the plain CSV→bind→preview→print path. | owner 2026-10-03 |

## Risks

| Risk                                                          | Mitigation                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@mmote/niimbluelib` CJS-only; Capacitor hard-deps; API drift | Verified on npm (0.47.0); P1 spike locks the adapter and checks Vite CJS interop + bundle impact of Capacitor deps; pin exact version  |
| Offscreen font loading races (blank text in print raster)     | await `document.fonts.ready` + explicit font loads before rasterize; golden test catches                                               |
| Interleaved sequence is packet-rate bound                     | Default grouped; warn >50 pages; P7 measures                                                                                           |
| Template worker hangs / memory                                | 250 ms (configurable) timeout → worker reset; no dynamic import                                                                        |
| System font metric drift across machines                      | ⚠ badges; imported-font path is the portable one                                                                                       |
| Large CSVs                                                    | Virtualized UI, 50k cap + warning                                                                                                      |
| Editor/print divergence                                       | Invariant 7: preview ≡ print (golden tests compare those two only); editor joins resolve + factory but is exempt from pixel comparison |
| Scope creep (the real project risk — this is a small DTP app) | Parking lot enforced; phases gated; GPT's caveat on estimates acknowledged                                                             |

## Handoff

1. User switches to **`coordinator`** (Tab). Coordinator owns P1–P8 (impl → review → fix → commit per phase).
2. Per-phase action plans live here: `agent/2026-09-29_label-editor-v1/phase{N}_action-plan.md`; running status in `state.md` (gitignored via `.gitignore` addition in P1).
3. Escalations to Build (CTO) only: invariant violations, cross-phase architecture calls, review deadlocks (2 fix rounds).
4. End of phase: coordinator escalates project-relevant lessons to `agent/memory.md` (repo index) + `agent/memory/*.md` areas; promotes final user-facing docs to `docs/`.
