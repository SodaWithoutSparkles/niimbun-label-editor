# Settings store

One zustand `persist` store. Implementation: `src/store/useStore.ts`, `legacyStorage.ts`, `preferenceValidation.ts`, `slices/settingsSlice.ts`.

## One key, one version

`persist(..., { name: 'ui_settings', version: 1, storage: createJSONStorage(...), partialize, migrate, merge })`.

- **`partialize` is mandatory.** The root store holds canvas `objects`, undo `past`/`future` history, `fileHandle`, notifications, etc. Without `partialize`, zustand writes the *entire flattened state* to localStorage. Only `autoSave`, `keyboardShortcuts`, `toolSettings`, `colors`, `language` may persist. `PersistedSettings` in `preferenceValidation.ts` is the canonical pick.
- `version` + `migrate` exist as a seam; today `migrate` returns the blob unchanged.

## Why `colors` is persisted here but owned by `colorsSlice`

`colors` is selection-entangled (`colorsSlice.setColors` mutates `objects`/history; `canvasSlice` reads it for selection-time sync; `projectSlice.loadProject` restores it). Relocating the *field* would drag all of that along. Because slices are spread flat, ownership is invisible to consumers — so `colors` stays in `colorsSlice` while its persistence lives in the single settings `partialize`. `resetSettings` writes to it anyway (flat state).

## Legacy-key migration

Old keys (`LEGACY_KEYS` in `legacyStorage.ts`): `ui_keyboard_shortcuts`, `ui_auto_save`, `ui_tool_settings`, `ui_colors`. (`autosave_project` is listed for completeness but is a `Header`-owned project blob, **not** a preference — never read or cleared as one.)

Order, in `createAppStore`:
1. Legacy values seed initial state (`readLegacyPreferences`), only where present.
2. `persist` rehydrates `ui_settings` **over** the seed — persisted wins.
3. On finish-hydration, **force a flush** (`store.setState({})`) — zustand only writes on a `set`, so a first run that changes nothing would otherwise delete the legacy keys without ever creating `ui_settings`, losing prefs on the next load.
4. Only then `clearLegacyPreferences` deletes the four keys (each `removeItem` individually guarded).

Pure, injectable `readLegacyPreferences(storage)` / `clearLegacyPreferences(storage)` take a `Storage` so migration is **headlessly testable** against a fake — a browser-only migration is not reviewable. `createAppStore(storage?)` is exported for the same reason.

## Shaping / validating values read from storage

`preferenceValidation.ts` holds shape validators shared by **both** paths (legacy reader and persist `merge`). A present-but-wrong-typed value (e.g. `tools.select = null`) used to poison state and crash at boot; now anything not matching the exact expected shape is treated as "missing" and falls back to default.
- `normalizeKeyboardShortcuts` / `normalizeToolSettings` / `normalizeColors` return a fully-repaired object, or `undefined` when unusable.
- `merge` uses `pickPersistedKeys`: repair the blob, but **only override keys the blob actually carries**. A key absent from the blob must fall through to `current` (the legacy seed), not reset to default. Default shallow merge would replace whole nested objects (`keyboardShortcuts`) and bypass the legacy deep merge.

## Storage robustness (`createSafeStorage`)

`persist` funnels every write through `storage.setItem`; a quota-exceeded / private-mode throw would escape an ordinary interaction. The wrapper **swallows only `setItem`** writes. Reads (`getItem`/`length`/`key`) must surface — never silently become "no preferences". `resolveStorage()` tolerates environments where merely touching `window.localStorage` throws (`SecurityError`), returning `undefined` → zustand's degraded no-storage path.

`createSafeStorage(storage)` returns `{ storage, lastWrite }` and is **exported**. The last-write flag lives in the call's closure, never at module scope: `createAppStore` builds independent stores (tests do it per test), and one shared flag would let store A's flush result gate store B's legacy-key deletion. Only the unit test on `lastWrite` catches this — a behavioural interleaving test cannot, because `setItem`'s own `catch` always overwrites the flag before `finishMigration` reads it.
