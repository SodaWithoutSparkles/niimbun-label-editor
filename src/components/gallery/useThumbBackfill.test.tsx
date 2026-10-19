// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import type { LabelRepo, LabelSummary } from '../../data/labelRepo';
import { useStore } from '../../store/useStore';

/**
 * D-50 backfill: only labels with NO saved thumb are attempted, the batch is
 * bounded per gallery visit, attempted ids are never retried in the session,
 * failures are skipped, and the gallery is refreshed once per batch.
 *
 * The renderer and the repo are mocked/injected at the module seams so these
 * tests cover the hook's orchestration (worklist/bound/idle chunks/guards), not
 * the canvas or IDB. `happy-dom` has no `requestIdleCallback`, so the hook takes
 * its `setTimeout` fallback and fake timers make the chunks deterministic.
 */
const { renderMock } = vi.hoisted(() => ({ renderMock: vi.fn() }));

vi.mock('../../editor/render/docThumbnail', () => ({
    renderDocPreview: (...args: unknown[]) => renderMock(...args),
}));

import { BACKFILL_BATCH_SIZE, IDLE_FALLBACK_MS, useThumbBackfill } from './useThumbBackfill';

const pngBlob = (content: string): Blob => new Blob([content], { type: 'image/png' });

const metaThumb = {
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,dGh1bWI=',
    at: 1234,
};

const makeRepo = (docs: Record<string, LabelDoc>) => {
    const get = vi.fn(async (id: string): Promise<LabelDoc | null> => docs[id] ?? null);
    const save = vi.fn(async (_doc: LabelDoc): Promise<void> => undefined);
    const putThumb = vi.fn(async (_id: string, _thumb: Blob): Promise<void> => undefined);
    const removeThumb = vi.fn(async (_id: string): Promise<void> => undefined);
    const repo: LabelRepo = {
        list: async () => [],
        get,
        save,
        saveAll: async () => ({ ok: [], errors: [] }),
        remove: async () => undefined,
        putThumb,
        getThumb: async () => null,
        removeThumb,
        listDetailed: async () => ({ ok: [], errors: [] }),
    };
    return { repo, get, save, putThumb, removeThumb };
};

const docFor = (id: string): LabelDoc => createLabelDoc({ id, name: id, now: 1_000 });

const summary = (id: string, thumb?: string): LabelSummary => ({
    id,
    name: id,
    createdAt: 0,
    updatedAt: 0,
    backingW: 2500,
    backingH: 7800,
    ...(thumb ? { thumb } : {}),
});

/** Advance the fake clock enough for every idle chunk in a full batch. */
const runBatch = async (): Promise<void> => {
    await act(async () => {
        for (let i = 0; i < 8; i += 1) {
            await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
        }
    });
};

/** Flush pending promise continuations without advancing the clock. */
const settle = async (): Promise<void> => {
    await act(async () => {
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
};

let refreshSpy: ReturnType<typeof vi.fn>;
let realRefresh: () => Promise<void>;

beforeEach(() => {
    vi.useFakeTimers();
    renderMock.mockReset();
    renderMock.mockResolvedValue({ blob: pngBlob('thumb'), metaThumb: undefined });
    refreshSpy = vi.fn(async () => undefined);
    realRefresh = useStore.getState().refreshGallery;
    useStore.setState({
        view: 'gallery',
        gallery: [],
        galleryLoading: false,
        storageError: false,
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
        view: 'gallery',
        gallery: [],
        galleryLoading: false,
        storageError: false,
        labelRepo: null,
        resourceRepo: null,
        refreshGallery: realRefresh,
    });
});

describe('useThumbBackfill', () => {
    it('picks only labels that have no thumb', async () => {
        const docs = { 'pick-blank': docFor('pick-blank'), 'pick-done': docFor('pick-done') };
        const { repo, get } = makeRepo(docs);
        useStore.setState({
            labelRepo: repo,
            gallery: [summary('pick-blank'), summary('pick-done', 'data:image/png;base64,AA==')],
        });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(get.mock.calls.map((call) => call[0])).toEqual(['pick-blank']);
    });

    it(`attempts at most ${BACKFILL_BATCH_SIZE} labels per gallery visit`, async () => {
        const ids = Array.from({ length: 10 }, (_, i) => `bound-${i}`);
        const docs = Object.fromEntries(ids.map((id) => [id, docFor(id)]));
        const { repo, get } = makeRepo(docs);
        useStore.setState({ labelRepo: repo, gallery: ids.map((id) => summary(id)) });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(get).toHaveBeenCalledTimes(BACKFILL_BATCH_SIZE);
    });

    it('does not re-process attempted ids on a second mount', async () => {
        const ids = Array.from({ length: 10 }, (_, i) => `remount-${i}`);
        const docs = Object.fromEntries(ids.map((id) => [id, docFor(id)]));
        const first = makeRepo(docs);
        useStore.setState({ labelRepo: first.repo, gallery: ids.map((id) => summary(id)) });

        renderHook(() => useThumbBackfill());
        await runBatch();
        expect(first.get).toHaveBeenCalledTimes(BACKFILL_BATCH_SIZE);
        const firstIds = first.get.mock.calls.map((call) => call[0]);
        cleanup();

        // A fresh visit sees the remaining two; the eight already attempted are
        // in the session-wide once-guard.
        const second = makeRepo(docs);
        useStore.setState({ labelRepo: second.repo });
        renderHook(() => useThumbBackfill());
        await runBatch();

        const secondIds = second.get.mock.calls.map((call) => call[0]);
        expect(secondIds).toHaveLength(ids.length - BACKFILL_BATCH_SIZE);
        expect(new Set([...firstIds, ...secondIds]).size).toBe(ids.length);
        expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    });

    it('leaves a label that already has a thumb completely alone', async () => {
        const docs = { 'thumb-blank': docFor('thumb-blank'), 'thumb-done': docFor('thumb-done') };
        const { repo, get, save, putThumb } = makeRepo(docs);
        useStore.setState({
            labelRepo: repo,
            gallery: [summary('thumb-done', 'data:image/png;base64,AA=='), summary('thumb-blank')],
        });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(get.mock.calls.map((call) => call[0])).toEqual(['thumb-blank']);
        expect(save.mock.calls.every((call) => call[0].meta.id !== 'thumb-done')).toBe(true);
        expect(putThumb.mock.calls.map((call) => call[0])).toEqual(['thumb-blank']);
    });

    it('refreshes the gallery once after a batch with successful writes', async () => {
        const ids = ['refresh-a', 'refresh-b', 'refresh-c', 'refresh-d', 'refresh-e'];
        const docs = Object.fromEntries(ids.map((id) => [id, docFor(id)]));
        const { repo } = makeRepo(docs);
        useStore.setState({ labelRepo: repo, gallery: ids.map((id) => summary(id)) });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('skips a failing item and keeps processing the rest', async () => {
        const ids = ['fail-a', 'fail-b', 'fail-c', 'fail-d'];
        const docs = Object.fromEntries(ids.map((id) => [id, docFor(id)]));
        const { repo, get, putThumb } = makeRepo(docs);
        renderMock.mockImplementation(async (doc: LabelDoc) => {
            if (doc.meta.id === 'fail-b') throw new Error('render boom');
            return { blob: pngBlob(doc.meta.id), metaThumb: undefined };
        });
        useStore.setState({ labelRepo: repo, gallery: ids.map((id) => summary(id)) });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(get).toHaveBeenCalledTimes(ids.length);
        expect(putThumb.mock.calls.map((call) => call[0])).toEqual([
            'fail-a',
            'fail-c',
            'fail-d',
        ]);
        // The other three wrote, so the batch still refreshes exactly once.
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('writes meta.thumb through labelRepo.save when the producer supplies one', async () => {
        const docs = { 'meta-a': docFor('meta-a') };
        const { repo, save, putThumb } = makeRepo(docs);
        renderMock.mockResolvedValue({ blob: null, metaThumb });
        useStore.setState({ labelRepo: repo, gallery: [summary('meta-a')] });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(putThumb).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalledTimes(1);
        const saved = save.mock.calls[0]![0];
        expect(saved.meta.id).toBe('meta-a');
        expect(saved.meta.thumb).toEqual(metaThumb);
        expect(saved).not.toBe(docs['meta-a']);
        expect(docs['meta-a']!.meta.thumb).toBeUndefined();
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when the gallery is left during the render', async () => {
        const docs = { 'cancel-a': docFor('cancel-a') };
        const { repo, get, save, putThumb } = makeRepo(docs);
        let resolveRender!: (value: unknown) => void;
        renderMock.mockReturnValueOnce(
            new Promise<unknown>((resolve) => {
                resolveRender = resolve;
            }),
        );
        useStore.setState({ labelRepo: repo, gallery: [summary('cancel-a')] });

        renderHook(() => useThumbBackfill());
        await act(async () => {
            await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
        });
        expect(get).toHaveBeenCalledTimes(1);
        expect(renderMock).toHaveBeenCalledTimes(1);

        // Leave while the render is still pending: the run is cancelled.
        await act(async () => {
            useStore.setState({ view: 'editor' });
        });
        await act(async () => {
            resolveRender({ blob: pngBlob('cancelled'), metaThumb });
        });
        await settle();

        expect(putThumb).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('refreshes when the blob write succeeds but the meta.thumb save fails', async () => {
        const docs = { 'partial-a': docFor('partial-a') };
        const { repo, save, putThumb } = makeRepo(docs);
        save.mockRejectedValue(new Error('quota exceeded'));
        renderMock.mockResolvedValue({ blob: pngBlob('partial'), metaThumb });
        useStore.setState({ labelRepo: repo, gallery: [summary('partial-a')] });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(1);
        // The failed save must not hide the blob that did land.
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('does not save when the gallery is left while putThumb is in flight', async () => {
        const docs = { 'inflight-a': docFor('inflight-a') };
        const { repo, save, putThumb } = makeRepo(docs);
        let resolvePut!: () => void;
        putThumb.mockImplementationOnce(
            () => new Promise<void>((resolve) => (resolvePut = resolve)),
        );
        renderMock.mockResolvedValue({ blob: pngBlob('inflight'), metaThumb });
        useStore.setState({ labelRepo: repo, gallery: [summary('inflight-a')] });

        renderHook(() => useThumbBackfill());
        await act(async () => {
            await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
        });
        // The blob write is pending: the meta.thumb save has not started.
        expect(putThumb).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();

        await act(async () => {
            useStore.setState({ view: 'editor' });
        });
        await act(async () => {
            resolvePut();
        });
        await settle();

        // The cancelled run must not proceed to the fresh read/save.
        expect(save).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('preserves an edit saved while the preview was rendering', async () => {
        const older = docFor('fresh-a');
        const newer = structuredClone(older);
        newer.meta.name = 'Edited while rendering';
        newer.meta.updatedAt = 2_000;
        newer.label.dpi = 600;

        const { repo, get, save } = makeRepo({ 'fresh-a': older });
        get.mockResolvedValueOnce(older).mockResolvedValueOnce(newer);
        renderMock.mockResolvedValue({ blob: null, metaThumb });
        useStore.setState({ labelRepo: repo, gallery: [summary('fresh-a')] });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(get).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledTimes(1);
        const saved = save.mock.calls[0]![0];
        expect(saved.meta.name).toBe('Edited while rendering');
        expect(saved.meta.updatedAt).toBe(2_000);
        expect(saved.label).toEqual(newer.label);
        expect(saved.meta.thumb).toEqual(metaThumb);
        // Only `meta.thumb` differs from the fresh (edited) doc.
        const savedMeta = { ...saved.meta };
        delete savedMeta.thumb;
        const newerMeta = { ...newer.meta };
        delete newerMeta.thumb;
        expect(savedMeta).toEqual(newerMeta);
    });

    it('skips the save when the label is gone at the fresh read', async () => {
        const doc = docFor('gone-a');
        const { repo, get, save, putThumb, removeThumb } = makeRepo({ 'gone-a': doc });
        get.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
        renderMock.mockResolvedValue({ blob: pngBlob('gone'), metaThumb });
        useStore.setState({ labelRepo: repo, gallery: [summary('gone-a')] });

        renderHook(() => useThumbBackfill());
        await runBatch();

        expect(get).toHaveBeenCalledTimes(2);
        expect(putThumb).toHaveBeenCalledTimes(1);
        // The late blob write is cleaned up rather than left as an orphan row.
        expect(removeThumb).toHaveBeenCalledWith('gone-a');
        expect(save).not.toHaveBeenCalled();
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('stops the chunk loop when the gallery is left', async () => {
        const ids = Array.from({ length: 8 }, (_, i) => `leave-${i}`);
        const docs = Object.fromEntries(ids.map((id) => [id, docFor(id)]));
        const { repo, get } = makeRepo(docs);
        useStore.setState({ labelRepo: repo, gallery: ids.map((id) => summary(id)) });

        renderHook(() => useThumbBackfill());
        // Exactly one chunk (two labels), then leave before the next idle gap.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
        });
        expect(get).toHaveBeenCalledTimes(2);

        await act(async () => {
            useStore.setState({ view: 'editor' });
        });
        await runBatch();

        expect(get).toHaveBeenCalledTimes(2);
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('renders each attempted label once under StrictMode effect replay', async () => {
        const ids = ['strict-a', 'strict-b', 'strict-c'];
        const docs = Object.fromEntries(ids.map((id) => [id, docFor(id)]));
        const { repo, get } = makeRepo(docs);
        useStore.setState({ labelRepo: repo, gallery: ids.map((id) => summary(id)) });

        renderHook(() => useThumbBackfill(), { wrapper: StrictMode });
        await runBatch();

        expect(get.mock.calls.map((call) => call[0])).toEqual(ids);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
});
