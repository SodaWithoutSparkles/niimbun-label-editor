import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from './useStore';
import { createMemoryAdapter } from '../data/db';
import { createLabelRepo } from '../data/labelRepo';
import { LABEL_PRESETS } from '../core/doc/factory';
import type { Region } from '../core/doc/types';

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
            preset: 'ftagSpare-25x78',
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
    });

    it('deletes a label and removes it from Recent', async () => {
        const adapter = createMemoryAdapter();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));

        const created = await store.getState().createLabel({ preset: 'ftagSpare-25x78' });
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
        const good = await seedStore.getState().createLabel({ preset: 'ftagSpare-25x78', name: 'Good' });
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

    it("persists the dialog's exact submit spec through createLabel (regions + preset)", async () => {
        const adapter = createMemoryAdapter();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(createLabelRepo(adapter));

        // Exactly what `CreateLabelDialog.handleSubmit` builds for the F-tag
        // default: it always passes `regions`, and the preset (not backingW/H).
        const preset = LABEL_PRESETS['ftagSpare-25x78'];
        const spec = {
            name: 'F-tag spare 25×78',
            preset: 'ftagSpare-25x78' as const,
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
            store.getState().createLabel({ preset: 'ftagSpare-25x78' }),
        ).resolves.toBeNull();
    });
});
