# P7 — hardware verification harness + docs/memory

Run: [`plan.md`](plan.md) §2 P7. Owner decision: **build the harness now, the
owner prints**. Two waves; `review` gates the harness.

Goal: the owner can open one dev page, pick a pattern and a page colour, print it
on real hardware, and record the physical results. Then promote the run's
findings into `agent/memory/` and retire/refresh debt.

## Existing precedent

- Dev harnesses are query-param overlays in `src/App.tsx`
  (`?hardware`, `?print`, `?printcsv`) mounting a `src/components/dev/*` component.
- `PrintSmoke.tsx` builds a sample doc from raw nodes and has a ruler pattern;
  `PrintCsvSmoke.tsx` mounts the real `PrintDialog` with a `MockTransport`.
- Label import exists (`File ▸ Import`) but there is no script/seed path; a dev
  harness is the right shape for generated gradients/photos (no photo fixture in
  the repo).

## Wave A — `?printcolours` harness

### A1. New `src/components/dev/printColoursPatterns.ts` (pattern builders)

Pure-ish module (uses canvas only to generate PNG data URLs):

```ts
export type ColourPatternId = 'grayscale' | 'redBlack' | 'grayscaleLong';
export interface ColourPattern {
    id: ColourPatternId;
    label: string;          // dev-only, hardcoded (harness is not product UI)
    doc: LabelDoc;
    pageColor: PageColorType;
}
export const buildColourPatterns = (): ColourPattern[];
```

Geometry: **50 × 30 mm at 300 dpi** (`backingW: 5000, backingH: 3000`,
`paperTypeId: 'rounded50x30'`), full-page region. Long variant:
**50 × 160 mm** (`backingW: 5000, backingH: 16000`, no paperTypeId).

Patterns:

1. **grayscale** (page colour `Grayscale`):
   - title text (black) e.g. `GRAY 16`;
   - **16 step bars**, each at a band-centre grey `grayLevelColor(k)` (use the
     exported helper), ~2.6 mm wide, 12 mm tall;
   - a horizontal **black→white gradient** image strip (generated canvas, inline
     `ImageRef`), 40 × 10 mm;
   - a **photo-like** image (generated two-axis gradient / colour blocks),
     40 × 10 mm;
   - small black caption text.
2. **redBlack** (page colour `DoubleColor`):
   - a black bar row, a red bar row, an alternating black/red bar row;
   - a flat grey **threshold sweep** (8 bars, `#000` → `#fff` in 8 steps) — flat
     art should stay crisp (no dithering);
   - a **red-tinted** grey gradient image (`tint: '#ff0000'`) — should dither
     red/white only, no black;
   - a colour gradient image (reds + greys) — should mix black/red/white;
   - a text row with `RED` (fill `#ff0000`) and `BLACK` (default fill).
3. **grayscaleLong** (page colour `Grayscale`): 50 × 160 mm with the 16 step bars
   at the top and a long gradient strip down the page (buffer test;
   `sixteenGrayMaxBuffer` is parsed but not enforced by 0.49).

Rules: use `createLabelDoc` + raw `Node` literals (see `PrintSmoke.tsx:45-100`);
inline images are pushed onto `doc.resources.images` with
`source: { kind: 'inline', mediaType: 'image/png', dataUrl }`; canvas-generated
data URLs must be deterministic (no randomness) so goldens/prints are repeatable.

### A2. New `src/components/dev/PrintColoursSmoke.tsx`

No props (match the other harnesses). Behaviour:
- pattern `Select` + page-colour `Select` (Mono / Grayscale / Red & black),
  initialised from the pattern;
- a preview `<canvas>` of the **real** `renderLabelPage(doc, {}, { assets, dpi:
  100 })` result (tone check before spending tape);
- a **Mock** / **Real printer** toggle (default Mock) and a Print button:
  - build with `buildCsvPrintJob(doc, null, { order: 'grouped', copies: 1,
    overrides: { pageColor } }, { assets })` (NOT `buildLabelPrintJob` — it
    hardcodes Mono);
  - Mock: `new MockTransport({ pageDelayMs: 800, capabilities: { grayscale: true,
    doubleColor: true } })`;
  - Real: the same `NiimbotTransport` construction as `PrintSmoke.tsx` (copy the
    device-picker/connect pattern; do not invent a new API);
  - print via `transport.print(job)` and show page count + errors.
- A short inline note listing the physical questions the prints answer
  (banding / distinct level count / long-label buffer / red vs black density).
- Hardcoded dev strings are acceptable (dev harness, not product UI), but keep
  the component readable. No store mutation, no doc save.

### A3. `src/App.tsx`

- Add `const showPrintColoursSmoke = params.has('printcolours');` and mount
  `{showPrintColoursSmoke && <PrintColoursSmoke />}` next to the other harnesses.

### A4. Tests

`src/components/dev/printColoursPatterns.test.ts` (`@vitest-environment happy-dom`
+ `installCanvasShim` for the gradient canvases):

1. Three patterns build; every doc passes `isLabelDoc`/`parseDoc` unchanged
   (no repairs).
2. The grayscale doc contains 16 distinct shape fills equal to
   `grayLevelColor(0..15)`; every text fill is a valid colour.
3. The red/black doc contains at least one `fill: '#ff0000'` shape and one
   red-filled text node; the red-tinted image node has `tint: '#ff0000'`.
4. The long doc's `rasterDimensions` are > 1 M px and below
   `MAX_RASTER_PIXELS`; the short docs are 591 × 355-ish (assert against
   `rasterDimensions`, not magic numbers).
5. Every inline `ImageRef` has an `image/png` data URL with a decodable
   `widthPx/heightPx`.
6. Pattern page colours are Grayscale/Grayscale/Grayscale? — assert the exact
   three (`Grayscale`, `DoubleColor`, `Grayscale`).

## Wave B — owner checklist + memory promotion

### B1. `agent/2026-11-02_print-colours/P7-VERIFY.md`

A short owner checklist in the `P7-SMOKE.md` style:
- open `?printcolours`, preview each pattern at 100 dpi;
- print grayscale (short + long) on standard stock, red/black on red/black tape
  (**one** red print, per plan §4);
- what to look for: banding vs 16 distinct densities, flat text crispness,
  red-vs-black density, mixed rows, red-tinted gradient has no black, long-label
  buffer behaviour, paper/RFID mismatch (manual selection);
- a **Record** table (date, pattern, mode, printer, observations, verdict) for
  the owner to fill in.

### B2. New `agent/memory/print-colours.md`

The shipped-feature memory: page-colour modes (`mono`/`grayscale`/`redBlack`),
the render seams (`RenderLabelPageOptions.pageColor`, `renderOptionsOf`,
`pageColorModeOf`), the 16-level ramp (`255-17k` band centres, BT.601 nearest,
encoder nibble order/×8/void/repeat), the red/black converter (flat vs diffuse,
red dominance, gamma luminance, exact `#ff0000` contract), tint/by-luminance,
capability surfaces (`grayscale`, `doubleColor`), the 0.49 packet 133 check and
the pinned payload, and the v1 limitations (page-level diff params in red/black,
per-ink screentone deferred, manual paper selection, long-label buffer
unverified). Link `grayscale.md`/`dual-color.md` instead of duplicating.

### B3. Update the index + neighbours

- `agent/memory.md`: one new bullet under area files linking
  `print-colours.md` (short).
- `agent/memory/print-transport.md`: fix the stale line claiming DoubleColor
  throws; state the three page colours now flow and link `print-colours.md`.
- `agent/memory/grayscale.md`, `agent/memory/dual-color.md`: add a one-line
  **"Shipped 2026-11-02 — see print-colours.md"** banner at the top (keep the
  research intact).
- `agent/memory/dithering.md`: a short section on the palette engine
  (`core/render/palette.ts`) and the flat/diffuse red/black dispatch, linking
  `print-colours.md`; note the engine is separate so 1-bit goldens stay
  byte-identical.

### B4. `agent/memory/tech-debt.md`

- Add **D-73** long-grayscale buffer unverified (`sixteenGrayMaxBuffer` parsed
  but never enforced by 0.49; P7 harness tests it).
- Add **D-74** red/black diffusion uses page-level gamma/strength/serpentine;
  per-node diffuser params are ignored in that mode (P6 copy tells the user).
- Update **D-05** wording: seam drift now also spans palette/flat-vs-diffuse
  neighbours; still unfixed, now hardware-relevant.
- Do not retire anything not actually verified (hardware results arrive later).

### B5. Task folder scrub

- Keep `plan.md`, `phase*_action-plan.md`, `P7-VERIFY.md`.
- `state.md` stays gitignored.
- No temp/debug files; `git status` clean apart from the intended adds.

## Out of scope

- No product UI changes (harness is dev-only, query-param gated).
- No hardware execution by agents; no tuning constants before the owner's print.
- No new paper seeds/RFID logic.

## Exit criteria

- `?printcolours` harness builds all three patterns, previews through the real
  render path, and prints Mono/Grayscale/Red-black via Mock or the real transport.
- Owner checklist written; memory promoted; debt updated.
- `tsc` clean; full suite green; `review` PASS for the harness.
