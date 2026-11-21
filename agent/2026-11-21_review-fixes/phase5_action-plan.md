# Phase 5 action plan — codex round-4 findings (6 + 2 minor)

Run: `agent/2026-11-21_review-fixes/`. Baseline: `433b65d` (all 3,092 tests + tsc green). Six findings + two smaller issues, reproduced by the external review against store/mounted-editor/print pixels.

## F1 (P1) — editing B cancels A's pending save (shared pending slot)

Repro: edit A while B loads, then edit B within 800 ms of the switch → B's edit calls `scheduleAutosave(B)` → `cancelAutosave()` + replaces `pendingAutosaveDoc`, so A's snapshot is lost (`editorSlice.ts:322`). The round-3 regression waits for A's timer before editing B, so it misses this.

**Fix (chosen): snapshot displacement, not a per-label timer map.** In `scheduleAutosave(doc)`: if the current `pendingAutosaveDoc` belongs to a DIFFERENT label, commit that displacement immediately — `enqueueAutosave(displaced, repo)` under the same `autoSave`/repo guards — then arm the debounce for the new doc. Edits to a different doc only occur across a switch, so at most one displaced snapshot can exist. `enqueueAutosave` serializes through `autosaveWrites`, so a later write to the same label still never clobbers an earlier one.
**Test:** gated `repo.get` for B; edit A during the read; resolve (B commits); edit B inside the debounce → assert A's snapshot reached `repo.save` and re-opening A has the edit. Keep the round-3 test green.

## F2 (P2) — a deleted label can still reappear (two paths)

a) **Explicit save is outside the serialized chain:** `saveCurrentLabel` (`docSlice.ts:236-272`) awaits the autosave flush, then calls `repo.save(updated)` directly (`:252`); `deleteLabel` awaits only `autosaveWrites`, so an explicit save in flight at delete time lands after `repo.remove` and recreates the label.
b) **Back-edit during deletion:** an `openLabel`/edit landing after the delete's flush schedules an autosave whose timer fires after the remove → recreates the label.

**Fix (both, together):**
- **Serialize the explicit write** through the same chain: expose a store action (e.g. `serializeRepositoryWrite(write: () => Promise<void>): Promise<void>` in editorSlice + `storeTypes`) that appends to `autosaveWrites` without ever stranding the chain on rejection (the chain must stay non-rejecting; the caller sees its own error). `saveCurrentLabel` routes `repo.save(updated)` through it and awaits; `deleteLabel`'s existing flush-await then also waits for the explicit save. Keep the saveFailed notification and timestamp/refresh semantics.
- **Deletion tombstone:** add a per-store-instance, non-persisted set of deleted label ids (store state `deletedLabelIds: string[]` or an equivalent per-instance structure — NOT module-level, tests create stores freely). Mark the id on successful `repo.remove`. `saveDoc` (the autosave chain's writer) and the explicit-save path must skip a tombstoned id; openLabel of a tombstoned id naturally finds nothing.
**Tests:** (a) explicit save gated in flight + gallery delete of that label → `remove` waits for the explicit write (invocationCallOrder), no resurrection; (b) openLabel during a gated remove + edit → after remove and the timer fires, the label stays deleted (tombstone blocks the write). Negative-check both against the old code.

## F3 (P2) — width-only drag changes shrink-text height (stale layout height)

Repro: 10×1 box → height 1.5 mm → widen to 15 mm → saves **15×2.25**. The first release reconciles the scale but leaves a stale layout height on the live canvas node; the second gesture reads it back (`PreviewStage.tsx:1937` release · `:1863` next commit). **Fix:** the post-commit reconciliation must leave the live node's layout size **and** scale exactly equal to what the next render produces from the committed doc (reconcile the box-only text node's width/height attrs too, not just scale), or the next commit must derive its target from the committed source instead of stale live attrs. Acceptance: the two-step repro ends at 15×1.5.

## F4 (P2) — multi-select and cancel mishandle shrink text

a) **Multi-select resize** of text+rect widened 50% saved the 10×1 text box as 7.5×0.5 (`PreviewStage.tsx:1865` multi-select commit path). Fix: apply the shrink normalization to text in the multi-select commit path as well.
b) **Cancel** of a single-text resize left enlarged/clipped glyphs while the doc kept its size (`PreviewStage.tsx:1381`). Fix: the cancel path must restore the live node to the committed state (scale + layout size), not just skip the commit.
**Tests:** multi-select widen keeps the text box at its committed size; cancel restores the live node (assert committed doc unchanged AND the live scale/size match the source render).

## F5 (P2) — redo bypasses D-83's selection cleanup

Repro: delete a rect (prune), undo, select the restored rect, redo, Shift-select an ellipse → two ids selected, eight handles, no aspect lock (`editorSlice.ts:1110`). **Fix:** after `undoDoc`/`redoDoc` install the previous/next doc, prune `selectedNodeIds` to ids present in that doc (same invariant D-83 enforced on delete).

## F6 (P2) — bottom/left feed checks the wrong edge for clipped ink

Repro: 16×16 raster, 8-dot head; the encoder places a top-left dot at output column 15 for both directions, but `hasInkBeyondPrinthead` scans the SOURCE raster before orientation (`printOrientation.ts:162` view; orientation logic `:98`), so the warning returns false. **Fix:** scan the oriented raster (apply the same print-direction transform the encoder applies) or map the scanned edge per direction; keep the post-quantize detector semantics. Tests: the 16×16/8-dot repro for bottom and left feed → true; existing four-direction cases green.

## Minor 1 — 0.15° rounds differently on the live vs commit path

Typing `0.15` sets 0.2 live, Enter changes it to 0.1 (`PopoverSlider.tsx:324`). Round-half ties: the commit path divides by `step` (float 0.15/0.1 = 1.499…→1), the live path multiplies by 10 (1.5→2). **Fix:** make the circular commit's step rounding decimal-safe (e.g. scale numerator and step by the step's decimal factor before dividing) so ties agree with `normalizeRotDeg`. Non-circular path untouched. Test: typing 0.15 commits 0.2 on both paths; -0.15 → -0.1.

## Minor 2 — sampler renders cropped pages when head clamping is on

With DoubleColor head clamping enabled, the ink sampler (`PrintDialog.tsx:710` loop) can render up to 12 already-cropped pages even though none can exceed the head width. **Fix:** skip the ink sample (result false) when the active clamp guarantees no ink can lie beyond the head, with a comment naming that invariant. Keep the offset/later-row cases green.

## Waves (4 agents, disjoint files)

1. **Store** — F1 + F2 + F5: `editorSlice.ts`, `docSlice.ts`, `storeTypes.ts` + `editorSlice.test.ts`, `docSlice.test.ts`.
2. **Canvas** — F3 + F4: `PreviewStage.tsx` (+ `transformGesture.ts` if needed) + `PreviewStage.interaction.test.tsx`.
3. **Print** — F6 + minor 2: `printOrientation.ts`, `PrintDialog.tsx` + their tests.
4. **Rounding** — minor 1: `PopoverSlider.tsx` + `PopoverSlider.test.tsx` (+ `ObjectTab.test.tsx` if the live path is asserted there).

Then `review` → fixes → full suite → semantic commit + docs. Update `tech-debt.md` only if a residual is accepted (none expected from this round).
