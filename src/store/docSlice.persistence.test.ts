import { describe, expect, it, vi } from 'vitest';

/**
 * Persistence-boot regression tests for `docSlice.initPersistence`.
 *
 * `createIdbAdapter` is mocked so the boot can be driven deterministically:
 *   - a deferred adapter proves an injected repo is never clobbered by the
 *     real one landing afterwards (#4), and
 *   - a rejecting adapter proves a boot failure is retryable and surfaces the
 *     distinct `storageError` state instead of the empty-library state (#3).
 */
const deferred = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const { createIdbAdapterMock, createMemoryAdapterMock } = vi.hoisted(() => ({
    createIdbAdapterMock: vi.fn(),
    createMemoryAdapterMock: vi.fn(),
}));

vi.mock('../data/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../data/db')>();
    createMemoryAdapterMock.mockImplementation(actual.createMemoryAdapter);
    return {
        ...actual,
        createIdbAdapter: createIdbAdapterMock,
    };
});

import { createAppStore } from './useStore';
import { createMemoryAdapter } from '../data/db';
import { createLabelRepo } from '../data/labelRepo';

/** Minimal in-memory Storage, mirroring `docSlice.test.ts`. */
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

describe('docSlice.initPersistence — boot safety', () => {
    it('does not clobber a repo injected while IDB is still opening (#4)', async () => {
        const gate = deferred();
        createIdbAdapterMock.mockReset();
        createIdbAdapterMock.mockReturnValue(gate.promise);

        const store = createAppStore(makeStorage());
        const injectedAdapter = createMemoryAdapter();
        const injectedRepo = createLabelRepo(injectedAdapter);

        // Start the boot (awaits the deferred adapter)…
        const boot = store.getState().initPersistence();
        // …then inject a repo before IDB resolves.
        store.getState().setLabelRepo(injectedRepo);

        // Now let the "real" adapter resolve. Its repo must NOT overwrite the
        // injected one.
        gate.resolve(createMemoryAdapter());
        await boot;

        expect(store.getState().labelRepo).toBe(injectedRepo);
    });

    it('reports a distinct, retryable storageError on boot failure (#3)', async () => {
        createIdbAdapterMock.mockReset();
        createIdbAdapterMock.mockRejectedValueOnce(new Error('idb blocked'));

        const store = createAppStore(makeStorage());

        await store.getState().initPersistence();

        expect(store.getState().storageError).toBe(true);
        expect(store.getState().galleryLoading).toBe(false);
        // A failed boot must not leave a cached dead-end: the next call retries.
        expect(store.getState().labelRepo).toBeNull();

        // Retry path: a second call opens again and succeeds.
        const goodAdapter = createMemoryAdapter();
        createIdbAdapterMock.mockResolvedValueOnce(goodAdapter);
        await store.getState().initPersistence();

        expect(store.getState().storageError).toBe(false);
        expect(store.getState().labelRepo).not.toBeNull();
    });
});
