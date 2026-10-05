import { beforeAll, describe, expect, it } from 'vitest';
import { ImageEncoder, PageColorType } from '@mmote/niimbluelib';
import { installCanvasShim } from '../test/canvasHarness';
import { createLabelDoc } from '../core/doc/factory';
import { rasterDimensions } from '../core/render';
import type { LabelDoc, Node } from '../core/doc/types';
import { orientForPrint, renderLabelPage } from '../editor/render';
import { MockTransport } from './mockTransport';
import type { PrintJob, PrintPage } from './transport';
import { buildLabelPrintJob, printLabel } from './printLabel';

beforeAll(() => {
    installCanvasShim();
});

// Test-local doc builders (the W2 golden-test idiom): a `Node`-shaped literal.
const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const text = (id: string, x: number, y: number, value: string): Node =>
    node({
        id,
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'static', value },
        size: { w: 1900, h: 700 },
        fontSize: 500,
    });

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

/** An F-tag spare doc with a filled rect + text inside the flag region (real ink). */
const ftagDoc = (printDirection?: LabelDoc['label']['printDirection']): LabelDoc =>
    createLabelDoc({
        preset: 'ftagSpare-25x78',
        ...(printDirection ? { printDirection } : {}),
        nodes: [rect('r', 300, 300, 1900, 1400), text('t', 300, 2000, 'PRINT W4')],
    });

const collectPages = async (job: PrintJob): Promise<PrintPage[]> => {
    const pages: PrintPage[] = [];
    for await (const page of job.pages) {
        pages.push(page);
    }
    return pages;
};

const dimsOf = (doc: LabelDoc): { widthPx: number; heightPx: number } =>
    rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);

describe('buildLabelPrintJob', () => {
    it('builds a lazy one-page job with the requested quantity and SingleColor', async () => {
        const doc = ftagDoc();
        const job = await buildLabelPrintJob(doc, { quantity: 1 });

        expect(job.totalPages).toBe(1);
        expect(job.pageColor).toBe(PageColorType.SingleColor);

        // Invariant 9: `pages` is an async iterable, not a materialized array.
        expect(typeof (job.pages as AsyncIterable<PrintPage>)[Symbol.asyncIterator]).toBe('function');

        const pages = await collectPages(job);
        expect(pages).toHaveLength(1);
        expect(pages[0]!.quantity).toBe(1);
        expect(pages[0]!.data.pageColor).toBe(PageColorType.SingleColor);
    });

    it('honours a multi-copy quantity on the single page', async () => {
        const job = await buildLabelPrintJob(ftagDoc(), { quantity: 3 });
        expect(job.totalPages).toBe(3);
        const pages = await collectPages(job);
        expect(pages).toHaveLength(1);
        expect(pages[0]!.quantity).toBe(3);
    });

    it('rejects a non-positive / fractional quantity', async () => {
        await expect(buildLabelPrintJob(ftagDoc(), { quantity: 0 })).rejects.toThrow(RangeError);
        await expect(buildLabelPrintJob(ftagDoc(), { quantity: 1.5 })).rejects.toThrow(RangeError);
    });

    it('encodes dims consistent with rasterDimensions and printDirection=top', async () => {
        const doc = ftagDoc();
        const dims = dimsOf(doc);
        const [page] = await collectPages(await buildLabelPrintJob(doc));
        const data = page!.data;

        // 'top' sends the raster unrotated; cols pads up to a multiple of 8.
        expect(data.rows).toBe(dims.heightPx);
        expect(data.cols).toBe(Math.ceil(dims.widthPx / 8) * 8);
    });

    it('swaps cols/rows for printDirection=left', async () => {
        const doc = ftagDoc('left');
        const dims = dimsOf(doc);
        const [page] = await collectPages(await buildLabelPrintJob(doc));
        const data = page!.data;

        expect(data.rows).toBe(dims.widthPx);
        expect(data.cols).toBe(Math.ceil(dims.heightPx / 8) * 8);
    });

    it('emits at least one non-void row (real ink)', async () => {
        const [page] = await collectPages(await buildLabelPrintJob(ftagDoc()));
        expect(page!.data.rowsData.some((row) => row.dataType === 'pixels')).toBe(true);
    });

    it('is deterministic: two builds yield identical rowsData', async () => {
        const doc = ftagDoc();
        const a = (await collectPages(await buildLabelPrintJob(doc)))[0]!.data;
        const b = (await collectPages(await buildLabelPrintJob(doc)))[0]!.data;
        expect(a.rowsData).toEqual(b.rowsData);
        expect(a.cols).toBe(b.cols);
        expect(a.rows).toBe(b.rows);
    });

    it('matches the shared render path (preview ≡ print encode)', async () => {
        const doc = ftagDoc();
        const [page] = await collectPages(await buildLabelPrintJob(doc));
        const preview = await renderLabelPage(doc);
        const oriented = orientForPrint(preview, doc.label.printDirection);
        const expected = ImageEncoder.encodeCanvas(
            oriented.canvas,
            PageColorType.SingleColor,
            oriented.direction,
        );
        expect(page!.data).toEqual(expected);
    });

    it('orients printDirection=bottom: pre-rotates 180° and encodes top (D-04)', async () => {
        const doc = ftagDoc('bottom');
        const [page] = await collectPages(await buildLabelPrintJob(doc));
        const preview = await renderLabelPage(doc);

        const oriented = orientForPrint(preview, 'bottom');
        expect(oriented.direction).toBe('top');
        expect(oriented.canvas).not.toBe(preview.canvas);

        const expected = ImageEncoder.encodeCanvas(
            oriented.canvas,
            PageColorType.SingleColor,
            oriented.direction,
        );
        expect(page!.data.rowsData).toEqual(expected.rowsData);

        // The old bug encoded the unrotated canvas as 'top'; the oriented bytes
        // must differ (the doc is asymmetric: rect + text at different rows).
        const buggy = ImageEncoder.encodeCanvas(
            preview.canvas,
            PageColorType.SingleColor,
            'top',
        );
        expect(page!.data.rowsData).not.toEqual(buggy.rowsData);
    });

    it('orients printDirection=right: pre-rotates 180° and encodes left (D-04)', async () => {
        const doc = ftagDoc('right');
        const [page] = await collectPages(await buildLabelPrintJob(doc));
        const preview = await renderLabelPage(doc);

        const oriented = orientForPrint(preview, 'right');
        expect(oriented.direction).toBe('left');
        expect(oriented.canvas).not.toBe(preview.canvas);

        const expected = ImageEncoder.encodeCanvas(
            oriented.canvas,
            PageColorType.SingleColor,
            oriented.direction,
        );
        expect(page!.data.rowsData).toEqual(expected.rowsData);

        // The old bug encoded the unrotated canvas as 'top' (not even 'left').
        const buggy = ImageEncoder.encodeCanvas(
            preview.canvas,
            PageColorType.SingleColor,
            'top',
        );
        expect(page!.data.rowsData).not.toEqual(buggy.rowsData);
    });

    it('empirically pins the encoder’s 90° clockwise rotation for direction=left', () => {
        // 3×2 canvas with a single black pixel at the top-left (0,0).
        const canvas = document.createElement('canvas');
        canvas.width = 3;
        canvas.height = 2;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 3, 2);
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 1, 1);

        // Unrotated: source (0,0) maps to output row 0, col 0 (bit 0 of octet 0).
        const top = ImageEncoder.encodeCanvas(canvas, PageColorType.SingleColor, 'top');
        expect(top.rows).toBe(2);
        expect(top.cols).toBe(8); // padded from 3
        expect(top.rowsData[0]!.rowDataBlack![0]).toBe(0b1000_0000);

        // 'left' rotates the raster 90° clockwise: source (x=0,y=0) lands at
        // output row x=0, column height-1-y=1 (bit 1 of octet 0); rows 1..2 are
        // void because the rotated raster is only 2 source-columns wide.
        const left = ImageEncoder.encodeCanvas(canvas, PageColorType.SingleColor, 'left');
        expect(left.rows).toBe(3);
        expect(left.cols).toBe(8);
        expect(left.rowsData[0]!.dataType).toBe('pixels');
        expect(left.rowsData[0]!.rowDataBlack![0]).toBe(0b0100_0000);
        expect(left.rowsData[1]!.dataType).toBe('void');
    });
});

describe('printLabel', () => {
    it('feeds the job to MockTransport and prints one page', async () => {
        const transport = new MockTransport();
        await transport.connect();

        const result = await printLabel(transport, ftagDoc(), { quantity: 1 });

        expect(result.pagesPrinted).toBe(1);
        expect(transport.jobs).toHaveLength(1);
        expect(transport.jobs[0]!.quantities).toEqual([1]);
    });

    it('prints the requested copy count', async () => {
        const transport = new MockTransport();
        await transport.connect();

        const result = await printLabel(transport, ftagDoc(), { quantity: 3 });

        expect(result.pagesPrinted).toBe(3);
        expect(transport.jobs[0]!.quantities).toEqual([3]);
    });
});
