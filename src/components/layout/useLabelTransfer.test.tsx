// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import '../../i18n';
import { createFtagSpareDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import { compress } from '../../utils/compress';
import {
    BUNDLE_KIND,
    BUNDLE_VERSION,
    MAX_IMPORT_BYTES,
    buildBundle,
    type LabelBundle,
} from '../../data/bundle';
import { createCsvRepo } from '../../data/csvRepo';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo } from '../../data/labelRepo';
import { createResourceRepo } from '../../data/resourceRepo';
import { useStore } from '../../store/useStore';
import { StreamReadingResponse } from '../../test/streamResponse';
import { useLabelTransfer } from './useLabelTransfer';

/**
 * Same platform-gap adaptation as `src/data/bundle.test.ts`: the test runtime's
 * `DecompressionStream` rejects a raw `ArrayBuffer` and happy-dom's `Response`
 * cannot read a compression readable. `labelRepo.get` goes through both, so the
 * primitives are adapted here; production code is untouched.
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

const makeDoc = (name: string, now = NOW): LabelDoc =>
    createFtagSpareDoc({ name, now });

/** Inject real repos (over one memory adapter) into the app store. */
const fixture = () => {
    const adapter = createMemoryAdapter();
    const repos = {
        labelRepo: createLabelRepo(adapter),
        resourceRepo: createResourceRepo(adapter),
        csvRepo: createCsvRepo(adapter),
    };
    useStore.setState({
        ...repos,
        currentDoc: null,
        gallery: [],
        galleryLoading: false,
        notifications: [],
    });
    return repos;
};

const bundleFile = (value: unknown, name = 'labels.json'): File =>
    new File([JSON.stringify(value)], name, { type: 'application/json' });

const notifications = () => useStore.getState().notifications;

/** Spy the download seam: capture the blob and the `<a download>` name. */
const spyDownload = () => {
    const blobs: Blob[] = [];
    const anchors: HTMLAnchorElement[] = [];
    const createObjectURL = vi
        .spyOn(URL, 'createObjectURL')
        .mockImplementation((object: Blob | MediaSource) => {
            blobs.push(object as Blob);
            return `blob:${blobs.length}`;
        });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
    ) {
        anchors.push(this);
    });

    return {
        createObjectURL,
        revokeObjectURL,
        anchors,
        /** The parsed JSON of the last downloaded blob. */
        bundle: async (index = 0): Promise<LabelBundle> => {
            const blob = blobs[index];
            if (!blob) throw new Error(`no blob at index ${index}`);
            return JSON.parse(await blob.text()) as LabelBundle;
        },
    };
};

beforeEach(() => {
    vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
    vi.stubGlobal('Response', StreamReadingResponse);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useStore.setState({
        labelRepo: null,
        resourceRepo: null,
        csvRepo: null,
        currentDoc: null,
        gallery: [],
        galleryLoading: false,
        notifications: [],
    });
});

describe('useLabelTransfer — import', () => {
    it('imports a bundle, refreshes the gallery and reports success', async () => {
        const { labelRepo, resourceRepo, csvRepo } = fixture();
        const source = makeDoc('Imported label');
        const { bundle } = await buildBundle([source], { resourceRepo, csvRepo });

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.importFile(bundleFile(bundle));
        });

        const stored = await labelRepo.list();
        expect(stored).toHaveLength(1);
        expect(stored[0]!.name).toBe('Imported label');
        // The export id is never reused: the import mints a fresh one (P8a).
        expect(stored[0]!.id).not.toBe(source.meta.id);

        // The gallery is re-read from the repo, so the imported label shows up.
        expect(useStore.getState().gallery.map((summary) => summary.name)).toEqual([
            'Imported label',
        ]);

        expect(notifications()).toMatchObject([
            { type: 'success', message: 'Imported 1 label.' },
        ]);
    });

    it('rejects a file over MAX_IMPORT_BYTES without reading it', async () => {
        const { labelRepo } = fixture();
        const read = vi.fn(async () => new ArrayBuffer(0));
        const oversized = { size: MAX_IMPORT_BYTES + 1, arrayBuffer: read } as unknown as File;

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.importFile(oversized);
        });

        expect(read).not.toHaveBeenCalled();
        expect(await labelRepo.list()).toHaveLength(0);
        expect(notifications()).toMatchObject([
            { type: 'error', message: 'The file is too large to import.' },
        ]);
    });

    it('rejects invalid JSON with the failed notification', async () => {
        const { labelRepo } = fixture();

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.importFile(
                new File(['{ this is not json'], 'broken.json', { type: 'application/json' }),
            );
        });

        expect(await labelRepo.list()).toHaveLength(0);
        expect(notifications()).toMatchObject([
            { type: 'error', message: 'Could not import the labels.' },
        ]);
    });

    it('imports a gzipped bundle (the picker accepts .gz)', async () => {
        const { labelRepo } = fixture();
        const bundle = {
            kind: BUNDLE_KIND,
            version: BUNDLE_VERSION,
            exportedAt: NOW,
            docs: [makeDoc('Zipped')],
            csvs: [],
        };
        const gz = await compress(JSON.stringify(bundle), 'gzip');

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.importFile(
                new File([gz], 'labels.json.gz', { type: 'application/gzip' }),
            );
        });

        expect(await labelRepo.list()).toHaveLength(1);
        expect(notifications()).toMatchObject([
            { type: 'success', message: 'Imported 1 label.' },
        ]);
    });

    it('reports a partial import when one document is invalid', async () => {
        const { labelRepo } = fixture();
        const bundle = {
            kind: BUNDLE_KIND,
            version: BUNDLE_VERSION,
            exportedAt: NOW,
            docs: [makeDoc('Good'), { meta: {}, label: {} }],
            csvs: [],
        };

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.importFile(bundleFile(bundle));
        });

        expect(await labelRepo.list()).toHaveLength(1);
        expect(notifications()).toMatchObject([
            { type: 'warning', message: 'Imported 1 label; 1 failed.' },
        ]);
    });

    it('ignores a second import while one is already running', async () => {
        const { labelRepo, resourceRepo, csvRepo } = fixture();
        const { bundle } = await buildBundle([makeDoc('Once')], { resourceRepo, csvRepo });
        const file = bundleFile(bundle);

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            const first = result.current.importFile(file);
            const second = result.current.importFile(file);
            await Promise.all([first, second]);
        });

        expect(await labelRepo.list()).toHaveLength(1);
    });
});

describe('useLabelTransfer — export', () => {
    it('exports the open document as a JSON download', async () => {
        fixture();
        const doc = makeDoc('My label');
        useStore.setState({ currentDoc: doc });
        const download = spyDownload();

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.exportCurrent();
        });

        expect(download.anchors).toHaveLength(1);
        expect(download.anchors[0]!.download).toBe('My-label.json');

        const bundle = await download.bundle();
        expect(bundle.kind).toBe(BUNDLE_KIND);
        expect(bundle.docs).toHaveLength(1);
        expect(bundle.docs[0]!.meta.name).toBe('My label');
        // The object URL is released once the click has handed the blob over.
        expect(download.revokeObjectURL).toHaveBeenCalledWith('blob:1');
        // An export is not announced; only failures are.
        expect(notifications()).toHaveLength(0);
    });

    it('is a no-op when no document is open', async () => {
        fixture();
        const download = spyDownload();

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.exportCurrent();
        });

        expect(download.createObjectURL).not.toHaveBeenCalled();
        expect(notifications()).toHaveLength(0);
    });

    it('exports every stored label under the dated filename', async () => {
        const { labelRepo } = fixture();
        await labelRepo.save(makeDoc('One'));
        await labelRepo.save(makeDoc('Two', NOW + 100));
        const download = spyDownload();

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.exportAll();
        });

        expect(download.anchors[0]!.download).toMatch(
            /^niimbun-labels-\d{4}-\d{2}-\d{2}\.json$/,
        );
        const bundle = await download.bundle();
        expect(bundle.docs.map((doc) => doc.meta.name).sort()).toEqual(['One', 'Two']);
        expect(notifications()).toMatchObject([
            { type: 'success', message: 'Exported 2 labels.' },
        ]);
    });

    it('reports a failure when storage holds nothing readable', async () => {
        fixture();
        const download = spyDownload();

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.exportAll();
        });

        expect(download.createObjectURL).not.toHaveBeenCalled();
        expect(notifications()).toMatchObject([
            { type: 'error', message: 'Could not export the labels.' },
        ]);
    });

    it('reports a partial export when a stored record cannot be read', async () => {
        const { labelRepo } = fixture();
        await labelRepo.save(makeDoc('Readable'));
        // A second summary whose `get()` yields null (corrupt record).
        const listDetailed = labelRepo.listDetailed.bind(labelRepo);
        vi.spyOn(labelRepo, 'listDetailed').mockImplementation(async () => {
            const result = await listDetailed();
            return { ...result, ok: [...result.ok, { ...result.ok[0]!, id: 'corrupt' }] };
        });
        const get = labelRepo.get.bind(labelRepo);
        vi.spyOn(labelRepo, 'get').mockImplementation(async (id: string) =>
            id === 'corrupt' ? null : get(id),
        );
        const download = spyDownload();

        const { result } = renderHook(() => useLabelTransfer());
        await act(async () => {
            await result.current.exportAll();
        });

        const bundle = await download.bundle();
        expect(bundle.docs.map((doc) => doc.meta.name)).toEqual(['Readable']);
        expect(notifications()).toMatchObject([
            { type: 'warning', message: 'Exported 1 label; 1 could not be read.' },
        ]);
    });
});
