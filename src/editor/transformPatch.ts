import { roundHm } from '../core/hm';
import { effectiveTransform, IDENTITY_MAT2D, type Mat2D } from '../core/doc/derive';
import type { Node } from '../core/doc/types';
import type { NodePatch } from '../store/storeTypes';

/**
 * World→parent-local translation helper, extracted from `ObjectTab.tsx` so the
 * store can nudge a selection without depending on a component. Kept pure:
 * `byId` is read, never mutated, and the returned `NodePatch` only carries
 * `transform.x/y` (rounded hm), leaving size/rotation intact.
 */

/**
 * Rotate a **world-space** translation into a parent frame rotated by
 * `parentRotDeg` (the parent's effective world rotation, in degrees).
 *
 * A drag delta is measured in world space, but a node's `transform.x/y` live in
 * its parent's local frame. A child of a rotated group must therefore be moved
 * by the delta expressed in that frame: for a 90° group, dragging right moves
 * the child **up** in parent-local terms (`(dx,dy) → (0,−dx)`), which renders as
 * "right" on screen. Rotating by `−parentRotDeg` is the inverse of the parent's
 * rotation; the identity path returns the delta untouched so an unrotated (or
 * root) parent stays bit-identical to the raw-delta behaviour.
 */
export const worldDeltaToLocal = (
    dx: number,
    dy: number,
    parentRotDeg: number,
): { dx: number; dy: number } => {
    if (parentRotDeg === 0) return { dx, dy };
    const radians = (-parentRotDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
};

/** Invert only the linear (a,b,c,d) part of a matrix; `null` when singular. */
const invertLinear = (m: Mat2D): Mat2D | null => {
    const det = m.a * m.d - m.b * m.c;
    if (det === 0) return null;
    return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: 0, f: 0 };
};

/** The effective parent matrix (identity at the root). */
const parentMatrix = (node: Node, byId: ReadonlyMap<string, Node>): Mat2D => {
    if (node.parentId === null) return IDENTITY_MAT2D;
    const parent = byId.get(node.parentId);
    return parent ? effectiveTransform(parent, byId) : IDENTITY_MAT2D;
};

/**
 * Convert a world-space translation into the node's parent-local space and fold
 * it into `transform.x/y`. Used by align, tile and arrow nudge; the returned
 * patch keeps the node's size/rotation intact (translation only). `null` on a
 * singular parent chain (unmappable delta).
 */
export const translateWorldPatch = (
    node: Node,
    byId: ReadonlyMap<string, Node>,
    worldDx: number,
    worldDy: number,
): NodePatch | null => {
    const inverse = invertLinear(parentMatrix(node, byId));
    if (!inverse) return null;
    const localDx = inverse.a * worldDx + inverse.c * worldDy;
    const localDy = inverse.b * worldDx + inverse.d * worldDy;
    return {
        transform: {
            ...node.transform,
            x: roundHm(node.transform.x + localDx),
            y: roundHm(node.transform.y + localDy),
        },
    };
};
