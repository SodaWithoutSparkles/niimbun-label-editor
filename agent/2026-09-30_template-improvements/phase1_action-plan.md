# T1 — Foundation Kit · Action Plan

**Phase:** T1 of T4 · **Depends on:** nothing (first phase) · **Blocks:** T2, T3, T4
**Reviewer:** `review` (foundation phase — typed-key config is the fragile part, not mechanical)
**Commit:** one commit, on `main`, subject `feat(i18n): add i18n foundation, cn() helper, and form control kit`

## Exit criteria (from plan.md T1)

1. `tsc && vite build` green.
2. Exemplar screens (FileMenu, BottomBar) render translated strings.
3. Autocomplete on `t()` keys works — i.e. keys are **typed**, a bogus key is a `tsc` error.

## Scope — GENERIC TEMPLATE ONLY

This repo is `ui-template`. Every artifact here is cherry-picked upstream. Nothing label-editor-specific, ever.

## Work items

### C1 — Config + deps + `cn()` (small-coder)

1. `.gitignore` — append, under a `# Agent runs` comment:
   ```
   agent/*/state.md
   ```
2. `tsconfig.json` — add `"resolveJsonModule": true` to `compilerOptions`. `include` already covers `src`.
3. Add deps with bun (NOT npm):
   ```
   cd label-editor
   bun add i18next@^26.4.2 react-i18next@^17.0.15
   ```
   Verify both land in `dependencies` of `package.json` and in `bun.lock`.
4. New `src/utils/cn.ts`:
   ```ts
   import { clsx, type ClassValue } from 'clsx'
   import { twMerge } from 'tailwind-merge'

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs))
   }
   ```
   `clsx` already default-imported elsewhere; keep this helper's import style named + `type` (verbatimModuleSyntax requires `type` on `ClassValue`).

### C2 — i18n scaffold (general)

Verified recipe (scout 2026-09-30, i18next 26.4.2 — `enableSelector: false` is the shipped default, so plain string-key `t()`):

1. New `src/i18n/locales/en.json` — **bare-key JSON** (the catalog at top level, not wrapped in a `translation` key). Sections for this phase: `fileMenu`, `bottomBar`, `keyLabels`, `toolHints`. C3 will extend it.
2. New `src/i18n/index.ts`:
   ```ts
   import i18n from 'i18next'
   import { initReactI18next } from 'react-i18next'
   import en from './locales/en.json'

   export const defaultNS = 'translation'

   i18n.use(initReactI18next).init({
     resources: { en: { translation: en } },
     lng: 'en',
     fallbackLng: 'en',
     defaultNS,
     interpolation: { escapeValue: false },
     react: { useSuspense: false },
   })

   export default i18n
   ```
   The shape `resources: { en: { translation: en } }` is load-bearing — wrong shape makes `t()` echo raw keys.
3. New `src/@types/i18next.d.ts` — typed keys. `include: ["src"]` already picks it up:
   ```ts
   import 'i18next'
   import type en from '../i18n/locales/en.json'

   declare module 'i18next' {
     interface CustomTypeOptions {
       defaultNS: 'translation'
       resources: { translation: typeof en }
     }
   }
   ```
   `import type` is required (`verbatimModuleSyntax`). The file must be a module (it has a top-level import), otherwise `declare module` would be an ambient/global override and silently fail.
4. `src/main.tsx` — add `import './i18n'` immediately after the existing `import './index.css'` (line 4). No `<Suspense>` needed — `useSuspense: false`.

### C3 — Form kit (general) — `src/components/common/forms/`

Four small, generic, presentation-only controls. **No hardcoded UI strings** — every visible label comes from props. That means this item touches no JSON and no i18n.

- `Input.tsx` — text input; props: `value`, `onChange(value: string)`, plus passthrough (`placeholder`, `disabled`, `type`, `className`, `id`).
- `Select.tsx` — native `<select>`; props: `value`, `onChange(value: string)`, `options: { value: string; label: string }[]`.
- `Toggle.tsx` — switch; props: `checked`, `onChange(checked: boolean)`, `disabled`. `role="switch"` + `aria-checked`; `type="button"`. Not a checkbox in disguise.
- `SettingRow.tsx` — label + optional description + control slot; props: `label`, `description?`, `children`, `htmlFor?`. This is the row primitive T3's settings sections build on.

All four use `cn()` from C1. **Match the existing dark palette exactly** — read `src/components/layout/LeftSidebar.tsx` and `src/components/common/PopoverSlider.tsx` first and reuse their colour tokens (`bg-gray-700`/`bg-gray-800`, `border-gray-600`, `focus:ring-*`, `text-gray-*`). Do not invent a new look, do not add a `Button` (not in scope — T2 owns dialog buttons).

Also: add a barrel `src/components/common/forms/index.ts` re-exporting the four.

### C4 — Exemplar migration: FileMenu + BottomBar (small-coder)

Depends on C2. Full string inventory is in §Appendix (verified by recon, file:line exact). C4 **may** edit `src/i18n/locales/en.json` (C2 is finished by then).

Rules:
- Every string in the appendix goes through `t()`. Use `useTranslation()` in the component; do not pass `t` around as a bare function reference (plan risk: future i18next v27 selector migration).
- Interpolation, not concatenation: `t('bottomBar.lastSaved.secondsAgo', { count: seconds })`.
- `keyLabels.*` covers `Ctrl/Alt/Shift/Esc/Space` (BottomBar:34-38) — keycap labels are user-visible and locale-dependent, so they migrate too.
- **Out of scope:** the raw `{activeTool}` enum display (BottomBar:125,128). Tool *names* are T4's job — do not add `tools.*` keys.
- **Out of scope:** `MenuItem.tsx:28` `'✓'` — a glyph, not a string.
- **Do not** touch the hand-rolled relative-time branch logic — it stays as-is in T1 (T4 replaces it with `Intl.RelativeTimeFormat`). Just route its output strings through `t()`.
- Keep `title=` attributes migrated to `t()` too (BottomBar:157,182).
- Do not refactor the components beyond the string swap. `clsx` usage stays.

## Appendix — verified string inventory

### `src/components/layout/header/FileMenu.tsx`
`:39` `File` · `:43` `New Project` · `:44` `Open Project` · `:46` `Save Project (in-place)` / `Save Project` (conditional) · `:50` `Save Project As...` · `:52` `Auto-save` · `:57` `Export as Image...`

### `src/components/layout/BottomBar.tsx`
- `:34-38` keycap labels `Ctrl` `Alt` `Shift` `Esc` `Space`
- `:45-51` auto-save full: `Auto-save off` / `Auto-save on` / `Auto-saved just now` / `Auto-saved {n}s ago` / `Auto-saved {n}m ago`
- `:55-64` last-saved full: `Last saved: —` / `Last saved: just now` / `Last saved: {n}s ago` / `{n}m` / `{n}h` / `{n}d`
- `:68-78` auto-save compact: `Off` / `On` / `Just now` / `{n}s ago` / `{n}m ago` / `{n}h ago` / `{n}d ago`
- `:82-91` last-saved compact: `Not saved` / `Just now` / `{n}s ago` / `{n}m ago` / `{n}h ago` / `{n}d ago`
- `:97-112` tool hints (select / rectangle / ellipse / callout / line / arrow) — each interpolates a modifier key label
- `:136` `({x}, {y}, {scale}%)` · `:140` `Zoom:` · `:142` `X:` · `:143` `Y:`
- `:157` `title="Toggle auto-save"` · `:182` `title="Reset view to center"` · `:185` `Home`

## Execution order

```
C1 (config+deps+cn)  ──┬─► C2 (i18n)
                       └─► C3 (form kit)      [C2, C3 parallel]
                                │
C2 ─────────────────────────────┴─► C4 (exemplar migration)
```

## Verification

1. `bun run build` (= `tsc && vite build`) — must be green. Exit criteria 1.
2. Typed-key proof: temporarily insert `t('this.key.does.not.exist')` and confirm `tsc` **errors**, then remove. Exit criteria 3. (Report the error text as evidence.)
3. `grep` for remaining hardcoded strings in the two migrated files — expect only the `{activeTool}` enum passthrough.
4. `bun run dev` + browser smoke: header File menu opens and reads translated English; bottom bar status + tool hint render correctly; no console errors. Exit criteria 2.

## Review

`review` — focus points:
- `resources: { en: { translation: en } }` shape + bare-key JSON (key-echo failure mode).
- `src/@types/i18next.d.ts` is a module and actually augments `CustomTypeOptions`.
- No `t` passed as a bare function reference.
- Form kit matches existing palette; no new UI strings introduced.
- `escapeValue: false` — confirm nothing routes `t()` output into `innerHTML`/`dangerouslySetInnerHTML`.
- `noUnusedLocals` + `verbatimModuleSyntax` compliance.

## Rollback

Single commit; `git revert` if T2 exposes a bad i18n shape.
