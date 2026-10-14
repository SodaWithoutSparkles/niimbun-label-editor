import { describe, expect, it } from 'vitest';
import { createFtagSpareDoc } from '../core/doc/factory';
import type { FontRef, ImageRef, LabelDoc } from '../core/doc/types';
import { collectReferencedIds, findOrphanIds } from './orphans';

/**
 * Pure orphan-sweep core (phase 9, W4). No storage, no DOM: the collector's
 * conservative rules and the diff's order/dedupe semantics are pinned directly.
 */

const doc = (id: string): LabelDoc => {
    const next = createFtagSpareDoc({ name: id, now: 1 });
    next.meta.id = id;
    return next;
};

const localImage = (imageId: string, resourceId: string): ImageRef => ({
    imageId,
    name: imageId,
    source: { kind: 'local', mediaType: 'image/png', resourceId },
    widthPx: 10,
    heightPx: 10,
});

const remoteImage = (imageId: string): ImageRef => ({
    imageId,
    name: imageId,
    source: { kind: 'remote', mediaType: 'image/png', url: 'https://example.com/a.png' },
    widthPx: 10,
    heightPx: 10,
});

const importedLocalFont = (fontId: string, resourceId: string): FontRef => ({
    fontId,
    familyName: fontId,
    name: fontId,
    source: {
        kind: 'imported',
        asset: { kind: 'local', mediaType: 'font/ttf', resourceId },
    },
});

const systemFont = (fontId: string): FontRef => ({
    fontId,
    familyName: fontId,
    name: fontId,
    source: { kind: 'system', descriptor: 'Arial' },
});

describe('collectReferencedIds', () => {
    it('returns empty sets for no documents', () => {
        const refs = collectReferencedIds([]);
        expect(refs.csvIds.size).toBe(0);
        expect(refs.resourceIds.size).toBe(0);
    });

    it('returns empty sets for documents with no csv and no resources', () => {
        const refs = collectReferencedIds([doc('a'), doc('b')]);
        expect(refs.csvIds.size).toBe(0);
        expect(refs.resourceIds.size).toBe(0);
    });

    it('collects the csv id from data.csv', () => {
        const a = doc('a');
        a.data.csv = {
            csvId: 'csv-a',
            name: 'A',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-a' },
        };
        const refs = collectReferencedIds([a]);
        expect([...refs.csvIds]).toEqual(['csv-a']);
        // A local csv ref must NOT leak into the resource set (separate store).
        expect(refs.resourceIds.size).toBe(0);
    });

    it('collects local image refs but ignores remote/inline/external images', () => {
        const a = doc('a');
        a.resources.images = [
            localImage('img-local', 'res-img-local'),
            remoteImage('img-remote'),
            {
                imageId: 'img-inline',
                name: 'inline',
                source: { kind: 'inline', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AA==' },
                widthPx: 1,
                heightPx: 1,
            },
            {
                imageId: 'img-external',
                name: 'external',
                source: { kind: 'external', mediaType: 'image/png', filename: 'a.png' },
                widthPx: 1,
                heightPx: 1,
            },
        ];
        const refs = collectReferencedIds([a]);
        expect([...refs.resourceIds]).toEqual(['res-img-local']);
    });

    it('collects imported fonts backed by a local asset, ignoring system fonts and non-local assets', () => {
        const a = doc('a');
        a.resources.fonts = [
            importedLocalFont('font-local', 'res-font-local'),
            systemFont('font-system'),
            {
                fontId: 'font-remote',
                familyName: 'remote',
                name: 'remote',
                source: {
                    kind: 'imported',
                    asset: { kind: 'remote', mediaType: 'font/ttf', url: 'https://example.com/f.ttf' },
                },
            },
            {
                fontId: 'font-inline',
                familyName: 'inline',
                name: 'inline',
                source: {
                    kind: 'imported',
                    asset: { kind: 'inline', mediaType: 'font/ttf', dataUrl: 'data:font/ttf;base64,AA==' },
                },
            },
        ];
        const refs = collectReferencedIds([a]);
        expect([...refs.resourceIds]).toEqual(['res-font-local']);
    });

    it('counts a ref with no node using it (conservative: removeNode does not prune resources)', () => {
        const a = doc('a');
        // No nodes at all — the refs only sit in `resources`.
        expect(a.nodes).toEqual([]);
        a.resources.images = [localImage('img', 'res-1')];
        a.resources.fonts = [importedLocalFont('font', 'res-2')];
        a.data.csv = {
            csvId: 'csv-1',
            name: 'C',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' },
        };

        const refs = collectReferencedIds([a]);
        expect([...refs.csvIds]).toEqual(['csv-1']);
        expect([...refs.resourceIds].sort()).toEqual(['res-1', 'res-2']);
    });

    it('merges refs across documents and dedupes a shared id', () => {
        const a = doc('a');
        a.resources.images = [localImage('i1', 'shared')];
        a.data.csv = {
            csvId: 'csv-shared',
            name: 'C',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-shared' },
        };
        const b = doc('b');
        b.resources.images = [localImage('i2', 'shared')];
        b.resources.fonts = [importedLocalFont('f1', 'res-font')];

        const refs = collectReferencedIds([a, b]);
        expect([...refs.csvIds]).toEqual(['csv-shared']);
        expect([...refs.resourceIds].sort()).toEqual(['res-font', 'shared']);
    });
});

describe('findOrphanIds', () => {
    it('returns ids not referenced, in stable first-seen order', () => {
        expect(findOrphanIds(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
    });

    it('dedupes repeated ids', () => {
        expect(findOrphanIds(['a', 'a', 'b', 'b', 'a'], new Set())).toEqual(['a', 'b']);
    });

    it('returns every id when nothing is referenced', () => {
        expect(findOrphanIds(['x', 'y'], new Set())).toEqual(['x', 'y']);
    });

    it('returns none when everything is referenced', () => {
        expect(findOrphanIds(['a', 'b'], new Set(['a', 'b']))).toEqual([]);
    });

    it('returns none for an empty store', () => {
        expect(findOrphanIds([], new Set(['a']))).toEqual([]);
    });
});
