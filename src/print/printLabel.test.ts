// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ImageEncoder, PageColorType, type LabelType } from '@mmote/niimbluelib';
import { installCanvasShim } from '../test/canvasHarness';
import { createLabelDoc } from '../core/doc/factory';
import { rasterDimensions } from '../core/render';
import type { LabelDoc, Node } from '../core/doc/types';
import type { CsvRecord } from '../data/csvRepo';
import {
    orientForPrint,
    renderLabelPage,
    type RenderLabelPageOptions,
    type ResolveContext,
} from '../editor/render';
import { MockTransport } from './mockTransport';
import type { PrintJob, PrintPage } from './transport';
import {
    buildCsvPrintJob,
    buildLabelPrintJob,
    printLabel,
    renderOptionsOf,
    type PrintOverrides,
} from './printLabel';

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
        // Explicit black fill so the rect is an ink source (default is transparent).
        fill: '#000000',
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

const csvOf = (columns: string[], rows: string[][]): CsvRecord => ({
    id: 'csv_1',
    name: 'test.csv',
    columns,
    rows,
});

describe('buildCsvPrintJob', () => {
    it('grouped: one page per row with $times × copies', async () => {
        const csv = csvOf(['$times'], [['2'], ['3']]);
        const job = buildCsvPrintJob(ftagDoc(), csv, { order: 'grouped', copies: 1 });

        expect(job.totalPages).toBe(5);
        const pages = await collectPages(job);
        expect(pages.map((page) => page.quantity)).toEqual([2, 3]);
        expect(pages.reduce((sum, page) => sum + page.quantity, 0)).toBe(job.totalPages);
    });

    it('interleaved: quantity-1 pages in row order', async () => {
        const csv = csvOf(['$times'], [['2'], ['3']]);
        const seen: number[] = [];
        const job = buildCsvPrintJob(
            ftagDoc(),
            csv,
            { order: 'interleaved', copies: 1 },
            {
                prepareRow: async (rowIndex) => {
                    seen.push(rowIndex);
                    return {};
                },
            },
        );

        expect(job.totalPages).toBe(5);
        const pages = await collectPages(job);
        expect(pages.map((page) => page.quantity)).toEqual([1, 1, 1, 1, 1]);
        expect(seen).toEqual([0, 0, 1, 1, 1]);
        expect(pages.reduce((sum, page) => sum + page.quantity, 0)).toBe(job.totalPages);
    });

    it('multiplies $times by the global copies and skips zero rows', async () => {
        const csv = csvOf(['$times'], [['2'], ['0'], ['1']]);
        const job = buildCsvPrintJob(ftagDoc(), csv, { order: 'grouped', copies: 3 });

        // 2×3 + 0 (skipped) + 1×3 = 9
        expect(job.totalPages).toBe(9);
        expect((await collectPages(job)).map((page) => page.quantity)).toEqual([6, 3]);
    });

    it('defaults $times to 1 for absent column / absent / empty / unparsable', async () => {
        const absentColumn = csvOf(['name'], [['a'], ['b']]);
        expect(
            (await collectPages(buildCsvPrintJob(ftagDoc(), absentColumn, { order: 'grouped', copies: 1 }))).map(
                (page) => page.quantity,
            ),
        ).toEqual([1, 1]);

        const cells = csvOf(['$times'], [[''], ['abc'], ['2']]);
        expect(
            (await collectPages(buildCsvPrintJob(ftagDoc(), cells, { order: 'grouped', copies: 1 }))).map(
                (page) => page.quantity,
            ),
        ).toEqual([1, 1, 2]);

        // A row shorter than the column list → absent value → 1.
        const shortRow = csvOf(['$times'], [[]]);
        expect(
            (await collectPages(buildCsvPrintJob(ftagDoc(), shortRow, { order: 'grouped', copies: 1 }))).map(
                (page) => page.quantity,
            ),
        ).toEqual([1]);
    });

    it('no CSV ⇒ a single page carrying the global copies', async () => {
        const job = buildCsvPrintJob(ftagDoc(), null, { order: 'grouped', copies: 3 });

        expect(job.totalPages).toBe(3);
        const pages = await collectPages(job);
        expect(pages).toHaveLength(1);
        expect(pages[0]!.quantity).toBe(3);
    });

    it('calls prepareRow lazily, once per page, not upfront', async () => {
        const csv = csvOf(['$times'], [['1'], ['1']]);
        const prepareRow = vi.fn(async () => ({}));
        const job = buildCsvPrintJob(
            ftagDoc(),
            csv,
            { order: 'grouped', copies: 1 },
            { prepareRow },
        );

        expect(prepareRow).not.toHaveBeenCalled();
        const iterator = job.pages[Symbol.asyncIterator]();
        await iterator.next();
        expect(prepareRow).toHaveBeenCalledTimes(1);
        await iterator.next();
        expect(prepareRow).toHaveBeenCalledTimes(2);
    });

    it('forwards render-relevant overrides into the render options', async () => {
        const overrides: PrintOverrides = {
            dpi: 150,
            invert: true,
            mirror: true,
            offset: { x: 2, y: 3, type: 'inner' },
        };
        const render = vi.fn(
            (doc: LabelDoc, ctx: ResolveContext, opts: RenderLabelPageOptions) =>
                renderLabelPage(doc, ctx, opts),
        );
        const job = buildCsvPrintJob(ftagDoc(), null, { order: 'grouped', copies: 1, overrides }, {
            render,
        });

        await collectPages(job);

        expect(render).toHaveBeenCalledTimes(1);
        const opts = render.mock.calls[0]![2];
        expect(opts).toMatchObject(overrides);
    });

    it('carries only-defined task overrides onto the PrintJob', () => {
        const job = buildCsvPrintJob(ftagDoc(), null, {
            order: 'grouped',
            copies: 1,
            overrides: {
                density: 4,
                speed: 0,
                labelType: 2 as LabelType,
                pageColor: PageColorType.SingleColor,
            },
        });

        expect(job.density).toBe(4);
        expect(job.speed).toBe(0);
        expect(job.labelType).toBe(2);
        expect(job.pageColor).toBe(PageColorType.SingleColor);
    });

    it('omits unset override keys from the PrintJob', () => {
        const job = buildCsvPrintJob(ftagDoc(), null, { order: 'grouped', copies: 1 });

        expect(job).not.toHaveProperty('density');
        expect(job).not.toHaveProperty('speed');
        expect(job).not.toHaveProperty('labelType');
        expect(job).not.toHaveProperty('pageColor');
    });

    it('applies print orientation for the document direction', async () => {
        const doc = ftagDoc('bottom');
        const [page] = await collectPages(buildCsvPrintJob(doc, null, { order: 'grouped', copies: 1 }));

        const preview = await renderLabelPage(doc);
        const oriented = orientForPrint(preview, 'bottom');
        const expected = ImageEncoder.encodeCanvas(
            oriented.canvas,
            PageColorType.SingleColor,
            oriented.direction,
        );
        expect(page!.data.rowsData).toEqual(expected.rowsData);
    });

    it('invariant 7: with overrides, print bytes ≡ independent render + orient + encode', async () => {
        const doc = ftagDoc('right');
        const overrides: PrintOverrides = {
            dpi: 150,
            invert: true,
            offset: { x: 1, y: 2, type: 'inner' },
        };
        const [page] = await collectPages(
            buildCsvPrintJob(doc, null, { order: 'grouped', copies: 1, overrides }),
        );

        const rendered = await renderLabelPage(doc, {}, overrides);
        const oriented = orientForPrint(rendered, doc.label.printDirection);
        const expected = ImageEncoder.encodeCanvas(
            oriented.canvas,
            PageColorType.SingleColor,
            oriented.direction,
        );
        expect(page!.data).toEqual(expected);
    });

    it('D-01: throws if the page sequence would exceed totalPages', async () => {
        let times = 1;
        const job = buildCsvPrintJob(
            ftagDoc(),
            csvOf(['$times'], [['1']]),
            { order: 'grouped', copies: 1 },
            { timesFor: () => times },
        );
        expect(job.totalPages).toBe(1);

        // Simulate a non-deterministic source: the generator now yields more
        // copies than the build-time Σ promised (the callback is documented as
        // pure/stable; violating that must fail loudly instead of over-sending).
        times = 5;

        await expect(collectPages(job)).rejects.toThrow(/exceeds totalPages/);
    });

    it('D-01: throws if the page sequence under-sends totalPages', async () => {
        let times = 5;
        const job = buildCsvPrintJob(
            ftagDoc(),
            csvOf(['$times'], [['1']]),
            { order: 'grouped', copies: 1 },
            { timesFor: () => times },
        );
        expect(job.totalPages).toBe(5);

        // The generator now yields fewer copies than the transport was told; a
        // silent under-send would leave it waiting for pages that never come.
        times = 1;

        await expect(collectPages(job)).rejects.toThrow(/under-sent/);
    });

    it('snapshots $times at build time: a later CSV mutation cannot change the sequence', async () => {
        const csv = csvOf(['$times'], [['1']]);
        const job = buildCsvPrintJob(ftagDoc(), csv, { order: 'grouped', copies: 1 });
        expect(job.totalPages).toBe(1);

        // The old implementation read the live cell, so this mutation made the
        // generator disagree with `totalPages` and trip the D-01 guard. The
        // build-time snapshot must keep the two in step.
        csv.rows[0]![0] = '5';

        const pages = await collectPages(job);
        expect(pages.map((page) => page.quantity)).toEqual([1]);
        expect(pages.reduce((sum, page) => sum + page.quantity, 0)).toBe(job.totalPages);
    });

    it('is re-iterable: a second pass yields the identical full sequence', async () => {
        const csv = csvOf(['$times'], [['2'], ['3']]);
        const job = buildCsvPrintJob(ftagDoc(), csv, { order: 'grouped', copies: 1 });

        const first = await collectPages(job);
        const second = await collectPages(job);

        expect(first.map((page) => page.quantity)).toEqual([2, 3]);
        expect(second.map((page) => page.quantity)).toEqual([2, 3]);
        expect(second.map((page) => page.data.rowsData)).toEqual(
            first.map((page) => page.data.rowsData),
        );
    });

    it('rejects DoubleColor pageColor (v1 render path is single-plane)', () => {
        expect(() =>
            buildCsvPrintJob(ftagDoc(), null, {
                order: 'grouped',
                copies: 1,
                overrides: { pageColor: PageColorType.DoubleColor },
            }),
        ).toThrow(RangeError);
    });

    it('hands the render seam a fresh options object per page', async () => {
        const seen: RenderLabelPageOptions[] = [];
        const invertPerPage: Array<boolean | undefined> = [];
        const csv = csvOf(['$times'], [['1'], ['1']]);
        const job = buildCsvPrintJob(
            ftagDoc(),
            csv,
            { order: 'grouped', copies: 1, overrides: { invert: true } },
            {
                render: async (doc, ctx, opts) => {
                    seen.push(opts);
                    invertPerPage.push(opts.invert);
                    const rendered = await renderLabelPage(doc, ctx, opts);
                    delete (opts as { invert?: boolean }).invert; // try to poison the next page
                    return rendered;
                },
            },
        );

        await collectPages(job);

        expect(seen).toHaveLength(2);
        expect(seen[0]).not.toBe(seen[1]);
        // Each page must receive its own copy: poisoning page 0's object must
        // not strip `invert` from page 1's options.
        expect(invertPerPage).toEqual([true, true]);
    });

    it('clones the nested offset per page so a seam cannot poison later pages', async () => {
        const offsets: Array<{ x: number; y: number }> = [];
        const csv = csvOf(['$times'], [['1'], ['1']]);
        const job = buildCsvPrintJob(
            ftagDoc(),
            csv,
            { order: 'grouped', copies: 1, overrides: { offset: { x: 1, y: 2, type: 'inner' } } },
            {
                render: async (doc, ctx, opts) => {
                    offsets.push({ x: opts.offset!.x, y: opts.offset!.y });
                    const rendered = await renderLabelPage(doc, ctx, opts);
                    // A shallow spread shares the offset object across pages; mutate
                    // it after rendering to try to leak { x: 999 } into page 1.
                    opts.offset!.x = 999;
                    return rendered;
                },
            },
        );

        await collectPages(job);

        // Page 1 must still see the untainted offset (a shared nested object
        // would have made this [{x:1},{x:999}]).
        expect(offsets).toEqual([
            { x: 1, y: 2 },
            { x: 1, y: 2 },
        ]);
    });

    it('renderOptionsOf keeps only render keys (invariant 7: dialog bytes ≡ job bytes)', () => {
        const options = renderOptionsOf(
            {
                density: 4,
                speed: 0,
                labelType: 2 as LabelType,
                pageColor: PageColorType.SingleColor,
                dpi: 150,
                invert: true,
                mirror: false,
                offset: { x: 1, y: 2, type: 'outer' },
            },
            undefined,
        );

        expect(options).toEqual({
            dpi: 150,
            invert: true,
            mirror: false,
            offset: { x: 1, y: 2, type: 'outer' },
        });
        expect(options).not.toHaveProperty('density');
        expect(options).not.toHaveProperty('speed');
        expect(options).not.toHaveProperty('labelType');
        expect(options).not.toHaveProperty('pageColor');
    });
});

describe('$times parsing (build-time snapshot)', () => {
    const cases: Array<{ name: string; csv: CsvRecord; expected: number[] }> = [
        { name: 'empty cell defaults to 1', csv: csvOf(['$times'], [['']]), expected: [1] },
        { name: 'absent times column defaults to 1', csv: csvOf(['name'], [['a']]), expected: [1] },
        { name: 'short row (absent value) defaults to 1', csv: csvOf(['$times'], [[]]), expected: [1] },
        { name: 'unparsable text defaults to 1', csv: csvOf(['$times'], [['abc']]), expected: [1] },
        { name: "parses '2'", csv: csvOf(['$times'], [['2']]), expected: [2] },
        { name: "trims ' 3 '", csv: csvOf(['$times'], [[' 3 ']]), expected: [3] },
        { name: "floors '3.9'", csv: csvOf(['$times'], [['3.9']]), expected: [3] },
        { name: "clamps '-1' to 0 (row skipped)", csv: csvOf(['$times'], [['-1']]), expected: [] },
        { name: "'0' is skipped", csv: csvOf(['$times'], [['0']]), expected: [] },
        { name: "radix 10 stops at 'e' in '1e3'", csv: csvOf(['$times'], [['1e3']]), expected: [1] },
        { name: "radix 10 stops at 'x' in '0x10'", csv: csvOf(['$times'], [['0x10']]), expected: [] },
    ];

    it.each(cases)('$name', async ({ csv, expected }) => {
        const job = buildCsvPrintJob(ftagDoc(), csv, { order: 'grouped', copies: 1 });
        expect(job.totalPages).toBe(expected.reduce((sum, n) => sum + n, 0));
        expect((await collectPages(job)).map((page) => page.quantity)).toEqual(expected);
    });

    it('does not wrap a cell above 2^31-1 (Float64Array snapshot); it trips MAX_TOTAL_PAGES', () => {
        // `Int32Array` wrapped `3000000000` to a negative count, which `Math.max(0, …)`
        // then turned into 0 — silently skipping the row. The snapshot is a
        // `Float64Array` now, so the oversized value survives intact and
        // `planSequence` rejects it via MAX_TOTAL_PAGES (deterministic, loud).
        const csv = csvOf(['$times'], [['3000000000']]);
        expect(() => buildCsvPrintJob(ftagDoc(), csv, { order: 'grouped', copies: 1 })).toThrow(
            RangeError,
        );
    });
});
