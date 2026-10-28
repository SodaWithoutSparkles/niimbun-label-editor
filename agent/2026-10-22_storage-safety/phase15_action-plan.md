# Wave 3 · Phase 15 — Gamma (and boldness) preview trigger

- Date: 2026-10-28
- Baseline: `main` @ `06416ac` (P13)
- Reviewer: `review-fast` (mechanical, narrow) — escalate to `review` if the diff grows
- Commit: `fix(dither): show the preview when only gamma changes`

## Failure mode (confirmed)

`quantizedPreviewTrigger` (`src/editor/quantizedPreview.ts:142-160`) builds its
key from `hint | threshold | strength | serpentine | screentoneLevels |
screentonePitchMm | screentoneAngle`. It omits:

- **`gamma`** (GitHub #3) — a gamma-only edit leaves the trigger key unchanged,
  so the hook takes its "no tuning" branch and never repaints;
- **`screentoneBoldness`** — the same class of omission: it is a per-node,
  pixel-changing knob (`policyKeyOf` keys it; P11), and an inspector edit to it
  shows no preview. Folded in here; the fix and the risk are identical.

Effect: the user moves a knob and the dithered preview shows the previous
result. Unlike D-59 (settings-level tuning has no preview because the modal
covers the canvas), these are **inspector** knobs — exactly the case the
trigger exists for.

## Design (fixed)

1. `src/editor/quantizedPreview.ts` — append `gamma` and `screentoneBoldness`
   to the key array (after the existing params, `?? ''` like the rest) and
   update the key doc (`:116-119`) plus the "names exactly the fields…" prose
   (`:131-137`).
2. Nothing else changes: no new options, no settings key (that is P16), no
   change to `useQuantizedPreview`'s deps. The trigger is a pure function; the
   hook already re-renders on a key change.

Do **not** add the effective quantizer id or the settings maps to the trigger —
that is D-59's deliberate exclusion and P16's separate concern.

## Tests

`src/editor/quantizedPreview.test.ts` (`describe('quantizedPreviewTrigger — what counts as tuning')`):
- a `gamma`-only change flips the key (and `undefined → 1.5` differs from `1.5 → 1.5`);
- a `screentoneBoldness`-only change flips the key;
- the existing "stable on an unrelated field" and "every per-node param"
  cases stay green (extend the "every param" case to the two new fields rather
  than adding a parallel duplicate).

`src/components/editor/useQuantizedPreview.test.tsx`:
- an inspector-style gamma edit on the selected node arms and renders the
  preview (mirror the existing screentone-knobs re-render case at `:367-413`).

Gate: the two test files + `tsc --noEmit`; full suite at the phase gate.

## Risks

| Risk | Mitigation |
| --- | --- |
| Trigger churn on unrelated edits | The key still contains only per-node quantizer fields |
| Duplicate trailing separator when both new fields are absent | Same `?? ''` + `join('|')` shape as the existing fields — no new format |
| Scope creep into P16 | The settings maps stay out of this function |
