# Phase 3 action plan — print pipeline (5 bugs)

Run: `agent/2026-11-21_review-fixes/`. ENV BRIEF: [`state.md`](state.md). Anchors verified 2026-11-21 by explore (session `ses_e05607059ffeBl76dH8mPXYhm6`); all 5 reproduce, line refs current HEAD. Full explore report is preserved in the session transcript; anchors below.

## Bug 1 — interleaved prints grouped (P2)

- `src/print/sequence.ts:66-84` `generatePages`: the `interleaved` branch's inner copy loop (`:79-81`) never advances the row → A,B,C×2 = `AABBCC`.
- **Fix (owner-verified contract):** copy-major / row-minor: precompute per-row `quantity` (planSequence already walks every row for Σ at `:141-148` — pass the resolved quantity array in; keep pages lazy), then `for copy → for row: if quantities[row] > copy yield {rowIndex: row, quantity: 1}`. `totalPages` (`:140-148`) and the send guards (`printLabel.ts:287-291`) stay valid.
- **Tests:** `sequence.test.ts:61-73` codifies the bug (`0,0,1` for interleaved) — update to `0,1,0`; add A/B/C×2 → `A,B,C,A,B,C` and an unequal-quantity round-robin case. `batchJob.test.ts:100-111,121+` compares emitted vs `planSequence` — expectations may need reordering (counts unchanged).

## Bug 2 — default band bleeds ink into white space (P2)

- Default band `{minLevel: 4, maxLevel: 14}` (`src/store/storeDefaults.ts:107-109`); palette entries `255−17k` (`palette.ts:81`), darkest entry = 17. Authored black (0) has no exact entry; nearest 17 leaves residual −17 pushed into neighbors (`palette.ts:378-388`) → later pixels flip to level 14 far outside the shape. Level-15 band has exact 0 → no bleed (matches report).
- **Fix (chosen: minimal engine-level clamp):** between the gamma block and the scan (`palette.ts:336-341`), clamp the scalar plane's low side to the darkest representable value (`entries[entries.length-1].r`) — "tones darker than the paper can show become the darkest printable ink." Full ramp ⇒ clamp value 0 ⇒ no-op ⇒ the byte-identical legacy test (`palette.test.ts:429-470`) stays green. Rejected: appending level 15 (changes the user's per-paper band contract); rescaling (globally shifts midtones).
- **Tests:** add the 60×32 black-rect-on-white, band 4–14, assert zero inked pixels outside the rect. **Careful:** existing band tests `palette.test.ts:398-415` (0→min gap dither) and `:417-427` may codify the bleeding pattern — re-run and update deliberately if they change (same class as the sequence test). Integration: `renderLabelPage.grayscale.test.ts` (no band case today — add one).
- **Memory:** `agent/memory/print-colours.md:370-379` records "no tone-range remap required" — predates this evidence; update at phase end.

## Bug 3 — invert bypasses the grayscale ink limit (P2)

- Pipeline order at `renderLabelPage.ts:1104-1107`: quantize → `invertRgb` (`:817-837`) — palette level 0 (255) inverts to byte 0 = level 15, outside the band. Invert is dialog-local (`PrintDialog.tsx:181`), forwarded as `PrintOverrides.invert` → `RenderLabelPageOptions.invert`.
- **Fix:** branch at `:1107`: for grayscale pages invert **within the resolved band** (`k' = lowest + highest − k`; recover k from the exact palette byte `(255−r)/17` — pixels are exact levels after diffusion). Full ramp reduces to `15−k` = byte-identical to today on neutral pixels ⇒ mono/redBlack paths and goldens untouched; keep `invertRgb` for those.
- **Tests:** `renderLabelPage.pigment.test.ts:75-110` style for the band invert; `renderLabelPage.grayscale.test.ts` band 4–8 + invert case (level-0 paper → highest allowed, not 15).

## Bug 4 — clipping warning misses light grayscale ink (P2)

- `printOrientation.ts:156-157` `isInk` requires a channel `< 128`; grayscale levels 1–7 (bytes 238…136) never trip. Detector always sees the post-quantize raster (`PrintDialog.tsx:638-645`), where every pixel is an exact palette colour.
- **Fix:** predicate = "not paper white": `data[base] !== 255 || data[base+1] !== 255 || data[base+2] !== 255`, mirroring `countInkPx` (`renderLabelPage.ts:874-881`). Keep detector position (post-quantize — preserves "sample matches what prints", `PrintDialog.tsx:610-612`). Alpha stays ignored.
- **Tests:** `printOrientation.test.ts:125-196` — add level-7 (136,136,136) beyond-head → `true`; keep white → `false`.

## Bug 5 — queue thumbnails exaggerate print offsets (P3)

- `THUMBNAIL_DPI = 100` (`usePrintThumbnails.ts:52`); `:298` forwards the print-dpi device-px offset verbatim to a 100-dpi render → 3× shift for 300-dpi offsets. Offset is defined as device-independent hm (`core/doc/types.ts:307-313`, `core/hm.ts`), but PrintDialog keeps it as integer print-dpi px (`:391-398`, committed via `pxToHm` at `:341-346`).
- **Fix (chosen seam: caller-side scale):** in `PrintDialog.tsx:457-475` (`thumbnailOverrides`), scale print-px → thumbnail-px: `Math.round(parsedOffset.x * THUMBNAIL_DPI / resolved.dpi)` (equiv. `hmToPx(pxToHm(x, resolved.dpi), THUMBNAIL_DPI)`). The hook stays a dumb verbatim forwarder (its existing forwarding test remains valid); `previewRenderOptions` (`:496-505`) and `printOverrides` (`:562-606`) keep print px. If other `usePrintThumbnails` callers pass offsets, re-evaluate (grep first).
- **Tests:** `PrintDialog.test.tsx:1122-1150` has 300-vs-203-dpi offset seeds — derive the expected thumbnail scale there; add a case asserting the thumbnail override carries the scaled value.

## Delegation (after P1/P2 land)

Three parallel agents (disjoint files):
- **A1:** Bugs 1 (sequence.ts + sequence/batchJob tests).
- **A2:** Bugs 2+3 (palette.ts, renderLabelPage.ts + palette/grayscale/pigment tests) — same grayscale-band engine, one writer.
- **A3:** Bugs 4+5 (printOrientation.ts, PrintDialog.tsx + their tests).
Then `review`, fixes, semantic commit, memory update (`print-colours.md` bleed note + follow-ups).
