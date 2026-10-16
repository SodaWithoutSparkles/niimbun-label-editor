// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { LabelDoc } from '../../core/doc/types';
import type { LabelRepo } from '../../data/labelRepo';
import type { ResourceRepo } from '../../data/resourceRepo';
import type { AssetDeps } from '../../editor/render/assets';
import { createLabelDoc } from '../../core/doc/factory';
import { useStore } from '../../store/useStore';

/**
 * D-50: the gallery-thumbnail hook debounces on document changes, renders
 * through the shared path WITH repo-backed asset providers, writes via
 * `labelRepo.putThumb`, and refreshes the gallery once on the editor → gallery
 * transition. It must never let a failure or an out-of-order render corrupt the
 * card.
 *
 * The render seam is mocked so these tests exercise the hook's orchestration
 * (debounce/flush/token/providers), not the canvas.
 */
const { renderMock } = vi.hoisted(() => ({ renderMock: vi.fn() }));

vi.mock('../../editor/render/docThumbnail', () => ({
    renderDocThumbnail: renderMock,
    GALLERY_THUMBNAIL_DPI: 100,
}));

import { DOC_THUMBNAIL_DEBOUNCE_MS, useDocThumbnail } from './useDocThumbnail';

const makeRepo = () => {
    const putThumb = vi.fn(async (_id: string, _thumb: Blob): Promise<void> => undefined);
    const repo: LabelRepo = {
        list: async () => [],
        get: async () => null,
        save: async () => undefined,
        saveAll: async () => ({ ok: [], errors: [] }),
        remove: async () => undefined,
        putThumb,
        getThumb: async () => null,
        removeThumb: async () => undefined,
        listDetailed: async () => ({ ok: [], errors: [] }),
    };
    return { repo, putThumb };
};

/** A `ResourceRepo` stand-in exposing only what the bytes provider reads. */
const makeResourceRepo = (bytes: Uint8Array | null): ResourceRepo =>
    ({ get: vi.fn(async (_id: string) => (bytes ? { bytes } : null)) }) as unknown as ResourceRepo;

const makeDoc = (id = 'doc-1', name = 'A'): LabelDoc =>
    createLabelDoc({ id, name, now: 1_000 });

/** A new, content-different doc with the SAME id — what an edit commit produces. */
const edit = (current: LabelDoc, i: number): LabelDoc => {
    const next = structuredClone(current);
    next.meta.updatedAt = current.meta.updatedAt + i + 1;
    return next;
};

const pngBlob = (content: string): Blob => new Blob([content], { type: 'image/png' });

let refreshSpy: ReturnType<typeof vi.fn>;
let realRefresh: () => Promise<void>;

beforeEach(() => {
    vi.useFakeTimers();
    renderMock.mockReset();
    renderMock.mockResolvedValue(pngBlob('thumb'));
    refreshSpy = vi.fn(async () => undefined);
    realRefresh = useStore.getState().refreshGallery;
    useStore.setState({
        currentDoc: null,
        view: 'editor',
        labelRepo: null,
        resourceRepo: null,
        refreshGallery: refreshSpy as unknown as typeof realRefresh,
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    useStore.setState({
        currentDoc: null,
        view: 'gallery',
        labelRepo: null,
        resourceRepo: null,
        refreshGallery: realRefresh,
    });
});

/** Let pending microtasks (render → putThumb) settle. */
const flush = async (): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
};

describe('useDocThumbnail', () => {
    it('coalesces a burst of doc changes into ONE debounced render', async () => {
        const { repo } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail());

        const base = makeDoc();
        await act(async () => {
            useStore.setState({ currentDoc: base });
        });
        // Keep changing the doc just under the debounce: each change resets it.
        for (let i = 0; i < 5; i += 1) {
            await act(async () => {
                useStore.setState({ currentDoc: edit(base, i) });
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS - 100);
            });
            expect(renderMock).not.toHaveBeenCalled();
        }

        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('writes putThumb with the doc id and does NOT refresh while editing', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();

        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(renderMock.mock.calls[0]![0].meta.id).toBe('doc-1');
        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(putThumb.mock.calls[0]![0]).toBe('doc-1');
        expect(putThumb.mock.calls[0]![1]).toBeInstanceOf(Blob);
        // A completed write only marks dirty; the library is not read per write.
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('passes repo-backed asset providers to the renderer', async () => {
        const { repo } = makeRepo();
        const bytes = new Uint8Array([1, 2, 3]);
        const resourceRepoA = makeResourceRepo(bytes);
        useStore.setState({ labelRepo: repo, resourceRepo: resourceRepoA });
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();

        const assets = renderMock.mock.calls[0]![1] as AssetDeps;
        expect(assets.images).toBeDefined();
        expect(assets.fonts).toBeDefined();
        // The bytes provider is backed by the store's `resourceRepo`.
        await expect(assets.images!.getBytes('r-1')).resolves.toEqual(bytes);

        // A different resource repo produces different providers, proving the
        // hook derives them from the store on each render.
        const resourceRepoB = makeResourceRepo(null);
        await act(async () => {
            useStore.setState({ resourceRepo: resourceRepoB, currentDoc: edit(makeDoc(), 1) });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();

        const nextAssets = renderMock.mock.calls.at(-1)![1] as AssetDeps;
        expect(nextAssets.images).not.toBe(assets.images);
        await expect(nextAssets.images!.getBytes('r-1')).resolves.toBeNull();
    });

    it('a slower older render never overwrites a newer thumbnail (per-doc token)', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });

        let resolveOlder!: (blob: Blob) => void;
        let resolveNewer!: (blob: Blob) => void;
        renderMock
            .mockReturnValueOnce(new Promise<Blob>((r) => (resolveOlder = r)))
            .mockReturnValueOnce(new Promise<Blob>((r) => (resolveNewer = r)));

        const base = makeDoc();
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: base });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await act(async () => {
            useStore.setState({ currentDoc: edit(base, 1) });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        expect(renderMock).toHaveBeenCalledTimes(2);

        const newerBlob = pngBlob('newer');
        const olderBlob = pngBlob('older');
        // Newer render completes first, then the older one lands late.
        await act(async () => {
            resolveNewer(newerBlob);
        });
        await flush();
        await act(async () => {
            resolveOlder(olderBlob);
        });
        await flush();

        // Exactly one write, and it is the newer thumbnail.
        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(putThumb.mock.calls[0]![1]).toBe(newerBlob);
    });

    it('flushes the outgoing document when the open doc changes', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });

        const a = makeDoc('doc-a', 'A');
        const b = makeDoc('doc-b', 'B');
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: a });
        });
        // Switch before the debounce fires: A must still get its thumbnail now.
        await act(async () => {
            useStore.setState({ currentDoc: b });
        });
        await flush();

        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(renderMock.mock.calls[0]![0]).toBe(a);
        expect(putThumb.mock.calls[0]![0]).toBe('doc-a');

        // B renders after its own debounce.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();
        expect(renderMock).toHaveBeenCalledTimes(2);
        expect(renderMock.mock.calls[1]![0]).toBe(b);
        expect(putThumb.mock.calls[1]![0]).toBe('doc-b');
    });

    it('refreshes the gallery ONCE on the editor → gallery transition, after the write', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();
        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(refreshSpy).not.toHaveBeenCalled();

        await act(async () => {
            useStore.setState({ view: 'gallery' });
        });
        await flush();

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('does not refresh on the transition when nothing is dirty', async () => {
        const { repo } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ view: 'gallery' });
        });
        await flush();

        expect(renderMock).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('flushes the pending write before refreshing on the transition (ordering)', async () => {
        const { repo, putThumb } = makeRepo();
        let resolveWrite!: () => void;
        putThumb.mockImplementationOnce(
            () => new Promise<void>((r) => (resolveWrite = r)),
        );
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail());

        // Schedule a render but leave it pending (debounce not yet fired).
        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
        });
        // Transition: the debounce must be flushed (render + write) before the read.
        await act(async () => {
            useStore.setState({ view: 'gallery' });
        });
        await flush();

        // The write is still in flight: the refresh must NOT have happened yet.
        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(refreshSpy).not.toHaveBeenCalled();

        await act(async () => {
            resolveWrite();
        });
        await flush();

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('does nothing without an open document', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo, currentDoc: null });
        renderHook(() => useDocThumbnail());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS * 3);
        });

        expect(renderMock).not.toHaveBeenCalled();
        expect(putThumb).not.toHaveBeenCalled();
    });

    it('does nothing without a label repo (skips the write)', async () => {
        useStore.setState({ labelRepo: null });
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();

        expect(renderMock).not.toHaveBeenCalled();
    });

    it('swallows a rejected render (never writes, never refreshes)', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderMock.mockRejectedValue(new Error('boom'));
        renderHook(() => useDocThumbnail());

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();

        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(putThumb).not.toHaveBeenCalled();

        await act(async () => {
            useStore.setState({ view: 'gallery' });
        });
        await flush();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('renders exactly once under StrictMode effect replay', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail(), { wrapper: StrictMode });

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();

        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(putThumb).toHaveBeenCalledTimes(1);
    });

    it('refreshes exactly once on the editor → gallery transition under StrictMode', async () => {
        const { repo, putThumb } = makeRepo();
        useStore.setState({ labelRepo: repo });
        renderHook(() => useDocThumbnail(), { wrapper: StrictMode });

        await act(async () => {
            useStore.setState({ currentDoc: makeDoc() });
            await vi.advanceTimersByTimeAsync(DOC_THUMBNAIL_DEBOUNCE_MS);
        });
        await flush();
        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(refreshSpy).not.toHaveBeenCalled();

        // One transition, one read — even with StrictMode's setup/cleanup replay.
        await act(async () => {
            useStore.setState({ view: 'gallery' });
        });
        await flush();

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
});
