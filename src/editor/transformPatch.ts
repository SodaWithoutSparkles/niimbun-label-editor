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
