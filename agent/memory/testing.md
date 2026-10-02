# Testing

In-process tests exist so logic verification does not need a browser.

## Stack

`vitest` + `happy-dom`, configured in `vitest.config.ts` (merges `vite.config.ts`
via `mergeConfig`). Explicit `import { describe, it, expect } from 'vitest'` — no
`globals: true`, so `tsconfig.json` needs no change. `src/test/setup.ts` wires
`@testing-library/jest-dom/vitest` and clears `localStorage` after each test.

- `bun run test` (watch) / `bun run test:run` (one-shot). **Never `bun test`** — that
  runs Bun's own runner, not Vitest.
- `vite` is aliased to `rolldown-vite@7.2.5` via `overrides`; Vitest 5 supports it and
  the override is what makes it resolve. **Keep `@vitejs/plugin-react` on 5.x** (6.x
  peers Vite 8 and breaks).
- Tests live in `src/**/*.{test,spec}.{ts,tsx}` and ARE typechecked by `tsc` in the
  build — keep them clean under `noUnusedLocals/Parameters`.

## What can / cannot be tested here

- **Unit-testable:** store slices, reducers, `localStorage` persistence/migration,
  i18n key resolution, `Intl`, pure utils, and React DOM via Testing Library.
  `happy-dom` implements `<dialog>.showModal()/close()` (jsdom does not).
- **Browser-only (keep as real-browser checks):** Popover API
  (`showPopover`/`hidePopover`, `:popover-open`, top-layer ordering) — neither
  engine implements it; `<dialog>` `cancel`/Escape semantics, top-layer stacking,
  real focus trap/inert, Konva canvas rendering, layout/CSS, `getBoundingClientRect`.

## Gotcha

This Vitest runner (Node 24 / Bun) rejects a raw `ArrayBuffer` write chunk for
`DecompressionStream`; production browsers accept it. Tests that exercise the
gzip path adapt that one platform primitive rather than changing app code
(see `saveFileRoundTrip.test.ts`).
