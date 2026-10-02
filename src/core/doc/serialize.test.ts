// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compress } from '../../utils/compress';
import { StreamReadingResponse } from '../../test/streamResponse';
import { createFtagSpareDoc } from './factory';
import { parseDoc, serializeDoc } from './serialize';
import type { LabelDoc } from './types';

/**
 * Same platform-gap adaptation as `src/utils/saveFileRoundTrip.test.ts`: the test
 * runtime's `DecompressionStream` writes straight into Node's `zlib`, which
 * rejects a raw `ArrayBuffer` and only accepts a view. `compress.ts` passes the
 * `ArrayBuffer` through unchanged, so the app's default gzip path needs the
 * runtime primitive adapted here. Production code is untouched.
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

const isGzip = (buffer: ArrayBuffer): boolean => {
    const bytes = new Uint8Array(buffer);
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
};

describe('serializeDoc / parseDoc', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
        // happy-dom's Response cannot read a compression readable; use a direct
        // stream reader so `compress.ts`'s Response promise never rejects unhandled.
        vi.stubGlobal('Response', StreamReadingResponse);
    });

    it('serializes to gzip bytes', async () => {
        const buffer = await serializeDoc(createFtagSpareDoc());
        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect(isGzip(buffer)).toBe(true);
    });

    it('round-trips a factory doc deep-equal through gzip', async () => {
        const doc = createFtagSpareDoc({ name: 'Round Trip', now: 1_700_000_000 });
        const parsed = await parseDoc(await serializeDoc(doc));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc).toEqual(doc);
    });

    it('round-trips nodes and asset provenances', async () => {
        const doc = createFtagSpareDoc({ now: 5 });
        doc.nodes = [
            {
                id: 'n1',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 1, y: 2, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'hi' },
            },
        ];
        doc.resources.images = [
            {
                imageId: 'i1',
                name: 'logo',
                source: { kind: 'local', mediaType: 'image/png', resourceId: 'r1' },
                widthPx: 10,
                heightPx: 20,
            },
        ];
        const parsed = await parseDoc(await serializeDoc(doc));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc).toEqual(doc);
    });

    it('accepts a plain JSON string', async () => {
        const doc = createFtagSpareDoc({ now: 7 });
        const parsed = await parseDoc(JSON.stringify(doc));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc).toEqual(doc);
    });

    it('accepts an uncompressed Uint8Array body', async () => {
        const doc = createFtagSpareDoc({ now: 8 });
        const bytes = new TextEncoder().encode(JSON.stringify(doc));
        const parsed = await parseDoc(bytes);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc.meta.createdAt).toBe(8);
    });
});

describe('parseDoc error handling (never throws)', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
        // happy-dom's Response cannot read a compression readable; use a direct
        // stream reader so `compress.ts`'s Response promise never rejects unhandled.
        vi.stubGlobal('Response', StreamReadingResponse);
    });

    it('returns an error result for malformed JSON', async () => {
        const parsed = await parseDoc('{ not json');
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.errors[0]).toContain('invalid JSON');
    });

    it('returns an error result for a truncated gzip stream', async () => {
        const parsed = await parseDoc(new Uint8Array([0x1f, 0x8b, 0x00, 0x00, 0x00]));
        expect(parsed.ok).toBe(false);
    });

    it('rejects an unknown document version with a precise error', async () => {
        const bytes = await compress(JSON.stringify({ version: 99, meta: {} }));
        const parsed = await parseDoc(bytes);
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.errors.join(' ')).toContain('unsupported document version 99');
    });

    it('does not throw on a JSON primitive', async () => {
        const parsed = await parseDoc('42');
        expect(parsed.ok).toBe(false);
    });
});

describe('serializeDoc thumb handling', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
        // happy-dom's Response cannot read a compression readable; use a direct
        // stream reader so `compress.ts`'s Response promise never rejects unhandled.
        vi.stubGlobal('Response', StreamReadingResponse);
    });

    it('strips an unsafe thumb on parse while keeping the document', async () => {
        const doc = createFtagSpareDoc({ now: 9 });
        // Deliberately attach an SVG (non-raster) thumb, as a hostile doc would.
        doc.meta.thumb = {
            mediaType: 'image/svg+xml',
            dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
            at: 9,
        } as LabelDoc['meta']['thumb'];
        const parsed = await parseDoc(await serializeDoc(doc));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc.meta.thumb).toBeUndefined();
        expect(parsed.doc.meta.id).toBe(doc.meta.id);
    });
});
