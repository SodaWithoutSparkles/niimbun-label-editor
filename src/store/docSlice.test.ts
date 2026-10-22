import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from './useStore';
import { createMemoryAdapter } from '../data/db';
import { createLabelRepo, type LabelRepo } from '../data/labelRepo';
import { PAPER_TYPE_SEEDS } from '../core/doc/paper-types';
import { createLabelDoc } from '../core/doc/factory';
import type { LabelDoc, Node, Region } from '../core/doc/types';

/** Minimal in-memory Storage, mirroring `projectSlice.test.ts`. */
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

/**
 * Same platform-gap adaptation as `src/data/labelRepo.test.ts`: the test
 * runtime's `DecompressionStream` rejects a raw `ArrayBuffer` and only accepts
 * a view. `repo.get` goes through `parseDoc` → `decompress`, so the primitive
 * is adapted here; production code is untouched.
 */
const NativeDecompressionStream = globalThis.DecompressionStream;

class ArrayBufferTolerantDecompressionStream extends NativeDecompressionStream {
    constructor(format: CompressionFormat = 'gzip') {
        super(format);
        const writable = this.writable;
        const getWriter = writable.getWriter.bind(writable);
        Object.defineProperty(writable, 'getWriter', {
            configurable: true,
            value: () => {
                const writer = getWriter();
                const write = writer.write.bind(writer);
                Object.defineProperty(writer, 'write', {
                    configurable: true,
                    value: (chunk: BufferSource) =>
                        write(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk),
                });
                return writer;
            },
        });
    }
}

/**
 * Exit-criterion evidence, headless: create an F-tag label through the store,
 * then rebuild a *fresh* store + repo over the *same* adapter (= "reload the
 * page") and confirm it is still in the Recent gallery and opens.
 */
describe('docSlice — create → reload → reopen', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
    });

    it('persists an F-tag label and reopens it from a fresh store over the same adapter', async () => {
        const adapter = createMemoryAdapter();

        // --- session 1: create ---
        const store1 = createAppStore(makeStorage());
        store1.getState().setLabelRepo(createLabelRepo(adapter));

        const created = await store1.getState().createLabel({
            paperTypeId: 'ftagSpare-25x78',
            name: 'F-tag spare',
        });
        expect(created).not.toBeNull();
        const id = created!.meta.id;

        // Aliasing regression: mutating the *source* doc's meta after `save()`
        // must not change what was stored. Before the fix, `save()` kept a live
        // reference to `doc.meta`, so this mutation leaked into the record (the
        // in-memory adapter does not clone) and the reload below read the
        // mutated value instead of the persisted one.
        created!.meta.name = 'MUTATED AFTER SAVE';
        created!.meta.updatedAt = 999;

        // It lands in Recent, and creating does not force the editor open.
        const summaryAfterMutation = store1.getState().gallery.find((s) => s.id === id);
        expect(summaryAfterMutation?.name).toBe('F-tag spare');
        expect(store1.getState().view).toBe('gallery');

        // --- "reload": fresh store + repo over the SAME adapter ---
        const store2 = createAppStore(makeStorage());
        // `view` defaults to gallery on a fresh boot (it is never persisted).
        expect(store2.getState().view).toBe('gallery');

        store2.getState().setLabelRepo(createLabelRepo(adapter));
        await store2.getState().refreshGallery();

        const gallery = store2.getState().gallery;
        expect(gallery).toHaveLength(1);
        expect(gallery[0].id).toBe(id);
        // Genuine traversal of the stored record, not the aliased source object.
        expect(gallery[0].name).toBe('F-tag spare');
        expect(gallery[0].updatedAt).toBe(created!.meta.createdAt);
        expect(gallery[0].backingW).toBe(2500);
        expect(gallery[0].backingH).toBe(7800);

        // --- reopen: read back through the serialized (gzip) doc path ---
        const opened = await store2.getState().openLabel(id);
        expect(opened).not.toBeNull();
        expect(opened!.meta.id).toBe(id);
        expect(opened!.label.regions).toHaveLength(3);
        expect(opened!.meta.name).toBe('F-tag spare');
        expect(store2.getState().view).toBe('editor');
        expect(store2.getState().currentDoc?.meta.id).toBe(id);
        // Default view orientation (§6): the F-tag is portrait (25×78), so the
        // long axis is put horizontal. View-only — the doc is unchanged.
        expect(store2.getState().viewRotation).toBe(90);
        expect(store2.getState().currentDoc?.label.backingW).toBe(2500);
        expect(store2.getState().currentDoc?.label.backingH).toBe(7800);
    });

    it('deletes a label and removes it from Recent', async () => {
        const adapter = createMemoryAdapter();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));

        const created = await store.getState().createLabel({ paperTypeId: 'ftagSpare-25x78' });
        expect(created).not.toBeNull();

        await store.getState().deleteLabel(created!.meta.id);
        expect(store.getState().gallery).toHaveLength(0);
    });

    it('initPersistence refreshes an already-injected repo without touching IDB', async () => {
        const adapter = createMemoryAdapter();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));

        await store.getState().initPersistence();
        expect(store.getState().galleryLoading).toBe(false);
        // Two calls stay a no-op (StrictMode effect replay).
        await store.getState().initPersistence();
        expect(store.getState().gallery).toHaveLength(0);
    });

    it('createLabel refuses to persist an invalid doc (non-finite backing size)', async () => {
        const adapter = createMemoryAdapter();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));

        const created = await store.getState().createLabel({
            backingW: Number.POSITIVE_INFINITY,
            backingH: 100,
        });
        expect(created).toBeNull();
        expect(store.getState().gallery).toHaveLength(0);
    });

    it('refreshGallery surfaces read errors without blanking the readable summaries', async () => {
        const adapter = createMemoryAdapter({
            labels: {
                // Present but structurally invalid: `docGz`/`meta` shape is wrong.
                broken: { meta: {}, docGz: new Uint8Array() },
            },
        });

        // Seed one good label through a separate store/repo over the same adapter.
        const seedStore = createAppStore(makeStorage());
        seedStore.getState().setLabelRepo(createLabelRepo(adapter));
        const good = await seedStore.getState().createLabel({ paperTypeId: 'ftagSpare-25x78', name: 'Good' });
        expect(good).not.toBeNull();

        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));
        await store.getState().refreshGallery();

        // The good label still renders; the gallery is not blanked.
        expect(store.getState().gallery.map((s) => s.name)).toEqual(['Good']);
        // …and the failure is surfaced as an error notification.
        const notifications = store.getState().notifications;
        expect(notifications.some((n) => n.type === 'error')).toBe(true);
    });

    it("persists the dialog's exact submit spec through createLabel (regions + paperTypeId)", async () => {
        const adapter = createMemoryAdapter();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));

        // Exactly what `CreateLabelDialog.handleSubmit` builds for the F-tag
        // default: it always passes `regions`, and the paper type (not backingW/H).
        const preset = PAPER_TYPE_SEEDS['ftagSpare-25x78'];
        const spec = {
            name: 'F-tag spare 25×78',
            paperTypeId: 'ftagSpare-25x78' as const,
            dpi: 300,
            regions: preset.regions.map((region) => structuredClone(region)),
        };

        const doc = await store.getState().createLabel(spec);
        expect(doc).not.toBeNull();
        expect(store.getState().gallery).toHaveLength(1);

        // Prove it actually hit the repo (persisted), not just built in memory.
        const stored = await store.getState().labelRepo!.get(doc!.meta.id);
        expect(stored).not.toBeNull();
        expect(stored!.label.regions).toHaveLength(3);
        expect(stored!.label.backingW).toBe(2500);
        expect(stored!.label.backingH).toBe(7800);
    });

    it('never rejects: a throwing factory resolves to null instead', async () => {
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(createMemoryAdapter()));

        // A malformed region makes the synchronous factory throw before the
        // old try/catch, which used to reject the caller (and strand the
        // dialog's `saving` flag). The action must absorb it.
        const badRegions = [{ kind: 'polygon' }] as unknown as Region[];
        await expect(store.getState().createLabel({ regions: badRegions })).resolves.toBeNull();
        expect(store.getState().gallery).toHaveLength(0);
    });

    it('never rejects: a failing repo.save resolves to null instead', async () => {
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('idb transaction aborted'));
        store.getState().setLabelRepo(repo);

        await expect(
            store.getState().createLabel({ paperTypeId: 'ftagSpare-25x78' }),
        ).resolves.toBeNull();
    });
});

const textNode = (id: string): Node => ({
    id,
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hello' },
});

const makeDoc = (nodes: Node[] = []): LabelDoc =>
    createLabelDoc({ id: 'doc-1', name: 'Test', nodes, now: 1_000_000 });

describe('docSlice — saveCurrentLabel', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('saves the open document through the injected repo and stamps lastSavedAt', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-03T04:05:06Z'));
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        const save = vi.spyOn(repo, 'save');
        store.getState().setLabelRepo(repo);
        store.setState({ currentDoc: makeDoc([textNode('a')]), view: 'editor' });

        const ok = await store.getState().saveCurrentLabel();

        expect(ok).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]![0].meta.id).toBe('doc-1');
        // `lastSavedAt` is ms epoch (BottomBar's `Date.now()` readout).
        expect(store.getState().lastSavedAt).toBe(Date.now());
        expect(store.getState().lastSavedAt).toBeGreaterThan(1_000_000_000_000);
    });

    it('is a silent no-op in the gallery (no doc, no write, no timestamp)', async () => {
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        const save = vi.spyOn(repo, 'save');
        store.getState().setLabelRepo(repo);
        store.setState({ currentDoc: null, view: 'gallery' });

        await expect(store.getState().saveCurrentLabel()).resolves.toBe(false);

        expect(save).not.toHaveBeenCalled();
        expect(store.getState().lastSavedAt).toBeNull();
    });

    it('does not revert a committed edit made while the save is in flight', async () => {
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        // Hold `save` open so we can commit a newer edit mid-flight.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(repo, 'save').mockReturnValue(gate);
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(1_000_000);
        store.setState({ currentDoc: makeDoc([textNode('a')]), view: 'editor' });

        const saving = store.getState().saveCurrentLabel();
        // A committed edit replaces `currentDoc` with a newer object.
        store.getState().addNode(textNode('b'));
        const edited = store.getState().currentDoc;
        expect(edited?.nodes).toHaveLength(2);

        release();
        await saving;

        // The in-flight save must not clobber the newer committed edit.
        expect(store.getState().currentDoc).toBe(edited);
        expect(store.getState().currentDoc?.nodes).toHaveLength(2);
        // The save itself still succeeded, so its timestamp is recorded.
        expect(store.getState().lastSavedAt).not.toBeNull();
    });

    it('flushes and cancels the pending autosave before writing', async () => {
        vi.useFakeTimers();
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        const save = vi.spyOn(repo, 'save').mockResolvedValue(undefined);
        store.getState().setLabelRepo(repo);
        // Large debounce: the timer would never fire on its own during the test.
        store.getState().setDocAutosaveDelay(1_000_000);
        store.setState({ currentDoc: makeDoc(), view: 'editor', autoSave: true });

        // Schedule a pending autosave, then save explicitly.
        store.getState().addNode(textNode('a'));
        await store.getState().saveCurrentLabel();
        const writesAfterSave = save.mock.calls.length;

        // The cancelled timer must never fire a later, stale write that would
        // rewrite `updatedAt`/`lastAutoSaveAt` after the explicit save.
        await vi.advanceTimersByTimeAsync(1_000_001);
        expect(save.mock.calls.length).toBe(writesAfterSave);
        // The explicit save still ran.
        expect(save).toHaveBeenCalled();
    });

    it('awaits the pending autosave before the explicit save (deterministic ordering, must-fix #8)', async () => {
        vi.useFakeTimers();
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        const save = vi.spyOn(repo, 'save').mockResolvedValue(undefined);
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(1_000_000);
        store.setState({ currentDoc: makeDoc(), view: 'editor', autoSave: true });

        store.getState().addNode(textNode('a')); // schedules the pending autosave
        await store.getState().saveCurrentLabel();

        expect(save).toHaveBeenCalledTimes(2);
        const [first, second] = save.mock.invocationCallOrder;
        // The pending (older) autosave settles BEFORE the newer explicit save;
        // the deferred ordering used to invert this so the older doc landed last.
        expect(first!).toBeLessThan(second!);
    });

    it('awaits the pending autosave before removing the label (must-fix #8)', async () => {
        vi.useFakeTimers();
        const store = createAppStore(makeStorage());
        const repo = createLabelRepo(createMemoryAdapter());
        const save = vi.spyOn(repo, 'save').mockResolvedValue(undefined);
        const remove = vi.spyOn(repo, 'remove').mockResolvedValue(undefined);
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(1_000_000);
        store.setState({ currentDoc: makeDoc([textNode('a')]), view: 'editor', autoSave: true });

        store.getState().addNode(textNode('b')); // schedules the pending autosave
        await store.getState().deleteLabel('doc-1');

        // The save must land before the remove, or the deferred write would
        // recreate the just-deleted label.
        expect(save.mock.invocationCallOrder[0]!).toBeLessThan(remove.mock.invocationCallOrder[0]!);
        expect(store.getState().currentDoc).toBeNull();
    });
});

/**
 * In-memory repo whose `save` is held open by a gate. `save` writes to the same
 * map `remove` deletes from, so a write that lands after the delete would
 * resurrect the record — exactly the race P3 closes.
 */
const makeStoredRepo = () => {
    const docs = new Map<string, LabelDoc>();
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => {
        releaseSave = resolve;
    });
    const save = vi.fn(async (doc: LabelDoc): Promise<void> => {
        await gate;
        docs.set(doc.meta.id, doc);
    });
    const remove = vi.fn(async (id: string): Promise<void> => {
        docs.delete(id);
    });
    const repo: LabelRepo = {
        list: async () => [],
        get: async (id: string) => docs.get(id) ?? null,
        save,
        saveAll: async () => ({ ok: [], errors: [] }),
        remove,
        putThumb: async () => undefined,
        getThumb: async () => null,
        removeThumb: async () => undefined,
        listDetailed: async () => ({ ok: [], errors: [] }),
    };
    return { repo, save, remove, docs, releaseSave };
};

describe('docSlice — deleteLabel awaits in-flight autosave', () => {
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('settles a fired autosave before remove, so the label is not resurrected', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textNode('a')]);
        const { repo, save, remove, docs, releaseSave } = makeStoredRepo();
        docs.set('doc-1', doc);
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: doc, view: 'editor', autoSave: true });

        // Fire the debounce: the write starts and is held open by the gate.
        store.getState().addNode(textNode('b'));
        await vi.advanceTimersByTimeAsync(50);
        expect(save).toHaveBeenCalledTimes(1);

        const deleting = store.getState().deleteLabel('doc-1');
        await vi.advanceTimersByTimeAsync(0);
        // The in-flight write is still pending: remove must wait for it.
        expect(remove).not.toHaveBeenCalled();

        releaseSave();
        await deleting;

        expect(remove).toHaveBeenCalledTimes(1);
        expect(save.mock.invocationCallOrder[0]!).toBeLessThan(remove.mock.invocationCallOrder[0]!);
        // No late write recreated the record.
        expect(await repo.get('doc-1')).toBeNull();
    });

    it('navigates to the gallery when the deleted label was the open document', async () => {
        const doc = makeDoc([textNode('a')]);
        const { repo, docs } = makeStoredRepo();
        docs.set('doc-1', doc);
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.setState({ currentDoc: doc, view: 'editor' });

        await store.getState().deleteLabel('doc-1');

        expect(store.getState().currentDoc).toBeNull();
        expect(store.getState().view).toBe('gallery');
    });

    it('does not commit an open whose label was deleted mid-read', async () => {
        const doc = makeDoc([textNode('a')]);
        let releaseGet!: () => void;
        const gate = new Promise<void>((resolve) => {
            releaseGet = resolve;
        });
        // The read captures the record and resolves **after** the delete; only
        // the request-generation guard can prevent it from becoming current.
        const get = vi.fn(async (): Promise<LabelDoc | null> => {
            await gate;
            return doc;
        });
        const remove = vi.fn(async (): Promise<void> => undefined);
        const repo: LabelRepo = {
            ...makeStoredRepo().repo,
            get,
            remove,
        };
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.setState({ view: 'gallery' });

        const opening = store.getState().openLabel('doc-1');
        await store.getState().deleteLabel('doc-1');
        releaseGet();

        expect(await opening).toBeNull();
        expect(store.getState().currentDoc).toBeNull();
        expect(store.getState().view).toBe('gallery');
    });

    it('a failed delete does not cancel an in-flight open', async () => {
        const doc = makeDoc([textNode('a')]);
        let releaseGet!: () => void;
        const gate = new Promise<void>((resolve) => {
            releaseGet = resolve;
        });
        const get = vi.fn(async (): Promise<LabelDoc | null> => {
            await gate;
            return doc;
        });
        const remove = vi.fn(async (): Promise<void> => {
            throw new Error('remove failed');
        });
        const repo: LabelRepo = { ...makeStoredRepo().repo, get, remove };
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.setState({ view: 'gallery' });

        const opening = store.getState().openLabel('doc-1');
        await store.getState().deleteLabel('doc-1');
        releaseGet();

        // The record still exists, so the open must commit.
        expect(await opening).toBe(doc);
        expect(store.getState().currentDoc?.meta.id).toBe('doc-1');
    });
});
