import { useEffect } from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from '../../store/useStore';
import type { AppState } from '../../store/storeTypes';
import { DEFAULT_URL_STATE, buildHash, parseHash, type UrlState } from '../../utils/urlHash';

/**
 * Hash-routing **wiring** (backlog: "Fix navigation"): binds the store to
 * `window.location.hash`. The pure address grammar lives in `utils/urlHash`;
 * this module owns the effects and nothing else —
 *
 *   (a) apply the URL on boot,
 *   (b) apply on `hashchange` (browser back/forward),
 *   (c) write the hash when the store fields change.
 *
 * It sits in `components/` because it imports React and the store instance; the
 * lane for the pure half is `utils/`.
 *
 * `view` and `gallerySection` stay deliberately unpersisted (`useStore`
 * `partialize`); the URL is the only thing that restores them, so a reload with
 * no hash still lands in the gallery.
 *
 * Re-entrancy is handled by ONE token — `lastWritten`, the canonical hash this
 * instance last applied or wrote:
 *   - a write that would reproduce `lastWritten` is skipped, so the apply it
 *     causes cannot write again;
 *   - a `hashchange` equal to `lastWritten` is our own echo and is ignored, so a
 *     write is not re-applied.
 * Two more guards make the async half safe: `applying` suppresses writes while
 * an apply is in flight, and a monotonic `applied` generation lets a superseded
 * apply bail instead of overwriting the newer address (see `settle`).
 */

/**
 * The store surface this module needs. A `Pick` of zustand's API so a test can
 * inject `createAppStore(...)` (or a trivial fake) instead of the app singleton.
 */
export type UrlSyncStore = Pick<StoreApi<AppState>, 'getState' | 'setState' | 'subscribe'>;

/** The store → URL projection. */
export const readState = (state: AppState): UrlState => ({
    view: state.view,
    docId: state.currentDoc?.meta.id ?? null,
    section: state.gallerySection,
    settingsOpen: state.isSettingsOpen,
});

/**
 * Push a parsed URL state into the store. Every write is guarded by a
 * comparison, so applying the state the store is already in never notifies a
 * subscriber (which is what keeps the URL→store→URL cycle from spinning).
 *
 * Async because adopting a document goes through `openLabel` (the identity check
 * and the IDB read). Never rejects: every repo path it touches is non-throwing,
 * and an unknown/deleted id simply leaves the gallery in place.
 *
 * The view is only ever changed through `setView`/`openLabel` — never by writing
 * `view` directly — because `setView` flushes a pending autosave on the way out
 * of the editor and closes the (editor-only) print dialog.
 *
 * `isStale` is the caller's generation check (see `subscribeUrlSync`): a
 * superseded apply stops here rather than fighting the newer address for the
 * store.
 */
export const applyHash = async (
    state: UrlState,
    store: UrlSyncStore = useStore,
    isStale?: () => boolean,
): Promise<void> => {
    // 1. Settings overlay.
    const initial = store.getState();
    if (state.settingsOpen !== initial.isSettingsOpen) {
        if (state.settingsOpen) initial.openSettings();
        else initial.closeSettings();
    }

    // 2. View + document identity.
    const docId = state.view === 'editor' ? state.docId : null;
    const current = store.getState();
    if (docId !== null && docId.length > 0) {
        if (current.currentDoc?.meta.id === docId) {
            // Back/forward into the document that is still loaded: re-enter the
            // editor without re-reading (or re-decoding) it.
            if (current.view !== 'editor') current.setView('editor');
        } else {
            // A *different* document. The print dialog belongs to the document
            // we are leaving, and `openLabel` swaps `currentDoc` without touching
            // it — close it through the store's own action so a dialog for A can
            // never survive into B. (`setView('gallery')` would close it too, but
            // it fires the autosave flush without awaiting it, which would break
            // the ordering `openLabel` promises below.)
            if (current.isPrintOpen) current.closePrint();
            // No repo yet (a deep link racing `initPersistence`): open nothing —
            // `subscribeUrlSync` retries once the repo lands. Otherwise
            // `openLabel` awaits the leaving document's pending autosave, so A's
            // write settles before B becomes current.
            if (current.labelRepo) await current.openLabel(docId);
            // A newer address arrived while the read was in flight. `openLabel`
            // has already committed a view, so the caller re-asserts the newest
            // state (`settle`); do no further work for this stale apply.
            if (isStale?.()) return;
            // A confirmed miss (deleted/unknown id) must land in the gallery, not
            // strand the previous document's editor. `setView('gallery')` is the
            // store's own boundary: it flushes the leaving document's pending
            // autosave and closes the editor-only print dialog.
            const latest = store.getState();
            if (latest.currentDoc?.meta.id !== docId && latest.view !== 'gallery') {
                latest.setView('gallery');
            }
        }
    } else if (current.view !== 'gallery') {
        current.setView('gallery');
    }

    // 3. Gallery section — only meaningful on the gallery surface. An editor URL
    //    says nothing about the section, so it must not disturb the user's pick
    //    (including when that URL failed to resolve and left us in the gallery).
    if (state.view === 'gallery') {
        const latest = store.getState();
        if (latest.gallerySection !== state.section) latest.setGallerySection(state.section);
    }
};

/** `location.hash` (empty when there is no window, e.g. a headless context). */
const readLocationHash = (): string => (typeof window === 'undefined' ? '' : window.location.hash);

/**
 * Write the hash. `replace` swaps the current history entry (corrections and the
 * settings close transition) instead of pushing a new one, so a corrected or
 * transient address cannot be navigated back to.
 */
const writeLocationHash = (hash: string, replace = false): void => {
    if (typeof window === 'undefined') return;
    if (replace && typeof window.history?.replaceState === 'function') {
        try {
            window.history.replaceState(null, '', hash);
            return;
        } catch {
            // Sandboxed frame / blocked history: fall through to the write.
        }
    }
    window.location.hash = hash;
};

/**
 * Bind the store to the URL. Returns the unsubscribe function (listener removal
 * + the store subscription), so a StrictMode double-mount installs and removes
 * cleanly and never ends up with two live writers.
 */
export const subscribeUrlSync = (store: UrlSyncStore = useStore): (() => void) => {
    /** The canonical hash this instance last applied or wrote. */
    let lastWritten: string | null = null;
    /** Monotonic apply generation: every location change (and re-assert) bumps it. */
    let applied = 0;
    /** > 0 while an async apply is in flight. */
    let applying = 0;
    /** The newest state the URL asked for. */
    let desired: UrlState = DEFAULT_URL_STATE;
    /** A document the URL asked for before any repo existed (boot race). */
    let awaitingRepoFor: string | null = null;
    let disposed = false;

    const writeFromStore = (replace = false) => {
        if (disposed || applying > 0 || awaitingRepoFor !== null) return;
        const state = store.getState();
        const next = buildHash(readState(state));
        if (next === lastWritten) return;
        // Closing the modal replaces the entry the open pushed. A push here would
        // make Back reopen Settings, and every open/close cycle would leave
        // another entry behind.
        const closingSettings =
            !state.isSettingsOpen && lastWritten !== null && parseHash(lastWritten).settingsOpen;
        lastWritten = next;
        writeLocationHash(next, replace || closingSettings);
    };

    const settle = (generation: number) => {
        applying -= 1;
        if (disposed) return;
        if (generation !== applied) {
            // Superseded by a newer address. The async half of this apply may
            // still have moved the store (a late `openLabel` resolving), so
            // re-assert the newest state instead of trusting either outcome; it
            // is a no-op whenever nothing moved. `runApply` is idempotent, so
            // this converges and can never loop.
            if (buildHash(readState(store.getState())) !== buildHash(desired)) runApply();
            return;
        }
        const wanted = desired.view === 'editor' ? desired.docId : null;
        const state = store.getState();
        const unresolved = wanted !== null && state.currentDoc?.meta.id !== wanted;
        if (unresolved && state.labelRepo === null) {
            // Retry once a repo exists; "no repo yet" is the only recoverable
            // miss (an id the repo *did* answer for is final).
            awaitingRepoFor = wanted;
            return;
        }
        awaitingRepoFor = null;
        // A document the URL asked for but storage cannot produce: rewrite the
        // address to the state we actually reached, in place.
        writeFromStore(unresolved);
    };

    /** Start an apply of `desired`; every call takes a fresh generation. */
    const runApply = () => {
        const generation = ++applied;
        applying += 1;
        // Both branches settle the counter: a rejection here must not wedge the
        // write direction off for the rest of the session.
        void applyHash(desired, store, () => generation !== applied).then(
            () => settle(generation),
            () => settle(generation),
        );
    };

    const applyFromLocation = () => {
        if (disposed) return;
        const hash = readLocationHash();
        if (hash === lastWritten) return; // echo of our own write
        desired = parseHash(hash);
        // Record the canonical form BEFORE applying: the store writes the apply
        // triggers must not look like an external change.
        lastWritten = buildHash(desired);
        runApply();
    };

    const onStoreChange = () => {
        if (disposed) return;
        if (awaitingRepoFor !== null) {
            const state = store.getState();
            if (applying > 0) return;
            if (state.labelRepo !== null) {
                awaitingRepoFor = null;
                runApply();
            } else if (!state.galleryLoading) {
                // Storage boot settled without ever publishing a repo
                // (`storageError`): this request can never resolve, so drop it —
                // otherwise the write direction stays suppressed for the session
                // and the URL stops following the store.
                awaitingRepoFor = null;
                writeFromStore(true);
            }
            return;
        }
        writeFromStore();
    };

    // (a) Adopt whatever the URL says now. A boot with no hash writes nothing:
    //     its canonical `#/gallery` equals `lastWritten`, so no history entry is
    //     created for a plain load (`view`/`gallerySection` are unpersisted, so
    //     the "no hash" default is already the store's state).
    applyFromLocation();
    // (c) store → URL.
    const unsubscribe = store.subscribe(onStoreChange);
    // (b) browser back/forward.
    if (typeof window !== 'undefined') window.addEventListener('hashchange', applyFromLocation);

    return () => {
        disposed = true;
        unsubscribe();
        if (typeof window !== 'undefined') window.removeEventListener('hashchange', applyFromLocation);
    };
};

/**
 * React binding: install the sync for the lifetime of the component that calls
 * it (`App`). Idempotent under StrictMode's mount/unmount/replay — each mount
 * subscribes and each cleanup removes exactly what it added.
 */
export const useUrlSync = (): void => {
    useEffect(() => subscribeUrlSync(useStore), []);
};
