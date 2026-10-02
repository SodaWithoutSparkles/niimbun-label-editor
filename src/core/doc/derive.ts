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
 * Bounding rect of the region union — the thumbnail silhouette only. No raster
 * clipping (that is P4). `undefined` when there is no drawable region.
 */
export const regionUnionBounds = (regions: readonly Region[]): Bounds | undefined => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;

    for (const region of regions) {
        if (region.kind === 'polygon' && region.points.length === 0) continue;
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
