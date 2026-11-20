# Phase 1 action plan — data loss (2 bugs)

Run: `agent/2026-11-21_review-fixes/`. ENV BRIEF: [`state.md`](state.md). Anchors verified 2026-11-21 by explore (session `ses_e0560705effe2lo6g3dRxGW15t`); line refs are current HEAD.

## Bug A — `openLabel` stale read during pending autosave (P1)

**Root cause (verified):** ordering, not a missing call. `docSlice.ts:205-230` — `repo.get(id)` at :209 captures the record **before** `await get().flushAutosave()` at :218, so reopening while a write is in flight installs a pre-flush copy. `setView` (`docSlice.ts:62-69`, :66 `void get().flushAutosave()`) leaves the write in flight when the gallery→reopen path reaches `openLabel` — fixing the order inside `openLabel` covers both entry points.

**Fix seam:** in `openLabel`, move the `await get().flushAutosave()` to **before** `repo.get(id)`. Preserve all guards:
- keep `const request = ++openRequestId` first;
- re-check `request !== openRequestId` after **each** await (flush can be superseded exactly like the read can);
- `flushAutosave()` already resolves after every started write (`editorSlice.ts:350-359`); it is already safely awaited by `saveCurrentLabel` (:243) and `deleteLabel` (:279), so awaiting it first is safe when nothing is pending.
- Update the stale comment at :213-217 (it frames the flush as only "for the doc we are leaving" — it must also settle writes **for the doc being opened**).

**Tests** (`src/store/docSlice.test.ts`): new case in the existing style — `makeStoredRepo()` (:551) gated-save + `save.mock.invocationCallOrder` pattern (:455-482, :584-611): schedule autosave with an edit, gate the write, call `openLabel`, assert read-order (flush before `repo.get`) and that the installed `currentDoc` contains the edited content (not the pre-edit copy). No existing test asserts this ordering.

## Bug B — one Delete consumes N undo entries (P1)

**Root cause (verified):** both paths loop `removeNode` (one `commit`/`docPast` push per call, cap `DOC_HISTORY_CAP = 20` at `editorSlice.ts:53`):
- keyboard: `EditorKeyboardShortcuts.tsx:136-140` (`for (const id of state.selectedNodeIds) state.removeNode(id);`)
- menu: `Header.tsx:79` (`selectedNodeIds.forEach((id) => removeNode(id))`), wired via `EditMenu.tsx:54`.

**Fix seam:** add batch action `removeNodes(ids: readonly string[])` to `editorSlice.ts` next to `removeNode` (:867-874), copying the `nudgeNodes` single-commit precedent (:426-472, comment :451-453): one `cloneDoc`, union `collectSubtreeIds` over all ids (parent+child both selected must not double-handle), one filter, one `commit(next, doc)`. No-op (no history push) when none of the ids exist. Declare in `storeTypes.ts` near :487. Replace both loops with a single `removeNodes` call. Keep `removeNode` for any single-id callers (grep first).

**Deliberately unchanged (parity, out of scope):** deleted ids remain in `selectedNodeIds` (pre-existing benign quirk); same multi-entry pattern exists for z-order/ungroup (`Header.tsx:81,83`, keyboard `[`/`]` :143,148) — follow-up, not this round.

**Tests:**
- `editorSlice.test.ts`: `removeNodes` removes each id + descendants; 21-node selection delete = **1** `docPast` entry; undo restores all 21; empty/unknown ids no-op.
- `EditorKeyboardShortcuts.test.tsx`: new Delete/Backspace describe — 3 selected, one keypress, all gone, one history entry.
- `Header.dom.test.tsx`: menu-delete path single commit (lightest honest DOM test; if the wiring makes it impractical, document why keyboard+store coverage suffices).

## Delegation

Two parallel `general` agents (disjoint files):
- **A1:** Bug A — `docSlice.ts` + `docSlice.test.ts`.
- **A2:** Bug B — `editorSlice.ts`, `storeTypes.ts`, `EditorKeyboardShortcuts.tsx`, `Header.tsx` + the three test files.

Then one `review` pass over the phase diff, fixes if needed, semantic commit.

## Out-of-scope findings (recorded, not fixed this round)

1. `useThumbBackfill.ts:105-148` races in-flight edits (thumb patch vs edit write) — real data race.
2. `useLabelTransfer.ts:258-262` export-all reads stored docs stale while a write is pending.
3. Z-order/ungroup loops share the N-entry undo pattern (same class as Bug B).
