import { describe, expect, it } from 'vitest';
import { monoLuminance, type ColorSpace, type RgbaBuffer } from './colorspace';
import {
    atkinson,
    createDiffuser,
    floydSteinberg,
    QUANTIZERS,
    stucki,
    threshold,
    type QuantizeOptions,
} from './quantize';

/** Build an opaque RGBA buffer from a flat gray ramp (row-major). */
const fromGrays = (width: number, height: number, values: readonly number[]): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < values.length; p++) {
        data[p * 4] = values[p];
        data[p * 4 + 1] = values[p];
        data[p * 4 + 2] = values[p];
        data[p * 4 + 3] = 255;
    }
    return { data, width, height };
};

/** Extract the full `[r, g, b]` triplet of every pixel. */
const pixelsOf = (rgba: RgbaBuffer): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < rgba.data.length; i += 4) {
        out.push([rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]]);
    }
    return out;
};

const clone = (rgba: RgbaBuffer): RgbaBuffer => ({
    data: new Uint8ClampedArray(rgba.data),
    width: rgba.width,
    height: rgba.height,
});

const run = (
    quantizer: (rgba: RgbaBuffer, opts?: QuantizeOptions) => RgbaBuffer,
    source: RgbaBuffer,
    opts?: QuantizeOptions,
): number[][] => {
    const copy = clone(source);
    quantizer(copy, opts);
    return pixelsOf(copy);
};

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const isBitPixel = ([r, g, b]: number[]): boolean =>
    (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255);

// A 4×4 ramp that crosses the 128 threshold more than once.
const RAMP = [0, 64, 128, 192, 32, 96, 160, 224, 16, 80, 144, 208, 48, 112, 176, 240];
const ramp = fromGrays(4, 4, RAMP);

const ATKINSON_GRID = [
    [0, 0, 0, 1, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0],
] as const;

/** A non-default projection: luminance inverted (dark↔light). */
const inverted: ColorSpace = { id: 'mono', toGray: (r, g, b) => 255 - monoLuminance(r, g, b) };

describe('threshold', () => {
    it('splits the projection at the threshold with exact black/white', () => {
        const fixture = fromGrays(2, 2, [0, 64, 192, 255]);
        expect(run(threshold, fixture, { threshold: 128 })).toEqual([BLACK, BLACK, WHITE, WHITE]);
        expect(run(threshold, fixture)).toEqual([BLACK, BLACK, WHITE, WHITE]);
    });

    it('respects a custom threshold', () => {
        const fixture = fromGrays(2, 2, [0, 64, 192, 255]);
        expect(run(threshold, fixture, { threshold: 100 })).toEqual([BLACK, BLACK, WHITE, WHITE]);
        expect(run(threshold, fixture, { threshold: 200 })).toEqual([BLACK, BLACK, BLACK, WHITE]);
    });

    it('preserves alpha and emits full 0/255 RGB triplets', () => {
        const fixture: RgbaBuffer = { data: new Uint8ClampedArray([10, 10, 10, 7, 250, 250, 250, 9]), width: 2, height: 1 };
        threshold(fixture);
        expect(fixture.data[3]).toBe(7);
        expect(fixture.data[7]).toBe(9);
        expect(pixelsOf(fixture)).toEqual([BLACK, WHITE]);
    });
});

describe('diffusers (golden pixels, full RGB)', () => {
    it('floydSteinberg produces the pinned 1-bit plane', () => {
        expect(run(floydSteinberg, ramp)).toEqual([
            BLACK, BLACK, WHITE, WHITE,
            BLACK, WHITE, BLACK, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, WHITE, BLACK, WHITE,
        ]);
    });

    it('stucki produces the pinned 1-bit plane', () => {
        expect(run(stucki, ramp)).toEqual([
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, BLACK, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, WHITE, WHITE, WHITE,
        ]);
    });

    it('atkinson produces the pinned 1-bit plane', () => {
        expect(run(atkinson, ramp)).toEqual([
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, WHITE, WHITE,
        ]);
    });

    it('every quantizer output pixel is exactly 0,0,0 or 255,255,255', () => {
        for (const quantizer of Object.values(QUANTIZERS)) {
            for (const pixel of run(quantizer, ramp)) {
                expect(isBitPixel(pixel)).toBe(true);
            }
        }
    });

    it('preserves alpha through diffusion', () => {
        const fixture = fromGrays(2, 2, [0, 64, 192, 255]);
        for (let i = 3; i < fixture.data.length; i += 4) fixture.data[i] = 42;
        const copy = clone(fixture);
        floydSteinberg(copy);
        for (let i = 3; i < copy.data.length; i += 4) expect(copy.data[i]).toBe(42);
    });
});

describe('color space seam', () => {
    it('defaults to Mono (unspecified colorSpace == Mono)', () => {
        expect(run(threshold, ramp)).toEqual(run(threshold, ramp, { colorSpace: undefined }));
        expect(run(floydSteinberg, ramp)).toEqual(run(floydSteinberg, ramp, { colorSpace: undefined }));
    });

    it('a non-default projection changes the result', () => {
        const mono = run(threshold, ramp);
        const inv = run(threshold, ramp, { colorSpace: inverted });
        expect(inv).not.toEqual(mono);
        // Inverted projection flips the darkest ramp pixel to white.
        expect(mono[0]).toEqual(BLACK);
        expect(inv[0]).toEqual(WHITE);
    });

    it('threads the projection through diffusion too', () => {
        expect(run(floydSteinberg, ramp, { colorSpace: inverted })).not.toEqual(
            run(floydSteinberg, ramp),
        );
    });
});

describe('atkinson discards error (normalize: false)', () => {
    it('differs from the same grid with normalization enabled', () => {
        const normalized = createDiffuser(8, ATKINSON_GRID);
        expect(run(atkinson, ramp)).not.toEqual(run(normalized, ramp));
    });

    it('differs from floydSteinberg on the same fixture', () => {
        expect(run(atkinson, ramp)).not.toEqual(run(floydSteinberg, ramp));
    });

    it('conserves less error than the normalized kernel (pinned diff)', () => {
        // Normalized grid flips pixel 10 to black; Atkinson keeps it white.
        expect(run(createDiffuser(8, ATKINSON_GRID), ramp)[10]).toEqual(BLACK);
        expect(run(atkinson, ramp)[10]).toEqual(WHITE);
    });
});

describe('serpentine scanning (default true)', () => {
    it('defaults to the serpentine result', () => {
        expect(run(floydSteinberg, ramp)).toEqual(run(floydSteinberg, ramp, { serpentine: true }));
    });

    it('differs from top-to-bottom scanning on the ramp', () => {
        expect(run(floydSteinberg, ramp)).not.toEqual(run(floydSteinberg, ramp, { serpentine: false }));
        expect(run(stucki, ramp)).not.toEqual(run(stucki, ramp, { serpentine: false }));
        expect(run(atkinson, ramp)).not.toEqual(run(atkinson, ramp, { serpentine: false }));
    });
});

describe('createDiffuser guards', () => {
    it('rejects an empty grid', () => {
        expect(() => createDiffuser(16, [])).toThrow(/grid/);
    });

    it('rejects a non-positive denom', () => {
        expect(() => createDiffuser(0, [[0, 0, 1]])).toThrow(/denom/);
    });
});

describe('QUANTIZERS registry', () => {
    it('exposes all four named quantizers', () => {
        expect(Object.keys(QUANTIZERS).sort()).toEqual([
            'atkinson',
            'floydSteinberg',
            'stucki',
            'threshold',
        ]);
        for (const quantizer of Object.values(QUANTIZERS)) {
            expect(typeof quantizer).toBe('function');
        }
    });
});
