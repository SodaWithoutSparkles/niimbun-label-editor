import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { scanReferences, type ReferenceInventory } from '../../data/referenceScan';

/**
 * Orphan sweep loader (phase 9, W4; decision D5, risk R9c; hardened in the
 * 2026-10-22 storage-safety run, P1).
 *
 * Thin React wrapper over {@link scanReferences}: it publishes the two
 * **unreferenced** id sets plus `complete` ("the inventory could be proven") and
 * exposes a `reload()` that returns the freshly computed inventory so a
 * destructive action can re-validate after its confirm dialog.
 *
 * Resilience (R9c):
 *   - `labelRepo === null` (storage not booted) → empty sets, `complete: true`,
 *     `loading: false`, never a failure;
 *   - a per-document `get()` that rejects or yields `null`, a `listDetailed()`
 *     error list, or a catalogue `list()` rejection makes the inventory
 *     **incomplete** — the section then hides the destructive action instead of
 *     acting on a set it cannot trust;
 *   - a monotonic token makes only the newest load apply (StrictMode replay /
 *     unmount invalidates an in-flight load); `reload()` resolves `null` when
 *     superseded;
 *   - the live documents (`currentDoc`, `docPast`, `docFuture`) are read
 *     **non-reactively** via `useStore.getState()` at scan time, so the sweep
 *     does not re-run per keystroke.
 *
 * The hook is mounted by every consumer (both the CSV and Media sections), so
 * the sweep only runs while a section that shows it is on screen.
 */

export interface UseOrphansResult {
    /** Stored CSV ids no document references. */
    csvIds: Set<string>;
    /** Stored resource ids no document references. */
    resourceIds: Set<string>;
    loading: boolean;
    /** False = the inventory could not be proven complete. */
    complete: boolean;
    /** Fresh scan (also publishes it). `null` if superseded/unmounted. */
    reload: () => Promise<ReferenceInventory | null>;
}

export const useOrphans = (): UseOrphansResult => {
    const labelRepo = useStore((state) => state.labelRepo);
    const csvRepo = useStore((state) => state.csvRepo);
    const resourceRepo = useStore((state) => state.resourceRepo);

    const [csvIds, setCsvIds] = useState<Set<string>>(() => new Set());
    const [resourceIds, setResourceIds] = useState<Set<string>>(() => new Set());
    const [loading, setLoading] = useState(true);
    const [complete, setComplete] = useState(true);

    /** Identity of the newest load; an older resolve is discarded. */
    const loadTokenRef = useRef(0);

    const reload = useCallback(async (): Promise<ReferenceInventory | null> => {
        const token = ++loadTokenRef.current;
        if (!labelRepo) {
            // Storage not booted (or unavailable): nothing is stored, so nothing
            // is orphaned — and this is not a read error.
            const empty: ReferenceInventory = {
                csvIds: new Set(),
                resourceIds: new Set(),
                complete: true,
            };
            setCsvIds(empty.csvIds);
            setResourceIds(empty.resourceIds);
            setLoading(false);
            setComplete(true);
            return empty;
        }

        setLoading(true);
        // Read the live docs at scan time only — never subscribe to them, or the
        // O(docs) sweep would re-run on every keystroke.
        const state = useStore.getState();
        const inventory = await scanReferences({
            labelRepo,
            csvRepo,
            resourceRepo,
            liveDocs: [state.currentDoc, ...state.docPast, ...state.docFuture],
        });
        if (token !== loadTokenRef.current) return null;

        setCsvIds(inventory.csvIds);
        setResourceIds(inventory.resourceIds);
        setComplete(inventory.complete);
        setLoading(false);
        return inventory;
    }, [labelRepo, csvRepo, resourceRepo]);

    useEffect(() => {
        void reload();
        // Invalidate an in-flight load on cleanup (unmount / StrictMode replay).
        return () => {
            loadTokenRef.current++;
        };
    }, [reload]);

    return { csvIds, resourceIds, loading, complete, reload };
};
