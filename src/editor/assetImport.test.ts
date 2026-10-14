import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createMemoryAdapter } from '../data/db';
import { createResourceRepo } from '../data/resourceRepo';
import {
    importFontFile,
    importImageFile,
    importImageUrl,
    newResourceId,
} from './assetImport';

beforeAll(() => {
    // happy-dom's `createImageBitmap` does not decode real raster bytes; back it
    // with @napi-rs/canvas so the import decode step sees real dimensions. The
    // bytes are wrapped in a data URL to use `loadImage`'s string overload (the
    // Node `Buffer` type is not available under this tsconfig).
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (blob: Blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const dataUrl = `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
        return (await loadImage(dataUrl)) as unknown as ImageBitmap;
    };
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const pngBytes = (w: number, h: number): Uint8Array<ArrayBuffer> => {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, w, h);
    return Uint8Array.from(canvas.toBuffer('image/png'));
};

const textBytes = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);

/** Minimal `Response` for the fetch stub (no `Response` dependency). */
const jsonResponseLike = (
    bytes: Uint8Array,
    contentType: string | null,
    ok = true,
    status = 200,
): Response =>
    ({
        ok,
        status,
        headers: {
            get: (name: string) =>
                name.toLowerCase() === 'content-type' ? contentType : null,
        },
        arrayBuffer: async () => bytes.slice().buffer,
    }) as unknown as Response;

const hex64 = /^[0-9a-f]{64}$/;

describe('newResourceId', () => {
    it('mints distinct non-empty ids', () => {
        const ids = new Set(Array.from({ length: 50 }, () => newResourceId()));
        expect(ids.size).toBe(50);
        for (const id of ids) expect(id.length).toBeGreaterThan(0);
    });
});

describe('importImageFile', () => {
    it('stores local bytes and returns a fingerprinted ref with natural size', async () => {
        const bytes = pngBytes(9, 7);
        const file = new File([bytes], 'photo.png', { type: 'image/png' });
        const repo = createResourceRepo(createMemoryAdapter());

        const { ref, bytes: returned } = await importImageFile(file, repo);

        expect(ref.name).toBe('photo.png');
        expect(ref.widthPx).toBe(9);
        expect(ref.heightPx).toBe(7);
        expect([...returned]).toEqual([...bytes]);
        expect(ref.source.kind).toBe('local');
        if (ref.source.kind !== 'local') return;
        expect(ref.source.mediaType).toBe('image/png');
        expect(ref.source.resourceId).toBe(ref.imageId);
        expect(ref.source.fingerprint).toMatch(hex64);

        const stored = await repo.get(ref.source.resourceId);
        expect(stored).not.toBeNull();
        expect(stored!.mediaType).toBe('image/png');
        expect([...stored!.bytes]).toEqual([...bytes]);
    });

    it('stores display metadata (name + natural size) on the record (phase 9, D2)', async () => {
        const bytes = pngBytes(12, 5);
        const file = new File([bytes], 'photo.png', { type: 'image/png' });
        const repo = createResourceRepo(createMemoryAdapter());

        const { ref } = await importImageFile(file, repo);

        const stored = await repo.get(ref.imageId);
        expect(stored).not.toBeNull();
        expect(stored).toMatchObject({ name: 'photo.png', widthPx: 12, heightPx: 5 });
    });

    it('applies name/alt overrides', async () => {
        const file = new File([pngBytes(2, 2)], 'original.png', { type: 'image/png' });
        const { ref } = await importImageFile(file, createResourceRepo(createMemoryAdapter()), {
            name: 'Nice photo',
            alt: 'a red square',
        });
        expect(ref.name).toBe('Nice photo');
        expect(ref.alt).toBe('a red square');
    });

    it('throws a clear error for undecodable bytes', async () => {
        const file = new File([textBytes('not an image')], 'broken.png', {
            type: 'image/png',
        });
        await expect(importImageFile(file, createResourceRepo(createMemoryAdapter()))).rejects.toThrow(
            /could not decode image/,
        );
    });
});

describe('importImageUrl', () => {
    it('returns remote provenance and writes nothing to IDB', async () => {
        const bytes = pngBytes(5, 4);
        const fetchMock = vi.fn(async () => jsonResponseLike(bytes, 'image/png; charset=x'));
        vi.stubGlobal('fetch', fetchMock);

        const { ref } = await importImageUrl('https://example.com/assets/logo.png?size=2');

        expect(fetchMock).toHaveBeenCalledWith('https://example.com/assets/logo.png?size=2');
        expect(ref.name).toBe('logo.png');
        expect(ref.widthPx).toBe(5);
        expect(ref.heightPx).toBe(4);
        expect(ref.source.kind).toBe('remote');
        if (ref.source.kind !== 'remote') return;
        expect(ref.source.url).toBe('https://example.com/assets/logo.png?size=2');
        expect(ref.source.mediaType).toBe('image/png');
        // Remote provenance carries no resourceId/fingerprint — no IDB write.
        expect(Object.keys(ref.source).sort()).toEqual(['kind', 'mediaType', 'url']);
    });

    it('throws when the fetch is not ok', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponseLike(new Uint8Array(), null, false, 404)));
        await expect(importImageUrl('https://example.com/missing.png')).rejects.toThrow(
            /fetch failed \(404\)/,
        );
    });

    it('throws when the payload cannot be decoded', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponseLike(textBytes('nope'), 'image/png')));
        await expect(importImageUrl('https://example.com/broken.png')).rejects.toThrow(
            /could not decode image/,
        );
    });
});

describe('importFontFile', () => {
    it('stores bytes and returns an imported ref (family from filename, guessed MIME)', async () => {
        const bytes = textBytes('font-bytes');
        const file = new File([bytes], 'My Font.ttf');
        const repo = createResourceRepo(createMemoryAdapter());

        const { ref, bytes: returned } = await importFontFile(file, repo);

        expect(ref.familyName).toBe('My Font');
        expect(ref.name).toBe('My Font.ttf');
        expect([...returned]).toEqual([...bytes]);
        expect(ref.source.kind).toBe('imported');
        if (ref.source.kind !== 'imported') return;
        expect(ref.source.fingerprint).toMatch(hex64);
        expect(ref.source.asset.kind).toBe('local');
        if (ref.source.asset.kind !== 'local') return;
        expect(ref.source.asset.mediaType).toBe('font/ttf');
        expect(ref.source.asset.resourceId).toBe(ref.fontId);
        expect(ref.source.asset.fingerprint).toBe(ref.source.fingerprint);

        const stored = await repo.get(ref.fontId);
        expect(stored).not.toBeNull();
        expect(stored!.mediaType).toBe('font/ttf');
    });

    it('stores the family name on the record (phase 9, D2)', async () => {
        const file = new File([textBytes('font-bytes')], 'My Font.ttf');
        const repo = createResourceRepo(createMemoryAdapter());

        const { ref } = await importFontFile(file, repo);

        const stored = await repo.get(ref.fontId);
        expect(stored).toMatchObject({ name: 'My Font' });
        expect(stored!.widthPx).toBeUndefined();
        expect(stored!.heightPx).toBeUndefined();
    });

    it('honours an explicit file MIME and family/name/alt overrides', async () => {
        const file = new File([textBytes('x')], 'weird.bin', { type: 'font/woff2' });
        const { ref } = await importFontFile(file, createResourceRepo(createMemoryAdapter()), {
            familyName: 'Brand Sans',
            name: 'Brand Sans Regular',
            alt: 'the brand font',
        });
        expect(ref.familyName).toBe('Brand Sans');
        expect(ref.name).toBe('Brand Sans Regular');
        expect(ref.alt).toBe('the brand font');
        if (ref.source.kind === 'imported' && ref.source.asset.kind === 'local') {
            expect(ref.source.asset.mediaType).toBe('font/woff2');
        }
    });
});
