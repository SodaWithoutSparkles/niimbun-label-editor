import { describe, expect, it } from 'vitest';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { createFtagSpareDoc, createLabelDoc } from '../../core/doc/factory';
import { regionUnionBounds } from '../../core/doc/derive';
import { nodesIntersectNonPrintable, pointInRegion, pointInUnion, resolveRegionOverlay } from './regionOverlay';

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const docWith = (regions: Region[], nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 4000, backingH: 4000, regions, nodes });

const rect = (x: number, y: number, w: number, h: number): Record<string, unknown> => ({
    type: 'shape',
    shape: 'rectangle',
    visible: true,
    locked: false,
    transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w, h },
});

const square: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }];

describe('pointInRegion / pointInUnion', () => {
    it('handles every region kind', () => {
        expect(pointInRegion(5, 5, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 })).toBe(true);
        expect(pointInRegion(50, 5, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 })).toBe(false);
        expect(pointInRegion(10, 10, { kind: 'circle', cx: 10, cy: 10, r: 5 })).toBe(true);
        expect(pointInRegion(16, 10, { kind: 'circle', cx: 10, cy: 10, r: 5 })).toBe(false);
        const poly: Region = { kind: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
        expect(pointInRegion(5, 5, poly)).toBe(true);
        expect(pointInRegion(15, 5, poly)).toBe(false);
        // The rounded corner disc is respected.
        expect(pointInRegion(0.5, 0.5, { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 3 })).toBe(false);
        expect(pointInRegion(3, 3, { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 3 })).toBe(true);
    });

    it('treats overlapping regions as a hole-free union (nonzero winding)', () => {
        const regions: Region[] = [
            { kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 },
            { kind: 'rect', x: 500, y: 0, w: 1000, h: 1000 },
        ];
        expect(pointInUnion(750, 500, regions), 'overlap band').toBe(true);
        expect(pointInUnion(250, 500, regions), 'left only').toBe(true);
        expect(pointInUnion(1200, 500, regions), 'right only').toBe(true);
        expect(pointInUnion(250, 1500, regions), 'below').toBe(false);
    });
});

describe('resolveRegionOverlay', () => {
    it('exposes the raw regions and their union bounds', () => {
        const doc = docWith(square, []);
        const overlay = resolveRegionOverlay(doc);
        expect(overlay.regions).toEqual(square);
        expect(overlay.unionBounds).toEqual(regionUnionBounds(square));
        expect(overlay.unionBounds).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    });

    it('returns undefined union bounds when there is no region', () => {
        expect(resolveRegionOverlay(docWith([], [])).unionBounds).toBeUndefined();
    });
});

describe('nodesIntersectNonPrintable — truth table', () => {
    it('inside / straddling / outside', () => {
        const doc = docWith(square, [
            node({ id: 'inside', parentId: null, ...rect(100, 100, 200, 200) }),
            node({ id: 'straddle', parentId: null, ...rect(-50, 100, 200, 200) }),
            node({ id: 'outside', parentId: null, ...rect(2000, 2000, 100, 100) }),
        ]);
        expect(nodesIntersectNonPrintable(doc)).toEqual(['straddle', 'outside']);
    });

    it('skips groups but checks their children with the parent transform', () => {
        const doc = docWith(square, [
            node({
                id: 'g',
                parentId: null,
                type: 'group',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            }),
            node({ id: 'g-in', parentId: 'g', ...rect(100, 100, 200, 200) }),
            node({ id: 'g-out', parentId: 'g', ...rect(900, 100, 200, 200) }),
        ]);
        // The group id never appears; only the offending child does.
        expect(nodesIntersectNonPrintable(doc)).toEqual(['g-out']);
    });

    it('is silent when the document declares no regions', () => {
        const doc = docWith([], [node({ id: 'a', parentId: null, ...rect(5000, 5000, 100, 100) })]);
        expect(nodesIntersectNonPrintable(doc)).toEqual([]);
    });

    it('reads the F-tag preset: inside the union is fine, the notch is not', () => {
        const doc = createFtagSpareDoc({
            nodes: [
                node({ id: 'good', parentId: null, ...rect(600, 1900, 200, 200) }),
                node({ id: 'notch', parentId: null, ...rect(2300, 4000, 100, 100) }),
            ],
        });
        expect(nodesIntersectNonPrintable(doc)).toEqual(['notch']);
    });

    it('keeps overlapping regions hole-free for containment', () => {
        const regions: Region[] = [
            { kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 },
            { kind: 'rect', x: 500, y: 0, w: 1000, h: 1000 },
        ];
        const doc = docWith(regions, [node({ id: 'span', parentId: null, ...rect(400, 400, 700, 200) })]);
        expect(nodesIntersectNonPrintable(doc)).toEqual([]);
    });
});
