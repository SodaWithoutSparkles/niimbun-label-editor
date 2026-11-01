# P4 — red/black authoring (text fill + image tint)

Run: [`plan.md`](plan.md) §2 P4. Two sequential waves (`general` each); `review` gates.
Authoring only — no red/black print conversion yet (P5).

## Goal

Colour is the ink selector; no ink enum. Text stops being hardcoded black and gains
a `fill`; images gain an optional `tint`. Shapes/QR/barcode/code already carry
`fill`/`stroke`. Inspector rows follow the existing `FieldDescriptor`/`ColorPicker`
pattern. The doc model stays optional-additive (no version bump).

## Paint semantics (decided here)

- **Text `fill`**: CSS colour, same format as shape fill (`#rgb`/`#rrggbb`/
  `#rrggbbaa`/`'transparent'`). Absent ⇒ `DEFAULT_TEXT_FILL = '#000000'`
  (today's black). It is the glyph colour in print **and** the editor preview.
- **Image `tint`**: optional CSS colour; absent or `'transparent'` ⇒ no tint
  (identity). When set, every source pixel is recoloured **by luminance**:
  `out = 255 + (tint - 255) * (1 - L/255)` with `L = monoLuminance(r,g,b)`,
  alpha preserved. Equivalent wording: blend white → tint by source darkness.
  - red tint on a grey `L` gives `(255, L, L)` — which the P1 red/black palette
    diffuses into red/white dots in proportion to darkness (the owner's
    "greyscale image dithered in red only = a red-tinted image");
  - black tint on neutral grey is identity (`out = L`), white tint erases;
  - hue of the source is ignored on purpose: a tint selects **ink colour**, the
    source luminance selects ink **density**.
- Tints apply to the prepared asset, so **one implementation** serves print,
  dialog preview, thumbnails, the quantized overlay and the editor canvas.

## Wave A — doc model + render/preview

### A1. `src/core/doc/types.ts`

- `TextNode` gains `fill?: string;` (doc comment: CSS colour; absent ⇒ black;
  authored ink, not a print mode).
- `ImageNode` gains `tint?: string;` (doc comment: optional luminance tint,
  absent/`'transparent'` = none; see the paint rule above).

### A2. `src/core/doc/objects.ts`

- `export const DEFAULT_TEXT_FILL = '#000000';` next to the other paint
  defaults, with a one-line doc (the mono-world black that used to be hardcoded
  in `rasterize.ts`).

### A3. `src/core/doc/validate.ts`

- Text case (`:577-594`): copy `fill` with
  `toOptionalColor(value.fill, repairs, 'node.fill: invalid colour dropped')`
  and spread it into the node only when defined.
- Image case (`:595-606`): copy `tint` with
  `toOptionalColor(value.tint, repairs, 'node.tint: invalid colour dropped')`.
- Absent stays absent (no rewrite); invalid is dropped + a repair, exactly like
  shape colours.

### A4. `src/editor/render/resolve.ts`

- `ResolvedText` gains `fill: string` (always defaulted:
  `node.fill ?? DEFAULT_TEXT_FILL`).
- `ResolvedImage` gains `tint?: string` (pass through when defined).
- Update the text and image `switch` branches.

### A5. `src/core/render/tint.ts` (new, pure) + `index.ts`

```ts
/** Parse `#rgb` / `#rrggbb` / `#rrggbbaa` (alpha ignored). */
export const parseHexColor = (color: string): [number, number, number] | undefined;
/** Recolour RGB by luminance toward `tint`, preserving alpha. No-op for
 *  'transparent'/invalid colours. Mutates in place, returns the buffer. */
export const tintRgbaByLuminance = (rgba: RgbaBuffer, tint: string): RgbaBuffer;
```

- Formula and rationale in the doc comment (above), plus: the alpha byte is
  never touched; `'transparent'`/unparseable input is a no-op (validation already
  rejects the latter).
- Export both from `src/core/render/index.ts`.

### A6. `src/editor/render/tint.ts` (new, DOM)

```ts
/** The same asset when `tint` is absent/'transparent'; otherwise a fresh
 *  canvas carrying the tinted pixels (never mutates the cached asset). */
export const tintAsset = (asset: PreparedAsset, tint: string | undefined): PreparedAsset;
```

- Draw the asset into a fresh canvas at `asset.widthPx × heightPx`, `getImageData`,
  `tintRgbaByLuminance`, `putImageData`, return `{image: canvas, widthPx, heightPx}`.
- Unit-testable with a tiny canvas.

### A7. `src/editor/render/prepareAssets.ts`

- Image case: `assets.set(node.id, tintAsset(capImageAsset(asset, w, h), node.tint));`
- Doc comment: the tint is per leaf, after the shared decode cache, so the cached
  asset is never mutated.

### A8. `src/components/editor/usePreparedAssets.ts`

- `leafSignature` image branch: include `node.tint ?? null` so changing the tint
  re-prepares (otherwise the editor keeps the old raster).
- Update the "mirrors `prepareResolvedAssets`" doc comment.

### A9. `src/editor/render/konvaFactory.ts` + `src/components/editor/ResolvedShape.tsx`

- Print `Konva.Text` (`konvaFactory.ts:403-415`): add `fill: node.fill`.
  `applyInkDefaults` keeps its black fallback (defence only).
- Preview `ResolvedShape` text (`~:177`): `fill: node.placeholder ? '#9ca3af' :
  node.fill` (placeholder stays grey).
- Image tint needs no paint-layer change: both draw the prepared asset.

### A10. Tests (wave A)

- `src/core/render/tint.test.ts` (new): parse `#rgb`/`#rrggbb`/`#rrggbbaa`;
  transparent/invalid no-op; red tint on grey `L` → `(255, L, L)`; black tint on
  neutral grey → unchanged; white tint → white; alpha preserved; deterministic.
- `src/core/doc/validate.test.ts`: text `fill` round-trips (and `'transparent'`);
  invalid text fill → dropped + repair; image `tint` round-trips; invalid tint →
  dropped + repair; absent fields stay absent (no key).
- `src/editor/render/resolve.test.ts`: text `fill` defaults to
  `DEFAULT_TEXT_FILL` and passes through; image `tint` passes through when set and
  is absent otherwise.
- `src/editor/render/konvaFactory.test.ts`: a resolved text node's Konva `fill()`
  equals its `fill`; a resolved image node still paints the asset.
- `src/editor/render/rasterize.test.ts` (or the closest rasterise suite): text
  with `fill: '#ff0000'` rasterises **red** pixels (`renderPageBase`/the colour
  path, not the quantizer); default text stays black.
- `src/editor/render/prepareAssets.test.ts`: with an injected `resolveImage`
  asset, a tinted image leaf yields a canvas whose non-transparent pixel is
  tinted; no tint returns the asset unchanged (same `image` identity).
- `src/components/editor/ResolvedShape.test.tsx`: preview text uses the resolved
  fill; placeholder stays grey.

### Wave A verification

`tsc`; core/doc + render + editor suites; then the full suite (mono/greyscale
goldens unchanged — a black default changes nothing).

## Wave B — inspector + i18n

### B1. `src/editor/inspectorModel.ts`

- `TEXT_FIELDS`: add `{ key: 'fill', scope: 'text', kind: 'color', wired: true }`
  (reuses `editor.mfp.field.fill`).
- `IMAGE_FIELDS`: add `{ key: 'tint', scope: 'image', kind: 'color', wired: true }`.
- Do **not** touch `RESERVED_FIELDS` (the exact-key test pins it).

### B2. `src/components/editor/ObjectTab.tsx`

- `colorDefault`: `fill` → `DEFAULT_TEXT_FILL` for `node.type === 'text'`
  (symbols keep `DEFAULT_SYMBOL_FILL`, others `DEFAULT_SHAPE_FILL`); add
  `if (key === 'tint') return TRANSPARENT_COLOR;`.
- The existing colour case renders both rows; clearing deletes the key
  (`undefined`) as today. For tint, `supportsAlpha={false}` is not required —
  the helper ignores hex alpha; keep the shared colour case unchanged unless the
  generic case forces alpha (do not fork it).
- Update the `colorDefault` doc comment.

### B3. i18n

- `src/i18n/locales/en.json`: add `editor.mfp.field.tint` = `"Tint"`.
  `fill` already exists — reuse. One writer.

### B4. Tests (wave B)

- `inspectorModel.test.ts`: text fields include `fill`; image fields include
  `tint`; `RESERVED_FIELDS` unchanged.
- `ObjectTab.test.tsx`: text node shows a Fill colour row seeded from the node
  (default black when absent) and writes `fill` to the node; image node shows a
  Tint row (default transparent) and writes `tint`; clearing removes the key.

## Out of scope

- No red/black print conversion, page selector, capability changes (P5/P6).
- No shape/symbol changes (they already carry `fill`/`stroke`).
- No doc version bump, no migration, no `RESERVED_FIELDS` changes.
- No replacement of the ColorPicker preset palette (red is already a preset).

## Exit criteria

- Text fill + image tint authored, validated, resolved, painted in print **and**
  preview, tinted through one shared asset path.
- `tsc` clean; full suite green; `review` PASS.
