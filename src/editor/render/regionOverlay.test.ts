import { describe, expect, it } from 'vitest';
import type { ImageRef, LabelDoc, Node, Region } from '../../core/doc/types';
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

/** `docWith` plus recorded image refs (the keep-out reads their pixel size). */
const docWithImages = (regions: Region[], nodes: Node[], images: ImageRef[]): LabelDoc => {
    const doc = docWith(regions, nodes);
    doc.resources.images.push(...images);
    return doc;
};

const imageRef = (imageId: string, widthPx: number, heightPx: number): ImageRef => ({
    imageId,
    name: `${imageId}.png`,
    source: { kind: 'inline', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
    widthPx,
    heightPx,
});

const rect = (x: number, y: number, w: number, h: number): Record<string, unknown> => ({
    type: 'shape',
    shape: 'rectangle',
    visible: true,
    locked: false,
    transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w, h },
});

/** A sizeable image/qr/barcode leaf; keep-out only reads its box, not its payload. */
const symbol = (
    type: 'image' | 'qr' | 'barcode',
    x: number,
    y: number,
    w: number,
    h: number,
): Record<string, unknown> => ({
    type,
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

describe('nodesIntersectNonPrintable — contain-fit (keep-out false positive)', () => {
    it('does not flag a letterboxed qr whose square content is inside the region', () => {
        // 1000 wide × 4000 tall box at y=-1500: the raw box spans y −1500..2500
        // (outside), but the square content (side = min(1000,4000)) is centred at
        // local y 1500..2500 → world y 0..1000, exactly filling the region.
        const doc = docWith(square, [node({ id: 'qr', parentId: null, ...symbol('qr', 0, -1500, 1000, 4000) })]);
        // A qr defaults to a square even with no asset size…
        expect(nodesIntersectNonPrintable(doc)).toEqual([]);
        // …and honours a supplied square size.
        expect(nodesIntersectNonPrintable(doc, new Map([['qr', { widthPx: 128, heightPx: 128 }]]))).toEqual([]);
    });

    it('still flags a letterboxed qr whose square content pokes outside the region', () => {
        // Same 1000×4000 box, shifted so the centred square (local y 1500..2500)
        // lands at world y 500..1500 — half of it outside the 0..1000 region.
        const doc = docWith(square, [
            node({ id: 'qr-straddle', parentId: null, ...symbol('qr', 0, -1000, 1000, 4000) }),
        ]);
        expect(nodesIntersectNonPrintable(doc)).toEqual(['qr-straddle']);
        expect(
            nodesIntersectNonPrintable(doc, new Map([['qr-straddle', { widthPx: 128, heightPx: 128 }]])),
        ).toEqual(['qr-straddle']);
    });

    it('still flags a square qr that genuinely pokes outside the region', () => {
        // The drawn square equals the box here, so the raw and fitted bounds agree.
        const doc = docWith(square, [node({ id: 'qr-out', parentId: null, ...symbol('qr', 0, -500, 1000, 1000) })]);
        expect(nodesIntersectNonPrintable(doc)).toEqual(['qr-out']);
        expect(nodesIntersectNonPrintable(doc, new Map([['qr-out', { widthPx: 64, heightPx: 64 }]]))).toEqual([
            'qr-out',
        ]);
    });

    it('resolves an image fit from doc.resources.images even with no assetSizes', () => {
        // Box 1000×4000, source 400×100 (4:1): contain scale = 2.5, so the drawn
        // rect is 1000×250 centred at local y 1875..2125 → world y 0..250 with
        // `y=-1875`. The raw box (world y −1875..2125) would be flagged.
        const doc = docWithImages(
            square,
            [node({ id: 'img', parentId: null, imageId: 'img-1', ...symbol('image', 0, -1875, 1000, 4000) })],
            [imageRef('img-1', 400, 100)],
        );
        // Resolved synchronously from the recorded ref — NO `assetSizes` entry.
        expect(nodesIntersectNonPrintable(doc)).toEqual([]);
        // A stray `assetSizes` entry is ignored for images (qr/barcode use it).
        expect(nodesIntersectNonPrintable(doc, new Map([['img', { widthPx: 1, heightPx: 1 }]]))).toEqual([]);
    });

    it('falls back to the raw box for an image with no recorded ref', () => {
        const doc = docWith(square, [
            node({ id: 'img', parentId: null, imageId: 'missing', ...symbol('image', 0, -1875, 1000, 4000) }),
        ]);
        expect(nodesIntersectNonPrintable(doc)).toEqual(['img']);
    });

    it('samples the raw box for a stretch/cover image (both draw the full box)', () => {
        // Box 1000×4000 at y=-1500, source 400×100. A `contain` fit would sit
        // inside (world y 375..625), but `stretch`/`cover` fill the whole box and
        // genuinely poke outside the 0..1000 region, so they must be flagged.
        const makeDoc = (fit: 'stretch' | 'cover'): LabelDoc =>
            docWithImages(
                square,
                [node({ id: 'img', parentId: null, imageId: 'img-1', fit, ...symbol('image', 0, -1500, 1000, 4000) })],
                [imageRef('img-1', 400, 100)],
            );
        expect(nodesIntersectNonPrintable(makeDoc('stretch'))).toEqual(['img']);
        expect(nodesIntersectNonPrintable(makeDoc('cover'))).toEqual(['img']);
    });

    it('treats a non-positive qr size as absent (square content, no NaN bounds)', () => {
        // The square content fits the region, but a `{0,0}` size used to yield
        // `scale = Infinity` and NaN bounds, which falsely flagged the node.
        const doc = docWith(square, [node({ id: 'qr', parentId: null, ...symbol('qr', 0, -1500, 1000, 4000) })]);
        expect(nodesIntersectNonPrintable(doc, new Map([['qr', { widthPx: 0, heightPx: 0 }]]))).toEqual([]);
        // A partially non-positive size is treated as absent too.
        expect(nodesIntersectNonPrintable(doc, new Map([['qr', { widthPx: 128, heightPx: 0 }]]))).toEqual([]);
    });

    it('barcode without a known size keeps the raw-box behaviour', () => {
        // 1000×4000 box at y=-1500: a square fit would sit at world y 0..1000
        // (inside), but without an asset size the raw box is used and pokes out.
        const doc = docWith(square, [node({ id: 'bc', parentId: null, ...symbol('barcode', 0, -1500, 1000, 4000) })]);
        expect(nodesIntersectNonPrintable(doc)).toEqual(['bc']);
        // Supplying the size proves it was the fallback, not the geometry, that flagged it.
        expect(nodesIntersectNonPrintable(doc, new Map([['bc', { widthPx: 100, heightPx: 100 }]]))).toEqual([]);
    });
});
