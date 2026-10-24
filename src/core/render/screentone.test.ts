import { describe, expect, it } from 'vitest';
import type { RgbaBuffer } from './colorspace';
import {
    SCREENTONE_ANGLES,
    SCREENTONE_LEVELS_MAX,
    SCREENTONE_LEVELS_MIN,
    SCREENTONE_MAX_LEVELS,
    SCREENTONE_PITCH_MM_MAX,
    SCREENTONE_PITCH_MM_MIN,
    SCREENTONE_RANK_SIZE,
    SCREENTONE_RANK_TABLE,
    screentone,
    screentoneSnap,
    type ScreentoneAngle,
} from './screentone';

/** Uniform grey RGBA plane. */
const greyPlane = (width: number, height: number, grey: number): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < width * height; p++) {
        const i = p * 4;
        data[i] = grey;
        data[i + 1] = grey;
        data[i + 2] = grey;
        data[i + 3] = 255;
    }
    return { data, width, height };
};

const clone = (rgba: RgbaBuffer): RgbaBuffer => ({
    data: new Uint8ClampedArray(rgba.data),
    width: rgba.width,
    height: rgba.height,
});

const reds = (rgba: RgbaBuffer): number[] => {
    const out: number[] = [];
    for (let i = 0; i < rgba.data.length; i += 4) out.push(rgba.data[i]);
    return out;
};

const inkCount = (rgba: RgbaBuffer): number => reds(rgba).filter((r) => r === 0).length;

const run = (rgba: RgbaBuffer, opts: Parameters<typeof screentone>[1]): number[] => {
    const copy = clone(rgba);
    screentone(copy, opts);
    return reds(copy);
};

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

describe('screentoneSnap — physical pitch snapping', () => {
    it('300 dpi, 0°: 5/6/8/12 dots = 0.423/0.508/0.677/1.016 mm', () => {
        for (const [requested, dots, pitchMm] of [
            [0.42, 5, 0.423],
            [0.5, 6, 0.508],
            [0.67, 8, 0.677],
            [1.0, 12, 1.016],
        ] as const) {
            const snap = screentoneSnap(requested, 0, 300);
            expect(snap.step).toBe(dots);
            expect(snap.dots).toBe(dots);
            expect(round3(snap.pitchMm)).toBe(pitchMm);
            expect(snap.basis).toEqual([1, 0]);
        }
    });

    it('203 dpi, 0°: 4/6/8 dots = 0.500/0.751/1.001 mm', () => {
        for (const [requested, dots, pitchMm] of [
            [0.5, 4, 0.500],
            [0.75, 6, 0.751],
            [1.0, 8, 1.001],
        ] as const) {
            const snap = screentoneSnap(requested, 0, 203);
            expect(snap.step).toBe(dots);
            expect(snap.dots).toBe(dots);
            expect(snap.pitchMm).toBeCloseTo(pitchMm, 3);
        }
    });

    it('never snaps below the 0.4 mm advisory floor', () => {
        // 0.3 mm at 300 dpi rounds to 4 dots (0.339 mm) — the snap steps up.
        const floored = screentoneSnap(0.3, 0, 300);
        expect(floored.step).toBe(5);
        expect(floored.pitchMm).toBeGreaterThanOrEqual(0.4);
        for (const angle of SCREENTONE_ANGLES) {
            for (const dpi of [100, 203, 300, 600]) {
                for (let pitch = SCREENTONE_PITCH_MM_MIN; pitch <= SCREENTONE_PITCH_MM_MAX; pitch += 0.05) {
                    expect(
                        screentoneSnap(pitch, angle, dpi).pitchMm,
                        `${pitch} mm at ${angle}° / ${dpi} dpi`,
                    ).toBeGreaterThanOrEqual(0.4);
                }
            }
        }
    });

    it('rotated bases snap by whole lattice steps', () => {
        // 45°: |basis| = √2, so a 6-dot cell is step 4 (5.66 dots at 300 dpi).
        const diag = screentoneSnap(0.5, 45, 300);
        expect(diag.step).toBe(4);
        expect(diag.basis).toEqual([1, 1]);
        expect(diag.dots).toBeCloseTo(4 * Math.SQRT2, 12);
        expect(diag.pitchMm).toBeCloseTo((4 * Math.SQRT2 * 25.4) / 300, 12);

        expect(screentoneSnap(0.5, 14, 300).basis).toEqual([4, 1]);
        expect(screentoneSnap(0.5, 27, 300).basis).toEqual([2, 1]);
    });

    it('clamps the requested pitch into [0.3, 2.0] before snapping', () => {
        expect(screentoneSnap(0.01, 0, 300)).toEqual(screentoneSnap(0.3, 0, 300));
        expect(screentoneSnap(99, 0, 300)).toEqual(screentoneSnap(2.0, 0, 300));
    });

    it('throws for a missing/invalid dpi', () => {
        for (const dpi of [Number.NaN, 0, -1, Infinity]) {
            expect(() => screentoneSnap(0.5, 45, dpi)).toThrow(RangeError);
        }
    });
});

describe('rank table', () => {
    it('is a fixed 64×64 table of MAX_LEVELS-1 buckets', () => {
        expect(SCREENTONE_RANK_SIZE).toBe(64);
        expect(SCREENTONE_RANK_TABLE).toHaveLength(64 * 64);
        expect(SCREENTONE_MAX_LEVELS).toBe(8);
        for (const rank of SCREENTONE_RANK_TABLE) {
            expect(Number.isInteger(rank)).toBe(true);
            expect(rank).toBeGreaterThanOrEqual(0);
            expect(rank).toBeLessThanOrEqual(SCREENTONE_MAX_LEVELS - 2);
        }
    });

    it('puts the lowest rank at the cell centre and the highest at a corner', () => {
        const size = SCREENTONE_RANK_SIZE;
        const centre = (size / 2) * size + size / 2;
        expect(SCREENTONE_RANK_TABLE[centre]).toBe(0);
        expect(SCREENTONE_RANK_TABLE[0]).toBe(SCREENTONE_MAX_LEVELS - 2);
    });

    it('is deterministic (built once, no randomness)', () => {
        expect(screentoneSnap(0.5, 45, 300)).toEqual(screentoneSnap(0.5, 45, 300));
        const a = run(greyPlane(24, 24, 128), { dpi: 300, screentoneAngle: 45 });
        const b = run(greyPlane(24, 24, 128), { dpi: 300, screentoneAngle: 45 });
        expect(a).toEqual(b);
    });
});

describe('screentone — tone ramp', () => {
    const SIZE = 32;
    const TOTAL = SIZE * SIZE;
    const inkAt = (levels: number, grey: number): number =>
        inkCount(
            (() => {
                const plane = greyPlane(SIZE, SIZE, grey);
                screentone(plane, {
                    dpi: 300,
                    screentoneLevels: levels,
                    screentonePitchMm: 0.5,
                    screentoneAngle: 45,
                });
                return plane;
            })(),
        );

    it('K=4 gives four distinct densities, monotone from paper to ink', () => {
        const counts = [255, 170, 85, 0].map((grey) => inkAt(4, grey));
        expect(counts[0]).toBe(0); // paper
        for (let k = 1; k < counts.length; k++) {
            expect(counts[k]!, `tone ${k} is darker than ${k - 1}`).toBeGreaterThan(counts[k - 1]!);
        }
        expect(new Set(counts).size).toBe(4);
    });

    it('black (grey 0) is solid ink at every K — the rank is rescaled into the K domain', () => {
        for (const levels of [SCREENTONE_LEVELS_MIN, 4, SCREENTONE_LEVELS_MAX]) {
            expect(inkAt(levels, 0), `levels ${levels}`).toBe(TOTAL);
        }
    });

    it('mid-grey at K=4 inks some but not all of the cell', () => {
        const ink = inkAt(4, 128);
        expect(ink).toBeGreaterThan(0);
        expect(ink).toBeLessThan(TOTAL);
    });

    it('K=8 reaches solid at black; K=2 is a pure two-tone screen', () => {
        expect(inkAt(8, 0)).toBe(TOTAL);
        expect(inkAt(8, 255)).toBe(0);
        // At K=2 every pixel is either paper or solid ink (no partial cell).
        for (const grey of [0, 64, 127, 128, 192, 255]) {
            expect([0, TOTAL], `grey ${grey}`).toContain(inkAt(2, grey));
        }
        // ... and both tones are reachable.
        expect(inkAt(2, 0)).toBe(TOTAL);
        expect(inkAt(2, 255)).toBe(0);
    });

    it('clamps levels into [2,8]', () => {
        const plane = () => greyPlane(24, 24, 128);
        expect(run(plane(), { dpi: 300, screentoneLevels: 1, screentoneAngle: 45 })).toEqual(
            run(plane(), {
                dpi: 300,
                screentoneLevels: SCREENTONE_LEVELS_MIN,
                screentoneAngle: 45,
            }),
        );
        expect(run(plane(), { dpi: 300, screentoneLevels: 99, screentoneAngle: 45 })).toEqual(
            run(plane(), {
                dpi: 300,
                screentoneLevels: SCREENTONE_LEVELS_MAX,
                screentoneAngle: 45,
            }),
        );
    });

    it('falls back to 45° for an unsupported angle', () => {
        const plane = () => greyPlane(24, 24, 128);
        expect(
            run(plane(), {
                dpi: 300,
                screentoneAngle: 99 as unknown as ScreentoneAngle,
            }),
        ).toEqual(run(plane(), { dpi: 300, screentoneAngle: 45 }));
    });
});

describe('screentone — lattice periodicity', () => {
    it('0° at a 6-dot pitch is exactly periodic every 6 px', () => {
        const snap = screentoneSnap(0.5, 0, 300);
        expect(snap.step).toBe(6);
        const plane = greyPlane(12, 12, 128);
        screentone(plane, { dpi: 300, screentonePitchMm: 0.5, screentoneAngle: 0 });
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < 6; x++) {
                expect(plane.data[(y * 12 + x) * 4], `x period at (${x},${y})`).toBe(
                    plane.data[(y * 12 + x + 6) * 4],
                );
            }
        }
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 12; x++) {
                expect(plane.data[(y * 12 + x) * 4], `y period at (${x},${y})`).toBe(
                    plane.data[((y + 6) * 12 + x) * 4],
                );
            }
        }
    });

    it('translating by one cell lattice vector reproduces the plane, every angle', () => {
        const width = 40;
        const height = 40;
        for (const angle of SCREENTONE_ANGLES) {
            const snap = screentoneSnap(0.5, angle, 300);
            const [a, b] = snap.basis;
            const dx = snap.step * a;
            const dy = snap.step * b;
            const plane = greyPlane(width, height, 128);
            screentone(plane, {
                dpi: 300,
                screentonePitchMm: 0.5,
                screentoneAngle: angle,
            });
            for (let y = 0; y + dy < height; y++) {
                for (let x = 0; x + dx < width; x++) {
                    expect(
                        plane.data[((y + dy) * width + (x + dx)) * 4],
                        `${angle}° translation (${dx},${dy}) at (${x},${y})`,
                    ).toBe(plane.data[(y * width + x) * 4]);
                }
            }
        }
    });
});

describe('screentone — pinned 1-bit planes (dpi 300, pitch 0.5 mm, K=4)', () => {
    /** One 8×8 cell as glyph rows (`#` ink, `.` paper). */
    const cell = (grey: number, angle: ScreentoneAngle): string => {
        const plane = greyPlane(8, 8, grey);
        screentone(plane, {
            dpi: 300,
            screentoneLevels: 4,
            screentonePitchMm: 0.5,
            screentoneAngle: angle,
        });
        const rows: string[] = [];
        for (let y = 0; y < 8; y++) {
            let row = '';
            for (let x = 0; x < 8; x++) row += plane.data[(y * 8 + x) * 4] === 0 ? '#' : '.';
            rows.push(row);
        }
        return rows.join('\n');
    };

    it('45°: black is solid ink; mid-grey is a partial cluster; white is blank', () => {
        const SOLID = new Array(8).fill('########').join('\n');
        expect(cell(0, 45)).toBe(SOLID);
        expect(cell(128, 45)).toBe(
            ['...###..', '...###..', '........', '##.....#', '##.....#', '##.....#', '........', '...###..'].join(
                '\n',
            ),
        );
        expect(cell(255, 45)).toBe(new Array(8).fill('........').join('\n'));
    });

    it('0°: the same rank matrix on the axis-aligned lattice', () => {
        const SOLID = new Array(8).fill('########').join('\n');
        expect(cell(0, 0)).toBe(SOLID);
        expect(cell(128, 0)).toBe(
            ['........', '........', '..###...', '..###...', '..###...', '........', '........', '........'].join(
                '\n',
            ),
        );
    });
});

describe('screentone — boldness bias (P11)', () => {
    const midGrey = () => greyPlane(24, 24, 128);

    /** Ink pixel count for a mid-grey screen at 4 levels (a real cluster, not solid). */
    const inkAt = (boldness: number | undefined): number => {
        const redsOut = run(midGrey(), {
            dpi: 300,
            screentoneLevels: 4,
            screentonePitchMm: 0.5,
            screentoneAngle: 45,
            ...(boldness === undefined ? {} : { screentoneBoldness: boldness }),
        });
        return redsOut.filter((red) => red === 0).length;
    };

    it('boldness 0 and undefined produce identical buffers', () => {
        expect(run(midGrey(), { dpi: 300, screentoneBoldness: 0 })).toEqual(
            run(midGrey(), { dpi: 300 }),
        );
        expect(inkAt(0)).toBe(inkAt(undefined));
    });

    it('+1 inks strictly more pixels and -1 strictly fewer (mid-grey)', () => {
        expect(inkAt(1)).toBeGreaterThan(inkAt(0));
        expect(inkAt(-1)).toBeLessThan(inkAt(0));
    });

    it('clamps out-of-range values to the bounds', () => {
        expect(inkAt(-9)).toBe(inkAt(-1));
        expect(inkAt(9)).toBe(inkAt(1));
    });

    it('saturates a 2-level screen to solid ink at +1 (documented)', () => {
        // With 2 levels every mid-grey tone already rounds to level 0 or 1; a
        // +1 bias pushes the whole raster to `level = maxLevel` → solid black.
        const redsOut = run(midGrey(), {
            dpi: 300,
            screentoneLevels: 2,
            screentonePitchMm: 0.5,
            screentoneAngle: 45,
            screentoneBoldness: 1,
        });
        expect(redsOut.every((red) => red === 0)).toBe(true);
    });
});

describe('screentone — contract', () => {
    it('ignores strength (a point op has no diffusion)', () => {
        const plane = () => greyPlane(24, 24, 128);
        expect(run(plane(), { dpi: 300, strength: 0 })).toEqual(
            run(plane(), { dpi: 300, strength: 4 }),
        );
    });

    it('applies the tone curve (gamma changes the level index)', () => {
        const plane = greyPlane(24, 24, 128);
        expect(run(plane, { dpi: 300, gamma: 0.5 })).not.toEqual(
            run(plane, { dpi: 300, gamma: 2 }),
        );
    });

    it('writes exact 0/255 and preserves alpha', () => {
        const plane = greyPlane(16, 16, 128);
        for (let p = 0; p < plane.width * plane.height; p++) {
            plane.data[p * 4 + 3] = p % 256;
        }
        const returned = screentone(plane, { dpi: 300 });
        expect(returned).toBe(plane);
        for (let p = 0; p < plane.width * plane.height; p++) {
            const i = p * 4;
            expect([plane.data[i], plane.data[i + 1], plane.data[i + 2]]).toEqual(
                plane.data[i] === 0 ? [0, 0, 0] : [255, 255, 255],
            );
            expect(plane.data[i + 3]).toBe(p % 256);
        }
    });

    it('with no screentone knobs uses the engine fallbacks: 2 levels / 0.5 mm / 45°', () => {
        // The render path normally resolves 4 / 0.5 / 45 in the policy layer
        // (`DEFAULT_SCREENTONE`); the engine's own neutral fallback is the
        // binary screen, and it must not throw.
        const bare = run(greyPlane(24, 24, 64), { dpi: 300 });
        expect(bare).toEqual(
            run(greyPlane(24, 24, 64), {
                dpi: 300,
                screentoneLevels: 2,
                screentonePitchMm: 0.5,
                screentoneAngle: 45,
            }),
        );
        // K=2 below mid-grey is solid ink, not a partial cluster.
        expect(bare.every((red) => red === 0)).toBe(true);
    });

    it('throws a RangeError when dpi is missing or invalid', () => {
        for (const opts of [{}, { dpi: Number.NaN }, { dpi: 0 }, { dpi: -300 }, { dpi: Infinity }]) {
            expect(() => screentone(greyPlane(4, 4, 128), opts)).toThrow(RangeError);
        }
    });

    it('clamps the pitch before snapping (same plane as an in-range pitch)', () => {
        const plane = () => greyPlane(24, 24, 128);
        expect(
            run(plane(), { dpi: 300, screentonePitchMm: SCREENTONE_PITCH_MM_MIN - 0.2 }),
        ).toEqual(run(plane(), { dpi: 300, screentonePitchMm: SCREENTONE_PITCH_MM_MIN }));
        expect(
            run(plane(), { dpi: 300, screentonePitchMm: SCREENTONE_PITCH_MM_MAX + 10 }),
        ).toEqual(run(plane(), { dpi: 300, screentonePitchMm: SCREENTONE_PITCH_MM_MAX }));
    });
});
