# P4 — Authoring: save as preset + field-binding UI

Run: [`plan.md`](plan.md) (P4 row, D1–D3). Depends on P1 (`9a2d61c`), P2
(`52fd3b2`); P3 (`be60d5b`) is the gallery these copies land in.
Run state: [`state.md`](state.md).

## Owner decisions (2026-10-31, this phase)

1. **"Save as preset" = copy to a new preset document** (fresh id). The label
   being edited is never converted and never modified.
2. **After saving: stay put** in the editor on the original label, plus a success
   notification naming the preset. No navigation, no auto-open.
3. **Field authoring UI reuses existing controls** (D6 minimal): the content-kind
   select gains "Field"; below it a "Field name" text input; the existing
   Fallback input is reused unchanged. No layout redesign.

## Goal

An author can (a) save the current label as a preset copy, and (b) bind a
text/QR/barcode/code content source to a named field — and the same copy helper
serves P5's "Open in editor" (copy a preset to a normal label).

## Design decisions (fixed here)

- **Copy helper is a full document clone, not a factory rebuild.**
  `structuredClone(doc)` + meta patch (fresh `id`, `kind`, `name`, `createdAt`/
  `updatedAt` = now, `thumb` cleared) + `isLabelDoc` fence at the store boundary.
  Rationale: `createLabelDoc`'s option list carries geometry/nodes but not
  `data.csv`, `globals` or `resources.{fonts,images}` — rebuilding would silently
  drop a preset's CSV attachment and its fonts. Bundle import already uses
  exactly this clone-and-patch shape (`bundle.ts:423-427`).
- **Field sources may carry an empty `name`.** P1's validator rejected empty /
  whitespace names. Authoring needs the half-filled state ("switched to Field,
  typed the fallback, name not typed yet") to survive validation — otherwise the
  node silently degrades to a static source on reload. An empty name is pure
  data (cannot execute; resolves to its `fallback`), exactly like an empty CSV
  `column`, which the validator has always accepted. Keep rejecting a missing /
  non-string `name` and keep unknown kinds fail-closed. Update the P1 tests that
  pinned the empty-name rejection.
- The copy path is generic (`kind` + optional name), so P5's "Open in editor"
  is `saveCopy(presetDoc, { kind: 'label' })` — no second copy implementation.

## In scope

1. `src/core/doc/factory.ts` (or a new `src/core/doc/copy.ts` — prefer the
   factory file if it stays small)
   - `copyLabelDoc(source: LabelDoc, options: { kind: DocKind; name?: string; id?: string; now?: number }): LabelDoc`
     — pure, no storage, no React: deep clone, fresh `id` via `newLabelId()` when
     not supplied, `name` defaults to `source.meta.name`, `kind` is explicit
     (never inherited), timestamps = now (epoch seconds), `meta.thumb` removed,
     everything else preserved (`label`, `nodes`, `data`, `resources`,
     `paperTypeId`). JSDoc explains why this is not `createLabelDoc`.
2. `src/core/doc/validate.ts`
   - `toContentSource` `case 'field'`: accept `name` when `isString(name)` (empty
     allowed, stored untrimmed); keep `fallback` default `''`; non-string/missing
     name still returns `undefined` (carrier falls back to static `''`).
   - Update the comment + the P1 tests (`validate.test.ts` cases that assert
     empty/whitespace name → static).
3. `src/store/storeTypes.ts` + `src/store/slices/docSlice.ts`
   - New action `saveCopy(source: LabelDoc, spec: { kind: DocKind; name?: string }): Promise<LabelDoc | null>`
     — same fence as `createLabel`: build via `copyLabelDoc`, `isLabelDoc`, then
     `repo.save`, then `refreshGallery()`; never touches `currentDoc`, undo
     history or the autosave chain; every failure returns `null` (non-throwing,
     matching `createLabel`). No notification from the store (the UI owns the
     copy).
4. `src/components/layout/header/FileMenu.tsx` + `src/components/layout/Header.tsx`
   - File menu item "Save as preset" (`fileMenu.saveAsPreset`) directly after
     "Save project"; rendered only when a document is open **and** its
     `meta.kind !== 'preset'`; disabled while `transferBusy`.
   - Header handler: `saveCopy(currentDoc, { kind: 'preset', name: currentDoc.meta.name })`;
     on success `addNotification({ type: 'success', message: t('presets.saved', { name }) })`,
     on `null` `addNotification({ type: 'error', message: t('presets.saveFailed') })`.
     Stay in the editor; do not alter `currentDoc`.
5. `src/components/editor/JsTab.tsx`
   - `switchKind` accepts `'field'` → `{ kind: 'field', name: '', fallback: '' }`
     (and maps an existing field source back out unchanged when switching away).
   - `kindOptions` gains `'field'` (no trust restriction — it is data).
   - Field rendering: "Field name" `Input` (`editor.mfp.fieldName`) writing
     `{ kind: 'field', name, fallback }`, plus the existing Fallback `Input`
     reused (same pattern as the csv branch). Keep the `field` arm of
     `KIND_LABEL_KEYS` pointing at the new real key instead of the template key.
6. `src/components/editor/ObjectTab.tsx` + `src/editor/inspectorModel.ts`
   - `contentKindPatch` handles `'field'` explicitly (seed
     `{ kind: 'field', name: '', fallback: '' }`; an existing field keeps its
     name/fallback) instead of falling through to a template.
   - The `contentSource` inspector field options gain `'field'`; its literal map
     uses `editor.mfp.contentField`.
7. `src/i18n/locales/en.json` (single writer)
   - Add `fileMenu.saveAsPreset`, `presets.saved` ("Saved \"{{name}}\" as a
     preset."), `presets.saveFailed` ("Could not save the preset."),
     `editor.mfp.contentField` ("Field"), `editor.mfp.fieldName` ("Field name"),
     and any short helper copy the field inputs need (keep it to the two labels
     unless a hint is unavoidable).

## Out of scope

- No fill dialog, no print wiring, no preset card action (P5).
- No "save filled copy" (D3 non-goal), no preset open action, no navigation.
- No doc schema change (`version` stays 1; no new `meta` fields).
- No changes to `resolve.ts`, the render pre-pass, or the trust gate.
- No UI redesign: the new inputs use the existing `TabField` + `Input` controls.

## Tests

- `src/core/doc/factory.test.ts` (or `copy.test.ts`): fresh id; `kind` explicit
  both ways; name default vs override; timestamps bumped, `createdAt` = now;
  `thumb` cleared; source doc **unmodified** (deep-equal snapshot); nodes are
  deep-equal but not the same references; `data.csv`, `globals`, `resources`
  and `paperTypeId` preserved; result validates.
- `src/core/doc/validate.test.ts`: empty-name field source round-trips (and the
  old "empty/whitespace name → static" expectations are updated); non-string /
  missing name still falls back to static; unknown kind still dropped.
- `src/store/docSlice.test.ts`: `saveCopy` persists a new record with a fresh id,
  leaves the source record untouched, refreshes the gallery, and returns `null`
  (no throw) when the repo is missing or the save rejects; a preset source copied
  as `{kind:'label'}` yields a label with its field bindings intact (the P5 seam).
- `src/editor/render/prepareContent.test.ts` or `PresetSection`-level: a
  zero-name field binding resolves to its fallback (guards the relaxed rule).
- `JsTab.test.tsx`: switching to Field writes `{kind:'field',name:'',fallback:''}`;
  editing name and fallback persists both; an existing field source survives a
  round-trip through the select.
- `ObjectTab.test.tsx`: `contentKindPatch(node,'field')` yields a field source
  (not a template); the select exposes "Field".
- `FileMenu` / `Header` DOM test: the item shows only for an open non-preset doc;
  clicking it persists a preset copy (real memory-adapter repo), shows the success
  notification, and leaves the open doc's id and kind unchanged.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/core/doc src/store src/components/editor src/components/layout`
  (Windows bun binary from global memory; never write its path into a file)
- Full `bun run test:run` before reporting done.

## Envelope reminders

- Public repo: no absolute machine paths in any file.
- One `en.json` writer (this phase). Typed `t()` keys catch stale references.
- No commit, no `git stash`, no destructive git. Depth 1: do not delegate.
  Missing info → terminal `needs-info. q: … . hint: … . next: …`.
