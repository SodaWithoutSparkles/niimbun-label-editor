// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamReadingResponse } from '../test/streamResponse';
import { createFtagSpareDoc } from '../core/doc/factory';
import type {
    AssetRef,
    CsvRef,
    FontRef,
    ImageNode,
    ImageRef,
    LabelDoc,
    TextNode,
} from '../core/doc/types';
import {
    BUNDLE_KIND,
    BUNDLE_VERSION,
    buildBundle,
    bytesToDataUrl,
    dataUrlToBytes,
    importBundle,
    isLabelBundle,
    referencedAssetIds,
    type LabelBundle,
} from './bundle';
import type { CsvRecord } from './csvRepo';
import { createCsvRepo } from './csvRepo';
import { createMemoryAdapter } from './db';
import type { LabelRepo } from './labelRepo';
import { createLabelRepo } from './labelRepo';
import { createResourceRepo } from './resourceRepo';

/**
 * `labelRepo.save` gzips and `get` un-gzips, so the tests read back through the
 * real repo. Same platform-gap adaptation as `labelRepo.test.ts`: the test
 * runtime's `DecompressionStream` writes straight into Node's `zlib` and rejects
 * a raw `ArrayBuffer`, and happy-dom's `Response` cannot read a compression
 * stream. Production code is untouched.
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

const NOW = 1_700_000_000;

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x7f, 0x80]);
const FONT_BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff]);
/** Bytes of assets no node references — must never reach the bundle JSON. */
const UNUSED_IMAGE_BYTES = Uint8Array.from({ length: 64 }, (_, index) => (index * 3) % 256);
const UNUSED_FONT_BYTES = Uint8Array.from({ length: 48 }, (_, index) => (index * 7 + 1) % 256);
/** Bytes of a registry entry shadowed by a duplicate id — must not ship either. */
const SHADOWED_BYTES = Uint8Array.from({ length: 32 }, (_, index) => (index * 11 + 5) % 256);
/** Every byte value, so the data-URL round trip cannot lose `0x00`/`0xFF`. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, index) => index);

/** base64 body of a data URL (what a leaked asset would leave in the JSON). */
const payloadOf = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1);

const setup = () => {
    const adapter = createMemoryAdapter();
    return {
        adapter,
        labelRepo: createLabelRepo(adapter),
        resourceRepo: createResourceRepo(adapter),
        csvRepo: createCsvRepo(adapter),
    };
};

type Fixture = ReturnType<typeof setup>;

const makeDoc = (id: string, now = NOW): LabelDoc =>
    createFtagSpareDoc({ id, name: `Label ${id}`, now });

const DEG = { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };

const imageNode = (imageId: string, id = `node-${imageId}`): ImageNode => ({
    id,
    parentId: null,
    type: 'image',
    imageId,
    visible: true,
    locked: false,
    transform: { ...DEG },
    size: { w: 800, h: 600 },
});

const textNode = (
    over: Partial<Pick<TextNode, 'fontId' | 'fontFamily'>> = {},
    id = 'text-node',
): TextNode => ({
    id,
    parentId: null,
    type: 'text',
    text: { kind: 'static', value: 'hello' },
    visible: true,
    locked: false,
    transform: { ...DEG },
    size: { w: 1000, h: 400 },
    fontSize: 300,
    ...over,
});

const localImage = (resourceId: string, imageId = 'img-1'): ImageRef => ({
    imageId,
    name: 'photo.png',
    source: { kind: 'local', mediaType: 'image/png', resourceId },
    widthPx: 8,
    heightPx: 6,
});

const remoteImage = (url: string, imageId = 'img-remote'): ImageRef => ({
    imageId,
    name: 'remote.png',
    source: { kind: 'remote', mediaType: 'image/png', url },
    widthPx: 8,
    heightPx: 6,
});

const inlineImage = (dataUrl: string, imageId = 'img-inline'): ImageRef => ({
    imageId,
    name: 'inline.png',
    source: { kind: 'inline', mediaType: 'image/png', dataUrl },
    widthPx: 8,
    heightPx: 6,
});

const localFont = (
    resourceId: string,
    over: Partial<Pick<FontRef, 'fontId' | 'familyName' | 'name'>> = {},
): FontRef => ({
    fontId: 'font-1',
    familyName: 'Inter',
    name: 'Inter Bold',
    source: {
        kind: 'imported',
        asset: { kind: 'local', mediaType: 'font/woff2', resourceId },
    },
    ...over,
});

const csvRecord = (id: string): CsvRecord => ({
    id,
    name: 'table.csv',
    columns: ['sku', 'qty'],
    rows: [
        ['A-1', '2'],
        ['B-2', '5'],
    ],
});

const localCsvRef = (csvId: string): CsvRef => ({
    csvId,
    name: 'table',
    source: { kind: 'local', mediaType: 'text/csv', resourceId: csvId },
});

/** A doc referencing one stored image, one stored font and one stored CSV. */
const withLocalAssets = (doc: LabelDoc, resourceId = 'img-res', csvId = 'csv-1'): LabelDoc => {
    doc.resources.images.push(localImage(resourceId));
    doc.resources.fonts.push(localFont('font-res'));
    doc.nodes.push(imageNode('img-1'), textNode({ fontId: 'font-1', fontFamily: 'Inter' }));
    doc.data.csv = localCsvRef(csvId);
    return doc;
};

const seedAssets = async (fixture: Fixture, csvId = 'csv-1'): Promise<void> => {
    await fixture.resourceRepo.put({
        id: 'img-res',
        mediaType: 'image/png',
        bytes: IMAGE_BYTES,
        name: 'photo.png',
        widthPx: 8,
        heightPx: 6,
    });
    await fixture.resourceRepo.put({
        id: 'font-res',
        mediaType: 'font/woff2',
        bytes: FONT_BYTES,
        name: 'Inter',
    });
    await fixture.csvRepo.put(csvRecord(csvId));
};

const localSource = (source: AssetRef): Extract<AssetRef, { kind: 'local' }> => {
    if (source.kind !== 'local') throw new Error(`expected a local ref, got ${source.kind}`);
    return source;
};

const onlyDoc = async (labelRepo: LabelRepo): Promise<LabelDoc> => {
    const list = await labelRepo.list();
    expect(list).toHaveLength(1);
    const doc = await labelRepo.get(list[0].id);
    if (!doc) throw new Error('imported document could not be read back');
    return doc;
};

describe('buildBundle', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
        vi.stubGlobal('Response', StreamReadingResponse);
    });

    it('inlines local images and imported fonts, and embeds a shared CSV once', async () => {
        const fixture = setup();
        await seedAssets(fixture);

        const first = withLocalAssets(makeDoc('doc-a', 100));
        const second = withLocalAssets(makeDoc('doc-b', 200));
        const getCsv = vi.fn((id: string) => fixture.csvRepo.get(id));

        const result = await buildBundle([first, second], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: { get: getCsv },
            now: NOW,
        });

        expect(result.missing).toBe(0);
        expect(result.bundle.kind).toBe(BUNDLE_KIND);
        expect(result.bundle.version).toBe(BUNDLE_VERSION);
        expect(result.bundle.exportedAt).toBe(NOW);
        expect(result.bundle.docs).toHaveLength(2);
        // Two docs share one table: it is read and embedded exactly once.
        expect(result.bundle.csvs).toEqual([csvRecord('csv-1')]);
        expect(getCsv).toHaveBeenCalledTimes(1);
        expect(getCsv).toHaveBeenCalledWith('csv-1');

        const expectedImage: AssetRef = {
            kind: 'inline',
            mediaType: 'image/png',
            dataUrl: bytesToDataUrl(IMAGE_BYTES, 'image/png'),
        };
        const expectedFont: AssetRef = {
            kind: 'inline',
            mediaType: 'font/woff2',
            dataUrl: bytesToDataUrl(FONT_BYTES, 'font/woff2'),
        };

        for (const doc of result.bundle.docs) {
            expect(doc.resources.images[0].source).toEqual(expectedImage);
            expect(doc.resources.fonts[0].source).toEqual({
                kind: 'imported',
                asset: expectedFont,
            });
            // The CSV ref stays as-is on export; only the table is embedded.
            expect(doc.data.csv?.csvId).toBe('csv-1');
        }

        // The caller's documents are untouched.
        expect(first.resources.images[0].source).toEqual(localImage('img-res').source);
        expect(first.resources.fonts[0].source).toEqual(localFont('font-res').source);
    });

    it('counts referenced unreadable local refs and leaves them local', async () => {
        const fixture = setup();
        const doc = makeDoc('doc-missing');
        doc.nodes.push(imageNode('img-1'), textNode({ fontId: 'font-1' }));
        doc.resources.images.push(localImage('gone-image'));
        doc.resources.fonts.push(localFont('gone-font'));

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: fixture.csvRepo,
            now: NOW,
        });

        expect(result.missing).toBe(2);
        expect(result.bundle.docs[0].resources.images[0].source).toEqual(
            localImage('gone-image').source,
        );
        expect(result.bundle.docs[0].resources.fonts[0].source).toEqual(
            localFont('gone-font').source,
        );
        expect(result.bundle.csvs).toEqual([]);
    });

    it('prunes an unreferenced unreadable ref and does not report it missing', async () => {
        const fixture = setup();
        const doc = makeDoc('doc-unreferenced-missing');
        doc.resources.images.push(localImage('gone-image'));
        doc.resources.fonts.push(localFont('gone-font'));

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: fixture.csvRepo,
            now: NOW,
        });

        // Nothing needs those bytes, so nothing is missing from the bundle.
        expect(result.missing).toBe(0);
        expect(result.bundle.docs[0].resources).toEqual({ fonts: [], images: [] });
    });

    it('drops an unreferenced image and never writes its bytes', async () => {
        const fixture = setup();
        await seedAssets(fixture);
        await fixture.resourceRepo.put({
            id: 'img-unused',
            mediaType: 'image/png',
            bytes: UNUSED_IMAGE_BYTES,
            name: 'unused.png',
            widthPx: 8,
            heightPx: 6,
        });

        const doc = withLocalAssets(makeDoc('doc-prune-image'));
        // The registry keeps every image ever inserted; the node was deleted.
        doc.resources.images.push(localImage('img-unused', 'img-unused'));

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: fixture.csvRepo,
            now: NOW,
        });

        expect(result.missing).toBe(0);
        expect(result.bundle.docs[0].resources.images.map((ref) => ref.imageId)).toEqual([
            'img-1',
        ]);
        // The kept ref is inlined; the unused one leaves no bytes behind.
        expect(result.bundle.docs[0].resources.images[0].source.kind).toBe('inline');
        const unusedDataUrl = bytesToDataUrl(UNUSED_IMAGE_BYTES, 'image/png');
        const json = JSON.stringify(result.bundle);
        expect(json).not.toContain(unusedDataUrl);
        expect(json).not.toContain(payloadOf(unusedDataUrl));

        // The caller's document still carries both refs.
        expect(doc.resources.images).toHaveLength(2);
    });

    it('keeps fonts referenced by id or by legacy family and drops the unused one', async () => {
        const fixture = setup();
        await seedAssets(fixture);
        await fixture.resourceRepo.put({
            id: 'font-legacy-res',
            mediaType: 'font/woff2',
            bytes: ALL_BYTES,
            name: 'Legacy',
        });
        await fixture.resourceRepo.put({
            id: 'font-unused-res',
            mediaType: 'font/woff2',
            bytes: UNUSED_FONT_BYTES,
            name: 'Unused',
        });

        const doc = makeDoc('doc-prune-fonts');
        doc.nodes.push(
            imageNode('img-1', 'image-node'),
            textNode({ fontId: 'font-1', fontFamily: 'Inter' }, 'text-by-id'),
            // A legacy node: family name only, no `fontId`.
            textNode({ fontFamily: 'Legacy Sans' }, 'text-by-family'),
        );
        doc.resources.images.push(localImage('img-res'));
        doc.resources.fonts.push(
            localFont('font-res'),
            localFont('font-legacy-res', {
                fontId: 'font-legacy',
                familyName: 'Legacy Sans',
                name: 'Legacy',
            }),
            localFont('font-unused-res', {
                fontId: 'font-unused',
                familyName: 'Unused',
                name: 'Unused',
            }),
        );

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: null,
            now: NOW,
        });

        expect(result.missing).toBe(0);
        const fonts = result.bundle.docs[0].resources.fonts;
        expect(fonts.map((ref) => ref.fontId)).toEqual(['font-1', 'font-legacy']);
        for (const font of fonts) {
            expect(font.source.kind).toBe('imported');
            if (font.source.kind !== 'imported') continue;
            expect(font.source.asset.kind).toBe('inline');
        }
        expect(JSON.stringify(result.bundle)).not.toContain(
            payloadOf(bytesToDataUrl(UNUSED_FONT_BYTES, 'font/woff2')),
        );
    });

    it('keeps the font a node names by family even when it also has a fontId', async () => {
        const fixture = setup();
        await fixture.resourceRepo.put({
            id: 'font-a-res',
            mediaType: 'font/woff2',
            bytes: FONT_BYTES,
            name: 'A',
        });
        await fixture.resourceRepo.put({
            id: 'font-b-res',
            mediaType: 'font/woff2',
            bytes: ALL_BYTES,
            name: 'B',
        });

        const doc = makeDoc('doc-font-id-and-family');
        // The render path resolves `fontFamily`; `ensureFonts` registers by
        // `familyName`, so both registry entries are usable and must ship.
        // NOTE: a `fontId` plus a *mismatched* `fontFamily` is only reachable
        // through an import / a legacy document — the inspector detaches the
        // link when they disagree, so this is not a normal editor state.
        doc.nodes.push(textNode({ fontId: 'a', fontFamily: 'B Family' }));
        doc.resources.fonts.push(
            localFont('font-a-res', { fontId: 'a', familyName: 'A Family', name: 'A' }),
            localFont('font-b-res', { fontId: 'b', familyName: 'B Family', name: 'B' }),
        );

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: null,
            now: NOW,
        });

        expect(result.missing).toBe(0);
        expect(result.bundle.docs[0].resources.fonts.map((ref) => ref.fontId)).toEqual([
            'a',
            'b',
        ]);
    });

    it('collapses a duplicate imageId to the entry the renderer picks (the last)', async () => {
        const fixture = setup();
        await fixture.resourceRepo.put({
            id: 'img-res',
            mediaType: 'image/png',
            bytes: IMAGE_BYTES,
            name: 'photo.png',
        });
        await fixture.resourceRepo.put({
            id: 'img-first',
            mediaType: 'image/png',
            bytes: SHADOWED_BYTES,
            name: 'first.png',
        });
        await fixture.resourceRepo.put({
            id: 'img-second',
            mediaType: 'image/png',
            bytes: UNUSED_IMAGE_BYTES,
            name: 'second.png',
        });

        const doc = makeDoc('doc-duplicate-image');
        doc.nodes.push(imageNode('img-1'), imageNode('img-shared'));
        doc.resources.images.push(
            localImage('img-res', 'img-1'),
            localImage('img-first', 'img-shared'),
            localImage('img-second', 'img-shared'),
        );

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: null,
            now: NOW,
        });

        const images = result.bundle.docs[0].resources.images;
        // Registry order is preserved for the refs that survive, and the
        // duplicate collapses to its last entry (the renderer's pick).
        expect(images.map((ref) => ref.imageId)).toEqual(['img-1', 'img-shared']);
        expect(images[1].source).toEqual({
            kind: 'inline',
            mediaType: 'image/png',
            dataUrl: bytesToDataUrl(UNUSED_IMAGE_BYTES, 'image/png'),
        });
        // The shadowed first entry's bytes never reach the bundle.
        expect(JSON.stringify(result.bundle)).not.toContain(
            payloadOf(bytesToDataUrl(SHADOWED_BYTES, 'image/png')),
        );
    });

    it('collapses a duplicate fontId to the last entry and keeps registry order', async () => {
        const fixture = setup();
        await fixture.resourceRepo.put({
            id: 'font-res',
            mediaType: 'font/woff2',
            bytes: FONT_BYTES,
            name: 'Inter',
        });
        await fixture.resourceRepo.put({
            id: 'font-shadowed-res',
            mediaType: 'font/woff2',
            bytes: SHADOWED_BYTES,
            name: 'shadowed',
        });
        await fixture.resourceRepo.put({
            id: 'font-last-res',
            mediaType: 'font/woff2',
            bytes: UNUSED_FONT_BYTES,
            name: 'last',
        });

        const doc = makeDoc('doc-duplicate-font');
        doc.nodes.push(
            textNode({ fontId: 'font-1' }, 'text-id'),
            textNode({ fontId: 'font-shared' }, 'text-shared'),
        );
        doc.resources.fonts.push(
            localFont('font-res'),
            localFont('font-shadowed-res', {
                fontId: 'font-shared',
                familyName: 'Shadowed',
                name: 'shadowed',
            }),
            localFont('font-last-res', {
                fontId: 'font-shared',
                familyName: 'Shadowed',
                name: 'last',
            }),
        );

        const result = await buildBundle([doc], {
            resourceRepo: fixture.resourceRepo,
            csvRepo: null,
            now: NOW,
        });

        const fonts = result.bundle.docs[0].resources.fonts;
        expect(fonts.map((ref) => ref.fontId)).toEqual(['font-1', 'font-shared']);
        expect(fonts[1].source).toEqual({
            kind: 'imported',
            asset: {
                kind: 'inline',
                mediaType: 'font/woff2',
                dataUrl: bytesToDataUrl(UNUSED_FONT_BYTES, 'font/woff2'),
            },
        });
        expect(JSON.stringify(result.bundle)).not.toContain(
            payloadOf(bytesToDataUrl(SHADOWED_BYTES, 'font/woff2')),
        );
    });

    it('drops unreferenced inline and remote refs', async () => {
        const doc = makeDoc('doc-unreferenced-kinds');
        const inlineDataUrl = bytesToDataUrl(UNUSED_IMAGE_BYTES, 'image/png');
        doc.resources.images.push(
            inlineImage(inlineDataUrl),
            remoteImage('https://example.test/unused.png'),
        );

        const result = await buildBundle([doc], {
            resourceRepo: null,
            csvRepo: null,
            now: NOW,
        });

        expect(result.missing).toBe(0);
        expect(result.bundle.docs[0].resources.images).toEqual([]);
        // An unreferenced inline image would otherwise ship its base64 body.
        expect(JSON.stringify(result.bundle)).not.toContain(payloadOf(inlineDataUrl));
    });

    it('leaves a referenced remote ref untouched', async () => {
        const doc = makeDoc('doc-remote');
        doc.nodes.push(imageNode('img-remote'));
        doc.resources.images.push(remoteImage('https://example.test/a.png'));

        const result = await buildBundle([doc], {
            resourceRepo: null,
            csvRepo: null,
            now: NOW,
        });

        expect(result.missing).toBe(0);
        expect(result.bundle.docs[0].resources.images[0].source).toEqual(
            remoteImage('https://example.test/a.png').source,
        );
    });
});

describe('referencedAssetIds', () => {
    it('collects image ids, font ids, and legacy family-only names', () => {
        const doc = makeDoc('doc-refs');
        doc.nodes.push(
            imageNode('img-a', 'image-a'),
            imageNode('img-a', 'image-b'),
            textNode({ fontId: 'font-1', fontFamily: 'Inter' }, 'text-by-id'),
            textNode({ fontFamily: 'Legacy Sans' }, 'text-by-family'),
        );

        const ids = referencedAssetIds(doc);
        expect([...ids.imageIds]).toEqual(['img-a']);
        expect([...ids.fontIds]).toEqual(['font-1']);
        // Every non-empty family is collected, including from a node that also
        // has a `fontId` (the render path may resolve through either).
        expect([...ids.fontFamilies]).toEqual(['Inter', 'Legacy Sans']);
    });
});

describe('importBundle', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
        vi.stubGlobal('Response', StreamReadingResponse);
    });

    const writeDeps = (fixture: Fixture) => ({
        labelRepo: fixture.labelRepo,
        resourceRepo: fixture.resourceRepo,
        csvRepo: fixture.csvRepo,
        now: NOW,
    });

    it('mints fresh ids and stores inline assets as local, byte for byte', async () => {
        const fixture = setup();
        const doc = makeDoc('old-doc', 1_500_000_000);
        doc.meta.createdAt = 1_400_000_000;
        doc.resources.images.push({
            imageId: 'img-old',
            name: 'scan.png',
            source: {
                kind: 'inline',
                mediaType: 'image/png',
                dataUrl: bytesToDataUrl(ALL_BYTES, 'image/png'),
            },
            widthPx: 3,
            heightPx: 4,
        });
        doc.resources.fonts.push({
            fontId: 'font-old',
            familyName: 'Inter',
            name: 'Inter Bold',
            source: {
                kind: 'imported',
                asset: {
                    kind: 'inline',
                    mediaType: 'font/woff2',
                    dataUrl: bytesToDataUrl(FONT_BYTES, 'font/woff2'),
                },
            },
        });
        doc.data.csv = localCsvRef('csv-old');

        const bundle: LabelBundle = {
            kind: BUNDLE_KIND,
            version: BUNDLE_VERSION,
            exportedAt: 1,
            docs: [doc],
            csvs: [csvRecord('csv-old')],
        };

        const result = await importBundle(bundle, writeDeps(fixture));

        expect(result).toEqual({ imported: 1, errors: [], warnings: 0 });

        const imported = await onlyDoc(fixture.labelRepo);
        expect(imported.meta.id).not.toBe('old-doc');
        expect(imported.meta.name).toBe('Label old-doc');
        expect(imported.meta.createdAt).toBe(1_400_000_000);
        expect(imported.meta.updatedAt).toBe(NOW);

        const image = localSource(imported.resources.images[0].source);
        expect(image.mediaType).toBe('image/png');
        const imageRecord = await fixture.resourceRepo.get(image.resourceId);
        expect(imageRecord?.bytes).toEqual(ALL_BYTES);
        expect(imageRecord?.mediaType).toBe('image/png');
        expect(imageRecord?.name).toBe('scan.png');
        expect(imageRecord?.widthPx).toBe(3);
        expect(imageRecord?.heightPx).toBe(4);

        const fontSource = imported.resources.fonts[0].source;
        if (fontSource.kind !== 'imported') throw new Error('expected an imported font');
        const fontAsset = localSource(fontSource.asset);
        const fontRecord = await fixture.resourceRepo.get(fontAsset.resourceId);
        expect(fontRecord?.bytes).toEqual(FONT_BYTES);
        expect(fontRecord?.name).toBe('Inter Bold');

        const csv = imported.data.csv;
        if (!csv) throw new Error('expected an attached CSV');
        expect(csv.csvId).not.toBe('csv-old');
        expect(await fixture.csvRepo.get(csv.csvId)).toEqual({ ...csvRecord('csv-old'), id: csv.csvId });
        // A `local` CSV ref uses the table id as its resource key.
        expect(csv.source).toEqual({
            kind: 'local',
            mediaType: 'text/csv',
            resourceId: csv.csvId,
        });

        // The input document is untouched (the import works on a clone).
        expect(doc.resources.images[0].source.kind).toBe('inline');
    });

    it('round-trips a bundle into a fresh store', async () => {
        const source = setup();
        await seedAssets(source);
        const doc = withLocalAssets(makeDoc('doc-1', 1_600_000_000));
        const { bundle, missing } = await buildBundle([doc], {
            resourceRepo: source.resourceRepo,
            csvRepo: source.csvRepo,
            now: NOW,
        });
        expect(missing).toBe(0);

        const destination = setup();
        const result = await importBundle(bundle, {
            labelRepo: destination.labelRepo,
            resourceRepo: destination.resourceRepo,
            csvRepo: destination.csvRepo,
            now: NOW + 60,
        });
        expect(result).toEqual({ imported: 1, errors: [], warnings: 0 });

        const imported = await onlyDoc(destination.labelRepo);
        expect(imported.meta.id).not.toBe('doc-1');
        expect(imported.meta.updatedAt).toBe(NOW + 60);

        const image = localSource(imported.resources.images[0].source);
        const imageRecord = await destination.resourceRepo.get(image.resourceId);
        expect(imageRecord?.bytes).toEqual(IMAGE_BYTES);

        const fontSource = imported.resources.fonts[0].source;
        if (fontSource.kind !== 'imported') throw new Error('expected an imported font');
        const fontRecord = await destination.resourceRepo.get(
            localSource(fontSource.asset).resourceId,
        );
        expect(fontRecord?.bytes).toEqual(FONT_BYTES);

        const csv = imported.data.csv;
        if (!csv) throw new Error('expected an attached CSV');
        expect(await destination.csvRepo.get(csv.csvId)).toEqual({
            ...csvRecord('csv-1'),
            id: csv.csvId,
        });
    });

    it('round-trips a pruned registry and every node still resolves', async () => {
        const source = setup();
        await seedAssets(source);
        await source.resourceRepo.put({
            id: 'img-unused',
            mediaType: 'image/png',
            bytes: UNUSED_IMAGE_BYTES,
            name: 'unused.png',
            widthPx: 8,
            heightPx: 6,
        });

        const doc = withLocalAssets(makeDoc('doc-pruned', 1_650_000_000));
        doc.resources.images.push(localImage('img-unused', 'img-unused'));

        const { bundle, missing } = await buildBundle([doc], {
            resourceRepo: source.resourceRepo,
            csvRepo: source.csvRepo,
            now: NOW,
        });
        expect(missing).toBe(0);
        expect(bundle.docs[0].resources.images).toHaveLength(1);
        expect(JSON.stringify(bundle)).not.toContain(
            payloadOf(bytesToDataUrl(UNUSED_IMAGE_BYTES, 'image/png')),
        );

        const destination = setup();
        const result = await importBundle(bundle, {
            labelRepo: destination.labelRepo,
            resourceRepo: destination.resourceRepo,
            csvRepo: destination.csvRepo,
            now: NOW + 60,
        });
        expect(result).toEqual({ imported: 1, errors: [], warnings: 0 });

        const imported = await onlyDoc(destination.labelRepo);
        // The pruned registry arrived intact: one image, one font.
        expect(imported.resources.images).toHaveLength(1);
        expect(imported.resources.fonts).toHaveLength(1);

        // Every node reference resolves against the imported registry.
        for (const node of imported.nodes) {
            if (node.type === 'image') {
                const ref = imported.resources.images.find((image) => image.imageId === node.imageId);
                expect(ref).toBeDefined();
                if (!ref) continue;
                const local = localSource(ref.source);
                expect((await destination.resourceRepo.get(local.resourceId))?.bytes).toEqual(
                    IMAGE_BYTES,
                );
            } else if (node.type === 'text' && node.fontId) {
                expect(
                    imported.resources.fonts.some((font) => font.fontId === node.fontId),
                ).toBe(true);
            }
        }
    });

    it('accepts a single doc, an array, and a bundle envelope', async () => {
        const single = setup();
        expect(
            (await importBundle(makeDoc('single'), writeDeps(single))).imported,
        ).toBe(1);

        const list = setup();
        const listResult = await importBundle(
            [makeDoc('list-a'), makeDoc('list-b')],
            writeDeps(list),
        );
        expect(listResult.imported).toBe(2);
        expect(await list.labelRepo.list()).toHaveLength(2);

        const envelope = setup();
        const bundle: LabelBundle = {
            kind: BUNDLE_KIND,
            version: BUNDLE_VERSION,
            exportedAt: NOW,
            docs: [makeDoc('enveloped')],
            csvs: [],
        };
        expect(isLabelBundle(bundle)).toBe(true);
        expect((await importBundle(bundle, writeDeps(envelope))).imported).toBe(1);
    });

    it('rejects unrecognised input with one error and imports nothing', async () => {
        const fixture = setup();
        const result = await importBundle('not a label', writeDeps(fixture));

        expect(result.imported).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.warnings).toBe(0);
        expect(await fixture.labelRepo.list()).toEqual([]);
    });

    it('imports the valid docs when one in the list is invalid', async () => {
        const fixture = setup();
        const valid = makeDoc('valid');
        const invalid = { version: 1, meta: {} };

        const result = await importBundle([invalid, valid], writeDeps(fixture));

        expect(result.imported).toBe(1);
        expect(result.errors.length).toBeGreaterThan(0);
        const listed = await fixture.labelRepo.list();
        expect(listed).toHaveLength(1);
        expect(listed[0].name).toBe('Label valid');
    });

    it('warns and keeps the ref when the CSV is absent from the bundle', async () => {
        const fixture = setup();
        const doc = makeDoc('doc-csv');
        doc.data.csv = localCsvRef('csv-missing');
        const bundle: LabelBundle = {
            kind: BUNDLE_KIND,
            version: BUNDLE_VERSION,
            exportedAt: NOW,
            docs: [doc],
            csvs: [],
        };

        const result = await importBundle(bundle, writeDeps(fixture));

        expect(result).toEqual({ imported: 1, errors: [], warnings: 1 });
        const imported = await onlyDoc(fixture.labelRepo);
        expect(imported.data.csv?.csvId).toBe('csv-missing');
        expect(await fixture.csvRepo.get('csv-missing')).toBeNull();
    });

    it('leaves remote image refs untouched', async () => {
        const fixture = setup();
        const doc = makeDoc('doc-remote');
        doc.resources.images.push(remoteImage('https://example.test/a.png'));

        const result = await importBundle(doc, writeDeps(fixture));

        expect(result).toEqual({ imported: 1, errors: [], warnings: 0 });
        const imported = await onlyDoc(fixture.labelRepo);
        expect(imported.resources.images[0].source).toEqual(
            remoteImage('https://example.test/a.png').source,
        );
    });

    it('reports a save failure without counting the doc and keeps going', async () => {
        const fixture = setup();
        const save = vi.fn(async (doc: LabelDoc) => {
            if (doc.meta.name === 'Label bad') throw new Error('disk full');
            await fixture.labelRepo.save(doc);
        });

        const result = await importBundle([makeDoc('bad'), makeDoc('good')], {
            labelRepo: { save },
            resourceRepo: null,
            csvRepo: null,
            now: NOW,
        });

        expect(result.imported).toBe(1);
        expect(result.errors).toEqual(['save: disk full']);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('warns and keeps an inline asset when no resource repo is available', async () => {
        const fixture = setup();
        const doc = makeDoc('doc-inline');
        doc.resources.images.push({
            imageId: 'inline-image',
            name: 'Inline',
            source: {
                kind: 'inline',
                mediaType: 'image/png',
                dataUrl: bytesToDataUrl(IMAGE_BYTES, 'image/png'),
            },
            widthPx: 1,
            heightPx: 1,
        });

        const result = await importBundle(doc, {
            labelRepo: fixture.labelRepo,
            resourceRepo: null,
            csvRepo: null,
            now: NOW,
        });

        expect(result.imported).toBe(1);
        expect(result.warnings).toBe(1);
        const imported = await onlyDoc(fixture.labelRepo);
        expect(imported.resources.images[0].source.kind).toBe('inline');
    });

    it('reports an unsupported bundle version instead of a document-version error', async () => {
        const fixture = setup();
        const result = await importBundle(
            { kind: BUNDLE_KIND, version: 99, exportedAt: NOW, docs: [], csvs: [] },
            writeDeps(fixture),
        );

        expect(result).toEqual({
            imported: 0,
            errors: ['bundle: unsupported bundle version 99'],
            warnings: 0,
        });
    });
});

describe('data URL helpers', () => {
    it('round-trips empty bytes and rejects non-base64 / non-data URLs', () => {
        expect(dataUrlToBytes(bytesToDataUrl(new Uint8Array(0), 'image/png'))).toEqual(
            new Uint8Array(0),
        );
        expect(dataUrlToBytes('not a data url')).toBeNull();
        expect(dataUrlToBytes('data:image/png,abc')).toBeNull();
    });
});
