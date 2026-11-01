import { ImageEncoder } from '@mmote/niimbluelib';
import { describe, expect, it } from 'vitest';
import { monoLuminance, type RgbaBuffer } from './colorspace';
import {
    diffuseToPalette,
    GRAYSCALE_LEVELS,
    grayscaleRampPalette,
    grayLevelColor,
    nearestPaletteEntry,
    redBlackPalette,
    type Palette,
} from './palette';

/** Build a `width`×`height` buffer from a per-pixel source. */
const bufferOf = (
    width: number,
    height: number,
    pixel: (x: number, y: number) => readonly [number, number, number, number],
): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixel(x, y);
            const i = (y * width + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
        }
    }
    return { data, width, height };
};

/** A buffer filled with one RGBA colour. */
const solid = (
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a = 255,
): RgbaBuffer => bufferOf(width, height, () => [r, g, b, a]);

/** RGB triples of every pixel, row-major. */
const rgbList = (rgba: RgbaBuffer): Array<readonly [number, number, number]> => {
    const out: Array<readonly [number, number, number]> = [];
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]);
    return out;
};

/** Mean BT.601 luminance over the whole buffer. */
const meanLuminance = (rgba: RgbaBuffer): number => {
    let sum = 0;
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) sum += monoLuminance(data[i], data[i + 1], data[i + 2]);
    return sum / (data.length / 4);
};

/** Assert every output pixel is one of `palette`'s exact entry colours. */
const expectInPalette = (rgba: RgbaBuffer, palette: Palette): void => {
    for (const [r, g, b] of rgbList(rgba)) {
        const found = palette.entries.some(
            (entry) => entry.r === r && entry.g === g && entry.b === b,
        );
        expect(found, `rgb(${r}, ${g}, ${b}) is not an entry of ${palette.id}`).toBe(true);
    }
};

/** Count how many output pixels equal `[r, g, b]`. */
const countColor = (rgba: RgbaBuffer, r: number, g: number, b: number): number =>
    rgbList(rgba).filter(([pr, pg, pb]) => pr === r && pg === g && pb === b).length;

describe('grayscale ramp palette', () => {
    it('matches the library gray band at every level centre', () => {
        // Pins 0 = white, 15 = black and the exact 255 - 17k centres: a pixel
        // authored at a band centre must re-encode to the same level.
        for (let level = 0; level < GRAYSCALE_LEVELS; level++) {
            const c = grayLevelColor(level);
            expect(ImageEncoder.colorToGrayLevel((c << 16) | (c << 8) | c), `level ${level}`).toBe(
                level,
            );
        }
    });

    it('is a strictly descending neutral ramp from white to black', () => {
        const palette = grayscaleRampPalette();
        expect(palette.entries).toHaveLength(GRAYSCALE_LEVELS);
        expect(palette.entries[0]).toEqual({ r: 255, g: 255, b: 255 });
        expect(palette.entries[GRAYSCALE_LEVELS - 1]).toEqual({ r: 0, g: 0, b: 0 });

        for (let level = 0; level < GRAYSCALE_LEVELS; level++) {
            const entry = palette.entries[level];
            expect(entry.r, `level ${level}`).toBe(grayLevelColor(level));
            expect(entry.g, `level ${level}`).toBe(entry.r);
            expect(entry.b, `level ${level}`).toBe(entry.r);
        }
        for (let level = 1; level < GRAYSCALE_LEVELS; level++) {
            expect(palette.entries[level].r).toBeLessThan(palette.entries[level - 1].r);
        }
    });

    it('nearest-entry follows BT.601 luminance, not the channel mean', () => {
        const palette = grayscaleRampPalette();
        // Saturated green: luminance ≈ 150 (level 6) but channel mean 85
        // (level 10). The library formula must win or preview ≠ print.
        expect(nearestPaletteEntry(palette, 0, 255, 0)).toBe(6);
    });

    it('prints an exact band-centre grey as that single level everywhere', () => {
        const palette = grayscaleRampPalette();
        for (const level of [0, 1, 5, 7, 8, 14, 15]) {
            const value = grayLevelColor(level);
            const rgba = solid(8, 4, value, value, value);
            diffuseToPalette(rgba, palette);
            // Zero error at every pixel: no dither noise on an exact palette value.
            for (const [r, g, b] of rgbList(rgba)) {
                expect([r, g, b], `level ${level}`).toEqual([value, value, value]);
            }
        }
    });
});

describe('red/black palette', () => {
    it('is ordered white, black, red', () => {
        const palette = redBlackPalette();
        expect(palette.entries).toEqual([
            { r: 255, g: 255, b: 255 },
            { r: 0, g: 0, b: 0 },
            { r: 255, g: 0, b: 0 },
        ]);
    });

    it('leaves exact palette pixels unchanged at strength 0', () => {
        const palette = redBlackPalette();
        const alphas = [255, 64, 200, 0];
        const rgba = bufferOf(4, 1, (x) => {
            const colors = [
                [255, 255, 255],
                [0, 0, 0],
                [255, 0, 0],
                [0, 0, 0],
            ] as const;
            const [r, g, b] = colors[x];
            return [r, g, b, alphas[x]];
        });
        const before = Array.from(rgba.data);

        diffuseToPalette(rgba, palette, { strength: 0 });

        expect(Array.from(rgba.data)).toEqual(before);
        expect(rgba.data.filter((_, i) => i % 4 === 3)).toEqual(
            new Uint8ClampedArray(alphas),
        );
    });

    it('mixes black and red in a dark red patch (vector, not threshold)', () => {
        const palette = redBlackPalette();
        const rgba = solid(16, 16, 128, 0, 0);
        diffuseToPalette(rgba, palette);

        expect(countColor(rgba, 0, 0, 0)).toBeGreaterThan(0);
        expect(countColor(rgba, 255, 0, 0)).toBeGreaterThan(0);
        expectInPalette(rgba, palette);
    });

    it('keeps solid red all red (the flat-text path)', () => {
        const palette = redBlackPalette();
        const rgba = solid(8, 4, 255, 0, 0);
        diffuseToPalette(rgba, palette);

        // Exact entry → zero error at every pixel, so no black speckle.
        for (const [r, g, b] of rgbList(rgba)) {
            expect([r, g, b]).toEqual([255, 0, 0]);
        }
    });
});

describe('diffusion', () => {
    it('conserves tone across adjacent grayscale levels', () => {
        const rgba = solid(32, 32, 128, 128, 128);
        diffuseToPalette(rgba, grayscaleRampPalette());

        // Uniform 128 sits in level 8's upper half (bands 110.5..127.5 for 8,
        // 127.5..144.5 for 7), so the output must use both neighbours.
        expect(countColor(rgba, grayLevelColor(7), grayLevelColor(7), grayLevelColor(7)))
            .toBeGreaterThan(0);
        expect(countColor(rgba, grayLevelColor(8), grayLevelColor(8), grayLevelColor(8)))
            .toBeGreaterThan(0);

        // Error diffusion conserves tone: the mean must land back on the input.
        expect(Math.abs(meanLuminance(rgba) - 128)).toBeLessThanOrEqual(2);
    });

    it('never emits a colour outside the palette', () => {
        const grayscale = solid(16, 16, 128, 128, 128);
        diffuseToPalette(grayscale, grayscaleRampPalette());
        expectInPalette(grayscale, grayscaleRampPalette());

        const redPatch = solid(16, 16, 128, 0, 0);
        diffuseToPalette(redPatch, redBlackPalette());
        expectInPalette(redPatch, redBlackPalette());

        const ramp = bufferOf(16, 16, (x) => [255 - x * 16, 0, 0, 255]);
        diffuseToPalette(ramp, redBlackPalette());
        expectInPalette(ramp, redBlackPalette());
    });

    it('serpentine and raster scans differ, and each is deterministic', () => {
        const make = (): RgbaBuffer =>
            bufferOf(8, 8, (x, y) => {
                const value = 96 + x * 6 + (y & 1);
                return [value, value, value, 255];
            });
        const palette = grayscaleRampPalette();

        const serpentine = make();
        diffuseToPalette(serpentine, palette, { serpentine: true });
        const serpentineAgain = make();
        diffuseToPalette(serpentineAgain, palette, { serpentine: true });

        const raster = make();
        diffuseToPalette(raster, palette, { serpentine: false });
        const rasterAgain = make();
        diffuseToPalette(rasterAgain, palette, { serpentine: false });

        expect(Array.from(serpentineAgain.data)).toEqual(Array.from(serpentine.data));
        expect(Array.from(rasterAgain.data)).toEqual(Array.from(raster.data));
        expect(Array.from(serpentine.data)).not.toEqual(Array.from(raster.data));
    });

    it('applies gamma on luminance and leaves the endpoints fixed', () => {
        const palette = grayscaleRampPalette();

        const neutral = solid(32, 32, 128, 128, 128);
        diffuseToPalette(neutral, palette, { gamma: 1 });
        const lighter = solid(32, 32, 128, 128, 128);
        diffuseToPalette(lighter, palette, { gamma: 2.2 });

        // >1 lightens midtones, so the printed mean must rise.
        expect(meanLuminance(lighter)).toBeGreaterThan(meanLuminance(neutral));

        for (const endpoint of [0, 255]) {
            const rgba = solid(4, 4, endpoint, endpoint, endpoint);
            diffuseToPalette(rgba, palette, { gamma: 2.2 });
            for (const [r, g, b] of rgbList(rgba)) {
                expect([r, g, b]).toEqual([endpoint, endpoint, endpoint]);
            }
        }
    });

    it('preserves every alpha byte', () => {
        const alphas = [0, 1, 127, 128, 254, 255];
        const rgba = bufferOf(3, 2, (x, y) => {
            const i = y * 3 + x;
            return [128 + x * 20, 0, y * 30, alphas[i % alphas.length]];
        });
        const before = rgba.data.filter((_, i) => i % 4 === 3);

        diffuseToPalette(rgba, redBlackPalette());

        expect(rgba.data.filter((_, i) => i % 4 === 3)).toEqual(before);
    });

    it('non-finite strength normalizes to 1', () => {
        const palette = grayscaleRampPalette();
        const render = (strength: number): RgbaBuffer => {
            const rgba = solid(6, 4, 128, 128, 128);
            diffuseToPalette(rgba, palette, { strength });
            return rgba;
        };

        // NaN used to slip past `Math.max(0, strength)`, poison every working
        // plane and crash the pass on `entries[undefined]`.
        const neutral = render(1);
        const notANumber = render(Number.NaN);
        const infinite = render(Number.POSITIVE_INFINITY);

        expect(Array.from(notANumber.data)).toEqual(Array.from(neutral.data));
        expect(Array.from(infinite.data)).toEqual(Array.from(neutral.data));
        expectInPalette(neutral, palette);
        expectInPalette(notANumber, palette);
        expectInPalette(infinite, palette);
    });

    it('reverse-row taps mirror leftward (hand-derived fixture)', () => {
        // Local black/white palette so the squared-distance test is unambiguous.
        const palette: Palette = {
            id: 'black-white',
            entries: [
                { r: 0, g: 0, b: 0 },
                { r: 255, g: 255, b: 255 },
            ],
        };
        const rgba = bufferOf(4, 2, (x, y) => {
            const value = y === 0 ? (x === 0 ? 128 : 255) : 128;
            return [value, value, value, 255];
        });

        diffuseToPalette(rgba, palette, { serpentine: true, strength: 1 });

        // Row 0 (forward): x0 = 128 → white, error −127; 255 pixels stay white
        // (error −127·7/16 = −55.56 … each settled by its own white choice).
        // Row 1 pre-scan working values ≈ [77.89, 98.14, 114.94, 123.16].
        // Row 1 (reverse): x3 123.16 → black (+123.16 → x2 168.82 → white),
        // x2 → white (−86.18 → x1 60.44 → black), x1 → black (+60.44 → x0
        // 104.33 → black), x0 → black. With the taps *not* mirrored (a
        // forward-distribution bug) row 1 would be [0, 0, 0, 0], so this pins
        // direction.
        expect(rgbList(rgba)).toEqual([
            [255, 255, 255],
            [255, 255, 255],
            [255, 255, 255],
            [255, 255, 255],
            [0, 0, 0],
            [0, 0, 0],
            [255, 255, 255],
            [0, 0, 0],
        ]);
        expect(rgba.data.filter((_, i) => i % 4 === 3)).toEqual(
            new Uint8ClampedArray(8).fill(255),
        );
    });
});
