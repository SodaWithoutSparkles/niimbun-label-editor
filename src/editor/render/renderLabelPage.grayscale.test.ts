// @vitest-environment happy-dom
import { ImageEncoder, PageColorType } from '@mmote/niimbluelib';
import type { EncodedImage } from '@mmote/niimbluelib';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import { grayLevelColor, type RgbaBuffer } from '../../core/render';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { installCanvasShim } from '../../test/canvasHarness';
import { renderLabelPage, invertRgb } from './renderLabelPage';

/**
 * P3 wave A — grayscale page colour end to end through the shared render path.
 *
 * A grayscale page skips the per-object 1-bit policy mask and `quantizeRgba`;
 * it diffuses the raster's BT.601 luminance as one scalar plane through the
 * 16-level ramp instead. These tests pin the externally visible consequences:
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

    it('renders a saturated red fill at its own level, not a dark blob', async () => {
        // REGRESSION (P9 wave A): #c8281e = (200, 40, 30), BT.601 luminance
        // ≈86.7 → level 10 (85). The old RGB-vector diffuser clipped the chroma
        // residual and collapsed the field to level 11 (68); scalar luminance
        // diffusion keeps the interior on level 10 with its adjacent-level
        // dither and never darkens past it.
        const page = await renderLabelPage(
            docWith([rect('r', 0, 800, '#c8281e')]),
            {},
            { pageColor: 'grayscale' },
        );

        let count10 = 0;
        let count9 = 0;
        for (let y = 6; y < 44; y++) {
            for (let x = 5; x < 75; x++) {
                const value = page.rgba.data[(y * page.widthPx + x) * 4]!;
                if (value === grayLevelColor(10)) count10++;
                else if (value === grayLevelColor(9)) count9++;
                else {
                    expect.fail(`interior pixel (${x},${y}) is not level 9 or 10: ${value}`);
                }
            }
        }
        expect(count10).toBeGreaterThan(count9 * 5);
    });

    it('does not bleed ink outside a black shape on a band-limited page', async () => {
        // REGRESSION (phase 3, bug 2). The default band 4..14 has no level-0
        // (black) entry, so the diffuser used to keep a -17 residual on an
        // authored black and pushed it into the white surround: 186 px of ink
        // landed outside the rect. The engine now clamps the scalar plane at the
        // band's darkest ink, so authored black prints level 14 and nothing
        // spreads. x = 200 hm @254 dpi = px 20; w = 600 hm = 60 px.
        const page = await renderLabelPage(
            docWith([rect('r', 200, 600, '#000000')]),
            {},
            { pageColor: 'grayscale', grayscaleTone: { minLevel: 4, maxLevel: 14 } },
        );

        for (let y = 0; y < page.heightPx; y++) {
            for (let x = 0; x < page.widthPx; x++) {
                if (x >= 20 && x < 80) continue;
                expect(pixelAt(page.rgba, x, y)[0], `(${x},${y}) outside the rect`).toBe(255);
            }
        }
        expect(pixelAt(page.rgba, 50, 25)).toEqual([
            grayLevelColor(14),
            grayLevelColor(14),
            grayLevelColor(14),
            255,
        ]);
    });

    it('inverts the band as an ordinal reversal, so paper and ink stay distinct', async () => {
        // REGRESSION (phase 3, bug 3 review). A full-ramp invert mapped paper
        // (level 0) to level 15, outside a 4..8 band. The band is reversed as
        // an **ordered set** — paper, 4, 5, 6, 7, 8 — so paper ↔ 8, 4 ↔ 7,
        // 5 ↔ 6. A level-arithmetic clamp is not enough: for a degenerate band
        // it collapses every pixel to one level.
        const page = await renderLabelPage(
            docWith([
                rect('black', 0, 200, '#000000'), // renders at the band floor, level 8
                rect('grey6', 300, 200, '#999999'), // exact level-6 centre (153)
            ]),
            {},
            { pageColor: 'grayscale', grayscaleTone: { minLevel: 4, maxLevel: 8 }, invert: true },
        );

        // Every emitted pixel is paper or an in-band level: the reversed set
        // is {paper, 4, 5, 6, 7, 8}.
        for (let y = 0; y < page.heightPx; y++) {
            for (let x = 0; x < page.widthPx; x++) {
                const [r, g, b] = pixelAt(page.rgba, x, y);
                expect([g, b], `(${x},${y}) is neutral`).toEqual([r, r]);
                const level = (255 - r) / 17;
                expect(Number.isInteger(level), `(${x},${y}) is a ramp level`).toBe(true);
                expect(
                    level === 0 || (level >= 4 && level <= 8),
                    `(${x},${y}) level ${level}`,
                ).toBe(true);
            }
        }
        // Paper (level 0) ↔ the darkest allowed level 8.
        expect(pixelAt(page.rgba, 80, 25)[0]).toBe(grayLevelColor(8));
        // Level-6 grey → its ordinal partner, level 5.
        expect(pixelAt(page.rgba, 40, 25)[0]).toBe(grayLevelColor(5));
        // The authored black rendered at level 8 → paper.
        expect(pixelAt(page.rgba, 10, 25)[0]).toBe(255);
    });

    it('keeps a degenerate 4/4 band visible when inverted', async () => {
        // REGRESSION (phase 3, bug 3 review). With the old level clamp,
        // `lowest === highest` mapped every level (paper included) to 4, so the
        // inverted page was a flat level-4 sheet and the design vanished.
        // Reversing ordinals over {paper, 4} swaps the two states instead:
        // paper → 4, ink → paper.
        const page = await renderLabelPage(
            docWith([rect('r', 0, 400, '#000000')]),
            {},
            { pageColor: 'grayscale', grayscaleTone: { minLevel: 4, maxLevel: 4 }, invert: true },
        );

        // Both states are present: the inverted ink is paper and the paper is
        // the single allowed ink level.
        expect(countGrey(page.rgba, 255)).toBeGreaterThan(0);
        expect(countGrey(page.rgba, grayLevelColor(4))).toBeGreaterThan(0);
        expect(pixelAt(page.rgba, 20, 25)[0]).toBe(255);
        expect(pixelAt(page.rgba, 80, 25)[0]).toBe(grayLevelColor(4));
    });

    it('keeps the full-ramp invert byte-identical to the legacy luminance invert', async () => {
        // The full 0..15 ramp reverses to `k → 15 - k` (paper → 15), so the
        // band-aware path must reproduce `invertRgb` byte for byte. This pins
        // that the band branch did not change the default-ramp grayscale page.
        const doc = docWith([
            rect('r', 0, 400, '#eeeeee'),
            rect('m', 500, 300, '#808080'),
        ]);
        const plain = await renderLabelPage(doc, {}, { pageColor: 'grayscale' });
        const inverted = await renderLabelPage(doc, {}, { pageColor: 'grayscale', invert: true });

        const legacy: RgbaBuffer = {
            width: plain.rgba.width,
            height: plain.rgba.height,
            data: new Uint8ClampedArray(plain.rgba.data),
        };
        invertRgb(legacy);

        expect(Array.from(inverted.rgba.data)).toEqual(Array.from(legacy.data));
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
});
