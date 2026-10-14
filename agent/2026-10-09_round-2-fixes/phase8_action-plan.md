# Phase 8 action plan — Paper management

Reads with [`plan.md`](plan.md) §P8, [`state.md`](state.md), [`known-issues/2026-10-06_round-2.md`](../known-issues/2026-10-06_round-2.md)
§"Paper management is broken" (lines 262-273), and `../memory/settings-store.md`.
HEAD at start: `b7c1575`. Branch `main`.

## Owner decisions locked for this phase

1. **Polygon authoring = Option A.** A small **preview canvas** + **manual (x, y) point rows**.
   **Do NOT reuse the editor's polygon draw gesture.** Rationale in §Polygon below.
2. **Preview canvas is fed by `traceUnion`**, the same tracer the editor overlay and the raster
   print clip use. This is the point of the feature: the paper-type preview is WYSIWYG *by
   construction*, not by approximation.
3. **v0 alpha — breaking changes are accepted.** The owner is explicit: *"everything is expected to
   break."* Do not add defensive back-compat shims, dual field names, or "keep the old field too"
   bridges in this phase. Rename things properly and update `validate.ts` accordingly.
4. `PaperType.id` is a plain `string` (user-minted UUIDs). `LabelPresetId`'s closed 4-literal union
   is retired; the built-in registry is demoted to seed data.
5. **Seed the catalogue from the existing presets on first run.** The four built-ins remain the
   default catalogue contents (`ftagSpare-25x78`, `rounded30x20`, `stacked50x15`, `rounded50x30`).
6. **Guides are persisted label data, not derived.** The F-tag score line must be **a part of the
   label** (and of the paper type), not a hard-coded `PRESET_GUIDES` lookup keyed on the paper-type
   id. See §Guides — this deletes the trap that R8a used to be.

## Guides — the model change

**Today:** `editor/render/guides.ts:41-54` holds `PRESET_GUIDES`, a hard-coded table keyed by
`doc.meta.presetId`. `resolveGuides(doc)` (`:57-61`) looks the id up; an unknown or absent id yields
`[]`. `types.ts:244-245` even documents `presetId` as *"Drives non-printing guide derivation."*

**Target:** the guide travels with the geometry.

- `Guide` (`guides.ts:15-23`) **keeps its existing shape** — `{ id, kind: 'score', line: {x1,y1,x2,y2}, label? }`.
  That means `Overlays.tsx`'s rendering is **unchanged**; only the *source* moves from a table to
  the document.
- **`LabelDoc.label` gains `guides: Guide[]`** (alongside `regions` — it is geometry).
  `label` is the geometry block (`types.ts:247-253`); `meta` is provenance, so `guides` does not
  belong in `meta`.
- **`PaperType` gains `guides: Guide[]`**, and `createLabelDoc` copies them from the paper type onto
  `label.guides` exactly as it copies `regions`.
- `resolveGuides(doc)` collapses to `doc.label.guides ?? []`. **`PRESET_GUIDES` is deleted**, and so
  is the `FTAG_SCORE_*_HM` constant block (`guides.ts:33-35`) — those three constants move into the
  `ftagSpare-25x78` **seed** as ordinary data.
- The `ftagSpare-25x78` seed carries its score line (`x = 1250`, `y = 0…3800`) as data, so a newly
  created F-tag label renders exactly as today.
- **`validate.ts` gains a `guides` validator** — ≥1 line, 4 finite hm values, integer-rounded by the
  same discipline as regions (`roundRegion`'s `safeRoundHm`/`nonNegativeHm`).

### What this fixes

- **R8a is resolved by design.** `meta.presetId` no longer drives anything render-critical, so the
  paper-type id can be renamed freely and `meta.presetId` → `meta.paperTypeId` becomes a
  provenance-only rename with no silent-failure mode.
- A user-authored paper type can carry its own score line — impossible while the table was keyed by
  four hard-coded ids.

### What it costs

`guides` is now a **doc-format field**, so P8 gains a `validate.ts` migration question. At v0 that is
explicitly fine ("everything is expected to break"): existing saved documents that relied on
`PRESET_GUIDES` will simply have no `label.guides` and render without the score line. **Optional,
~5 lines, recommended anyway:** in `validate.ts`, when `label.guides` is absent and the doc carries
the F-tag paper-type id, seed the score line — it converts a silent visual loss into a preserved one
for anyone who already has F-tag labels. Implementer's call; report which.

### Still true after the change

A guide is **not a region**: it never clips, never prints, and never contributes to `union(regions)`
or `regionUnionBounds`. Per `../memory/ui-design-workflow.md:37-38` it remains an editor-overlay-only
annotation. **Do not** feed guides to `traceUnion`/`regionUnionPath` — the paper-type preview draws
the union silhouette and the guide lines as **two separate passes**.

## Verified research — taken as fact, do not re-explore

- `NavSidebar.tsx:25` lists `paper` in `ORDERED_SECTIONS`; every non-`recent` branch renders
  `t('nav.comingSoon')` (`:104-106`). There is **no** paper model, repo, store or CRUD anywhere.
- **Paper types need no migration; `guides` does** (decision 6 changed this). `meta.presetId` is
  already typed plain `string` (`core/doc/types.ts:245`) and `validate.ts:840` keeps any string, so
  user-minted paper-type ids flow through validation untouched — that part still holds. But
  `label.guides` is a **new persisted field**, so `validate.ts` + `factory.ts` + every doc
  round-trip test are in scope (W1b, risk R8i). Documents carry their own geometry in
  `label.backingW/backingH/regions`, so the catalogue itself stays additive.
- **No searchable-list component exists in the repo** (grep: zero hits for `type="search"` /
  filter-toLowerCase). This phase invents the gallery CRUD pattern that **P9 reuses twice**
  (CSV + media management). Getting the list row / search / delete-confirm / add-edit-dialog shapes
  right once is the single biggest lever on P9's cost.
- **Preference plumbing precedent ×2** — `gridSpacingHm` (P4) and `connectMethod` (P7). Exactly the
  same **6 files**: `storeTypes.ts`, `storeDefaults.ts`, `slices/settingsSlice.ts`,
  `preferenceValidation.ts` (`PersistedSettings` Pick + `validatePersistedSettings` +
  `pickPersistedKeys`, keeping the `'key' in persisted` guard), `useStore.ts` (`persistedDefaults` +
  `partialize`), plus a `SettingsModal.tsx` `GeneralSection` control.
- **Repo pattern** — `csvRepo.ts` is 95 lines; `resourceRepo.ts` is the same file with different
  fields. `storeTests` mirror `csvRepo.test.ts` via `createMemoryAdapter`.
- **DB wiring** — `db.ts:19` `StoreName`, `:26` `STORE_NAMES`, `:24` `DB_VERSION` (2 → 3),
  `:61-67` `LabelEditorDB`, `:181-187` `createMemoryAdapter` map. `runUpgrade` (`:119-125`) creates
  any missing store additively — existing v2 data survives by construction.
- `docSlice.ts:240-276` `initPersistence` is where `setLabelRepo`/`setResourceRepo`/`setCsvRepo`/
  `setTrustRepo` are wired off the one shared IDB adapter. `paperRepo` joins that block.

## ~~R8a — the F-tag guide trap~~ — RESOLVED BY DESIGN

> **Superseded by owner decision 6 (§Guides).** The original R8a was: *"rename or regenerate the four
> built-in ids and every existing F-tag document silently loses its score line, with no test
> failure."* Persisting guides onto `label.guides` removes the coupling entirely — there is no id
> lookup left to break. `meta.presetId` → `meta.paperTypeId` is now a safe provenance-only rename and
> the id-preservation workaround is **no longer required**.
>
> The four built-in ids still remain the default catalogue contents (decision 5), so nothing about
> the seeds changes. Replacement risks are **R8i** (doc-format change) and **R8j** (guides in the
> preview) in the Risks table.

## Polygon — Option A detail

### What already exists (reuse; do not rewrite)

- `src/editor/polygonDrawing.ts` (104 lines, **already pure**, already has tests):
  `snapPolygonPointIfEnabled`, `finishPolygonPoints`, `MIN_POLYGON_TWICE_AREA_HM2`.
- `src/editor/render/unionPath.ts:45` `traceUnion(ctx, subpaths, scale)` — takes a `PathTracer`,
  a structural type the header comment says *"Konva.Context and the DOM 2D context both satisfy"*.
- `src/editor/render/regionOverlay.ts:123` `regionUnionPath(regions)` → `UnionSubpath[]`.
- Import edge precedent: `Overlays.tsx:4-5` already imports both from `editor/render`. Only
  **`src/core` → `src/editor`** is forbidden; components may import it. (Reviewers will ask — cite this.)

### Why not Option B (reuse the draw gesture)

`PreviewStage`'s polygon tool is ~35 lines of draft state **inlined** in a ~1500-line component
(`polygonPoints`/`polygonCursor`/`polygonDraftPoint`/`finishPolygon`/`resetPolygonDraft` at
`:546-581`, click branch `:624-652`, Enter `:1121`, draft `<Line>` `:1390-1411`). Reusing it means
extracting a hook and rewiring PreviewStage, and it drags in editor-only concerns a paper type has
no use for: node-bounds snapping (`snapPolygonPoint`'s `siblings`), the grid-snap preference, and
`dialog[open]` guards. It would also inherit two **open** bugs — **D-32** (raw
`event.evt.detail < 2` drops a deliberate fast corner click) and **D-37** (the polygon draw preview
renders at the lowest layer). And the gesture only *produces* points: it has no vertex drag,
no per-vertex delete, no reorder — all three of which a **re-editable** paper type needs.

### Preview canvas recipe

- `const bounds = regionUnionBounds(regions)`; `scale = canvasCssPx / max(bounds.w, bounds.h)`.
- `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`, then `ctx.translate(-bounds.x * scale, -bounds.y * scale)`,
  then `traceUnion(ctx, regionUnionPath(regions), scale)`.
- **Fill with the default nonzero winding. Never pass `'evenodd'`** (`unionPath.ts:9-11`,
  `regionOverlay.ts:11`) — overlapping regions must union, never cancel into a hole.
- `ctx.setTransform(dpr,0,0,dpr,0,0)` also covers devicePixelRatio; size the backing store from
  `getBoundingClientRect()`. Redraw on every `regions` identity change. Clear the canvas first.
- Empty region set → `regionUnionPath` returns `[]` → draw the backing outline only, not a blank box.

### Manual point rows

- Reuse `NumberField` + `parseMm`/`mmString` (currently local to `CreateLabelDialog.tsx:33-52` —
  **extract and share**).
- **`closed: true` is hard-coded and is never a user option.** An open polygon is *silently
  non-printable* (`regionOverlay.ts:76-81`, `isDrawableRegion` requires `closed === true`).
- **Validate through `finishPolygonPoints(points)` before save** — it already collapses adjacent
  duplicates, pops a repeated closing vertex, rejects <3 distinct vertices, rejects non-adjacent
  duplicates (self-touching), and rejects slivers below `MIN_POLYGON_TWICE_AREA_HM2`. Its comment
  (`:69-74`) states the stricter-than-print-path direction is deliberate and safe. **Do not
  hand-roll a separate validity check.**
- Add / remove / reorder vertices; nudge a single x or y without retyping the pair.

## Open questions for the owner — resolve BEFORE wave 2

1. ~~**Naming sweep depth.**~~ **RESOLVED** by decisions 3 + 6: v0 breaking changes are accepted and
   guides no longer depend on the id, so rename `meta.presetId` → `meta.paperTypeId` outright and
   update `validate.ts` (:840, :905) in the same change. No dual field, no shim.
2. **Owner screenshot for the new gallery surface.** `../memory/ui-design-workflow.md:4` already
   lists **P8** as an owner-driven UI phase, but `plan.md` only requires screenshots at P10. P8 is a
   **brand-new** surface with no in-product precedent. **Request the screenshot at the phase gate.**
3. **Holes.** `traceUnion` fills nonzero, so overlapping contours union — a user expecting a hole
   gets a solid shape. Correct per `plan.md:187`, but it must be a **stated limitation in the UI**,
   not something a user discovers.
4. **Deleting the default paper type.** Fall back to the first seed, or to `custom`? And if the
   stored `defaultPaperTypeId` points at a deleted record, `createLabel` must not throw.
5. **Deleting a built-in seed.** Allowed (recommended — the catalogue is user data), with the
   first-run marker preventing re-seed.
6. **Does "Custom size" survive** as a choice in the create-label dialog alongside catalogue
   entries, or does the catalogue absorb it?

## Work items

### W1 — `paperRepo` + model + DB store  [wave 1, `general`]

- `src/data/paperRepo.ts` — mirror `csvRepo.ts` exactly (`get/has/list/put/remove/saveAll/clear`,
  `isPaperRecord` shape guard on the write boundary, `isPaperRecordShape` cheap read guard).
  Record: `{ id: string; name: string; backingW: hm; backingH: hm; regions: Region[]; guides: Guide[] }`.
  **No `bytes`/binary analogue** — unlike `resourceRepo`, this is pure data.
- `db.ts`: `DB_VERSION` 2 → 3, add `'papers'` to `StoreName`, `STORE_NAMES`, `LabelEditorDB`, and
  the `createMemoryAdapter` store map. `runUpgrade` needs no change.
- `storeTypes.ts` + `docSlice.ts`: `paperRepo` state, `setPaperRepo`, and wiring inside the existing
  `initPersistence` block (`:253-262`) sharing the one adapter.
- Tests: `paperRepo.test.ts` mirroring `csvRepo.test.ts`; a `runUpgrade` test that a v2→v3 upgrade
  **adds** `papers` without recreating existing stores.

### W1b — guides become doc data  [wave 1, `general`; needs W1's `Guide` import path]

The model half of §Guides, independent of any UI. Touches `core/doc/types.ts`, `core/doc/validate.ts`,
`core/doc/factory.ts`, `editor/render/guides.ts`, and `editor/render/resolve.test.ts`:

- `LabelDoc.label` gains `guides: Guide[]`; `types.ts:244-245` `presetId` → `paperTypeId` (comment
  rewritten — it no longer "drives guide derivation").
- `validate.ts` validates + rounds `label.guides` (`:840`, `:905` neighbourhoods). Optional F-tag
  back-fill per §Guides "What it costs".
- `factory.ts`: `CreateLabelDocOptions.paperTypeId` (string) + copy `guides` from the paper type the
  way `regions` are copied (`:146`). Keep `createFtagSpareDoc` working.
- `guides.ts`: `resolveGuides` → `doc.label.guides ?? []`; **delete `PRESET_GUIDES` and the
  `FTAG_SCORE_*_HM` constants**; `Guide` itself is unchanged.
- Tests: `guides.test.ts` rewritten to assert a doc **with** `label.guides` returns them verbatim and
  one without returns `[]`; `validate.test.ts` gains round-trip + malformed-guide cases;
  `factory.test.ts` swaps `preset:` for `paperTypeId:`.

### W2 — seed from the built-in presets  [wave 1 ∥ W1, `small-coder`]

- `PAPER_TYPE_SEEDS` derived from today's `LABEL_PRESETS` — the four built-ins remain the default
  catalogue contents (decision 5).
- Rename `label-presets/` → `paper-types/`, `LabelPreset` → `PaperType`, `LabelPresetId` →
  `PaperTypeId` (`= string`), `LABEL_PRESETS` → `PAPER_TYPE_SEEDS`. Carry the 4 preset files + their
  4 test files across.
- **The `ftagSpare-25x78` seed now carries its score line as data** (`x = 1250`, `y = 0…3800`), moved
  out of `guides.ts`. Coordinate with W1b — do not both edit the seed.
- **Seeding is idempotent and must not resurrect deletions.** Marker options: a sentinel record in
  `papers`, or reuse the `ensureLegacyMigrated` marker pattern (`db.ts:22-30`). Seed when the store
  is empty **and** the marker is unset; set the marker even if seeding finds nothing.
- Round-trip test: seeds → `createLabelDoc({ paperTypeId })` produces the same geometry as today's
  `preset` path, **including the F-tag guide**.

### W3 — default paper type preference  [wave 1, `general`]

Copy the `connectMethod` (P7) precedent across the **6 files** listed under verified research.
Key `defaultPaperTypeId?: string` — optional, because the default may legitimately be unset
(`undefined` → dialog falls back to the first seed / `custom`). A `GeneralSection` `Select` lists
the catalogue.

### W4 — gallery paper-type section  [wave 2, `general`]

**This is the phase's real cost.** Build the reusable pattern:

- New `PaperTypeSection.tsx` + a small `usePaperTypes` hook — **do not grow `NavSidebar`** (it is the
  gallery's only nav and has no async/loading/error handling today).
- **Extract** `RegionEditor` / `NumberField` / `parseMm` / `mmString` out of `CreateLabelDialog.tsx`
  so the new add/edit dialog and the create-label dialog share one editor.
- **Score-line rows** in the same form: add / remove / edit a guide as 4 numbers (`x1, y1, x2, y2`),
  reusing the extracted `NumberField`. No new component vocabulary needed — a guide is a line.
- List row: name, WxH mm, region count, the §Preview canvas, "set as default", edit, delete.
- **Search** filters on name + dimensions (first searchable list in the product — keep it a pure
  predicate so it is unit-testable without a DOM).
- **Delete** needs a confirm step; deleting the default paper type routes to open question 4.
- Async states: loading / empty / read-error. Storage failures surface as a notification, matching
  `gallery.deleteFailed`'s precedent (`docSlice.ts:232`), never a silent no-op.

### W4b — the preview canvas draws guides too  [wave 2, part of W4]

The preview is now **two passes**, not one:

1. `traceUnion(ctx, regionUnionPath(regions), scale)` + nonzero `fill()` — the printable silhouette.
2. Each `guide.line` as a stroked line in the guide style, after the fill.

- **Do not** pass guides into `regionUnionPath`/`traceUnion` — a guide is not a region.
- **Fit bounds** = `union(regions)` bounds ∪ guide endpoint bounds, so a score line that extends past
  the printable silhouette is not silently cropped out of the preview.
- Draw guides **after** the silhouette fill (paint order), matching the editor overlay.

### W5 — `CreateLabelDialog` on the catalogue  [wave 2, `general`]

- **Rename** the UI "preset" → "paper type"; the picker lists `paperRepo` records (+ `custom`).
- The open effect (`:138-149`) becomes **async** (it must `list()` the catalogue). StrictMode
  double-effect ⇒ guard with a cancelled flag; do **not** let a stale resolve overwrite a newer one.
- Submit passes explicit `backingW` / `backingH` / `regions` **and** `guides`, plus `paperTypeId` as
  provenance. The `guides` copy is what makes the F-tag score line survive label creation.
- A `paperTypeId` that no longer resolves must **not** throw (`createLabel` is contractually
  non-throwing per the existing `catch` at `:206-216`).
- Tests: `CreateLabelDialog.dom.test.tsx` (existing 3 cases must stay green), plus a default-paper
  selection case, a deleted-default fallback case, and a create-from-F-tag-seed case asserting the
  guide reaches `label.guides`.

### W6 — rename sweep + i18n  [wave 2, `small-coder`]

- i18n: rename `presets.*` (5 keys) and `createLabel.preset`; add the `paperTypes.*` set for the new
  section. **Deletions are allowed and expected this phase** (owner override 2026-10-12). One writer
  per wave.
- `types.ts:244-245`'s `presetId` comment is rewritten by W1b — do not duplicate that edit.

### W7 — i18n inventory (for W4/W5, one owner)  [wave 2]

Add under `paperTypes.*`: `title`, `searchPlaceholder`, `empty`, `add`, `edit`, `delete`, `deleteConfirm`,
`deleteConfirmName`, `setDefault`, `isDefault`, `defaultBadge`, `loading`, `readError`, `deleteFailed`,
`saveFailed`, `invalidPoints`, `dimensions`, `regionCount`, `custom`, `noHolesHint`, `name`, `width`,
`height`, `dpi`, plus the guide set: `guides`, `addGuide`, `removeGuide`, `guideLabel`, `guideInvalid`.
Rename `createLabel.preset` → value only (`"Paper type"`); the key may stay.

## Waves and gates

| Wave | Writers (parallel)                                                     | Files                                                                                               |
| ---- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1    | W1 (`general`), W2 (`small-coder`)                                     | `data/paperRepo*`, `db.ts`, `storeTypes.ts`, `docSlice.ts`; `paper-types/` rename + seeds + marker  |
| 1    | W1b (`general`) — after W1                                             | `doc/types.ts`, `doc/validate.ts`, `doc/factory.ts`, `editor/render/guides.ts`                      |
| 1    | W3 (`general`)                                                         | settings preference 6 files + `SettingsModal.tsx` control                                           |
| 2    | W4+W4b (`general`) — needs W1+W1b+W2+W3                                | `PaperTypeSection`, `usePaperTypes`, extracted `RegionEditor`, preview canvas (silhouette + guides) |
| 2    | W5 (`general`) — needs W4                                              | `CreateLabelDialog.tsx`                                                                             |
| 2    | W6 (`small-coder`) — after the rename                                  | i18n sweep                                                                                          |
| gate | `review` → fix (≤2 rounds) → narrow re-review (`review-fast`) → commit |                                                                                                     |

**One semantic commit for the phase** unless it grows; if W4+W5 prove separable, A = repo+seed+
guides-model+preference, B = UI + dialog. Implementer's call — report which.

Only one writer touches `en.json` per wave. Depth-1: subagents must not delegate; they emit
`needs-info. q: … . hint: … . next: … .` and stop.

## ENV (repeated)

`bun run test:run [files]` (never `bun test`, never `bunx`/`npx`);
`node node_modules/typescript/bin/tsc --noEmit`. `en.json` at `src/i18n/locales/en.json`.
StrictMode is on. No `git stash`. Global `keydown`/`paste`/`drop` handlers must bail on
`dialog[open]`. All product strings via `t()` typed keys.

## Risks

- ~~**R8a F-tag guide loss**~~ — **retired**; resolved by owner decision 6 (§Guides). Nothing keys on
  the paper-type id any more.
- **R8i `guides` is a doc-format change** — `LabelDoc.label` gains a field, so `validate.ts`,
  `factory.ts`, and every doc round-trip test are in scope. At v0, no back-compat shim (decision 3).
  Reviewers should check the hm rounding discipline matches `roundRegion`.
- **R8j guides in the preview** — the canvas is now two passes. A guide must never reach
  `traceUnion`/`regionUnionPath` (it would become printable), and preview bounds must include guide
  endpoints so an out-of-silhouette score line is not cropped.
- **R8b async dialog seeding under StrictMode** — the create-label open effect becomes async; a
  stale resolve must not clobber the default. StrictMode-idempotent, cancellation-guarded.
- **R8b async dialog seeding under StrictMode** — the create-label open effect becomes async; a
  stale resolve must not clobber the default. StrictMode-idempotent, cancellation-guarded.
- **R8c `DB_VERSION` bump** — additive only; assert in the `runUpgrade` test that existing stores
  are not recreated.
- **R8d seed resurrection** — the first-run marker must not re-seed after a user deletes a built-in.
- **R8e nonzero fill** — a reviewer or implementer passing `'evenodd'` to the preview's `fill()`
  silently punches holes in overlapping regions. Never pass it.
- **R8k seed/guides double-edit** — W1b and W2 both touch the F-tag geometry. One writer per file;
  W1b owns `guides.ts` + `types.ts` + `validate.ts` + `factory.ts`, W2 owns `paper-types/`.
- **R8g owner UI gate** — a brand-new gallery surface with no precedent; request the screenshot
  before wave 2 (open question 2), per `../memory/ui-design-workflow.md`.
- **R8h P9 dependency** — W4's list/search/delete/add-edit shapes are what P9 reuses twice. Prefer a
  reusable `PaperTypeSection` shape over a bespoke one; note any deliberate non-generality.
- **Phase-end memory updates** (`plan.md:174`) — `../memory/ui-design-workflow.md:37-38` currently
  describes guides as an overlay-only seam reached by id lookup. After W1b it must say guides are
  **persisted on `label.guides` and carried by the paper type**. `../memory.md` gains a
  `paper-types.md` area file covering the catalogue, the seed marker, and the preview canvas.

---

## Coordinator addendum — 2026-10-13 (recon + owner round-2 decisions)

### Owner decisions resolved (round 2)
1. **Deleted/unset default paper type:** if the stored `defaultPaperTypeId` resolves to nothing
   (record deleted) **or is unset**, `CreateLabelDialog` falls back to **`custom` geometry**;
   otherwise it uses the stored default. `createLabel` stays non-throwing (existing `catch`).
2. **Built-in seeds are deletable** (catalogue is user data); the first-run marker prevents re-seed
   from resurrecting a deleted seed.
3. **"Custom size" is removed as a user-facing choice** in `CreateLabelDialog`; the catalogue
   absorbs it. (A `custom` *fallback geometry* still exists internally for decision 1.)
4. **Wave-2 UI spec direction (owner, replaces the screenshot request):** mirror `GalleryView`'s
   **"recently edited" card grid** + add a **search bar**. Paper-type **edit** = an edit button on the
   row/card opening the **existing preset editor** (the region rows + number fields extracted from
   `CreateLabelDialog`). Optionally a **left preview / right edit** split modelled on the **print
   preview**. No separate `ui-designer` pass; build to this direction.

### Verified corrections to this plan (recon, read-only)
- **`Guide` must be relocated into `core`.** It is defined only in `editor/render/guides.ts:15`, and
  that file already imports `LabelDoc` from core (`:3`). `LabelDoc.label.guides: Guide[]` /
  `paperRepo`'s `guides: Guide[]` therefore cannot import `Guide` from `editor` (core→editor is
  forbidden; a core import of editor would be circular). **New pre-step W0:** define `Guide` in
  `core/doc/types.ts` (next to `Region`), have `editor/render/guides.ts` re-export it. `Guide`'s
  shape is unchanged.
- **Rounding discipline:** `roundRegion`/`safeRoundHm`/`nonNegativeHm` live in
  `core/doc/factory.ts:25-61`; `validate.ts` rounds via `isHm` (`:87-88`) + `clampRegionExtent`
  (`:96-101`). W1b mirrors **each file's own** mechanism, not one shared helper.
- **`label-presets/` carries 5 test files**, not 4: the four preset tests **plus**
  `point-in-region.test.ts`, and the test-only helper `point-in-region.ts` (not exported from
  `index.ts`). W2 moves the helper + its test too, else the preset tests fail to resolve
  `pointInUnion`.
- **First-run marker pattern** is `src/data/migrate.ts:16` (`MIGRATION_MARKER_KEY`) + `:63-79`
  (`migrateLegacyIfNeeded`), **not** `db.ts:22-30` (that range is `DB_VERSION`/`STORE_NAMES`).
- **`RegionEditor` does not exist** — regions are inlined as `RegionRow`
  (`CreateLabelDialog.tsx:54-107`) + the region `<ul>` (`:297-310`). W4's "extract `RegionEditor`"
  means factoring those out, not relocating an existing component.
- **`regionUnionBounds`** is exported from `core/doc/derive.ts:227`, not `regionOverlay.ts`.
- **`Factory.ts` uses `LABEL_PRESETS`/`LabelPresetId`** (`factory.ts:130,117`) and `storeTypes.ts:20`
  has `preset?: LabelPresetId`. W2's rename sweep must update these consumers — handled by sequencing
  W2 **after** W1b/W1/W3 (below), so there is no stale-identifier window.

### Wave-1 execution sequence (coordinator)
Dependencies force a mostly-linear order; only W1+W3 and W1b overlap.

| Step | Worker | Scope | Rationale |
| ---- | ------ | ----- | --------- |
| **W0** | `small-coder` | Relocate `Guide` → `core/doc/types.ts`; `editor/render/guides.ts` re-exports it. | Unblocks W1 (`paperRepo.guides`) and W1b without a core→editor import. |
| **A** = W1+W3 | `general` | `data/paperRepo*`, `db.ts`, `docSlice.ts`, `storeTypes.ts` (repo fields), + preference plumbing 6 files. | One writer for `storeTypes.ts`. |
| **B** = W1b | `general` | `core/doc/types.ts`, `validate.ts`, `factory.ts`, `editor/render/guides.ts` + the F-tag preset's score-line data, + their tests. | Owns the guides model end-to-end so its tests are green standalone. |
| **C** = W2 | `small-coder` | `label-presets/` → `paper-types/` rename, `LabelPreset→PaperType`, `LabelPresetId→PaperTypeId (=string)`, `LABEL_PRESETS→PAPER_TYPE_SEEDS`, seed marker, all consumer renames (`factory.ts`, `storeTypes.ts`, `CreateLabelDialog.tsx`, tests). | After A+B: it renames the identifiers they produced. |
| gate | `review` → fix (≤2) → narrow `review-fast` → commit | | |

A ∥ B (disjoint files); C strictly after both. Wave 2 (W4/W4b/W5/W6/W7) follows once C lands.