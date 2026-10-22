# P3 — Autosave write tracking + label delete (#1)

## Goal

Give labels the delete affordance the tour copy already promises, without
exposing the resurrection race: an autosave whose debounce fired but whose
`repo.save()` is still in flight must be awaited before `repo.remove()`.

## Deliverables

### 1. `src/store/slices/editorSlice.ts` — track every autosave write

Add one closure-scoped chain next to the existing autosave fields:

```ts
/**
 * Every autosave write started so far, serialized. The debounce timer alone is
 * not enough: once it fires, the write is in flight and `flushAutosave` could
 * not see it, so a delete could complete first and the late write would
 * recreate the label (must-fix: delete-before-save inversion).
 */
let autosaveWrites: Promise<void> = Promise.resolve();
```

Timer fire (`scheduleAutosave`) — replace `void saveDoc(pending, repo);` with:

```ts
autosaveWrites = autosaveWrites.then(() => saveDoc(pending, repo));
```

`flushAutosave` — await the chain, including a still-scheduled doc:

```ts
const flushAutosave = (): Promise<void> => {
    const pending = pendingAutosaveDoc;
    cancelAutosave();
    const state = get();
    if (pending && state.autoSave && state.labelRepo) {
        const repo = state.labelRepo;
        autosaveWrites = autosaveWrites.then(() => saveDoc(pending, repo));
    }
    // Resolves once every write started up to this call has settled. Writes
    // scheduled later chain after this snapshot.
    return autosaveWrites.then(() => undefined);
};
```

Update both JSDoc comments (they currently describe `flushAutosave` as seeing
only the debounce). Do **not** change the `autoSave` / `view` gates, the debounce
delay, or `saveDoc`'s never-reject contract. Chain, never replace, the tail: a
naive "await the last promise" would drop a newer write.

### 2. `src/store/slices/docSlice.ts` — navigate home when the open doc is deleted

In `deleteLabel`, after the `currentDoc` is cleared and only when
`closingCurrent`, call `get().setView('gallery')`. `setView` also closes the
print dialog. Keep `refreshGallery()` last.

Rationale: today `view` stays `'editor'` with `currentDoc === null`, so the store
and the URL hash diverge (the editor renders empty, `#/editor?doc=…` remains).

### 3. `src/components/gallery/LabelCard.tsx` — delete button

- Add a required prop `onDelete: (id: string) => void`.
- Render a `Trash2` icon button in the existing footer row, **as a sibling of the
  open `<button>`** (never nested — nested buttons are invalid and break clicks).
  Mirror the sizing of the existing disabled quick-print button.
- `aria-label` and `title` = `t('gallery.delete')`, plus `aria-label` may include
  the name; keep it simple and use `t('gallery.delete')`.
- Import `Trash2` from `lucide-react` (already used by `CsvCard`).

### 4. `src/components/gallery/GalleryView.tsx` — wire confirm → delete

```ts
const deleteLabel = useStore((state) => state.deleteLabel);

const handleDelete = useCallback(
    async (id: string) => {
        const summary = gallery.find((item) => item.id === id);
        const name = summary?.name ? summary.name : t('nav.newLabel');
        const ok = await confirm({ danger: true, message: t('gallery.deleteConfirm', { name }) });
        if (!ok) return;
        await deleteLabel(id);
    },
    [gallery, deleteLabel, t],
);
```

Pass `onDelete={(id) => { void handleDelete(id); }}` to each `LabelCard`.
`deleteLabel` already notifies `gallery.deleteFailed` on storage failure.

### 5. `src/i18n/locales/en.json` — gallery keys

Inside `gallery`, next to `deleteFailed`:

- `"delete": "Delete"`
- `"deleteConfirm": "Delete \"{{name}}\"? This cannot be undone."`

### 6. Tests

`src/store/slices/docSlice.test.ts`:
- **The race**: autosave enabled, edit, advance the debounce timer so the write
  starts, make `repo.save` return a deferred promise, call `deleteLabel(id)`,
  resolve the save, then assert `remove` ran **after** the save settled and
  `repo.get(id)` is null (no resurrection).
- Also assert `view === 'gallery'` when the deleted label was the open doc.

`src/store/slices/editorSlice.test.ts`:
- `flushAutosave()` does not resolve until an in-flight `repo.save` settles.
- A newer explicit save still lands after (not before) the older autosave —
  the existing must-fix #8 case must stay green.

`src/components/gallery/LabelCard.test.tsx`:
- renders the delete button and calls `onDelete(summary.id)`;
- the delete button is not inside the open button (assert `closest('button')` is
  the delete button, or assert `getByRole('button', {name:'Open …'})` contains no
  nested button).

`src/components/gallery/GalleryView.dom.test.tsx`:
- confirm dismissed ⇒ `deleteLabel` not called and the card remains;
- confirm accepted ⇒ `deleteLabel` called with the id and the card disappears
  after the gallery refresh.

## Constraints

- Do not touch `useOrphans`, `referenceScan`, `CsvSection`, or `MediaSection`
  (P1/P2 are committed).
- `en.json` is yours this phase; add only the two keys above.
- No new dependencies. 4-space indent, single quotes.
- Careful with `docSlice`'s existing ordering tests — `flushAutosave` must remain
  safe when `autoSave` is false or `labelRepo` is null (return the chain, do not
  append).

## Done when

- `bun run test -- src/store/slices/docSlice.test.ts src/store/slices/editorSlice.test.ts src/components/gallery/LabelCard.test.tsx src/components/gallery/GalleryView.dom.test.tsx` passes.
- `node node_modules/typescript/bin/tsc --noEmit` is clean.
- Receipt lists files, commands, results, deviations.
