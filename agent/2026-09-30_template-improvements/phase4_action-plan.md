# T4 — i18n Sweep · Action Plan

**Phase:** T4 of T4 (final) · **Depends on:** T3 (`89eb6db`) · **Blocks:** nothing
**Reviewer:** `review-alt` (primary `review` is region-blocked — see state.md)
**Commit:** one commit on `main` — `feat(i18n): migrate the remaining UI strings and replace hand-rolled relative time`

## Exit criteria (from plan.md T4)

1. `tsc` green **with strict keys** — a missing/typo key is a compile error.
2. No hardcoded UI strings repo-wide (data like font names excepted).
3. Manual dev-server smoke pass.

## Work order (from recon — ~95 strings across 12 files)

| Area | File(s) | Strings |
|---|---|---|
| A | `header/EditMenu.tsx` | 10 (menu is **entirely** unmigrated: Edit, Undo, Redo, Clone Object, Delete Selected, Move Up, Move Down, Insert Local Image, Insert Remote Image + shortcut hints) |
| B | `RightSidebar.tsx` | ~38 (3 headings, 33 field labels, 4 selects/options, 2 empty states, clear-all chrome, `Undo` title) |
| C | `LeftSidebar.tsx` | 8 tool labels → new `tools.*` namespace |
| D | `canvas/*` | `TextEditorOverlay` placeholder, `DrawingCanvas` notification + drop text + `Pasted image data`, `ShapeRenderer` notification + canvas error/loading text |
| E | `common/*` | `ColorPicker` (4), `DualColorPicker` (7), `PopoverSlider` (5 titles/aria), `NotificationCenter` (1), `ToolSettingsModal` title |
| F | `ErrorBoundary.tsx` | 1 ("Something went wrong.") — **class component**, use `i18n.t()` not a hook |
| G | `Header.tsx`, `MainLayout.tsx` | project-name aria/title, `Loading canvas...` |
| H | `utils/*`, `index.html` | `untitled `, `project`, `Space`, `<title>` |
| I | Relative time | BottomBar's 4 hand-rolled functions → `Intl.RelativeTimeFormat` |
| J | Dev guard | `parseMissingKeyHandler` |
| K | History labels | `canvasSlice`/`projectSlice` → store keys, render through `t()` |

## Decisions (owner-confirmed 2026-10-01)

- **D-a · Tool names are copy.** New `tools.*` namespace (`tools.select`, `tools.rectangle`, …, `tools.textBoxArrow` for "Text Box + Arrow"). The sidebar labels, BottomBar's compact badge and `ToolSettingsModal`'s title all render through it.
  **Critical constraint:** typed keys come from the JSON literal tree, so `t('tools.' + id)` will **not** typecheck. Use a **literal map** instead:
  ```ts
  const TOOL_LABEL_KEYS = {
      select: 'tools.select', rectangle: 'tools.rectangle', /* … */
  } as const;
  ```
  then `t(TOOL_LABEL_KEYS[id])`. This keeps the key union intact. Do **not** widen `CustomTypeOptions`.

- **D-b · History labels store keys, not text.** `canvasSlice`/`projectSlice` currently bake `'Added rectangle'` / `` `Deleted ${n} items` `` into state. Replace with `{ key: 'history.added', params: { type } }` and render via `t(key, params)` in `RightSidebar`.
  - **Save-file impact:** `SaveFile.preferences.history` (`src/types.ts:95`) holds these strings and `projectSlice.loadProject` restores them. Migrating a saved document whose history contains **plain strings** must still render — support both shapes at the render site (a string renders as-is, an object goes through `t()`). Do not silently drop old history.
  - Pluralisation: `Deleted 3 items` → i18next `_one`/`_other` plural forms. `en.json` is currently flat single-form; use `key_one` / `key_other`.

## Out of scope (do NOT do these)

- **Console messages** (15, listed in the recon) — developer output, not UI copy.
- **Font family names** (`Arial`, `Comic Sans MS`, …) — data. Their display *labels* are already migrated (`toolSettings.fontFamilyOptions.*`). `RightSidebar`'s font-family input is free text bound to item data.
- **Extension literals** (`.png`/`.jpg`/`.webp`) and numeral/`px`/`%` readouts — data.
- **`MenuItem`'s `'✓'`** and `NotificationCenter`'s `'✕'` — glyphs.
- **File-picker `description: 'Drawing Project'`** — OS-native dialog chrome.
- `ToolSettingsModal`/`ShortcutConfigModal` styling, the modeless panel's structure, or anything from T1–T3's design.
- **`index.html`'s `<title>`** — static HTML, not rendered copy. Note it as a known limitation (a translated document title would need a runtime effect); do not add one.

## Item I — `Intl.RelativeTimeFormat` (replaces the hand-rolled branches)

Current `BottomBar.tsx` has 4 functions, each with a `seconds < 60 / minutes < 60 / hours < 24` ladder and 18 catalogue keys (`bottomBar.autoSavedSecondsAgo`, `shortMinutesAgo`, …).

Replace the **branching mechanism** with `Intl.RelativeTimeFormat`, per the plan ("no new dep"). Requirements:
- Build **one** `Intl.RelativeTimeFormat` instance memoised against the current language (`useMemo` on `language`), not per render and not per call.
- The `< 5s` → "just now" threshold stays (it is product copy, not relative-time formatting).
- The `Auto-save off/on` and `Not saved` / `Last saved: —` states stay as catalogue keys — they are not relative times.
- **Auto-save and last-saved must not collapse into one function.** They differ: auto-save has no hours/days tier, last-saved does; auto-save prefixes "Auto-saved…", last-saved prefixes "Last saved: …". Preserve that.
- **Full vs compact still differ.** Compact drops the prefix. Keep both.
- Decide the fate of the 18 existing `bottomBar.*` keys: the `short*` family becomes redundant if `Intl` produces the compact form. Where a key is genuinely superseded, **delete it** rather than leaving dead catalogue entries — but do not delete a key still referenced, or `tsc` will not catch it (a dead key is invisible to the type system) and the next phase will find orphans. Report which keys were removed and why.
- **Language:** pass the store's `language` to the formatter so a switch changes the output.

This is the one item with real behaviour risk: the rendered text must remain sensible at each tier. Add a headless table check (see Verification) rather than eyeballing.

## Item J — dev missing-key guard

`src/i18n/index.ts` has no guard. Add `parseMissingKeyHandler` so a missing key is loud in development:
- Only in dev (`import.meta.env.DEV`), never in production — it must not alter shipped behaviour.
- Return something visible (e.g. `⟦missing:key⟧`) and `console.warn` once per key.
- **Rationale to record:** typed keys already make a missing key a `tsc` error in components; this catches the paths types cannot see — dynamic keys, and any key removed from the catalogue while still referenced in a non-literal position.

## Item K — history

Per D-b. Call sites to convert (recon, verbatim):
`canvasSlice.ts:16,29,43,62,86,98,115,132,181,213`, `projectSlice.ts:28,50`. Render site `RightSidebar.tsx:347`.
`RightSidebar.tsx:345`'s `title="Undone"` is separate copy — migrate it as a normal string.

## Execution order

```
W1 (EditMenu + LeftSidebar + tools.* namespace + RightSidebar)      ← the bulk, disjoint files
W2 (canvas/* + common/* + ErrorBoundary + Header + MainLayout + utils)
W3 (BottomBar Intl + history keys + parseMissingKeyHandler + en.json)
```

W3 owns `en.json` and `BottomBar.tsx` and runs last, so the catalogue has one writer. W1 and W2 may run in parallel **only if** neither edits `en.json` — if both need keys, run them sequentially or give each a disjoint namespace and merge. `ErrorBoundary` needs `i18n.t()` (class component) — do not add a hook.

## Verification

1. `bun run build` — green. Cleanup: remove the now-unused `console` noise only if it references a removed helper; otherwise leave console messages alone.
2. **Strict-key proof:** insert `t('definitely.not.a.key')` in a component, confirm `tsc` **errors**, remove it. Paste the error.
3. **Hardcoded-string sweep:** run a grep for JSX text nodes and `label=`/`title=`/`aria-label=`/`placeholder=` values containing letters, across `src/`. Report every hit and annotate each as migrated / data / glyph / console. The residual list should contain only the documented exceptions.
4. **Relative-time table (headless, required):** for both `Auto-save` and `Last saved`, full and compact, at: 0s, 4s, 5s, 59s, 60s, 61s, 3599s, 3600s, 86399s, 86400s, 604800s (7d). Print each rendered string. Assert no `undefined`, no `NaN`, no missing-key marker, and that the tiers are monotonic.
5. **Language switch:** confirm the relative-time output changes when `language` changes (even if only `en` ships, the formatter must be wired to the store's language, not hardcoded).
6. **Missing-key guard:** confirm a missing key renders the marker and warns **in dev**, and that the handler is absent in a production build (`grep` the built bundle).
7. **History:** add/delete/move objects, confirm the history panel reads correctly; then switch language and confirm existing entries re-render in the new language (this is the whole point of D-b); then load a **pre-T4 saved file** whose history holds plain strings and confirm it still renders.
8. **Pluralisation:** assert `_one`/`_other` forms for the counted history entries (1 item vs 3 items).

## Review focus

Ship the reviewer: the strict-key proof, the hardcoded-string grep with annotations, the relative-time table, and the list of catalogue keys deleted. Reviewer cannot run commands (state.md) — the parent supplies all output.

Rule specifically on: whether the `TOOL_LABEL_KEYS` literal-map really preserves the typed-key union; whether any catalogue key was deleted while still referenced; whether the relative-time tiers are correct at every boundary (especially 59→60 and 3599→3600); whether the history key migration can lose or break old saved documents; and whether the dev guard is genuinely production-excluded.

## Risks

| Risk | Mitigation |
|---|---|
| Dynamic `t('tools.'+id)` defeats typed keys | Literal map (D-a); verification step 2 proves types still work |
| Deleting a `bottomBar.*` key still referenced | `tsc` cannot see dead keys either way — grep each removed key across `src/` before deleting |
| `Intl` output drifts at a tier boundary | Explicit boundary table (verification 4) |
| History migration breaks old save files | Render site accepts both shapes; explicit test (verification 7) |
| Two parallel agents both editing `en.json` | W1/W2 must not touch it; W3 is sole writer, or namespaces are disjoint |
| Dev guard leaking into production | `import.meta.env.DEV` + grep the built bundle (verification 6) |
