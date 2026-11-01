# P3 — grayscale wiring (render + print + dialog)

Run: [`plan.md`](plan.md) §2 P3. Coordinator drives. Two sequential waves
(`general` each); `review` gates the phase.

P3 makes **16-level grayscale** a working print-time page colour end to end:
render → preview/thumbnails → print job → adapter capability → dialog control.
Red/black stays gated until P5; P6 unifies the selector.

## Shared vocabulary (decided here, used by P5)

`PageColorMode` — a **library-free** render-level mode:

```ts
export type PageColorMode = 'mono' | 'grayscale' | 'redBlack';
```

- Lives in `src/core/render/palette.ts` (exported from `core/render/index.ts`).
- `RenderLabelPageOptions.pageColor?: PageColorMode` (absent = `'mono'`).
- The library enum (`PageColorType`) is converted at the **print boundary** only
  (`src/print/printLabel.ts`), never in `core/`/`editor/render`.
- `'redBlack'` renders by `RangeError('... not implemented yet')` in P3; P5
  replaces that branch.

## Semantics

- **Grayscale** skips `buildPolicyMask` + `quantizeRgba` entirely and runs
  `diffuseToPalette(imageData, grayscaleRampPalette(), …)` on the tone-mapped
  raster (P1 engine; band centres `255-17k`, so the encoder maps each pixel back
  to the intended level exactly).
  Diffuser knobs come from `buildQuantizeOptions(opts, dpi)` — `gamma`,
  `strength`, `serpentine` — so the render-level settings and the per-strategy
  defaults for the selected global quantizer still apply. Default global
  quantizer is `threshold` ⇒ gamma 1 (neutral), strength 1, serpentine true.
- Region clip (pre **and** post), invert, mirror, offset all keep their current
  order. `invertRgb` is already pigment-safe (P2) and inverts ramp level `k` to
  `15-k` exactly.
- The raster stays **opaque**: the rasterizer paints white and
  `diffuseToPalette` preserves alpha; a doc with no background must encode as
  level 0, never level 15 (transparent→black trap).

## Wave A — render + print + capability

### A1. `src/core/render/palette.ts` + `index.ts`

- Add and export `PageColorMode` (doc comment: print-time page colour, doc stays
  colour-agnostic; `redBlack` is wired in P5).
- Re-export from `src/core/render/index.ts`.

### A2. `src/editor/render/renderLabelPage.ts`

- `RenderLabelPageOptions` gains
  `pageColor?: PageColorMode` (doc comment: absent = `'mono'`; grayscale skips
  the 1-bit policies and runs the 16-level ramp diffuser; `redBlack` throws until
  P5).
- Import `diffuseToPalette`, `grayscaleRampPalette`, and `type PageColorMode`.
- In `renderLabelPage`, after `applyRegionClip` (pre-clip):
  - `const pageColor = opts.pageColor ?? 'mono';`
  - `'redBlack'` → `throw new RangeError('renderLabelPage: pageColor redBlack is not implemented yet')`.
  - `'grayscale'` → `diffuseToPalette(...)` as above; **skip** the policy mask and
    `quantizeRgba` (no mask build, no `policyOverflowCount`).
  - `'mono'` → today's exact code path, byte-identical.
- Keep the returned shape; `policyOverflowCount` is simply absent in grayscale.
- Update the top pipeline doc block: add the page-colour branch (mono policies vs
  grayscale palette; `redBlack` later).
- **Opaque encoder canvas**: do not add a white fill before `putImageData` (it
  would not help — `putImageData` replaces alpha). Instead pin opacity with a
  test (the rasterizer + palette pass already guarantee it).

### A3. `src/editor/render/previewKeys.ts`

- `previewOptionsKey`: append a page-colour segment **only when non-mono**, so
  every existing mono key string stays byte-identical (no cache/test churn):
  push `options.pageColor` only if it is set and `!== 'mono'`.
- Extend the doc comment: a page-colour change must invalidate the preview.

### A4. `src/print/printLabel.ts`

- Export `pageColorModeOf(pageColor: PageColorType | undefined): PageColorMode`
  (SingleColor / undefined → mono, Grayscale → grayscale, DoubleColor →
  redBlack; SingleColorAlt → mono is unreachable because the guard rejects it —
  document that).
- `renderOptionsOf`: include `pageColor: pageColorModeOf(overrides?.pageColor)`
  **only when the mode is non-mono** (keeps existing option objects identical).
- Guard (`:184-197`): **allow `Grayscale`**; keep `DoubleColor` rejected with an
  updated message ("not supported by the current render path; red/black lands in
  P5"); keep `SingleColorAlt` rejected.
- Job: no other change — `pageColor` is already forwarded to the job
  (`:262-270`) and to `encodeCanvas` (`:247`).
- Update the `PrintOverrides.pageColor` doc: Grayscale is supported; DoubleColor
  is gated.

### A5. `src/print/transport.ts` + `niimbotAdapter.ts` + `mockTransport.ts`

- `PrinterCapabilities` gains `grayscale?: boolean` (doc: task supports 16-level
  grayscale pages; only the `D110M_V4` family).
- `capabilitiesOf`: set
  `grayscale: task.capabilities.includes(PrintTaskCapability.SupportGrayscale)`
  (mirror the `doubleColor` line; import the enum value already imported/needed).
- Mock defaults: `grayscale: true` (mock is a B1_PRO-like / D110M_V4 harness).
- No adapter print-path change: `PrintOptions.pageColor` already forwards
  `job.pageColor`; the library enforces `PrintOptions.pageColor ===
  image.pageColor`.

### A6. Tests (wave A)

New `src/editor/render/renderLabelPage.grayscale.test.ts`
(`@vitest-environment happy-dom`, `installCanvasShim`):

1. **Flat exact level**: doc with a rect filled `rgb(238,238,238)` (level 1 band
   centre) plus white background ⇒ rect pixel `(238,238,238)`, background
   `(255,255,255)`, all alpha 255.
2. **No diffusion on exact ramp values**: the rect interior contains only that
   exact grey (sample several points).
3. **Tone map produces both neighbours**: a rect filled a mid grey (`rgb(128,128,128)`)
   produces **both** `grayLevelColor(7)` (136) and `grayLevelColor(8)` (119)
   pixels (the diffuser is running, not a point op).
4. **Opaque background trap**: a `createLabelDoc` with no background node ⇒
   after `renderLabelPage(..., { pageColor: 'grayscale' })` every sampled pixel
   has alpha 255 and the background RGB is `255,255,255` (level 0), never black.
5. **Encoder parity end-to-end**: for a small canvas of known greys (levels
   0,1,7,15 written as `grayLevelColor(k)`), `ImageEncoder.encodeCanvas(canvas,
   PageColorType.Grayscale, 'left')` yields `rowDataGray` nibbles decoding to
   those exact levels — pins high-nibble-first, 0=white/15=black and the ×8 column
   padding. Decode helper: for each byte, `level1 = byte >> 4`, `level2 = byte & 0xf`.
   Also assert an all-white row is `dataType: 'void'` and two identical rows merge
   into `repeat: 2`.
6. **Mono unchanged**: the same doc rendered with no `pageColor` is byte-identical
   to `pageColor: 'mono'`, and still 1-bit.
7. **`redBlack` throws** `RangeError` (P5 placeholder).

Extend `src/editor/render/previewKeys.test.ts`:

8. mono/absent keys are unchanged (existing expectations untouched); a
   `pageColor: 'grayscale'` option changes the key, and mono vs grayscale differ.

Extend `src/print/printLabel.test.ts`:

9. `buildCsvPrintJob(..., { overrides: { pageColor: PageColorType.Grayscale } })`
   is accepted; `job.pageColor === Grayscale`, and with the real render seam the
   yielded `page.data.pageColor === job.pageColor` (the invariant).
10. `renderOptionsOf({ pageColor: Grayscale })` contains `pageColor: 'grayscale'`;
    `renderOptionsOf({ pageColor: SingleColor })` and `{}` contain no
    `pageColor` key.
11. Existing DoubleColor / SingleColorAlt rejections still pass.

Extend `src/print/niimbotAdapter.test.ts` (or the closest capabilities test):

12. `capabilitiesOf` reports `grayscale: true` for a D110M_V4-family task and
    `false` for a task without `SupportGrayscale` (use the library task objects /
    the existing test idiom in that file).

Full suite must stay green (mono goldens byte-identical).

### Wave A verification

`tsc`; render + print suites; then the full suite.

## Wave B — dialog + thumbnails (depends on wave A)

### B1. `src/components/common/Select.tsx`

- `SelectOption` gains `disabled?: boolean`; render `<option disabled={…}>`.
  Additive and generic (P6 uses it for unsupported modes).

### B2. `src/components/print/usePrintThumbnails.ts`

- `PrintThumbnailOverrides` gains `pageColor?: PageColorMode` (doc: pixel-changing;
  part of the rebuild key).
- Forward it into the explicit render options object at `:233-245`
  (`...(overrides.pageColor !== undefined ? { pageColor: overrides.pageColor } : {})`).
- `overridesContentKey`: append `|${pageColor}` **only when non-mono**, keeping
  existing keys stable.

### B3. `src/components/print/PrintDialog.tsx`

- State: `const [pageColor, setPageColor] = useState<PageColorType>(PageColorType.SingleColor);`
  — reset to `SingleColor` in the open-reset effect.
- `grayscaleSupported = capabilities?.grayscale === true`.
- Replace the hardcoded `pageColor: PageColorType.SingleColor` in
  `printOverrides` with the state; add `pageColor` to the memo deps.
- `thumbnailOverrides`: include `...(pageColor !== SingleColor ? { pageColor:
  pageColorModeOf(pageColor) } : {})`; deps.
  Import `pageColorModeOf` from `../../print/printLabel`.
- Replace the dead one-option `Select` at `:930-939`:

  ```tsx
  <Select
      value={pageColor === PageColorType.Grayscale ? 'grayscale' : 'mono'}
      onChange={(value) =>
          setPageColor(value === 'grayscale' ? PageColorType.Grayscale : PageColorType.SingleColor)
      }
      options={[
          { value: 'mono', label: t('print.pageColorSingle') },
          { value: 'grayscale', label: t('print.pageColorGrayscale'), disabled: !grayscaleSupported },
      ]}
      className="w-32"
      aria-label={t('print.pageColor')}
  />
  ```

- Do **not** add the Red-black option (P5) or the full explanatory copy (P6).
- Verify the preview re-renders on change: `PrintPagePreview` already receives
  `previewRenderOptions` (built from `thumbnailOverrides`) and keys on
  `previewOptionsKey`, which wave A extended. No other preview change.

### B4. i18n

- `src/i18n/locales/en.json`: add `print.pageColorGrayscale` =
  `"Grayscale (16 levels)"`. One writer.

### B5. Tests (wave B)

- `usePrintThumbnails.test.tsx`: a grayscale override is forwarded to the render
  seam and changes the rebuild key (no stale mono thumbnail); mono/absent keys
  keep the old behaviour.
- `PrintDialog.test.tsx`: with `capabilities.grayscale === true`, selecting
  Grayscale updates the overrides (`PrintPagePreview`/job see
  `pageColor: 'grayscale'`); with `grayscale: false`/absent the option is
  `disabled` and the value stays Mono. Use the existing `statusOf` fixture.
- The full render/print/dialog suite green.

## Out of scope

- No red/black conversion, no paper-type hints, no capability-driven paper logic.
- No shared 3-mode selector/explanations/warning-centre copy (P6).
- No doc model changes, no persisted selection (session state only).
- No editor live-preview (`useQuantizedPreview`) changes.
- No batch/CSV multi-page test (P6).
- No hardware work (P7).

## Exit criteria

- Wave A + wave B merged; `tsc` clean; full suite green.
- Grayscale selectable when supported, disabled when not; preview/thumbnails/job
  all use the same mode; `pageColor` identity invariant pinned.
- `review` verdict PASS.
