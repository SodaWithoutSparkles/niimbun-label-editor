# Repo Memory — label-editor

Label editor for NIIMBOT thermal printers (React 19, TypeScript, Tailwind v4, zustand, Konva), built on the generic ui-template base. Authoritative plan: [`agent/2026-09-29_label-editor-v1/plan.md`](2026-09-29_label-editor-v1/plan.md) (phases P1–P8). Base template is upstream; template fixes land here as cherry-picks — after the P1–P3 strip, cherry-picks into stripped areas will conflict; resolve manually, product wins.

## Area files

- [`i18n.md`](memory/i18n.md) — `react-i18next` setup, bare-key catalog + `resources` shape, typed keys, literal-map for dynamic keys, dev missing-key guard, language wiring.
- [`dialogs.md`](memory/dialogs.md) — shared `Modal` (native `<dialog>` + portal), promise dialog service + settle-once contract, the Tailwind-preflight-vs-UA cascade pitfall.
- [`settings-store.md`](memory/settings-store.md) — persisted zustand store: `partialize`, legacy-key migration order, storage-value validation.
- [`store-and-slices.md`](memory/store-and-slices.md) — flat-slice pattern; move fields without renaming keys.
- [`testing.md`](memory/testing.md) — Vitest + happy-dom setup, `bun run test`, what must stay a browser test.
- [`print-transport.md`](memory/print-transport.md) — `src/core` headless hm math; frozen `PrinterTransport` contract (`src/print`); niimbluelib 0.47.0 verified print flow + adapter gotchas.
- [`niimblue-reference.md`](memory/niimblue-reference.md) — what the niim.blue clone (`references/niimblue/`, gitignored) does, and where our plan beats / should adopt it. Read before P2–P8.

## Agent workflow

- **Parallel fan-out with background subagents.** `subagent` supports `background: true`: it returns immediately with a `sessionID` and wakes the coordinator when the child finishes. Dispatch independent tasks in one turn in background mode, then continue other work — do not poll or sleep. Verify each: the wake-up notification carries the child's final text. Use `sessionID` to resume the same child (e.g. after a `needs-info`).


## Essentials

- **Product strings go through i18n** (plan decision 40): all label-editor UI strings via `t()` with typed keys; dynamic keys via the literal-map pattern (see `i18n.md`).
- **Package manager:** `bun` (binary path in global memory). `bun.lock` is tracked; there is no package-lock.json — never npm.
- **Tests:** `bun run test` (Vitest, in-process). Never `bun test` — that is Bun's own runner. See [`memory/testing.md`](memory/testing.md).
- **Global window listeners must guard on an open modal.** Native `inert` does NOT stop `keydown`/`paste` from bubbling to `window` through a top-layer `<dialog>`. Any global `keydown`/`paste`/`drop` handler must bail with `if (document.querySelector('dialog[open]')) return;` or it will mutate the canvas behind a modal (and `Ctrl+,` will stack dialogs).
- **Build:** `bun run build` = `tsc && vite build`. Repo may be on drvfs (slow) — prefer `tsc` over full rebuilds.
- **tsconfig:** `include: ["src"]`, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `resolveJsonModule`. No path aliases.
- **Tailwind v4** runs via **PostCSS** (`postcss.config.js`); `@tailwindcss/vite` is installed but unwired.
- `<React.StrictMode>` is active — lifecycle effects fire twice; dialog/portal code must be idempotent.
- `cn()` (`src/utils/cn.ts`) = `twMerge(clsx(...))`; use it rather than string-concatenating class names.
- Settings window opens via OptionsMenu or `Ctrl/Cmd+,`; language lives in the settings store and drives `i18n.changeLanguage`.
