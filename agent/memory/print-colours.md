# Print-time page colours — shipped feature memory (2026-11-02)

`feat/print-colours` shipped **one print-time page-colour selection** (Mono /
Grayscale / Red & black) driving preview, print raster and dialog thumbnails.
The document stays colour-agnostic: authored pixels are mapped to a printable
palette when a page is rendered for a mode. Selection lives in the print dialog
and is capability-gated.

- Research and derivations: [`grayscale.md`](grayscale.md) (16-level encoder,
  D110M_V4 task family) and [`dual-color.md`](dual-color.md) (library mechanics,
  the 133-byte history). Do not re-derive them here.
- Engine split from the 1-bit quantizer: [`dithering.md`](dithering.md) §11.
- **Physical verification (owner, 2026-11-08, density 3 default):** the 16-level
  ramp is **not fully usable on paper** — levels **0–2 are indistinguishable from
  the background**, level **3 is very faint**, and on some stock level **15 merges
  with 14 (sometimes 13)**. Usable range is roughly **4–14**. A later **dynamic
  range** option (map the authored tone range onto the physically usable band) is
  requested — see **D-75**. Red/black physical calibration is still pending. Owner
  checklist: [`P7-VERIFY.md`](../2026-11-02_print-colours/P7-VERIFY.md); the harness
  has a **Density** select for heat/energy tests (density does not change the ramp
  mapping).
- **Red/black mode on mono stock** (owner, 2026-11-08): prints an intermediate
  **grey ≈ grayscale levels 11–12**, not black/red. The mode assumes red/black
  media; page colour must match the loaded stock. RFID cannot infer the colour
  (red/black stock reports as ordinary gap labels), so this stays a manual
  selection.
- **Red/black tape** (owner, 2026-11-08): solid black/red rows are correct; a
  grayscale page on this stock prints almost entirely red (usable ≈ 5–15). The
  bars at colour boundaries are a **library Mixed-row bug** (official app prints
  the same raster clean — D-77); the red coverage floor is physical (D-78). See
  [Red/black paper physics](#redblack-paper-physics-and-the-library-bug-owner-2026-11-08).

## Modes and seams

- `PageColorMode = 'mono' | 'grayscale' | 'redBlack'` (`core/render/palette.ts`).
  Absent `pageColor` means `'mono'`, so every pre-existing option object and
  cache key is unchanged.
- `PageColorType` is imported by the dialog too. The **conversion** to
  `PageColorMode` happens only at the print boundary (`print/printLabel.ts`):
  - `pageColorModeOf`: `Grayscale → 'grayscale'`, `DoubleColor → 'redBlack'`,
    everything else → `'mono'` (`SingleColorAlt` is guarded before this).
  - `renderOptionsOf` forwards `pageColor` **only when non-mono**, alongside
    `dpi`/`invert`/`mirror`/`offset`/dither settings. Preview, dialog thumbnails
    and the job use this same split (invariant 7); only the dpi differs.
- Threading: `PrintDialog` state → `PrintOverrides.pageColor` →
  `RenderLabelPageOptions.pageColor` **and** `PrintJob.pageColor` →
  `niimbotAdapter` `newPrintTask` options → `ImageEncoder.encodeCanvas(...)` with
  the job's page colour.
- `buildLabelPrintJob` / `printLabel` still hardcode `SingleColor`. A caller that
  needs a page colour must pass it through `buildCsvPrintJob` overrides — the P7
  harness does exactly that.
- `SingleColorAlt` is explicitly rejected by `buildCsvPrintJob` (`RangeError`):
  silently mono-encoding a second single-plane mode would print the wrong label.
  The library separately validates task capability and
  `PrintOptions.pageColor === EncodedImage.pageColor` at job time.
- Capability gates in `PrintDialog`: `capabilities.grayscale` /
  `capabilities.doubleColor`. Unsupported modes stay **visible, disabled**, with
  a `"(unsupported)"` label suffix and a state description
  (`print.pageColor*Hint`). Mono is always offered.
- `capabilitiesOf` (`print/niimbotAdapter.ts`) maps the **task**:
  `doubleColor ← SupportDoubleColor`, `grayscale ← SupportGrayscale`,
  `tubePrinting`, `supportsSpeed`, `taskType`. No model metadata ⇒
  `undefined` (no crash), and only defined keys are set. The dialog gates on
  `=== true`, so absent capabilities disable **both** non-mono modes and the
  value stays `mono`.

## Render dispatch (`renderLabelPage`)

Pipeline: `resolve → rasterise → pre-clip → page-colour pass → invert → mirror →
post-clip → offset → encoder canvas`.

- **mono** — unchanged: per-object policy mask + `quantizeRgba` (1-bit goldens
  byte-identical).
- **grayscale** — skips the policy mask entirely; one `diffuseToPalette` pass
  with `grayscaleRampPalette()`. The knobs come from `buildQuantizeOptions`, i.e.
  the **global** quantizer's effective settings. At the default global strategy
  (`threshold`) that resolves to gamma 1, strength 1, serpentine true, so the
  mode is serpentine Floyd–Steinberg over the 16 band-centre greys. Per-node
  policies and params do not apply (no mask is built; `policyOverflowCount` is
  absent).
- **redBlack** — builds the policy mask exactly as mono, then uses it only to
  split **flat vs diffuse**:
  - slot 0 is the global strategy; every slot whose resolved quantizer is
    `threshold` is flat, every other quantizer (including `screentone` and
    `ostromoukhov`) is diffusion;
  - flat pixel = point op: classify the **raw source bytes**, write one exact
    entry, emit/receive no error (a diffuse neighbour's deposited error is
    discarded at the seam);
  - everything else = vector Floyd–Steinberg through the 3-entry palette;
  - output is exactly `#ffffff` / `#000000` / `#ff0000` — the encoder's split
    depends on exact bytes. `policyOverflowCount` is still reported.

Post-pass helpers are palette-safe: `invertRgb` scales luminance (neutral pixels
still `v → 255−v`; red stays red, never cyan), and `countInkPx` counts every
non-white pixel, so red ink is ink in the mirror-loss notice.

## 16-level grayscale ramp

- `grayLevelColor(k) = 255 − 17k`, `GRAYSCALE_LEVELS = 16`; palette index equals
  the library level, `0 = white … 15 = black`. Fifteen 17-step gaps span 255, so
  the band centres are exact integers: a pixel authored at a centre re-encodes to
  that same level with no rounding slack. That is what makes the authored step
  bars dither-free and preview ≡ print.
- The palette carries a `nearest` that **mirrors**
  `ImageEncoder.colorToGrayLevel`: `clamp(round((1 − L/255) · 15), 0, 15)` with
  BT.601 luminance (`0.299r + 0.587g + 0.114b`). A squared-RGB nearest grey would
  be the channel mean and disagrees on coloured input (saturated green: ≈150
  luminance vs 85 mean).
- Encoder contract (0.49): 4 bits/px, 2 px/byte, **high nibble first**, `cols`
  padded to `ceil(cols/8)·8`, all-zero rows `void`, identical consecutive rows
  `repeat`, nibble RLE runs. **Alpha is ignored**: a transparent pixel is RGB 0
  → level 15 → black, so the render canvas must stay opaque white (ours is).
- Only the `D110M_V4` task family advertises `SupportGrayscale`; an unsupported
  task throws at `validatePage` (`Page color 3 is not supported…`). No
  model/firmware gate beyond the capability table.

## Red/black converter

- Palette order `[white, black, red]`, with exported indices
  `RED_BLACK_WHITE/BLACK/RED`. Default nearest test = weighted squared RGB
  distance; `PaletteEntry.weight` is the calibration hook for **heat-selected**
  red (a red dot is not pigment and may not be as dark as a black dot at the same
  coverage). Every weight is `1` until the P7 print measures otherwise.
- Flat classifier `classifyFlatRedBlack(r, g, b, threshold = 128, gamma = 1)`:
  1. **Red dominance first**: `r > g && r > b` → red, at any luminance and
     independent of gamma. Colour is truth; antialiased red glyph edges stay red.
  2. Otherwise threshold **BT.601 luminance**, rounded via `toByte` before the
     cutoff (the float weights sum to `0.999…`, so an authored `#808080` would
     otherwise measure 127.999 and fall below 128), gamma-curved when
     `gamma ≠ 1`: `< threshold` → black, else white. A plain nearest-RGB test
     would send mid grey to white and make mid-grey text vanish.
- Flat vs diffuse is selected by the **existing per-object policy system** — no
  new policy vocabulary and `policyKeyOf` is unchanged. Type defaults already
  send text/QR/barcode/code to `threshold` (flat) and images to diffusion.
- Diffusion uses a full **RGB error vector** on three channel planes, not two
  scalar diffusions: dark-red regions sit between black and red, so scalar
  decomposition would mis-mix them. Entries are never blended; every output
  pixel is an exact palette colour.
- Encoder split: `0xff0000` → red plane; any other non-white → black plane;
  white → neither. A near-red pixel would silently print black.

## Tint by luminance

- `tintRgbaByLuminance` (`core/render/tint.ts`):
  `out = 255 + (tint − 255) · (1 − L/255)` per channel, `L` = BT.601 luminance.
  Source luminance selects **ink density**; the tint selects **ink colour**.
- Red tint on neutral grey gives `(255, L, L)`, which the red/black palette
  diffuses into red/white dots only — a greyscale image "dithered in red".
  Black tint is the identity; white erases; alpha is never touched; `#rgb`,
  `#rgba`, `#rrggbb`, `#rrggbbaa` parse (alpha ignored), `'transparent'` is a
  no-op.
- Applied **per leaf after the shared decode cache** (`editor/render/tint.ts`
  `tintAsset`): a fresh canvas, so two differently tinted leaves of the same
  image and every other consumer of the cached raster stay independent.

## 0.49 DoubleColor packet check (pinned)

- `PacketGenerator.printBitmapRowDoubleColor` is **command 138**, payload:
  `[BitmapColorMode.Mixed, posHi, posLo, repeats, mask octets…, colour octets…]`.
  Mask bit set = any ink; colour bit set = red ink. There is **no 133**
  (`PrintBitmapRow`) sub-command byte.
- The single-colour wrapper `printBitmapRowWithColor` **does** carry 133 — that
  contrast is pinned deliberately.
- Pinned octets (`src/print/printLabel.doubleColor.test.ts`):
  black `0xAA`, red `0x0F`, pos `0x1234`, repeats `2`, cols `8` →
  `[3, 0x12, 0x34, 2, 0xAF, 0x0F]`. Multi-octet order:
  `[3, 0x01, 0x02, 1, 0x80, 0x01, 0x00, 0x01]` (all masks, then all colour
  bytes).
- The same suite pins the encoder split: black at col 1 →
  `rowDataBlack 0b0100_0000`, red at col 2 → `rowDataRed 0b0010_0000`, white in
  neither; `pageColor` is `DoubleColor`.
- niim.blue 2026.9.0 ships dual colour on this path, so it has upstream hardware
  mileage. **A dependency bump must re-check these bytes** — if 133 reappears,
  the payload shape changed and red/black printing will be wrong.

## Compression (0.49.1)

- **Grayscale rows are always RLE-compressed** by the library:
  `PacketGenerator.writeImageDataGray` → `compressGrayRow` (runs of ≥6 equal
  pixels, whole data bytes, max 252; encoding stops past 250 run bytes).
- There is **no public "compression mode" API**. `PrintOptions` has no
  compression field; `GetCompress`/`In_GetCompress` are enum-only;
  `imageCompressSupport` / `maxImageCompressBytes` / `maxCompressLines` are
  parsed into the capabilities DTO but never read; `PrinterConfig2` exposes only
  a typed `Time` setter. The protocol comment documents a raw
  `sendCompressMode: 85 85 7 4 b b2 b3 b4` payload, but using it means hand-built
  packets and untested printer configuration — do not wire it blind; ask
  upstream first.

## Red/black paper physics and the library bug (owner, 2026-11-08)

Red/black stock is **heat-selected**: red needs little heat, black needs a lot;
black therefore bleeds a faint red fringe.

- Solid black and solid red rows print correctly (the flat classifier is right).
- A **grayscale** page on red/black tape prints almost entirely **red**: usable
  ≈ levels 5–15 (4 is paper/faint), 13–14 pure red, 15 red with slight black.
  Page colour must match the stock.
- **Red coverage floor ≈ 50 %** (calibration sweep, densities 1–3): the 75/50
  coverage bars print, the 25/12/6 bars are invisible. The **official app shows
  the same floor**, so this is printer/stock physics (**D-78**); sparse red dots
  do not develop. Red images lose their highlight half.
- **The ~0.5–1.5 mm bars at every colour transition are a library bug, not the
  stock** (cross-check 2026-11-08): the **same raster** prints clean from the
  official NIIMBOT desktop app, while niim.blue (same `@mmote/niimbluelib`)
  reproduces the bars. The artefact is one byte wide (8 px = 0.68 mm at 300 dpi):
  in `BitmapColorMode.Mixed` rows the first byte of a red run prints black, and
  the first byte of a black run after red prints red. Solid/single-colour rows
  are unaffected. **Root cause (author):** the printer trims the packet to the
  printable width, and the red colour mask is at the **end** of the
  `printBitmapRowDoubleColor` (138, Mixed) payload, so a label wider than the
  printhead loses/shifts the red stream while the mask survives. **48 mm
  (567 px @300 dpi = head width) makes the artefact disappear**; wider makes it
  worse. Until upstream fixes it, red/black rasters must stay ≤ printhead px
  (**D-77**, repro + 48 mm controls in
  [`../2026-11-02_print-colours/repro/`](../2026-11-02_print-colours/repro/)).
- The isolated red ramp is **clean** — no red→black overheat. The earlier
  "red-black gradient mess" was the library boundary artefact plus the colour
  gradient, not the red-only dither path.

Implications: page colour must match the stock; do **not** compensate the library
artefact in our renderer — wait for upstream. Palette `weight`s remain `1`. The
`?printcolours` harness has the calibration pattern + density sweep; `repro/`
holds the exact 300 dpi raster and split panes for the library author.

## v1 limitations / open items

- **Page-level diffuser knobs.** In red/black, gamma/strength/serpentine (and the
  flat classifier's threshold/gamma) are the resolved **page-level** options;
  per-node diffuser params are not applied. The per-object strategy still decides
  flat vs diffuse. Grayscale applies no per-node params at all. P6's dialog copy
  tells the user (`print.pageColorDoubleHint`). See `tech-debt.md` **D-74**.
- **Per-ink screentone deferred** (owner 2026-10-30): `screentone` and
  `ostromoukhov` are treated as diffusion in red/black. Mixed red/black
  clustered dots need a later phase.
- **Calibration unknown.** All palette weights are `1`; red-vs-black physical
  density is unmeasured. One red/black print in `P7-VERIFY.md` decides it; do not
  hand-tune constants before that.
- **Long grayscale buffer unverified.** `PrinterCapabilities.sixteenGrayMaxBuffer`
  is parsed but never enforced by 0.49. The 50×160 mm harness pattern covers it.
  See **D-73**.
- **Grayscale dynamic range requested** (owner, 2026-11-08): at density 3 the
  paper shows roughly levels 4–14; 0–2 sit on paper white, 3 is very faint, and on
  some stock 15 merges into 14/13. A later option should map the authored tone
  range onto the physically usable band (bounds depend on density/paper). Recorded
  as **D-75**; the current ramp stays the library-defined 0–15.
- **D-05 seam drift** still applies — in red/black the palette pass adds a
  flat-beside-diffuse border where deposited error is discarded, on top of the
  existing diffuse-beside-diffuse seam.
- **Paper colourspace is never inferred.** RFID reports red/black stock as
  ordinary gap labels, and grayscale photo stock may report as black; selection
  is always manual. No paper-type colourspace hints shipped.
- `SingleColorAlt` remains unimplemented (explicit throw).
- `buildLabelPrintJob` remains mono-only by design; use `buildCsvPrintJob` with
  overrides.

## Tests / where to look

- Engine + classifier + flat mask: `src/core/render/palette.test.ts`.
- Render modes: `src/editor/render/renderLabelPage.grayscale.test.ts`,
  `renderLabelPage.redBlack.test.ts`.
- Packet + encoder contract: `src/print/printLabel.doubleColor.test.ts`;
  multi-page mode parity in `printLabel.test.ts` (~:490-556).
- Dialog gating/copy: `src/components/print/PrintDialog.test.tsx`.
- Harness patterns: `src/components/dev/printColoursPatterns.test.ts`.
- Harness + owner checklist: `?printcolours`,
  [`P7-VERIFY.md`](../2026-11-02_print-colours/P7-VERIFY.md).
