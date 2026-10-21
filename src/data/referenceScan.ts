import type { LabelDoc } from '../core/doc/types';
import type { LabelRepo } from './labelRepo';
import { collectReferencedIds, findOrphanIds, type ReferencedIds } from './orphans';

/**
 * Reference inventory backing the gallery's destructive cleanup actions
 * (2026-10-22 storage-safety run, P1; issues #4 / #5).
 *
 * Safety invariant: under-reporting a reference would let the sweep delete bytes
 * a live document still needs, while over-reporting only keeps a row the user
 * could otherwise reclaim. Every read failure therefore only ever makes the
 * inventory **incomplete** (`complete: false`) — it never silently drops data —
 * and callers must not delete anything from an incomplete inventory.
 *
 * The sets are the **unreferenced** stored ids: `findOrphanIds(stored, referenced)`.
 * A store whose `list()` rejects yields an empty set for that store so a caller
 * sees nothing to delete there (and `complete` is false, so nothing runs).
 *
 * Live (possibly unsaved) documents are unioned in by the caller. The gallery's
 * hook passes `currentDoc` + `docPast` + `docFuture`, read non-reactively, so an
 * attached-but-not-yet-saved resource is protected without re-running the
 * O(docs) sweep on every keystroke.
 *
 * Residual (D-70): the scan is not atomic with the delete loop. A **second tab**
 * saving a label between the post-confirm re-scan and the delete can still lose
 * bytes; `StorageAdapter` has no transaction API. Single-tab is safe because the
 * live docs are part of the inventory.
 */

/** Stored CSV/resource ids that no document references, plus inventory health. */
export interface ReferenceInventory {
    /** Stored CSV ids no document references. */
    csvIds: Set<string>;
    /** Stored resource ids no document references. */
    resourceIds: Set<string>;
    /** Every stored label, catalogue listing and live doc was read successfully. */
    complete: boolean;
}

export interface ReferenceScanInput {
    labelRepo: LabelRepo | null;
    csvRepo: { list(): Promise<{ id: string }[]> } | null;
    resourceRepo: { list(): Promise<{ id: string }[]> } | null;
    /** Unsaved / history docs. `null`/`undefined` entries are ignored. */
    liveDocs?: readonly (LabelDoc | null | undefined)[];
}

/** `repo.list()` behind an async boundary, so a synchronous throw still rejects. */
const listCatalogue = async (
    repo: { list(): Promise<{ id: string }[]> } | null,
): Promise<{ id: string }[]> => (repo ? repo.list() : []);

/**
 * Read every stored label, union the live docs and diff both catalogue stores.
 *
 * Never throws: a missing repo means "storage not booted" (empty, complete), a
 * `listDetailed()` error list, a `get()` that returns `null` or throws, and a
 * catalogue `list()` rejection each flip `complete` to `false` while the
 * readable data is still counted.
 */
export const scanReferences = async (input: ReferenceScanInput): Promise<ReferenceInventory> => {
    if (!input.labelRepo) {
        // Storage not booted: nothing is stored, so nothing is orphaned — and
        // this is not a read failure (existing contract).
        return { csvIds: new Set(), resourceIds: new Set(), complete: true };
    }

    let complete = true;
    const docs: LabelDoc[] = [];

    try {
        const listed = await input.labelRepo.listDetailed();
        if (listed.errors.length > 0) {
            // An unreadable record may hold references we cannot see.
            complete = false;
        }
        for (const summary of listed.ok) {
            try {
                const doc = await input.labelRepo.get(summary.id);
                if (doc) docs.push(doc);
                else complete = false;
            } catch {
                // A corrupt document is skipped, never fatal: keep scanning so
                // the readable docs still protect their refs.
                complete = false;
            }
        }
    } catch {
        // Never throw out of the scan, even for a repo that throws instead of
        // reporting through `errors`.
        complete = false;
    }

    const [csvSettled, resourceSettled] = await Promise.allSettled([
        listCatalogue(input.csvRepo),
        listCatalogue(input.resourceRepo),
    ]);

    const storedIds = (result: PromiseSettledResult<{ id: string }[]>): string[] => {
        if (result.status === 'rejected') {
            complete = false;
            return [];
        }
        return result.value.map((record) => record.id);
    };
    const storedCsvIds = storedIds(csvSettled);
    const storedResourceIds = storedIds(resourceSettled);

    for (const doc of input.liveDocs ?? []) {
        if (doc) docs.push(doc);
    }

    let referenced: ReferencedIds = { csvIds: new Set(), resourceIds: new Set() };
    try {
        referenced = collectReferencedIds(docs);
    } catch {
        // Malformed live data: an empty reference set plus `complete: false`
        // is the safe answer (nothing destructive may run).
        complete = false;
    }

    return {
        csvIds: new Set(findOrphanIds(storedCsvIds, referenced.csvIds)),
        resourceIds: new Set(findOrphanIds(storedResourceIds, referenced.resourceIds)),
        complete,
    };
};
