// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamReadingResponse } from '../test/streamResponse';
import { createFtagSpareDoc } from '../core/doc/factory';
import type { AssetRef, CsvRef, FontRef, ImageRef, LabelDoc } from '../core/doc/types';
import {
    BUNDLE_KIND,
    BUNDLE_VERSION,
    buildBundle,
    bytesToDataUrl,
    dataUrlToBytes,
    importBundle,
    isLabelBundle,
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
/** Every byte value, so the data-URL round trip cannot lose `0x00`/`0xFF`. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, index) => index);

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

const localImage = (resourceId: string): ImageRef => ({
    imageId: 'img-1',
    name: 'photo.png',
    source: { kind: 'local', mediaType: 'image/png', resourceId },
    widthPx: 8,
    heightPx: 6,
});

const remoteImage = (url: string): ImageRef => ({
    imageId: 'img-remote',
    name: 'remote.png',
    source: { kind: 'remote', mediaType: 'image/png', url },
    widthPx: 8,
    heightPx: 6,
});

const localFont = (resourceId: string): FontRef => ({
    fontId: 'font-1',
    familyName: 'Inter',
    name: 'Inter Bold',
    source: {
        kind: 'imported',
        asset: { kind: 'local', mediaType: 'font/woff2', resourceId },
    },
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

    it('counts unreadable local refs and leaves them local', async () => {
        const fixture = setup();
        const doc = makeDoc('doc-missing');
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

    it('leaves remote refs untouched', async () => {
        const doc = makeDoc('doc-remote');
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
