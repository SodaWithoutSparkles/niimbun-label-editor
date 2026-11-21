import { describe, expect, it } from 'vitest';
import type { Node, ShapeNode } from '../core/doc/types';
import { translateWorldPatch, worldDeltaToLocal } from './transformPatch';

/**
 * `transformPatch` helpers. `translateWorldPatch` was extracted from
 * `ObjectTab` for the store's align/tile/nudge paths; `worldDeltaToLocal` is the
 * Preview's child-of-a-rotated-group drag fix (bug 3). Both are pure, so they
 * are asserted without a canvas or a store.
 */

const shape = (over: Partial<ShapeNode> = {}): ShapeNode => ({
    id: 's',
    parentId: null,
    type: 'shape',
    shape: 'rectangle',
    visible: true,
    locked: false,
    transform: { x: 100, y: 200, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 500, h: 400 },
    ...over,
});

const group = (over: Partial<Node> = {}): Node =>
    ({
        id: 'g',
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        ...over,
    }) as Node;

/** Rotate a vector by `deg` (the inverse direction of `worldDeltaToLocal`). */
const rotate = (dx: number, dy: number, deg: number): { dx: number; dy: number } => {
    const radians = (deg * Math.PI) / 180;
    return {
        dx: dx * Math.cos(radians) - dy * Math.sin(radians),
        dy: dx * Math.sin(radians) + dy * Math.cos(radians),
    };
};

const close = (actual: { dx: number; dy: number }, expected: { dx: number; dy: number }) => {
    expect(actual.dx).toBeCloseTo(expected.dx, 9);
    expect(actual.dy).toBeCloseTo(expected.dy, 9);
};

describe('worldDeltaToLocal', () => {
    it('is the identity for an unrotated parent', () => {
        expect(worldDeltaToLocal(12, -7, 0)).toEqual({ dx: 12, dy: -7 });
        expect(worldDeltaToLocal(0.25, 0.5, 0)).toEqual({ dx: 0.25, dy: 0.5 });
    });

    it('rotates the delta into a 90° parent frame', () => {
        // Local +x maps to world +y, so world +x is local −y. Dragging right on
        // screen moves the child **up** in the group's own coordinates.
        close(worldDeltaToLocal(10, 0, 90), { dx: 0, dy: -10 });
        close(worldDeltaToLocal(0, 10, 90), { dx: 10, dy: 0 });
    });

    it('handles a 180° parent and non-right angles', () => {
        close(worldDeltaToLocal(10, -5, 180), { dx: -10, dy: 5 });
        close(worldDeltaToLocal(10, 0, 30), rotate(10, 0, -30));
        close(worldDeltaToLocal(-4, 9, -30), rotate(-4, 9, 30));
    });

    it('round-trips through the inverse rotation', () => {
        for (const deg of [30, 90, 135, -60, 270]) {
            const local = worldDeltaToLocal(13, -7, deg);
            close(rotate(local.dx, local.dy, deg), { dx: 13, dy: -7 });
        }
    });
});

describe('translateWorldPatch', () => {
    it('folds a world delta into parent-local x/y for a rotated group', () => {
        const child = shape({ parentId: 'g' });
        const byId = new Map<string, Node>([
            [child.id, child],
            ['g', group({ transform: { x: 0, y: 0, rotDeg: 90, scaleX: 1, scaleY: 1 } })],
        ]);

        const patch = translateWorldPatch(child, byId, 30, 0);

        // 90° parent: world +x becomes local −y, like `worldDeltaToLocal`.
        expect(patch?.transform).toEqual({
            x: 100,
            y: 170,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
    });

    it('rounds to integer hm like every other translation', () => {
        const child = shape({ parentId: 'g' });
        const byId = new Map<string, Node>([
            [child.id, child],
            ['g', group()],
        ]);
        expect(translateWorldPatch(child, byId, 0.4, -0.6)?.transform).toEqual({
            x: 100,
            y: 199,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
    });

    it('returns null for a singular parent chain', () => {
        const child = shape({ parentId: 'g' });
        const byId = new Map<string, Node>([
            [child.id, child],
            ['g', group({ transform: { x: 0, y: 0, rotDeg: 0, scaleX: 0, scaleY: 1 } })],
        ]);
        expect(translateWorldPatch(child, byId, 10, 10)).toBeNull();
    });
});
