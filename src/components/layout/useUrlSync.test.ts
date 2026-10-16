// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import type { LabelRepo } from '../../data/labelRepo';
import { createAppStore } from '../../store/useStore';
import { DEFAULT_URL_STATE, buildHash, parseHash, type UrlState } from '../../utils/urlHash';
import { applyHash, readState, subscribeUrlSync } from './useUrlSync';

/** Minimal in-memory Storage, mirroring the other store tests. */
const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => {
            map.delete(key);
        },
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
};

/** A `UrlState` literal, so the expectations below stay readable. */
const state = (patch: Partial<UrlState> = {}): UrlState => ({ ...DEFAULT_URL_STATE, ...patch });

/** A repo over a fixed doc map; every method is present, nothing throws. */
const makeRepo = (docs: Record<string, LabelDoc>): LabelRepo => ({
    list: async () => [],
    listDetailed: async () => ({ ok: [], errors: [] }),
    get: async (id: string) => docs[id] ?? null,
    save: async () => undefined,
    saveAll: async () => ({ ok: [], errors: [] }),
    remove: async () => undefined,
    putThumb: async () => undefined,
    getThumb: async () => null,
    removeThumb: async () => undefined,
});

const DOC_A = 'doc-a';
const DOC_B = 'doc-b';
const doc = (id: string): LabelDoc => createLabelDoc({ id, name: id });

type Store = ReturnType<typeof createAppStore>;

/**
 * happy-dom dispatches `hashchange`/`popstate` on a task after the hash is
 * assigned (and `history.back()` is a task too), so a macrotask flush lets the
 * browser half settle. Deterministic (no timer whose flush ordering we cannot
 * observe) and cheap.
 */
const flush = (): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

describe('readState / applyHash — the store projection', () => {
    it('is the gallery defaults for a fresh store', () => {
        const store = createAppStore(makeStorage());
        expect(readState(store.getState())).toEqual(DEFAULT_URL_STATE);
    });

    it('notifies nobody when the store already matches', () => {
        const store = createAppStore(makeStorage());
        let notifications = 0;
        store.subscribe(() => {
            notifications += 1;
        });
        void applyHash(DEFAULT_URL_STATE, store);
        expect(notifications).toBe(0);
    });

    it('is a no-op when the requested doc cannot be resolved (unknown repo)', async () => {
        const store = createAppStore(makeStorage());
        await applyHash(state({ view: 'editor', docId: 'gone' }), store);
        expect(store.getState().view).toBe('gallery');
        expect(store.getState().currentDoc).toBeNull();
    });
});

describe('subscribeUrlSync — store ⇄ URL', () => {
    const cleanups: Array<() => void> = [];

    /** `subscribeUrlSync` + registration for the afterEach teardown. */
    const install = (store: Store): (() => void) => {
        const uninstall = subscribeUrlSync(store);
        cleanups.push(uninstall);
        return uninstall;
    };

    beforeEach(() => {
        // Each test starts at the bare origin, exactly like a fresh tab.
        window.history.replaceState(null, '', '/');
    });

    afterEach(() => {
        while (cleanups.length > 0) cleanups.pop()!();
    });

    it('applies the URL on boot', () => {
        const store = createAppStore(makeStorage());
        window.location.hash = '#/gallery/paper';
        install(store);
        expect(store.getState().gallerySection).toBe('paper');
    });

    it('writes the hash when the store changes', async () => {
        const store = createAppStore(makeStorage());
        install(store);
        // Boot with no hash keeps it absent rather than pushing `#/gallery`
        // (which would cost a history entry on every plain load).
        expect(window.location.hash).toBe('');

        store.getState().setGallerySection('csv');
        // happy-dom applies a location write on its own task, so the value is
        // observed after the flush; the write itself is issued synchronously.
        await flush();
        expect(window.location.hash).toBe('#/gallery/csv');
        expect(store.getState().gallerySection).toBe('csv');
    });

    it('applies a hashchange (browser back/forward)', async () => {
        const store = createAppStore(makeStorage());
        install(store);

        window.location.hash = '#/gallery/media';
        await flush();
        expect(store.getState().gallerySection).toBe('media');
    });

    it('does not loop: one entry per user change, no echo writes', async () => {
        const store = createAppStore(makeStorage());
        install(store);

        // store → URL: one push, and the hashchange our write causes must not
        // be applied back (the guard would otherwise re-enter through applyHash).
        const bootEntries = window.history.length;
        store.getState().setGallerySection('paper');
        await flush();
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        expect(window.history.length).toBe(bootEntries + 1);

        // URL → store: an external hashchange applies once and writes nothing.
        const externalEntries = window.history.length;
        window.location.hash = '#/gallery/csv';
        await flush();
        await flush();
        expect(store.getState().gallerySection).toBe('csv');
        expect(window.location.hash).toBe('#/gallery/csv');
        expect(window.history.length).toBe(externalEntries + 1);
    });

    it('follows real browser back/forward', async () => {
        const store = createAppStore(makeStorage());
        install(store);

        store.getState().setGallerySection('paper'); // push #/gallery/paper
        await flush();
        store.getState().setGallerySection('csv'); // push #/gallery/csv
        await flush();
        expect(window.location.hash).toBe('#/gallery/csv');

        window.history.back(); // → #/gallery/paper
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        expect(store.getState().gallerySection).toBe('paper');

        window.history.forward(); // → #/gallery/csv
        await flush();
        expect(window.location.hash).toBe('#/gallery/csv');
        expect(store.getState().gallerySection).toBe('csv');

        // Traversal must not extend the history (no echo writes).
        const entries = window.history.length;
        window.history.back();
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        expect(window.history.length).toBe(entries);
    });

    it('opens a document from `#/editor?doc=`', async () => {
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(makeRepo({ [DOC_A]: doc(DOC_A) }));
        window.location.hash = `#/editor?doc=${DOC_A}`;
        install(store);

        await flush();
        expect(store.getState().view).toBe('editor');
        expect(store.getState().currentDoc?.meta.id).toBe(DOC_A);
        expect(window.location.hash).toBe(`#/editor?doc=${DOC_A}`);
    });

    it('deep-links a document whose id needs percent-encoding', async () => {
        const store = createAppStore(makeStorage());
        // Escape-like text (`%2F`, `%25`), query/fragment separators, spaces and
        // non-ASCII: a second decode anywhere in the path corrupts this id.
        const id = 'lbl %2F %25 / ? & # + ü 😀';
        store.getState().setLabelRepo(makeRepo({ [id]: createLabelDoc({ id, name: 'Nasty' }) }));
        window.location.hash = buildHash(state({ view: 'editor', docId: id }));
        install(store);

        await flush();
        expect(store.getState().view).toBe('editor');
        expect(store.getState().currentDoc?.meta.id).toBe(id);
        expect(parseHash(window.location.hash).docId).toBe(id);
    });

    it('drops to the gallery when the repo cannot resolve the id', async () => {
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(makeRepo({ [DOC_A]: doc(DOC_A) }));
        window.location.hash = `#/editor?doc=${DOC_A}`;
        install(store);
        await flush();
        expect(store.getState().view).toBe('editor');
        store.getState().openPrint();
        expect(store.getState().isPrintOpen).toBe(true);

        const before = window.history.length;
        window.location.hash = '#/editor?doc=gone';
        await flush();
        await flush();

        // Not the previous document's editor: a confirmed miss lands in the
        // gallery. `setView('gallery')` is the store's Home boundary, so it
        // keeps `currentDoc` (like the header's Home action) — which is what
        // lets Back re-enter A without a re-read — and it closes the print
        // dialog that belonged to A.
        expect(store.getState().view).toBe('gallery');
        expect(store.getState().currentDoc?.meta.id).toBe(DOC_A);
        expect(store.getState().isPrintOpen).toBe(false);
        expect(window.location.hash).toBe('#/gallery');
        expect(window.history.length).toBe(before + 1); // corrected in place

        window.history.back();
        await flush();
        expect(store.getState().view).toBe('editor');
        expect(store.getState().currentDoc?.meta.id).toBe(DOC_A);
        expect(window.location.hash).toBe(`#/editor?doc=${DOC_A}`);
        expect(window.history.length).toBe(before + 1); // no ping-pong entries
    });

    it('closes the print dialog when the address switches documents', async () => {
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(makeRepo({ [DOC_A]: doc(DOC_A), [DOC_B]: doc(DOC_B) }));
        window.location.hash = `#/editor?doc=${DOC_A}`;
        install(store);
        await flush();
        expect(store.getState().currentDoc?.meta.id).toBe(DOC_A);

        store.getState().openPrint();
        expect(store.getState().isPrintOpen).toBe(true);

        window.location.hash = `#/editor?doc=${DOC_B}`;
        await flush();
        await flush();

        expect(store.getState().view).toBe('editor');
        expect(store.getState().currentDoc?.meta.id).toBe(DOC_B);
        // The dialog belonged to A and must not survive into B.
        expect(store.getState().isPrintOpen).toBe(false);
        expect(window.location.hash).toBe(`#/editor?doc=${DOC_B}`);
    });

    it('a superseded apply cannot resurrect the old address', async () => {
        const store = createAppStore(makeStorage());
        // A read we control, so the first apply is still in flight when the
        // address changes underneath it.
        let release!: (doc: LabelDoc | null) => void;
        const gate = new Promise<LabelDoc | null>((resolve) => {
            release = resolve;
        });
        store.getState().setLabelRepo({ ...makeRepo({}), get: () => gate });

        window.location.hash = `#/editor?doc=${DOC_A}`;
        install(store);
        await flush();
        expect(store.getState().view).toBe('gallery'); // still waiting on the read

        window.location.hash = '#/gallery'; // supersede with a newer address
        await flush();
        const entries = window.history.length;

        release(doc(DOC_A)); // the old read lands late
        await flush();
        await flush();

        // The newer address wins on both surfaces.
        expect(store.getState().view).toBe('gallery');
        expect(window.location.hash).toBe('#/gallery');
        expect(window.history.length).toBe(entries);
    });

    it('settings: pushes on open, replaces on close, Back reaches the route', async () => {
        const store = createAppStore(makeStorage());
        install(store);

        store.getState().setGallerySection('paper'); // the pre-settings route
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        const base = window.history.length;

        store.getState().openSettings();
        await flush();
        expect(window.location.hash).toBe('#settings');
        expect(window.history.length).toBe(base + 1);

        store.getState().closeSettings();
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        expect(window.history.length).toBe(base + 1); // replaced, not pushed

        // A second cycle must not accumulate entries.
        store.getState().openSettings();
        await flush();
        expect(window.location.hash).toBe('#settings');
        expect(window.history.length).toBe(base + 2);
        store.getState().closeSettings();
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        expect(window.history.length).toBe(base + 2);

        // Back lands on the pre-settings route with the modal closed, and does
        // not reopen Settings.
        window.history.back();
        await flush();
        expect(window.location.hash).toBe('#/gallery/paper');
        expect(store.getState().isSettingsOpen).toBe(false);
        expect(store.getState().gallerySection).toBe('paper');
        expect(window.history.length).toBe(base + 2);
    });

    it('mirrors the settings modal both ways', async () => {
        const store = createAppStore(makeStorage());
        install(store);

        window.location.hash = '#settings';
        await flush();
        expect(store.getState().isSettingsOpen).toBe(true);

        store.getState().closeSettings();
        await flush();
        expect(window.location.hash).toBe('#/gallery');

        store.getState().openSettings();
        await flush();
        expect(window.location.hash).toBe('#settings');
    });

    it('defers a deep link until the repo exists, then opens the document', async () => {
        const store = createAppStore(makeStorage());
        window.location.hash = `#/editor?doc=${DOC_A}`;
        install(store);

        // Cold boot: `initPersistence` has not published a repo yet.
        await flush();
        expect(store.getState().view).toBe('gallery');
        expect(window.location.hash).toBe(`#/editor?doc=${DOC_A}`); // kept, not clobbered

        store.getState().setLabelRepo(makeRepo({ [DOC_A]: doc(DOC_A) }));
        await flush();
        await flush();
        expect(store.getState().view).toBe('editor');
        expect(store.getState().currentDoc?.meta.id).toBe(DOC_A);
        expect(window.location.hash).toBe(`#/editor?doc=${DOC_A}`);
    });

    it('gives up on a deep link when storage boot fails, then keeps writing', async () => {
        const store = createAppStore(makeStorage());
        window.location.hash = `#/editor?doc=${DOC_A}`;
        install(store);
        await flush();
        expect(store.getState().view).toBe('gallery');

        // `initPersistence`'s failure path: the boot settled and no repo exists.
        store.setState({ storageError: true, galleryLoading: false });
        await flush();
        expect(window.location.hash).toBe('#/gallery');

        store.getState().setGallerySection('media');
        await flush();
        expect(window.location.hash).toBe('#/gallery/media');
    });

    it('is idempotent under a double mount (StrictMode)', async () => {
        const store = createAppStore(makeStorage());
        install(store);
        install(store);

        const entries = window.history.length;
        store.getState().setGallerySection('templates');
        await flush();
        await flush();
        expect(window.location.hash).toBe('#/gallery/templates');
        expect(window.history.length).toBe(entries + 1); // one writer, one entry
    });

    it('stops touching the URL once uninstalled', async () => {
        const store = createAppStore(makeStorage());
        const uninstall = install(store);
        uninstall();

        store.getState().setGallerySection('media');
        await flush();
        expect(window.location.hash).toBe('');
        expect(store.getState().gallerySection).toBe('media');
    });
});
