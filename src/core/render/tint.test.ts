import { describe, expect, it } from 'vitest';
import type { RgbaBuffer } from './colorspace';
import { parseHexColor, tintRgbaByLuminance } from './tint';

/** Build an RGBA buffer from `[r, g, b, a]` pixels, 1 row. */
const buffer = (pixels: [number, number, number, number][]): RgbaBuffer => ({
    data: new Uint8ClampedArray(pixels.flat()),
    width: pixels.length,
    height: 1,
});

const pixelsOf = (rgba: RgbaBuffer): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < rgba.data.length; i += 4) {
        out.push([rgba.data[i]!, rgba.data[i + 1]!, rgba.data[i + 2]!, rgba.data[i + 3]!]);
    }
    return out;
};

describe('parseHexColor', () => {
    it('parses #rgb, #rrggbb and #rrggbbaa (alpha ignored)', () => {
        expect(parseHexColor('#f00')).toEqual([255, 0, 0]);
        expect(parseHexColor('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
        expect(parseHexColor('#ff8000')).toEqual([255, 128, 0]);
        // 8-digit: the trailing alpha pair is not part of the colour.
        expect(parseHexColor('#ff800080')).toEqual([255, 128, 0]);
        expect(parseHexColor('#0a0b0cff')).toEqual([10, 11, 12]);
    });

    it('parses 4-digit #rgba too (validation accepts it), ignoring alpha', () => {
        expect(parseHexColor('#f00f')).toEqual([255, 0, 0]);
        expect(parseHexColor('#abcd')).toEqual([0xaa, 0xbb, 0xcc]);
    });

    it('is case-insensitive', () => {
        expect(parseHexColor('#AABBCC')).toEqual([0xaa, 0xbb, 0xcc]);
    });

    it('rejects non-hex / malformed / non-string input', () => {
        for (const bad of ['red', 'rgb(1,2,3)', '#12', '#12345', '#gggggg', '', 'transparent']) {
            expect(parseHexColor(bad), bad).toBeUndefined();
        }
    });
});

describe('tintRgbaByLuminance', () => {
    it("is a no-op for 'transparent' and for an unparseable colour", () => {
        const transparent = buffer([[10, 20, 30, 40]]);
        expect(tintRgbaByLuminance(transparent, 'transparent')).toBe(transparent);
        expect(pixelsOf(transparent)).toEqual([[10, 20, 30, 40]]);

        const invalid = buffer([[10, 20, 30, 40]]);
        expect(tintRgbaByLuminance(invalid, 'red')).toBe(invalid);
        expect(pixelsOf(invalid)).toEqual([[10, 20, 30, 40]]);
    });

    it('red tint turns a neutral grey into (255, L, L)', () => {
        const rgba = buffer([
            [0, 0, 0, 255],
            [128, 128, 128, 255],
            [255, 255, 255, 255],
        ]);
        tintRgbaByLuminance(rgba, '#ff0000');
        expect(pixelsOf(rgba)).toEqual([
            [255, 0, 0, 255],
            [255, 128, 128, 255],
            [255, 255, 255, 255],
        ]);
    });

    it('ignores the source hue: only luminance drives density', () => {
        // Pure red has BT.601 luminance 76.245; the red tint keeps it as L.
        const rgba = buffer([[255, 0, 0, 255]]);
        tintRgbaByLuminance(rgba, '#ff0000');
        expect(pixelsOf(rgba)).toEqual([[255, 76, 76, 255]]);
    });

    it('black tint on a neutral grey is the identity', () => {
        const rgba = buffer([
            [0, 0, 0, 255],
            [128, 128, 128, 255],
            [255, 255, 255, 255],
        ]);
        tintRgbaByLuminance(rgba, '#000000');
        expect(pixelsOf(rgba)).toEqual([
            [0, 0, 0, 255],
            [128, 128, 128, 255],
            [255, 255, 255, 255],
        ]);
    });

    it('white tint erases the source to white', () => {
        const rgba = buffer([
            [0, 0, 0, 255],
            [128, 128, 128, 255],
            [200, 10, 30, 255],
        ]);
        tintRgbaByLuminance(rgba, '#ffffff');
        expect(pixelsOf(rgba)).toEqual([
            [255, 255, 255, 255],
            [255, 255, 255, 255],
            [255, 255, 255, 255],
        ]);
    });

    it('never touches the alpha byte', () => {
        const rgba = buffer([
            [0, 0, 0, 0],
            [64, 64, 64, 17],
            [255, 255, 255, 200],
        ]);
        tintRgbaByLuminance(rgba, '#ff0000');
        expect(pixelsOf(rgba).map((p) => p[3])).toEqual([0, 17, 200]);
    });

    it('is deterministic (the same input yields the same output)', () => {
        const make = () => buffer([[12, 34, 56, 78], [90, 100, 110, 120]]);
        const a = make();
        const b = make();
        tintRgbaByLuminance(a, '#336699');
        tintRgbaByLuminance(b, '#336699');
        expect(pixelsOf(a)).toEqual(pixelsOf(b));
        expect(tintRgbaByLuminance(a, '#336699')).toBe(a);
    });
});
