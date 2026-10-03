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

/** Font size must survive a resize strictly positive. */
const clampFontSize = (value: number): hm => (value <= 0 ? 1 : roundHm(value));

/** Types that preserve aspect by default. */
export const preservesAspectByDefault = (node: Node): boolean =>
    node.type === 'qr' ||
    node.type === 'image' ||
    (node.type === 'shape' && node.shape === 'ellipse');

/** Default local size for a node that carries no explicit geometry, in hm (10 mm). */
export const DEFAULT_CONTENT_SIZE: hm = 1000;

/** Read a node's current size, falling back to the render defaults. */
export const nodeSize = (node: Node): Size =>
    node.size ?? { w: DEFAULT_CONTENT_SIZE, h: DEFAULT_CONTENT_SIZE };

/**
 * Compute the `(sx, sy)` axis factors for a target box. When `preserveAspect` is
 * set (or defaulted on for this node kind) the two factors collapse to a single
 * uniform factor derived from whichever axis moved more, so an ellipse/QR/image
 * stays proportional.
 */
export const sizeFactors = (
    size: Size,
    target: Size,
    preserveAspect: boolean,
): { sx: number; sy: number } => {
    const rawX = size.w === 0 ? 1 : target.w / size.w;
    const rawY = size.h === 0 ? 1 : target.h / size.h;
    if (!preserveAspect) return { sx: rawX, sy: rawY };
    const f = Math.max(rawX, rawY);
    return { sx: f, sy: f };
};

/** Scale each point of a line/polygon by `(sx, sy)` and round. */
export const scalePoints = (
    points: readonly [hm, hm][],
    sx: number,
    sy: number,
): [hm, hm][] => points.map(([x, y]) => [roundHm(x * sx), roundHm(y * sy)]);

/**
 * Resize `node` to `target` and return a **new** node. Never mutates the input.
 *
 * - rect/ellipse/image/qr/barcode: `size` scales; `cornerRadius` /
 *   `strokeWidth` scale by the uniform factor.
 * - text: `size` (the box) scales; `fontSize` scales by the uniform factor.
 *   Free resize (preserveAspect `false`) changes the box only, leaving
 *   `fontSize` untouched.
 * - line/polygon: each `points` coordinate scales by `(sx, sy)`.
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
            return {
                ...shape,
                points: scalePoints(shape.points ?? [], sx, sy),
                ...scaleStroke(shape, sx, sy),
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
        if (text.fontSize !== undefined && preserveAspect) {
            next.fontSize = clampFontSize(text.fontSize * uniformFactor(sx, sy));
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
