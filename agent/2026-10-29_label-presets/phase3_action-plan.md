# P3 — Preset section + gallery surfaces

Run: [`plan.md`](plan.md) (P3 row, D1). Depends on P1 (`9a2d61c`) only.
Run state: [`state.md`](state.md).

## Owner decisions (2026-10-30, this phase)

1. **UI pattern**: reuse the existing gallery patterns — title bar + the same
   card grid/art/delete as `LabelCard`, catalogue-shell spacing. No new design,
   no add button, no search in the presets pane.
2. **Dead "Quick print"**: **removed** in P3 from ordinary label cards. The
   preset card's "Fill & print" action lands in P5 with the dialog — P3 ships no
   dead control.
3. **Partition**: presets are hidden from **both** the Recent grid and the
   sidebar's Recent list.

## Goal

`#/gallery/templates` renders a real "Label presets" pane that shows only
`meta.kind === 'preset'` documents; Recent shows only normal labels; deleting a
preset goes through the existing label-delete contract (confirm + autosave
flush + gallery refresh).

## In scope

1. **Shared card art (no duplication)**
   - Extract `LabelCard`'s art block (thumb → `PlaceholderArt`) into a small
     shared component (e.g. `src/components/gallery/CardArt.tsx`) with the same
     behaviour: `img` when `thumb` exists, outlined placeholder from
     `backingW/H` otherwise, NaN-safe. `LabelCard` uses it; nothing about its
     rendering changes.
2. `src/components/gallery/LabelCard.tsx`
   - **Remove** the disabled Quick print button (and its `Printer` icon import).
     Keep the open button and the delete button exactly as they are.
3. **New `src/components/gallery/PresetCard.tsx`**
   - Preset summary card: same frame/typography/art as `LabelCard`, name +
     size line, **delete** button only (confirm is the caller's job, as in
     `LabelCard`). No open/fill action in this phase (P5), so the card art is a
     **non-interactive** block — do not wrap it in a `<button>` that does
     nothing. Upload/i18n: reuse `gallery.size`, `gallery.previewAlt`,
     `gallery.delete`; name fallback uses `nav.newLabel` like `LabelCard`.
4. **New `src/components/gallery/PresetSection.tsx`**
   - Reads `useStore(state => state.gallery)` and filters
     `summary.kind === 'preset'`; keeps the store's newest-first order.
   - Mounts `useThumbBackfill()` (presets saved before a thumb existed get one).
   - Header: `presets.title`; no add button, no search.
   - States: loading (`gallery.loading`), storage error (reuse the
     `gallery.storageUnavailable*` pair), empty (`presets.emptyTitle` +
     `presets.emptyHint`), ready → card grid with the same classes as
     `GalleryView` (`grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4`,
     scroll area `min-w-0 flex-1 overflow-y-auto bg-gray-900 p-6
     [scrollbar-gutter:stable]`).
   - Delete: `confirm({ danger: true, message: t('gallery.deleteConfirm', { name }) })`
     then **`useStore(state => state.deleteLabel)`** — never a raw repo remove
     (the store owns the autosave-flush/revalidation contract). Failed delete
     surfaces through the store's own notification; open-failure is not a path
     here (no open action).
5. `src/components/layout/MainLayout.tsx`
   - Add the `gallerySection === 'templates'` branch → `<PresetSection />`
     (before the `GalleryView` fallback). Update the header comment.
6. `src/components/gallery/GalleryView.tsx`
   - Partition: `const labels = gallery.filter(s => s.kind !== 'preset')`; use it
     for the empty check and the grid. Loading/storage-error states unchanged.
7. `src/components/layout/NavSidebar.tsx`
   - Recent list filters out presets. Replace the `nav.comingSoon` fallback with
     `presets.sidebarHint` for `templates`; keep the other section hints. Update
     the doc comment (Templates is no longer a placeholder).
8. `src/i18n/locales/en.json` (single writer, this phase)
   - Add `presets: { title, emptyTitle, emptyHint, sidebarHint }`:
     - `title`: "Label presets"
     - `emptyTitle`: "No presets yet"
     - `emptyHint`: "A preset is a label with the data left to fill in. Save one
       from the editor to reuse it."
     - `sidebarHint`: "Your label presets appear in the main pane."
   - **Delete** now-unused keys: `gallery.quickPrint`,
     `gallery.quickPrintUnavailable`, `nav.comingSoon`. (Check no other
     reference survives — `tsc` is the net.)

## Out of scope

- No fill dialog, no print wiring, no `fields` UI (P5).
- No save-as-preset / convert flow, no JsTab "Field" option (P4).
- No URL/viewSlice changes: `'templates'` is already in `GallerySection`,
  `GALLERY_SECTIONS`, the sidebar order and their pinning tests.
- No registry refactor for the section vocabularies (YAGNI; noted in the plan's
  risks).
- No new search/filter UI, no rename interaction, no drag/drop.

## Tests

- `GalleryView.dom.test.tsx`: a preset summary never renders in Recent; a mixed
  gallery renders only the label; an all-presets gallery shows the empty state.
- New `PresetSection.dom.test.tsx`: renders only presets (a label never appears);
  empty state; delete → `confirm` called → record removed via the store
  (`labelRepo` seeded, `deleteLabel` path) → gallery no longer lists it;
  a dismissed confirm deletes nothing.
- New `MainLayout` routing test (happy-dom): `gallerySection: 'templates'` renders
  the presets pane (e.g. its title), and `'recent'` still renders the labels grid.
- New `NavSidebar` test: the Recent list hides presets; the templates section
  shows the presets hint instead of "Coming soon".
- `LabelCard.test.tsx`: update the quick-print expectations — the control is gone
  (assert absence), open/delete still work.
- Keep `urlHash.test.ts` / `useUrlSync.test.ts` templates cases untouched.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/components/gallery src/components/layout src/utils/urlHash.test.ts`
  (Windows bun binary from global memory; never write its path into a file)
- Full `bun run test:run` before reporting done.

## Envelope reminders

- Public repo: no absolute machine paths in any file.
- No commit, no `git stash`, no destructive git. Depth 1: do not delegate.
  Missing info → terminal `needs-info. q: … . hint: … . next: …`.
- i18n: edit `en.json` directly; typed `t()` keys catch a stale reference.
- Product strings only through `t()`; no hard-coded English in components.
