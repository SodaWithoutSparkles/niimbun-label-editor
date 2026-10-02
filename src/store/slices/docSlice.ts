import i18next from 'i18next';
import { createLabelDoc } from '../../core/doc/factory';
import { isLabelDoc } from '../../core/doc/validate';
import { createIdbAdapter } from '../../data/db';
import { createLabelRepo } from '../../data/labelRepo';
import type { PrinterStatus } from '../../print/transport';
import type { StoreSlice } from '../storeTypes';

/**
 * Document library + shell slice.
 *
 * Owns the P2 "home surface" seam (`view`), the persisted-label gallery, the
 * currently open document, the printer-status mirror and the injected
 * `LabelRepo` handle. Kept as one slice because these are one concern — the
 * label library — and because the plan (§8) expected `docSlice.ts`.
 *
 * Deliberately NOT persisted (`useStore` `partialize`): `view` must default to
 * `gallery` after a reload and the gallery is read from IDB, not localStorage.
 *
 * User-facing strings go through the bare `i18next` package instance here, not
 * our `src/i18n` module: `i18n/index` imports `useStore`, which imports this
 * slice, so importing it back would create an eval-time cycle. The configured
 * instance is the same singleton, so `i18next.t` resolves once `main.tsx` runs
 * `i18n.init`.
 */

const DEFAULT_PRINTER_STATUS: PrinterStatus = { state: 'disconnected' };

/** Localized summary of per-record gallery read failures. */
const getErrorMessage = (errors: readonly { id: string; error: string }[]): string =>
    errors.length === 1
        ? errors[0]!.error
        : i18next.t('gallery.readErrors', { count: errors.length });

export const createDocSlice: StoreSlice = (set, get) => {
    /**
     * StrictMode-safe lazy persistence boot. A replayed mount would otherwise
     * open the IDB connection twice; the closure keeps a single in-flight
     * promise for the lifetime of this store instance. Tests inject a repo via
     * `setLabelRepo` *before* calling this, in which case no IDB is opened.
     */
    let initPromise: Promise<void> | null = null;

    return {
        // Shell view mode. `gallery` on reload — never persisted.
        view: 'gallery',
        setView: (view) => set({ view }),

        // Document library
        currentDoc: null,
        gallery: [],
        galleryLoading: true,
        storageError: false,
        labelRepo: null,

        printerStatus: DEFAULT_PRINTER_STATUS,
        setPrinterStatus: (printerStatus) => set({ printerStatus }),

        setLabelRepo: (labelRepo) => set({ labelRepo }),

        refreshGallery: async () => {
            const repo = get().labelRepo;
            if (!repo) {
                set({ gallery: [], galleryLoading: false });
                return;
            }
            set({ galleryLoading: true });
            try {
                const { ok, errors } = await repo.listDetailed();
                // Still render the readable summaries; only surface the failures.
                set({ gallery: ok, galleryLoading: false, storageError: false });
                if (errors.length > 0) {
                    get().addNotification({
                        type: 'error',
                        message: getErrorMessage(errors),
                    });
                }
            } catch {
                // Never blank the app on a storage failure: show empty, stop spinner.
                set({ gallery: [], galleryLoading: false });
            }
        },

        createLabel: async (spec) => {
            const repo = get().labelRepo;
            if (!repo) return null;
            // Fence at the boundary: refuse to persist a structurally invalid doc.
            // (Reused by import/duplicate in P8.) `isLabelDoc` never throws.
            const built = createLabelDoc(spec);
            const result = isLabelDoc(built);
            if (!result.ok) return null;
            const doc = result.doc;
            try {
                await repo.save(doc);
            } catch {
                return null;
            }
            await get().refreshGallery();
            return doc;
        },

        openLabel: async (id) => {
            const repo = get().labelRepo;
            if (!repo) return null;
            const doc = await repo.get(id);
            if (!doc) return null;
            set({ currentDoc: doc, view: 'editor' });
            return doc;
        },

        deleteLabel: async (id) => {
            const repo = get().labelRepo;
            if (!repo) return;
            try {
                await repo.remove(id);
            } catch {
                // A failed delete must still refresh and report, not silently
                // leave the card on screen with no feedback.
                get().addNotification({ type: 'error', message: i18next.t('gallery.deleteFailed') });
            }
            set((state) => ({
                currentDoc: state.currentDoc?.meta.id === id ? null : state.currentDoc,
            }));
            await get().refreshGallery();
        },

        initPersistence: () => {
            if (!initPromise) {
                initPromise = (async () => {
                    // An injected repo (tests) wins over the real IDB adapter.
                    if (!get().labelRepo) {
                        const adapter = await createIdbAdapter();
                        // `setLabelRepo` may have landed while IDB was opening;
                        // an injected repo still wins over the real one.
                        if (!get().labelRepo) {
                            set({ labelRepo: createLabelRepo(adapter) });
                        }
                    }
                    set({ storageError: false });
                    await get().refreshGallery();
                })().catch(() => {
                    // A storage boot failure must not block the gallery shell,
                    // but it must be distinguishable from a genuinely empty
                    // library — and retryable. Clearing `initPromise` lets the
                    // next call try again instead of caching the rejection.
                    initPromise = null;
                    set({ storageError: true, galleryLoading: false });
                });
            }
            return initPromise;
        },
    };
};
