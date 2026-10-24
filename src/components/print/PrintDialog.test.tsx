// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabelType, type EncodedImage } from '@mmote/niimbluelib';
import '../../i18n';
import { rasterDimensions } from '../../core/render';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import type { RenderedLabelPage, AssetDeps } from '../../editor/render';
import type { JobProgress, JobRunResult, JobRunner } from '../../print/jobRunner';
import type { PrintJob, PrinterCapabilities, PrinterStatus } from '../../print/transport';
import { useStore } from '../../store/useStore';
import { PrintDialog } from './PrintDialog';
import { THUMBNAIL_DPI } from './usePrintThumbnails';

const { buildCsvPrintJobMock, renderLabelPageMock, usePrintThumbnailsMock } = vi.hoisted(() => ({
    buildCsvPrintJobMock: vi.fn(),
    renderLabelPageMock: vi.fn(),
    usePrintThumbnailsMock: vi.fn(),
}));

vi.mock('../../print/printLabel', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../print/printLabel')>();
    return { ...actual, buildCsvPrintJob: buildCsvPrintJobMock };
});

// Spy wrapper around the real hook: records the options the dialog passes
// (D-28 scope assertions) while keeping the actual behaviour.
vi.mock('./usePrintThumbnails', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./usePrintThumbnails')>();
    return {
        ...actual,
        usePrintThumbnails: (options: Parameters<typeof actual.usePrintThumbnails>[0]) => {
            usePrintThumbnailsMock(options);
            return actual.usePrintThumbnails(options);
        },
    };
});

// No real canvas in happy-dom: the shared render path is stubbed to a data URL.
// The page is sized to the document's raster so the D-31 ink predicate can run
// against it; `ink` selects all-black (ink everywhere) or all-white (blank).
vi.mock('../../editor/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/render')>();
    return { ...actual, renderLabelPage: renderLabelPageMock };
});

const fakeRenderedPage = (doc: LabelDoc, ink: boolean): RenderedLabelPage => {
    const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
    const data = new Uint8ClampedArray(dims.widthPx * dims.heightPx * 4).fill(ink ? 0 : 255);
    return {
        rgba: { data, width: dims.widthPx, height: dims.heightPx },
        widthPx: dims.widthPx,
        heightPx: dims.heightPx,
        canvas: {
            toDataURL: () => 'data:image/png;base64,stub',
        } as unknown as HTMLCanvasElement,
    };
};

type BuildOpts = { order: string; copies: number; overrides?: unknown };

const makeFakeJob = (opts: BuildOpts): PrintJob => ({
    totalPages: 2,
    pages: (async function* () {
        if (opts.order === 'interleaved') {
            yield { data: {} as EncodedImage, quantity: 1 };
            yield { data: {} as EncodedImage, quantity: 1 };
        } else {
            yield { data: {} as EncodedImage, quantity: 2 };
        }
    })(),
});

beforeEach(() => {
    buildCsvPrintJobMock.mockReset();
    buildCsvPrintJobMock.mockImplementation(
        (_doc: unknown, _csv: unknown, opts: BuildOpts) => makeFakeJob(opts),
    );
    renderLabelPageMock.mockReset();
    // Default: an inked raster (so an over-width doc warns). Blank tests override.
    renderLabelPageMock.mockImplementation(async (doc: LabelDoc) => fakeRenderedPage(doc, true));
});

afterEach(() => {
    cleanup();
    useStore.setState({ editorWarnings: {}, usePrinterDpi: true });
});

class FakeRunner implements JobRunner {
    busy = false;
    cancelCalls = 0;
    lastJob: PrintJob | undefined;
    quantities: number[] = [];
    autoResolve = true;
    private resolver: ((result: JobRunResult) => void) | undefined;
    private progressSink: ((progress: JobProgress) => void) | undefined;

    isBusy(): boolean {
        return this.busy;
    }

    cancel(): void {
        this.cancelCalls += 1;
        const resolve = this.resolver;
        this.resolver = undefined;
        if (resolve) {
            this.busy = false;
            resolve({ cancelled: true, pagesPrinted: this.quantities.length });
        }
    }

    run(
        job: PrintJob,
        opts?: { onProgress?: (progress: JobProgress) => void },
    ): Promise<JobRunResult> {
        this.lastJob = job;
        this.busy = true;
        this.progressSink = opts?.onProgress;
        opts?.onProgress?.({ page: 1, pagesTotal: job.totalPages, percent: 0, phase: 'sending' });

        if (this.autoResolve) {
            return (async () => {
                for await (const page of job.pages) this.quantities.push(page.quantity);
                this.busy = false;
                opts?.onProgress?.({
                    page: job.totalPages,
                    pagesTotal: job.totalPages,
                    percent: 100,
                    phase: 'printing',
                });
                return { cancelled: false, pagesPrinted: job.totalPages };
            })();
        }

        return new Promise<JobRunResult>((resolve) => {
            this.resolver = (result) => {
                this.busy = false;
                resolve(result);
            };
        });
    }

    /** Push a progress snapshot through the callback the dialog registered. */
    push(progress: JobProgress): void {
        this.progressSink?.(progress);
    }
}

const narrowDoc = () => createLabelDoc({ backingW: 2500, backingH: 7800, dpi: 300 });
const wideDoc = () => createLabelDoc({ backingW: 6000, backingH: 3000, dpi: 300 });

const statusOf = (capabilities?: PrinterCapabilities): PrinterStatus => ({
    state: 'connected',
    ...(capabilities ? { capabilities } : {}),
});

const B1_PRO: PrinterCapabilities = {
    model: 'B1_PRO',
    taskType: 'D110M_V4',
    printheadPixels: 567,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [LabelType.WithGaps, LabelType.Black, LabelType.Transparent],
    doubleColor: true,
    supportsSpeed: true,
};

const csvOf = (rowCount: number): CsvRecord => ({
    id: 'csv-1',
    name: 'test.csv',
    columns: ['a'],
    rows: Array.from({ length: rowCount }, (_, index) => [`v${index}`]),
});

const renderDialog = (overrides: {
    doc?: ReturnType<typeof narrowDoc>;
    csv?: CsvRecord | null;
    runner: FakeRunner;
    printerStatus: PrinterStatus;
    assets?: AssetDeps;
}) => {
    const onClose = vi.fn();
    render(
        <PrintDialog
            open
            onClose={onClose}
            doc={overrides.doc ?? narrowDoc()}
            csv={overrides.csv ?? null}
            runner={overrides.runner}
            printerStatus={overrides.printerStatus}
            assets={overrides.assets}
        />,
    );
    return { onClose };
};

describe('PrintDialog — capability gating', () => {
    it('hides the speed control when the task does not support it', () => {
        renderDialog({
            runner: new FakeRunner(),
            printerStatus: statusOf({ ...B1_PRO, supportsSpeed: false }),
        });

        expect(screen.queryByLabelText('Speed')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Density')).toBeEnabled();
    });

    it('takes the density bounds from the reported capabilities', () => {
        renderDialog({
            runner: new FakeRunner(),
            printerStatus: statusOf({ ...B1_PRO, densityMin: 2, densityMax: 4, densityDefault: 3 }),
        });

        const density = screen.getByLabelText('Density') as HTMLInputElement;
        expect(density.min).toBe('2');
        expect(density.max).toBe('4');
        expect(density.value).toBe('3');
    });

    it('disables capability-gated controls without crashing when none are reported', () => {
        renderDialog({ runner: new FakeRunner(), printerStatus: statusOf(undefined) });

        expect(screen.getByLabelText('Density')).toBeDisabled();
        expect(screen.getByLabelText('Label type')).toBeDisabled();
        expect(screen.queryByLabelText('Speed')).not.toBeInTheDocument();
    });
});

describe('PrintDialog — warnings', () => {
    it('shows a prominent printhead-overflow warning when ink lands beyond the head', async () => {
        renderDialog({
            doc: wideDoc(),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });

        expect(await screen.findByTestId('print-warning-overflow')).toBeInTheDocument();
    });

    it('does not warn for a blank over-width label (D-31 false positive fixed)', async () => {
        // A blank 50 mm raster on the 567-dot head has no ink beyond the head:
        // the size check trips but the warning must stay hidden. Defer the render
        // so the test proves the warning stays hidden *after* the async effect
        // settles, not merely while it is still in flight.
        let resolveRender: (page: RenderedLabelPage) => void = () => undefined;
        renderLabelPageMock.mockImplementation(
            () =>
                new Promise<RenderedLabelPage>((resolve) => {
                    resolveRender = resolve;
                }),
        );
        renderDialog({
            doc: wideDoc(),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });

        await waitFor(() => expect(renderLabelPageMock).toHaveBeenCalled());
        // Pending: the size check tripped but no ink verdict has landed yet.
        expect(screen.queryByTestId('print-warning-overflow')).not.toBeInTheDocument();

        // Resolve the blank page and flush the effect's settlement.
        await act(async () => {
            resolveRender(fakeRenderedPage(wideDoc(), false));
            await Promise.resolve();
        });
        // Settled blank verdict: still no warning.
        expect(screen.queryByTestId('print-warning-overflow')).not.toBeInTheDocument();
    });

    it('does not run the doc-dpi ink check when the label fits within the printhead', () => {
        renderDialog({
            doc: narrowDoc(),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });

        expect(screen.queryByTestId('print-warning-overflow')).not.toBeInTheDocument();
        // The ink check is lazy: no size overflow means no extra render beyond
        // the page preview. (Both the preview and the ink check now pass the
        // resolved `dpi`; the thumbnail cache would pass `dpi: THUMBNAIL_DPI`.)
        expect(renderLabelPageMock).toHaveBeenCalledTimes(1);
        const inkCheckCalls = renderLabelPageMock.mock.calls.filter(
            ([, , opts]) => (opts as { dpi?: number } | undefined)?.dpi === undefined,
        );
        expect(inkCheckCalls).toHaveLength(0);
    });

    it('warns on a reported roll/dpi mismatch', () => {
        renderDialog({
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), rollWidthHm: 1234, dpi: 203 },
        });

        expect(screen.getByTestId('print-warning-mismatch')).toBeInTheDocument();
    });

    it('warns on interleaved order strictly above 50 pages', () => {
        renderDialog({
            csv: csvOf(50),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });

        fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'interleaved' } });
        expect(screen.queryByTestId('print-warning-interleaved')).not.toBeInTheDocument();
    });

    it('warns when interleaved order exceeds 50 pages', () => {
        renderDialog({
            csv: csvOf(51),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });

        fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'interleaved' } });
        expect(screen.getByTestId('print-warning-interleaved')).toBeInTheDocument();
    });

    it('publishes document-level warnings to the shared center and clears on unmount', async () => {
        const doc = wideDoc();
        const view = render(
            <PrintDialog
                open
                onClose={vi.fn()}
                doc={doc}
                csv={null}
                runner={new FakeRunner()}
                printerStatus={statusOf(B1_PRO)}
            />,
        );

        // The overflow verdict lands after the async ink check.
        expect(await screen.findByTestId('print-warning-overflow')).toBeInTheDocument();
        await waitFor(() => {
            const group = useStore.getState().editorWarnings.print;
            expect(group?.docId).toBe(doc.meta.id);
            expect(group?.warnings.map((warning) => warning.kind)).toContain('print-overflow');
        });

        view.unmount();
        expect(useStore.getState().editorWarnings.print).toBeUndefined();
    });

    it('warns when the palette overflowed and publishes it to the warning center', async () => {
        const doc = narrowDoc();
        renderLabelPageMock.mockImplementation(async (d: LabelDoc) => ({
            ...fakeRenderedPage(d, true),
            policyOverflowCount: 2,
        }));
        renderDialog({ doc, runner: new FakeRunner(), printerStatus: statusOf(B1_PRO) });

        expect(await screen.findByTestId('print-warning-policy-overflow')).toBeInTheDocument();
        await waitFor(() => {
            const group = useStore.getState().editorWarnings.print;
            expect(group?.warnings.map((warning) => warning.kind)).toContain('print-policy-overflow');
        });
    });
});

describe('PrintDialog — screentone print-time honesty', () => {
    /** A doc whose only node explicitly resolves to the screentone policy. */
    const screentoneDoc = (): LabelDoc => {
        const doc = narrowDoc();
        doc.nodes = [
            {
                id: 'n1',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 1000, h: 1000 },
                quantizerHint: 'screentone',
            },
        ];
        return doc;
    };

    it('warns when a screentone prints at a dpi other than the reported head dpi', async () => {
        useStore.setState({ usePrinterDpi: false });
        renderDialog({
            doc: screentoneDoc(),
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        const warning = screen.getByTestId('print-warning-screentone-unlocked');
        expect(warning).toHaveTextContent('(203)');
        expect(warning).toHaveTextContent('Printing at 300 dpi will not be dot-grid-locked.');
        await waitFor(() => {
            const published = useStore
                .getState()
                .editorWarnings.print?.warnings.find(
                    (entry) => entry.kind === 'print-screentone-unlocked',
                );
            expect(published).toMatchObject({ dpi: 300, headDpi: 203 });
        });
    });

    it('does not warn when the job prints at the reported head dpi', () => {
        renderDialog({
            doc: screentoneDoc(),
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        // The setting is on, so the resolved dpi IS 203: dot-grid-locked.
        expect(screen.queryByTestId('print-warning-screentone-unlocked')).not.toBeInTheDocument();
    });

    it('does not warn when no head dpi is reported or no node uses screentone', () => {
        useStore.setState({ usePrinterDpi: false });
        renderDialog({
            doc: screentoneDoc(),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });
        expect(screen.queryByTestId('print-warning-screentone-unlocked')).not.toBeInTheDocument();
        cleanup();

        renderDialog({
            doc: narrowDoc(),
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });
        expect(screen.queryByTestId('print-warning-screentone-unlocked')).not.toBeInTheDocument();
    });
});

describe('PrintDialog — progress, cancel and order', () => {
    it('cancels a running job and shows the cancelled outcome', async () => {
        const runner = new FakeRunner();
        runner.autoResolve = false;
        renderDialog({ runner, printerStatus: statusOf(B1_PRO) });

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(runner.isBusy()).toBe(true));

        expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(runner.cancelCalls).toBe(1);
        await waitFor(() =>
            expect(screen.getByTestId('print-outcome')).toHaveTextContent(
                'Cancelled after 0 pages.',
            ),
        );
        expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
    });

    it('passes the chosen order to the built print job', async () => {
        const runner = new FakeRunner();
        renderDialog({ csv: csvOf(3), runner, printerStatus: statusOf(B1_PRO) });

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(1));
        expect(buildCsvPrintJobMock.mock.calls[0]![2]).toMatchObject({ order: 'grouped' });
        await waitFor(() => expect(runner.quantities).toEqual([2]));

        fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'interleaved' } });
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(2));
        expect(buildCsvPrintJobMock.mock.calls[1]![2]).toMatchObject({ order: 'interleaved' });
        await waitFor(() => expect(runner.quantities).toEqual([2, 1, 1]));
    });

    it('shows a monotonic progress bar and a success outcome', async () => {
        const runner = new FakeRunner();
        renderDialog({ runner, printerStatus: statusOf(B1_PRO) });

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));

        await waitFor(() =>
            expect(screen.getByTestId('print-outcome')).toHaveTextContent('Printed 2 pages.'),
        );
        expect(screen.getByTestId('print-progress-bar')).toHaveStyle({ width: '100%' });
    });

    it('renders independent send and print bars with honest labels', async () => {
        const runner = new FakeRunner();
        runner.autoResolve = false;
        renderDialog({ runner, printerStatus: statusOf(B1_PRO) });

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(runner.isBusy()).toBe(true));

        // Nothing reported yet: no send bar at all (never a dead 0 % one), and
        // the print bar does not claim to be printing before it is.
        expect(screen.queryByTestId('print-send-progress-bar')).not.toBeInTheDocument();
        expect(screen.getByText('Waiting to print… · 0%')).toBeInTheDocument();

        act(() => {
            runner.push({
                page: 1,
                pagesTotal: 2,
                percent: 0,
                send: { page: 1, percent: 40 },
                phase: 'sending',
            });
        });

        expect(screen.getByTestId('print-send-progress-bar')).toHaveStyle({ width: '40%' });
        expect(screen.getByTestId('print-progress-bar')).toHaveStyle({ width: '0%' });
        expect(screen.getByText('Sending page 1 / 2 · 40%')).toBeInTheDocument();
        expect(screen.getByText('Waiting to print… · 0%')).toBeInTheDocument();

        act(() => {
            runner.push({
                page: 2,
                pagesTotal: 2,
                percent: 100,
                send: { page: 2, percent: 100 },
                phase: 'printing',
            });
        });

        expect(screen.getByTestId('print-send-progress-bar')).toHaveStyle({ width: '100%' });
        expect(screen.getByTestId('print-progress-bar')).toHaveStyle({ width: '100%' });
        expect(screen.getByText('Sending page 2 / 2 · 100%')).toBeInTheDocument();
        expect(screen.getByText('Printing page 2 / 2 · 100%')).toBeInTheDocument();
    });
});

describe('PrintDialog — View as: Page preview (D5)', () => {
    const callDpis = (): number[] =>
        renderLabelPageMock.mock.calls
            .map(([, , opts]) => (opts as { dpi?: number } | undefined)?.dpi)
            .filter((dpi): dpi is number => typeof dpi === 'number');

    const openPreview = (
        options: { doc?: ReturnType<typeof narrowDoc>; csv?: CsvRecord | null } = {},
    ) =>
        renderDialog({
            ...(options.doc ? { doc: options.doc } : {}),
            ...(options.csv !== undefined ? { csv: options.csv } : {}),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        });

    it('opens on the single page view and renders it at the document dpi', async () => {
        const doc = narrowDoc();
        openPreview({ doc, csv: csvOf(3) });

        expect(screen.getByLabelText('View as')).toHaveValue('page');
        expect(screen.getByTestId('print-page-preview')).toBeInTheDocument();
        expect(screen.queryByTestId('print-page-list')).not.toBeInTheDocument();

        // The whole point of the `Page` path: the shared render, at doc dpi.
        await waitFor(() => expect(callDpis()).toContain(doc.label.dpi));
        // …and never through the thumbnail cache's resolution.
        expect(callDpis()).not.toContain(THUMBNAIL_DPI);

        // The raster lands as a large image once the async render settles.
        expect(await screen.findByTestId('print-page-image')).toHaveAttribute(
            'alt',
            'Preview of row 1',
        );
    });

    it('clamps the stepper to the record bounds', () => {
        openPreview({ csv: csvOf(3) });

        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[1/3]');
        expect(screen.getByLabelText('Previous page')).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Next page'));
        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[2/3]');

        fireEvent.click(screen.getByLabelText('Next page'));
        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[3/3]');
        expect(screen.getByLabelText('Next page')).toBeDisabled();

        // Extra presses past the end must not move it.
        fireEvent.click(screen.getByLabelText('Next page'));
        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[3/3]');

        fireEvent.click(screen.getByLabelText('Previous page'));
        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[2/3]');
    });

    it('clamps the zoom ladder at both ends', () => {
        openPreview();

        const zoomOut = screen.getByLabelText('Zoom out');
        const zoomIn = screen.getByLabelText('Zoom in');
        expect(screen.getByTestId('print-zoom-factor')).toHaveTextContent('×1');

        for (let press = 0; press < 8; press += 1) fireEvent.click(zoomOut);
        expect(screen.getByTestId('print-zoom-factor')).toHaveTextContent('×0.5');
        expect(zoomOut).toBeDisabled();

        for (let press = 0; press < 8; press += 1) fireEvent.click(zoomIn);
        expect(screen.getByTestId('print-zoom-factor')).toHaveTextContent('×4');
        expect(zoomIn).toBeDisabled();
    });

    it('degrades to a notice (no crash) when the doc-dpi render throws a RangeError', async () => {
        renderLabelPageMock.mockRejectedValue(
            new RangeError(
                'renderLabelPage: raster 4000×5000 = 20000000 px exceeds the 16000000-pixel cap',
            ),
        );
        openPreview();

        expect(await screen.findByTestId('print-preview-notice')).toBeInTheDocument();
        // Still usable: the dialog and the view switch survive the failure.
        expect(screen.getByLabelText('View as')).toBeEnabled();
        expect(screen.queryByTestId('print-page-image')).not.toBeInTheDocument();
    });

    it('drops a previous page’s preview warning when stepping to a clean page', async () => {
        // Page 1 overflows the palette; every later page renders clean, so a
        // warning that outlives the step would be stale.
        let call = 0;
        renderLabelPageMock.mockImplementation(async (d: LabelDoc) => ({
            ...fakeRenderedPage(d, false),
            ...(call++ === 0 ? { policyOverflowCount: 2 } : {}),
        }));
        openPreview({ csv: csvOf(2) });

        expect(await screen.findByTestId('print-warning-policy-overflow')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Next page'));

        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[2/2]');
        await waitFor(() =>
            expect(
                screen.queryByTestId('print-warning-policy-overflow'),
            ).not.toBeInTheDocument(),
        );
    });

    it('resets the view mode and the selected page each time the dialog opens', () => {
        const props = {
            doc: narrowDoc(),
            csv: csvOf(3),
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
        };
        const onClose = vi.fn();
        const view = render(<PrintDialog open onClose={onClose} {...props} />);

        fireEvent.click(screen.getByLabelText('Next page'));
        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[2/3]');

        fireEvent.change(screen.getByLabelText('View as'), { target: { value: 'queue' } });
        expect(screen.getByTestId('print-page-list')).toBeInTheDocument();

        view.rerender(<PrintDialog open={false} onClose={onClose} {...props} />);
        view.rerender(<PrintDialog open onClose={onClose} {...props} />);

        expect(screen.getByLabelText('View as')).toHaveValue('page');
        expect(screen.getByTestId('print-page-stepper')).toHaveTextContent('[1/3]');
    });

    it('renders queue thumbnails above the old 50 dpi, not at the page dpi', async () => {
        const doc = narrowDoc();
        openPreview({ doc, csv: csvOf(2) });

        fireEvent.change(screen.getByLabelText('View as'), { target: { value: 'queue' } });
        // Only the queue's own renders count: the page preview rendered first.
        renderLabelPageMock.mockClear();

        await waitFor(() => expect(callDpis()).toContain(THUMBNAIL_DPI));
        // Raised from 50 so the queue previews stay sharp on 2× displays.
        expect(THUMBNAIL_DPI).toBeGreaterThan(50);
        expect(callDpis()).not.toContain(doc.label.dpi);
    });
    it('lands the page image under a StrictMode double-mount', async () => {
        // The app renders inside `<React.StrictMode>`: the render effect runs
        // setup → cleanup → setup. A cleanup that only latched "cancelled" on a
        // shared flag would drop every result and leave a permanent placeholder.
        render(
            <StrictMode>
                <PrintDialog
                    open
                    onClose={vi.fn()}
                    doc={narrowDoc()}
                    csv={csvOf(2)}
                    runner={new FakeRunner()}
                    printerStatus={statusOf(B1_PRO)}
                />
            </StrictMode>,
        );

        expect(await screen.findByTestId('print-page-image')).toHaveAttribute(
            'alt',
            'Preview of row 1',
        );

        fireEvent.click(screen.getByLabelText('Next page'));
        expect(await screen.findByTestId('print-page-image')).toHaveAttribute(
            'alt',
            'Preview of row 2',
        );
    });
});

describe('PrintDialog — print direction (D-30)', () => {
    it('reports direction changes and the new value reaches the built job', async () => {
        const runner = new FakeRunner();
        const onChange = vi.fn();

        const Harness = () => {
            const [doc, setDoc] = useState(() => wideDoc());
            return (
                <PrintDialog
                    open
                    onClose={() => {}}
                    doc={doc}
                    csv={null}
                    runner={runner}
                    printerStatus={statusOf(B1_PRO)}
                    onPrintDirectionChange={(direction) => {
                        onChange(direction);
                        setDoc((previous) => ({
                            ...previous,
                            label: { ...previous.label, printDirection: direction },
                        }));
                    }}
                />
            );
        };

        render(<Harness />);
        expect(screen.getByLabelText('Print direction')).toHaveValue('top');

        fireEvent.change(screen.getByLabelText('Print direction'), {
            target: { value: 'bottom' },
        });

        expect(onChange).toHaveBeenCalledWith('bottom');
        await waitFor(() => expect(screen.getByLabelText('Print direction')).toHaveValue('bottom'));

        // The changed direction on the doc prop is what `buildCsvPrintJob`
        // receives; `orientForPrint` reads it when the job runs.
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(1));
        expect(buildCsvPrintJobMock.mock.calls[0]![0]).toMatchObject({
            label: { printDirection: 'bottom' },
        });
    });
});

describe('PrintDialog — resolved print dpi (P2)', () => {
    const callDpis = (): Array<number | undefined> =>
        renderLabelPageMock.mock.calls.map(
            ([, , opts]) => (opts as { dpi?: number } | undefined)?.dpi,
        );

    it('previews at the printer-reported dpi when the setting is on', async () => {
        const doc = narrowDoc(); // hint 300
        renderDialog({
            doc,
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        await waitFor(() => expect(callDpis()).toContain(203));
        expect(callDpis()).not.toContain(300);

        const box = screen.getByLabelText('DPI') as HTMLInputElement;
        expect(box).toBeDisabled();
        expect(box.value).toBe('203');
        expect(screen.getByText('Detected from the printer')).toBeInTheDocument();
    });

    it('falls back to the hint (with a note) when no dpi is reported', async () => {
        const doc = narrowDoc();
        renderDialog({ doc, runner: new FakeRunner(), printerStatus: statusOf(B1_PRO) });

        await waitFor(() => expect(callDpis()).toContain(300));
        const box = screen.getByLabelText('DPI') as HTMLInputElement;
        expect(box).toBeDisabled();
        expect(box.value).toBe('300');
        expect(
            screen.getByText("No DPI reported by the printer; using the label's DPI hint."),
        ).toBeInTheDocument();
    });

    it('uses the hint when the setting is off, even with a reported dpi', async () => {
        useStore.setState({ usePrinterDpi: false });
        const doc = narrowDoc();
        renderDialog({
            doc,
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        await waitFor(() => expect(callDpis()).toContain(300));
        expect(callDpis()).not.toContain(203);
        // Off mode: an editable box seeded from the doc hint.
        const box = screen.getByLabelText('DPI') as HTMLInputElement;
        expect(box).not.toBeDisabled();
        expect(box.value).toBe('300');
    });

    it('the preview and the built print job agree on the resolved dpi', async () => {
        const runner = new FakeRunner();
        renderDialog({
            doc: narrowDoc(),
            csv: csvOf(2),
            runner,
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        await waitFor(() => expect(callDpis()).toContain(203));
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(1));
        const opts = buildCsvPrintJobMock.mock.calls[0]![2] as {
            overrides?: { dpi?: number };
        };
        expect(opts.overrides?.dpi).toBe(203);
        expect(callDpis()).toContain(203);
    });

    it('the toggle re-resolves the preview and the job to the hint', async () => {
        const runner = new FakeRunner();
        renderDialog({
            doc: narrowDoc(),
            runner,
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });
        await waitFor(() => expect(callDpis()).toContain(203));

        fireEvent.click(screen.getByLabelText('Use printer DPI'));
        await waitFor(() => expect(callDpis()).toContain(300));

        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(1));
        const opts = buildCsvPrintJobMock.mock.calls[0]![2] as {
            overrides?: { dpi?: number };
        };
        expect(opts.overrides?.dpi).toBe(300);
    });

    it('sizes the printhead-overflow check from the resolved dpi', async () => {
        // 60 mm wide at 203 dpi ≈ 479 px, under the 567-dot head — no overflow,
        // although the doc hint (300) would have tripped the size check.
        renderDialog({
            doc: wideDoc(),
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        await waitFor(() => expect(callDpis()).toContain(203));
        expect(screen.queryByTestId('print-warning-overflow')).not.toBeInTheDocument();
    });

    it('blocks Print and explains when the resolved raster exceeds the cap (R12)', async () => {
        // 5 m × 2.5 m at 300 dpi ≈ 59055 × 29528 px ≫ the 16 M px cap.
        const huge = createLabelDoc({ backingW: 500_000, backingH: 250_000, dpi: 300 });
        // The render seam is stubbed to a small page so the test never allocates
        // the absurd raster the dialog is refusing to print.
        renderLabelPageMock.mockResolvedValue(fakeRenderedPage(narrowDoc(), false));
        renderDialog({ doc: huge, runner: new FakeRunner(), printerStatus: statusOf(B1_PRO) });

        expect(await screen.findByTestId('print-raster-cap')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
    });

    it('the mismatch warning carries the resolved dpi and says where it came from', async () => {
        renderDialog({
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        const warning = screen.getByTestId('print-warning-mismatch');
        expect(warning).toHaveTextContent('Printing will use 203 dpi (from the printer).');
        await waitFor(() => {
            const published = useStore
                .getState()
                .editorWarnings.print?.warnings.find((entry) => entry.kind === 'print-mismatch');
            expect(published).toMatchObject({ resolvedDpi: 203, printerDpiInUse: true });
        });
    });

    it('the mismatch warning states the hint will be used when the setting is off', async () => {
        useStore.setState({ usePrinterDpi: false });
        renderDialog({
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        expect(screen.getByTestId('print-warning-mismatch')).toHaveTextContent(
            "Printing will use 300 dpi (from the label's DPI hint).",
        );
    });

    it('commits the off-mode box back to doc.label.dpi, clamped', async () => {
        useStore.setState({ usePrinterDpi: false });
        const onChange = vi.fn();

        const Harness = () => {
            const [doc, setDoc] = useState(() => narrowDoc());
            return (
                <PrintDialog
                    open
                    onClose={() => {}}
                    doc={doc}
                    csv={null}
                    runner={new FakeRunner()}
                    printerStatus={statusOf(B1_PRO)}
                    onDpiChange={(dpi) => {
                        onChange(dpi);
                        setDoc((previous) => ({
                            ...previous,
                            label: { ...previous.label, dpi },
                        }));
                    }}
                />
            );
        };

        render(<Harness />);
        const box = screen.getByLabelText('DPI');
        expect(box).not.toBeDisabled();

        fireEvent.change(box, { target: { value: '203' } });
        fireEvent.blur(box);
        expect(onChange).toHaveBeenCalledWith(203);
        await waitFor(() => expect(screen.getByLabelText('DPI')).toHaveValue(203));

        // Out-of-range input clamps like `normalizeDpi` (100–1200).
        fireEvent.change(screen.getByLabelText('DPI'), { target: { value: '20' } });
        fireEvent.blur(screen.getByLabelText('DPI'));
        expect(onChange).toHaveBeenLastCalledWith(100);
    });

    it('reverts the off-mode box when no write-back seam is provided', async () => {
        useStore.setState({ usePrinterDpi: false });
        renderDialog({ runner: new FakeRunner(), printerStatus: statusOf(B1_PRO) });

        const box = screen.getByLabelText('DPI') as HTMLInputElement;
        expect(box.value).toBe('300');
        fireEvent.change(box, { target: { value: '203' } });
        fireEvent.blur(box);
        // No `onDpiChange` (dev harness): never show an uncommitted value.
        await waitFor(() => expect(screen.getByLabelText('DPI')).toHaveValue(300));
    });

    it('disables the DPI controls while a job is printing', async () => {
        const runner = new FakeRunner();
        runner.autoResolve = false;
        renderDialog({
            runner,
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        expect(screen.getByLabelText('Use printer DPI')).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(runner.isBusy()).toBe(true));

        expect(screen.getByLabelText('Use printer DPI')).toBeDisabled();
        expect(screen.getByLabelText('DPI')).toBeDisabled();
    });

    it('the raster-cap guard accounts for an outer offset (R12)', async () => {
        // 32000 hm ≈ 3780 px at 300 dpi → 14.3 M px, under the 16 M cap.
        const big = createLabelDoc({ backingW: 32000, backingH: 32000, dpi: 300 });
        renderLabelPageMock.mockResolvedValue(fakeRenderedPage(narrowDoc(), false));
        renderDialog({ doc: big, runner: new FakeRunner(), printerStatus: statusOf(B1_PRO) });

        expect(screen.queryByTestId('print-raster-cap')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();

        // An `outer` offset grows the canvas: 4280² ≈ 18.3 M px > the cap.
        fireEvent.change(screen.getByLabelText('Offset X'), { target: { value: '500' } });
        fireEvent.change(screen.getByLabelText('Offset Y'), { target: { value: '500' } });
        fireEvent.change(screen.getByLabelText('Offset type'), { target: { value: 'outer' } });

        expect(await screen.findByTestId('print-raster-cap')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
    });
});

describe('PrintDialog — D-28 thumbnail asset scope', () => {
    it('hands the queue thumbnails their own scope, not the print/preview one', async () => {
        const printAssets: AssetDeps = { resolveImage: () => null };
        renderDialog({
            runner: new FakeRunner(),
            printerStatus: statusOf(B1_PRO),
            assets: printAssets,
        });

        // The print scope still reaches the shared render path (page preview)…
        await waitFor(() =>
            expect(
                renderLabelPageMock.mock.calls.some(
                    ([, , opts]) =>
                        (opts as { assets?: unknown } | undefined)?.assets === printAssets,
                ),
            ).toBe(true),
        );

        // …while the thumbnail hook gets a distinct provider scope object.
        const options = usePrintThumbnailsMock.mock.calls.at(-1)![0] as { assets?: unknown };
        expect(options.assets).toBeDefined();
        expect(options.assets).not.toBe(printAssets);
    });
});

describe('PrintDialog — persisted print offset (P9)', () => {
    /** 850 hm ≈ 8.5 mm, -423 hm ≈ -4.23 mm at the 300 dpi hint. */
    const storedOffsetDoc = () =>
        createLabelDoc({
            backingW: 2500,
            backingH: 7800,
            dpi: 300,
            printOffset: { xHm: 850, yHm: -423, type: 'outer' },
        });

    it('shows a stored offset converted to dots at the resolved dpi', () => {
        // The printer reports no dpi, so the resolved basis is the 300 dpi hint.
        renderDialog({ doc: storedOffsetDoc(), runner: new FakeRunner(), printerStatus: statusOf(B1_PRO) });

        expect(screen.getByLabelText('Offset X')).toHaveValue('100');
        expect(screen.getByLabelText('Offset Y')).toHaveValue('-50');
        expect(screen.getByLabelText('Offset type')).toHaveValue('outer');
    });

    it('converts at the printer-reported dpi when that is the resolved basis', () => {
        renderDialog({
            doc: storedOffsetDoc(),
            runner: new FakeRunner(),
            printerStatus: { ...statusOf(B1_PRO), dpi: 203 },
        });

        // 850 hm at 203 dpi = 67.9 dots, not the 100 the 300 dpi hint gives.
        expect(screen.getByLabelText('Offset X')).toHaveValue('68');
    });

    it('reports the hm offset once on unmount, never per keystroke', () => {
        const onPrintOffsetChange = vi.fn();
        const doc = narrowDoc();
        const view = render(
            <PrintDialog
                open
                onClose={vi.fn()}
                doc={doc}
                csv={null}
                runner={new FakeRunner()}
                printerStatus={statusOf(B1_PRO)}
                onPrintOffsetChange={onPrintOffsetChange}
            />,
        );

        fireEvent.change(screen.getByLabelText('Offset X'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Offset Y'), { target: { value: '-50' } });
        fireEvent.change(screen.getByLabelText('Offset type'), { target: { value: 'outer' } });
        expect(onPrintOffsetChange).not.toHaveBeenCalled();

        view.unmount();

        expect(onPrintOffsetChange).toHaveBeenCalledTimes(1);
        expect(onPrintOffsetChange).toHaveBeenCalledWith(
            {
                xHm: Math.round((100 * 2540) / 300),
                yHm: Math.round((-50 * 2540) / 300),
                type: 'outer',
            },
            doc.meta.id,
        );
    });

    it('reports undefined for 0/0 (the printer default)', () => {
        const onPrintOffsetChange = vi.fn();
        const doc = narrowDoc();
        const view = render(
            <PrintDialog
                open
                onClose={vi.fn()}
                doc={doc}
                csv={null}
                runner={new FakeRunner()}
                printerStatus={statusOf(B1_PRO)}
                onPrintOffsetChange={onPrintOffsetChange}
            />,
        );

        view.unmount();

        expect(onPrintOffsetChange).toHaveBeenCalledTimes(1);
        expect(onPrintOffsetChange).toHaveBeenCalledWith(undefined, doc.meta.id);
    });

    it('persists a type-only change at 0/0 (outer is not the printer default)', () => {
        const onPrintOffsetChange = vi.fn();
        const doc = narrowDoc();
        const view = render(
            <PrintDialog
                open
                onClose={vi.fn()}
                doc={doc}
                csv={null}
                runner={new FakeRunner()}
                printerStatus={statusOf(B1_PRO)}
                onPrintOffsetChange={onPrintOffsetChange}
            />,
        );

        fireEvent.change(screen.getByLabelText('Offset type'), { target: { value: 'outer' } });
        view.unmount();

        expect(onPrintOffsetChange).toHaveBeenCalledWith(
            { xHm: 0, yHm: 0, type: 'outer' },
            doc.meta.id,
        );
    });

    it('keeps a stored offset through a StrictMode mount (no spurious commit)', () => {
        const onPrintOffsetChange = vi.fn();
        const doc = storedOffsetDoc();
        render(
            <StrictMode>
                <PrintDialog
                    open
                    onClose={vi.fn()}
                    doc={doc}
                    csv={null}
                    runner={new FakeRunner()}
                    printerStatus={statusOf(B1_PRO)}
                    onPrintOffsetChange={onPrintOffsetChange}
                />
            </StrictMode>,
        );

        // StrictMode's simulated unmount must not re-report (and round-drift)
        // the untouched stored offset.
        expect(onPrintOffsetChange).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Offset X')).toHaveValue('100');
    });
});
