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
 * resize freely by default. The aspect used to derive the uniform factor is the
 * node's *current* local box (`target` supplies only the dragged corners).
 */

export interface Size {
    w: hm;
    h: hm;
}

export interface ResizeOptions {
    /** Defaults to `true` for circle/ellipse/qr/image, `false` otherwise. */
    preserveAspect?: boolean;
}

/** The uniform factor used for cornerRadius / fontSize / strokeWidth. */
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
 * Compute the `(sx, sy)` axis factors for a target box. When `preserveAspect` is
 * set (or defaulted on for this node kind) the two factors collapse to a single
 * uniform factor derived from whichever axis moved more, so an ellipse/QR/image
 * stays proportional.
 *
 * Aspect-lock asymmetry (accepted): collapsing to `Math.max` means dragging one
 * axis *in* while the other stays put is a no-op (the larger — identity — factor
 * wins). That is deliberate: the node never shrinks below its current box from a
 * single-axis inward drag, and a genuine shrink requires both axes to move in.
 */
export const sizeFactors = (
    size: Size,
    target: Size,
    preserveAspect: boolean,
): { sx: number; sy: number } => {
    // A zero-extent axis has no ratio to derive; fall back to 1 so the other
    // axis (and any downstream uniform factor) still behaves, and so a collapsed
    // box is not permanently unresizable.
    const rawX = size.w === 0 ? 1 : target.w / size.w;
    const rawY = size.h === 0 ? 1 : target.h / size.h;
    if (!preserveAspect) return { sx: rawX, sy: rawY };
    const f = Math.max(rawX, rawY);
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
 * - rect/ellipse/image/qr/barcode: `size` scales; `cornerRadius` /
 *   `strokeWidth` scale by the uniform factor.
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
    const { sx, sy } = sizeFactors(size, target, preserveAspect);

    if (node.type === 'shape') {
        const shape = node as ShapeNode;
        if (shape.shape === 'line' || shape.shape === 'polygon') {
            // Scale against the points' own bounding box, not `size`/the render
            // fallback, so `(sx, sy)` is proportional to the real geometry.
            const { sx: px, sy: py } = sizeFactors(pointBaseExtent(shape), target, preserveAspect);
            return {
                ...shape,
                points: scalePoints(shape.points ?? [], px, py),
                ...scaleStroke(shape, px, py),
            };
        }
        const next: ShapeNode = {
            ...shape,
            size: { w: clampSize(size.w * sx), h: clampSize(size.h * sy) },
        };
        if (shape.cornerRadius !== undefined) {
            next.cornerRadius = clampSize(shape.cornerRadius * uniformFactor(sx, sy));
        }
        return { ...next, ...scaleStroke(shape, sx, sy) };
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
    return { ...next, ...scaleStroke(node, sx, sy) };
};

/** Scale a present `strokeWidth` by the uniform factor; omit when absent. */
const scaleStroke = (
    node: Node,
    sx: number,
    sy: number,
): { strokeWidth?: number } => {
    const strokeWidth = (node as { strokeWidth?: number }).strokeWidth;
    if (strokeWidth === undefined) return {};
    return { strokeWidth: clampSize(strokeWidth * uniformFactor(sx, sy)) };
};
