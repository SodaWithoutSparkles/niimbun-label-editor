# Storage safety — Wave 1 plan

- Date: 2026-10-22
- Baseline: `main` @ `3bbff78`
- Scope owner: user (wave 1 of the backlog triage in this run)
- Status: **IN PROGRESS**

## Why

Three confirmed defects let a user permanently lose data, and one of them is
already exposed in the UI:

1. **Delete-unused can wipe every asset** (GitHub #4). `labelRepo.list()`
   swallows adapter errors and returns `[]`; the sweep then treats an empty
   reference inventory as "nothing is referenced", so every CSV and media record
   is offered for deletion.
2. **Delete-unused ignores the open document** (GitHub #5). The inventory is
   built from persisted labels only. With autosave off, an image or CSV attached
   in the still-open editor is never persisted, so it is classified unused and
   deleted while the document needs it.
3. **No label delete at all, plus a resurrection race** (GitHub #1). `deleteLabel`
   exists with zero production callers, and the tour copy already promises
   deletion. Adding the UI alone would expose a race: an autosave whose debounce
   already fired has an untracked in-flight `repo.save()`; deletion completes
   first and the late write recreates the label.
4. **Single-item delete has no reference check.** `CsvCard`/`MediaCard` delete a
   record after a generic confirm, even when a saved or open label references
   it. Same blast radius as the batch path, one row at a time.

## Non-goals (explicitly out of scope for wave 1)

- Export/share (wave 4).
- Print CSV readiness (#6/#7), dither preview (#2/#3), text/barcode fidelity.
- Delete cascade: deleting a label does **not** prune its resources. Orphans
  stay visible in the galleries and are reclaimed by the (hardened) sweep.
- Undo-history retention beyond including `docPast`/`docFuture` in the
  reference inventory (cheap, prevents undo restoring a broken ref).
- Any File-menu delete entry, keyboard shortcut, or sidebar delete affordance.

## Design

### D1 — one authoritative reference inventory

New `src/data/referenceScan.ts` (storage-aware, React-free):

```ts
export interface ReferenceInventory {
    csvIds: Set<string>;
    resourceIds: Set<string>;
    /** Every label and every live document read successfully. */
    complete: boolean;
}

export const scanReferences = async (input: {
    labelRepo: LabelRepo | null;
    csvRepo: CatalogueLister | null;
    resourceRepo: CatalogueLister | null;
    liveDocs: readonly (LabelDoc | null | undefined)[];
}): Promise<ReferenceInventory>;
```

Rules:

- `labelRepo === null` → `complete: true`, empty sets (storage not booted is not
  a read failure — existing contract).
- `listDetailed()` replaces `list()`. `errors.length > 0` → `complete: false`
  (an unreadable record may hold references).
- A `get()` that returns `null` **or throws** → `complete: false` (used to be a
  silent skip).
- `csvRepo.list()` / `resourceRepo.list()` rejection → `complete: false`, empty
  result for that store (the caller must not act destructively).
- `liveDocs` are unioned into the collector. Callers pass
  `currentDoc`, `docPast`, `docFuture` — reading them non-reactively via
  `useStore.getState()` so the O(docs) sweep does not re-run per keystroke.

`useOrphans` becomes a thin React wrapper: it calls `scanReferences`, publishes
the two sets, and additionally publishes `complete` (replacing the boolean
`error` for "cannot prove the inventory"). Its `reload()` returns the freshly
computed `ReferenceInventory | null` so consumers can re-validate.

### D2 — destructive actions require a complete, fresh inventory

- The batch button renders only when `complete` is true (today it checks `error`,
  which the labels read can never set).
- On confirm, the handler re-scans and deletes only the intersection of the ids
  shown and the ids that are **still** orphans in the fresh scan. If the fresh
  scan is incomplete, delete nothing and notify. This closes the
  confirm-dialog staleness window.
- Single-item delete runs one fresh scan before confirming and picks the message:

| Scan result | Message | Effect |
| --- | --- | --- |
| id is an orphan, `complete` | existing `*.deleteConfirm` | normal danger confirm |
| id is referenced | new `*.deleteInUseConfirm` | danger confirm naming the risk |
| scan incomplete | new `*.deleteUnverifiedConfirm` | danger confirm naming the risk |

The user keeps the final say; the accidental path disappears.

### D3 — autosave writes are tracked, not just debounced

`editorSlice` keeps a module-scope promise chain `autosaveWrites`. The timer fire
appends `saveDoc(pending, repo)` to the chain instead of `void`-ing it.
`flushAutosave()` returns the chain as it stands (including a pending doc if one
is still scheduled), so `deleteLabel`, `saveCurrentLabel`, `openLabel` and
`setView` await **all** older writes. This is the fix for #1 and it does not
change the debounce or the `autoSave`/`view` gates.

### D4 — label delete UI

- `LabelCard` gains `onDelete`, rendered as a `Trash2` icon button in the card
  footer (outside the existing open-button — nested buttons are invalid).
- `GalleryView` wires `confirm({danger:true, message: gallery.deleteConfirm})` →
  `deleteLabel(id)`.
- `deleteLabel` navigates to the gallery when it removes the open document
  (`setView('gallery')`, which also closes the print dialog). Today the store
  keeps `view: 'editor'` while `currentDoc` becomes `null`, so the URL and the
  store silently diverge.

## Phases

| Phase | Work | Primary files | Gate |
| --- | --- | --- | --- |
| **P1** | Reference inventory: `referenceScan.ts`, `useOrphans` rewrite, batch revalidation | `data/referenceScan.ts` (new), `data/orphans.ts`, `components/gallery/useOrphans.ts`, `CsvSection.tsx`, `MediaSection.tsx`, tests | unit + hook + DOM tests |
| **P2** | Single-item delete guard in both catalogues | `CsvSection.tsx`, `MediaSection.tsx`, `en.json`, DOM tests | DOM tests |
| **P3** | Autosave write tracking + label delete UI + navigation | `store/slices/editorSlice.ts`, `store/slices/docSlice.ts`, `LabelCard.tsx`, `GalleryView.tsx`, `en.json`, tests | slice ordering tests + DOM tests |
| **P4** | Full verification: `bun run test`, `bun run build`, review | — | reviewer + build |

P2 is split from P1 only because both edit the same two section files; one
implementer keeps them consistent. P3 is independent of P1/P2 except for
`en.json` (one writer per phase — phases are sequential).

## Test plan (must exist before the phase is called done)

**P1**
- `referenceScan.test.ts`: complete scan; `listDetailed` errors → incomplete;
  `get()` returning null → incomplete; `get()` throwing → incomplete; catalogue
  `list()` rejection → incomplete; live docs union; `labelRepo === null` → complete.
- `useOrphans.test.tsx`: current tests migrated from a rejecting `list()` to
  `listDetailed()` with errors; new `currentDoc` case with `autoSave: false`;
  asserts `complete` false and empty destructive sets.
- `CsvSection.dom.test.tsx` / `MediaSection.dom.test.tsx`: no batch button when
  the inventory is incomplete.

**P2**
- Single delete of a referenced CSV/resource shows the in-use confirm; dismissing
  keeps the record; confirming removes it.
- Batch delete re-scans: a record saved by another tab between render and confirm
  is not deleted.

**P3**
- `docSlice.test.ts`: fire the autosave debounce, hold `repo.save` pending, call
  `deleteLabel`, assert the save settles before `remove` and the label does not
  resurrect. Regression: a newer explicit save is not clobbered by an older
  autosave (existing must-fix #8 case must stay green).
- `LabelCard.test.tsx`: delete button renders and calls `onDelete`; it is not
  nested inside the open button.
- `GalleryView.dom.test.tsx`: confirm dismiss keeps the card; confirm deletes and
  the gallery refreshes.
- `editorSlice.test.ts`: `flushAutosave` awaits an in-flight write; `deleteLabel`
  on the open doc sets `view: 'gallery'`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Serialising autosaves could drop a newer write | Chain (`.then`), never replace the tail |
| Blocking batch delete on one corrupt label | Intended (issue #4); surface `*.orphanReadError` instead of hiding the cause |
| `currentDoc` read in a hook makes the sweep re-run per keystroke | Non-reactive `useStore.getState()` at scan time only |
| Incomplete inventory permanently disables cleanup | Acceptable; a corrupt record must be fixed/removed first. Single-item delete stays available with an explicit override |
| Nested buttons in `LabelCard` | Footer button is a sibling of the open-button, mirroring `CsvCard` |

## Commit strategy

Semantic commits, one per phase:

1. `fix(gallery): require a complete reference inventory before unused cleanup`
2. `fix(gallery): warn before deleting a referenced CSV or media record`
3. `feat(gallery): delete labels, and await in-flight autosaves before removal`

No `git stash`, no destructive git commands, no push.

## Wave 2 — upstream dev survey actions (folded in 2026-10-22)

Source: [`upstream-dev-survey.md`](upstream-dev-survey.md) (niimblue
`8a60a8e..0c2dfa8`). Folded into this run by owner instruction. **Not started.** Wave 1 (P1–P4) is
complete; no wave 2 coding until the owner says go.

| Phase | Work | Effort | Notes |
| --- | --- | --- | --- |
| **P5** | Bump `@mmote/niimbluelib` 0.47.0 → 0.47.1 | 2 files | Highest value: adds `findPrintTask` protocol‑4 fallback (our `niimbotAdapter.ts:223-226` currently throws) + unsigned packet parsing. Owner decision 2026‑10‑22: **skip verification**. Watch the advisory `rollHeightHm` change (`niimbotAdapter.ts:421`). |
| **P6** | Fix `PopoverSlider` number-field typing | small | `PopoverSlider.tsx:435-439` commits `Number(value)` per keystroke and `:103-105` re-syncs, so negative X/Y is untypeable and clearing injects 0. Draft-string while focused; commit on blur/Enter. |
| **P7** | Wire `letterSpacing` | small | Model + validator already exist (`core/doc/types.ts:122`, `validate.ts:532`); `wired:false` (`inspectorModel.ts:127`) and not read by `konvaFactory.ts:368-379`. Needs shrink-measure parity + inspector test update. |
| **P8** | Label import/export UI | large | Serializer already exists (`core/doc/serialize.ts` + version gate); no UI. Needs single-or-list import, id re-mint/duplicate handling (our id is inside the payload), export current/all. |
| **P9** | Persist print offset per label | small-medium | Offset knobs exist but are dialog-local (`PrintDialog.tsx:136-138`); add `label.offset` to `LabelDoc` + validator + factory. |
| **P10** | Optional polish (owner pick) | trivial | `scrollbar-gutter: stable`; a **new** 48×30 paper seed (never edit `rounded50x30`); `multiline` prompt option. |
| — | Screentone contrast/boldness knob | medium | **Blocked on owner decision** — parametric contrast/S-curve was deliberately dropped 2026‑10‑17. Do not plan until re-decided. |

Do **not** adopt from upstream: screentone replacement or its px/float-angle
parameters, `beforeunload` dirty guard (we autosave), `noScaleCache` (Konva does
not cache), nested `{var}` token syntax (we use JS templates).
