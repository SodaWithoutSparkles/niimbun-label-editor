# Phase 7 — DPI calibration dialog (#11)

- Objective: add an on-screen ruler calibration flow that writes the existing `setScreenDpi`, so users can match a real ruler without guessing numbers.
- Status: **complete + reviewed + fixed (2026-10-08)**. `tsc` clean · full suite 116 files / 1355 tests green. Committed `feat(editor): screen dpi calibration dialog (#11)`.
- **Reviews:** `experimental-review` → CHANGES-NEEDED (MUST-FIX: auto-height `overflow-x-auto` scroller clipped the ruler's ticks at dpi ≥ ~145) → fix → re-review **APPROVE**. Owner manual browser check pending (no headed automation).
- Scope (verified): 4 files — new `src/components/settings/CalibrationDialog.tsx` (+ test), `GeneralSection.tsx` (Calibrate button + open state), `src/i18n/locales/en.json` (new `settings.general.*` keys). Reuses `Modal`, `setScreenDpi`, `realZoom`. Only `en.json` overlaps the P5 fix round → serialize that write.
- Ruler math: `px = N_mm * dpi / 25.4` (inverse of `realZoom`, `core/viewport.ts:103`); at 100 mm / 96 dpi = 377.95 px. Do NOT reuse `PrintSmoke`'s printed ruler (separate printer-calibration feature).
- Source: `plan.md` P7 + decision row 11; investigation #11; `agent/memory/dialogs.md`.

## Owner decisions (locked)

- Control = **ruler + slider + live number** (+ ±1 nudges, added 2026-10-08 for fine alignment), all on the shared `Modal` (NOT `dialogService` — it only offers confirm/prompt/alert).
- Reference length = **100 mm**.
- Keep the existing raw number field in `GeneralSection`.
- Writes the existing `setScreenDpi` (clamped/persisted exactly as today).

## Tasks

- [x] New `CalibrationDialog` on `src/components/common/dialogs/Modal.tsx`. On-screen ruler length = `mm / 25.4 * screenDpi` px (inverse of `realZoom`, `src/core/viewport.ts:103`). Show a 100 mm ruler; slider + live numeric readout of the effective DPI; changes write `setScreenDpi` live.
- [x] `Calibrate` button next to the dpi input in `src/components/settings/GeneralSection.tsx`; dialog opens only while open (closed-but-mounted dialogs still run hooks — `dialogs.md`).
- [x] Typed i18n keys in `src/i18n/locales/en.json`; no hardcoded strings.
- [x] Focused test (ruler pixel length math at a known DPI; slider writes `setScreenDpi`; clamp honored; stacked-on-Settings mount).
- [ ] **Owner verifies manually** — no headed-browser automation (owner instruction 2026-10-08). The Tailwind-preflight/UA-cascade class of bug (`dialogs.md`) can only be seen in a real browser, so flag this explicitly in the phase receipt for the owner's check.

## Files

- `src/components/settings/CalibrationDialog.tsx` (new, or under `common/dialogs/`)
- `src/components/settings/GeneralSection.tsx`
- `src/i18n/locales/en.json`
- tests alongside the new component

## Gates

- `tsc` clean · `bun run test:run` green.
- Review: `experimental-review` (primary).
- Owner manual browser verification (no headed automation).
- Tick #11 in `agent/known-issues/2026-10-06_round-1.md`; update `plan.md`/`state.md`.

## Risks

- `Modal` sizing via tailwind-merge groups (pass `max-w-none` when using a width utility — `dialogs.md`).
- StrictMode double-mount; effects must be idempotent.
- DPI writes must stay clamped/persisted via the store, not local state.
