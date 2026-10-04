import { describe, expect, it } from 'vitest';
import {
    COLOR_SPACES,
    MonoColorSpace,
    monoLuminance,
    toGrayBuffer,
    type ColorSpace,
    type RgbaBuffer,
} from './colorspace';

const buffer = (data: number[], width: number, height: number): RgbaBuffer => ({
    data: new Uint8ClampedArray(data),
    width,
    height,
});

describe('MonoColorSpace', () => {
    it('is the only registered color space (the default)', () => {
        expect(MonoColorSpace.id).toBe('mono');
        expect(Object.keys(COLOR_SPACES)).toEqual(['mono']);
        expect(COLOR_SPACES.mono).toBe(MonoColorSpace);
    });

    it('uses Rec. 601 luminance weights per pixel', () => {
        expect(MonoColorSpace.toGray(0, 0, 0)).toBe(0);
        expect(MonoColorSpace.toGray(255, 0, 0)).toBeCloseTo(76.245, 3);
        expect(MonoColorSpace.toGray(0, 255, 0)).toBeCloseTo(149.685, 3);
        expect(MonoColorSpace.toGray(0, 0, 255)).toBeCloseTo(29.07, 3);
    });

    it('exposes the same formula as monoLuminance', () => {
        expect(MonoColorSpace.toGray(12, 34, 56)).toBe(monoLuminance(12, 34, 56));
    });
});

describe('toGrayBuffer', () => {
    it('projects one rounded channel per pixel', () => {
        const rgba = buffer(
            [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255],
            2,
            2,
        );
        expect(Array.from(toGrayBuffer(MonoColorSpace, rgba))).toEqual([255, 0, 255, 0]);
    });

    it('uses whatever projection the color space supplies', () => {
        const swapped: ColorSpace = { id: 'mono', toGray: (r, g, b) => r * 0.114 + g * 0.587 + b * 0.299 };
        const red = buffer([255, 0, 0, 255], 1, 1);
        expect(toGrayBuffer(MonoColorSpace, red)[0]).toBe(76);
        expect(toGrayBuffer(swapped, red)[0]).toBe(29);
    });
});
