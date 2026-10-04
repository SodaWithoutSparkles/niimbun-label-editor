import i18next from 'i18next';
import { createLabelDoc } from '../../core/doc/factory';
import { isLabelDoc } from '../../core/doc/validate';
import { createIdbAdapter } from '../../data/db';
import { createLabelRepo } from '../../data/labelRepo';
import type { LabelDoc } from '../../core/doc/types';
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
        setView: (view) => {
            // Leaving the editor must not drop a pending autosave: flush it
            // before the view changes (the timer would otherwise fire with
            // `view !== 'editor'` and silently discard the edit).
            if (get().view === 'editor' && view !== 'editor') get().flushAutosave();
            set({ view });
        },

        // Document library
        currentDoc: null,
        // Explicit-save timestamp (ms epoch) for the BottomBar readout. `null`
        // until the user saves the open document. Owned here so the writer and
        // the reader share one slice.
        lastSavedAt: null,
        setLastSavedAt: (timestamp) => set({ lastSavedAt: timestamp }),
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
            //
            // This action is contractually non-throwing: the factory/validator run
            // synchronously (a throw there would reject the caller's `await` and,
            // before the dialog's try/finally, left its `saving` flag stuck), and
            // `repo.save` can reject on a real IDB transaction. Every failure
            // becomes `null` so the caller surfaces one visible error path.
            let doc: LabelDoc;
            try {
                const built = createLabelDoc(spec);
                const result = isLabelDoc(built);
                if (!result.ok) return null;
                doc = result.doc;
                await repo.save(doc);
            } catch {
                return null;
            }
            // The doc is saved; a gallery-refresh failure must not turn a
            // successful create into a reported failure.
            try {
                await get().refreshGallery();
            } catch {
                // `refreshGallery` owns its error surface; never reject here.
            }
            return doc;
        },

        openLabel: async (id) => {
            const repo = get().labelRepo;
            if (!repo) return null;
            const doc = await repo.get(id);
            if (!doc) return null;
            // Doc-switch boundary: flush any pending autosave for the doc we are
            // leaving (so its last edit is not dropped), then drop its undo
            // history and transient baseline (so undo/redo can never apply doc
            // A's snapshots to doc B).
            get().flushAutosave();
            get().clearDocHistory();
            // Default view orientation for this document (view-only, §6). Done
            // here — the single doc-open boundary — so it never re-fires from a
            // render or resize. Re-arm the auto-pick first so a manual toggle
            // from the previous document does not leak into this one.
            get().resetViewOrientation();
            get().applyDefaultViewOrientation(doc.label.backingW, doc.label.backingH);
            set({ currentDoc: doc, view: 'editor' });
            return doc;
        },

        saveCurrentLabel: async () => {
            const doc = get().currentDoc;
            // No open document (gallery) or no storage: a silent no-op, matching
            // the rest of the slice's gallery behaviour.
            const repo = get().labelRepo;
            if (!doc || !repo) return false;
            // Cancel/flush the pending debounced autosave first. The explicit
            // save captures the doc *now*, so a timer left armed would fire
            // after `repo.save` resolves and rewrite the older captured doc
            // (setting `updatedAt`/`lastAutoSaveAt` after this save). `flush`
            // is the existing boundary seam: it writes the pending doc if there
            // is one, then clears the timer.
            get().flushAutosave();
            // Stamp fresh activity so the gallery sorts the explicit save to the
            // top; shallow-copy so the state update is observable.
            const updated: LabelDoc = { ...doc, meta: { ...doc.meta, updatedAt: Math.floor(Date.now() / 1000) } };
            try {
                await repo.save(updated);
            } catch {
                get().addNotification({ type: 'error', message: i18next.t('errors.saveFailed') });
                return false;
            }
            // Identity guard: a committed edit while `repo.save` was in flight
            // replaced `currentDoc` with a newer object. Do not revert it to
            // `updated` (that would silently drop the edit and desync `docPast`
            // from IDB). The save still happened, so record its timestamp.
            if (get().currentDoc === doc) {
                set({ currentDoc: updated });
            }
            get().setLastSavedAt(Date.now());
            // A refresh failure must not turn a successful save into a failure.
            try {
                await get().refreshGallery();
            } catch {
                // `refreshGallery` owns its error surface.
            }
            return true;
        },

        deleteLabel: async (id) => {
            const repo = get().labelRepo;
            if (!repo) return;
            const closingCurrent = get().currentDoc?.meta.id === id;
            if (closingCurrent) {
                // The open doc is being removed: flush its pending save first
                // (harmless if it was already saved), then discard history that
                // can no longer be meaningfully undone.
                get().flushAutosave();
                get().clearDocHistory();
            }
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
