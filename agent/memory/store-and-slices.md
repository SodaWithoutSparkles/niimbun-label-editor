# Store & slices

Root store: `src/store/useStore.ts` — zustand `create<AppState>()` with all slices **spread flat** into one state object. Each slice is `createXSlice(set, get, api)` returning `Partial<AppState>`; `storeTypes.ts` composes `AppState`.

## Flat slices — what this buys you

Because every slice is spread into one flat object:
- `useStore(s => s.autoSave)` is identical no matter which slice *file* owns `autoSave`. **Moving a field between slice files is invisible to every consumer** — no import changes, no renaming.
- A slice may write fields it does not own as long as it owns the action (`resetSettings` writes `colors`, which `colorsSlice` owns).

## Rule: move fields, never rename keys

When reorganising (e.g. relocating preferences out of `preferencesSlice`/`toolsSlice` into `settingsSlice`), **do not rename any state key or action**. The blast radius across consumers is long and there is nothing to gain. `tsc` covers the typed surface, so a silent rename would only surface as a runtime `undefined`.

`preferencesSlice` is misnamed — it also owns runtime/misc state (`lastAutoSaveAt`, `history`, `isExportModalOpen`, `activeTool`, `showToolSettings`) that must **stay put**; only genuine preferences move.

## Slice conventions

- Import style: `verbatimModuleSyntax` is on, so type-only imports use `import type`.
- Prefer explicit per-slice files under `slices/`; a new concern (settings) gets its own file rather than growing an existing one.
- `persist` wraps the whole store, not individual slices — see `settings-store.md`.

## Autosave writes are chained, not fire-and-forget

`editorSlice` keeps a per-store `autosaveWrites: Promise<void>` chain. Both the
debounce fire path and `flushAutosave` **append** to it (`autosaveWrites =
autosaveWrites.then(...)`); never replace the tail or a newer write is dropped.
`flushAutosave` returns the chain even when `autoSave` is false / `labelRepo` is
null — `setView`, `openLabel`, `saveCurrentLabel` and `deleteLabel` await it so
an in-flight write cannot land after a newer save or after `repo.remove`
(the label-delete resurrection race).
