# Phase 11 — 2D code formats (new object) — action plan

- Run: `agent/2026-10-09_round-2-fixes/`. Plan: [`plan.md`](plan.md) §P11, owner decision 6.
- Recon 2026-10-16: 3 × `explore` (node-kind sweep, symbol-engine seam, palette+i18n surface) +
  1 × `scout` (bwip-js facts, measured against the installed lib). Facts below are verified.
- Status: **recon done, no source edits.** Awaiting owner go-ahead.

## Owner decisions

- **2026-10-16 — format set = matrix set (7):** `datamatrix`, `aztec`, `pdf417`, `microqrcode`,
  `codeone`, `hanxin`, `ultracode`. (Not dotcode/maxicode — fractional/hex module grids.)
- Unchanged from plan.md: **new `code` node kind, QR untouched** (decision 6); v0 alpha, breaking
  changes OK; reuse P2's `fill` + quiet zones + ink-aware masks; semantic commit per phase after review.

## Verified facts (do not re-explore)

### bwip-js
- Installed **4.11.4 (2026-08-19) / BWIPP 2026-05-28**, pinned. `import { toCanvas } from 'bwip-js/browser'`.
- **`toCanvas` mutates the options object** — build fresh options per call (already the rule in
  `qrImage.ts:56-66`). Empty/falsy `text` throws.
- **bwip draws no quiet zone by default.** The BWIPP `border*` values in modules exist but are only
  rendered under `showborder`/bearer. `paddingwidth/height` default **0** and are separate whitespace.
  → our own padding is correct, and **do not set `backgroundcolor`** (it makes bwip draw its own
  border/shape and would double-count the zone) — matches the P2 scout note.
- **`baseW / 2 = moduleCount` holds for MATRIX codes only.** Matrix bcids draw **2 device px per
  module at scale 1**; **`pdf417` draws 1 px/module** (`/modunit 1`). Non-integer `scale` is
  unreliable (1.5 rendered as 1×) → integer scales only.

### Per-format table (measured at scale 1, padding 0)

| bcid | class | px/module | QZ (standard) | bwip border | verified measurement |
|---|---|---|---|---|---|
| `datamatrix` | matrix | 2 | 1 | 1 | 18×18 mod → 36 px |
| `azteccode` | matrix | 2 | 1 | **0** | 23 mod → 46 px |
| `pdf417` | stacked | **1** | 2 | 2 | `columns=2` → 103 px = `17·cols+69` mod |
| `microqrcode` | matrix | 2 | 2 | 2 | 11 mod → 22 px |
| `codeone` | matrix | 2 | 1 (top 0) | 1/0 | 36×32 px (18×16 mod) |
| `hanxin` | matrix | 2 | 3 | 3 | 25 mod → 50 px |
| `ultracode` | matrix | 2 | 1 | 1 | 15×13 mod → 30×26 px |

- `azteccode`: use the plain `azteccode` bcid with `format:'full'` — **exclude `aztecrune`**
  (numeric payload only, throws otherwise).
- `pdf417`: `columns` is optional (`0` = auto) — do **not** require it; nice payloads need no tuning.
- Per-format advanced options (`version`, `eclevel`, `format`, `columns`, `rowmult`, `layers`) change
  the module grid → **out of scope this phase** (see decisions).
- `codeone` (18×16) and `ultracode` (15×13) are **non-square** → `code` must not use QR's square-fill
  path. Use contain-fit + the drawn-pitch verdict (the P2 amendment to the barcode formula).

### Engine seam (what exists)
- `renderQr` (`qrImage.ts:41`) and `renderBarcode` (`barcodeImage.ts:42`) are **copy-paste siblings**
  (~10 duplicated blocks: `BwipOptions`, `integerPx`, guards, measure canvas, padded composite,
  `hasFill` fillRect, `imageSmoothingEnabled=false`, `drawImage`, verdict, catch→null).
- Shared already: `quietModulesOf`, `GeneratedSymbol`, `SymbolRenderOptions` (`assets.ts:22-51`).
- `fill` is applied by the **engine** (rect over the padded canvas incl. the quiet zone), not the caller.
- `minModulePx = minModulePxFor(symbolScale)`, `MIN_MODULE_MM = 0.25` (`prepareAssets.ts:37-46,190-202`).
- **No measurement harness exists** — the `2 px/module` fact lives only in docs. That is why W0 pins it
  in-repo.

### Node-kind sweep (12 hand-written arrays + 5 silent traps)
Full checklist captured in the recon; the traps that will NOT fail the build and must be done by hand:
1. `validate.ts:69 NODE_TYPES` and `toolsSlice.ts:21 INSERT_ACTIONS` — hand-written.
2. **`core/render/policy.ts:17-22`** — without `code:'threshold'` the new object silently gets the
   global dither pass (mushy, unscannable print) instead of threshold.
3. **`core/doc/geometry.ts:50-53`** — without `code`, corner resize distorts the module grid.
4. **`renderLabelPage.ts:254,312`** mask-carrier cases — without `code` it claims no ink-mask coverage.
5. `resolve.ts:344` square-fit special-case and the `'contain'` ternaries key on literal type lists.
Build-enforced todo list (will fail `tsc` until filled): `LayersPanel.tsx:41,228`,
`inspectorModel.ts:210`, `ObjectsTab` `FIELD_DEFAULTS`, `JsTab` `FIELD_LABEL_KEYS`.
Warnings, `renderLabelPage` warnings map, `previewWarnings`, `WarningsTab`, `ResolvedShape` badges
are all **shared** — they wire for free once `code` reaches `prepareAssets`.
`regionOverlay.ts:267` needs **no** change.

## Waves

**Status 2026-10-16: DONE.** W0 ✅ · W1 ✅ · W2a ✅ · W2b ✅ · W3 ✅ · W4 ✅ · W5 ✅ · `review` gate
**APPROVED** (+ 1 test-only fix round, `review-fast` re-review approved). Commits **`45d5daa`**
(feature) + **`4135c54`** (docs/memory). Tests **153 files / 1880** green; `tsc` clean.

- **W0 — pin the measurements** (`small-coder`). **DONE** — `CODE_FORMATS`/`CodeFormat`/`DEFAULT_CODE_FORMAT`/
  `CODE_FORMAT_PX_PER_MODULE`/`CODE_FORMAT_QUIET_MODULES`/`codeQuietModules` in `core/doc/objects.ts` +
  `src/editor/render/codeFormats.test.ts` (happy-dom + canvas shim, real bwip at scale 1).
  **Measured, pinned (payload `'LABEL-EDITOR-2D'`, scale 1, padding 0):** datamatrix 18×18 ·
  azteccode 23×23 · pdf417 103×27 (**1 px/module**) · microqrcode 17×17 · codeone 22×22 ·
  hanxin 25×25 · ultracode 20×13. Test also asserts `scale:2` doubles exactly (integer scaling) and
  the quiet-zone table. **Gotcha confirmed:** `toCanvas` writes `scaleX/scaleY` back onto the options
  object, so a spread of a previously-used options object silently pins scale — build fresh options.
- **W1 — engine** (`general`). **DONE** — new `symbolEngine.ts` (`BwipOptions`, `integerPx`, three
  mutation-safe option builders, `padSymbol`, `drawnPitchBelowMinModule`); `qrImage.ts` 111→86,
  `barcodeImage.ts` 112→93 rewritten on it (behaviour byte-identical — the 37 `assets.test.ts` symbol
  tests pass unmodified); new `codeImage.ts` (`renderCode`, uniform integer `scale`, exact
  `modulePx = pxPerModule * scale`, all-sides quiet zone, drawn-pitch verdict); +3 `renderCode` cases in
  `codeFormats.test.ts`. `tsc` clean; `src/editor/render` 15 files / 238 tests green.
- **W2a — core model** (`general`). **DONE** — `CodeNode` (`format: CodeFormat` **required**; invalid →
  `DEFAULT_CODE_FORMAT` at validate time, unlike qr's drop-to-absent `errorCorrection`), `NodeType`,
  `Node` union, `NODE_TYPES`, `validate` `case 'code'`, `policy.ts code:'threshold'`, `geometry.ts`
  aspect-lock, `contentSource.ts`, `core/trust.ts`, `factory.ts` confirmed needing no branch, plus the
  exhaustive maps (`LayersPanel` `ScanLine` icon + label key, `inspectorModel` `CODE_FIELDS`,
  `ObjectTab` defaults/label, `JsTab` key map) and 2 i18n keys (`editor.insert.code`, `editor.mfp.field.format`).
  Two test files needed a mirror `case 'code'` arm (tsc-required exhaustive switches only; no assertion
  changed). `tsc` clean; full suite **148 files / 1858 tests** green.
- **W2b — render wiring** (`general`) + **W3 — palette/inspector** (`general`) — running in parallel on
  disjoint files.
- **W4 — docs/memory** (`small-coder`): update `memory/objects-assets.md` (§bwip: per-format
  px/module + quiet-zone table, the options-mutation trap, `code` = contain-fit) and the "to add a new
  leaf type" list. `en.json` keys are written by the wave that needs them (W2a, W3) — no batching.
- **W5 — tests** (`tester`, after W2b/W3): per-format render + verdict budget at `renderLabelPage`
  level, `validate` round-trip for `format`/`fill`/`quietZone`, palette/inspector smoke, ink-mask
  carrier coverage for `code`, crispness (integer-scaled, byte-exact), a too-small case per unit class
  (matrix 2 px/module + pdf417 1 px/module).
- **Gate:** `review` → fix (max 2 rounds) → semantic commit.

## Decisions (owner 2026-10-16 — **all four accepted, go-ahead given for W0 + W1**)

1. **Aztec quiet zone default = 0** (matches bwip's own border + the P2 scout note; the standard says 1
   — flagged for a scanner test).
2. **Per-format advanced options are OUT of scope** — the picker ships `data` + `fill` + `quietZone`
   only, like QR/barcode today.
3. **Nice format labels** via an `as const` literal map (7 entries), not raw bcids.
4. **Extract the shared symbol engine** (plan decision 6) — behaviour-preserving, gated on the
   existing byte-exact tests.

Format ids are the **raw bcids** (consistent with `BarcodeNode.symbology`):
`datamatrix`, `azteccode`, `pdf417`, `microqrcode`, `codeone`, `hanxin`, `ultracode`.

## Risks

- **R11-a** silent traps in the 12 hand-written arrays (list above) — build stays green while
  behaviour is wrong.
- **R11-b** copying QR's `/2` into a shared engine breaks pdf417 (1 px/module) — the W0 test pins it.
- **R11-c** refactoring shipped qr/barcode code; gate on `assets.test.ts` byte-exactness.
- **R11-d** non-square formats (codeone, ultracode) must not take the square-fill path.
- **R11-e** aztec QZ conflict (owner decision 1).
