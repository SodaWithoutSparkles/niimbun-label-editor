import { describe, expect, it } from 'vitest';
import {
    childrenFromParentId,
    effectiveLocked,
    effectiveTransform,
    effectiveVisible,
    localMatrix,
    multiplyMat2D,
    nodeLookup,
    regionBounds,
    regionUnionBounds,
} from './derive';
import type { Node } from './types';
import { PAPER_TYPE_SEEDS } from './paper-types';

const makeNode = (over: Record<string, unknown>): Node =>
    ({
        id: 'x',
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        ...over,
    }) as Node;

describe('childrenFromParentId', () => {
    it('returns direct children in document order', () => {
        const nodes = [
            makeNode({ id: 'root' }),
            makeNode({ id: 'a', parentId: 'root' }),
            makeNode({ id: 'b', parentId: 'root' }),
            makeNode({ id: 'c', parentId: 'a' }),
        ];
        expect(childrenFromParentId(nodes, 'root').map((n) => n.id)).toEqual(['a', 'b']);
        expect(childrenFromParentId(nodes, 'a').map((n) => n.id)).toEqual(['c']);
        expect(childrenFromParentId(nodes, null).map((n) => n.id)).toEqual(['root']);
    });
});

describe('effectiveVisible', () => {
    it('ANDs visibility up the parent chain', () => {
        const nodes = [
            makeNode({ id: 'root', visible: false }),
            makeNode({ id: 'child', parentId: 'root', visible: true }),
            makeNode({ id: 'grand', parentId: 'child', visible: true }),
        ];
        const byId = nodeLookup(nodes);
        expect(effectiveVisible(byId.get('root')!, byId)).toBe(false);
        expect(effectiveVisible(byId.get('child')!, byId)).toBe(false);
        expect(effectiveVisible(byId.get('grand')!, byId)).toBe(false);
    });

    it('treats a missing parent as visible and ignores a detached hidden child', () => {
        const child = makeNode({ id: 'child', parentId: 'ghost', visible: true });
        expect(effectiveVisible(child, nodeLookup([child]))).toBe(true);
        const hidden = makeNode({ id: 'hidden', visible: false });
        expect(effectiveVisible(hidden, nodeLookup([hidden]))).toBe(false);
    });

    it('does not recurse forever on a parentId cycle', () => {
        const a = makeNode({ id: 'a', parentId: 'b', visible: true });
        const b = makeNode({ id: 'b', parentId: 'a', visible: false });
        const byId = nodeLookup([a, b]);
        expect(() => effectiveVisible(a, byId)).not.toThrow();
        expect(effectiveVisible(a, byId)).toBe(false);
    });
});

describe('effectiveLocked', () => {
    it('ORs locking down the parent chain', () => {
        const nodes = [
            makeNode({ id: 'root', locked: true }),
            makeNode({ id: 'child', parentId: 'root', locked: false }),
            makeNode({ id: 'other', locked: false }),
        ];
        const byId = nodeLookup(nodes);
        expect(effectiveLocked(byId.get('root')!, byId)).toBe(true);
        expect(effectiveLocked(byId.get('child')!, byId)).toBe(true);
        expect(effectiveLocked(byId.get('other')!, byId)).toBe(false);
    });
});

describe('effectiveTransform', () => {
    it('returns identity for a detached identity node', () => {
        const node = makeNode({ id: 'n' });
        expect(effectiveTransform(node, nodeLookup([node]))).toEqual({
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            e: 0,
            f: 0,
        });
    });

    it('adds parent and child translations when unrotated', () => {
        const parent = makeNode({ id: 'p', transform: { x: 100, y: 200, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const child = makeNode({ id: 'c', parentId: 'p', transform: { x: 10, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const byId = nodeLookup([parent, child]);
        expect(effectiveTransform(child, byId)).toMatchObject({ e: 110, f: 220 });
    });

    it('rotates a child translation by the parent transform', () => {
        const parent = makeNode({ id: 'p', transform: { x: 0, y: 0, rotDeg: 90, scaleX: 1, scaleY: 1 } });
        const child = makeNode({ id: 'c', parentId: 'p', transform: { x: 10, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const byId = nodeLookup([parent, child]);
        const matrix = effectiveTransform(child, byId);
        expect(matrix.e).toBeCloseTo(0, 10);
        expect(matrix.f).toBeCloseTo(10, 10);
    });

    it('scales a child translation by the parent scale', () => {
        const parent = makeNode({ id: 'p', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 2, scaleY: 3 } });
        const child = makeNode({ id: 'c', parentId: 'p', transform: { x: 10, y: 10, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const byId = nodeLookup([parent, child]);
        expect(effectiveTransform(child, byId)).toMatchObject({ e: 20, f: 30 });
    });

    it('composes three levels', () => {
        const root = makeNode({ id: 'r', transform: { x: 100, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const mid = makeNode({ id: 'm', parentId: 'r', transform: { x: 10, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const leaf = makeNode({ id: 'l', parentId: 'm', transform: { x: 1, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const byId = nodeLookup([root, mid, leaf]);
        expect(effectiveTransform(leaf, byId).e).toBe(111);
    });
});

describe('localMatrix / multiplyMat2D', () => {
    it('builds a rotation matrix', () => {
        const m = localMatrix({ x: 0, y: 0, rotDeg: 90, scaleX: 1, scaleY: 1 });
        expect(m.a).toBeCloseTo(0, 10);
        expect(m.b).toBeCloseTo(1, 10);
        expect(m.c).toBeCloseTo(-1, 10);
        expect(m.d).toBeCloseTo(0, 10);
    });

    it('identity is the multiplicative unit', () => {
        const m = localMatrix({ x: 3, y: 4, rotDeg: 30, scaleX: 2, scaleY: 5 });
        const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        expect(multiplyMat2D(identity, m)).toEqual(m);
        expect(multiplyMat2D(m, identity)).toEqual(m);
    });
});

describe('regionBounds / regionUnionBounds', () => {
    it('computes bounds per region kind', () => {
        expect(regionBounds({ kind: 'rect', x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
        expect(regionBounds({ kind: 'circle', cx: 10, cy: 10, r: 5 })).toEqual({ x: 5, y: 5, w: 10, h: 10 });
        expect(
            regionBounds({ kind: 'polygon', points: [[0, 0], [10, 0], [10, 4]], closed: true }),
        ).toEqual({ x: 0, y: 0, w: 10, h: 4 });
    });

    it('returns undefined for empty input', () => {
        expect(regionUnionBounds([])).toBeUndefined();
        expect(regionUnionBounds([{ kind: 'polygon', points: [], closed: true }])).toBeUndefined();
    });

    it('ignores zero-area and open regions (no printable area)', () => {
        expect(regionUnionBounds([{ kind: 'rect', x: 0, y: 0, w: 0, h: 10 }])).toBeUndefined();
        expect(regionUnionBounds([{ kind: 'circle', cx: 0, cy: 0, r: 0 }])).toBeUndefined();
        expect(
            regionUnionBounds([{ kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]], closed: false }]),
        ).toBeUndefined();
        // A drawable region alongside a non-drawable one still yields the union.
        expect(
            regionUnionBounds([
                { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
                { kind: 'rect', x: 200, y: 200, w: 0, h: 50 },
            ]),
        ).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });

    it('includes a self-intersecting bow-tie polygon (net area 0 but paints)', () => {
        expect(
            regionUnionBounds([
                { kind: 'polygon', points: [[0, 0], [10, 10], [10, 0], [0, 10]], closed: true },
            ]),
        ).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    });

    it('unions mixed regions into an integer bounding rect', () => {
        const bounds = regionUnionBounds([
            { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
            { kind: 'circle', cx: 200, cy: 100, r: 25 },
            { kind: 'polygon', points: [[10, 10], [10, 300], [20, 300]], closed: true },
        ]);
        expect(bounds).toEqual({ x: 0, y: 0, w: 225, h: 300 });
    });

    it('reproduces the F-tag paper-type union', () => {
        // Read the real paper type, not a private copy of the region numbers: a
        // hardcoded copy could pass while the shipped geometry regressed.
        const bounds = regionUnionBounds(PAPER_TYPE_SEEDS['ftagSpare-25x78'].regions);
        expect(bounds).toEqual({ x: 0, y: 0, w: 2500, h: 7800 });
        expect(Number.isInteger(bounds?.x) && Number.isInteger(bounds?.w)).toBe(true);
    });
});
