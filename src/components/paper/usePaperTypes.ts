import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaperRecord } from '../../data/paperRepo';
import { useStore } from '../../store/useStore';

/**
 * Paper-type catalogue access for the gallery's paper-type section (phase 8,
 * W4b).
 *
 * Loads `paperRepo.list()` on mount (and whenever the injected repo identity
 * changes) and exposes `reload` plus two storage-failure-reporting mutations.
 * Every failure is surfaced — a `list()` rejection flips `error` (the section
 * renders a read-error state) and a failed `put`/`remove` calls
 * `addNotification`, mirroring `gallery.deleteFailed` (`docSlice.ts`). Nothing
 * here is silent.
 *
 * StrictMode + the async read: a mount/cleanup/mount replay starts two
 * overlapping `list()` calls. A monotonic token makes only the newest load
 * apply, so a stale resolve can never clobber newer state (and a genuine
 * unmount invalidates any in-flight load).
 */

export interface UsePaperTypesResult {
    items: PaperRecord[];
    loading: boolean;
    /** A `list()` read failed (distinct from a genuinely empty catalogue). */
    error: boolean;
    reload: () => Promise<void>;
    /** `put` then reload; `false` (and a notification) on failure. */
    save: (record: PaperRecord) => Promise<boolean>;
    /** `remove` then reload; `false` (and a notification) on failure. */
    remove: (id: string) => Promise<boolean>;
}

export const usePaperTypes = (): UsePaperTypesResult => {
    const { t } = useTranslation();
    const paperRepo = useStore((state) => state.paperRepo);
    const addNotification = useStore((state) => state.addNotification);

    const [items, setItems] = useState<PaperRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    /** Identity of the newest load; an older resolve is discarded. */
    const loadTokenRef = useRef(0);

    const reload = useCallback(async () => {
        const repo = paperRepo;
        const token = ++loadTokenRef.current;
        if (!repo) {
            // Storage not booted (or unavailable): empty, not an error — there is
            // nothing to read and the seeded catalogue is not injected yet.
            setItems([]);
            setLoading(false);
            setError(false);
            return;
        }
        setLoading(true);
        setError(false);
        try {
            const records = await repo.list();
            if (token !== loadTokenRef.current) return;
            setItems(records);
            setLoading(false);
        } catch {
            if (token !== loadTokenRef.current) return;
            setItems([]);
            setLoading(false);
            setError(true);
        }
    }, [paperRepo]);

    useEffect(() => {
        void reload();
        // Invalidate an in-flight load on cleanup (unmount / StrictMode replay).
        return () => {
            loadTokenRef.current++;
        };
    }, [reload]);

    const save = useCallback(
        async (record: PaperRecord): Promise<boolean> => {
            const repo = paperRepo;
            if (!repo) {
                addNotification({ type: 'error', message: t('paperTypes.saveFailed') });
                return false;
            }
            try {
                await repo.put(record);
            } catch {
                addNotification({ type: 'error', message: t('paperTypes.saveFailed') });
                return false;
            }
            await reload();
            return true;
        },
        [paperRepo, addNotification, reload, t],
    );

    const remove = useCallback(
        async (id: string): Promise<boolean> => {
            const repo = paperRepo;
            if (!repo) {
                addNotification({ type: 'error', message: t('paperTypes.deleteFailed') });
                return false;
            }
            try {
                await repo.remove(id);
            } catch {
                addNotification({ type: 'error', message: t('paperTypes.deleteFailed') });
                return false;
            }
            await reload();
            return true;
        },
        [paperRepo, addNotification, reload, t],
    );

    return { items, loading, error, reload, save, remove };
};
