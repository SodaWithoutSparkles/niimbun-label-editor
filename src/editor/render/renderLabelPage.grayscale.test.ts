// @vitest-environment happy-dom
import { ImageEncoder, PageColorType } from '@mmote/niimbluelib';
import type { EncodedImage } from '@mmote/niimbluelib';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import { grayLevelColor, type RgbaBuffer } from '../../core/render';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { installCanvasShim } from '../../test/canvasHarness';
import { renderLabelPage } from './renderLabelPage';

/**
 * P3 wave A — grayscale page colour end to end through the shared render path.
 *
 * A grayscale page skips the per-object 1-bit policy mask and `quantizeRgba`;
 * it runs the 16-level ramp diffuser on the tone-mapped raster instead. These
 * tests pin the externally visible consequences:
 *
 *  - an authored band-centre grey survives exactly (no dither speckle);
 *  - a mid grey *is* dithered (both neighbours appear), proving the diffuser
 *    runs rather than a point op;
 *  - the raster stays opaque, so an empty document prints level 0 (white), not
 *    the encoder's transparent→black trap;
 *  - the encoder's nibble order, `0 = white / 15 = black`, and ×8 padding match
 *    the ramp the render writes;
 *  - the mono path is untouched and byte-identical.
 *
 * Fixtures stay small (100×50 px at 254 dpi): the real-canvas suites flake under
 * parallel load (tech debt D-23), and the diffusion pattern is fully
 * deterministic at this size.
 */

beforeAll(() => {
    installCanvasShim();
});

const DPI = 254;
/** 1000×500 hm @254 dpi → a 100×50 px page (0.1 hm/px). */
const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }];

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

/** A flat opaque rectangle filling the page height (no default ink stroke). */
const rect = (id: string, x: number, w: number, fill: string): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w, h: 500 },
        fill,
        stroke: 'transparent',
    });

const docWith = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 1000, backingH: 500, dpi: DPI, regions, nodes });

const pixelAt = (rgba: RgbaBuffer, x: number, y: number): number[] => {
    const index = (y * rgba.width + x) * 4;
    return Array.from(rgba.data.slice(index, index + 4));
};

/** Count pixels whose RGB equals the given exact grey. */
const countGrey = (rgba: RgbaBuffer, value: number): number => {
    let count = 0;
    for (let i = 0; i < rgba.data.length; i += 4) {
        if (rgba.data[i] === value && rgba.data[i + 1] === value && rgba.data[i + 2] === value) {
            count++;
        }
    }
    return count;
};

/**
 * Decode the level the encoder wrote for pixel `(x, y)` in the `'top'`
 * direction. Identical rows merge into runs (`repeat`), so walk the run list
 * instead of indexing `rowsData[y]`. Void (all-white) rows and the ×8 padding
 * columns decode to 0.
 */
const levelAt = (data: EncodedImage, x: number, y: number): number => {
    let offset = y;
    for (const row of data.rowsData) {
        if (row.dataType === 'check') continue;
        if (offset >= row.repeat) {
            offset -= row.repeat;
            continue;
        }
        if (row.dataType === 'void') return 0;
        const byte = row.rowDataGray![x >> 1]!;
        return (x & 1) === 0 ? byte >> 4 : byte & 0xf;
    }
    throw new Error(`no encoded row for y=${y}`);
};

describe('renderLabelPage — grayscale page colour', () => {
    it('keeps an exact ramp level exactly, and leaves the background white', async () => {
        // 238 is level 1's band centre: 255 - 17 * 1.
        const page = await renderLabelPage(
            docWith([rect('r', 0, 400, '#eeeeee')]),
            {},
            { pageColor: 'grayscale' },
        );

        expect(pixelAt(page.rgba, 20, 25)).toEqual([238, 238, 238, 255]);
        expect(pixelAt(page.rgba, 80, 25)).toEqual([255, 255, 255, 255]);
        // Opacity is a raster invariant: the encoder reads RGB only, but a
        // transparent pixel would mean the rasterizer stopped painting paper.
        for (let i = 3; i < page.rgba.data.length; i += 4) {
            expect(page.rgba.data[i]).toBe(255);
        }
    });

    it('does not diffuse exact ramp values: the rect interior is one flat grey', async () => {
        const page = await renderLabelPage(
            docWith([rect('r', 0, 400, '#eeeeee')]),
            {},
            { pageColor: 'grayscale' },
        );

        // Sample several interior points, away from the antialiased edge.
        for (const y of [5, 25, 44]) {
            for (const x of [2, 10, 20, 30, 38]) {
                expect(pixelAt(page.rgba, x, y), `(${x},${y})`).toEqual([238, 238, 238, 255]);
            }
        }
    });

    it('dithers a mid grey across its two neighbouring levels', async () => {
        // Native 128 sits between level 7 (136) and level 8 (119).
        const page = await renderLabelPage(
            docWith([rect('r', 0, 1000, '#808080')]),
            {},
            { pageColor: 'grayscale' },
        );

        expect(countGrey(page.rgba, grayLevelColor(7))).toBeGreaterThan(0);
        expect(countGrey(page.rgba, grayLevelColor(8))).toBeGreaterThan(0);
    });

    it('keeps an empty page opaque white (level 0), never the transparent-black trap', async () => {
        const page = await renderLabelPage(docWith([]), {}, { pageColor: 'grayscale' });

        // No background node: the rasterizer's white paper is the only fill.
        for (let i = 0; i < page.rgba.data.length; i += 4) {
            expect(Array.from(page.rgba.data.slice(i, i + 4)), `pixel ${i / 4}`).toEqual([
                255, 255, 255, 255,
            ]);
        }
    });

    it('encodes the ramp as high-nibble-first levels with ×8 column padding', () => {
        // Source 3×4: column 0 (top→bottom) = levels 15,7,1,0. `encodeCanvas(…,
        // 'left')` rotates 90° clockwise, so output row 0 = source column 0 read
        // bottom→top = the intended [0,1,7,15]. Columns 1 and 2 stay white and
        // become identical void rows.
        const canvas = document.createElement('canvas');
        canvas.width = 3;
        canvas.height = 4;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 3, 4);
        const levels = [15, 7, 1, 0];
        levels.forEach((level, y) => {
            const value = grayLevelColor(level);
            ctx.fillStyle = `rgb(${value},${value},${value})`;
            ctx.fillRect(0, y, 1, 1);
        });

        const data = ImageEncoder.encodeCanvas(canvas, PageColorType.Grayscale, 'left');

        // 4 source rows pad to a multiple of 8 columns; 3 source columns = 3 rows.
        expect(data.cols).toBe(8);
        expect(data.rows).toBe(3);

        const firstRow = data.rowsData[0]!;
        expect(firstRow.dataType).toBe('pixels');
        expect(firstRow.repeat).toBe(1);
        expect(firstRow.rowDataGray).toBeDefined();

        // Decode two 4-bit levels per byte, high nibble first.
        const bytes = Array.from(firstRow.rowDataGray!);
        expect(bytes).toEqual([0x01, 0x7f, 0x00, 0x00]);
        const decoded = bytes.flatMap((byte) => [byte >> 4, byte & 0xf]);
        expect(decoded).toEqual([0, 1, 7, 15, 0, 0, 0, 0]);

        // An all-white row is void, and two identical rows merge into one run.
        expect(data.rowsData[1]!.dataType).toBe('void');
        expect(data.rowsData[1]!.repeat).toBe(2);
        expect(data.rowsData).toHaveLength(2);
    });

    it('encodes rendered grayscale output level-for-level through the real encoder', async () => {
        // Same fixture as the first test: a level-1 grey rect on white paper.
        const page = await renderLabelPage(
            docWith([rect('r', 0, 400, '#eeeeee')]),
            {},
            { pageColor: 'grayscale' },
        );

        const data = ImageEncoder.encodeCanvas(page.canvas, PageColorType.Grayscale, 'top');

        // 100 source columns pad to the next multiple of 8; 'top' keeps the axes.
        expect(data.cols).toBe(104);
        expect(data.rows).toBe(50);

        // Spot checks first, so a broken loop still fails readably.
        expect(levelAt(data, 20, 25), '(20,25) rect interior').toBe(1);
        expect(levelAt(data, 80, 25), '(80,25) background').toBe(0);

        // Every sampled pixel must decode to the level the render actually wrote.
        // x stays under page.widthPx, so the 104-column padding is never sampled.
        for (let y = 0; y < page.heightPx; y += 3) {
            for (let x = 0; x < page.widthPx; x += 3) {
                const v = page.rgba.data[(y * page.widthPx + x) * 4]!;
                const expected = ImageEncoder.colorToGrayLevel((v << 16) | (v << 8) | v);
                expect(levelAt(data, x, y), `(${x},${y})`).toBe(expected);
            }
        }
    });

    it('leaves the mono path byte-identical and 1-bit', async () => {
        const doc = docWith([rect('r', 0, 1000, '#808080')]);
        const absent = await renderLabelPage(doc);
        const explicitMono = await renderLabelPage(doc, {}, { pageColor: 'mono' });

        expect(Array.from(explicitMono.rgba.data)).toEqual(Array.from(absent.rgba.data));
        // Mono still quantizes to exact black/white channels.
        for (const byte of absent.rgba.data) {
            expect(byte === 0 || byte === 255).toBe(true);
        }
    });

    it('rejects redBlack until P5 implements it', async () => {
        await expect(
            renderLabelPage(docWith([]), {}, { pageColor: 'redBlack' }),
        ).rejects.toThrow(RangeError);
        await expect(
            renderLabelPage(docWith([]), {}, { pageColor: 'redBlack' }),
        ).rejects.toThrow(/not implemented yet/);
    });
});
