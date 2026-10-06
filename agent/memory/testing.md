# Testing

In-process tests exist so logic verification does not need a browser.

## Stack

`vitest`, configured in `vitest.config.ts` (merges `vite.config.ts` via
`mergeConfig`). Explicit `import { describe, it, expect } from 'vitest'` — no
`globals: true`, so `tsconfig.json` needs no change. `src/test/setup.ts` loads
`@testing-library/jest-dom/vitest` **only when a DOM exists** and clears
`localStorage` after each test.

- `bun run test` (watch) / `bun run test:run` (one-shot). **Never `bun test`** — that
  runs Bun's own runner, not Vitest.
- `vite` is aliased to `rolldown-vite@7.2.5` via `overrides`; Vitest 5 supports it and
  the override is what makes it resolve. **Keep `@vitejs/plugin-react` on 5.x** (6.x
  peers Vite 8 and breaks).
- Tests live in `src/**/*.{test,spec}.{ts,tsx}` and ARE typechecked by `tsc` in the
  build — keep them clean under `noUnusedLocals/Parameters`.

## Test environment — `node` by default, happy-dom opt-in

Vitest's default env is `node` (DOM-less). A test that touches the DOM declares
it on **line 1**:

```ts
// @vitest-environment happy-dom
```

Needs the docblock: anything that renders React (`@testing-library/react`), uses
`document`/`window`/`Konva`/canvas (incl. `installCanvasShim`), or asserts
jest-dom matchers. Must NOT have it: pure logic/data/store/util tests. (Vitest 5
has no `environmentMatchGlobs`; per-file is the mechanism.)

Why: Vitest builds the DOM env **once per test file**. Before this split the
global `happy-dom` was created 105× and took ~50% of tracked time; only ~41 files
actually need it. Default `node` + opt-in removed that hint. `konvaFactory.test.ts`
needs it too — it patches `HTMLCanvasElement` in `beforeAll` and otherwise
silently skips. Keep default `pool` (`forks`) + `isolate`: on the 2-CPU box
`pool: 'threads'` (~43 s) and `--no-isolate` (~75 s) were both slower than forks
(~19–30 s), and `vmThreads` failed 8 files (cross-realm `Class extends undefined`,
missing `CompressionStream`).

## What can / cannot be tested here

- **Unit-testable:** store slices, reducers, `localStorage` persistence/migration,
  i18n key resolution, `Intl`, pure utils, and React DOM via Testing Library.
  `happy-dom` implements `<dialog>.showModal()/close()` (jsdom does not).
- **Browser-only (keep as real-browser checks):** Popover API
  (`showPopover`/`hidePopover`, `:popover-open`, top-layer ordering) — neither
  engine implements it; `<dialog>` `cancel`/Escape semantics, top-layer stacking,
  real focus trap/inert, Konva canvas rendering, layout/CSS, `getBoundingClientRect`.
- **`CompressionStream`/`DecompressionStream` backpressure is browser-only.**
  In a real browser the writable side stalls unless the readable side is being
  consumed, so `await writer.close()` before attaching a reader deadlocks (the
  write promise never settles). happy-dom/Node do NOT reproduce it. **Always
  attach `new Response(stream.readable)…` BEFORE writing.** P2 shipped a
  `repo.save` that hung on this and passed 242 headless tests; only the headed
  check caught it. Regression: `src/utils/compress.test.ts` uses a
  backpressure-faithful `CompressionStream` fake.

## Real-canvas harness (P4/P5)

`src/test/canvasHarness.ts` (`installCanvasShim()`) installs `@napi-rs/canvas` so
Konva + `Konva.Text`/`Konva.Image` rasterize **real pixels** in-process — use it
for render/golden tests. `src/test/canvasHarness.guard.test.ts` forbids product
imports. `@napi-rs/canvas`'s `loadImage` is the reliable way to turn a
shim-generated canvas into a fixture its `drawImage` accepts (napi rejects a
shimmed happy-dom `HTMLCanvasElement`).

Heavy real-canvas tests (`rasterize.test.ts`, `renderLabelPage.test.ts`, the P5
object-engine tests) can exceed Vitest's default 5 s per-test timeout under
full-suite parallel load; `vitest.config.ts` sets `testTimeout: 15000` for this
reason. A timeout there is CPU contention, not a regression — re-run or isolate
before chasing it.

## Gotcha

This Vitest runner (Node 24 / Bun) rejects a raw `ArrayBuffer` write chunk for
`DecompressionStream`; production browsers accept it. Tests that exercise the
gzip path adapt that one platform primitive rather than changing app code
(see `saveFileRoundTrip.test.ts`).
