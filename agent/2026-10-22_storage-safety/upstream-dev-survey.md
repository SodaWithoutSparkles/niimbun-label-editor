# Upstream niimblue dev survey — 8a60a8e..0c2dfa8

Date: 2026-10-22
Upstream tip: `0c2dfa8` "Fix screentone contrast range" (2026-10-19)
Local clone: `references/niimblue/` (gitignored)
Range: 38 commits, 49 files. Mostly UI refactor + dirty-state guards; one new
post-process effect; one lib bump; no format-breaking change on our side.

## Executive summary

- **Screentone is not a clone of our ScreenStyle demo.** It is an independent,
  far simpler analytic clustered-dot point op. No rank matrix, no K-levels, no
  stability filter, no gamma/sRGB, no physical pitch. Their own source comment:
  `99% of this file is AI slop`.
- **We are ahead** of upstream on dialog infrastructure and unsaved-change
  handling (we autosave + flush on `pagehide`; they added a `beforeunload`
  guard because they have no autosave).
- **Highest-value real gap is not a feature:** we pin `niimbluelib@0.47.0`,
  which lacks `findPrintTask`'s protocol-4 fallback and the unsigned-packet
  parsing fixes. Our adapter hard-fails where upstream now prints.
- **Second real bug found on our side (not upstream-driven):** number fields in
  `PopoverSlider` commit on every keystroke, so negative X/Y cannot be typed.
- **Third:** `letterSpacing` exists in the doc model and validator but is
  unwired in the inspector and never read by the Konva renderer.

## 1. Screentone (00827c3 + fix 0c2dfa8)

Upstream: `references/niimblue/src/utils/post_process.ts:202-257`.

Algorithm: per-pixel analytic circle, binary output.

- `blackThreshold = 128 - contrast`, `whiteThreshold = 128 + contrast`,
  `contrast` clamped 0..127.
- `gray < blackThreshold + 15` -> solid black (undocumented boldness fudge);
  `gray >= whiteThreshold` -> solid white.
- midtone: `adjusted = gray - threshold + 128` (shared threshold slider is a
  midpoint shift), `tone = (adjusted - black) / (white - black)`,
  `radius = (dotSize/2) * sqrt(1 - tone)`, float rotation
  `u = x cos + y sin`, `v = -x sin + y cos`, `u % dotSize` / `v % dotSize`.
- `dotSize` in raw px, 1..20, no dpi awareness.

The `0c2dfa8` fix is UI/schema only: engine already clamped contrast at 127,
but the slider and zod schema allowed 255, so 128..255 was a dead zone. Slider
max -> 127, `types.ts` `lte(127)`.

Params: `screentoneAngle` 0..365 (schema; UI 0..90), `screentoneDotSize` >= 1,
`screentoneContrast` 0..127. Persisted in `localStorage` under
`saved_preview_props` **only when pinned**; never in label/template JSON.

### Versus ours (`src/core/render/screentone.ts`)

| | upstream | ours |
| --- | --- | --- |
| dot | analytic circle | 64x64 rank table, `ink = rank < level` |
| levels | binary | K = 2..8 |
| pitch | raw px 1..20 | mm 0.3..2.0, integer-lattice snap at dpi, 0.4 mm floor |
| angle | float 0..90 | 4 lattice bases (0/14/27/45) |
| tone | linear grey + contrast band | gamma chain + `projectGrey`, per-strategy gamma |
| scope | whole label, print-time | per-node policy, 8-slot mask, live preview |
| persistence | localStorage preference | doc `quantizerParams`, templates, cache keys |

Genuinely new upstream capability: **an explicit contrast/boldness band**.
Caveat: the owner dropped parametric contrast/S-curve on 2026-10-17
(`agent/memory/dithering.md`); adopting it needs an explicit re-decision, and
it would shift `levels` semantics for existing docs.

Continuous angle: do not adopt (float trig reintroduces drift/moiré at odd
dpmm; add lattice bases if a ruling is ever requested).

## 2. UI/UX commits — gap table

| Upstream | Ours |
| --- | --- |
| `9f80e89` beforeunload unsaved warning | **N/A / intentionally superseded** — autosave + `pagehide` flush (`PreviewStage.tsx:1721`), status bar recency. Do not copy. |
| `b8b0404` clear dirty on save | N/A (no dirty flag) |
| `23cf633` undo/redo must not clear dirty | N/A |
| `bd4c797` live position/size inputs | **Have, but partial**: live via `updateNodeTransient`, but typing hazard below |
| `7a4d508` size inputs resetting per keystroke | **Bug on our side**: `PopoverSlider.tsx:435-439` + `:103-105` |
| `4812cff` redraw while resizing (`noScaleCache`) | N/A — Konva renderer never uses `.cache()`; QR/barcode re-raster on commit |
| `61a63d3` scrollbar-gutter | Missing; trivial. Our shell is `overflow-hidden`, inner panels still nudge |
| `1d24db8` custom text prompt dialog | **Have, stronger**: in-place WYSIWYG overlay. Gap only: no `multiline` prompt option |
| dialog refactor (d5221ee..a2e9f14) | **Have, ahead**: native `<dialog>` + promise service; no native confirm/prompt/alert |
| `d768d14` character spacing | **Missing end-to-end**: `letterSpacing` in model (`types.ts:122`, `validate.ts:532`) but `wired:false` (`inspectorModel.ts:127`) and not read in `konvaFactory.ts:368-379` |
| `68f008e` locked preview offset | N/A — we have no saved preview props; print offset is dialog-local |

### Confirmed typing bug (`PopoverSlider`)

`onChange` fires per keystroke, `Number('-') === 0`, then the store update
re-syncs `tempValue` from the prop. Consequences: negative X/Y untypeable,
clearing the field writes 0, a size typed starting with `0` floors to
`MIN_SIZE_HM` and rewrites the input. Fix shape: draft-string state while
focused, commit on blur/Enter, skip non-finite/empty.

## 3. Data / interop commits — gap table

| Upstream | Ours |
| --- | --- |
| `7a65ce5` standardise label/template JSON, single-or-list import, append, export-all | **Format layer PARTIAL, UI MISSING.** We have versioned, gzipped, validated docs (`core/doc/serialize.ts`, `validate.ts` version gate). No import/export UI at all (`FileMenu.tsx:23` "P8 scope"; debt D-26/D-51). Differences: doc id is inside the payload (import would overwrite on collision); upstream strips id and re-mints. |
| `a944429` preset print offset, replace preset | **Partial.** Offset knobs exist and are hardware-verified but dialog-local only (`PrintDialog.tsx:136-138`); no `LabelDoc.offset`, resets every open. No preset entity. |
| `425072d` auto `D110M_V4` for protocol >= 4 | **Missing and it hurts.** `niimbotAdapter.ts:223-226` throws "printer model not identified"; no `protocolVersion` read anywhere. |
| `512bb4a` nested variables | **N/A** — we use JS templates (`resolveContent`), no `{var}` token language. Capability exists via `ctx.row`. |
| `7f0c6a3` default 50 -> 48 mm | **N/A-by-design**: our seeds are physical die-cut stock (`rounded50x30` = 5000x3000 hm). Add a 48x30 seed, never edit the 50. |
| `30eef8f` CSV dialog title | **Already fine** — dedicated i18n keys |
| `ecfd735` niimbluelib 0.47.0 -> 0.47.1 | **Missing.** Our `package.json:35` pins 0.47.0. 0.47.1 gives: protocol-4 print-task fallback; unsigned U16/U8 parsing for page/battery/printhead/RFID; `paperHeight` no longer subtracts gap except modelId 785 (affects our advisory `rollHeightHm`, `niimbotAdapter.ts:421`). |

## 4. Ranked recommendations

1. **Bump `niimbluelib` to 0.47.1** — 2 files, unblocks protocol-4 printers and
   fixes counter parsing. Verify `rollHeightHm` delta after bump (advisory only).
2. **Fix number-field typing in `PopoverSlider`** — small, user-facing bug; no
   upstream dependency.
3. **Wire `letterSpacing`** — model/validator ready; one attr in
   `konvaFactory`, `wired:true`, shrink-measure parity, inspector test update.
4. **Label import/export** — largest functional hole (no way to move a label
   between devices). Reuses our serializer; needs import UI, single-or-list,
   id re-mint/duplicate handling, export-all.
5. **Persist print offset on the label** — schema + validator + dialog default.
6. Optional: `scrollbar-gutter: stable`; 48x30 paper seed; multiline prompt.
7. **Do not adopt**: screentone replacement, its px/float-angle parameters,
   beforeunload dirty guard, `noScaleCache` (irrelevant to Konva).

## 5. Caveats

- Upstream screentone is applied to the whole raster at print time; ours is
  per-node document data. Do not regress scope or persistence to match.
- The 0.47.1 `paperHeight` change alters a reported value, not a print packet;
  confirm the printer panel text stays sane.
- Unrelated in-flight work: `agent/2026-10-22_storage-safety` P3 is implemented
  and green (114 targeted tests, `tsc --noEmit` clean) but uncommitted and
  unreviewed.
