// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createFtagSpareDoc } from '../../core/doc/factory';
import type { ImageRef, LabelDoc } from '../../core/doc/types';
import type { LabelRepo, LabelSummary } from '../../data/labelRepo';
import { createCsvRepo } from '../../data/csvRepo';
import { createResourceRepo } from '../../data/resourceRepo';
import { createMemoryAdapter } from '../../data/db';
import { useStore } from '../../store/useStore';
import { useOrphans } from './useOrphans';

/**
 * `useOrphans` (phase 9, W4): the O(docs) `get()`-per-document sweep. A fake
 * `labelRepo` returns documents directly (no gzip), so the ref-collection and
 * the resilience rules are pinned without a real storage backend.
 */

const localImage = (imageId: string, resourceId: string): ImageRef => ({
    imageId,
    name: imageId,
    source: { kind: 'local', mediaType: 'image/png', resourceId },
    widthPx: 4,
    heightPx: 4,
});

const doc = (id: string, build?: (next: LabelDoc) => void): LabelDoc => {
    const next = createFtagSpareDoc({ name: id, now: 1 });
    next.meta.id = id;
    build?.(next);
    return next;
};

/** A fake repo exposing only what the sweep uses; extra methods are unused. */
const fakeLabelRepo = (docs: readonly LabelDoc[], getOverride?: LabelRepo['get']): LabelRepo => {
    const byId = new Map(docs.map((d) => [d.meta.id, d]));
    return {
        list: vi.fn(async (): Promise<LabelSummary[]> =>
            docs.map((d) => ({
                id: d.meta.id,
                name: d.meta.name,
                createdAt: d.meta.createdAt,
                updatedAt: d.meta.updatedAt,
                backingW: d.label.backingW,
                backingH: d.label.backingH,
            })),
        ),
        get: getOverride ?? vi.fn(async (id: string) => byId.get(id) ?? null),
    } as unknown as LabelRepo;
};

afterEach(() => {
    cleanup();
    useStore.setState({ labelRepo: null, csvRepo: null, resourceRepo: null, notifications: [] });
});

describe('useOrphans', () => {
    it('treats a null labelRepo as empty sets, not an error', async () => {
        const { result } = renderHook(() => useOrphans());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.csvIds.size).toBe(0);
        expect(result.current.resourceIds.size).toBe(0);
        expect(result.current.error).toBe(false);
    });

    it('computes the orphan sets from the documents and the two stores', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put({ id: 'csv-a', name: 'A', columns: ['x'], rows: [['1']] });
        await csvRepo.put({ id: 'csv-b', name: 'B', columns: ['y'], rows: [['2']] });

        const resourceRepo = createResourceRepo(createMemoryAdapter());
        await resourceRepo.put({ id: 'img-a', mediaType: 'image/png', bytes: new Uint8Array([1]) });
        await resourceRepo.put({ id: 'font-a', mediaType: 'font/ttf', bytes: new Uint8Array([2]) });
        await resourceRepo.put({ id: 'res-b', mediaType: 'image/png', bytes: new Uint8Array([3]) });

        const referenced = doc('doc-1', (d) => {
            d.data.csv = {
                csvId: 'csv-a',
                name: 'A',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
            };
            d.resources.images = [localImage('img-a', 'img-a')];
            d.resources.fonts = [
                {
                    fontId: 'font-a',
                    familyName: 'Font A',
                    name: 'Font A',
                    source: { kind: 'imported', asset: { kind: 'local', mediaType: 'font/ttf', resourceId: 'font-a' } },
                },
            ];
        });
        // Second document only references a remote image — nothing in storage.
        const remoteOnly = doc('doc-2', (d) => {
            d.resources.images = [
                {
                    imageId: 'img-remote',
                    name: 'remote',
                    source: { kind: 'remote', mediaType: 'image/png', url: 'https://example.com/x.png' },
                    widthPx: 1,
                    heightPx: 1,
                },
            ];
        });

        useStore.setState({
            labelRepo: fakeLabelRepo([referenced, remoteOnly]),
            csvRepo,
            resourceRepo,
        });

        const { result } = renderHook(() => useOrphans());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe(false);
        expect([...result.current.csvIds]).toEqual(['csv-b']);
        expect([...result.current.resourceIds]).toEqual(['res-b']);
    });

    it('skips a document whose get() rejects and still resolves', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put({ id: 'csv-keep', name: 'K', columns: ['x'], rows: [['1']] });

        const good = doc('good', (d) => {
            d.data.csv = {
                csvId: 'csv-keep',
                name: 'K',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-keep' },
            };
        });
        const broken = doc('broken');

        const get = vi.fn(async (id: string) => {
            if (id === 'broken') throw new Error('corrupt doc');
            return id === 'good' ? good : null;
        });

        useStore.setState({
            labelRepo: fakeLabelRepo([good, broken], get),
            csvRepo,
            resourceRepo: createResourceRepo(createMemoryAdapter()),
        });

        const { result } = renderHook(() => useOrphans());
        await waitFor(() => expect(result.current.loading).toBe(false));

        // The good doc's csv is referenced; the throwing doc did not abort the
        // sweep or mark it as an error.
        expect(result.current.error).toBe(false);
        expect(result.current.csvIds.size).toBe(0);
    });

    it('flips error when labelRepo.list() rejects', async () => {
        const repo = fakeLabelRepo([]);
        repo.list = vi.fn(async () => {
            throw new Error('idb read failed');
        });
        useStore.setState({
            labelRepo: repo,
            csvRepo: createCsvRepo(createMemoryAdapter()),
            resourceRepo: createResourceRepo(createMemoryAdapter()),
        });

        const { result } = renderHook(() => useOrphans());
        await waitFor(() => expect(result.current.error).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.csvIds.size).toBe(0);
        expect(result.current.resourceIds.size).toBe(0);
    });
});
