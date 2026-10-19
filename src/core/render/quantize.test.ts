import { describe, expect, it } from 'vitest';
import { monoLuminance, type ColorSpace, type RgbaBuffer } from './colorspace';
import {
    atkinson,
    buildToneLut,
    createDiffuser,
    createVariableDiffuser,
    floydSteinberg,
    GAMMA_MAX,
    GAMMA_MIN,
    normalizeGamma,
    ostromoukhov,
    QUANTIZERS,
    stucki,
    threshold,
    type QuantizeOptions,
} from './quantize';
import { OSTROMOUKHOV_COEFFICIENTS } from './ostromoukhovTable';

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
            // `screentone` requires the effective raster dpi (P4).
            for (const pixel of run(quantizer, ramp, { dpi: 300 })) {
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
    it('exposes all six named quantizers', () => {
        expect(Object.keys(QUANTIZERS).sort()).toEqual([
            'atkinson',
            'floydSteinberg',
            'ostromoukhov',
            'screentone',
            'stucki',
            'threshold',
        ]);
        for (const quantizer of Object.values(QUANTIZERS)) {
            expect(typeof quantizer).toBe('function');
        }
    });

    it('registers screentone and requires the effective dpi (P4)', () => {
        expect(typeof QUANTIZERS.screentone).toBe('function');
        expect(() => run(QUANTIZERS.screentone, ramp)).toThrow(/dpi/);
        const pixels = run(QUANTIZERS.screentone, ramp, { dpi: 300 });
        for (const pixel of pixels) expect(isBitPixel(pixel)).toBe(true);
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
                const pixels = run(quantizer, plane, { gamma, dpi: 300 });
                expect(pixels, `gamma ${gamma} is byte-identical to the neutral pass`).toEqual(
                    run(quantizer, plane, { dpi: 300 }),
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
            // `screentone` requires the effective raster dpi (P4).
            expect(run(quantizer, ramp, { gamma: 1, dpi: 300 })).toEqual(
                run(quantizer, ramp, { dpi: 300 }),
            );
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

// ---------------------------------------------------------------------------
// Ostromoukhov variable-coefficient error diffusion (P14 W2)
// ---------------------------------------------------------------------------

/** A uniform grey plane — the fixture every hand trace below is derived on. */
const uniform = (width: number, height: number, value: number): RgbaBuffer =>
    fromGrays(width, height, new Array<number>(width * height).fill(value));

/**
 * The projected value must be *exact* in these tests, or the Float32 working
 * plane blurs the knife edge: `MonoColorSpace.toGray(128,128,128)` is
 * `127.99999999999999`, which `Float32Array` rounds **up** to `128`. That is
 * pre-existing engine behaviour (`createDiffuser` has the same plane), so an
 * identity projection keeps the cutoff honest here.
 */
const exactGray: ColorSpace = { id: 'mono', toGray: (r) => r };

/** Per-row `1`/`0` strings, so a pinned plane reads as a picture. */
const bitRows = (pixels: number[][], width: number): string[] => {
    const rows: string[] = [];
    for (let start = 0; start < pixels.length; start += width) {
        rows.push(pixels.slice(start, start + width).map(([r]) => (r === 0 ? '0' : '1')).join(''));
    }
    return rows;
};

/** The reference's own spot rows, copied out of `varcoeffED.c`. */
const REFERENCE_ROWS: Readonly<Record<number, readonly number[]>> = {
    0: [13, 0, 5, 18],
    11: [501, 224, 211, 936],
    23: [459, 304, 161, 924],
    24: [38, 25, 14, 77],
    25: [453, 296, 175, 924],
    37: [281, 173, 162, 616],
    64: [1, 1, 0, 2],
    73: [172, 181, 37, 390],
    76: [119, 47, 29, 195],
    86: [65, 18, 17, 100],
    108: [305, 176, 119, 600],
    127: [4, 1, 1, 6],
    128: [4, 1, 1, 6],
    191: [1, 1, 0, 2],
    255: [13, 0, 5, 18],
};

const coefRow = (level: number): number[] =>
    Array.from(OSTROMOUKHOV_COEFFICIENTS.slice(level * 4, level * 4 + 4));

describe('ostromoukhov — the variable-coefficient table', () => {
    it('holds four coefficients for each of the 256 source levels', () => {
        expect(OSTROMOUKHOV_COEFFICIENTS).toHaveLength(1024);
        expect(OSTROMOUKHOV_COEFFICIENTS).toBeInstanceOf(Uint16Array);
    });

    it('keeps `i_sum` equal to the three taps in every row', () => {
        // The engine relies on this: it is what makes the remainder tap exact.
        for (let level = 0; level < 256; level++) {
            const [i_r, i_dl, i_d, i_sum] = coefRow(level);
            expect(i_sum, `level ${level}`).toBe(i_r! + i_dl! + i_d!);
        }
    });

    it('is antisymmetric: row(i) equals row(255 - i)', () => {
        for (let level = 0; level < 256; level++) {
            expect(coefRow(level), `level ${level}`).toEqual(coefRow(255 - level));
        }
    });

    it('never divides by zero, and always has a forward tap', () => {
        // `i_sum >= 2` everywhere, so the engine's `diff / i_sum` needs no guard;
        // `i_r > 0` everywhere, so every emitting pixel feeds the forward tap.
        for (let level = 0; level < 256; level++) {
            const [i_r, , , i_sum] = coefRow(level);
            expect(i_sum, `level ${level}`).toBeGreaterThanOrEqual(2);
            expect(i_r, `level ${level}`).toBeGreaterThan(0);
        }
    });

    it('pins the reference rows exactly', () => {
        for (const [level, row] of Object.entries(REFERENCE_ROWS)) {
            expect(coefRow(Number(level)), `level ${level}`).toEqual(row);
        }
        // The two rows the hand-derived cases below depend on, called out so a
        // transcription error cannot hide behind the loop.
        expect(coefRow(64)).toEqual([1, 1, 0, 2]);
        expect(coefRow(88)).toEqual([185, 62, 53, 300]);
        expect(coefRow(100)).toEqual([5, 3, 2, 10]);
        expect(coefRow(127)).toEqual([4, 1, 1, 6]);
    });
});

describe('ostromoukhov — hand-derived cases (independent of the engine)', () => {
    // Every expectation below is traced from the prose kernel, not read off the
    // implementation: row 64 is (i_r, i_dl, i_d, i_sum) = (1,1,0,2), so
    // `term_r = term_dl = diff/2` and `term_d = 0`.
    it('2×2 all-64, serpentine: (0,0)=black, (1,0)=black, (0,1)=white, (1,1)=black', () => {
        // Row 0 (`dir = +1`):
        //   (0,0) 64 → 0,   err  64 → +32 at (1,0), +32 at (-1,1) dropped
        //   (1,0) 96 → 0,   err  96 → +48 at (2,0) dropped, +48 at (0,1)
        // Row 1 reverses (`dir = -1`, x runs 1 → 0):
        //   (1,1) 64 → 0,   err  64 → +32 at (0,1), +32 at (2,2) dropped
        //   (0,1) 64+48+32 = 144 → 255, err -111 → -55.5 at (-1,1)/(1,2), dropped
        expect(run(ostromoukhov, uniform(2, 2, 64), { threshold: 128, gamma: 1, strength: 1 })).toEqual([
            BLACK,
            BLACK,
            WHITE,
            BLACK,
        ]);
    });

    it('the same plane with `serpentine: false` stays all black (a deviation from the paper)', () => {
        // Row 1 now scans 0 → 1: (0,1) 112 → 0, err 112 → +56 at (1,1);
        // (1,1) 120 → 0. The whole plane stays black, so the two modes differ.
        expect(
            run(ostromoukhov, uniform(2, 2, 64), {
                threshold: 128,
                gamma: 1,
                strength: 1,
                serpentine: false,
            }),
        ).toEqual([BLACK, BLACK, BLACK, BLACK]);
    });

    it('2×2 all-100 exercises the remainder tap (row 100 = 5,3,2,10)', () => {
        // term_r = diff/2, term_dl = 3·diff/10, term_d = diff/5.
        //   (0,0) 100 → 0,   err 100 → +50 at (1,0), +20 at (0,1)
        //   (1,0) 150 → 255, err -105 → -31.5 at (0,1), -21 at (1,1)
        //   (1,1)  79 → 0,   err  79 → +39.5 at (0,1)
        //   (0,1) 100+20-31.5+39.5 = 128 → 255
        // Drop `term_d` and (0,1) only reaches 100+0-31.5+50 = 118.5, i.e. black:
        // this plane is the witness that the remainder is really distributed.
        expect(run(ostromoukhov, uniform(2, 2, 100), { threshold: 128, gamma: 1, strength: 1 })).toEqual([
            BLACK,
            WHITE,
            WHITE,
            BLACK,
        ]);
    });

    it('conserves the diffused error: ink balance closes against the hand-traced leakage', () => {
        // With `strength: 1`: Σ intensity = Σ source − (net error that left the
        // raster), because every pixel's three taps sum to exactly `diff`.
        // Hand trace of the 2×2 all-100 plane above, tap by tap, emitted then
        // received:
        //   (0,0) emits 100 →    +50 → (1,0) received, +20 → (0,1) received,
        //                        +30 → (-1,1) leaked
        //   (1,0) emits -105 →   -52.5 → (2,0) leaked, -31.5 → (0,1) received,
        //                        -21 → (1,1) received
        //   (1,1) emits  79 →    +39.5 → (0,1) received, +23.7 → (2,2) leaked,
        //                        +15.8 → (1,2) leaked
        //   (0,1) emits -127 →   -63.5, -38.1, -25.4 → all leaked
        // Σ source = 400, Σ ink = 2 × 255 = 510, and the leak is
        // 30 - 52.5 + 23.7 + 15.8 - 63.5 - 38.1 - 25.4 = -110 → 400 - (-110) = 510. ✓
        const pixels = run(ostromoukhov, uniform(2, 2, 100), {
            threshold: 128,
            gamma: 1,
            strength: 1,
        });
        const source = 4 * 100;
        const ink = pixels.filter(([r]) => r === 255).length * 255;
        const leaked = 30 - 52.5 + 23.7 + 15.8 - 63.5 - 38.1 - 25.4;
        expect(ink).toBe(source - leaked);
    });
});

describe('ostromoukhov — golden rasters', () => {
    /** 16×16 diagonal ramp (`(x*16 + y*16) % 256`): a wrapped grey gradient. */
    const gradient16 = (() => {
        const values: number[] = [];
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) values.push((x * 16 + y * 16) % 256);
        }
        return fromGrays(16, 16, values);
    })();

    it('pins the 16×16 gradient plane', () => {
        const pixels = run(ostromoukhov, gradient16, { threshold: 128, gamma: 1, strength: 1 });
        expect(bitRows(pixels, 16)).toEqual([
            '0000001010110111',
            '0001001011011110',
            '0010010101111100',
            '0001010110111000',
            '0101011011110000',
            '1001010111100000',
            '0101110111000001',
            '0101011110000100',
            '1011111100000101',
            '0110101000010010',
            '1101110000010010',
            '0111100010010101',
            '1111000000101011',
            '1110000100101101',
            '1100000101010111',
            '1000010001011011',
        ]);
        // The ink rate tracks the source: 121 white pixels × 255 = 30855 against
        // Σ source 30720, i.e. ink exceeds source by 135. Sign convention here is
        // `ink × 255 − Σ source`, so +135 is the net error the heavy end pushed
        // off the raster edge; the plane is a faithful 1-bit reduction.
        const ink = pixels.filter(([r]) => r === 255).length;
        expect(ink).toBe(121);
        expect(ink * 255 - 30720).toBe(135);
    });

    it('all-255 and all-0 planes are exact (no error to diffuse)', () => {
        expect(run(ostromoukhov, uniform(4, 4, 255))).toEqual(new Array(16).fill(WHITE));
        expect(run(ostromoukhov, uniform(4, 4, 0))).toEqual(new Array(16).fill(BLACK));
    });

    it('every output pixel is an exact 0/255 triplet and alpha survives', () => {
        const fixture = uniform(4, 4, 100);
        for (let i = 3; i < fixture.data.length; i += 4) fixture.data[i] = 42;
        const copy = clone(fixture);
        ostromoukhov(copy);
        for (const pixel of pixelsOf(copy)) expect(isBitPixel(pixel)).toBe(true);
        for (let i = 3; i < copy.data.length; i += 4) expect(copy.data[i]).toBe(42);
    });

    it('differs from the fixed-kernel diffusers on the shared ramp', () => {
        for (const other of [floydSteinberg, stucki, atkinson]) {
            expect(run(ostromoukhov, ramp)).not.toEqual(run(other, ramp));
        }
    });

    it('binds to the projection seam (`colorSpace`) like the other quantizers', () => {
        expect(run(ostromoukhov, ramp, { colorSpace: inverted })).not.toEqual(
            run(ostromoukhov, ramp),
        );
    });
});

describe('ostromoukhov — options', () => {
    it('`strength: 0` degenerates to the point threshold at a positive cutoff', () => {
        // No error is distributed, so the scan order stops mattering and every
        // pixel is classified independently: at any cutoff above 0 this equals the
        // `threshold` quantizer, source-0 pixels included (both put those black).
        // The one exception is a non-positive cutoff, where the source-0 output
        // quirk still bites; it is tested separately below.
        // An identity projection is used because the Float32
        // working plane rounds the Mono knife edge (`127.99999999999999 → 128`).
        expect(run(ostromoukhov, ramp, { strength: 0, colorSpace: exactGray })).toEqual(
            run(threshold, ramp, { colorSpace: exactGray }),
        );
        const gradient = fromGrays(
            8,
            8,
            Array.from({ length: 64 }, (_, i) => (i * 4) % 256),
        );
        expect(run(ostromoukhov, gradient, { strength: 0, colorSpace: exactGray })).toEqual(
            run(threshold, gradient, { colorSpace: exactGray }),
        );
    });

    it('`strength: 0` at a non-positive cutoff still forces a source-0 pixel black', () => {
        // The reference's output quirk (`make_output:522-524`) is applied after
        // the classification and is independent of `strength`, so it survives the
        // `strength: 0` degeneracy: at `threshold: 0` a source-0 pixel is
        // classified WHITE yet written BLACK, while the plain `threshold`
        // quantizer writes WHITE. This is the single exception to the
        // `strength: 0 ≡ threshold` equivalence — deliberate reference fidelity,
        // not a bug.
        expect(run(ostromoukhov, fromGrays(1, 1, [0]), { strength: 0, threshold: 0 })).toEqual([
            BLACK,
        ]);
        expect(run(threshold, fromGrays(1, 1, [0]), { threshold: 0 })).toEqual([WHITE]);
    });

    it('a custom threshold moves the cutoff without disturbing the scan', () => {
        // A dark plane keeps its error but loses ink when the cutoff drops: the
        // cutoff only moves which side of the classify step a pixel lands on.
        const plane = uniform(4, 4, 100);
        const black = (cutoff: number): number =>
            run(ostromoukhov, plane, { threshold: cutoff, gamma: 1, strength: 1 }).filter(
                ([r]) => r === 0,
            ).length;
        expect(black(100)).toBeLessThan(black(128));
        expect(black(128)).toBeGreaterThan(black(90));
    });

    it('the cutoff differs from the reference in the half-open band `(127.5, 128)`', () => {
        // The reference is `double` with a half-integer cutoff and classifies
        // `corrected_level <= 127.5` (`varcoeffED.c:32`, `:516`), so 127.6 is
        // WHITE there. This engine's uniform `< threshold` convention puts the
        // same value on the BLACK side at the default cutoff. The deviation is
        // deliberate — one cutoff semantic for every strategy, so `strength: 0`
        // stays identical to the `threshold` quantizer — and is pinned here so it
        // reads as a decision, not an accident.
        const band: ColorSpace = { id: 'mono', toGray: () => 127.6 };
        expect(
            run(ostromoukhov, fromGrays(1, 1, [0]), { colorSpace: band, gamma: 1 }),
            'in the band: ours BLACK, the reference would emit WHITE',
        ).toEqual([BLACK]);
    });

    it('serpentine defaults to true, and off changes the plane', () => {
        expect(run(ostromoukhov, ramp)).toEqual(run(ostromoukhov, ramp, { serpentine: true }));
        expect(run(ostromoukhov, ramp)).not.toEqual(
            run(ostromoukhov, ramp, { serpentine: false }),
        );
    });

    it('defaults every option exactly like `createDiffuser` (128 / 1 / true / neutral gamma)', () => {
        // An explicit set of engine defaults must be byte-identical to omitting
        // the options object, so nothing is silently inherited.
        expect(
            run(ostromoukhov, ramp, { threshold: 128, strength: 1, serpentine: true, gamma: 1 }),
        ).toEqual(run(ostromoukhov, ramp));
    });

    it('the tone curve selects a different coefficient row (level 64 → 88 at gamma 1.3)', () => {
        // W1's LUT maps the 64 source level to 88, and row 88 is a different
        // kernel, so the curve really reaches the table rather than the plane.
        expect(buildToneLut(1.3)[64]).toBe(88);
        expect(coefRow(88)).not.toEqual(coefRow(64));
        // The hand-traced 2×2 all-64 plane flips: (1,0) becomes the white pixel.
        // Row 88 = 185,62,53,300 → (1,0) reaches 88 + 185·88/300 = 142.27 ≥ 128
        // → white, while (0,1) ends at 122.23 → black.
        // (0,1) collects the three taps that reach it:
        //   88 + 15.547 (remainder from (0,0)) − 23.296 (down-left from (1,0))
        //      + 41.983 (forward tap from (1,1)) = 122.234 → black.
        expect(
            run(ostromoukhov, uniform(2, 2, 64), { threshold: 128, gamma: 1.3, strength: 1 }),
        ).toEqual([BLACK, WHITE, BLACK, BLACK]);
        expect(
            run(ostromoukhov, uniform(2, 2, 64), { threshold: 128, gamma: 1, strength: 1 }),
        ).toEqual([BLACK, BLACK, WHITE, BLACK]);
    });

    it('gamma 1 is byte-identical to omitting the option', () => {
        expect(run(ostromoukhov, ramp, { gamma: 1 })).toEqual(run(ostromoukhov, ramp));
    });

    it('a non-finite gamma stays neutral, never an all-black plane', () => {
        for (const gamma of [NaN, Infinity, -Infinity]) {
            expect(run(ostromoukhov, ramp, { gamma })).toEqual(run(ostromoukhov, ramp));
        }
    });

    it('replicates the reference output quirk: a source-0 pixel is forced black', () => {
        // `make_output:522-524` writes BLACK when the *source* level is 0 even
        // though `intensity` came out WHITE, while `diff` is still computed from
        // the un-forced intensity. Levels 0 and 1 share the row (13,0,5,18), so
        // swapping the 0 for a 1 changes nothing except the quirk: the plane
        // flips from black to white at that pixel.
        const base = [64, 64, 0, 127];
        expect(run(ostromoukhov, fromGrays(2, 2, base), { threshold: 128, gamma: 1 })).toEqual([
            BLACK,
            BLACK,
            BLACK,
            BLACK,
        ]);
        expect(
            run(
                ostromoukhov,
                fromGrays(2, 2, [64, 64, 1, 127]),
                { threshold: 128, gamma: 1 },
            ),
        ).toEqual([BLACK, BLACK, WHITE, BLACK]);
    });
});

describe('createVariableDiffuser', () => {
    it('returns an independent quantizer per call', () => {
        const first = createVariableDiffuser();
        const second = createVariableDiffuser();
        expect(first).not.toBe(second);
        expect(run(first, ramp)).toEqual(run(second, ramp));
        expect(run(first, ramp)).toEqual(run(ostromoukhov, ramp));
    });
});

