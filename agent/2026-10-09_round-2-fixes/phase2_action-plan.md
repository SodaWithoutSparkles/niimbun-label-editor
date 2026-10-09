# Phase 2 action plan — Symbol `fill` + ink-aware masks + quiet zones

Plan ref: [`plan.md`](plan.md) §P2 (owner decisions 6/7, fix (A)). Items: "Stacking different
quantization level objects yield unexpected results"; quiet zones; `fill` on qr/barcode.

## Deliverables

- **A — ink-aware policy mask (fix A).** Build the per-object policy mask from **visible ink**
  instead of the drawn rect: stencil the prepared asset's opaque pixels (tint `source-in`) in
  z-order. Transparent modules inherit the leaf below; opaque `fill` owns the whole rect.
  `renderLabelPage.ts:312-334` only; `policy.ts` recombination is unchanged (selection, not alpha).
- **B — `fill` on qr/barcode** (`fill?: string`, default `'transparent'`): apply.js/`backgroundcolor`
  not used — the engine composites a padded canvas: transparent → light modules + quiet zone see
  through; a colour/white → opaque symbol background (WYSIWYG, whole rect legitimately masked).
- **C — quiet zones (default ON).** Explicit/derived per symbology, generated ourselves (not
  bwip `paddingwidth`): QR ≥ 4 modules/side; 1D per-symbology (fallback 10X). Node field
  `quietZone?: number` (modules/side, absent ⇒ derived default). Updates P1's verdict budget.
- **D — tests + memory.** `renderLabelPage`-level stacking matrix, quiet-zone budget, validate
  round-trip. Update `memory/objects-assets.md` mask note + debt D-34.

## Files

- `src/core/doc/objects.ts` — fill/quiet defaults + `barcodeQuietModules(symbology)`.
- `src/core/doc/types.ts` — `QrNode.fill?/quietZone?`, `BarcodeNode.fill?/quietZone?`.
- `src/core/doc/validate.ts` — accept + repair `fill` (colour) / `quietZone` (0–64 int).
- `src/editor/render/resolve.ts` — `ResolvedQr/Barcode: fill, quietModules`.
- `src/editor/render/qrImage.ts` / `barcodeImage.ts` — options `{quietModules, fill}`, padded canvas.
- `src/editor/render/prepareAssets.ts` — thread resolved fill/quiet into the engines.
- `src/editor/render/konvaFactory.ts` — `maskAssetSceneFunc` (tinted-asset stencil).
- `src/editor/render/renderLabelPage.ts` — asset carrier uses the stencil.
- `src/editor/inspectorModel.ts` / `ObjectTab.tsx` — `fill` (color) + `quietZone` (number) fields.
- `src/editor/insertActions.ts` — seed `fill: 'transparent'`.
- `src/i18n/locales/en.json` — `quietZone` label.
- Tests: `assets.test.ts`, `renderLabelPage.test.ts`, `renderLabelPage.symbolVerdict.test.ts`,
  `validate.test.ts`.

## Key formulas

- QR: `totalModules = baseW/2 + 2·quiet`; verdict `min(target)/totalModules < minModulePx`
  (this already equals the drawn pitch after the node's `contain` fit — square asset).
- Barcode: `scaleX = floor(targetW/(totalModules))`; **verdict amended in review round 1:**
  `scaleX * drawScale < minModulePx` where `drawScale = min(targetW/canvas.width, targetH/canvas.height)`.
  Rationale: barcode/qr are drawn with `fit:'contain'` (`konvaFactory.ts`), so a height-constrained box
  uniformly shrinks the asset and the drawn X pitch drops below `scaleX`. The original
  `scaleX < minModulePx` (plan.md:48 "parity only") scored the pre-fit pitch and missed that case.
  **New warning class:** height-constrained barcodes may newly trip `too-small` — a correctness fix,
  coordinator-approved 2026-10-10, outside R9's quiet-zone set but the same "correct warnings" intent.

## Review
`experimental-review` primary; max 2 fix rounds.

## Commit
`feat(render): ink-aware symbol masks, symbol fill and quiet zones (#14/P2)`.

---

## Re-plan + status (coordinator, 2026-10-09)

A prior partial run (started ad-hoc on `general`) left **uncommitted** P2 code. Base-verified
inventory at HEAD `cac9bd9` (docs commit; code base `ab8d1b7`):

### DONE (verified: `tsc --noEmit` clean)
- `objects.ts` — `DEFAULT_SYMBOL_FILL`, `DEFAULT_QR_QUIET_MODULES=4`, `BARCODE_QUIET_MODULES` +
  `barcodeQuietModules(symbology)`.
- `types.ts` — `QrNode.fill?/quietZone?`, `BarcodeNode.fill?/quietZone?`.
- `validate.ts` — `toQuietZone` (int, clamp 0–64, drop-invalid) + `fill` colour repair on qr/barcode.
- `resolve.ts` — `ResolvedQr/Barcode.fill, quietModules` (defaulted).
- `qrImage.ts` / `barcodeImage.ts` — `SymbolRenderOptions {quietModules, fill}`, our own padded
  quiet-zone canvas (not bwip `paddingwidth`), `fill` background, `imageSmoothingEnabled=false`,
  P1 verdict formula moved to the padded/total module budget.
- `prepareAssets.ts` — threads resolved `fill`/`quietModules`.
- `konvaFactory.ts` — `maskAssetSceneFunc` (tinted-asset stencil via `source-in`).
- `renderLabelPage.ts` — asset policy carrier now uses the stencil instead of the drawn rect.

### REMAINING (this re-plan)
1. **Inspector wiring (MISSING):** `inspectorModel.ts` `QR_FIELDS`/`BARCODE_FIELDS` lack `fill`
   (`kind:'color'`) + `quietZone` (`kind:'number'`); `ObjectTab.tsx` `FIELD_LABEL_KEYS` lacks
   `quietZone`; `numberValue` must show the *effective* quiet default when absent (qr 4 / barcode
   per-symbology); slider clamp 0–64.
2. **Insert seeding (MISSING):** `insertActions.ts` qr/barcode seed `fill: DEFAULT_SYMBOL_FILL`
   (leave `quietZone` absent ⇒ derived default).
3. **i18n (MISSING):** `en.json` `editor.mfp.field.quietZone` (the `fill` label already exists, :522).
4. **Tests (MISSING + 5 P1 tests now FAIL):**
   - Fix 5 failures in `src/editor/render/assets.test.ts` (crisp-scale ×2, too-small ×2, pitch #12):
     expectations must account for quiet-zone-padded canvas width.
   - New engine/validate tests: quiet default + explicit + 0; verdict on the padded budget; `fill`
     transparent vs colour; `validate` round-trip (clamp/drop).
   - R8 stacking matrix at `renderLabelPage` level (transparent modules show the image's dither
     through; opaque `fill` → threshold owns the rect; symbol-over-symbol z-order).
5. **Memory (MISSING):** update `agent/memory/objects-assets.md:40-43` mask note (drawn-rect →
   ink stencil) and reconcile debt D-34 (`agent/memory/tech-debt.md:43`).

### Corrections to this action plan
- Test paths are **colocated**, not under `src/test/`: `src/editor/render/assets.test.ts`,
  `src/editor/render/renderLabelPage.test.ts`,
  `src/editor/render/renderLabelPage.symbolVerdict.test.ts`, `src/core/doc/validate.test.ts`.
- Inspector UI file is `src/components/editor/ObjectTab.tsx`.
- `colorDefault('fill')` already returns `'transparent'` (`DEFAULT_SHAPE_FILL`) which equals
  `DEFAULT_SYMBOL_FILL` — no change required there.
