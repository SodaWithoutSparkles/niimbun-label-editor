// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { createFtagSpareDoc } from '../core/doc/factory';
import type { LabelDoc } from '../core/doc/types';
import { createMemoryAdapter } from './db';
import { createLabelRepo } from './labelRepo';

/**
 * Same platform-gap adaptation as `src/core/doc/serialize.test.ts`: the test
 * runtime's `DecompressionStream` writes into Node's `zlib`, which rejects a
 * raw `ArrayBuffer` and only accepts a view. The repo's gzip read path goes
 * through `parseDoc`, so the primitive is adapted here; production code is
 * untouched.
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

const pngBlob = (bytes: number[]): Blob =>
    new Blob([new Uint8Array(bytes)], { type: 'image/png' });

describe('createLabelRepo', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
    });

    it('save → list → get round-trips a document', async () => {
        const repo = createLabelRepo(createMemoryAdapter());
        const doc = createFtagSpareDoc({ name: 'Round Trip', now: 1_700_000_000 });

        await repo.save(doc);

        const list = await repo.list();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
            id: doc.meta.id,
            name: 'Round Trip',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000,
            backingW: 2500,
            backingH: 7800,
        });

        expect(await repo.get(doc.meta.id)).toEqual(doc);
    });

    it('lists newest updatedAt first', async () => {
        const repo = createLabelRepo(createMemoryAdapter());
        const older = createFtagSpareDoc({ name: 'Older', now: 100 });
        const newer = createFtagSpareDoc({ name: 'Newer', now: 200 });

        await repo.save(older);
        await repo.save(newer);
        expect((await repo.list()).map((s) => s.id)).toEqual([newer.meta.id, older.meta.id]);

        // A later edit moves a label back to the top.
        older.meta.updatedAt = 300;
        await repo.save(older);
        expect((await repo.list()).map((s) => s.id)).toEqual([older.meta.id, newer.meta.id]);
    });

    it('save deep-copies meta so later source mutations do not leak into the stored record', async () => {
        const adapter = createMemoryAdapter();
        const repo = createLabelRepo(adapter);
        const doc = createFtagSpareDoc({ name: 'Original', now: 42 });

        await repo.save(doc);

        // Mutating the source doc after save must not change the record. The
        // in-memory adapter (unlike real IndexedDB) stores the reference as-is,
        // so before the `structuredClone` fix this leaked into `list()`.
        doc.meta.name = 'Mutated';
        doc.meta.updatedAt = 9999;

        const list = await repo.list();
        expect(list[0]!.name).toBe('Original');
        expect(list[0]!.updatedAt).toBe(42);

        // The stored record itself must be a distinct object from `doc.meta`.
        const stored = await adapter.get('labels', doc.meta.id);
        expect((stored as { meta: LabelDoc['meta'] }).meta).not.toBe(doc.meta);
        expect((stored as { meta: LabelDoc['meta'] }).meta.name).toBe('Original');
    });

    it('resolves card art: thumbs store → meta.thumb → undefined', async () => {
        const repo = createLabelRepo(createMemoryAdapter());
        const metaUrl = 'data:image/png;base64,iVBORw0KGgo=';

        const noThumb = createFtagSpareDoc({ name: 'No thumb', now: 1 });
        await repo.save(noThumb);
        let list = await repo.list();
        expect(list.find((s) => s.id === noThumb.meta.id)?.thumb).toBeUndefined();

        const metaOnly = createFtagSpareDoc({ name: 'Meta only', now: 2 });
        metaOnly.meta.thumb = { mediaType: 'image/png', dataUrl: metaUrl, at: 2 };
        await repo.save(metaOnly);
        list = await repo.list();
        expect(list.find((s) => s.id === metaOnly.meta.id)?.thumb).toBe(metaUrl);

        const local = createFtagSpareDoc({ name: 'Local', now: 3 });
        local.meta.thumb = { mediaType: 'image/png', dataUrl: metaUrl, at: 3 };
        await repo.save(local);
        await repo.putThumb(local.meta.id, pngBlob([0x89, 0x50, 0x4e, 0x47]));

        list = await repo.list();
        const localThumb = list.find((s) => s.id === local.meta.id)?.thumb;
        expect(localThumb).toBeDefined();
        expect(localThumb).not.toBe(metaUrl);
        expect(localThumb!.startsWith('data:image/png;base64,')).toBe(true);
        const binary = atob(localThumb!.slice('data:image/png;base64,'.length));
        expect([...binary].map((char) => char.charCodeAt(0))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('remove cascades to the thumb', async () => {
        const adapter = createMemoryAdapter();
        const repo = createLabelRepo(adapter);
        const doc = createFtagSpareDoc({ now: 5 });

        await repo.save(doc);
        await repo.putThumb(doc.meta.id, pngBlob([1, 2, 3]));
        expect(await repo.getThumb(doc.meta.id)).not.toBeNull();

        await repo.remove(doc.meta.id);

        expect(await repo.get(doc.meta.id)).toBeNull();
        expect(await repo.getThumb(doc.meta.id)).toBeNull();
        expect(await repo.list()).toEqual([]);
    });

    it('returns null (never throws) for a corrupt docGz', async () => {
        const adapter = createMemoryAdapter();
        const repo = createLabelRepo(adapter);
        const base = { meta: { id: 'x', name: 'X', createdAt: 1, updatedAt: 1 }, backingW: 1, backingH: 1 };

        await adapter.put('labels', 'plain', { ...base, docGz: new Uint8Array([1, 2, 3, 4]) });
        await adapter.put('labels', 'gzip', {
            ...base,
            docGz: new Uint8Array([0x1f, 0x8b, 0x00, 0x00, 0x00]),
        });

        await expect(repo.get('plain')).resolves.toBeNull();
        await expect(repo.get('gzip')).resolves.toBeNull();
    });

    it('skips bad records in list but keeps the good ones', async () => {
        const adapter = createMemoryAdapter();
        const repo = createLabelRepo(adapter);
        const good = createFtagSpareDoc({ name: 'Good', now: 20 });

        await repo.save(good);
        await adapter.put('labels', 'junk', {
            meta: { id: 'junk', name: 'Junk', createdAt: 1, updatedAt: 1 },
            docGz: 'not-bytes',
            backingW: 1,
            backingH: 1,
        });

        expect((await repo.list()).map((s) => s.id)).toEqual([good.meta.id]);

        const detailed = await repo.listDetailed();
        expect(detailed.ok.map((s) => s.id)).toEqual([good.meta.id]);
        expect(detailed.errors).toEqual([{ id: 'junk', error: 'labels: invalid stored record' }]);
    });

    it('saveAll collects per-record errors and keeps the successful writes', async () => {
        const repo = createLabelRepo(createMemoryAdapter());
        const good = createFtagSpareDoc({ name: 'Good', now: 10 });
        const bad = { meta: { id: 'bad' } } as unknown as LabelDoc;

        const result = await repo.saveAll([good, bad]);

        expect(result.ok).toEqual([good.meta.id]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.id).toBe('bad');
        expect(result.errors[0]!.error.length).toBeGreaterThan(0);
        expect((await repo.list()).map((s) => s.id)).toEqual([good.meta.id]);
    });
});
