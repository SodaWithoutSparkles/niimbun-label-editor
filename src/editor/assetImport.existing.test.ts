import { describe, expect, it, vi } from 'vitest';
import {
    buildImageRefForExisting,
    cloneResourceRecord,
    resolveResourceDimensions,
} from './assetImport';
import type { ResourceRecord } from '../data/resourceRepo';

// The stored-metadata path is exercised directly; the decode fallback stubs the
// shared helper so no canvas/DOM is needed.
vi.mock('./render/imageAssets', () => ({ decodeImageBytes: vi.fn() }));

const record: ResourceRecord = {
    id: 'res-1',
    mediaType: 'image/png',
    name: 'logo.png',
    widthPx: 120,
    heightPx: 60,
    bytes: new Uint8Array([1, 2, 3]),
};

describe('buildImageRefForExisting (phase 9 W3)', () => {
    it('reference: fresh imageId, source.resourceId stays the original', () => {
        const ref = buildImageRefForExisting(record, { widthPx: 120, heightPx: 60 }, 'reference', 'img-new');

        expect(ref.imageId).toBe('img-new');
        expect(ref.source).toEqual({ kind: 'local', mediaType: 'image/png', resourceId: 'res-1' });
        // The render seam keys `local` bytes on `source.resourceId`, so a
        // reference intentionally has `imageId !== source.resourceId`.
        expect(ref.imageId).not.toBe('res-1');
        expect(ref.name).toBe('logo.png');
        expect(ref.widthPx).toBe(120);
        expect(ref.heightPx).toBe(60);
    });

    it('clone: imageId === source.resourceId === newId', () => {
        const ref = buildImageRefForExisting(record, { widthPx: 120, heightPx: 60 }, 'clone', 'copy-1');

        expect(ref.imageId).toBe('copy-1');
        expect(ref.source).toEqual({ kind: 'local', mediaType: 'image/png', resourceId: 'copy-1' });
    });

    it('falls back to the id for a legacy record with no name', () => {
        const legacy = { id: 'legacy-1', mediaType: 'image/png' };
        const ref = buildImageRefForExisting(legacy, { widthPx: 0, heightPx: 0 }, 'reference', 'x');
        expect(ref.name).toBe('legacy-1');
    });
});

describe('cloneResourceRecord', () => {
    it('copies to a new id with equal bytes in a fresh buffer', () => {
        const clone = cloneResourceRecord(record, 'copy-1');

        expect(clone.id).toBe('copy-1');
        expect(clone.name).toBe('logo.png');
        expect(clone.widthPx).toBe(120);
        expect(Array.from(clone.bytes)).toEqual([1, 2, 3]);
        // A real copy, never an alias of the original's buffer.
        expect(clone.bytes).not.toBe(record.bytes);
    });
});

describe('resolveResourceDimensions', () => {
    it('uses the stored metadata without decoding', async () => {
        await expect(resolveResourceDimensions(record)).resolves.toEqual({ widthPx: 120, heightPx: 60 });
    });

    it('decodes when the metadata is absent, and yields 0×0 when it fails', async () => {
        const { decodeImageBytes } = await import('./render/imageAssets');
        const mocked = vi.mocked(decodeImageBytes);

        mocked.mockResolvedValueOnce({ image: {} as never, widthPx: 10, heightPx: 20 });
        await expect(
            resolveResourceDimensions({ mediaType: 'image/png', bytes: new Uint8Array() }),
        ).resolves.toEqual({ widthPx: 10, heightPx: 20 });

        mocked.mockResolvedValueOnce(null);
        await expect(
            resolveResourceDimensions({ mediaType: 'image/png', bytes: new Uint8Array() }),
        ).resolves.toEqual({ widthPx: 0, heightPx: 0 });
    });
});
