# Template Improvements — Authoritative Plan

**Status:** FINAL (Phase 0 complete). Handoff to `coordinator`.
**Date:** 2026-09-30
**Owner:** Build (CTO) → Coordinator.
**Blocking:** label-editor v1 plan (P1 starts on the improved template).

## Sources (authoritative order)

1. Template survey 2026-09-30 (`ses_(redacted)`) — structure map, string handling, storage audit, gaps.
2. web-consoles settings survey 2026-09-30 (`ses_(redacted)`) — portable shell anatomy, verdict on what to port.
3. i18n dependency verification 2026-09-30 (`ses_(redacted)`) — pinned versions, init + typed-key recipes, gotchas.
4. Owner decisions 2026-09-30 (see Decisions log).

## Goal

Improve the UI template **generically** — nothing label-editor-specific. Four deliverables:

1. **i18n** — `react-i18next`, typed keys, every UI string migrated.
2. **Settings window** — web-consoles shell ported and generalized: section sidebar, optional tabs, keyboard nav, reusable setting controls, versioned persisted store, reset-to-default.
3. **Shared dialog system** — one `Modal` on native `<dialog>` + portal; `ConfirmDialog`/`PromptDialog` replace native `alert`/`confirm`/`prompt`.
4. **`cn()` + form kit** — use the installed-but-unused `tailwind-merge`; shared `Input`/`Select`/`Toggle`/`SettingRow`.

**Full migration is in scope:** HelpModal, ShortcutConfigModal (→ settings section), the imperative export modal, and every `alert`/`confirm`/`prompt` call migrate now. No old system survives alongside the new one.

## Non-goals (parking lot)

Theming tokens / light-dark mode, test/lint/CI infra, README/identity/favicon, a11y sweep beyond what native `<dialog>` gives, settings search filter, extra locales (ship `en` only, structure ready for more). Canvas/drawing demo code stays — it is the template's demo app; migrate its strings and dialogs, do not redesign it.

## New dependencies (verified on npm 2026-09-30)

| package          | version  | notes                                                                                                    |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `i18next`        | ^26.4.2  | `enableSelector: false` is the shipped default — **string-key `t()` API** (docs claim is aspirational)     |
| `react-i18next`  | ^17.0.15 | peer `react >= 16.8.0`, `i18next >= 26.2.0`; React 19 supported, no open blockers                          |

No other packages. No backend plugin, no language detector. Keep `react: { useSuspense: false }` or wrap in `<Suspense>` — single bundled locale makes `false` the lazy choice.

## Ground rules

- Template-only. Zero label-editor features, names, or strings.
- **One dialog implementation.** The settings window uses the shared `Modal` base — do not port web-consoles' dialog code twice.
- **One persisted store.** User preferences live in the settings store only. `storage.ts` + `STORAGE_KEYS` retire after migration. No new unregistered `localStorage` keys.
- All new UI strings go through `t()`. No new hardcoded strings after T1.
- Old localStorage keys are read once, migrated into the settings store, then deleted.

## Phases

Each phase = one coordinator cycle: `phase{N}_action-plan.md` → implement → review (`review`/`review-fast`) → fix (≤2 rounds) → semantic commit → update `state.md`. Phases are strictly sequential — each builds on the last.

| #  | Phase                    | Scope                                                                                                                                                                                                                            | Exit criteria                                                                                                        |
| -- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| T1 | Foundation kit           | `.gitignore` += `agent/*/state.md`; `tsconfig` += `resolveJsonModule`; deps; `src/i18n/` init + typed keys (`src/@types/i18next.d.ts` under include) + `en` catalog skeleton; `src/utils/cn.ts`; form kit `src/components/common/forms/` (Input, Select, Toggle, SettingRow); exemplar migration: FileMenu + BottomBar strings → `t()`         | `tsc && vite build` green; exemplar screens render translated; autocomplete on `t()` keys works                       |
| T2 | Dialog system            | `Modal` (native `<dialog>` + `showModal()` + `createPortal`, Esc, backdrop-pointer-origin close — pattern from web-consoles `SettingsModal.tsx:33-62`); `ConfirmDialog` + promise `confirm()`; `PromptDialog` + `prompt()`; replace `window.confirm` (`Header.tsx:140,150`, `RightSidebar.tsx:366`), `window.prompt`, all `alert()` error popups (`Header.tsx:181,191,226,256,355`, `OptionsMenu.tsx:27`) → themed dialog or NotificationCenter; migrate HelpModal → `Modal`; rebuild export modal as React `ExportModal` on shared `Modal` (keep export logic as pure functions — kill the `useCanvasExport.ts:48-66` DOM injection) | Zero `window.alert/confirm/prompt` refs; zero imperative DOM injection; one dialog implementation repo-wide            |
| T3 | Settings window          | Port web-consoles `SettingsModal` shell — section sidebar + optional tabs + arrow-key tablist + 850px collapse — **built on the T2 `Modal`**; `settingsSlice` + zustand `persist` with `version` + `migrate`; absorb `autoSave`, `keyboardShortcuts`, `toolSettings`, `colors` (+ migrate the unregistered `autosave_project` key, `Header.tsx:110`); reset-to-default (global, confirm via `ConfirmDialog`); sections: General (language select + autosave), Shortcuts (absorb ShortcutConfigModal), Tools (tabbed — exercises the tab pattern); OptionsMenu "Settings…" item + `Ctrl/Cmd+,` shortcut; language setting drives `i18n.changeLanguage` | Settings opens from menu + shortcut; old prefs survive a reload; reset works; language switches live; ShortcutConfigModal deleted |
| T4 | i18n sweep               | Extract every remaining UI string (Header confirm/prompt copy, ErrorBoundary, HelpModal copy, export modal, menus, canvas components, settings sections); BottomBar hand-rolled relative time → `Intl.RelativeTimeFormat`; `parseMissingKeyHandler` dev guard; strict key audit | `tsc` green with strict keys; no hardcoded UI strings repo-wide (data like font names excepted); manual dev-server smoke pass |

## Files affected (summary)

New: `src/i18n/**`, `src/@types/i18next.d.ts`, `src/utils/cn.ts`, `src/components/common/forms/*`, `src/components/common/Modal.tsx` + `ConfirmDialog`/`PromptDialog` + imperative helpers, `src/components/settings/*`, `src/store/slices/settingsSlice.ts`, `src/components/canvas/ExportModal.tsx` (React).
Modified: all layout/header/menu components, BottomBar, ErrorBoundary, HelpModal (migrated), existing slices (prefs move out), `useCanvasExport`, `useStore`, tsconfig, .gitignore, package.json.
Deleted by T3: ShortcutConfigModal, `storage.ts` (+ `STORAGE_KEYS`).

## Risks

| Risk                                                      | Mitigation                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Native `<dialog>` + portal + React 19 StrictMode lifecycle | Port the proven web-consoles pattern faithfully; keyboard smoke test in T2 review                   |
| `t()` echoes keys (wrong resource shape)                  | Follow scout recipe exactly: `resources: { en: { translation: en } }`, bare-key JSON, default import |
| `resolveJsonModule` missing → `tsc` build break            | T1 adds it before first JSON import                                                                  |
| Old-key migration loses user prefs                         | Read-old → write-new → delete-old, one pass; review checks each of the 5 keys                          |
| `escapeValue: false` + user content injection             | React-rendered only; never `t()` into `innerHTML`; note in code review checklist                      |
| i18next v27 selector-API migration (future)               | Isolate all `t()` usage to components; no `t` passed around as raw function refs                    |

## Decisions log (ambiguity → resolution)

| #  | Ambiguity                        | Resolution                                                                                       | Source      |
| -- | -------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| 1  | i18n approach                    | `react-i18next` (vs hand-rolled catalog)                                                          | owner 2026-09-30 |
| 2  | String-key vs selector API       | String-key `t()` — shipped default in 26.4.2; docs claim aspirational                            | scout 2026-09-30 |
| 3  | Settings scope                   | Port + generalize: control kit, typed store, versioning, reset; absorb existing prefs           | owner 2026-09-30 |
| 4  | Extra scope                      | Dialog system + `cn()`/form kit only; theme/test/README/a11y stay out                            | owner 2026-09-30 |
| 5  | Old modals + native dialogs      | Full migration now — nothing additive                                                            | owner 2026-09-30 |
| 6  | Two dialog impls (shell vs port) | One: settings window sits on the shared `Modal` base                                              | CTO (ponytail) |
| 7  | Prefs persistence                | Single `settingsSlice` + zustand `persist` (`version` + `migrate`); retire `storage.ts`           | CTO         |
| 8  | Language switching               | Settings store is source of truth → `i18n.changeLanguage` on change                                | CTO         |
| 9  | Relative time in BottomBar       | `Intl.RelativeTimeFormat` — no new dep                                                           | CTO (ponytail) |
| 10 | ShortcutConfigModal              | Absorbed as Settings "Shortcuts" section; component deleted                                      | owner full-migration |
| 11 | `window.prompt`                  | `PromptDialog` (full migration)                                                                  | owner full-migration |
| 12 | Export modal (imperative DOM)    | React `ExportModal` on shared `Modal`; export logic becomes pure functions                       | CTO         |
| 13 | Settings entry point             | OptionsMenu item + `Ctrl/Cmd+,` only — no header gear button                                      | CTO (ponytail) |

## Impact on label-editor plan (deltas — apply when P1 starts)

The 2026-09-29 label-editor plan stands; update its reuse/strip map:

- **Reuse map grows:** shared `Modal`/`ConfirmDialog`/`PromptDialog`, forms kit, `SettingsModal` + section descriptor pattern, `settingsSlice`, `cn()`, i18n (`t()` for all new UI).
- **ShortcutConfigModal** (listed under reuse) → now the Settings "Shortcuts" section.
- **P6 trust management** ("settings list with revoke/reset") plugs into the template `SettingsModal` as a new section — no bespoke UI.
- **P2 note:** "localStorage autosave drop" refers to the doc autosave *target* moving to IDB; the autoSave *setting* now lives in the settings store.
- P1 vitest addition unchanged. All label-editor UI strings use `t()` from day one.

## Handoff

1. User switches to **`coordinator`** (Tab). Coordinator owns T1–T4 (impl → review → fix → commit per phase).
2. Per-phase action plans live here: `agent/2026-09-30_template-improvements/phase{N}_action-plan.md`; running status in `state.md` (gitignored via T1 `.gitignore` change).
3. Escalations to Build (CTO) only: ground-rule violations, cross-phase calls, review deadlocks (2 fix rounds).
4. After T4: coordinator escalates project-relevant lessons to `agent/memory.md` + `agent/memory/*.md`; then label-editor P1 starts on the improved template.
