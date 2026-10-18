# Plan — render target, grey preprocess, colour thumbnails, screentone

- Date: 2026-10-19. Status: **PLANNED — awaiting owner review; not started.**
- Predecessor run: [`agent/2026-10-09_round-2-fixes/`](../2026-10-09_round-2-fixes/) (P1–P15 all shipped,
  tree clean at `924d025`). This plan supersedes parts of it, named per phase below.
- Source: owner Q&A 2026-10-19 (verbatim intents quoted under "Owner decisions"), plus three verified
  recons taken as fact — [`phase14_action-plan.md`](../2026-10-09_round-2-fixes/phase14_action-plan.md)
  (the quantizer engine, the keying traps, the palette), [`phase15_action-plan.md`](../2026-10-09_round-2-fixes/phase15_action-plan.md)
  (the print transport + progress model) and
  [`memory/screenstyle-quantization.md`](../memory/screenstyle-quantization.md) §4a (the head-locked pitch
  recon). Read those before this plan's phases; do not re-derive their facts.
- Repo memory: read [`agent/memory.md`](../memory.md) first; area files per phase (see ENV BRIEF).

## Goal

Make the print raster **device-driven** instead of document-driven, give the quantization pipeline a
**named grey-domain preprocess stage** (which is where gamma belongs, now **per object**), make gallery
thumbnails show the **colour** design the document saved, and add a **screentone** engine whose halftone
cells are locked to the printer's physical dot grid.

## Owner decisions (2026-10-19, recorded)

1. **Print dpi follows the printer — behind a setting, default ON.** Setting off ⇒ always use the
   document's dpi. In auto mode, if the printer fails to report a dpi ⇒ **fall back to the document's**.
   The document-level field is **renamed to "DPI hint"** (it stops being the raster dpi; it becomes the
   hint/fallback). Verbatim: *"Behind a setting, default on. off -> always use doc dpi hint. in auto mode,
   if for some reason the printer fails to report, fallback to doc dpi. rename the doc dpi setting to
   'DPI hint'."*
2. **Print preview shows the resolved dpi:** in auto mode a **greyed-out display of the detected value**;
   with the setting off, a **number box** seeded from the document dpi. Verbatim: *"Make the print preview
   page have a DPI (grayed out) showing the detected value, or a number box thats set to the document dpi
   when the setting is off."*
3. **Screentone parameters are user-selectable** — tone levels, pitch, angles. Verbatim: *"Leave the tonal
   levels and whatever as user selectable."* (Pitch must still be physically legal — see P4.)
4. **A preprocessing engine sits between the projection and the quantization choice and handles gamma.**
   Verbatim: *"Maybe it's worth having a preprocessing engine … it should be easy (and the 'correct' place)
   to add a preprocessing engine in the middle that handles gamma as well?"*
5. **Gamma becomes per object.** Verbatim: *"Gamma should actually be per-object."* This supersedes the
   P14 decision (gamma as a per-strategy setting only) — debt **D-58** is retired by P1, with the
   per-strategy setting kept as the fallback layer it already is.
6. **Gallery/recents thumbnails show what the user designed, not what we think printed.** Verbatim:
   *"gallery is allowed to just show whatever the document had saved. And the document should've saved the
   colored thumbnail of what the user designed, not what we thought was printed. If the saved preview is
   old, then we display the old. No need to explicitly design a path to embed a quantized view."*
7. **Commits:** semantic commit per phase, after its review pass (the run's standing convention — already
   confirmed by the owner in the predecessor run; no need to re-ask).

## Household facts this work pays off

| debt | what it is | where it lands |
|---|---|---|
| **D-69** | raster is the doc dpi, encoded **1:1** in printer dots with no resample ⇒ a dpi mismatch prints at the **wrong physical scale** (203-dpi doc on a ~300-dpi head ≈ 0.68×) and any raster-pixel grid sits off the physical dot grid; only signal is a non-blocking advisory `rollDpiMismatch` | **P2 closes it** |
| **D-28** | `prepareAssets`' decode cache is **dpi-unaware** — one cache keyed by asset identity across 100-dpi thumbnails and doc-dpi prints | **P2 must fix it** (else device dpi thrashes the cache) |
| **D-58** | gamma is per-strategy only (deliberate P14 simplification) | **P1 retires it** (per-object gamma) |
| **D-50** | thumbnails: `meta.thumb` never written, no backfill for never-reopened labels | **P3 addresses it** |
| **D-64** | 8-slot mask palette pressure unmeasured (gamma + 5th strategy already add keys) | **P4 measures it** (screentone adds more knobs) |

## ENV BRIEF (carry into every phase)

- Package manager: **bun** (`bun`), never npm/bunx/npx.
  Tests: `bun.exe run test:run [files]` (Vitest, in-process). Typecheck:
  `node node_modules/typescript/bin/tsc --noEmit` (not the Windows-only `.bin` shim, not a full build).
- All product strings via `t()` with typed keys (`src/i18n/locales/en.json`); dynamic keys via the
  literal-map pattern ([`memory/i18n.md`](../memory/i18n.md)). Never annotate a parameter with the whole
  generic `t` type — that is the `WarningsTab` `TS2589` trap (P15).
- `<React.StrictMode>` is active: effects fire twice; subscriptions/intervals must be idempotent.
- Global `keydown`/`paste`/`drop` handlers must bail when `<dialog open>` exists.
- Real-canvas tests need `installCanvasShim()` (`src/test/canvasHarness.ts`); the heavy
  `renderLabelPage.*` suites run against the **15 s** global timeout and flake under load (D-23) —
  keep new fixtures small.
- `core/` and `print/` must stay store-free: settings are **threaded** via `RenderLabelPageOptions`.
- Depth-1 subagents (no grandchild delegation); **never `git stash`**; reviewer shells are usually
  denied, so the coordinator runs the reviewer's scoped test/tsc commands and records them; `review` is
  primary, `review-fast` for mechanical/narrow re-reviews, `review-alt` as fallback (the primary model
  has been region-blocked intermittently — retry, it recovers).
- The owner does **browser and hardware verification manually**; agents do not drive a browser.

## Phases

Four phases. Each one: action plan → implement → review → fix (max 2 rounds) → semantic commit → ask the
owner before the next phase.

### P1 — Grey preprocess stage + per-object gamma

**Objective:** turn the implicit, duplicated tone-curve application into a **named grey-domain preprocess
stage** inside the per-policy pipeline, and expose `gamma` **per object**.

**Why first:** it is the smallest phase, it retires D-58, and it builds the seam P4 needs. It also removes
today's duplication (the tone LUT is applied in two quantizer paths).

- **Facts that shape it (verified):** the projection happens *inside* each quantizer —
  `createDiffuser` builds the grey plane (`src/core/render/quantize.ts`), `threshold` projects per pixel —
  which is why gamma is currently applied in two places. `applyPolicy` (`src/core/render/policy.ts`)
  hands **each policy a fresh copy of the whole frame** and scatters only its masked pixels, so a
  per-policy pre-process is structurally natural.
- **A tone curve must stay grey-domain.** Applying gamma per RGB channel and then projecting is *not* the
  same function, and for a mono thermal head the thing being compensated is average darkness. Do not
  "simplify" this into an RGBA pass.
- **Shape:** `copy → project → preprocess(params) → quantize(params) → scatter`, where preprocess is a
  small **chain of pure grey ops** with the tone curve as its first member. Keep `Quantizer` pure.
  Decide in the action plan whether the projection is hoisted out of the quantizers (cleaner, wider diff,
  touches every quantizer + golden planes) or the chain is called at the existing internal hook points
  (smaller diff, keeps the duplication shape). Recommend the honest hoist if the diff stays contained.
- **Per-object gamma:** add `quantizerParams.gamma` (document data ⇒ `validate.ts` guards, `factory.ts`
  rounding, inspector field, i18n, and the `RESERVED_FIELDS`/`ObjectTab` wiring). Precedence is already
  the right shape: **node → per-strategy setting → engine default**.
- **Traps:** `policyKeyOf` already keys the normalized gamma (P14) — keep it keyed as more knobs join;
  the P13 omission trap applies (the global base merges *under* each policy, so the chain must be fed
  explicitly per policy); `quantizerSettingsKey` picks up new params automatically but must be asserted.
- **Tests:** gamma-1 byte-identity is preserved; per-object gamma beats the per-strategy default;
  per-object gamma yields a distinct mask slot (the D-57(b) trap); the chain is a no-op when neutral;
  `validate`/`factory` round-trip for `quantizerParams.gamma`; the existing golden planes stay
  byte-identical at neutral.
- **Review:** `review`. **Retires D-58.** **Commit:** `feat(quantize): grey preprocess stage + per-object gamma`.

### P2 — Device-driven print dpi ("DPI hint") + D-28

**Objective:** the print raster renders at the **printer's** dpi when the new setting is on and the
printer reports one; otherwise at the document's **dpi hint**. Closes **D-69**.

- **Verified facts:** `renderLabelPage.ts:570` — `opts.dpi ?? opts.assets?.dpi ?? doc.label.dpi`; the
  print path never sets `opts.dpi` today, though `printLabel.ts`'s `renderOptionsOf` **honours** an
  `overrides.dpi` (nothing sets it). The raster is encoded **1:1** in printer dots
  (`printLabel.ts` `ImageEncoder.encodeCanvas`) — no resample — which is exactly why the doc dpi must
  equal the head dpi for physical correctness. `rollDpiMismatch` (`components/print/printDialogModel.ts`)
  is a **non-blocking advisory** comparing the printer-reported dpi to `doc.label.dpi`; the printer's
  `dpi`/`printheadPixels` are **model metadata** (`niimbotAdapter`), *not* NFC-tag data — a different
  trust level from the roll dimensions (which are tag advice only; see
  [`memory/print-transport.md`](../memory/print-transport.md)).
- **Setting:** persisted, default **ON**. Off ⇒ doc hint always. Auto + no reported dpi ⇒ doc hint.
- **Preview ≡ print (invariant 7):** the single-page print preview must render at the **same** resolved
  dpi as the print, and show it per decision 2 (greyed-out detected value in auto; a number box seeded
  from the doc dpi when off). `PrintDialog`/`PrintPagePreview` already have their own render path.
- **D-28 is a prerequisite, not a nice-to-have:** assets are prepared at the effective dpi (symbol
  rasterisation is fitted in px at that dpi), so one session will prepare the same asset at 100 dpi
  (thumbnails), printer dpi (print/preview) and a capped dpi (live preview). Fix the decode cache to be
  **dpi-aware** (or split the thumbnail cache) in this phase, or the setting becomes a cache-thrash bug.
- **Verdicts follow:** the QR/2D "too small module" verdict is a statement about printed geometry, so it
  must be computed at the **effective** print dpi, not the hint. Check every consumer of `doc.label.dpi`
  and classify it: render-time (move to the resolved dpi), provenance/hint (keep), or metadata.
- **Existing documents change output** when their hint ≠ printer dpi — that is the point, but it needs a
  visible notice in the print dialog (reuse/extend `rollDpiMismatch`'s message rather than adding a
  second warning), and the rename must be complete: the doc field's label, any inspector/settings UI, and
  i18n keys — "DPI hint", with the old meaning gone.
- **Tests:** resolution order (setting off / on / on-with-no-printer-dpi); preview and print agree on the
  resolved dpi; asset prep is dpi-keyed (the D-28 regression); the verdict changes with the effective dpi;
  the renamed field round-trips.
- **Review:** `review` (logic-heavy, cross-cutting). **Closes D-69, pays D-28.**
  **Commit:** `feat(print): device-driven raster dpi (DPI hint)`.

### P3 — Colour thumbnails + D-50 backfill

**Objective:** a saved preview is the **colour design** the user made, not the quantized render. The
gallery shows whatever was saved — stale thumbs included — with no quantized path anywhere in the gallery.

- **Verified facts:** the thumbnail producer is `editor/render/docThumbnail.ts` (a components-layer hook
  drives it) which renders through **`renderLabelPage` at 100 dpi** — i.e. the whole print pipeline
  including policy masks and quantization — then `labelRepo.putThumb`. `meta.thumb` is never written and
  there is no backfill for labels that are never reopened (**D-50**).
- **Shape:** the print path already **rasterises Konva before it quantizes** (`editor/render/rasterize.ts`
  feeds `renderLabelPage`), so a colour thumbnail is that raster **plus the region clip**, **skipping**
  quantization, mask build and the print-only overrides (invert/mirror/offset). It is *cheaper* than what
  runs today. Nothing in `src/core/render` needs to change.
- **Print-queue thumbnails stay quantized** (`usePrintThumbnails`, 100 dpi) — those preview the print and
  the owner's decision does not touch them.
- **Invalidation:** changing what a stored thumb *is* makes existing thumbs meaningless. Regenerate on
  the existing save path, and use the same moment to finish **D-50**: write `meta.thumb`, and backfill
  lazily (on first gallery load / at idle) rather than by a full-library sweep.
- **Small decision for the action plan:** keep the region clip + white page + paper silhouette so the
  colour thumb still looks like a label (recommended), and keep 100 dpi.
- **Tests:** the producer skips quantization (a doc with a `threshold` hint must not produce pure 0/255);
  the clip still applies; `meta.thumb` is written; backfill is bounded/idempotent and StrictMode-safe.
- **Independent of P1/P2** — it may be reordered with the owner's consent; suggested slot after P1.
- **Review:** `review`. **Commit:** `feat(gallery): colour thumbnails of the saved design`.

### P4 — Screentone quantizer (head-locked)

**Objective:** a procedural screentone engine whose halftone cells are locked to the printer's **physical**
dot grid, with user-selectable tone levels, pitch and angle.

- **Why last:** it needs P1's preprocess chain (tone levels ride the grey seam) and P2's effective dpi
  (pitch can only be head-locked once the raster dpi is the printer's).
- **Algorithm (already designed, [`memory/screenstyle-quantization.md`](../memory/screenstyle-quantization.md)
  §4):** projected grey → tone chain → `K`-level index → `ink = k < rank[(u,v) mod P]` against one
  precomputed clustered-dot matrix. A **stateless point op**: O(1)/px, no error buffer, **cheaper than
  `floydSteinberg`**, and — like `threshold` — **immune to the cross-policy seam problem (D-05)**.
  Rotation must use the **integer lattice basis** (`(a,b)`,`(−b,a)`) so cells tile exactly: `(1,0)`→0°,
  `(4,1)`→14°, `(2,1)`→26.6°, `(1,1)`→45°.
- **Pitch is physical, never raw px.** Expose it in mm, **snapped to legal integer dot counts at the
  effective print dpi**, showing both (e.g. "0.51 mm — 6 dots @ 300 dpi"). The verified table:
  300 dpi head (B1_PRO: 567 dots ≈ 48.006 mm ⇒ 11.811 dots/mm) — 5 dots = 0.423 mm, 6 = 0.508,
  8 = 0.677, 12 = 1.016; 203 dpi head — 4 = 0.500, 6 = 0.751, 8 = 1.001. Escape hatch: if the effective
  dpi ≠ the head dpi (only possible with the P2 setting OFF), the pitch cannot be head-locked — surface
  it, do not silently render an aliased screen.
- **Wiring:** the full checklist is in the recon — `QuantizeOptions`/`QuantizerId`/`Quantizers`,
  `QuantizerDefaultParams`, `DEFAULT_GAMMA_BY_STRATEGY` (compile-enforced), `PolicyParams`/
  `ResolvedPolicyParams`/`resolveQuantizerParams`, `policyKeyOf` (**every** new pixel-changing knob),
  `buildQuantizeOptions` **and** the explicit per-policy options block in `buildPolicyMask`,
  `preferenceValidation`, the Rendering settings section, a **new inspector visibility class** (a new id
  currently falls into the `else` and wrongly shows "Error diffusion + Serpentine"), `RESERVED_FIELDS`,
  `ObjectTab` field plumbing, i18n. `QUANTIZER_IDS`, the hint options and `quantizerSettingsKey` are
  registry-derived (free).
- **Never a default for qr/barcode/code/text** — a screentoned symbol does not scan. Keep
  `DEFAULT_POLICY_BY_TYPE` alone; screentone is opt-in per node (or a per-type default the owner
  explicitly asks for).
- **Measure the palette (D-64)** while here: each new knob multiplies distinct policy keys against the
  **8-slot** `KEY_COLORS` mask palette, and overflow silently drops a node to the global pass.
- **Tests:** the rank matrix is a fixed table (no `Math.random` — determinism is invariant 7), golden
  1-bit planes **pinned at a stated dpi**, pitch snapping (legal dot counts only, at two head dpis),
  lattice rotation periodicity, `K`-level tone ramp, no alias at the legal pitch, and the mask/policy
  integration. The reference's own `BAYER_MATRICES` (`references/niimblue/src/utils/post_process.ts`) is
  dpi-blind — useful contrast, not a model to copy.
- **Review:** `review` (new engine). **Commit:** `feat(quantize): head-locked screentone halftone`.

## Risks & checkpoints

- **R1 — preview ≡ print (invariant 7).** P2 changes the raster dpi: every path that today renders at
  `doc.label.dpi` (print, single-page preview, live quantized preview, thumbnails) must be classified
  deliberately, and the **preview must resolve the same dpi as the print**. Getting this wrong silently
  breaks the run's oldest invariant.
- **R2 — the P13 omission trap.** `applyPolicy` merges the global base *under* each policy's options, so
  any pixel-changing knob (gamma, screentone's levels/pitch/angle) that a policy omits silently inherits
  the global value. Set every knob explicitly on the global pass **and** on each per-policy entry.
- **R3 — the D-57(b) key trap.** `policyKeyOf` must key every new pixel-changing param, or two nodes
  differing only in that param share one mask slot and the first wins. Key the *normalized* value so
  equivalent inputs share a slot (the P14 fix).
- **R4 — the 8-slot mask palette.** Each knob adds key dimensions; overflow silently falls back to the
  global pass. Measure `policyOverflowCount` in P4 (D-64) and report rather than silently absorb.
- **R5 — asset-prep dpi keying (D-28).** Without a dpi-aware cache, P2's setting turns into cache
  thrash/stale assets. Treat as a prerequisite inside P2, not a follow-up.
- **R6 — existing documents change output** (P2). Accepted at v0 alpha, but the dialog must *say* the
  print will use a different dpi than the hint rather than changing output silently.
- **R7 — the rename must be complete** (P2): the doc field's label, its UI, i18n keys and any doc text
  still calling it "dpi" in the old sense; a stale meaning is worse than a stale label.
- **R8 — head dpi is metadata, roll data is tag advice.** Do not conflate them (P2/P4): `dpi`/
  `printheadPixels` are model capabilities; NFC roll/paper values are advisory and may be wrong.
- **R9 — thumbnail invalidation** (P3): changing what a stored thumb is makes old thumbs meaningless;
  regenerate coherently, and do not let backfill become an unbounded sweep on a large library.
- **R10 — screentone scanability** (P4): never default it for symbol/text types; if it ever becomes a
  per-type default, the symbol types must be excluded explicitly.
- **R11 — drvfs is slow**: prefer `tsc`; full builds only at the end of a phase.

## Open questions (to settle in the phase action plan, not blocking this plan)

1. **Screentone defaults** (P4): default pitch (propose the smallest legal pitch ≥ 0.5 mm at the reported
   head dpi), default `K` (owner wants levels selectable; propose 3–4 as a start), default angle
   (propose 45°, i.e. `(1,1)`), and whether an existing doc without the field behaves as "off" (propose
   yes — a new quantizer id is only reachable by explicit selection).
2. **Preprocess chain membership** (P1): gamma/tone only in v1; leave `invert`/`mirror` where they are
   (they are print overrides applied *after* quantization today — moving them into the chain would change
   output; do not fold them in without checking each one's semantics).
3. **Colour thumbnail composition** (P3): keep the region clip + white page + paper silhouette so it still
   reads as a label (recommended), at the existing 100 dpi.
4. **Setting placement** (P2): the new device-dpi setting is global (one app setting). Per-printer or
   per-paper-type variants are explicitly out of scope unless the owner asks.

## Execution notes (coordinator)

- Per phase: write `phase{N}_action-plan.md` here, then implement → review (`review` primary) → fix
  (max 2 rounds) → semantic commit → **ask the owner before the next phase**.
- Sub-agents: `general` for logic/engine work, `small-coder` for mechanical wiring, `explore`/`scout` for
  scoped questions. No `ui-designer` this run unless the owner asks.
- Parallelise only genuinely independent pieces (P3 is independent of P1/P2); P1 → P2 → P4 are sequential
  because they share the quantizer/policy/asset seams.
- At the end of the run: escalate durable facts to `agent/memory.md` / the area files
  (`dithering.md`, `screenstyle-quantization.md`, `print-transport.md`, `objects-assets.md`,
  `tech-debt.md`) and keep this directory task-scoped.
- **Handoff:** this plan is written by the coordinator at the owner's request. Drive it from the
  `coordinator` agent (switch with Tab) — the owner reviews this plan first.
