# niim.blue reference — what to learn from it

`references/niimblue/` is a gitignored clone (Svelte + Fabric.js 7 + `@mmote/niimbluelib` 0.47.0 + zod + localStorage, version 2026.9.0) of the working niim.blue app. It is the closest real implementation of our problem. **Read the relevant files before building a phase** — most of the app's hard-won detail is here.

Verified by three read-only comparisons (2026-10-03) plus a second-opinion pass. Findings are file:line into the clone.

## Verdict

Our plan is **≈2–3× oversized vs. what the reference needed to ship the same killer workflow**. The core (P1 transport, P2 model/storage, P3 editor, P4 render+clip+quantize, P6 CSV) is right-sized. P5–P8 accumulate speculative surface. Ranked over-scope: trust-gate/worker/globals > per-object dither masks > AssetRef 4-provenance+fingerprint > scaffolding rule. **The one place we are strictly better and must keep: `union(regions)` clip.**

## Keep (our plan beats the reference)

- **Integer `hm` + per-document dpi.** Ref stores float px at device dpmm; unit toggling drifts (`LabelPropsEditor.svelte` onUnitChange does `floor(w*dpmm)` then `floor(w/dpmm)`). Their dpmm is preset-only, never in the doc — ZPL import hardcodes 8. Ours is strictly better (invariant 5).
- **`union(regions)` clip (invariant 6).** Ref has **no** region concept: label shape is decorative background only; gray tail/guide rects (`custom_canvas.ts` `_renderBackground`) vanish solely because `#CFCFCF` > threshold. Objects are never clipped; output is always the outer rect. Our explicit clip is a real upgrade and is the killer workflow's first step.
- **Per-record IDB + `version: 1` + migration.** Ref has no doc version field; silent fallback-to-defaults on parse failure (`persistence.ts` `writablePersisted`); delete-all-then-rewrite saves. Ours avoids the anti-patterns.
- **Flat `nodes[]` + `parentId`.** Ref is a flat Fabric array with transient `ActiveSelection` only — no persistent groups, no hierarchy. Our model is a superset; nothing to inherit.
- **Separate CSV store + 50k cap.** Ref embeds the whole CSV string in the doc/localStorage with no cap. Ours is necessary.
- **Per-object dither policy masks.** Ref quantizes whole-image with one mode (`PrintPreview.svelte`). Ours is strictly more capable — but see over-scope below.

## Adopt from the reference

- **Proxy/dither settings:** trapezoid diffusion with `denom` + `normalize`; atkinson uses `normalize:false` (6/8 error discard). `serpentine` default true. `strength` 0–1.5. (`dither.ts`, `post_process.ts`)
- **One shared rasterize→quantize function for preview and print** (their preview ≡ print by construction — `PrintPreview.svelte`). Matches invariant 7.
- **Fresh offscreen canvas per page, then dispose** (bounded memory — matches invariant 9). Their system-printer path collects *all* page dataURLs in an array — the anti-pattern; don't copy it.
- **Thumbnail recipe:** JPEG, quality 0.7, ~48 px height; gallery falls back to scaled geometry when absent; thumb stripped from export. (`file_utils.ts`, `defaults.ts`)
- **Undo triggers:** push on `object:modified` (not per frame), pause during snapshot-apply, truncate buffer on branch, cap ~20, exclusive. Our id-ref snapshots will be far smaller than their inline-asset ones.
- **Editor UX:** grid snap on move, arrow nudge (Ctrl = 1 px), grid overlay toggle, keyboard map (Esc/Ctrl+D/Ctrl+Z/Ctrl+Y/Del), region-aware centering (they center in the fold segment — adapt to center-in-region).
- **Preset UX:** thumbnail card grid, title-or-size label, inline delete confirm. Add a region-union silhouette to the thumb (their plain card can't show an F shape).
- **CSV:** parse lazily at preview/print (not editor); row → per-page variables; substitution at render only (never mutate the doc). **`$times` column** = N copies of a row — cheap, high value, we should add it.
- **Print-task detection + override:** ref reads `getPrintTaskType()` at runtime and lets the user override with capability gating (`PrintPreview.svelte`). Our P1 adapter detects; the **UI override** belongs in P7.
- **Print knobs to expose in P7:** density, speed, labelType, quantity, invert, mirror, offset inner/outer, printhead-overflow warning.
- **Non-blocking printhead-width warning** (headSize > printheadPixels) — matches our P2/P3 warning style.
- **`{dt}` / `{dt-3d}` / `{dt|fmt}` date vars** via a simple regex interpolator — worth keeping even alongside JS templates.
- **gzip-before-store** for asset blobs (`compressData`).
- **Crisp lines:** `ctx.translate(-0.5,-0.5)` + even-dimension fix for QR/barcode 1px rendering (`qrcode.ts`, `barcode.ts`, `aruco.ts`).

## Reject / do not copy

- Float px geometry and unit-toggle-in-place (drift).
- No doc versioning, silent reset-on-parse-fail, destructive save-all.
- Decorative shape-as-printable-area with gray guides that rely on thresholding.
- No clipping (always outer rect).
- Whole-store base64 assets in localStorage / assets embedded per-label (bloat, duplication).
- Collecting all page images before printing (unbounded).
- No layer tree / no reorder / only front-back buttons — fine for them, not for us.

## Over-scope to challenge (second-opinion verdict — decide, don't drift)

No reference precedent; each is net-new. Justify explicitly or defer:
1. **JS template engine + worker + trust gate + IDB trust store + globals.** Ref has *zero* JS execution — a regex interpolator (`canvas_preprocess.ts`). Our trust/worker/globals triad is a deliberate capability extension, not reference-validated. Keep the CSV interpolation core of P6 first; make the JS/trust layer separable and non-blocking.
2. **`GlobalSpec` / `expiresAt` prefetch.** Zero precedent, speculative. Keep as a type slot at most; don't let it drive P6/P8.
3. **Per-object dither masks.** Ref ships one global mode. Complexity is real; keep only if a concrete use case demands it.
4. **AssetRef × 4 provenances + sha256 + `alt`.** Ref inlines everything with no identity beyond a name string. `remote` adds a fetch path our threat model doesn't cover. Consider `inline` (+ `external` for CSV) first; defer fingerprint/alt.
5. **Scaffolding rule (decision 22)** contradicts our own scope-creep risk. Keep only the seams the very next phase needs.
6. **Node-tree drag-to-reparent.** Ref proves a flat list works; keep the tree *view*, defer reparenting.

## Under-scope we should add (ref has it, we listed it weakly or not at all)

`$times` per-row quantity · print-task override UI + capability gating · speed/invert/mirror/offset print knobs · printhead-overflow warning · system-printer path · ZPL + PDF import · dayjs date vars · split labels (liner stock is common) · fit modes (stretch/ratio_min/ratio_max).

## Key reference files

| Concern | File |
| --- | --- |
| Doc schemas, zod, label props | `src/types.ts` |
| Persistence, migration, presets | `src/utils/persistence.ts` |
| Import/export, thumbnails, fonts, CSV, gzip | `src/utils/file_utils.ts` |
| Render → quantize → encode → print | `src/components/PrintPreview.svelte` |
| Dither kernels | `src/utils/dither.ts`, `src/utils/post_process.ts` |
| Variables / CSV substitution | `src/utils/canvas_preprocess.ts` |
| Object/shape model, backgrounds, tail/split/mirror | `src/fabric-object/custom_canvas.ts` |
| QR / barcode drawing | `src/fabric-object/qrcode.ts`, `src/utils/barcode.ts` |
| Undo/redo, editor keyboard/selection | `src/utils/undo_redo.ts`, `src/components/LabelDesigner.svelte` |
| Default sizes / presets / thumb constants | `src/defaults.ts` |
