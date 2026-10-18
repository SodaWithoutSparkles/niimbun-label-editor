import { describe, expect, it } from 'vitest';
import { monoLuminance, type ColorSpace, type RgbaBuffer } from './colorspace';
import {
    atkinson,
    buildToneLut,
    createDiffuser,
    floydSteinberg,
    GAMMA_MAX,
    GAMMA_MIN,
    normalizeGamma,
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

describe('buildToneLut (P14 W1 tone curve)', () => {
    it('is the identity at gamma 1', () => {
        const lut = buildToneLut(1);
        expect(lut).toHaveLength(256);
        for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    });

    it('is monotonic non-decreasing for any gamma', () => {
        for (const gamma of [GAMMA_MIN, 0.5, 1, 1.3, 2.2, GAMMA_MAX]) {
            const lut = buildToneLut(gamma);
            for (let i = 1; i < 256; i++) {
                expect(lut[i], `gamma ${gamma} at ${i}`).toBeGreaterThanOrEqual(lut[i - 1]!);
            }
        }
    });

    it('keeps the endpoints fixed and lightens midtones above gamma 1', () => {
        const lut = buildToneLut(1.3);
        expect(lut[0]).toBe(0);
        expect(lut[255]).toBe(255);
        // `128 → 150`: a mid-grey prints lighter, i.e. dot-gain compensation.
        expect(lut[128]).toBe(150);
        expect(lut[200]).toBe(212);
        // Lightening weakens toward the top and saturates (rounding), so it is
        // monotone non-decreasing against the identity, never below it.
        for (let i = 1; i < 255; i++) expect(lut[i]).toBeGreaterThanOrEqual(i);
        for (let i = 1; i <= 240; i++) expect(lut[i]).toBeGreaterThan(i);
    });

    it('darkens midtones below gamma 1', () => {
        const lut = buildToneLut(0.5);
        for (let i = 1; i < 255; i++) expect(lut[i]).toBeLessThan(i);
        expect(lut[128]).toBe(64);
    });

    it('clamps gamma to [0.1, 4]', () => {
        expect(buildToneLut(0)).toEqual(buildToneLut(GAMMA_MIN));
        expect(buildToneLut(-3)).toEqual(buildToneLut(GAMMA_MIN));
        expect(buildToneLut(9)).toEqual(buildToneLut(GAMMA_MAX));
        // `Infinity` is non-finite, so it collapses to the neutral 1 rather than
        // clamping to the max (see the non-finite guard below).
        expect(buildToneLut(Infinity)).toEqual(buildToneLut(1));
        // The clamped LUT is still a usable 256-entry byte table.
        expect(buildToneLut(9)[255]).toBe(255);
    });

    it('normalises non-finite gamma to the neutral 1, never a NaN/zero LUT', () => {
        for (const gamma of [NaN, Infinity, -Infinity]) {
            expect(normalizeGamma(gamma), `normalizeGamma(${gamma})`).toBe(1);
            expect(buildToneLut(gamma), `LUT for ${gamma} is the identity`).toEqual(buildToneLut(1));
        }
        // Every entry equals the formula computed from the **normalized** gamma,
        // so a stray gamma can never reach the LUT unnormalized: a raw `NaN`
        // exponent would write `NaN` → `0` into every slot and zero the raster.
        for (const gamma of [NaN, Infinity, -Infinity, 0, 1, 9]) {
            const normalized = normalizeGamma(gamma);
            const lut = buildToneLut(gamma);
            for (let i = 0; i < 256; i++) {
                expect(lut[i], `LUT[${gamma}][${i}]`).toBe(
                    Math.round(255 * (i / 255) ** (1 / normalized)),
                );
            }
        }
    });

    it('clamps a finite out-of-range gamma and passes an in-range one through', () => {
        expect(normalizeGamma(0)).toBe(GAMMA_MIN);
        expect(normalizeGamma(-3)).toBe(GAMMA_MIN);
        expect(normalizeGamma(9)).toBe(GAMMA_MAX);
        expect(normalizeGamma(1.3)).toBe(1.3);
    });
});

describe('tone curve (gamma) — threshold cutoff shift', () => {
    // A projection with no float error, so the cutoff byte is exact: the Mono
    // luminance weights leave `128` just below 128 in float, which would blur the
    // boundary under test.
    const exactGray: ColorSpace = { id: 'mono', toGray: (r) => r };
    const levels = fromGrays(
        256,
        1,
        Array.from({ length: 256 }, (_, i) => i),
    );

    /** The largest source level that still binarises black at `cutoff`. */
    const lastBlack = (gamma: number | undefined, cutoff: number): number =>
        run(threshold, levels, {
            threshold: cutoff,
            colorSpace: exactGray,
            ...(gamma === undefined ? {} : { gamma }),
        }).reduce((last, [r], value) => (r === 0 ? value : last), -1);

    it('leaves the cutoff at the source value when gamma is unset or 1', () => {
        expect(lastBlack(undefined, 128)).toBe(127);
        expect(lastBlack(1, 128)).toBe(127);
    });

    it('moves the binarisation cutoff (128 → 104) at gamma 1.3', () => {
        // A point-op threshold has no plane, so the curve only shifts the cutoff:
        // the black test becomes `lut[v] < 128`, and `lut[103] = 127`,
        // `lut[104] = 128`. The first source level that binarises white thus moves
        // from 128 to 104.
        expect(lastBlack(1.3, 128)).toBe(103);
        const fixture = fromGrays(4, 1, [103, 104, 200, 255]);
        expect(run(threshold, fixture, { threshold: 128, gamma: 1.3, colorSpace: exactGray })).toEqual(
            [BLACK, WHITE, WHITE, WHITE],
        );
        // Without the curve, 103 and 104 are both below the cutoff.
        expect(run(threshold, fixture, { threshold: 128, colorSpace: exactGray })).toEqual([
            BLACK,
            BLACK,
            WHITE,
            WHITE,
        ]);
    });

    it('darkens the cutoff below gamma 1', () => {
        // `lut[180] = round(255 * (180/255) ** 2) = 127`: the last black level.
        expect(lastBlack(0.5, 128)).toBe(180);
    });
});

describe('tone curve (gamma) — diffusers', () => {
    /** Count black pixels over a uniform grey plane. */
    const inkFraction = (quantizer: typeof floydSteinberg, value: number, gamma?: number): number => {
        const plane = fromGrays(8, 8, new Array<number>(64).fill(value));
        const pixels = run(quantizer, plane, gamma === undefined ? undefined : { gamma });
        return pixels.filter(([r]) => r === 0).length;
    };

    for (const [name, quantizer] of Object.entries({
        floydSteinberg,
        stucki,
        atkinson,
    }) as [string, typeof floydSteinberg][]) {
        it(`${name} lightens a uniform mid-grey plane at gamma 1.3`, () => {
            const neutral = inkFraction(quantizer, 100);
            const lifted = inkFraction(quantizer, 100, 1.3);
            expect(neutral, 'the neutral plane has mid-grey ink coverage').toBeGreaterThan(0);
            expect(lifted, 'lightening deposits less ink').toBeLessThan(neutral);
        });

        it(`${name}: gamma 1 is byte-identical to omitting the option`, () => {
            const plane = fromGrays(4, 4, RAMP);
            expect(run(quantizer, plane, { gamma: 1 })).toEqual(run(quantizer, plane));
        });

        it(`${name}: the tone curve changes the plane`, () => {
            const plane = fromGrays(4, 4, RAMP);
            expect(run(quantizer, plane, { gamma: 1.3 })).not.toEqual(run(quantizer, plane));
        });
    }

    it('brings gamma and its clamp into the diffusers too', () => {
        const plane = fromGrays(4, 4, RAMP);
        expect(run(floydSteinberg, plane, { gamma: 0 })).toEqual(
            run(floydSteinberg, plane, { gamma: GAMMA_MIN }),
        );
    });

    it('a non-finite gamma is neutral at the engine, never an all-black plane', () => {
        const plane = fromGrays(4, 4, RAMP);
        // Neutral output still has white pixels; a NaN LUT would make them all 0.
        for (const quantizer of Object.values(QUANTIZERS)) {
            for (const gamma of [NaN, Infinity, -Infinity]) {
                const pixels = run(quantizer, plane, { gamma });
                expect(pixels, `gamma ${gamma} is byte-identical to the neutral pass`).toEqual(
                    run(quantizer, plane),
                );
                expect(pixels.some(([r]) => r === 255), `gamma ${gamma} keeps white ink`).toBe(true);
            }
        }
    });

    it('a finite out-of-range gamma is clamped at the engine, not extrapolated', () => {
        const plane = fromGrays(4, 4, RAMP);
        expect(run(threshold, plane, { gamma: 1e9 })).toEqual(run(threshold, plane, { gamma: GAMMA_MAX }));
        expect(run(threshold, plane, { gamma: -1e9 })).toEqual(run(threshold, plane, { gamma: GAMMA_MIN }));
    });
});

describe('tone curve (gamma) — existing golden planes stay byte-identical', () => {
    it('gamma 1 reproduces every pinned diffuser plane and the threshold plane', () => {
        expect(run(floydSteinberg, ramp, { gamma: 1 })).toEqual([
            BLACK, BLACK, WHITE, WHITE,
            BLACK, WHITE, BLACK, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, WHITE, BLACK, WHITE,
        ]);
        expect(run(stucki, ramp, { gamma: 1 })).toEqual([
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, BLACK, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, WHITE, WHITE, WHITE,
        ]);
        expect(run(atkinson, ramp, { gamma: 1 })).toEqual([
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, WHITE, WHITE,
            BLACK, BLACK, WHITE, WHITE,
        ]);
        // The `gamma: 1` path must not round the float projection: it equals the
        // no-gamma path exactly for every quantizer.
        for (const quantizer of Object.values(QUANTIZERS)) {
            expect(run(quantizer, ramp, { gamma: 1 })).toEqual(run(quantizer, ramp));
        }
    });

    it('gamma 1 does not round a fractional projection through the LUT index', () => {
        // A projection just below the cutoff: rounding it (`round(127.6) = 128`)
        // would push it to the white side, so a rounding regression flips this
        // pixel. The neutral branch must keep the raw 127.6.
        const fractional: ColorSpace = { id: 'mono', toGray: () => 127.6 };
        const fixture = fromGrays(1, 1, [0]);

        expect(
            run(threshold, fixture, { threshold: 128, colorSpace: fractional, gamma: 1 }),
            'gamma 1 keeps the raw 127.6 < 128 → black',
        ).toEqual([BLACK]);
        expect(run(threshold, fixture, { threshold: 128, colorSpace: fractional })).toEqual([BLACK]);

        // The LUT path *does* round the projection to index it. At gamma 1.3,
        // `lut[103] = 127` (black) but `lut[104] = 128` (white), so a raw 103.6
        // straddles the cutoff: only rounding (→ index 104) lands white, while
        // floor/trunc (→ index 103) would stay black.
        const straddling: ColorSpace = { id: 'mono', toGray: () => 103.6 };
        expect(
            run(threshold, fixture, { threshold: 128, colorSpace: straddling, gamma: 1.3 }),
            'the LUT path rounds 103.6 → index 104, so it binarises white',
        ).toEqual([WHITE]);
    });
});
