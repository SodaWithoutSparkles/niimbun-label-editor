// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import {
    BitmapColorMode,
    ImageEncoder,
    PacketGenerator,
    PageColorType,
    RequestCommandId,
} from '@mmote/niimbluelib';
import { installCanvasShim } from '../test/canvasHarness';
import { createLabelDoc } from '../core/doc/factory';
import type { LabelDoc, Node, Region } from '../core/doc/types';
import { buildCsvPrintJob } from './printLabel';
import type { PrintJob, PrintPage } from './transport';

/**
 * P5 wave B — pins the niimbluelib double-colour contract this app depends on.
 *
 * The red/black render path (wave A) emits **exact** `#ffffff` / `#000000` /
 * `#ff0000` pixels. The library then splits them: `0xff0000` → red plane,
 * anything else non-white → black plane, white → neither. The row packet is
 * command 138 (`PrintBitmapRowDoubleColor`), whose payload is
 * `[Mixed, pos, repeats, mask…, colour…]` — note the **missing 133**
 * (`PrintBitmapRow`) sub-command byte that the single-colour path carries.
 *
 * These tests exist so a dependency bump that changes either half fails loudly
 * here instead of shipping a wrongly-coloured page to hardware.
 */

beforeAll(() => {
    installCanvasShim();
});

const DPI = 254;
/** 1000×500 hm @254 dpi → a 100×50 px page (same fixture scale as the P5 suites). */
const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }];

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const rectNode = (id: string, x: number, fill: string): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y: 50, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 400, h: 400 },
        fill,
        stroke: 'transparent',
    });

/** A page with one red rect (left) and one black rect (right), white in between. */
const redBlackDoc = (): LabelDoc =>
    createLabelDoc({
        backingW: 1000,
        backingH: 500,
        dpi: DPI,
        regions,
        nodes: [rectNode('red', 0, '#ff0000'), rectNode('black', 600, '#000000')],
    });

const collectPages = async (job: PrintJob): Promise<PrintPage[]> => {
    const pages: PrintPage[] = [];
    for await (const page of job.pages) {
        pages.push(page);
    }
    return pages;
};

const bytesOf = (data: Uint8Array | undefined): number[] =>
    data === undefined ? [] : Array.from(data);

describe('double-colour encoder split (ImageEncoder)', () => {
    it('sends exact red to rowDataRed, exact black to rowDataBlack and white to neither', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('test canvas has no 2D context');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 8, 1);
        ctx.fillStyle = '#000000';
        ctx.fillRect(1, 0, 1, 1);
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(2, 0, 1, 1);

        const encoded = ImageEncoder.encodeCanvas(canvas, PageColorType.DoubleColor, 'top');

        expect(encoded.pageColor).toBe(PageColorType.DoubleColor);
        expect(encoded.cols).toBe(8);
        expect(encoded.rows).toBe(1);

        const row = encoded.rowsData[0]!;
        expect(row.dataType).toBe('pixels');
        // Bit 0 = col 1 (black), bit 1 = col 2 (red); every other bit is white.
        expect(bytesOf(row.rowDataBlack)).toEqual([0b0100_0000]);
        expect(bytesOf(row.rowDataRed)).toEqual([0b0010_0000]);
        expect(row.blackPixelsCount).toBe(1);
        expect(row.redPixelsCount).toBe(1);
    });
});

describe('double-colour row packet (PacketGenerator)', () => {
    /**
     * Byte layout this app relies on. niim.blue 2026.9.0 ships dual-colour on
     * this exact path (hardware mileage), so we use the library as-is rather
     * than patch it. **A dependency bump must re-check these bytes**; if 133
     * reappears (as in the single-colour `printBitmapRowWithColor` wrapper) the
     * payload shape changed and printing red/black will be wrong.
     */
    it('emits command 138 as [Mixed, pos, repeats, mask…, colour…] without the 133 byte', () => {
        const black = new Uint8Array([0b1010_1010]);
        const red = new Uint8Array([0b0000_1111]);

        const packet = PacketGenerator.printBitmapRowDoubleColor(black, red, 0x1234, 2, 8);
        const data = Array.from(packet.data);

        expect(packet.command).toBe(RequestCommandId.PrintBitmapRowDoubleColor);
        expect(packet.command).toBe(138);
        expect(data).toEqual([
            BitmapColorMode.Mixed, // 3 — both inks in this row
            0x12, // pos high byte (u16ToBytes is big-endian)
            0x34, // pos low byte
            2, // repeats
            0xaf, // mask: black | red, bit set = any ink
            0x0f, // colour: bit set = red ink
        ]);
        // The niim.blue-proven double-colour path has no 133 sub-command byte
        // (unlike `printBitmapRowWithColor` below). Pinned deliberately.
        expect(data).not.toContain(RequestCommandId.PrintBitmapRow);
    });

    it('appends all masks, then all colour bytes, in octet order', () => {
        const black = new Uint8Array([0b1000_0000, 0b0000_0000]);
        const red = new Uint8Array([0b0000_0000, 0b0000_0001]);

        const packet = PacketGenerator.printBitmapRowDoubleColor(black, red, 0x0102, 1, 16);

        // One mask byte per octet (0x80, 0x01); colour bytes follow the whole
        // mask run and are emitted for every non-zero mask block (0x00, 0x01).
        expect(Array.from(packet.data)).toEqual([
            BitmapColorMode.Mixed,
            0x01,
            0x02,
            1,
            0x80,
            0x01,
            0x00,
            0x01,
        ]);
    });

    it('keeps the 133 byte on the single-colour wrapper (contrast for the pin above)', () => {
        const packet = PacketGenerator.printBitmapRowWithColor(
            0x1234,
            2,
            new Uint8Array([0b1010_1010]),
            BitmapColorMode.Black,
        );

        const data = Array.from(packet.data);
        expect(packet.command).toBe(RequestCommandId.PrintBitmapRowDoubleColor);
        expect(data.slice(0, 5)).toEqual([
            BitmapColorMode.Black,
            RequestCommandId.PrintBitmapRow, // 133 — present here, absent above
            0x12,
            0x34,
            2,
        ]);
    });
});

describe('double-colour print job', () => {
    it('carries DoubleColor end to end and the encoded planes carry red content', async () => {
        const job = buildCsvPrintJob(redBlackDoc(), null, {
            order: 'grouped',
            copies: 1,
            overrides: { pageColor: PageColorType.DoubleColor },
        });

        expect(job.pageColor).toBe(PageColorType.DoubleColor);

        const pages = await collectPages(job);
        expect(pages).toHaveLength(1);
        const data = pages[0]!.data;
        expect(data.pageColor).toBe(job.pageColor);

        const pixelRows = data.rowsData.filter((row) => row.dataType === 'pixels');
        const redRows = pixelRows.filter((row) =>
            bytesOf(row.rowDataRed).some((byte) => byte !== 0),
        );
        const blackRows = pixelRows.filter((row) =>
            bytesOf(row.rowDataBlack).some((byte) => byte !== 0),
        );

        // Both inks reached the encoder: red lives in the red plane, black in
        // the black plane (the page has one rect of each).
        expect(redRows.length).toBeGreaterThan(0);
        expect(blackRows.length).toBeGreaterThan(0);
        expect(
            pixelRows.some((row) => (row.redPixelsCount ?? 0) > 0),
        ).toBe(true);

        // The red plane is real content, not a copy of the black plane: a row
        // crossing both rects has different bits in the two planes.
        expect(
            redRows.some((row) => {
                const black = bytesOf(row.rowDataBlack);
                const red = bytesOf(row.rowDataRed);
                return black.some((byte, index) => byte !== (red[index] ?? 0));
            }),
        ).toBe(true);
    });
});
