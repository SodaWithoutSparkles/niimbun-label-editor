import { useCallback, useEffect, useRef, useState } from 'react';
import type { LabelDoc } from '../../core/doc/types';
import { useStore } from '../../store/useStore';
import { collectReferencedIds, findOrphanIds } from '../../data/orphans';

/**
 * Orphan sweep loader (phase 9, W4; decision D5, risk R9c).
 *
 * Computes the ids of stored CSVs / resources that no document references. The
 * sweep is not a plain diff: `labelRepo.list()` summaries carry **no** refs, so
 * every document must be `get()`-ed (and gunzipped) to read its `data.csv` and
 * `resources.*`. That read is O(docs) and therefore async with a `loading` flag;
 * the gallery stays interactive while it runs.
 *
 * Resilience (R9c):
 *   - `labelRepo === null` (storage not booted) → empty sets, never an error;
 *   - a per-document `get()` that rejects or yields `null` is skipped, never
 *     fatal — one corrupt document must not hide the rest of the library;
 *   - a monotonic token makes only the newest load apply (StrictMode replay /
 *     unmount invalidates an in-flight load);
 *   - a top-level read failure flips `error` (the section surfaces it) instead
 *     of throwing into render.
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
    /** A top-level read (`list()`/catalogue `list()`) failed. */
    error: boolean;
    reload: () => Promise<void>;
}

export const useOrphans = (): UseOrphansResult => {
    const labelRepo = useStore((state) => state.labelRepo);
    const csvRepo = useStore((state) => state.csvRepo);
    const resourceRepo = useStore((state) => state.resourceRepo);

    const [csvIds, setCsvIds] = useState<Set<string>>(() => new Set());
    const [resourceIds, setResourceIds] = useState<Set<string>>(() => new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    /** Identity of the newest load; an older resolve is discarded. */
    const loadTokenRef = useRef(0);

    const reload = useCallback(async () => {
        const token = ++loadTokenRef.current;
        if (!labelRepo) {
            // Storage not booted (or unavailable): nothing is stored, so nothing
            // is orphaned — and this is not a read error.
            setCsvIds(new Set());
            setResourceIds(new Set());
            setLoading(false);
            setError(false);
            return;
        }

        setLoading(true);
        setError(false);
        try {
            const summaries = await labelRepo.list();
            const docs: LabelDoc[] = [];
            for (const summary of summaries) {
                try {
                    const doc = await labelRepo.get(summary.id);
                    if (doc) docs.push(doc);
                } catch {
                    // A corrupt/unreadable document is skipped: it must not abort
                    // the sweep (and `get()` already maps most failures to null).
                }
                if (token !== loadTokenRef.current) return;
            }

            const referenced = collectReferencedIds(docs);
            const [csvRecords, resourceRecords] = await Promise.all([
                csvRepo ? csvRepo.list() : Promise.resolve([]),
                resourceRepo ? resourceRepo.list() : Promise.resolve([]),
            ]);
            if (token !== loadTokenRef.current) return;

            setCsvIds(new Set(findOrphanIds(csvRecords.map((record) => record.id), referenced.csvIds)));
            setResourceIds(
                new Set(findOrphanIds(resourceRecords.map((record) => record.id), referenced.resourceIds)),
            );
            setLoading(false);
        } catch {
            if (token !== loadTokenRef.current) return;
            setCsvIds(new Set());
            setResourceIds(new Set());
            setLoading(false);
            setError(true);
        }
    }, [labelRepo, csvRepo, resourceRepo]);

    useEffect(() => {
        void reload();
        // Invalidate an in-flight load on cleanup (unmount / StrictMode replay).
        return () => {
            loadTokenRef.current++;
        };
    }, [reload]);

    return { csvIds, resourceIds, loading, error, reload };
};
