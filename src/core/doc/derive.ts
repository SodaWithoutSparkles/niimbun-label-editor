import type { hm } from '../hm';
import type { Node, Region, Transform } from './types';

/**
 * Pure derived semantics. Nothing here is cached on nodes (plan §Data model:
 * "Derived semantics are never stored"). Callers build a `Node` map once with
 * `nodeLookup` and pass it in.
 */

export interface Bounds {
    x: hm;
    y: hm;
    w: hm;
    h: hm;
}

/** 2D affine matrix, canvas order: x' = a·x + c·y + e; y' = b·x + d·y + f. */
export interface Mat2D {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

export const IDENTITY_MAT2D: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const nodeLookup = (nodes: readonly Node[]): ReadonlyMap<string, Node> => {
    const map = new Map<string, Node>();
    for (const node of nodes) map.set(node.id, node);
    return map;
};

/** Direct children, in z-order (array order). */
export const childrenFromParentId = (nodes: readonly Node[], parentId: string | null): Node[] =>
    nodes.filter((node) => node.parentId === parentId);

/** Root→node ancestry, stopping on a missing parent or a cycle. */
const ancestry = (node: Node, byId: ReadonlyMap<string, Node>): Node[] => {
    const chain: Node[] = [];
    const seen = new Set<string>();
    let current: Node | undefined = node;
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        chain.push(current);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return chain;
};

/** `node.visible && effectiveVisible(parent)`; a missing parent counts as visible. */
export const effectiveVisible = (node: Node, byId: ReadonlyMap<string, Node>): boolean =>
    ancestry(node, byId).every((entry) => entry.visible);

/** `node.locked || effectiveLocked(parent)`; a missing parent counts as unlocked. */
export const effectiveLocked = (node: Node, byId: ReadonlyMap<string, Node>): boolean =>
    ancestry(node, byId).some((entry) => entry.locked);

export const localMatrix = (transform: Transform): Mat2D => {
    const radians = (transform.rotDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        a: transform.scaleX * cos,
        b: transform.scaleX * sin,
        c: -transform.scaleY * sin,
        d: transform.scaleY * cos,
        e: transform.x,
        f: transform.y,
    };
};

/** `parent × child` — apply `child` first, then `parent`. */
export const multiplyMat2D = (parent: Mat2D, child: Mat2D): Mat2D => ({
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
});

/** Full inverse of an affine matrix; `null` when it is singular (zero determinant). */
export const invertMat2D = (m: Mat2D): Mat2D | null => {
    const det = m.a * m.d - m.b * m.c;
    if (det === 0) return null;
    const invDet = 1 / det;
    return {
        a: m.d * invDet,
        b: -m.b * invDet,
        c: -m.c * invDet,
        d: m.a * invDet,
        e: (m.c * m.f - m.d * m.e) * invDet,
        f: (m.b * m.e - m.a * m.f) * invDet,
    };
};

/**
 * Decompose an affine matrix back into a stored `Transform` (x, y, rotDeg,
 * scaleX, scaleY). A matrix carrying shear cannot be represented by this shape,
 * so the shear term is dropped; that is acceptable here because reparenting
 * between axis-aligned/rotated parents only ever produces scale + rotation.
 * The x/y are rounded to integer hm (the document's discipline).
 */
const roundHmValue = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0);

export const decomposeMat2D = (m: Mat2D): Transform => {
    const scaleX = Math.hypot(m.a, m.b);
    const determinant = m.a * m.d - m.b * m.c;
    const scaleY = scaleX === 0 ? 1 : determinant / scaleX;
    const rotDeg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    return {
        x: roundHmValue(m.e),
        y: roundHmValue(m.f),
        rotDeg,
        scaleX: scaleX === 0 ? 1 : scaleX,
        scaleY,
    };
};

/**
 * The local transform a node needs so its **world** transform is unchanged when
 * it moves from `oldParent` to `newParent` (must-fix #4). Derives
 * `newLocal = newParent⁻¹ × oldParent × oldLocal`, then decomposes it. Falls
 * back to the original local transform if either parent matrix is singular.
 */
export const worldPreservingTransform = (
    local: Transform,
    oldParent: Mat2D,
    newParent: Mat2D,
): Transform => {
    const inverseNew = invertMat2D(newParent);
    if (!inverseNew) return local;
    const composed = multiplyMat2D(inverseNew, multiplyMat2D(oldParent, localMatrix(local)));
    return decomposeMat2D(composed);
};

/**
 * `parentTransform × localTransform`. A matrix, not a `Transform`: a non-uniform
 * scale under a rotation cannot be expressed as the stored {x,y,rot,scaleX,scaleY}
 * shape without lossy shear.
 */
export const effectiveTransform = (node: Node, byId: ReadonlyMap<string, Node>): Mat2D => {
    // `ancestry` is root-first; fold parent into child.
    const chain = ancestry(node, byId).reverse();
    return chain.reduce<Mat2D>(
        (matrix, entry) => multiplyMat2D(matrix, localMatrix(entry.transform)),
        IDENTITY_MAT2D,
    );
};

/** Axis-aligned bounds of one region. */
export const regionBounds = (region: Region): Bounds => {
    switch (region.kind) {
        case 'rect':
        case 'roundedRect':
            return { x: region.x, y: region.y, w: region.w, h: region.h };
        case 'circle':
            return {
                x: region.cx - region.r,
                y: region.cy - region.r,
                w: region.r * 2,
                h: region.r * 2,
            };
        case 'polygon': {
            if (region.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const [x, y] of region.points) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
    }
};

/**
 * True when a polygon has at least one non-collinear triple. Mirrors
 * `hasNonCollinearTriple` in `src/editor/render/regionOverlay.ts` (core cannot
 * import the editor). Net signed area is the wrong test: a bow-tie has area 0
 * yet its nonzero fill still paints both lobes.
 */
const hasNonCollinearTriple = (points: readonly [hm, hm][]): boolean => {
    const [x0, y0] = points[0]!;
    for (let i = 1; i < points.length - 1; i++) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[i + 1]!;
        if ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) !== 0) return true;
    }
    return false;
};

/**
 * True when a region contributes a drawable interior. Mirrors `isDrawableRegion`
 * in `src/editor/render/regionOverlay.ts` (core cannot import the editor):
 * positive extents, positive circle radius, and a closed polygon with a
 * non-collinear triple. An **open** polygon has no interior and is not printable.
 */
const isDrawableRegion = (region: Region): boolean => {
    switch (region.kind) {
        case 'rect':
        case 'roundedRect':
            return region.w > 0 && region.h > 0;
        case 'circle':
            return region.r > 0;
        case 'polygon':
            return (
                region.closed === true &&
                region.points.length >= 3 &&
                hasNonCollinearTriple(region.points)
            );
    }
};

/**
 * Bounding rect of the region union — the thumbnail silhouette only. No raster
 * clipping (that is P4). `undefined` when there is no drawable region; a region
 * with no interior (zero extents, zero radius, open/degenerate polygon) is
 * skipped, matching `regionUnionPath`.
 */
export const regionUnionBounds = (regions: readonly Region[]): Bounds | undefined => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;

    for (const region of regions) {
        if (!isDrawableRegion(region)) continue;
        const box = regionBounds(region);
        found = true;
        if (box.x < minX) minX = box.x;
        if (box.y < minY) minY = box.y;
        if (box.x + box.w > maxX) maxX = box.x + box.w;
        if (box.y + box.h > maxY) maxY = box.y + box.h;
    }

    if (!found) return undefined;
    return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
    };
};
