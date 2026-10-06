// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ImageEncoder, PageColorType } from '@mmote/niimbluelib';
import { installCanvasShim } from '../test/canvasHarness';
import { createLabelDoc } from '../core/doc/factory';
import type { LabelDoc, Node } from '../core/doc/types';
import type { CsvRecord } from '../data/csvRepo';
import { orientForPrint, renderLabelPage, type ResolveContext } from '../editor/render';
import { createJobRunner, type JobProgress } from './jobRunner';
import { MockTransport } from './mockTransport';
import { buildCsvPrintJob, renderOptionsOf, type PrintOverrides } from './printLabel';
import { planSequence, type PrintOrder } from './sequence';
import type { PrintJob, PrintPage, TransportState } from './transport';

/**
 * P7 exit criterion integration test: a 100-row CSV must print reliably through
 * the **full** production path
 *
 *   planSequence → buildCsvPrintJob → createJobRunner → MockTransport
 *
 * over a real Konva render (`installCanvasShim`), and a mid-job cancel must be
 * clean (truthful partial count, transport back to `connected`, the one-job
 * guard released so a second run succeeds). Cases are derived from
 * `agent/2026-09-29_label-editor-v1/phase7_action-plan.md` §1/§3.2/§3.4.
 *
 * The doc is deliberately tiny (~47×63 px at 100 dpi) so the 100-page jobs stay
 * fast while every page still goes through the real rasterize/quantize/encode
 * pipeline.
 */

beforeAll(() => {
    installCanvasShim();
});

const ROW_COUNT = 100;

// Test-local doc builders (same `Node`-shaped literal idiom as printLabel.test).
const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const rect = (id: string, x: number, y: number, w: number, h: number): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w, h },
    });

const text = (id: string, x: number, y: number, value: string): Node =>
    node({
        id,
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'static', value },
        size: { w: 1000, h: 500 },
        fontSize: 400,
    });

/** A tiny label (1200×1600 hm = 12×16 mm at 100 dpi → 47×63 px) with real ink. */
const tinyDoc = (printDirection?: LabelDoc['label']['printDirection']): LabelDoc =>
    createLabelDoc({
        backingW: 1200,
        backingH: 1600,
        dpi: 100,
        ...(printDirection ? { printDirection } : {}),
        nodes: [rect('r', 100, 100, 1000, 800), text('t', 100, 1100, 'BATCH')],
    });

const csvOf = (columns: string[], rows: string[][]): CsvRecord => ({
    id: 'csv_batch',
    name: 'batch.csv',
    columns,
    rows,
});

/**
 * The 100-record fixture: two records carry `$times` (`0` → skipped, `2` →
 * doubled), the rest default to 1. Σ = 98×1 + 2 = **100** physical pages — the
 * exit criterion's "100-label CSV job" while still exercising the column.
 */
const groupedCsv = (): CsvRecord => {
    const rows: string[][] = Array.from({ length: ROW_COUNT }, (_, i) => [`row-${i}`, '']);
    rows[0] = ['row-0', '0'];
    rows[1] = ['row-1', '2'];
    return csvOf(['name', '$times'], rows);
};

/** Independent `$times` reader mirroring the fixture above. */
const timesOfGrouped = (rowIndex: number): number =>
    rowIndex === 0 ? 0 : rowIndex === 1 ? 2 : 1;

/** Independently drive `planSequence` and record its cheap Σ + emitted quantities. */
const collectPlan = async (
    order: PrintOrder,
    copies: number,
    timesFor: (rowIndex: number) => number,
    rows = ROW_COUNT,
): Promise<{ totalPages: number; quantities: number[] }> => {
    const plan = planSequence(rows, timesFor, { order, copies });
    const quantities: number[] = [];
    for await (const page of plan.pages) quantities.push(page.quantity);
    return { totalPages: plan.totalPages, quantities };
};

const collectPages = async (job: PrintJob): Promise<PrintPage[]> => {
    const pages: PrintPage[] = [];
    for await (const page of job.pages) pages.push(page);
    return pages;
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

describe('P7 batch job end-to-end: planSequence → buildCsvPrintJob → jobRunner → MockTransport', () => {
    it('grouped: 100 records → 100 physical pages; MockTransport totalPages/quantities match the plan', async () => {
        const csv = groupedCsv();
        const transport = new MockTransport();
        await transport.connect();
        const runner = createJobRunner(transport);

        const rowOrder: number[] = [];
        const job = buildCsvPrintJob(
            tinyDoc(),
            csv,
            { order: 'grouped', copies: 1 },
            {
                prepareRow: async (rowIndex) => {
                    rowOrder.push(rowIndex);
                    return {};
                },
            },
        );

        const plan = await collectPlan('grouped', 1, timesOfGrouped);

        // Plan: row0 skipped, row1 doubled, rows 2..99 single → 99 pages, Σ 100.
        expect(plan.totalPages).toBe(100);
        expect(plan.quantities).toHaveLength(99);
        expect(plan.quantities).toEqual([2, ...new Array<number>(98).fill(1)]);
        expect(job.totalPages).toBe(plan.totalPages);

        const result = await runner.run(job);

        expect(result).toEqual({ cancelled: false, pagesPrinted: 100 });
        // Grouped = one page per yielded record, in row order (row0 skipped).
        expect(rowOrder).toEqual([1, ...Array.from({ length: 98 }, (_, i) => i + 2)]);

        expect(transport.jobs).toHaveLength(1);
        const record = transport.jobs[0]!;
        expect(record.totalPages).toBe(plan.totalPages);
        expect(record.quantities).toEqual(plan.quantities);
        expect(sum(record.quantities)).toBe(100);
        expect(record.result).toEqual({ pagesPrinted: 100 });
    });

    it('interleaved: 100 quantity-1 pages, in row order', async () => {
        const csv = groupedCsv();
        const transport = new MockTransport();
        await transport.connect();
        const runner = createJobRunner(transport);

        const rowOrder: number[] = [];
        const job = buildCsvPrintJob(
            tinyDoc(),
            csv,
            { order: 'interleaved', copies: 1 },
            {
                prepareRow: async (rowIndex) => {
                    rowOrder.push(rowIndex);
                    return {};
                },
            },
        );

        const plan = await collectPlan('interleaved', 1, timesOfGrouped);
        expect(plan.totalPages).toBe(100);
        expect(plan.quantities).toEqual(new Array<number>(100).fill(1));
        expect(job.totalPages).toBe(100);

        const result = await runner.run(job);

        expect(result).toEqual({ cancelled: false, pagesPrinted: 100 });
        // row0 skipped; row1 emitted twice; rows 2..99 once each.
        expect(rowOrder).toEqual([
            1,
            1,
            ...Array.from({ length: 98 }, (_, i) => i + 2),
        ]);

        const record = transport.jobs[0]!;
        expect(record.totalPages).toBe(100);
        expect(record.quantities).toEqual(new Array<number>(100).fill(1));
        expect(record.quantities).toHaveLength(100);
    });

    it('$times × copies: zero rows skipped; Σ quantity == totalPages == pagesPrinted', async () => {
        // 4 records: $times 1/2/0/3 × copies 2 → [2, 4, skip, 6], Σ 12.
        const csv = csvOf(['$times'], [['1'], ['2'], ['0'], ['3']]);
        const times = [1, 2, 0, 3];
        const transport = new MockTransport();
        await transport.connect();
        const runner = createJobRunner(transport);

        const rowOrder: number[] = [];
        const job = buildCsvPrintJob(
            tinyDoc(),
            csv,
            { order: 'grouped', copies: 2 },
            {
                prepareRow: async (rowIndex) => {
                    rowOrder.push(rowIndex);
                    return {};
                },
            },
        );

        const plan = await collectPlan('grouped', 2, (i) => times[i] ?? 1, 4);
        expect(plan.totalPages).toBe(12);
        expect(plan.quantities).toEqual([2, 4, 6]);
        expect(job.totalPages).toBe(12);

        const result = await runner.run(job);

        expect(result).toEqual({ cancelled: false, pagesPrinted: 12 });
        // The zero-times record never produces a page, so prepareRow is not called.
        expect(rowOrder).toEqual([0, 1, 3]);

        const record = transport.jobs[0]!;
        expect(record.totalPages).toBe(12);
        expect(record.quantities).toEqual([2, 4, 6]);
        expect(sum(record.quantities)).toBe(record.totalPages);
        expect(record.result).toEqual({ pagesPrinted: 12 });
    });

    it('mid-job cancel is clean: partial count, transport back to connected, second run succeeds', async () => {
        const csv = groupedCsv();
        const transport = new MockTransport({ pageDelayMs: 20 });
        await transport.connect();
        const states: TransportState[] = [];
        transport.onStatus((status) => states.push(status.state));
        const runner = createJobRunner(transport);

        const seen: JobProgress[] = [];
        const result = await runner.run(
            buildCsvPrintJob(tinyDoc(), csv, { order: 'grouped', copies: 1 }),
            {
                onProgress: (progress) => {
                    seen.push(progress);
                    if (progress.phase === 'printing' && progress.page === 3) {
                        runner.cancel();
                    }
                },
            },
        );

        expect(result.cancelled).toBe(true);
        expect(result.pagesPrinted).toBeGreaterThan(0);
        expect(result.pagesPrinted).toBeLessThan(ROW_COUNT);
        // Deterministic: the abort lands right after physical copy 3 is reported.
        expect(result.pagesPrinted).toBe(3);
        expect(runner.isBusy()).toBe(false);
        expect(transport.jobs[0]!.result).toEqual({ pagesPrinted: 3 });
        expect(states.at(-1)).toBe('connected');

        // Progress was reported and never went backwards.
        let previous = 0;
        for (const entry of seen) {
            expect(entry.percent).toBeGreaterThanOrEqual(previous);
            previous = entry.percent;
        }

        // No orphaned job / wedged one-at-a-time guard: a fresh run must succeed.
        const secondCsv = csvOf(['name'], [['a'], ['b'], ['c'], ['d'], ['e']]);
        const second = await runner.run(
            buildCsvPrintJob(tinyDoc(), secondCsv, { order: 'grouped', copies: 1 }),
        );
        expect(second).toEqual({ cancelled: false, pagesPrinted: 5 });
        expect(runner.isBusy()).toBe(false);
        expect(transport.jobs).toHaveLength(2);
        expect(states.at(-1)).toBe('connected');
    });

    it('prepareRow is lazy: only the in-flight row is prepared after the first page', async () => {
        const csv = groupedCsv();
        const transport = new MockTransport({ pageDelayMs: 1 });
        await transport.connect();
        const runner = createJobRunner(transport);

        const prepareRow = vi.fn(async (_rowIndex: number) => ({}));
        const job = buildCsvPrintJob(
            tinyDoc(),
            csv,
            { order: 'grouped', copies: 1 },
            { prepareRow },
        );
        expect(prepareRow).not.toHaveBeenCalled();

        let preparedAtFirstPage = -1;
        await runner.run(job, {
            onProgress: (progress) => {
                if (progress.phase === 'printing' && progress.page === 1) {
                    preparedAtFirstPage = prepareRow.mock.calls.length;
                }
            },
        });

        // Invariant 9: a 100-row job does not prepare all rows up front.
        expect(preparedAtFirstPage).toBeGreaterThan(0);
        expect(preparedAtFirstPage).toBeLessThanOrEqual(2);
        expect(preparedAtFirstPage).toBeLessThan(ROW_COUNT);
        // The whole run still prepares every *emitted* page exactly once (row0 skipped).
        expect(prepareRow).toHaveBeenCalledTimes(99);
    });

    it('provenance: page bytes ≡ independent render + orient + encode (invariant 7, with overrides)', async () => {
        const doc = tinyDoc('right');
        const csv = csvOf(['name'], [['provenance']]);
        const overrides: PrintOverrides = {
            dpi: 150,
            invert: true,
            offset: { x: 2, y: 3, type: 'inner' },
        };
        const ctx: ResolveContext = {};

        const job = buildCsvPrintJob(
            doc,
            csv,
            { order: 'grouped', copies: 1, overrides },
            { prepareRow: async () => ctx },
        );
        const [page] = await collectPages(job);

        const rendered = await renderLabelPage(doc, ctx, renderOptionsOf(overrides, undefined));
        const oriented = orientForPrint(rendered, doc.label.printDirection);
        const expected = ImageEncoder.encodeCanvas(
            oriented.canvas,
            PageColorType.SingleColor,
            oriented.direction,
        );

        expect(page!.data).toEqual(expected);
        // Guard against a vacuous match: real ink must have been encoded.
        expect(page!.data.rowsData.some((row) => row.dataType === 'pixels')).toBe(true);
    });
});
