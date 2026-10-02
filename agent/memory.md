# Repo Memory — ui-template

Generic React + Vite UI template (React 19, TypeScript, Tailwind v4, zustand, Konva demo app).
**GENERIC ONLY.** This repo is cherry-picked upstream; never add product-specific names, features, or strings.

## Area files

- [`i18n.md`](memory/i18n.md) — `react-i18next` setup, bare-key catalog + `resources` shape, typed keys, literal-map for dynamic keys, dev missing-key guard, language wiring.
- [`dialogs.md`](memory/dialogs.md) — shared `Modal` (native `<dialog>` + portal), promise dialog service + settle-once contract, the Tailwind-preflight-vs-UA cascade pitfall.
- [`settings-store.md`](memory/settings-store.md) — persisted zustand store: `partialize`, legacy-key migration order, storage-value validation.
- [`store-and-slices.md`](memory/store-and-slices.md) — flat-slice pattern; move fields without renaming keys.
- [`testing.md`](memory/testing.md) — Vitest + happy-dom setup, `bun run test`, what must stay a browser test.

## Essentials

- **Package manager:** `bun` (binary path in global memory). `bun.lock` is tracked; `package-lock.json` is stale — never npm.
- **Tests:** `bun run test` (Vitest, in-process). Never `bun test` — that is Bun's own runner. See [`memory/testing.md`](memory/testing.md).
- **Global window listeners must guard on an open modal.** Native `inert` does NOT stop `keydown`/`paste` from bubbling to `window` through a top-layer `<dialog>`. Any global `keydown`/`paste`/`drop` handler must bail with `if (document.querySelector('dialog[open]')) return;` or it will mutate the canvas behind a modal (and `Ctrl+,` will stack dialogs).
- **Build:** `bun run build` = `tsc && vite build`. Repo may be on drvfs (slow) — prefer `tsc` over full rebuilds.
- **tsconfig:** `include: ["src"]`, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `resolveJsonModule`. No path aliases.
- **Tailwind v4** runs via **PostCSS** (`postcss.config.js`); `@tailwindcss/vite` is installed but unwired.
- `<React.StrictMode>` is active — lifecycle effects fire twice; dialog/portal code must be idempotent.
- `cn()` (`src/utils/cn.ts`) = `twMerge(clsx(...))`; use it rather than string-concatenating class names.
- Settings window opens via OptionsMenu or `Ctrl/Cmd+,`; language lives in the settings store and drives `i18n.changeLanguage`.
