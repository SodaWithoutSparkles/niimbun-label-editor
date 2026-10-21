import { describe, expect, it, vi } from 'vitest';
import { createFtagSpareDoc } from '../core/doc/factory';
import type { ImageRef, LabelDoc } from '../core/doc/types';
import type { LabelRepo, LabelSummary } from '../data/labelRepo';
import { scanReferences, type ReferenceScanInput } from './referenceScan';

/**
 * `scanReferences` (2026-10-22 storage-safety run, P1; issues #4 / #5).
 *
 * Storage is faked: a label repo returns documents directly and both catalogue
 * stores return id-only records, so the reference diff and every "cannot prove
 * it" branch are pinned without IndexedDB.
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

const summaryOf = (label: LabelDoc): LabelSummary => ({
    id: label.meta.id,
    name: label.meta.name,
    createdAt: label.meta.createdAt,
    updatedAt: label.meta.updatedAt,
    backingW: label.label.backingW,
    backingH: label.label.backingH,
});

/** A fake repo exposing only what the scan uses; extra methods are unused. */
const fakeLabelRepo = (
    docs: readonly LabelDoc[],
    overrides?: Partial<Pick<LabelRepo, 'listDetailed' | 'get'>>,
): LabelRepo => {
    const byId = new Map(docs.map((label) => [label.meta.id, label]));
    return {
        listDetailed: vi.fn(async () => ({ ok: docs.map(summaryOf), errors: [] })),
        get: vi.fn(async (id: string) => byId.get(id) ?? null),
        ...overrides,
    } as unknown as LabelRepo;
};

/** A catalogue store stub over a plain id list. */
const catalogue = (ids: readonly string[]) => ({
    list: vi.fn(async () => ids.map((id) => ({ id }))),
});

const input = (
    labelRepo: LabelRepo | null,
    csvIds: readonly string[],
    resourceIds: readonly string[],
    liveDocs?: readonly (LabelDoc | null | undefined)[],
): ReferenceScanInput => ({
    labelRepo,
    csvRepo: catalogue(csvIds),
    resourceRepo: catalogue(resourceIds),
    liveDocs,
});

describe('scanReferences', () => {
    it('diffs both stores against the persisted documents', async () => {
        const referenced = doc('doc-1', (d) => {
            d.data.csv = {
                csvId: 'csv-a',
                name: 'A',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
            };
            d.resources.images = [localImage('img-a', 'img-a')];
        });

        const inventory = await scanReferences(
            input(fakeLabelRepo([referenced]), ['csv-a', 'csv-b'], ['img-a', 'res-b']),
        );

        expect(inventory.complete).toBe(true);
        expect([...inventory.csvIds]).toEqual(['csv-b']);
        expect([...inventory.resourceIds]).toEqual(['res-b']);
    });

    it('is incomplete on listDetailed() errors, but still counts readable docs', async () => {
        const referenced = doc('good', (d) => {
            d.data.csv = {
                csvId: 'csv-a',
                name: 'A',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
            };
        });
        const labelRepo = fakeLabelRepo([referenced], {
            listDetailed: vi.fn(async () => ({
                ok: [summaryOf(referenced)],
                errors: [{ id: '', error: 'idb read failed' }],
            })),
        });

        const inventory = await scanReferences(input(labelRepo, ['csv-a', 'csv-b'], []));

        expect(inventory.complete).toBe(false);
        // The readable doc still protects `csv-a`; only the truly unreferenced
        // table is reported.
        expect([...inventory.csvIds]).toEqual(['csv-b']);
    });

    it('is incomplete when a get() returns null', async () => {
        const good = doc('good', (d) => {
            d.data.csv = {
                csvId: 'csv-a',
                name: 'A',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
            };
        });
        const broken = doc('broken');
        const labelRepo = fakeLabelRepo([good, broken], {
            get: vi.fn(async (id: string) => (id === 'good' ? good : null)),
        });

        const inventory = await scanReferences(input(labelRepo, ['csv-a', 'csv-b'], []));

        expect(inventory.complete).toBe(false);
        expect([...inventory.csvIds]).toEqual(['csv-b']);
    });

    it('is incomplete when a get() throws, and keeps scanning', async () => {
        const good = doc('good', (d) => {
            d.data.csv = {
                csvId: 'csv-a',
                name: 'A',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
            };
        });
        const broken = doc('broken');
        const labelRepo = fakeLabelRepo([broken, good], {
            get: vi.fn(async (id: string) => {
                if (id === 'broken') throw new Error('corrupt doc');
                return good;
            }),
        });

        const inventory = await scanReferences(input(labelRepo, ['csv-a', 'csv-b'], []));

        expect(inventory.complete).toBe(false);
        // The throw did not abort the loop: `good`'s ref is still honoured.
        expect([...inventory.csvIds]).toEqual(['csv-b']);
    });

    it('is incomplete when a catalogue list() rejects, but still counts the other store', async () => {
        const referenced = doc('doc-1', (d) => {
            d.data.csv = {
                csvId: 'csv-a',
                name: 'A',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
            };
            d.resources.images = [localImage('img-a', 'img-a')];
        });
        const failingCsv = {
            list: vi.fn(async () => {
                throw new Error('idb read failed');
            }),
        };

        const inventory = await scanReferences({
            labelRepo: fakeLabelRepo([referenced]),
            csvRepo: failingCsv,
            resourceRepo: catalogue(['img-a', 'res-b']),
        });

        expect(inventory.complete).toBe(false);
        expect(inventory.csvIds.size).toBe(0);
        // The healthy store is still diffed.
        expect([...inventory.resourceIds]).toEqual(['res-b']);
    });

    it('protects a ref held only by a live (unsaved) document', async () => {
        const stored = doc('doc-1');
        const live = doc('doc-live', (d) => {
            d.data.csv = {
                csvId: 'csv-live',
                name: 'Live',
                source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-live' },
            };
            d.resources.images = [localImage('img-live', 'img-live')];
        });

        const inventory = await scanReferences(
            input(fakeLabelRepo([stored]), ['csv-live', 'csv-old'], ['img-live', 'img-old'], [
                live,
                null,
                undefined,
            ]),
        );

        expect(inventory.complete).toBe(true);
        expect([...inventory.csvIds]).toEqual(['csv-old']);
        expect([...inventory.resourceIds]).toEqual(['img-old']);
    });

    it('treats a null labelRepo as an empty, complete inventory', async () => {
        const csvRepo = catalogue(['csv-a']);
        const inventory = await scanReferences({
            labelRepo: null,
            csvRepo,
            resourceRepo: catalogue(['res-a']),
        });

        expect(inventory.complete).toBe(true);
        expect(inventory.csvIds.size).toBe(0);
        expect(inventory.resourceIds.size).toBe(0);
        // Storage is not booted: the catalogue stores are not even consulted.
        expect(csvRepo.list).not.toHaveBeenCalled();
    });

    it('never throws when the label read itself rejects', async () => {
        const labelRepo = fakeLabelRepo([], {
            listDetailed: vi.fn(async () => {
                throw new Error('idb read failed');
            }),
        });

        const inventory = await scanReferences(input(labelRepo, ['csv-a'], ['res-a']));

        expect(inventory.complete).toBe(false);
        expect([...inventory.csvIds]).toEqual(['csv-a']);
    });
});
