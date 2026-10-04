import { describe, expect, it } from 'vitest';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { createFtagSpareDoc, createLabelDoc } from '../../core/doc/factory';
import { regionUnionBounds } from '../../core/doc/derive';
import {
    nodesIntersectNonPrintable,
    pointInRegion,
    pointInUnion,
    regionUnionPath,
    resolveRegionOverlay,
    type UnionSubpath,
} from './regionOverlay';

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

    it('clamps an over-large rounded-rect radius like the tracer', () => {
        // r=100 on a 10×10 box clamps to 5, so the centre is inside. Without the
        // clamp the corner discs sit at (100,100) and exclude the whole box.
        const region: Region = { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 100 };
        expect(pointInRegion(5, 5, region)).toBe(true);
    });

    it('rejects non-drawable regions like the clip', () => {
        expect(pointInRegion(0, 0, { kind: 'rect', x: 0, y: 0, w: 0, h: 10 }), 'zero-width rect').toBe(false);
        expect(pointInRegion(0, 0, { kind: 'roundedRect', x: 0, y: 0, w: 10, h: -1, r: 2 }), 'negative height').toBe(
            false,
        );
        expect(pointInRegion(0, 0, { kind: 'circle', cx: 0, cy: 0, r: 0 }), 'zero-radius circle').toBe(false);
        expect(
            pointInRegion(1, 1, { kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]], closed: false }),
            'open polygon',
        ).toBe(false);
        expect(
            pointInRegion(5, 5, { kind: 'polygon', points: [[0, 0], [5, 5], [10, 10]], closed: true }),
            'collinear polygon',
        ).toBe(false);
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

describe('regionUnionPath — silhouette subpaths', () => {
    it('returns a single closed rect subpath for one rect', () => {
        expect(regionUnionPath([{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }])).toEqual([
            { kind: 'rect', x: 0, y: 0, w: 1000, h: 500 },
        ]);
    });

    it('returns one subpath per overlapping rounded rect (union, not difference)', () => {
        const regions: Region[] = [
            { kind: 'roundedRect', x: 0, y: 0, w: 1000, h: 1000, r: 200 },
            { kind: 'roundedRect', x: 500, y: 0, w: 1000, h: 1000, r: 200 },
        ];
        const paths = regionUnionPath(regions);
        // Both contours survive: a single nonzero fill unions them, so the
        // overlap band (500..1000) is wound +2 and never becomes a hole.
        expect(paths).toHaveLength(2);
        expect(paths[0]).toMatchObject({ kind: 'roundedRect', r: 200 });
        expect(paths[1]).toMatchObject({ kind: 'roundedRect', x: 500 });
        // Deterministic and input order preserving.
        expect(regionUnionPath(regions)).toEqual(paths);
    });

    it('covers every region kind', () => {
        const kinds = regionUnionPath([
            { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
            { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 2 },
            { kind: 'circle', cx: 5, cy: 5, r: 3 },
            { kind: 'polygon', points: [[0, 0], [10, 0], [5, 10]], closed: true },
        ]).map((path) => path.kind);
        expect(kinds).toEqual(['rect', 'roundedRect', 'circle', 'polygon']);
    });

    it('drops a degenerate polygon (fewer than 3 points)', () => {
        expect(regionUnionPath([{ kind: 'polygon', points: [[0, 0], [1, 1]], closed: true }])).toEqual([]);
    });

    it('drops zero-area and open contours (no printable interior)', () => {
        expect(regionUnionPath([{ kind: 'rect', x: 0, y: 0, w: 0, h: 10 }])).toEqual([]);
        expect(regionUnionPath([{ kind: 'roundedRect', x: 0, y: 0, w: 10, h: 0, r: 2 }])).toEqual([]);
        expect(regionUnionPath([{ kind: 'circle', cx: 0, cy: 0, r: 0 }])).toEqual([]);
        // Collinear points: non-zero vertex count but no painted area.
        expect(
            regionUnionPath([{ kind: 'polygon', points: [[0, 0], [5, 5], [10, 10]], closed: true }]),
        ).toEqual([]);
        // An open polygon has no interior.
        expect(
            regionUnionPath([{ kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]], closed: false }]),
        ).toEqual([]);
    });

    it('keeps a self-intersecting bow-tie polygon (net area 0, nonzero fill paints)', () => {
        const bowTie: Region = { kind: 'polygon', points: [[0, 0], [10, 10], [10, 0], [0, 10]], closed: true };
        const paths = regionUnionPath([bowTie]);
        expect(paths).toHaveLength(1);
        expect(paths[0]).toMatchObject({ kind: 'polygon' });
        // Net signed area is 0, so winding is left as authored (not reversed).
        if (paths[0]?.kind === 'polygon') {
            expect(paths[0].points).toEqual([[0, 0], [10, 10], [10, 0], [0, 10]]);
        }
    });

    it('normalizes polygon winding to the rect/arc direction (S6)', () => {
        const pointsOf = (paths: UnionSubpath[]): [number, number][] =>
            (paths[0] as Extract<UnionSubpath, { kind: 'polygon' }>).points;
        // Same square, opposite input orientations.
        const forward = regionUnionPath([
            { kind: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true },
        ]);
        const reverse = regionUnionPath([
            { kind: 'polygon', points: [[0, 0], [0, 10], [10, 10], [10, 0]], closed: true },
        ]);
        expect(pointsOf(forward)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
        // The reverse-wound input is flipped to match, not passed through.
        expect(pointsOf(reverse)).toEqual([[10, 0], [10, 10], [0, 10], [0, 0]]);
        expect(regionUnionPath([{ kind: 'polygon', points: [[0, 0], [0, 10], [10, 10], [10, 0]], closed: true }])).toEqual(
            reverse,
        );
    });

    it('reads the F-tag preset: 3 subpaths and the expected union bounds', () => {
        const doc = createFtagSpareDoc({ nodes: [] });
        const regions = doc.label.regions;
        const paths = regionUnionPath(regions);
        expect(paths).toHaveLength(3);
        expect(paths.every((path) => path.kind === 'roundedRect')).toBe(true);

        // The `flag` block is full width, so the union bounding box spans the
        // whole backing; the lower-right notch is inside the box, not at its edge.
        const bounds = regionUnionBounds(regions);
        expect(bounds).toEqual({ x: 0, y: 0, w: 2500, h: 7800 });

        // Every contour lies inside the backing...
        const box = (path: UnionSubpath) => {
            switch (path.kind) {
                case 'rect':
                    return { minX: path.x, minY: path.y, maxX: path.x + path.w, maxY: path.y + path.h };
                case 'roundedRect':
                    return { minX: path.x, minY: path.y, maxX: path.x + path.w, maxY: path.y + path.h };
                case 'circle':
                    return { minX: path.cx - path.r, minY: path.cy - path.r, maxX: path.cx + path.r, maxY: path.cy + path.r };
                case 'polygon': {
                    const xs = path.points.map(([x]) => x);
                    const ys = path.points.map(([, y]) => y);
                    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
                }
            }
        };
        for (const path of paths) {
            const b = box(path);
            expect(b.minX).toBeGreaterThanOrEqual(0);
            expect(b.minY).toBeGreaterThanOrEqual(0);
            expect(b.maxX).toBeLessThanOrEqual(2500);
            expect(b.maxY).toBeLessThanOrEqual(7800);
        }

        // ...and the tail column stops at 2225, leaving the notch to its right.
        const tail = paths[2];
        expect(tail).toMatchObject({ kind: 'roundedRect', x: 1500, w: 725 });
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

    it('is silent when the regions have no drawable union', () => {
        // Only open/degenerate contours: the clip is a no-op, so keep-out is too.
        const regions: Region[] = [
            { kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]], closed: false },
            { kind: 'rect', x: 0, y: 0, w: 0, h: 1000 },
            { kind: 'circle', cx: 0, cy: 0, r: 0 },
        ];
        const doc = docWith(regions, [node({ id: 'anywhere', parentId: null, ...rect(5000, 5000, 100, 100) })]);
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
