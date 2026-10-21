# P1 — Reference inventory + batch hardening (#4 / #5)

## Goal

A destructive "Delete unused" action may only run when the reference inventory is
provably complete **and** includes the live (possibly unsaved) documents.

## Deliverables

### 1. New `src/data/referenceScan.ts`

```ts
import type { LabelDoc } from '../core/doc/types';
import type { LabelRepo } from './labelRepo';
import { collectReferencedIds, type ReferencedIds } from './orphans';

export interface ReferenceInventory extends ReferencedIds {
    /** Every stored label and every live doc was read successfully. */
    complete: boolean;
}

export interface ReferenceScanInput {
    labelRepo: LabelRepo | null;
    csvRepo: { list(): Promise<{ id: string }[]> } | null;
    resourceRepo: { list(): Promise<{ id: string }[]> } | null;
    /** Unsaved / history docs. `null`/`undefined` entries are ignored. */
    liveDocs?: readonly (LabelDoc | null | undefined)[];
}

export const scanReferences = async (input: ReferenceScanInput): Promise<ReferenceInventory>;
```

Behaviour (exact):

1. `labelRepo === null` → `{ csvIds: new Set(), resourceIds: new Set(), complete: true }`
   (storage not booted is not a read failure; preserves today's contract).
2. Use `labelRepo.listDetailed()`, **not** `list()`. If `errors.length > 0` the
   inventory is **incomplete** — but still include the readable docs.
3. For each summary id: `get()`. A `null` return **or** a throw marks the
   inventory incomplete and skips that doc. Do **not** abort the loop.
4. `csvRepo.list()` / `resourceRepo.list()`: a rejection marks incomplete and
   yields `[]` for that store. Use `Promise.allSettled` so one failure does not
   hide the other store.
5. Union the persisted docs with `liveDocs` (filter nullish) and call the
   existing `collectReferencedIds`.
6. Never throw.

Add a file-header doc comment explaining the safety invariant (under-reporting a
reference deletes live bytes; over-reporting only keeps a row).

### 2. Rewrite `src/components/gallery/useOrphans.ts`

Public API becomes:

```ts
export interface UseOrphansResult {
    csvIds: Set<string>;
    resourceIds: Set<string>;
    loading: boolean;
    /** False = the inventory could not be proven complete. */
    complete: boolean;
    /** Fresh scan (also publishes it). `null` if superseded/unmounted. */
    reload: () => Promise<ReferenceInventory | null>;
}
```

- `reload` reads live docs **non-reactively**:
  `const s = useStore.getState(); liveDocs = [s.currentDoc, ...s.docPast, ...s.docFuture]`.
  Do not subscribe to them (the sweep must not re-run per keystroke).
- Keep the monotonic `loadTokenRef`; return `null` when superseded.
- Keep `labelRepo === null` behaviour: empty, `complete: true`, `loading: false`.
- Publish the sets **before** returning, so the caller can `await reload()` and
  read the result directly.
- Do **not** keep an `error` field. Update the doc comment to match reality
  (the old one claims a top-level `list()` failure flips `error` — it cannot).
- Keep the mount effect + cleanup invalidation.

### 3. Update consumers for the new field and revalidation

`src/components/gallery/CsvSection.tsx` and `MediaSection.tsx`:

- Replace `orphans.error` with `!orphans.complete` for the `*orphanReadError`
  notice.
- Render the batch button only when `orphans.complete` is true **and**
  `orphanIds.length > 0`.
- `handleDeleteUnused`:
  ```ts
  if (orphanIds.length === 0) return;
  const shown = orphanIds;
  const ok = await confirm({ danger: true, message: t('csvs.deleteUnusedConfirm', { count: shown.length }) });
  if (!ok) return;
  const fresh = await orphans.reload();
  if (!fresh || !fresh.complete) {
      addNotification({ type: 'error', message: t('csvs.orphanReadError') });
      return;
  }
  const deletable = shown.filter((id) => fresh.csvIds.has(id));   // resourceIds for media
  for (const id of deletable) await remove(id);
  ```
- No new i18n keys in this phase.

### 4. Tests

`src/data/referenceScan.test.ts` (new):
- complete inventory from persisted docs + two stores;
- `listDetailed()` with `errors` → `complete: false` but readable docs still counted;
- `get()` returning `null` → incomplete;
- `get()` throwing → incomplete;
- catalogue `list()` rejection → incomplete, other store still counted;
- `liveDocs` union (a ref only in `currentDoc` is protected);
- `labelRepo === null` → complete + empty.

`src/components/gallery/useOrphans.test.tsx` (update):
- migrate the rejected-`list()` test to `listDetailed()` returning
  `{ ok: [], errors: [{ id: '', error: 'idb read failed' }] }` and assert
  `complete === false`;
- add: a doc ref held only in `currentDoc` (set `autoSave: false`) is protected;
- keep the null-repo and happy-path tests.

`CsvSection.dom.test.tsx` / `MediaSection.dom.test.tsx`:
- no "Delete unused" button when the scan is incomplete (fake repo returns
  `listDetailed` errors).

## Constraints

- Do not touch `src/store/**`, `LabelCard`, `GalleryView`, or `editorSlice` — P3.
- Do not add export/share, print, or preview work.
- No new dependencies.
- Match existing style: 4-space indent, single quotes, named exports, JSDoc on
  exported functions.
- Run `bun run test -- <changed test files>` (vitest file args), then report the
  exact command and result. Do not run the full suite (P4 does).

## Done when

- `bun run test -- src/data/referenceScan.test.ts src/components/gallery/useOrphans.test.tsx src/components/gallery/CsvSection.dom.test.tsx src/components/gallery/MediaSection.dom.test.tsx` passes.
- `npx tsc --noEmit` (or `bun run build`'s tsc step) is clean for the touched files.
- Receipt lists every file changed and any deviation from this plan.
