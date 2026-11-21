# Phase 4 action plan — codex round-3 findings (6 bugs + 2 debt corrections)

Run: `agent/2026-11-21_review-fixes/`. Baseline: `8c02bce`. Verifier: external codex review (all 3,072 tests green at baseline; findings reproduced against store/mounted editor/print renderer). Line refs are the reviewer's current-HEAD refs.

## Finding 1 — P1: edits made while the next label loads are discarded (new, separate from D-80)

Repro: delay `openLabel(B)`'s `repo.get`; edit still-visible label A during the delay; B opens → A's edit lost on disk + undo history cleared (`docSlice.ts:225` switch · `editorSlice.ts:329` discard).

**Verified mechanics (read at HEAD):** `scheduleAutosave` sets `pendingAutosaveDoc = doc` synchronously at edit time (`editorSlice.ts:321`), but the debounce timer's fire block drops the snapshot when `state.currentDoc?.meta.id !== pending.meta.id` (`:329`). If the debounce fires after the switch commits, the newest edit of A is never written; the phase-1 flush-before-read only covers edits made **before** the read.

**Fix (chosen):** relax the timer-fire guard — a pending snapshot must still be written after a doc switch; it is that label's own latest content. Keep `autoSave`, `view === 'editor'`, and repo guards. Delete-before-save inversion stays protected: `deleteLabel` flushes (which cancels the timer synchronously and awaits the chain) before `repo.remove`. Same for `setView` (flush first). Verify that reasoning before changing; if a counterexample exists, report it and use a bounded re-flush loop in `openLabel` instead. Also re-verify `flushAutosave` already writes a pending snapshot regardless of the current doc id (it does — no id guard at `:350-360`; do not add one).

**Test:** delayed `repo.get` for B, edit A during the window so the debounce fires **after** B commits → A's newest doc (with the edit) reaches `repo.save`; re-open A and assert the edit is present. Keep the existing openLabel ordering test green.

## Finding 2 — P2: rotating a mirrored object jumps 180° on release

Repro: `scaleX = -1`; live angle −165° becomes +15° on release (`transformGesture.ts:173` — the rotation commit copies Konva's `rotation()` into `rotDeg` while keeping the document's scales).

**Cause (derived):** Konva's normalization can represent a mirrored transform as the **negation of the doc's scale pair** (doc `diag(−1, 1)` ≡ live `diag(1, −1)`). Since `R(θ)·(−D) = R(θ+180)·D`, copying θ while keeping the doc's `D` rotates the result by 180°.

**Fix:** where the commit copies live `rotDeg` (`rotationOnlyPatch` and `transformEndPatch`), include Konva's sign flip: if the live scale pair is the negation of the source pair (`sign(live.scaleX) === -sign(source.scaleX) && sign(live.scaleY) === -sign(source.scaleY)`), commit `normalizeRotDeg(live.rotDeg + 180)`. Do not change stored scales. Verify empirically against a mounted Transformer (mirrored node rotate → committed doc matrix must reproduce the live orientation); if Konva's normalize differs from this model, derive the adjustment from the matrices and say so.

**Tests:** unit — source `scaleX=−1, scaleY=1`, live `rotDeg=−165, scaleX=1, scaleY=−1` → committed `rotDeg=15`; non-mirrored rotation unchanged. Interaction if cheap: mirrored text rotated → orientation preserved (committed rotDeg + scaleX still −1).

## Finding 3 — P2: shrink-text resize still corrupts the display on release (two sub-bugs)

a) **Static text:** widening 10×1 → 15×1 mm saves the correct size but glyphs **double** on release — the commit resets the live display scale to 1 instead of the new box's shrink factor (`PreviewStage.tsx:1851`).
b) **CSV-bound text:** the same widening gesture saves **7.5 mm** width — the shrink factor is computed from the node's **empty** static text (`PreviewStage.tsx:261`), while the render uses the resolved CSV row text.

**Fix:** the post-commit live-scale reset must use the shrink factor the renderer will apply for the committed box — computed from the SAME text basis the renderer uses (resolved/sample-row text, not raw `node.text`). Both sub-bugs share this root. Keep rotate-only and non-shrink paths byte-identical.

**Tests:** static 10×1 → 15×1: committed size 15×1, `fontSize` unchanged, live glyph scale on release equals the new shrink (no doubling); CSV-bound same gesture: committed width 15 mm (not 7.5); existing shrink/rotate cases stay green.

## Finding 4 — P2: angle inspector displays raw stored values (precision + out-of-range)

Opening a saved label shows `721.23456789°` beside a ±360° slider; ungroup composition shows `0.30000000000000004°` (`ObjectTab.tsx:282`).

**Fix:** normalize the **displayed** rotDeg independently of stored geometry: the inspector value (slider value and any readout) shows `normalizeRotDeg(stored)` — `721.23` → `1.2`, `0.30000000000000004` → `0.3`. Do NOT rewrite the doc on open; commits already normalize. Cover the slider trigger + number input value paths so they agree.

**Tests:** field value renders normalized for an out-of-range stored rotDeg and for float-dust (0.1+0.2 ungroup case if the existing fixture allows); stored doc unchanged until a commit.

## Finding 5 — P2: grayscale invert erases the design at a degenerate band

Band min=max=4: normal render = white paper + level-4 rect; invert turns **all** pixels level 4 (`renderLabelPage.ts:890`). Paper white must participate.

**Fix (ordinal mirror over `{paper} ∪ [lowest..highest]`):** with `N = highest − lowest + 1`, map paper (k=0) → ordinal 0, band level k → ordinal `k − lowest + 1`; invert `o' = N − o`; map back (`o'=0` → paper/level 0, else `lowest + o' − 1`). Checks: band 4–8 → paper→8, 4→7, 8→paper; degenerate 4–4 → paper→4, 4→paper (design visible); full ramp → exactly `15−k` (byte-identical to today, mono/red-black untouched). Replace the clamp-based formula; keep the `pageColor === 'grayscale'` branch.

**Tests:** degenerate band 4–4 invert → paper stays distinguishable (level 4 vs paper/0, not all-4); band 4–8 expected ordinals; full-ramp byte-identical case stays green.

## Finding 6 — P2: print dialog can still miss clipped ink (two pre-existing gates)

a) **Offset not in the dimension gate** (`PrintDialog.tsx:362`): the page width is checked before the outer offset is applied — a 160-dot page shifted 280 dots has ink past a 160-dot head, but the check is skipped. Fix: the overflow gate (which decides whether to run the ink sample) must account for the outer offset extent on both axes.
b) **Only the first active CSV row is sampled** (`PrintDialog.tsx:642`): a later row can overflow after a clean first row. Fix: evaluate the active rows (short-circuit on the first that shows ink beyond the head). Keep the dialog responsive — measure; if all-row rendering is too slow at resolved dpi, raise it and use a documented bounded strategy that still catches differing later rows (do not silently revert to row 1).

**Tests:** offset case — page that fits the head only before offset → warning fires; CSV case — first row clean, later row overflowing → warning fires; clean single-row case does not warn.

## Debt corrections (no code)

- **D-09:** also affects **uniform** scaling — a child in a 2× group moves twice the drag distance (`PreviewStage.tsx:1263` drag conversion).
- **D-83:** visible consequence — after deleting an object, Shift-select an ellipse: the transformer attaches one object but shows eight handles and disables aspect lock because the deleted id still counts (`PreviewStage.tsx:752`).

## Waves

- **Wave 1 (3 agents, disjoint files):** F1 (`docSlice`/`editorSlice` + tests) · F2+F3 (`transformGesture`/`PreviewStage` + tests) · F4 (`ObjectTab` + test).
- **Wave 2 (2 agents):** F5 (`renderLabelPage` + tests) · F6 (`PrintDialog` + tests).
- **Wave 1 done:** F1 (debounce guard dropped; regression + negative check; 134 green) · F2+F3 (matrix-derived `orientationFixDeg` — Konva always reports non-negative scaleX, mirror sign rides on scaleY; both-axis negation → +180 in both patches, mirrored resize keeps the doc's sign pair; `shrinkFactorForText` on the resolved basis (`resolvePreviewTree` sample-row overrides), release resets to `sign × committedShrink`; static 10×1→15×1 release shrink 1→0.111, CSV 7.5→15 mm; 1241 editor tests green) · F4 (display normalize; 95 green).
- **Phase-4 review** (`review`, `ses_e0221bca6ffeAOrxtfPo41g2wH`): **fix-first** — 🔴 `deleteLabel` flushes only when the deleted label is current; `setView`'s flush is fire-and-forget → a non-current gallery delete during an in-flight save can be resurrected by the late save. Fix round: unconditional `await flushAutosave()` before `repo.remove` (history clear stays conditional) + gated regression. 🟡 ink-sample bound → filed as **D-85**; 🟡 budget-comment overclaim → comment corrected. F1–F6 + D-83 otherwise match intent; docs accurate; D-83 closed.
- Then `review-fast` narrow re-review of the fix diff → full suite → phase-4 commit + docs (action plan, tech-debt) + `state.md` stays ignored.
