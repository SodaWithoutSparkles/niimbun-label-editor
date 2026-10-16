import { roundHm, type hm } from '../hm';
import type { Node, ShapeNode, TextNode } from './types';

/**
 * Node resize math (phase3 action-plan §13). Pure and headless — no React, no
 * Konva, no store.
 *
 * The transform/size rule: `transform.scaleX/scaleY` default to `1` and a leaf
 * resize **bakes into geometry** rather than compounding the transform scale.
 * That keeps print math reading geometry directly.
 *
 * Aspect-preserving is the default for circles/ellipses, QR and images; free
 * resize is opted into by `preserveAspect: false`. Rect/text/line/polygon
 * resize freely by default. The factor is measured against the node's *current*
 * local box (`target` supplies only the dragged corners); a uniform gesture may
 * pass its exact scale via `uniformScale` so rounding cannot bias the commit.
 */

export interface Size {
    w: hm;
    h: hm;
}

export interface ResizeOptions {
    /** Defaults to `true` for circle/ellipse/qr/image, `false` otherwise. */
    preserveAspect?: boolean;
    /**
     * The live gesture's single uniform scale, when the caller knows it exactly
     * (a Transformer **corner** drag, where Konva holds `scaleX == scaleY`).
     * When supplied with `preserveAspect`, both axes use this factor verbatim,
     * so rounding the target box can never bias the commit away from the live
     * gesture. See `sizeFactors`.
     */
    uniformScale?: number;
}

/** The uniform factor used for cornerRadius / fontSize. */
export const uniformFactor = (sx: number, sy: number): number => Math.min(sx, sy);

/** Round to integer hm and clamp at 0 (sizes can collapse but never invert). */
const clampSize = (value: number): hm => (value <= 0 ? 0 : roundHm(value));

/** Font size must survive a resize strictly positive (round first, then clamp). */
export const clampFontSize = (value: number): hm => {
    const r = roundHm(value);
    return r <= 0 ? 1 : r;
};

/** Types that preserve aspect by default. */
export const preservesAspectByDefault = (node: Node): boolean =>
    node.type === 'qr' ||
    node.type === 'code' ||
    node.type === 'image' ||
    (node.type === 'shape' && node.shape === 'ellipse');

/** Default local size for a node that carries no explicit geometry, in hm (10 mm). */
export const DEFAULT_CONTENT_SIZE: hm = 1000;

/** Default text font size in hm (3 mm); the seed for a font-less text resize. */
export const DEFAULT_FONT_SIZE: hm = 300;

/** Read a node's current size, falling back to the render defaults. */
export const nodeSize = (node: Node): Size =>
    node.size ?? { w: DEFAULT_CONTENT_SIZE, h: DEFAULT_CONTENT_SIZE };

/**
 * Compute the `(sx, sy)` axis factors for a target box.
 *
 * Free resize returns the two independent axis factors. Aspect-preserving is
 * only requested for a **genuinely uniform** gesture — a Transformer *corner*
 * drag, where Konva holds the ratio and therefore the live `scaleX == scaleY`
 * (so `rawX == rawY`). The gesture path passes that exact `uniformScale`; when
 * it does, both axes use it verbatim. The `Math.max(rawX, rawY)` fallback only
 * serves direct callers that cannot supply the factor — it is deliberately
 * **not** a post-hoc snap: collapsing a non-uniform (side-anchor) gesture to
 * `Math.max` was #13, because the anchored edge is no longer held on release.
 */
export const sizeFactors = (
    size: Size,
    target: Size,
    preserveAspect: boolean,
    uniformScale?: number,
): { sx: number; sy: number } => {
    // A zero-extent axis has no ratio to derive; fall back to 1 so the other
    // axis (and any downstream uniform factor) still behaves, and so a collapsed
    // box is not permanently unresizable.
    const rawX = size.w === 0 ? 1 : target.w / size.w;
    const rawY = size.h === 0 ? 1 : target.h / size.h;
    if (!preserveAspect) return { sx: rawX, sy: rawY };
    const f = uniformScale ?? Math.max(rawX, rawY);
    return { sx: f, sy: f };
};

/** Bounding-box extent `{ w, h }` of a point cloud, in the same hm units. */
export const pointsExtent = (points: readonly [hm, hm][]): Size => {
    if (points.length === 0) return { w: 0, h: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { w: maxX - minX, h: maxY - minY };
};

/** Scale each point of a line/polygon by `(sx, sy)` and round. */
export const scalePoints = (
    points: readonly [hm, hm][],
    sx: number,
    sy: number,
): [hm, hm][] => points.map(([x, y]) => [roundHm(x * sx), roundHm(y * sy)]);

/**
 * The line/polygon base extent that `(sx, sy)` is measured against: the node's
 * own `points` bounding box, so the scale is proportional to the *real*
 * geometry. `size` is only consulted for an empty point cloud (P2-era shape
 * without `points`), and `DEFAULT_CONTENT_SIZE` is the last-resort seed. This
 * keeps `resizeNodeGeometry` in step with `nodeSize` for point-less shapes.
 */
const pointBaseExtent = (shape: ShapeNode): Size => {
    const extent = pointsExtent(shape.points ?? []);
    if (extent.w > 0 || extent.h > 0) return extent;
    if (shape.size !== undefined) return shape.size;
    return { w: DEFAULT_CONTENT_SIZE, h: DEFAULT_CONTENT_SIZE };
};

/**
 * Resize `node` to `target` and return a **new** node. Never mutates the input.
 *
 * - rect/ellipse/image/qr/barcode: `size` scales; `cornerRadius` scales by the
 *   uniform factor. `strokeWidth` is deliberately invariant (a resize must not
 *   thicken or thin the ink).
 * - text: `size` (the box) scales; `fontSize` scales by the uniform factor.
 *   Free resize (preserveAspect `false`) changes the box only, leaving
 *   `fontSize` untouched.
 * - line/polygon: each `points` coordinate scales by `(sx, sy)`, where the base
 *   extent is the points' own bounding box (not `size`/the render fallback).
 *
 * All hm results are integers; `size.w/h` clamp at 0; `fontSize` stays > 0.
 */
export const resizeNodeGeometry = (
    node: Node,
    target: Size,
    opts: ResizeOptions = {},
): Node => {
    if (node.type === 'group') return node;

    const preserveAspect = opts.preserveAspect ?? preservesAspectByDefault(node);
    const size = nodeSize(node);
    const { sx, sy } = sizeFactors(size, target, preserveAspect, opts.uniformScale);

    if (node.type === 'shape') {
        const shape = node as ShapeNode;
        if (shape.shape === 'line' || shape.shape === 'polygon') {
            // Scale against the points' own bounding box, not `size`/the render
            // fallback, so `(sx, sy)` is proportional to the real geometry.
            const { sx: px, sy: py } = sizeFactors(pointBaseExtent(shape), target, preserveAspect, opts.uniformScale);
            return {
                ...shape,
                points: scalePoints(shape.points ?? [], px, py),
            };
        }
        const next: ShapeNode = {
            ...shape,
            size: { w: clampSize(size.w * sx), h: clampSize(size.h * sy) },
        };
        if (shape.cornerRadius !== undefined) {
            next.cornerRadius = clampSize(shape.cornerRadius * uniformFactor(sx, sy));
        }
        return next;
    }

    if (node.type === 'text') {
        const text = node as TextNode;
        const next: TextNode = {
            ...text,
            size: { w: clampSize(size.w * sx), h: clampSize(size.h * sy) },
        };
        // Aspect-preserving resize scales the font too. A text node with no
        // `fontSize` still gets the documented default seed, so the resize does
        // not silently skip the font scale (and the field is never left absent).
        if (preserveAspect) {
            next.fontSize = clampFontSize((text.fontSize ?? DEFAULT_FONT_SIZE) * uniformFactor(sx, sy));
        }
        return next;
    }

    // image / qr / barcode — box only.
    const next = {
        ...node,
        size: { w: clampSize(size.w * sx), h: clampSize(size.h * sy) },
    };
    return next;
};
