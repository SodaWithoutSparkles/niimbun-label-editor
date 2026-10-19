import type { RgbaBuffer } from './colorspace';
import { preprocessGrey, projectGrey } from './preprocess';
import type { Quantizer, QuantizeOptions } from './quantize';

/**
 * Head-locked clustered-dot screentone (P4). Pure and headless — no React,
 * Konva or DOM, no document or store state.
 *
 * **Lattice coordinates, not pixel-space tables.** The screen cell is defined by
 * a primitive integer basis `(a, b)` and its perpendicular `(-b, a)`, not by a
 * float rotation of a pixel grid. For pixel `(x, y)`, `u = (a·x + b·y) / S` and
 * `v = (-b·x + a·y) / S` with `S = step · (a² + b²)`. Every numerator is an
 * integer, so the cell coordinates are exact for every basis — a rotated screen
 * (`14° = (4,1)`, `27° = (2,1)`, `45° = (1,1)`) tiles perfectly and never drifts
 * across a large raster. A pixel-space table indexed by `x % P` can only express
 * the axis-aligned 0° case.
 *
 * **Physical pitch, snapped at the raster dpi.** A halftone cell is a physical
 * property of the print grid: it must be an integer number of printer dots.
 * {@link screentoneSnap} takes the requested pitch in mm, converts it to dots at
 * the effective `dpi`, rounds it to the nearest integer lattice step, and snaps
 * **up** until the resulting physical pitch clears the advisory 0.4 mm floor.
 * The engine therefore renders at whatever dpi the caller supplies (the print
 * path uses the effective print dpi; thumbnails and the preview budget fallback
 * snap at their own dpi — accepted approximations, never head-locked).
 *
 * **A point op, immune to D-05.** Every pixel is decided from its own grey value
 * and its own cell coordinates: there is no error buffer, so nothing carries
 * across a policy-mask region edge. `applyPolicy` runs this over a fresh copy of
 * the frame per policy and scatters only that policy's pixels, exactly like
 * `threshold` — the seam drift is a diffuser property.
 *
 * **One table, every K.** The table's bucket edges come from the maximum
 * `SCREENTONE_MAX_LEVELS` (8), so its raw value spans the full 8-step domain. A
 * lower `levels` value rescales that raw rank into its own domain
 * (`min(levels - 2, floor(raw · (levels - 1) / (MAX_LEVELS - 1)))`) before the
 * `ink = rank < level` compare. Without the rescale, `level = levels - 1` would
 * only cover the first few max-K buckets and a K < 8 screen could never reach
 * solid ink. With it, `levels = 8` is the identity and every K reaches solid
 * ink at `level = levels - 1`.
 *
 * **Engine fallbacks vs policy defaults.** Called with no screentone knobs the
 * engine uses its neutral fallbacks — `2` levels, `0.5 mm`, `45°` — the binary
 * case. The render path does not rely on them: `core/render/policy.ts` resolves
 * every knob and normally supplies `4 / 0.5 mm / 45°` (`DEFAULT_SCREENTONE`).
 */

export type ScreentoneAngle = 0 | 14 | 27 | 45;

/** The four integer-lattice screen angles, ascending. */
export const SCREENTONE_ANGLES: readonly ScreentoneAngle[] = [0, 14, 27, 45];

export const SCREENTONE_LEVELS_MIN = 2;
export const SCREENTONE_LEVELS_MAX = 8;

export const SCREENTONE_PITCH_MM_MIN = 0.3;
export const SCREENTONE_PITCH_MM_MAX = 2.0;

/**
 * Rank-table depth. The table's bucket edges come from this maximum, so one
 * precomputed table serves every `levels` value in `[2, 8]`.
 */
export const SCREENTONE_MAX_LEVELS = 8;

/** Advisory physical floor for a printable screen: never snap below this. */
const SCREENTONE_ADVISORY_PITCH_MM = 0.4;

/** Primitive integer basis per angle: `(a, b)` and its perpendicular `(-b, a)`. */
const BASES: Record<ScreentoneAngle, readonly [number, number]> = {
    0: [1, 0],
    14: [4, 1],
    27: [2, 1],
    45: [1, 1],
};

/**
 * `|basis|` per angle. `Math.sqrt` (not `Math.hypot`) so the value is the
 * correctly-rounded IEEE result and the snap table is identical in every JS
 * engine.
 */
const BASIS_LENGTHS: Record<ScreentoneAngle, number> = {
    0: 1,
    14: Math.sqrt(17),
    27: Math.sqrt(5),
    45: Math.SQRT2,
};

/** Type guard for the four supported angles. */
export const isScreentoneAngle = (value: unknown): value is ScreentoneAngle =>
    value === 0 || value === 14 || value === 27 || value === 45;

const normalizeAngle = (value: unknown): ScreentoneAngle =>
    isScreentoneAngle(value) ? value : 45;

const clampLevels = (value: number | undefined): number => {
    const rounded =
        value === undefined || !Number.isFinite(value)
            ? SCREENTONE_LEVELS_MIN
            : Math.round(value);
    return Math.min(SCREENTONE_LEVELS_MAX, Math.max(SCREENTONE_LEVELS_MIN, rounded));
};

const clampPitchMm = (value: number | undefined): number => {
    const finite =
        value === undefined || !Number.isFinite(value) ? SCREENTONE_PITCH_MM_MIN : value;
    return Math.min(SCREENTONE_PITCH_MM_MAX, Math.max(SCREENTONE_PITCH_MM_MIN, finite));
};

/** A pitch snapped to an integer number of raster dots at a given dpi. */
export interface ScreentoneSnap {
    /** Physical cell period in dots: `step · |basis|` (fractional for rotated bases). */
    dots: number;
    /** The snapped physical pitch in mm, `dots · 25.4 / dpi`. */
    pitchMm: number;
    /** Integer lattice steps per cell along the basis. */
    step: number;
    /** The primitive integer basis `(a, b)` for the resolved angle. */
    basis: readonly [number, number];
}

/**
 * Snap a requested pitch (mm) to the nearest legal dot count at `dpi`:
 *
 *   `dotsPerMm = dpi / 25.4`
 *   `step = max(1, round(pitchMm · dotsPerMm / |basis|))`
 *
 * then step **up** while the resulting physical pitch is below the advisory
 * 0.4 mm floor — the snap never lands under it. `dots` is `step · |basis|` and
 * the returned `pitchMm` is `dots · 25.4 / dpi`.
 *
 * Throws a `RangeError` for a missing/non-finite/non-positive `dpi`: the pitch
 * cannot be snapped without a raster resolution.
 */
export const screentoneSnap = (
    pitchMm: number,
    angle: ScreentoneAngle,
    dpi: number,
): ScreentoneSnap => {
    if (!Number.isFinite(dpi) || dpi <= 0) {
        throw new RangeError(`screentoneSnap: dpi must be a finite number > 0 (got ${dpi})`);
    }
    const resolved = normalizeAngle(angle);
    const basis = BASES[resolved];
    const length = BASIS_LENGTHS[resolved];
    const dotsPerMm = dpi / 25.4;
    let step = Math.max(1, Math.round((clampPitchMm(pitchMm) * dotsPerMm) / length));
    while ((step * length * 25.4) / dpi < SCREENTONE_ADVISORY_PITCH_MM) step++;
    const dots = step * length;
    return { dots, pitchMm: (dots * 25.4) / dpi, step, basis };
};

/** Rank-table resolution (one bucket per cell edge, both axes). */
export const SCREENTONE_RANK_SIZE = 64;

/**
 * Deterministic clustered-dot rank table, `SCREENTONE_RANK_SIZE²` bytes.
 *
 * Each entry is the Euclidean distance from its cell sample to the cell centre
 * (wrap-aware across the cell edge), normalised to `[0, 1)`, and bucketed with
 * `SCREENTONE_MAX_LEVELS - 1` buckets (values `0 .. MAX_LEVELS - 2`). A low rank
 * is a cell centre (ink lands there first); a high rank is a cell corner (ink
 * lands last). Built once at module load with `Math.sqrt` only — no
 * `Math.random`, no trig, so the table is identical on every run and engine.
 */
const buildRankTable = (): Uint8Array => {
    const size = SCREENTONE_RANK_SIZE;
    const centre = 0.5;
    // hypot(0.5, 0.5) = sqrt(0.5): the farthest (corner) sample distance.
    const maxDistance = Math.sqrt(0.5);
    const buckets = SCREENTONE_MAX_LEVELS - 1;
    const maxRank = SCREENTONE_MAX_LEVELS - 2;
    const table = new Uint8Array(size * size);
    for (let iy = 0; iy < size; iy++) {
        const cv = (iy + 0.5) / size;
        let dy = Math.abs(cv - centre);
        if (dy > 0.5) dy = 1 - dy; // wrap-aware across the cell edge
        for (let ix = 0; ix < size; ix++) {
            const cu = (ix + 0.5) / size;
            let dx = Math.abs(cu - centre);
            if (dx > 0.5) dx = 1 - dx;
            const normalized = Math.sqrt(dx * dx + dy * dy) / maxDistance;
            const bucket = Math.floor(normalized * buckets);
            table[iy * size + ix] = Math.min(maxRank, Math.max(0, bucket));
        }
    }
    return table;
};

/** The fixed rank matrix; see {@link buildRankTable}. */
export const SCREENTONE_RANK_TABLE: Uint8Array = buildRankTable();

/**
 * Clustered-dot screentone quantizer.
 *
 * `projectGrey` → `preprocessGrey({ gamma })` (the P1 seam) → per pixel a
 * `levels`-step tone index `level = round((1 - grey/255) · (levels - 1))` and a
 * rank from the lattice cell, rescaled from the max-K table into this `levels`
 * domain → `ink = rank < level` → exact `0`/`255`.
 *
 * - `levels` clamps to `[2, 8]` (integer); an absent/non-finite value is the
 *   engine minimum `2`.
 * - `screentonePitchMm` clamps to `[0.3, 2.0]` mm, then snaps physically at
 *   `dpi` (see {@link screentoneSnap}).
 * - `screentoneAngle` must be one of the four; anything else falls back to 45°.
 * - `dpi` is **required** (finite, `> 0`) — a pitch cannot be head-locked
 *   without it. Missing/invalid throws a `RangeError`.
 * - `threshold`/`strength`/`serpentine` are ignored (a point op has no error to
 *   diffuse); `gamma` and `colorSpace` apply through the grey seam.
 *
 * Mutates `rgba` in place, preserves alpha, and returns the same buffer.
 */
export const screentone: Quantizer = (
    rgba: RgbaBuffer,
    options: QuantizeOptions = {},
): RgbaBuffer => {
    const { dpi } = options;
    if (dpi === undefined || !Number.isFinite(dpi) || dpi <= 0) {
        throw new RangeError(`screentone: dpi must be a finite number > 0 (got ${String(dpi)})`);
    }

    const levels = clampLevels(options.screentoneLevels);
    const pitchMm = clampPitchMm(options.screentonePitchMm);
    const angle = normalizeAngle(options.screentoneAngle);
    const { step } = screentoneSnap(pitchMm, angle, dpi);
    const [a, b] = BASES[angle];
    // Cell coordinates divide by the full lattice area, so a translation by one
    // cell vector (`step · (a, b)` or `step · (-b, a)`) advances exactly one
    // period and reproduces the plane.
    const s = step * (a * a + b * b);
    const maxLevel = levels - 1;
    const rankSize = SCREENTONE_RANK_SIZE;
    const rankTable = SCREENTONE_RANK_TABLE;
    // The table spans the max-K domain (`0 .. MAX_LEVELS - 2`); rescale each raw
    // value into this run's domain so `level = levels - 1` is solid ink for
    // every K. At `levels = MAX_LEVELS` this is the identity.
    const rankScale = maxLevel / (SCREENTONE_MAX_LEVELS - 1);
    const maxRank = maxLevel - 1;

    const { data, width, height } = rgba;
    const plane = projectGrey(rgba, options.colorSpace);
    preprocessGrey(plane, { gamma: options.gamma ?? 1 });
    const grey = plane.data;

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const u = (a * x + b * y) / s;
            const v = (-b * x + a * y) / s;
            const cu = u - Math.floor(u);
            const cv = v - Math.floor(v);
            // `round(c·R) % R` wraps the 1.0 sample back onto the 0.0 edge.
            const rawRank =
                rankTable[
                    ((Math.round(cv * rankSize) % rankSize) * rankSize +
                        (Math.round(cu * rankSize) % rankSize))
                ];
            const rank = Math.min(maxRank, Math.floor(rawRank * rankScale));
            const p = row + x;
            const level = Math.round((1 - grey[p] / 255) * maxLevel);
            const value = rank < level ? 0 : 255;
            const i = p * 4;
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
        }
    }

    return rgba;
};
