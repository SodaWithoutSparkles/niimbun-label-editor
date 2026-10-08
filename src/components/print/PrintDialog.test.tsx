// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabelType, type EncodedImage } from '@mmote/niimbluelib';
import '../../i18n';
import { rasterDimensions } from '../../core/render';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import type { RenderedLabelPage } from '../../editor/render';
import type { JobProgress, JobRunResult, JobRunner } from '../../print/jobRunner';
import type { PrintJob, PrinterCapabilities, PrinterStatus } from '../../print/transport';
import { useStore } from '../../store/useStore';
import { PrintDialog } from './PrintDialog';

const { buildCsvPrintJobMock, renderLabelPageMock } = vi.hoisted(() => ({
    buildCsvPrintJobMock: vi.fn(),
    renderLabelPageMock: vi.fn(),
}));

vi.mock('../../print/printLabel', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../print/printLabel')>();
    return { ...actual, buildCsvPrintJob: buildCsvPrintJobMock };
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
    useStore.setState({ editorWarnings: {} });
});

class FakeRunner implements JobRunner {
    busy = false;
    cancelCalls = 0;
    lastJob: PrintJob | undefined;
    quantities: number[] = [];
    autoResolve = true;
    private resolver: ((result: JobRunResult) => void) | undefined;

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
        // The ink check is lazy: no size overflow means no doc-dpi render. (The
        // thumbnail cache shares this seam, but always passes `dpi: 50`.)
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
