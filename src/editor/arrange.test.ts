import { describe, expect, it } from 'vitest';
import { centerOnSelectionLayout, distributeLayout } from './arrange';
import { nodeLookup } from '../core/doc/derive';
import type { Node } from '../core/doc/types';

/**
 * `distributeLayout` (P10 fix round): pure geometry for the distribute action.
 * The two extreme nodes (first / last by world centre along the axis) keep their
 * place; every interior node is moved so all centres are evenly spaced. Only the
 * moved interior nodes appear in the returned map, and geometry-less nodes
 * (groups) are ignored — same rule as `tileLayout`.
 */

const shape = (over: Record<string, unknown> = {}): Node =>
    ({
        id: 's',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 400, h: 300 },
        ...over,
    }) as unknown as Node;

const group = (id: string): Node =>
    ({
        id,
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    }) as unknown as Node;

const lookup = (...nodes: Node[]) => nodeLookup(nodes);

describe('distributeLayout — horizontal', () => {
    it('evenly spaces the interior node and leaves the extremes fixed', () => {
        const a = shape({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const b = shape({
            id: 'b',
            transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 300 },
        });
        const c = shape({
            id: 'c',
            transform: { x: 2000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 400, h: 300 },
        });

        const targets = distributeLayout([a, b, c], lookup(a, b, c), 'horizontal');

        // Centres: 200 / 1100 / 2200 → span 2000, step 1000 → interior centre 1200.
        expect(targets.get('b')).toEqual({ x: 1100, y: 0 });
        // Extremes keep their place: they are absent from the map entirely.
        expect(targets.has('a')).toBe(false);
        expect(targets.has('c')).toBe(false);
        expect(targets.size).toBe(1);
    });

    it('spaces every interior node of a 4-node selection evenly', () => {
        const a = shape({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const b = shape({ id: 'b', transform: { x: 800, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const c = shape({ id: 'c', transform: { x: 2500, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const d = shape({ id: 'd', transform: { x: 3000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });

        const targets = distributeLayout([a, b, c, d], lookup(a, b, c, d), 'horizontal');

        // Centres 50 / 850 / 2550 / 3050 → step 1000 → interiors at 1050 / 2050.
        expect(targets.get('b')).toEqual({ x: 1000, y: 500 });
        expect(targets.get('c')).toEqual({ x: 2000, y: 0 });
        expect(targets.size).toBe(2);
    });
});

describe('distributeLayout — vertical', () => {
    it('evenly spaces the interior node along cy and keeps its cross-axis x', () => {
        const a = shape({ id: 'a', transform: { x: 60, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 400, h: 200 } });
        const b = shape({ id: 'b', transform: { x: 300, y: 900, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 400, h: 200 } });
        const c = shape({ id: 'c', transform: { x: 0, y: 3000, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 400, h: 200 } });

        const targets = distributeLayout([a, b, c], lookup(a, b, c), 'vertical');

        // Centres 100 / 1000 / 3100 → step 1500 → interior centre 1600, top 1500.
        expect(targets.get('b')).toEqual({ x: 300, y: 1500 });
        expect(targets.has('a')).toBe(false);
        expect(targets.has('c')).toBe(false);
    });
});

describe('distributeLayout — edge cases', () => {
    it('is a no-op (empty map) for fewer than three geometry-bearing nodes', () => {
        const a = shape({ id: 'a' });
        const b = shape({ id: 'b', transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        expect(distributeLayout([a, b], lookup(a, b), 'horizontal').size).toBe(0);
        expect(distributeLayout([a], lookup(a), 'horizontal').size).toBe(0);
        expect(distributeLayout([], new Map(), 'horizontal').size).toBe(0);
    });

    it('ignores geometry-less nodes (they never count toward the three)', () => {
        const g = group('g');
        const a = shape({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const b = shape({ id: 'b', transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 300 } });
        const c = shape({ id: 'c', transform: { x: 2000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });

        const targets = distributeLayout([g, a, b, c], lookup(g, a, b, c), 'horizontal');

        expect(targets.has('g')).toBe(false);
        expect(targets.get('b')).toEqual({ x: 1100, y: 0 });

        // A group plus only two shapes is still fewer than three real nodes.
        expect(distributeLayout([g, a, b], lookup(g, a, b), 'horizontal').size).toBe(0);
    });
});

/**
 * `centerOnSelectionLayout` (P10 fix round): centre the selection on its own
 * union AABB along one axis. Each participating node's world centre lands on the
 * union centre; the cross-axis coordinate is untouched. Geometry-less nodes are
 * dropped (they never skew the union), fewer than two geometry-bearing nodes is
 * a no-op, and a node already on the union centre is omitted.
 */
describe('centerOnSelectionLayout — horizontal', () => {
    it('moves every node onto the union centre and preserves the cross axis', () => {
        const a = shape({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const b = shape({ id: 'b', transform: { x: 200, y: 50, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const c = shape({ id: 'c', transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 100 } });

        const targets = centerOnSelectionLayout([a, b, c], lookup(a, b, c), 'horizontal');

        // Union box x=0..1200 → centre 600; each node keeps its own width + y.
        expect(targets.get('a')).toEqual({ x: 550, y: 0 });
        expect(targets.get('b')).toEqual({ x: 550, y: 50 });
        expect(targets.get('c')).toEqual({ x: 500, y: 0 });
        expect(targets.size).toBe(3);
    });

    it('is empty when the nodes already share the union centre', () => {
        const a = shape({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const b = shape({ id: 'b', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });

        expect(centerOnSelectionLayout([a, b], lookup(a, b), 'horizontal').size).toBe(0);
    });
});

describe('centerOnSelectionLayout — vertical', () => {
    it('centres on the union cy and keeps each node’s x', () => {
        const a = shape({ id: 'a', transform: { x: 10, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 100 } });
        const b = shape({ id: 'b', transform: { x: 50, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 100, h: 200 } });

        const targets = centerOnSelectionLayout([a, b], lookup(a, b), 'vertical');

        // Union box y=0..1200 → centre 600; widths/x preserved.
        expect(targets.get('a')).toEqual({ x: 10, y: 550 });
        expect(targets.get('b')).toEqual({ x: 50, y: 500 });
    });
});

describe('centerOnSelectionLayout — edge cases', () => {
    it('is a no-op (empty map) for fewer than two geometry-bearing nodes', () => {
        const a = shape({ id: 'a' });
        expect(centerOnSelectionLayout([a], lookup(a), 'horizontal').size).toBe(0);
        expect(centerOnSelectionLayout([], new Map(), 'horizontal').size).toBe(0);
        // A group carries no geometry, so on its own it is still fewer than two.
        const g = group('g');
        expect(centerOnSelectionLayout([g], lookup(g), 'horizontal').size).toBe(0);
    });

    it('ignores geometry-less nodes and excludes them from the union', () => {
        const g = group('g');
        const a = shape({ id: 'a', transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 100 } });
        const b = shape({ id: 'b', transform: { x: 2000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 100 } });

        const targets = centerOnSelectionLayout([g, a, b], lookup(g, a, b), 'horizontal');

        // The group's fake {0,0,0,0} box is excluded: union is 1000..2200 → 1600.
        expect(targets.has('g')).toBe(false);
        expect(targets.get('a')).toEqual({ x: 1500, y: 0 });
        expect(targets.get('b')).toEqual({ x: 1500, y: 0 });

        // A group plus only one real shape is still fewer than two.
        expect(centerOnSelectionLayout([g, a], lookup(g, a), 'horizontal').size).toBe(0);
    });
});
