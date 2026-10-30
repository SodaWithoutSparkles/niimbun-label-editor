// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { StreamReadingResponse } from '../../test/streamResponse';
import { FillPresetDialog } from './FillPresetDialog';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo, type LabelRepo } from '../../data/labelRepo';
import { createCsvRepo, type CsvRecord } from '../../data/csvRepo';
import { createLabelDoc } from '../../core/doc/factory';
import type { ContentSource, FieldDef, LabelDoc, Node, TextNode } from '../../core/doc/types';
import type { ResolveContext } from '../../editor/render';
import type { PrintJobDeps } from '../print/usePrintJob';

/**
 * P5/P6b — the preset fill dialog: one input per field, the live preview through
 * the shared content pass, Print through the same job, and "Open in editor"
 * as a `kind: 'label'` copy. happy-dom has no canvas, so `renderDocPreview` is
 * mocked; the dialog's scheduling and content are what this test owns.
 */

interface CapturedPrintProps {
    doc: LabelDoc;
    csv?: CsvRecord | null;
    csvStatus?: string;
    csvRevision?: number;
    prepareRow?: (rowIndex: number) => Promise<ResolveContext>;
}

const { renderPreviewMock, printProps, printJobOverride } = vi.hoisted(() => ({
    renderPreviewMock: vi.fn(),
    printProps: [] as CapturedPrintProps[],
    // Set for one test to substitute a stable, hand-built job (the identity
    // test needs to observe the exact function reference both surfaces get).
    printJobOverride: { current: null as PrintJobDeps | null },
}));

vi.mock('../../editor/render/docThumbnail', () => ({
    renderDocPreview: renderPreviewMock,
    GALLERY_THUMBNAIL_DPI: 100,
}));

vi.mock('../print/usePrintJob', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../print/usePrintJob')>();
    return {
        ...actual,
        usePrintJob: (options: Parameters<typeof actual.usePrintJob>[0]) => {
            const job = actual.usePrintJob(options);
            return printJobOverride.current ?? job;
        },
    };
});

vi.mock('../../print/appTransport', () => ({
    getAppJobRunner: () => ({
        isBusy: () => false,
        run: vi.fn(),
        cancel: vi.fn(),
    }),
}));

vi.mock('../print/PrintDialog', () => ({
    PrintDialog: (props: CapturedPrintProps) => {
        printProps.push(props);
        return <div data-testid="print-dialog" />;
    },
}));

/**
 * The test runtime's `DecompressionStream` writes into Node's `zlib`, which
 * rejects a raw `ArrayBuffer`; `parseDoc` (behind `labelRepo.get`) passes one.
 * happy-dom's `Response` also cannot drain a compression readable. Both are
 * adapted here, exactly as `src/data/labelRepo.test.ts` does; production code
 * is untouched.
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

const base = (id: string, type: Node['type']) => ({
    id,
    parentId: null,
    type,
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

const textNode = (id: string, source: ContentSource): Node => ({
    ...base(id, 'text'),
    type: 'text',
    text: source,
});

const qrNode = (id: string, source: ContentSource): Node => ({
    ...base(id, 'qr'),
    type: 'qr',
    data: source,
});

const field = (name: string, fallback = ''): ContentSource => ({
    kind: 'field',
    name,
    fallback,
});

/** The preview's encoded URL mirrors the resolved field value, so the test can
 * assert the image actually followed the typed value. */
const valueOf = (ctx: ResolveContext): string =>
    (ctx.overrides?.get('f1') as { text?: string } | undefined)?.text ?? 'empty';

interface SeedOptions {
    fields?: FieldDef[];
    /** Attach this table to the document and seed the store's CSV repo. */
    csv?: CsvRecord;
    sampleRowIndex?: number;
}

const seedPreset = async (
    nodes: Node[],
    id = 'preset-1',
    name = 'Shipping',
    options: SeedOptions = {},
): Promise<LabelRepo> => {
    const repo = createLabelRepo(createMemoryAdapter());
    const doc = createLabelDoc({ id, name, kind: 'preset', nodes, now: 1_000_000 });
    if (options.fields !== undefined) doc.data.fields = options.fields;
    if (options.sampleRowIndex !== undefined) doc.data.sampleRowIndex = options.sampleRowIndex;
    if (options.csv !== undefined) {
        doc.data.csv = {
            csvId: options.csv.id,
            name: options.csv.name,
            source: {
                kind: 'local',
                mediaType: 'text/csv',
                resourceId: options.csv.id,
            },
        };
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(options.csv);
        useStore.setState({ csvRepo });
    } else {
        useStore.setState({ csvRepo: null });
    }
    await repo.save(doc);
    useStore.setState({ labelRepo: repo, currentDoc: null, notifications: [] });
    return repo;
};

const openDialog = (onClose = vi.fn(), presetId: string | null = 'preset-1') =>
    render(<FillPresetDialog open presetId={presetId} onClose={onClose} />);

beforeEach(() => {
    vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
    vi.stubGlobal('Response', StreamReadingResponse);
    printProps.length = 0;
    printJobOverride.current = null;
    renderPreviewMock.mockReset();
    renderPreviewMock.mockImplementation(
        async (_doc: LabelDoc, _assets: unknown, ctx: ResolveContext) => ({
            canvas: {} as HTMLCanvasElement,
            rgba: { data: new Uint8ClampedArray(0), width: 0, height: 0 },
            blob: null,
            metaThumb: {
                mediaType: 'image/png',
                dataUrl: `data:image/png;base64,${valueOf(ctx)}`,
                at: 0,
            },
        }),
    );
});

afterEach(() => {
    cleanup();
    useStore.setState({
        labelRepo: null,
        currentDoc: null,
        csvRepo: null,
        gallery: [],
        galleryLoading: false,
        storageError: false,
        notifications: [],
    });
});

describe('FillPresetDialog', () => {
    it('renders one labelled input per distinct field, with the binding fallback as placeholder', async () => {
        await seedPreset([
            textNode('f1', field('price', '0.00')),
            qrNode('f2', field('sku', 'SKU-000')),
            textNode('f3', field('price', '9.99')),
        ]);
        openDialog();

        const price = await screen.findByLabelText('price');
        expect(price).toHaveAttribute('placeholder', '0.00');
        expect(screen.getByLabelText('sku')).toHaveAttribute('placeholder', 'SKU-000');
        expect(screen.getAllByRole('textbox')).toHaveLength(2);
    });

    it('updates the live preview from the typed value through the shared pass', async () => {
        await seedPreset([textNode('f1', field('price', '0.00'))]);
        openDialog();

        const input = await screen.findByLabelText('price');
        // Initial preview resolves the fallback.
        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,0.00',
            ),
        );

        fireEvent.change(input, { target: { value: '9.99' } });

        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,9.99',
            ),
        );
        const lastCall = renderPreviewMock.mock.calls.at(-1);
        expect(lastCall).toBeDefined();
        const ctx = lastCall![2] as ResolveContext;
        expect(ctx.overrides?.get('f1')).toEqual({ text: '9.99', placeholder: false });
    });

    it('clears back to the fallback when the input is emptied', async () => {
        await seedPreset([textNode('f1', field('price', '0.00'))]);
        openDialog();

        const input = await screen.findByLabelText('price');
        fireEvent.change(input, { target: { value: '9.99' } });
        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,9.99',
            ),
        );

        fireEvent.change(input, { target: { value: '' } });

        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,0.00',
            ),
        );
    });

    it('prints from the same prepareRow/fields source as the preview', async () => {
        await seedPreset([textNode('f1', field('price', '0.00'))]);
        openDialog();

        const input = await screen.findByLabelText('price');
        fireEvent.change(input, { target: { value: '9.99' } });
        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,9.99',
            ),
        );
        const previewCtx = renderPreviewMock.mock.calls.at(-1)![2] as ResolveContext;

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));

        expect(await screen.findByTestId('print-dialog')).toBeInTheDocument();
        const props = printProps.at(-1)!;
        expect(props.prepareRow).toBeDefined();
        // The dialog's job reads the same transient values, so the print pass
        // yields the identical override the preview rendered.
        const printCtx = await props.prepareRow!(0);
        expect(printCtx.overrides?.get('f1')).toEqual(previewCtx.overrides?.get('f1'));
    });

    it('hands PrintDialog the very same prepareRow the preview called', async () => {
        await seedPreset([textNode('f1', field('price', '0.00'))]);
        const prepareRow = vi.fn(async () => ({ overrides: new Map() }));
        // One stable job for the whole render: if the dialog resolved content
        // through a second path, the two surfaces could not share this exact
        // function reference.
        printJobOverride.current = {
            csv: null,
            csvStatus: 'none',
            csvRevision: 0,
            prepareRow,
            assets: {} as unknown as PrintJobDeps['assets'],
        };
        openDialog();

        await screen.findByLabelText('price');
        await waitFor(() => expect(prepareRow).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));

        expect(await screen.findByTestId('print-dialog')).toBeInTheDocument();
        expect(printProps.at(-1)!.prepareRow).toBe(prepareRow);
    });

    it('opens a label copy with the bindings intact and never makes the preset current', async () => {
        const repo = await seedPreset([textNode('f1', field('price', '0.00'))]);
        const onClose = vi.fn();
        openDialog(onClose);

        const input = await screen.findByLabelText('price');
        // A typed value is transient: the copy must still carry the binding,
        // with the fallback (the sample-row preview applies), and the typed
        // string must appear nowhere in the saved document.
        fireEvent.change(input, { target: { value: 'TYPED-42' } });
        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,TYPED-42',
            ),
        );
        expect(useStore.getState().currentDoc).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));

        await waitFor(() => expect(useStore.getState().currentDoc).not.toBeNull());
        const current = useStore.getState().currentDoc!;
        expect(current.meta.id).not.toBe('preset-1');
        expect(current.meta.kind).toBe('label');
        const copied = current.nodes[0] as TextNode;
        expect(copied.text).toEqual({ kind: 'field', name: 'price', fallback: '0.00' });
        expect(JSON.stringify(current)).not.toContain('TYPED-42');
        // The preset itself is untouched and a second record exists.
        const { ok } = await repo.listDetailed();
        expect(ok.map((summary) => summary.id).sort()).toEqual(['preset-1', current.meta.id].sort());
        expect(onClose).toHaveBeenCalled();
    });

    it('notifies and stays open when openLabel rejects', async () => {
        await seedPreset([textNode('f1', field('price', '0.00'))]);
        const onClose = vi.fn();
        const original = useStore.getState().openLabel;
        useStore.setState({
            openLabel: vi.fn().mockRejectedValue(new Error('flush failed')),
        });
        try {
            openDialog(onClose);
            await screen.findByLabelText('price');

            fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));

            await waitFor(() =>
                expect(useStore.getState().notifications).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            type: 'error',
                            message: 'Could not open a copy in the editor.',
                        }),
                    ]),
                ),
            );
            // The handler swallows the rejection: no close, and the button is
            // usable again instead of sticking at "opening".
            expect(onClose).not.toHaveBeenCalled();
            await waitFor(() =>
                expect(screen.getByRole('button', { name: 'Open in editor' })).toBeEnabled(),
            );
        } finally {
            useStore.setState({ openLabel: original });
        }
    });

    it('does not act after the dialog is closed externally while a copy is in flight', async () => {
        await seedPreset([textNode('f1', field('price', '0.00'))]);
        const onClose = vi.fn();
        const openLabel = vi.fn();
        const originalSaveCopy = useStore.getState().saveCopy;
        const originalOpenLabel = useStore.getState().openLabel;
        let releaseCopy: ((copy: LabelDoc) => void) | null = null;
        const saveCopy = vi.fn(
            () =>
                new Promise<LabelDoc | null>((resolve) => {
                    releaseCopy = (copy) => resolve(copy);
                }),
        );
        useStore.setState({ saveCopy, openLabel });
        try {
            const { rerender } = openDialog(onClose);
            await screen.findByLabelText('price');

            fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
            await waitFor(() => expect(saveCopy).toHaveBeenCalled());
            expect(releaseCopy).not.toBeNull();

            // Closed from outside: `onClose` never runs, only the `open` prop
            // changes. The in-flight copy must not notify or open the editor.
            rerender(<FillPresetDialog open={false} presetId="preset-1" onClose={onClose} />);

            await act(async () => {
                releaseCopy!(
                    createLabelDoc({
                        id: 'copy-1',
                        name: 'Shipping',
                        kind: 'label',
                        nodes: [textNode('f1', field('price', '0.00'))],
                        now: 1_000_000,
                    }),
                );
            });

            expect(openLabel).not.toHaveBeenCalled();
            expect(useStore.getState().notifications).toEqual([]);
            expect(onClose).not.toHaveBeenCalled();
        } finally {
            useStore.setState({ saveCopy: originalSaveCopy, openLabel: originalOpenLabel });
        }
    });

    it('does not act on the previous preset while a switched preset is still loading', async () => {
        const repo = await seedPreset(
            [textNode('a1', field('sku', 'A-000'))],
            'preset-a',
            'Alpha',
        );
        await repo.save(
            createLabelDoc({
                id: 'preset-b',
                name: 'Beta',
                kind: 'preset',
                nodes: [textNode('b1', field('lot', 'B-000'))],
                now: 1_000_000,
            }),
        );

        const realGet = repo.get.bind(repo);
        let calls = 0;
        let releaseSecond: (() => void) | null = null;
        const gated: LabelRepo = {
            ...repo,
            get: (id) => {
                calls += 1;
                if (calls === 1) return realGet(id);
                return new Promise((resolve, reject) => {
                    releaseSecond = () => {
                        void realGet(id).then(resolve, reject);
                    };
                });
            },
        };
        useStore.setState({ labelRepo: gated });

        const onClose = vi.fn();
        const { rerender } = render(
            <FillPresetDialog open presetId="preset-a" onClose={onClose} />,
        );
        expect(await screen.findByLabelText('sku')).toBeInTheDocument();

        rerender(<FillPresetDialog open presetId="preset-b" onClose={onClose} />);

        // The old document is still in state, but it belongs to `preset-a`.
        expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeDisabled();
        expect(screen.queryByLabelText('sku')).not.toBeInTheDocument();

        await waitFor(() => expect(releaseSecond).not.toBeNull());
        releaseSecond!();

        expect(await screen.findByLabelText('lot')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeEnabled();
    });

    it('shows the error state when the preset cannot be loaded', async () => {
        await seedPreset([]);
        openDialog(vi.fn(), 'missing');

        expect(await screen.findByTestId('preset-load-failed')).toHaveTextContent(
            'Could not load this preset.',
        );
    });

    it('offers Print for a preset with no fields', async () => {
        await seedPreset([textNode('s1', { kind: 'static', value: 'plain' })]);
        openDialog();

        expect(await screen.findByText('This preset has no fields. Print it as it is.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        expect(await screen.findByTestId('print-dialog')).toBeInTheDocument();
    });
});

describe('FillPresetDialog — declarations (P6b)', () => {
    it('builds rows from declarations with defaults and keeps leftover bound ids', async () => {
        await seedPreset(
            [
                textNode('f1', field('price', '0.00')),
                textNode('f2', field('sku', 'SKU-000')),
                textNode('f3', field('secret', 'secret-fallback')),
            ],
            'preset-1',
            'Shipping',
            {
                fields: [
                    { id: 'price', default: '9.99' },
                    { id: 'lot' },
                    { id: 'secret', default: 'hidden-default', hidden: true },
                ],
            },
        );
        openDialog();

        expect(await screen.findByLabelText('price')).toHaveValue('9.99');
        expect(screen.getByLabelText('price')).toHaveAttribute('placeholder', '0.00');
        expect(screen.getByLabelText('lot')).toHaveValue('');
        expect(screen.getByLabelText('sku')).toHaveValue('');
        // Hidden declarations are absent from the default list ...
        expect(screen.queryByLabelText('secret')).not.toBeInTheDocument();
        // ... but their default still applies to the content pass.
        await waitFor(() => {
            const ctx = renderPreviewMock.mock.calls.at(-1)?.[2] as ResolveContext | undefined;
            expect(ctx?.overrides?.get('f3')).toEqual({
                text: 'hidden-default',
                placeholder: false,
            });
        });
    });

    it('adds a hidden required declaration through Add field and unblocks printing', async () => {
        await seedPreset(
            [textNode('f1', field('secret', 'S-000'))],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'secret', hidden: true, required: true }] },
        );
        openDialog();

        expect(await screen.findByTestId('preset-required-missing')).toHaveTextContent(
            'Fill in the required fields: secret',
        );
        expect(
            screen.queryByText('This preset has no fields. Print it as it is.'),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'secret' } });
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'S-42' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

        expect(screen.getByLabelText('secret')).toHaveValue('S-42');
        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,S-42',
            ),
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled());
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeEnabled();
        expect(screen.queryByTestId('preset-required-missing')).not.toBeInTheDocument();
    });

    it('blocks Print and Open in editor while a visible required field is empty', async () => {
        await seedPreset(
            [textNode('f1', field('price', '0.00'))],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'price', required: true }] },
        );
        openDialog();

        const input = await screen.findByLabelText('price');
        expect(screen.getByTestId('preset-required-missing')).toHaveTextContent(
            'Fill in the required fields: price',
        );
        expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeDisabled();

        fireEvent.change(input, { target: { value: '9.99' } });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled());
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeEnabled();
        expect(screen.queryByTestId('preset-required-missing')).not.toBeInTheDocument();
    });
});

describe('FillPresetDialog — CSV row lookup (P6b)', () => {
    const itemTable = (): CsvRecord => ({
        id: 'csv-1',
        name: 'items.csv',
        columns: ['sku', 'name'],
        rows: [
            ['A', 'Alpha'],
            ['B', 'Beta'],
        ],
    });

    it('offers the row selector only with csv.row declared and a readable attached CSV', async () => {
        await seedPreset(
            [textNode('f1', { kind: 'csv', column: 'name', fallback: 'FB' })],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'csv.row' }], csv: itemTable() },
        );
        openDialog();

        expect(await screen.findByTestId('preset-row-selector')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText('Key column')).toHaveValue('sku'));
        expect(screen.getByLabelText('Key')).toHaveValue('');
    });

    it('does not render the row selector when csv.row is not declared', async () => {
        await seedPreset(
            [textNode('f1', { kind: 'csv', column: 'name', fallback: 'FB' })],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'sku' }], csv: itemTable() },
        );
        openDialog();

        await screen.findByLabelText('sku');
        expect(screen.queryByTestId('preset-row-selector')).not.toBeInTheDocument();
    });

    it('does not render the row selector when no CSV is attached', async () => {
        await seedPreset(
            [textNode('f1', field('sku', 'S-000'))],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'csv.row' }] },
        );
        openDialog();

        await screen.findByLabelText('sku');
        expect(screen.queryByTestId('preset-row-selector')).not.toBeInTheDocument();
    });

    it('prints exactly one CSV record for the sample, matched and missed key', async () => {
        await seedPreset(
            [textNode('f1', { kind: 'csv', column: 'name', fallback: 'MISS-FB' })],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'csv.row' }], csv: itemTable(), sampleRowIndex: 0 },
        );
        openDialog();

        // No key typed: the stored sample row is both previewed and printed.
        await screen.findByTestId('preset-row-selector');
        await waitFor(() => expect(screen.getByLabelText('Key column')).toHaveValue('sku'));
        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,Alpha',
            ),
        );
        expect(screen.getByTestId('preset-row-status')).toHaveTextContent(
            'No key typed — showing the sample row.',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        expect(await screen.findByTestId('print-dialog')).toBeInTheDocument();
        await waitFor(() => expect(printProps.at(-1)?.csv?.rows).toEqual([['A', 'Alpha']]));
        expect(printProps.at(-1)?.csv?.rows).toHaveLength(1);

        // A key match resolves that record into the preview and the print.
        const keyInput = screen.getByLabelText('Key');
        fireEvent.change(keyInput, { target: { value: 'B' } });

        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,Beta',
            ),
        );
        expect(screen.getByTestId('preset-row-status')).toHaveTextContent('Showing row 2.');
        const matchedCtx = renderPreviewMock.mock.calls.at(-1)?.[2] as ResolveContext;
        expect(matchedCtx.overrides?.get('f1')).toEqual({ text: 'Beta', placeholder: false });
        await waitFor(() => expect(printProps.at(-1)?.csv?.rows).toEqual([['B', 'Beta']]));
        expect(printProps.at(-1)?.csv?.rows).toHaveLength(1);

        // A miss is explicit: fallback preview and one all-empty printed row.
        fireEvent.change(keyInput, { target: { value: 'ZZZ' } });

        await waitFor(() =>
            expect(screen.getByTestId('preset-live-preview')).toHaveAttribute(
                'src',
                'data:image/png;base64,MISS-FB',
            ),
        );
        expect(screen.getByTestId('preset-row-status')).toHaveTextContent(
            'No row matches this key — showing an empty row.',
        );
        await waitFor(() => expect(printProps.at(-1)?.csv?.rows).toEqual([['', '']]));
        expect(printProps.at(-1)?.csv?.rows).toHaveLength(1);
    });

    it('reports `loading` and never a full table while its own CSV read is pending', async () => {
        await seedPreset(
            [textNode('f1', { kind: 'csv', column: 'name', fallback: 'FB' })],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'csv.row' }], csv: itemTable() },
        );
        // Defer only the dialog's own read: any *fallback* read the hook might
        // start would resolve immediately with the full two-row table — the
        // exact race the pre-resolved source rules out.
        const base = useStore.getState().csvRepo!;
        let calls = 0;
        let releaseRead: (() => void) | null = null;
        useStore.setState({
            csvRepo: {
                ...base,
                get: (id) => {
                    calls += 1;
                    if (calls === 1) {
                        return new Promise<CsvRecord | null>((resolve, reject) => {
                            releaseRead = () => {
                                void base.get(id).then(resolve, reject);
                            };
                        });
                    }
                    return base.get(id);
                },
            },
        });
        openDialog();

        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        expect(await screen.findByTestId('print-dialog')).toBeInTheDocument();

        await waitFor(() => expect(printProps.at(-1)?.csvStatus).toBe('loading'));
        expect(printProps.at(-1)?.csv).toBeNull();
        // Only the dialog's own read exists: the hook never read the repo, so
        // the full table could not win the race.
        expect(calls).toBe(1);
        expect(releaseRead).not.toBeNull();

        await act(async () => {
            releaseRead!();
            await Promise.resolve();
        });

        await waitFor(() => expect(printProps.at(-1)?.csvStatus).toBe('ready'));
        expect(printProps.at(-1)?.csv?.rows).toEqual([['A', 'Alpha']]);
        // Whatever the frames showed, PrintDialog was never handed a multi-row
        // table: preview and print share the same single record.
        for (const props of printProps) {
            if (props.csv !== null && props.csv !== undefined) {
                expect(props.csv.rows).toHaveLength(1);
            }
        }
    });

    it('reports `error` and no table when its own CSV read fails', async () => {
        await seedPreset(
            [textNode('f1', { kind: 'csv', column: 'name', fallback: 'FB' })],
            'preset-1',
            'Shipping',
            { fields: [{ id: 'csv.row' }], csv: itemTable() },
        );
        const base = useStore.getState().csvRepo!;
        useStore.setState({
            csvRepo: {
                ...base,
                get: async (): Promise<CsvRecord | null> => {
                    throw new Error('idb down');
                },
            },
        });
        openDialog();

        // The existing hint stays: an attached table that could not be read is
        // explicit, never "no row selector".
        await screen.findByTestId('preset-row-unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        expect(await screen.findByTestId('print-dialog')).toBeInTheDocument();

        await waitFor(() => expect(printProps.at(-1)?.csvStatus).toBe('error'));
        expect(printProps.at(-1)?.csv).toBeNull();
        // PrintDialog blocks Print on `error`; the dialog must never hand it a
        // table to print instead.
        for (const props of printProps) expect(props.csv).toBeNull();
    });
});
