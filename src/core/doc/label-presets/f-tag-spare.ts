import type { Region } from '../types';
import type { LabelPreset } from './types';

/**
 * F-tag spare preset regions, backing 2500×7800 hm (25×78 mm). Re-measured
 * with calipers (2026-10-03); the original numbers came from an outdated
 * assumption plus the seller's annotated picture.
 *
 * The label is the **union** of three rounded rectangles:
 *   - `flag`: the full-width upper block (0..2500 × 0..3800);
 *   - `spare`: the lower-left block (0..1500 × 3800..7800);
 *   - `tail`: the right column (1500..2225 × 0..7800), overlapping the flag's
 *     right band (y 0..3800) and abutting the spare's right edge.
 *
 * `regions` is consumed only as `union(regions)` (decision 25), so this is an
 * implementation detail: the union outline is the intended silhouette — a 25×78
 * backing with the lower-right notch (x > 2225, y > 3800) cut out and the tail
 * column printed. The flag/tail overlap keeps that seam hole-free; where blocks
 * only abut (flag/spare at y=3800, spare/tail at x=1500) the measured boxes
 * touch without overlap, so the outer corner point of such a seam sits outside
 * both blocks — see the union-coverage tests, which pin this outline as measured.
 *
 * The `flag`/`spare`/`tail` names are descriptive comments only — regions carry
 * no role/id (decision 25).
 */
export const ftagSpareRegions = (): Region[] => [
    // flag: the full-width upper block
    { kind: 'roundedRect', x: 0, y: 0, w: 2500, h: 3800, r: 200 },
    // spare: the lower-left block
    { kind: 'roundedRect', x: 0, y: 3800, w: 1500, h: 4000, r: 200 },
    // tail: the right column
    { kind: 'roundedRect', x: 1500, y: 0, w: 725, h: 7800, r: 200 },
];

export const ftagSparePreset: LabelPreset = {
    id: 'ftagSpare-25x78',
    name: 'F-tag spare 25×78',
    backingW: 2500,
    backingH: 7800,
    regions: ftagSpareRegions(),
};
