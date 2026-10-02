import type { Region } from '../types';
import type { LabelPreset } from './types';

/**
 * Two identical 50×15 mm stickers stacked on one 5000×3000 hm (50×30 mm)
 * backing: the lower half abuts the upper half at y=1500. Each half is its own
 * rounded rectangle (r 200 hm / 2 mm), so the silhouette has corner "bites"
 * both at the four outer corners and at the seam — near x≈0 and x≈5000 the
 * outline dips inward where the two halves' rounded corners meet.
 *
 * `regions` is consumed only as `union(regions)` (decision 25); the union
 * outline is the intended silhouette.
 */
export const stacked50x15Regions = (): Region[] => [
    // upper sticker: 50×15 rounded
    { kind: 'roundedRect', x: 0, y: 0, w: 5000, h: 1500, r: 200 },
    // lower sticker: 50×15 rounded, stacked directly below
    { kind: 'roundedRect', x: 0, y: 1500, w: 5000, h: 1500, r: 200 },
];

export const stacked50x15Preset: LabelPreset = {
    id: 'stacked50x15',
    name: '2× Rounded 50×15 (50×30)',
    backingW: 5000,
    backingH: 3000,
    regions: stacked50x15Regions(),
};
