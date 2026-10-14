import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';

/**
 * Repo-agnostic catalogue access for the gallery sections (phase 9, W1).
 *
 * Extracted from `usePaperTypes` (phase 8) so the CSV and media sections can
 * share one shape. The hook knows nothing about *what* it lists: it takes any
 * repo exposing `list`/`put`/`remove` and pre-resolved failure strings.
 *
 * Every failure is surfaced — a `list()` rejection flips `error` (the section
 * renders a read-error state) and a failed `put`/`remove` calls
 * `addNotification`. Nothing here is silent.
 *
 * StrictMode + the async read: a mount/cleanup/mount replay starts two
 * overlapping `list()` calls. A monotonic token makes only the newest load
 * apply, so a stale resolve can never clobber newer state (and a genuine
 * unmount invalidates any in-flight load).
 */

/** The subset of a repo a catalogue needs. `PaperRepo`/`CsvRepo`/… satisfy it. */
export interface CatalogueRepo<T> {
    list(): Promise<T[]>;
    put(record: T): Promise<void>;
    remove(id: string): Promise<void>;
}

/**
 * Failure messages for the mutations. Pass **pre-resolved `t()` strings** — the
 * hook must not build dynamic i18n keys (that would defeat the typed-key rule).
 */
export interface CatalogueMessages {
    saveFailed: string;
    deleteFailed: string;
}

export interface UseCatalogueOptions<T> {
    /** `null` means storage is not booted: an empty catalogue, never an error. */
    repo: CatalogueRepo<T> | null;
    messages: CatalogueMessages;
}

export interface UseCatalogueResult<T> {
    items: T[];
    loading: boolean;
    /** A `list()` read failed (distinct from a genuinely empty catalogue). */
    error: boolean;
    reload: () => Promise<void>;
    /** `put` then reload; `false` (and a notification) on failure. */
    save: (record: T) => Promise<boolean>;
    /** `remove` then reload; `false` (and a notification) on failure. */
    remove: (id: string) => Promise<boolean>;
}

export const useCatalogue = <T>({
    repo,
    messages,
}: UseCatalogueOptions<T>): UseCatalogueResult<T> => {
    const addNotification = useStore((state) => state.addNotification);
    const { saveFailed, deleteFailed } = messages;

    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    /** Identity of the newest load; an older resolve is discarded. */
    const loadTokenRef = useRef(0);

    const reload = useCallback(async () => {
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
    }, [repo]);

    useEffect(() => {
        void reload();
        // Invalidate an in-flight load on cleanup (unmount / StrictMode replay).
        return () => {
            loadTokenRef.current++;
        };
    }, [reload]);

    const save = useCallback(
        async (record: T): Promise<boolean> => {
            if (!repo) {
                addNotification({ type: 'error', message: saveFailed });
                return false;
            }
            try {
                await repo.put(record);
            } catch {
                addNotification({ type: 'error', message: saveFailed });
                return false;
            }
            await reload();
            return true;
        },
        [repo, addNotification, reload, saveFailed],
    );

    const remove = useCallback(
        async (id: string): Promise<boolean> => {
            if (!repo) {
                addNotification({ type: 'error', message: deleteFailed });
                return false;
            }
            try {
                await repo.remove(id);
            } catch {
                addNotification({ type: 'error', message: deleteFailed });
                return false;
            }
            await reload();
            return true;
        },
        [repo, addNotification, reload, deleteFailed],
    );

    return { items, loading, error, reload, save, remove };
};
