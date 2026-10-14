import { describe, expect, it } from 'vitest';
import { createFtagSpareDoc } from '../factory';
import { ftagSpareGuides, ftagSpareRegions } from './f-tag-spare';
import { PAPER_TYPE_SEEDS } from './index';
import { pointInUnion } from './point-in-region';

/** The helper's arithmetic is pinned by the shared `point-in-region` module. */

describe('F-tag spare preset (ftagSpare-25x78)', () => {
    it('reproduces the backing size and all three raw regions exactly', () => {
        const doc = createFtagSpareDoc({ name: 'F-tag' });
        expect(doc.label.backingW).toBe(2500);
        expect(doc.label.backingH).toBe(7800);
        expect(doc.label.regions).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 2500, h: 3800, r: 200 },
            { kind: 'roundedRect', x: 0, y: 3800, w: 1500, h: 4000, r: 200 },
            { kind: 'roundedRect', x: 1500, y: 0, w: 725, h: 7800, r: 200 },
        ]);
    });

    it('pins the caliper geometry exactly (three roundedRect regions, x/y/w/h/r)', () => {
        // Pin every field so a future edit cannot silently reshape the preset.
        expect(ftagSpareRegions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 2500, h: 3800, r: 200 },
            { kind: 'roundedRect', x: 0, y: 3800, w: 1500, h: 4000, r: 200 },
            { kind: 'roundedRect', x: 1500, y: 0, w: 725, h: 7800, r: 200 },
        ]);
        expect(ftagSpareRegions()).toHaveLength(3);
        // The registry must expose the same regions the module builds.
        expect(PAPER_TYPE_SEEDS['ftagSpare-25x78'].regions).toEqual(ftagSpareRegions());
    });

    it('is registered under the expected preset id', () => {
        expect(PAPER_TYPE_SEEDS['ftagSpare-25x78'].backingW).toBe(2500);
        expect(PAPER_TYPE_SEEDS['ftagSpare-25x78'].backingH).toBe(7800);
    });

    it('returns a fresh region array each call', () => {
        expect(ftagSpareRegions()).not.toBe(ftagSpareRegions());
        expect(ftagSpareRegions()).toEqual(ftagSpareRegions());
    });

    it('carries the fold score line as a guide, never as a region', () => {
        // Owner-pinned vertical semi-cut: x = 1250, y = 0…3800 hm.
        expect(ftagSpareGuides()).toEqual([
            { id: 'ftag-spare-score', kind: 'score', line: { x1: 1250, y1: 0, x2: 1250, y2: 3800 } },
        ]);
        expect(ftagSpareGuides()).not.toBe(ftagSpareGuides());
        // The registry must expose the same guides the module builds.
        expect(PAPER_TYPE_SEEDS['ftagSpare-25x78'].guides).toEqual(ftagSpareGuides());
        // A guide is not geometry: no region matches the score segment.
        expect(
            ftagSpareRegions().some(
                (r) => r.kind === 'roundedRect' && r.x === 1250 && r.y === 0 && r.h === 3800,
            ),
        ).toBe(false);
    });
});

describe('F-tag spare preset union coverage (caliper geometry)', () => {
    it('covers the flag/tail overlap seam without a hole', () => {
        const regions = ftagSpareRegions();
        // flag (0..2500 × 0..3800) and tail (1500..2225 × 0..7800) intersect in
        // x 1500..2225, y 0..3800; points in that band are inside both regions,
        // which is what keeps this seam hole-free.
        expect(pointInUnion(1800, 1900, regions), '(1800,1900) flag/tail overlap').toBe(true);
        expect(pointInUnion(1600, 3750, regions), '(1600,3750) flag/tail overlap near flag corner').toBe(true);
    });

    it('covers each block interior and the abutting seam mid-spans', () => {
        const regions = ftagSpareRegions();
        expect(pointInUnion(600, 1900, regions), '(600,1900) flag interior').toBe(true);
        expect(pointInUnion(750, 3800, regions), '(750,3800) flag/spare seam').toBe(true);
        expect(pointInUnion(750, 5800, regions), '(750,5800) spare interior').toBe(true);
        expect(pointInUnion(1500, 6000, regions), '(1500,6000) spare/tail seam').toBe(true);
        expect(pointInUnion(1875, 5700, regions), '(1875,5700) tail interior').toBe(true);
    });

    it('excludes the lower-right notch (intent: cut OUT of the silhouette)', () => {
        const regions = ftagSpareRegions();
        expect(pointInUnion(2400, 4000, regions), '(2400,4000) notch top').toBe(false);
        expect(pointInUnion(2400, 7700, regions), '(2400,7700) notch bottom').toBe(false);
    });

    it('reads the preset, not a private copy of the numbers', () => {
        // Guards the exact "dishonest test" failure: if this hardcoded the
        // regions it could pass while the preset regressed. It must be the same
        // array the registry ships.
        expect(pointInUnion(1800, 1900, PAPER_TYPE_SEEDS['ftagSpare-25x78'].regions)).toBe(true);
    });
});
