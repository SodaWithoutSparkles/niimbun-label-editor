// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { installCanvasShim } from '../../test/canvasHarness';
import { renderLabelPage } from './renderLabelPage';

/**
 * P8 — the D-77 printhead-width clamp.
 *
 * A red/black page wider than the printhead loses the packet tail, so the
 * dialog crops the raster on the **head axis** (width for `top`/`bottom`,
 * height for `left`/`right`, exactly like `printheadOverflow`). The crop is an
 * exact 1:1 copy, left/top aligned: no resampling, no re-quantization, and the
 * kept pixels must be byte-identical to the uncropped render.
 *
 * Fixtures are 100×50 px at 254 dpi (1000×500 hm), as in the grayscale suite:
 * small and deterministic (D-23).
 */

beforeAll(() => {
    installCanvasShim();
});

const DPI = 254;
const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }];

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
        fill: '#000000',
        stroke: 'transparent',
    });

const docWith = (
    nodes: Node[],
    direction: LabelDoc['label']['printDirection'] = 'top',
): LabelDoc =>
    createLabelDoc({
        backingW: 1000,
        backingH: 500,
        dpi: DPI,
        printDirection: direction,
        regions,
        nodes,
    });

/** `limitPx` at 254 dpi is `hm * 254 / 2540` = `hm / 10`. */
const sizeOf = (hm: number): number => hm / 10;

const rgbAt = (
    rgba: { data: Uint8ClampedArray; width: number },
    x: number,
    y: number,
): number[] => {
    const index = (y * rgba.width + x) * 4;
    return Array.from(rgba.data.slice(index, index + 4));
};

/**
 * Assert `cropped` is exactly the kept region (left columns or top rows) of
 * `full`, row by row — a byte comparison, so no resampling can hide in it.
 */
const expectExactSlice = (
    cropped: { data: Uint8ClampedArray; width: number; height: number },
    full: { data: Uint8ClampedArray; width: number; height: number },
): void => {
    for (let y = 0; y < cropped.height; y++) {
        const source = full.data.subarray(
            y * full.width * 4,
            y * full.width * 4 + cropped.width * 4,
        );
        const kept = cropped.data.subarray(y * cropped.width * 4, (y + 1) * cropped.width * 4);
        expect(Array.from(kept)).toEqual(Array.from(source));
    }
};

describe('renderLabelPage — maxHeadHm (D-77 head clamp)', () => {
    it('crops the width (top/bottom) and keeps the left columns byte-identically', async () => {
        // Ink left of the cut and ink right of it: the second block must vanish,
        // proving the crop is left-aligned rather than a rescale or centre crop.
        const doc = docWith([
            rect('left', 0, 0, 200, 500),
            rect('right', 800, 0, 200, 500),
        ]);
        const full = await renderLabelPage(doc, {}, {});
        const cropped = await renderLabelPage(doc, {}, { maxHeadHm: 600 });

        expect(full.widthPx).toBe(100);
        expect(full.heightPx).toBe(50);
        expect(cropped.widthPx).toBe(sizeOf(600));
        expect(cropped.widthPx).toBe(60);
        expect(cropped.heightPx).toBe(50);
        expect(cropped.canvas.width).toBe(60);
        expect(cropped.canvas.height).toBe(50);

        expectExactSlice(cropped.rgba, full.rgba);
        // The ink that sat past the head is gone; the kept columns still ink.
        expect(rgbAt(cropped.rgba, 5, 25)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(full.rgba, 85, 25)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(cropped.rgba, 59, 25)).toEqual([255, 255, 255, 255]);
    });

    it('crops the height (left/right) and keeps the top rows byte-identically', async () => {
        const doc = docWith(
            [rect('top', 0, 0, 1000, 200), rect('bottom', 0, 400, 1000, 100)],
            'left',
        );
        const full = await renderLabelPage(doc, {}, {});
        const cropped = await renderLabelPage(doc, {}, { maxHeadHm: 300 });

        expect(full.widthPx).toBe(100);
        expect(full.heightPx).toBe(50);
        expect(cropped.widthPx).toBe(100);
        expect(cropped.heightPx).toBe(sizeOf(300));
        expect(cropped.heightPx).toBe(30);
        expect(cropped.canvas.width).toBe(100);
        expect(cropped.canvas.height).toBe(30);

        expectExactSlice(cropped.rgba, full.rgba);
        // Top ink kept, bottom ink cropped away.
        expect(rgbAt(cropped.rgba, 50, 5)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(full.rgba, 50, 45)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(cropped.rgba, 0, 29)).toEqual([255, 255, 255, 255]);
    });

    it('applies the crop after the offset stage too (both return paths)', async () => {
        const doc = docWith([rect('left', 0, 0, 200, 500)]);
        const offset = { x: 10, y: 5, type: 'outer' as const };

        const full = await renderLabelPage(doc, {}, { offset });
        const cropped = await renderLabelPage(doc, {}, { offset, maxHeadHm: 600 });

        // `outer` grows the base 100×50 to 110×55; the clamp then crops the
        // composed raster, not the pre-offset one.
        expect(full.widthPx).toBe(110);
        expect(full.heightPx).toBe(55);
        expect(cropped.widthPx).toBe(60);
        expect(cropped.heightPx).toBe(55);
        expect(cropped.canvas.width).toBe(60);
        expect(cropped.canvas.height).toBe(55);

        expectExactSlice(cropped.rgba, full.rgba);
        // The offset shifted the ink right by 10 px; the crop starts at x = 0.
        expect(rgbAt(cropped.rgba, 15, 25)).toEqual([0, 0, 0, 255]);
        expect(rgbAt(cropped.rgba, 0, 25)).toEqual([255, 255, 255, 255]);
    });

    it('returns the canvas pixels that match the cropped rgba', async () => {
        const doc = docWith([rect('left', 0, 0, 200, 500)]);
        const page = await renderLabelPage(doc, {}, { maxHeadHm: 600 });

        const context = page.canvas.getContext('2d');
        if (!context) throw new Error('test: no 2D context');
        const canvasPixels = context.getImageData(0, 0, 60, 50);
        expect(Array.from(canvasPixels.data)).toEqual(Array.from(page.rgba.data));
    });

    it('leaves the raster byte-identical when absent or already fitting', async () => {
        const doc = docWith([rect('left', 0, 0, 500, 500)]);
        const plain = await renderLabelPage(doc, {}, {});
        const absent = await renderLabelPage(doc, {}, { dpi: DPI });
        // A head wider than the page must take the no-op branch: same bytes.
        const fitting = await renderLabelPage(doc, {}, { maxHeadHm: 2000 });

        expect(Array.from(absent.rgba.data)).toEqual(Array.from(plain.rgba.data));
        expect(Array.from(fitting.rgba.data)).toEqual(Array.from(plain.rgba.data));
        expect(fitting.widthPx).toBe(plain.widthPx);
        expect(fitting.heightPx).toBe(plain.heightPx);
    });

    it('rejects an invalid maxHeadHm with RangeError', async () => {
        const doc = docWith([]);

        for (const maxHeadHm of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(renderLabelPage(doc, {}, { maxHeadHm })).rejects.toThrow(RangeError);
        }
        // Positive but narrower than one device dot at this dpi.
        await expect(renderLabelPage(doc, {}, { maxHeadHm: 0.1 })).rejects.toThrow(RangeError);
    });
});
