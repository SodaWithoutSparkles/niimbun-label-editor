import type { hm } from '../../core/hm';
import type { Bounds, Mat2D } from '../../core/doc/derive';
import {
    childrenFromParentId,
    effectiveLocked,
    effectiveTransform,
    effectiveVisible,
    localMatrix,
    nodeLookup,
} from '../../core/doc/derive';
import type { ContentSource, LabelDoc, Node, TextNode } from '../../core/doc/types';
import { nodeSize } from '../../core/doc/geometry';

/**
 * Editor render path — resolve a `LabelDoc` into a static scene graph.
 *
 * **Zero React, zero Konva.** This module only turns the document into a
 * resolved node tree: effective transforms, resolved static text, and geometry
 * bounds. It never executes templates (that is P6) and never rasterizes (P4).
 *
 * Determinism: the tree is built depth-first, roots in `nodes[]` array order and
 * children in array order, so the output is stable across runs. Nodes whose
 * effective visibility is false are omitted together with their subtree.
 *
 * Geometry: P3 added the real node geometry fields (`size`, `fontSize`,
 * `points`, `cornerRadius`… — §13). This layer reads them directly; documents
 * written before those fields existed still fall back to the documented
 * defaults below.
 */

export type ResolvedNodeType = 'group' | 'text' | 'line' | 'rectangle' | 'ellipse' | 'polygon';
export type TextAlign = TextNode['align'] & ('left' | 'center' | 'right');

export { DEFAULT_CONTENT_SIZE } from '../../core/doc/geometry';
/** Default text size, in hm (3 mm). */
export const DEFAULT_FONT_SIZE: hm = 300;
export const DEFAULT_FONT_FAMILY = 'sans-serif';
export const DEFAULT_EMPTY_TEXT = '{empty}';

export interface ResolvedBase {
    id: string;
    parentId: string | null;
    name?: string;
    type: ResolvedNodeType;
    /** effective visibility (self && ancestors). */
    visible: boolean;
    /** effective lock (self || ancestors). */
    locked: boolean;
    /**
     * The node's own transform (parent not applied). Used to nest plain-Konva
     * nodes so Konva recomposes the same parent × child product.
     */
    localTransform: Mat2D;
    /**
     * Absolute transform (`parent × local`), authoritative for bounds, keep-out,
     * and P4. Mirrors `derive.effectiveTransform`.
     */
    transform: Mat2D;
    /** AABB of the node's local geometry under `transform`. */
    bounds: Bounds;
}

export interface ResolvedGroup extends ResolvedBase {
    type: 'group';
    children: ResolvedNode[];
}

export interface ResolvedText extends ResolvedBase {
    type: 'text';
    /** Resolved text; never blank — empty content becomes `placeholder`. */
    text: string;
    /** True when `text` is the empty-content placeholder, not real content. */
    placeholder: boolean;
    w: hm;
    h: hm;
    fontSize: hm;
    fontFamily: string;
    fontStyle: string;
    align: TextAlign;
    paddingHm: hm;
}

export interface ResolvedLine extends ResolvedBase {
    type: 'line';
    points: [hm, hm][];
    closed: boolean;
}

export interface ResolvedRectangle extends ResolvedBase {
    type: 'rectangle';
    w: hm;
    h: hm;
}

/** Local origin is the ellipse centre (unlike rect/text, whose origin is top-left). */
export interface ResolvedEllipse extends ResolvedBase {
    type: 'ellipse';
    rx: hm;
    ry: hm;
}

export interface ResolvedPolygon extends ResolvedBase {
    type: 'polygon';
    points: [hm, hm][];
    closed: boolean;
}

export type ResolvedNode =
    | ResolvedGroup
    | ResolvedText
    | ResolvedLine
    | ResolvedRectangle
    | ResolvedEllipse
    | ResolvedPolygon;

export interface ResolveContext {
    /** Text substituted when resolved content is empty. Defaults to `{empty}`. */
    emptyText?: string;
}

/** Apply an affine matrix to a local point. */
export const applyMat2D = (m: Mat2D, x: number, y: number): [number, number] => [
    m.a * x + m.c * y + m.e,
    m.b * x + m.d * y + m.f,
];

/** AABB of local points under `m`. Empty input yields a degenerate box at the origin. */
export const transformedBounds = (points: readonly [number, number][], m: Mat2D): Bounds => {
    if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of points) {
        const [x, y] = applyMat2D(m, px, py);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const rectCorners = (x: number, y: number, w: number, h: number): [number, number][] => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/**
 * Local geometry outline of any node as points, in the node's local space. Used
 * by `resolve` and by the keep-out predicate (which also covers image/qr/barcode,
 * omitted from the static resolver). Groups have no outline — callers recurse.
 */
export const nodeLocalPoints = (node: Node): [number, number][] => {
    if (node.type === 'group') return [];
    if (node.type === 'shape') {
        switch (node.shape) {
            case 'line':
            case 'polygon':
                return node.points ?? [];
            case 'rectangle': {
                const { w, h } = nodeSize(node);
                return rectCorners(0, 0, w, h);
            }
            case 'ellipse': {
                const { w, h } = nodeSize(node);
                return rectCorners(-w / 2, -h / 2, w, h);
            }
        }
    }
    // text / image / qr / barcode all occupy a local (0,0,w,h) box.
    const { w, h } = nodeSize(node);
    return rectCorners(0, 0, w, h);
};

/** Union of AABBs; empty input yields a degenerate box at the origin. */
const unionBounds = (boxes: readonly Bounds[]): Bounds => {
    if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of boxes) {
        if (box.x < minX) minX = box.x;
        if (box.y < minY) minY = box.y;
        if (box.x + box.w > maxX) maxX = box.x + box.w;
        if (box.y + box.h > maxY) maxY = box.y + box.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

/**
 * Resolve a `ContentSource` without executing anything. Static values pass
 * through; csv/template use their static `fallback` (execution is P6). An empty
 * result becomes the placeholder so an object never renders blank.
 */
export const resolveContent = (
    source: ContentSource,
    emptyText: string = DEFAULT_EMPTY_TEXT,
): { text: string; placeholder: boolean } => {
    const raw = source.kind === 'static' ? source.value : source.fallback;
    if (raw.length === 0) return { text: emptyText, placeholder: true };
    return { text: raw, placeholder: false };
};

/**
 * Build the resolved static scene graph. Roots in `nodes[]` order, children in
 * array order, hidden subtrees omitted. Template/CSV content is not executed.
 */
export const resolve = (doc: LabelDoc, ctx: ResolveContext = {}): ResolvedNode[] => {
    const emptyText = ctx.emptyText ?? DEFAULT_EMPTY_TEXT;
    const byId = nodeLookup(doc.nodes);
    const seen = new Set<string>();

    const buildNode = (node: Node): ResolvedNode | undefined => {
        const base = {
            id: node.id,
            parentId: node.parentId,
            ...(node.name !== undefined ? { name: node.name } : {}),
            visible: true,
            locked: effectiveLocked(node, byId),
            localTransform: localMatrix(node.transform),
            transform: effectiveTransform(node, byId),
        };

        switch (node.type) {
            case 'group': {
                const children = build(node.id);
                return {
                    ...base,
                    type: 'group',
                    children,
                    bounds: unionBounds(children.map((child) => child.bounds)),
                };
            }
            case 'text': {
                const { w, h } = nodeSize(node);
                const content = resolveContent(node.text, emptyText);
                return {
                    ...base,
                    type: 'text',
                    text: content.text,
                    placeholder: content.placeholder,
                    w,
                    h,
                    fontSize: node.fontSize ?? DEFAULT_FONT_SIZE,
                    fontFamily: node.fontFamily ?? DEFAULT_FONT_FAMILY,
                    fontStyle: node.fontStyle ?? 'normal',
                    align: node.align ?? 'left',
                    paddingHm: 0,
                    bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                };
            }
            case 'shape':
                switch (node.shape) {
                    case 'rectangle': {
                        const { w, h } = nodeSize(node);
                        return {
                            ...base,
                            type: 'rectangle',
                            w,
                            h,
                            bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                        };
                    }
                    case 'ellipse': {
                        const { w, h } = nodeSize(node);
                        const rx = w / 2;
                        const ry = h / 2;
                        return {
                            ...base,
                            type: 'ellipse',
                            rx,
                            ry,
                            bounds: transformedBounds(rectCorners(-rx, -ry, rx * 2, ry * 2), base.transform),
                        };
                    }
                    case 'line':
                    case 'polygon': {
                        const points = node.points ?? [];
                        return {
                            ...base,
                            type: node.shape,
                            points,
                            closed: node.closed ?? node.shape === 'polygon',
                            bounds: transformedBounds(points, base.transform),
                        };
                    }
                }
                break;
            case 'image':
            case 'qr':
            case 'barcode':
                // Not static content: images are P5, qr/barcode are P4.
                return undefined;
        }
        return undefined;
    };

    const build = (parentId: string | null): ResolvedNode[] => {
        const out: ResolvedNode[] = [];
        for (const node of childrenFromParentId(doc.nodes, parentId)) {
            if (seen.has(node.id)) continue;
            seen.add(node.id);
            if (!effectiveVisible(node, byId)) continue;
            const resolved = buildNode(node);
            if (resolved) out.push(resolved);
        }
        return out;
    };

    return build(null);
};

/** Depth-first pre-order flattening of a resolved tree. */
export const flattenResolved = (nodes: readonly ResolvedNode[]): ResolvedNode[] => {
    const out: ResolvedNode[] = [];
    const walk = (list: readonly ResolvedNode[]): void => {
        for (const node of list) {
            out.push(node);
            if (node.type === 'group') walk(node.children);
        }
    };
    walk(nodes);
    return out;
};
