/**
 * Rotation normalization for stored/displayed degrees. Pure number math, no
 * imports: the caller decides where the value comes from or goes to.
 */

/**
 * Non-finite → 0. Values inside ±360 pass through raw (a stored 270 stays 270,
 * not −90) and are only rounded to 1 decimal. Anything beyond that is first
 * reduced by `% 360` (JS remainder keeps the sign: `400 → 40`, `-390 → -30`)
 * and then rounded. `-0` is folded into `0`.
 */
export function normalizeRotDeg(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const degrees = Math.abs(value) <= 360 ? value : value % 360;
    const rounded = Math.round(degrees * 10) / 10;
    return rounded === 0 ? 0 : rounded;
}
