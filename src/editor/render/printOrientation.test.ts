import { beforeAll, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import type { RenderedLabelPage } from './renderLabelPage';
import { orientForPrint, preRotationDegrees, encoderDirection, printheadOverflow } from './printOrientation';

beforeAll(() => {
    installCanvasShim();
});

const makePage = (canvas: HTMLCanvasElement): RenderedLabelPage => ({
    canvas,
    widthPx: canvas.width,
    heightPx: canvas.height,
    rgba: {
        data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
        width: canvas.width,
        height: canvas.height,
    },
});

const pixelAt = (canvas: HTMLCanvasElement, x: number, y: number): number[] => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('test: canvas has no 2D context');
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
};

/** 4×2 white canvas with a red (0,0) and a blue (3,1) corner marker. */
const markerCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 4, 2);
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgb(0,0,255)';
    ctx.fillRect(3, 1, 1, 1);
    return canvas;
};

describe('preRotationDegrees / encoderDirection', () => {
    it('pre-rotates only bottom and right (180°)', () => {
        expect(preRotationDegrees('top')).toBe(0);
        expect(preRotationDegrees('left')).toBe(0);
        expect(preRotationDegrees('bottom')).toBe(180);
        expect(preRotationDegrees('right')).toBe(180);
    });

    it('maps the four-way direction onto the encoder two-value direction', () => {
        expect(encoderDirection('top')).toBe('top');
        expect(encoderDirection('bottom')).toBe('top');
        expect(encoderDirection('left')).toBe('left');
        expect(encoderDirection('right')).toBe('left');
    });
});

describe('orientForPrint', () => {
    it('top/left send the raster unrotated (same canvas reference)', () => {
        const page = makePage(markerCanvas());
        const top = orientForPrint(page, 'top');
        expect(top.direction).toBe('top');
        expect(top.canvas).toBe(page.canvas);

        const left = orientForPrint(page, 'left');
        expect(left.direction).toBe('left');
        expect(left.canvas).toBe(page.canvas);
    });

    it('bottom pre-rotates 180° onto a fresh canvas and encodes top', () => {
        const page = makePage(markerCanvas());
        const { canvas, direction } = orientForPrint(page, 'bottom');
        expect(direction).toBe('top');
        expect(canvas).not.toBe(page.canvas);

        // (0,0) red and (3,1) blue swap corners under 180°.
        expect(pixelAt(canvas, 3, 1).slice(0, 3)).toEqual([255, 0, 0]);
        expect(pixelAt(canvas, 0, 0).slice(0, 3)).toEqual([0, 0, 255]);
    });

    it('right pre-rotates 180° onto a fresh canvas and encodes left', () => {
        const page = makePage(markerCanvas());
        const { canvas, direction } = orientForPrint(page, 'right');
        expect(direction).toBe('left');
        expect(canvas).not.toBe(page.canvas);
        expect(pixelAt(canvas, 3, 1).slice(0, 3)).toEqual([255, 0, 0]);
        expect(pixelAt(canvas, 0, 0).slice(0, 3)).toEqual([0, 0, 255]);
    });

    it('never mutates the input canvas', () => {
        const source = markerCanvas();
        const before = Array.from(source.getContext('2d')!.getImageData(0, 0, 4, 2).data);
        orientForPrint(makePage(source), 'bottom');
        orientForPrint(makePage(source), 'right');
        const after = Array.from(source.getContext('2d')!.getImageData(0, 0, 4, 2).data);
        expect(after).toEqual(before);
    });
});

describe('printheadOverflow', () => {
    it('compares widthPx for top/bottom', () => {
        expect(printheadOverflow(600, 100, 'top', 567)).toBe(true);
        expect(printheadOverflow(600, 100, 'bottom', 567)).toBe(true);
        expect(printheadOverflow(500, 100, 'top', 567)).toBe(false);
    });

    it('swaps to heightPx for left/right', () => {
        expect(printheadOverflow(600, 100, 'left', 567)).toBe(false);
        expect(printheadOverflow(600, 568, 'left', 567)).toBe(true);
        expect(printheadOverflow(600, 100, 'right', 567)).toBe(false);
        expect(printheadOverflow(600, 568, 'right', 567)).toBe(true);
    });

    it('is non-blocking without a reported printhead size (dec 18)', () => {
        expect(printheadOverflow(10_000, 10_000, 'top', undefined)).toBe(false);
        expect(printheadOverflow(10_000, 10_000, 'left', undefined)).toBe(false);
    });

    it('does not warn when the head exactly matches the raster axis', () => {
        expect(printheadOverflow(567, 100, 'top', 567)).toBe(false);
    });
});
