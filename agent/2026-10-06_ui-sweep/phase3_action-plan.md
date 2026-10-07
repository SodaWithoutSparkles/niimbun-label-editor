# Phase 3 — real shape styles (#8) (action plan)

- Run: `agent/2026-10-06_ui-sweep/` · Plan: `plan.md` · Baseline: P2 @ `6564c6e` (tsc clean, 1249 tests).
- Commit: semantic `feat(editor): …` at end of phase (coordinator asks first).
- Owner decision #8: **real static style support now** — `fill`/`stroke`/`strokeWidth` honored end-to-end (schema → validate → resolve → BOTH renderers → inspector). Invalid optionals dropped with repair, never fatal.
- **Owner defaults — REVISED 2026-10-08 (supersedes plan.md:19):** default fill = **no fill**, represented as the explicit string **`'transparent'`**; `stroke` default `#374151`; `strokeWidth` default **`50` hm (0.5 mm)** — the original `1 hm` printed at ~0.12 px @300dpi (invisible) and the original white fill was invisible on a white label. This also removed the print-only device-px stroke override, so **preview≡print is now exact** (was divergent for open lines).
- Owner does the visual default check; **no agent headed/browser test**.

## Tasks

| # | Task | Files |
| - | ---- | ----- |
| 8 | Add `fill?`/`stroke?` to `ShapeNode`; validate+repair; resolve defaults into the resolved shape types; render in **both** renderers (preview≡print); wire the inspector fields; i18n; tests | `src/core/doc/types.ts`, `src/core/doc/validate.ts`, `src/core/doc/factory.ts` (+ `insertActions.ts` if it seeds shapes), `src/editor/render/resolve.ts`, `src/components/editor/ResolvedShape.tsx`, `src/editor/render/konvaFactory.ts`, `src/editor/inspectorModel.ts`, `src/components/editor/ObjectTab.tsx` (only if needed), `src/i18n/locales/en.json` (+ tests) |

## Key seams (verified by coordinator)

- `ShapeNode` (`types.ts:92-101`) already has `cornerRadius?`, `points?`, `closed?`; `strokeWidth?` is on `BaseNode` (`:49`).
- `SHAPE_FIELDS` (`inspectorModel.ts:141-156`): `stroke`/`fill` are `kind:'color', wired:false`; `strokeWidth` is `kind:'number', wired:false`; `cornerRadius` `kind:'number', wired:false` with a comment deferring it to this pass.
- `ObjectTab.renderField` already renders `kind:'number'` → `PopoverSlider` (`:564-576`) and `kind:'color'` → `ColorPicker` (`:746-751`), with `setColor(field.key, value)`. So wiring is mostly flipping `wired:true` (+ any default display).
- Preview `ResolvedShape.tsx:117-153`: rect/ellipse/line/polygon draw **stroke-only**, `stroke={strokeOf(selected,warn) ?? '#374151'}`, `strokeWidth={selected ? 2 : 1}`, **no fill**.
- Print `konvaFactory.ts:171-190`: line/polygon/rect/ellipse set **no** fill/stroke → Konva defaults apply. **Preview≡print must be made true by construction** (both renderers read the same resolved `fill`/`stroke`/`strokeWidth`).
- `strokeWidth` is in **hm** (1 hm = 0.01 mm) — verify the default-1 stroke is actually visible at print scale and **report** (owner will visually check).

## Requirements

1. **Schema** — `ShapeNode.fill?: string`, `ShapeNode.stroke?: string` (colors; hex like `#rrggbb`, match `ColorPicker`'s emitted format so a round-trip is stable).
2. **Validate/repair** — accept a valid color string; **drop invalid optionals with a repair, never fatal** (mirror how `quantizerHint`/`fit` are handled).
3. **Resolve** — the resolved shape types carry `fill?: string` (undefined = no fill), `stroke: string`, `strokeWidth: number`, with defaults applied when absent: closed shapes (rectangle, ellipse, closed polygon/line) → fill `#ffffff`; stroke `#374151`; strokeWidth `1`.
4. **Both renderers** — read exactly the resolved `fill`/`stroke`/`strokeWidth` (no Konva defaults, no divergent constants). Keep the selection/warn highlight behaviour (selected/warn still overrides the visible stroke for the editor affordance).
5. **Factory/insert** — seed the explicit defaults on newly inserted shapes (closed → white fill; open → no fill), so the inspector shows them; old docs without the fields still resolve with the same defaults.
6. **Inspector** — `fill`/`stroke`/`strokeWidth` `wired:true`; show the resolved default when the field is absent (so a closed shape shows white, not black). Wire `cornerRadius` for rectangles too (persisted + already scaled; the comment defers it to this pass). Give any still-unwired style field an honest reason (add a `'style'` `FieldReason` + i18n key if needed, instead of the misleading CSV `'content'` message).
7. **i18n** — typed keys for any new label/reason.
8. **Tests** — validate repair; resolve defaults (closed vs open); **both** renderers honor fill/stroke/strokeWidth (real-canvas where practical) proving preview≡print; inspector wiring.

## Environment (pass to every subagent)

- WSL, repo on `/mnt/c`. `bun` = `bun` (absolute; bare `bun` not on PATH).
- **Never `bun test`** → `…/bun.exe run test:run`. Typecheck `…/bun.exe run tsc`.
- Vitest default `node`; DOM/Konva tests need `// @vitest-environment happy-dom` line 1 (+ `installCanvasShim()` for real canvas).
- Typed i18n keys in `src/i18n/locales/en.json`; no hardcoded UI strings.
- No subagent delegation (depth 1). No commits — coordinator commits.

## Verification gates

- `tsc` clean · `bun run test:run` green.
- Review: `experimental-review` primary (`review` available; VPN up).
- **No agent headed test** (owner decision) — owner does the visual default check.

## State

- Status: dispatched.
