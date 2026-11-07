# P5 — Fill + print flow

Run: [`plan.md`](plan.md) (P5 row, D3). Depends on P1–P4 (`52fd3b2` resolves
field values, `d24e4ed` authors presets/bindings).
Run state: [`state.md`](state.md).

## Owner decisions (2026-10-31, this phase)

1. **Layout: modal, form + preview.** Header = preset name + size; one labelled
   input per distinct field name (the binding's `fallback` is the input
   placeholder); a live preview; actions **Print**, **Open in editor**, **Cancel**.
   Reuse the existing `Modal` (native `<dialog>`) and the existing form controls.
2. **Live preview** against the values being typed, through the same render path
   as the editor (colour page, not quantized).
3. **Card click opens the fill dialog** — the preset card's art becomes the open
   affordance; delete stays a separate button.

## Goal

Owner workflow end-to-end in-app: click a preset → type values → see the label
with those values → Print (or "Open in editor" to copy it into a normal label).

## Design seams (fixed here)

- **One content path.** The dialog does not resolve anything itself: it calls
  `usePrintJob` (the print dialog's own content deps) with the preset document
  and the filled values, so the live preview and the printed pages come from the
  same `prepareResolvedContent` pass — the P2/P12 "preview ≡ print" invariant
  holds by construction, including trust prompts, the serial-use engine and
  globals prefetch. `usePrintJob` gains an optional `doc` (default: the store's
  open document) so a gallery dialog can resolve a document that is not
  `currentDoc` without opening it in the editor (D3: a preset never becomes the
  editing doc; opening it creates a copy).
- **Values are transient.** The dialog holds `Record<string, string>` in state;
  nothing writes it to the document, the store or storage (P2 invariant).
- **Field list** = distinct, non-empty `{kind:'field'}` names across the doc's
  nodes, in node order (first appearance wins). An empty name is the
  half-authored state and is never shown or bound.
- **"Open in editor"** = `saveCopy(presetDoc, { kind: 'label', name })` then
  `openLabel(copy.id)` (which flushes, resets history and sets `view:'editor'`).
  Bindings stay intact and unfilled — the sample-row/fallback preview applies.
- **No CSV in this phase.** The preset's stored attachment (if any) and its
  `sampleRowIndex` are used as-is; row-by-key lookup is P6.

## In scope

1. `src/editor/presetFields.ts` (new, `.ts`-only layer)
   - `presetFieldNames(doc: LabelDoc): string[]` — distinct non-empty field names
     in node order, via `contentSourceOf`; no DOM, no React. JSDoc explains the
     dedupe/empty-name rules.
2. `src/components/print/usePrintJob.ts`
   - `UsePrintJobOptions` gains `doc?: LabelDoc | null`: when the key is present,
     that document is resolved (a `null` doc keeps the hook inert); when absent,
     today's `state.currentDoc` behaviour is unchanged (`EditorShell` untouched).
     Update the hook's doc comment.
3. `src/components/gallery/FillPresetDialog.tsx` (new)
   - Props `{ open, presetId: string | null, onClose }`.
   - Loads the full document with `labelRepo.get(presetId)` when opened
     (token-guarded, StrictMode-safe; loading / load-failure states).
   - `const job = usePrintJob({ open: open && doc !== null, doc: presetDoc, fields: values })`
     (hook called unconditionally; `doc` is `null` until loaded → inert).
   - Renders `Modal` (size `lg`): title = preset name, size line = backing W×H in
     mm (reuse the card's formatter), one labelled `Input` per field name
     (`placeholder` = that field's most common fallback — first binding's
     fallback; label = the field name), the live preview image, and a footer with
     Cancel / Open in editor / Print.
   - Live preview: on open + `valuesKey`, `await job.prepareRow(doc.data.sampleRowIndex)`
     then `renderDocPreview(doc, job.assets, ctx)` and show `metaThumb.dataUrl`
     (bounded ≤512 px — do not invent a second renderer). Token-guard the async
     result; keep the previous image while a new one renders; show a neutral
     placeholder when there is none.
   - Print: a `printing` state mounts the existing `PrintDialog` above the fill
     dialog with `doc`, `csv`/`csvStatus`/`csvRevision`/`prepareRow`/`assets` from
     the same `job`, `runner={getAppJobRunner()}` and `printerStatus` from the
     store. No hand-built print job, no second row source.
   - Open in editor: `saveCopy(...)` → on `null`, error notification
     (`presets.openCopyFailed`); on success `openLabel(copy.meta.id)` and close.
   - Works for a preset with no fields (no form; Print/Open still available) and
     keeps the preview updating when the user clears an input (empty → fallback
     via the P2 rule).
4. `src/components/gallery/PresetCard.tsx`
   - Art becomes a `<button>` that calls `onOpen(id)` (aria-label
     `presets.open`), matching `LabelCard`'s open affordance; delete stays a
     sibling button (never nested).
5. `src/components/gallery/PresetSection.tsx`
   - Owns `fillId: string | null`; passes `onOpen` to the cards and renders
     `<FillPresetDialog open={fillId !== null} presetId={fillId} onClose={...} />`.
6. `src/i18n/locales/en.json` (single writer)
   - `presets.open` ("Fill in {{name}}"), `presets.fillHint` (one short line
     above the form), `presets.preview` ("Preview with your values"),
     `presets.print` ("Print"), `presets.openInEditor` ("Open in editor"),
     `presets.cancel` ("Cancel"), `presets.loading` ("Loading preset…"),
     `presets.loadFailed` ("Could not load this preset."),
     `presets.openCopyFailed` ("Could not open a copy in the editor."),
     `presets.noFields` ("This preset has no fields. Print it as it is.").
     Reuse existing keys for field/size copy where they already exist.

## Out of scope

- No CSV row-by-key (P6), no save-filled-copy (D3), no preset editing in place.
- No new trust semantics (the shared gate + prompt apply unchanged).
- No new renderer, no quantized preview, no geometry/print-setting editing
  (the dialog prints the preset's stored settings).
- No card thumbnails work (P3's backfill already covers it).

## Tests

- `src/editor/presetFields.test.ts`: order + dedupe across text/qr/barcode/code;
  empty names ignored; static/csv/template sources ignored; no nodes → `[]`.
- `src/components/print/usePrintJob.test.tsx`: the `doc` option resolves that
  document (not `state.currentDoc`) and `fields` still reach `prepareRow`; a
  `null` doc leaves the hook inert.
- `src/components/gallery/FillPresetDialog.dom.test.tsx` (mock
  `../../editor/render/docThumbnail` — happy-dom has no canvas): one input per
  distinct field name with the fallback as placeholder; typing a value updates
  the preview call's `overrides` (field binding resolves to the typed value) and
  the preview image; clearing returns the fallback; "Open in editor" creates a
  `kind:'label'` copy with the bindings intact (real memory repo) and opens it;
  a load failure shows the error state; no-fields preset still offers Print.
- `src/components/gallery/PresetSection.dom.test.tsx`: clicking a card opens the
  fill dialog for that preset; delete still deletes without opening it.
- `src/components/gallery/PresetCard` (via the section test or its own): the
  open affordance is a real button with an accessible name; delete is a sibling.
- Print consistency: in the dialog test, assert the `PrintDialog` receives the
  same `prepareRow`/`fields` source as the preview (one `job`), not a second
  resolution path.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/editor src/components/gallery src/components/print`
  (Windows bun binary from global memory; never write its path into a file)
- Full `bun run test:run` before reporting done.
- Owner-only, after the phase: one hardware print of a filled preset (not
  automatable here).

## Envelope reminders

- Public repo: no absolute machine paths in any file.
- One `en.json` writer (this phase). Typed `t()` keys catch stale references.
- Global window listeners must bail on an open `dialog[open]`; the dialog here is
  the shared `Modal` (native top layer), and StrictMode replays effects twice.
- No commit, no `git stash`, no destructive git. Depth 1: do not delegate.
  Missing info → terminal `needs-info. q: … . hint: … . next: …`.
