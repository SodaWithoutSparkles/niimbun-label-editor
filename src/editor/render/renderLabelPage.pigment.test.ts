// @vitest-environment happy-dom
import { ImageEncoder } from '@mmote/niimbluelib';
import { beforeAll, describe, expect, it } from 'vitest';
import { GRAYSCALE_LEVELS, grayLevelColor, type RgbaBuffer } from '../../core/render';
import { installCanvasShim } from '../../test/canvasHarness';
import { countInkPx, invertRgb } from './renderLabelPage';

/**
 * P2 — pigment-safe post-quantize helpers.
 *
 * `countInkPx` and `invertRgb` run **after** quantization, so their whole input
 * domain is exact palette colours (black, a grey-ramp level, `#ff0000`). These
 * goldens pin the two latent mono-only assumptions fixed in P2:
 *
 *  - ink is anything that is not paper-white, not "red < 128";
 *  - invert is a luminance inversion that keeps hue, not a per-channel flip
 *    (which would turn red into the unprintable cyan).
 *
 * No rendering happens here: plain `RgbaBuffer`s keep the file headless and
 * deterministic. The `happy-dom` environment and the canvas shim only exist
 * because importing `renderLabelPage` pulls in Konva.
 */

beforeAll(() => {
    installCanvasShim();
});

/** Build a 1-row buffer from `[r, g, b, a]` pixels. */
const bufferOf = (pixels: readonly (readonly [number, number, number, number])[]): RgbaBuffer => {
    const data = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach(([r, g, b, a], p) => {
        data[p * 4] = r;
        data[p * 4 + 1] = g;
        data[p * 4 + 2] = b;
        data[p * 4 + 3] = a;
    });
    return { data, width: pixels.length, height: 1 };
};

/** The `[r, g, b, a]` bytes of pixel `index`. */
const pixelAt = (rgba: RgbaBuffer, index: number): number[] =>
    Array.from(rgba.data.slice(index * 4, index * 4 + 4));

const inkOf = (r: number, g: number, b: number): number => countInkPx(bufferOf([[r, g, b, 255]]));

describe('countInkPx — post-quantize paper test', () => {
    it('counts black, red and a grey ramp level as ink, but not white', () => {
        const grey = grayLevelColor(1);
        // Individual pixels, so a failure names the colour that broke.
        expect(inkOf(0, 0, 0), 'black').toBe(1);
        expect(inkOf(255, 0, 0), 'red').toBe(1);
        expect(inkOf(grey, grey, grey), `grey level 1 (${grey})`).toBe(1);
        expect(inkOf(255, 255, 255), 'paper white').toBe(0);

        // And the count accumulates across a palette row.
        expect(
            countInkPx(
                bufferOf([
                    [0, 0, 0, 255],
                    [255, 0, 0, 255],
                    [grey, grey, grey, 255],
                    [255, 255, 255, 255],
                ]),
            ),
        ).toBe(3);
    });

    it('ignores alpha: transparent red still counts, opaque white does not', () => {
        // Ink is a colour decision, never an opacity decision.
        expect(countInkPx(bufferOf([[255, 0, 0, 0]]))).toBe(1);
        expect(countInkPx(bufferOf([[255, 255, 255, 255]]))).toBe(0);
    });
});

describe('invertRgb — luminance inversion that keeps hue', () => {
    it('maps black → white, white → black, 128 grey → 127, and preserves alpha', () => {
        const rgba = bufferOf([
            [0, 0, 0, 7],
            [255, 255, 255, 255],
            [128, 128, 128, 0],
        ]);

        invertRgb(rgba);

        expect(pixelAt(rgba, 0), 'black + alpha 7').toEqual([255, 255, 255, 7]);
        expect(pixelAt(rgba, 1), 'white + alpha 255').toEqual([0, 0, 0, 255]);
        expect(pixelAt(rgba, 2), 'mid grey + alpha 0').toEqual([127, 127, 127, 0]);
    });

    it('keeps red in the red family and never produces cyan', () => {
        const red = bufferOf([[255, 0, 0, 255]]);
        invertRgb(red);
        expect(pixelAt(red, 0)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(red, 0)).not.toEqual([0, 255, 255, 255]);

        // A darker red scales up to the same printable red (R clamps at 255).
        const darkRed = bufferOf([[128, 0, 0, 255]]);
        invertRgb(darkRed);
        expect(pixelAt(darkRed, 0)).toEqual([255, 0, 0, 255]);
    });

    it('inverts the 16-level grayscale ramp exactly: level k → 15 - k', () => {
        for (let k = 0; k < GRAYSCALE_LEVELS; k++) {
            const centre = grayLevelColor(k);
            const rgba = bufferOf([[centre, centre, centre, 255]]);

            invertRgb(rgba);

            const [r, g, b, a] = pixelAt(rgba, 0);
            expect(g, `level ${k} stays neutral`).toBe(r);
            expect(b, `level ${k} stays neutral`).toBe(r);
            expect(a, `level ${k} alpha untouched`).toBe(255);
            // The printer maps the inverted centre back to the mirrored level:
            // an authored grayscale negative is exact, not approximated.
            expect(
                ImageEncoder.colorToGrayLevel((r << 16) | (r << 8) | r),
                `level ${k} → ${15 - k}`,
            ).toBe(15 - k);
        }
    });
});
