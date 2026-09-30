# T3 — Settings Window · Action Plan

**Phase:** T3 of T4 · **Depends on:** T2 (`4e09553`) · **Blocks:** T4
**Reviewer:** `review-alt` (primary `review` is region-blocked — see state.md)
**Commit:** one commit on `main` — `feat(settings): settings window with a versioned persisted preferences store`

## Exit criteria (from plan.md T3)

1. Settings opens from the menu **and** `Ctrl/Cmd+,`.
2. Old preferences survive a reload (all 5 legacy keys migrated).
3. Reset-to-default works.
4. Language switches live.
5. `ShortcutConfigModal` deleted.

## Deviations / decisions forced by recon (reviewers: read this first)

- **D-a · `colors` stays in `colorsSlice`; only its *persistence* unifies.** The plan said to absorb `colors` into the settings store. Recon shows it is **selection-entangled**: `colorsSlice.setColors` mutates `objects` / `past` / `future` when something is selected, `canvasSlice` reads `state.colors` in 9 places for selection-time colour sync, and `projectSlice.loadProject` restores `...data.colors`. Relocating the field would drag all of that along for no benefit. The **ground rule** ("one persisted store, `storage.ts` retires") is satisfied by moving all four preferences into a single `persist` config with one key — field ownership is irrelevant to that, and because zustand flattens slices, ownership is invisible to every consumer anyway. `colorPresets` / `selectedPresetIndex` were **never persisted** and are project-file data — they stay untouched.
- **D-b · `ToolSettingsModal` survives.** The plan's delete list names only `ShortcutConfigModal` and `storage.ts`. `ToolSettingsModal` is a deliberately modeless quick-access panel (reached by clicking the active tool again) and is not a dialog, so T2's "one dialog implementation" rule does not apply to it. It keeps working, editing the same `toolSettings` fields as the new Tools section.
- **D-c · The 4 legacy keys are read once, folded in, then deleted — but the read and delete are extracted into a pure, injectable function.** The plan's risk table says "read-old → write-new → delete-old, one pass; review checks each of the 5 keys", and calls losing user prefs out a top risk. A migration that can only be exercised in a browser is not reviewable, so the legacy read/delete must live in a plain function taking a `Storage`-like object. That makes all five keys headlessly testable.
- **D-d · Strings are extracted in T3 for everything T3 writes**, per the rule established in T2. `ShortcutConfigModal`'s ~30 hardcoded strings get migrated as part of absorbing it; `OptionsMenu`'s hardcoded `Options` / `Keyboard Shortcuts...` labels too (they are being edited anyway). T4 keeps the remaining sweep.

## Target architecture

### One store, one key, one version

Root `useStore` currently has **no middleware at all** — `create<AppState>((set, get, store) => ({...slices}))`. Add `persist` around it:

```ts
persist(initializer, {
    name: 'ui_settings',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({
        autoSave: s.autoSave,
        keyboardShortcuts: s.keyboardShortcuts,
        toolSettings: s.toolSettings,
        colors: s.colors,
        language: s.language,
    }),
    migrate: (persisted, fromVersion) => …,   // future shape changes
})
```

- **`partialize` is load-bearing**: without it, zustand persists the entire flattened state — including `objects`, `past`/`future` history and `fileHandle` — into localStorage. That would be a serious regression. Only the five preference fields may be persisted.
- `version: 1` + a `migrate` that returns the persisted state unchanged today, so the seam exists for T4+.

### New `src/store/slices/settingsSlice.ts`

Owns the preference **fields and actions**, moved out of `preferencesSlice` / `toolsSlice`:
- `autoSave`, `toggleAutoSave` (from `preferencesSlice`)
- `keyboardShortcuts` + `setModifyKey` / `setCancelKey` / `setTextSaveShortcut` / `setToolShortcut` (from `preferencesSlice` — note there is no separate shortcuts slice)
- `toolSettings`, `setToolSettings` (from `toolsSlice`)
- **new** `language: 'en'` + `setLanguage`
- **new** `resetSettings()` — restores `autoSave`, `keyboardShortcuts`, `toolSettings`, `colors` and `language` to `storeDefaults` values.

Because slices are spread flat into one store, moving a field between slice **files** is invisible to consumers — every `useStore(s => s.autoSave)` keeps working. Do **not** rename any state key or action; the blast radius is long and there is nothing to gain.

**Stays put:** `lastAutoSaveAt` (runtime, not a preference), `isExportModalOpen`, `history` / `historyUndoCount` (`preferencesSlice` is misnamed — it is really "misc"), `activeTool`, `showToolSettings`, and everything colour-related except the `colors` object's persistence.

### Legacy migration (`storage.ts` dies)

`src/store/storage.ts` (53 lines) and `STORAGE_KEYS` are deleted. In their place a small module exporting an **injectable** function, e.g.:

```ts
export const LEGACY_KEYS = {
    keyboardShortcuts: 'ui_keyboard_shortcuts',
    autoSave: 'ui_auto_save',
    toolSettings: 'ui_tool_settings',
    colors: 'ui_colors',
} as const;

/** Reads the four legacy keys and returns what was found. Pure — no side effects. */
export const readLegacyPreferences = (storage: Storage): Partial<…> => …

/** Removes the legacy keys once the new store owns the data. */
export const clearLegacyPreferences = (storage: Storage): void => …
```

Wiring, in order:
1. Store is created; the settings slice's initial values come from `readLegacyPreferences(localStorage)` where present, else from `storeDefaults`.
2. `persist` rehydrates from `ui_settings` — persisted values **win** over the legacy ones (the new store is authoritative).
3. Once rehydration has completed, `clearLegacyPreferences(localStorage)` removes the four old keys.
4. **Guarantee the new key is actually written** — zustand only writes on a `set`, so a first run that changes nothing would delete the legacy keys without ever creating `ui_settings`, silently losing preferences on the next load. Force a flush after rehydration (an explicit `setState`), and verify it.

Do **not** touch `colorPresets` (never persisted) and do not invent new unregistered keys.

## Files

**New:** `src/store/slices/settingsSlice.ts`, `src/store/legacyStorage.ts` (name it as you see fit), `src/components/settings/SettingsModal.tsx`, section components (`GeneralSection`, `ShortcutsSection`, `ToolsSection` as fits), `src/components/settings/types.ts` (the `SettingsSection` / `SettingsTab` descriptors).
**Modified:** `src/store/useStore.ts`, `storeTypes.ts`, `slices/preferencesSlice.ts`, `slices/toolsSlice.ts`, `src/components/layout/header/OptionsMenu.tsx`, `src/components/layout/Header.tsx`, `src/components/common/KeyboardShortcuts.tsx`, `src/i18n/locales/en.json`, `src/i18n/index.ts` (apply persisted language at init).
**Deleted:** `src/store/storage.ts`, `src/components/common/ShortcutConfigModal.tsx`.

## The shell — port `web-consoles/SettingsModal.tsx`

Recon has the exact source. Port faithfully, rebuilt on the **T2 `Modal`** (do not hand-roll a second overlay):

- `SettingsSection { id, label, icon, content?, tabs? }` and `SettingsTab { id, label, content }` — same shape as the reference.
- Icon sidebar, `w-1/5` collapsing to `w-14` under 850px (`max-[850px]:w-14`, labels `max-[850px]:hidden`, `title` tooltip retained).
- Tab row only when the active section has `tabs`; `role="tablist"` / `role="tab"` / `role="tabpanel"` with `aria-selected`, `aria-controls`, `aria-labelledby`.
- **Roving tabindex** (`tabIndex={active ? 0 : -1}`) and arrow keys `ArrowRight` / `ArrowLeft` / `Home` / `End`, focus moved imperatively, `preventDefault` on handled keys.
- Switching section resets the tab selection so the new section falls back to its first tab.
- **Sizing:** the reference is `w-[75vw] h-[80vh]`. `Modal` is `h-fit max-h-[85vh]` with the caller's `className` merged last, so pass `className="w-[75vw] h-[80vh]"` — verify via tailwind-merge ordering that the explicit height wins over `h-fit`.
- Escape / backdrop / focus-trap / StrictMode come from `Modal` — do not reimplement any of it. (T2's `Modal` was browser-verified for all of these; see state.md.)

## Sections

- **General** — language `Select` (`en` only, but the list is data-driven so adding a locale is a one-line change) + an `autoSave` `Toggle` via the `SettingRow` primitive; both drive the settings store. The language change must call `i18n.changeLanguage(value)` live, and the store's `language` is the source of truth (re-apply it at i18n init in `src/i18n/index.ts` so it survives a reload).
- **Shortcuts** — the absorbed `ShortcutConfigModal` content (Drawing Modifiers, Tool Shortcuts, Editing), reusing the existing capture-input behaviour verbatim. Delete `ShortcutConfigModal.tsx` and its mount in `Header.tsx`.
- **Tools** — **tabbed** (`Shape` / `Text`) to exercise the tab pattern, editing the same `toolSettings` fields the modeless `ToolSettingsModal` edits.
- **Footer** — a global "Reset to default" action, confirmed through the T2 `ConfirmDialog` (`danger: true`), calling `resetSettings()`.

Build the controls from the T1 form kit (`Input` / `Select` / `Toggle` / `SettingRow`). **Note:** the kit's input styling (`border-gray-600 bg-gray-800`) differs from the ad-hoc classes in `ShortcutConfigModal` / `ToolSettingsModal` (`border-gray-700 bg-gray-900`). Migrating to the kit will visibly shift those controls — that is intended and is the point of the kit, but call it out in the receipt so the reviewer does not read it as an accident.

## Entry point

- `OptionsMenu`: add a `Settings…` `MenuItem` above the existing `Keyboard Shortcuts...` entry, reusing the `h-px bg-gray-700 my-1` divider pattern. Keep or remove the `Keyboard Shortcuts...` item — removing it is cleaner (the content now lives in Settings) but is a UX call; **default to removing it** and say so in the receipt.
- `Header`: a `showSettings` state + `<SettingsModal>` mount alongside the others.
- `KeyboardShortcuts.tsx`: add a `Ctrl/Cmd+,` binding. Recon confirms this file owns the single window-level keydown listener with a typing guard (`INPUT`/`TEXTAREA`/`isContentEditable` early-return) — put the new binding **above** the tool-shortcut block, in the modifier-key section, and `preventDefault()`. Verify `,` alone does not collide with any tool shortcut.

## Catalogue

`en.json` gains a `settings.*` namespace (none exists today). Every new string goes through `t()`, and the typed-key augmentation means a typo is a `tsc` error. All copy from `ShortcutConfigModal` and `ToolSettingsModal` being migrated must stay **byte-identical**.

Note for reviewers: `keyLabels.*` already exists (Ctrl/Alt/Shift/Esc/Space) — reuse it, do not duplicate.

## Execution order

```
S1 (settingsSlice + persist + legacy migration + storage.ts delete)   ─┐ parallel:
S2 (SettingsModal shell + OptionsMenu entry + Header mount +           │ disjoint files,
    Ctrl/Cmd+, binding)                                                │ S1 touches no i18n
        │                                                              ┘
        └─► S3 (three sections + ShortcutConfigModal deletion + catalogue)
                    │
                    └─► verification → review
```

S3 runs last: it owns `en.json` and `ShortcutConfigModal`'s content. S1 and S2 may run in parallel only if S1 touches no `en.json` and no component file.

## Verification

1. `bun run build` green.
2. `grep -rn "localStorage" src/` → only the single `createJSONStorage` call and the legacy helper. No stray keys.
3. `grep -rn "STORAGE_KEYS\|storage'" src/` → clean; `src/store/storage.ts` gone.
4. `grep -rn "ShortcutConfigModal" src/` → zero.
5. `grep -rn "changeLanguage" src/` → the language wiring.
6. **Headless migration test (required).** Using a fake in-memory `Storage`, assert:
   - each of the 4 legacy keys is read and folds into the right field (`ui_auto_save` false, a custom shortcut set, custom `toolSettings`, custom `colors`);
   - after rehydration the legacy keys are deleted;
   - a persisted `ui_settings` **wins** over legacy values when both exist;
   - a second load with legacy keys already gone still has the preferences (i.e. the new key was really written).
   Report the actual assertion output.
7. `Ctrl/Cmd+,` opens Settings; Escape closes it.

## Review focus

Ship the reviewer: the persist config verbatim, the migration helper + its test output, the grep evidence, and the full old `ShortcutConfigModal` next to the new Shortcuts section so the copy can be diffed. Reviewer cannot run commands (state.md) — the parent supplies all command output.

Rule specifically on: whether `partialize` truly excludes all non-preference state (an accidental full-state persist is the worst possible outcome here); whether the migration order can lose preferences on a first run that changes nothing; whether any state key or action signature was accidentally renamed; and whether the tabs meet the ARIA tab pattern the reference established.

## Risks

| Risk | Mitigation |
|---|---|
| `partialize` omitted/wrong → whole canvas + history persisted to localStorage | Explicit verification step; reviewer checks it first |
| Legacy keys deleted before the new key is written → prefs lost on next load | Forced flush after rehydration + headless test case 4 |
| A moved field silently renamed → runtime `undefined` in a consumer | No renames permitted; `tsc` covers the typed surface |
| `persist` rehydration timing vs. `ChangeLanguage` at i18n init | Apply language from the store on rehydration, not just at import |
| Kit styling shifts `ShortcutConfigModal`/`ToolSettingsModal` controls | Expected and intended; flagged in the receipt, not a defect |
