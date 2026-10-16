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
import type { ContentSource, LabelDoc, Node, ShapeNode, TextNode } from '../../core/doc/types';
import {
    DEFAULT_BARCODE_SYMBOLOGY,
    DEFAULT_IMAGE_FIT,
    DEFAULT_QR_ERROR_CORRECTION,
    DEFAULT_QR_QUIET_MODULES,
    DEFAULT_SHAPE_FILL,
    DEFAULT_SHAPE_STROKE,
    DEFAULT_SHAPE_STROKE_WIDTH,
    DEFAULT_SYMBOL_FILL,
    DEFAULT_TEXT_WRAP,
    barcodeQuietModules,
    codeQuietModules,
    isClosedShape,
    type BarcodeSymbology,
    type CodeFormat,
    type ImageFit,
    type QrErrorCorrection,
    type TextWrap,
} from '../../core/doc/objects';
import { DEFAULT_FONT_SIZE, nodeSize } from '../../core/doc/geometry';

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

export type ResolvedNodeType =
    | 'group'
    | 'text'
    | 'line'
    | 'rectangle'
    | 'ellipse'
    | 'polygon'
    | 'image'
    | 'qr'
    | 'barcode'
    | 'code';
export type TextAlign = TextNode['align'] & ('left' | 'center' | 'right');

export { DEFAULT_CONTENT_SIZE, DEFAULT_FONT_SIZE } from '../../core/doc/geometry';
export const DEFAULT_FONT_FAMILY = 'sans-serif';
export const DEFAULT_EMPTY_TEXT = '{empty}';
export {
    DEFAULT_SHAPE_FILL,
    DEFAULT_SHAPE_STROKE,
    DEFAULT_SHAPE_STROKE_WIDTH,
    isClosedShape,
} from '../../core/doc/objects';

/**
 * Resolve a shape's static style (#8). Absent fields take the documented
 * defaults: `DEFAULT_SHAPE_FILL` (`'transparent'`, i.e. no fill),
 * `DEFAULT_SHAPE_STROKE` at `DEFAULT_SHAPE_STROKE_WIDTH`. Applying the defaults
 * here (not in either renderer) is what makes preview ≡ print by construction.
 * `fill` is always a real string, so the inspector and both renderers agree.
 */
const shapeStyle = (node: ShapeNode): ResolvedShapeStyle => ({
    fill: node.fill ?? DEFAULT_SHAPE_FILL,
    stroke: node.stroke ?? DEFAULT_SHAPE_STROKE,
    strokeWidth: node.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH,
});

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
    /** Wrap mode (already defaulted to `DEFAULT_TEXT_WRAP`). */
    wrap: TextWrap;
    /** Line-height multiplier (already defaulted to `1`). */
    lineHeight: number;
}

/**
 * Static shape style carried by every resolved shape leaf (#8). `fill` is always
 * a real string (`'transparent'` = no fill); `stroke`/`strokeWidth` are always
 * present with the resolver's defaults applied.
 */
export interface ResolvedShapeStyle {
    /** Fill colour; `'transparent'` = no fill. Never absent. */
    fill: string;
    stroke: string;
    strokeWidth: number;
}

export interface ResolvedLine extends ResolvedBase, ResolvedShapeStyle {
    type: 'line';
    points: [hm, hm][];
    closed: boolean;
}

export interface ResolvedRectangle extends ResolvedBase, ResolvedShapeStyle {
    type: 'rectangle';
    w: hm;
    h: hm;
    /** Corner radius in hm (`0` = square). */
    cornerRadius: hm;
}

/** Local origin is the ellipse centre (unlike rect/text, whose origin is top-left). */
export interface ResolvedEllipse extends ResolvedBase, ResolvedShapeStyle {
    type: 'ellipse';
    rx: hm;
    ry: hm;
}

export interface ResolvedPolygon extends ResolvedBase, ResolvedShapeStyle {
    type: 'polygon';
    points: [hm, hm][];
    closed: boolean;
}

/**
 * Image leaf. `resolve` emits geometry + the resource id only; the real pixels
 * are produced by the async `prepareResolvedAssets` step (P5 §2.2). `fit`
 * defaults to `DEFAULT_IMAGE_FIT`.
 */
export interface ResolvedImage extends ResolvedBase {
    type: 'image';
    imageId: string;
    w: hm;
    h: hm;
    fit: ImageFit;
}

/** QR leaf. `text` is the resolved payload; empty content becomes the placeholder. */
export interface ResolvedQr extends ResolvedBase {
    type: 'qr';
    text: string;
    placeholder: boolean;
    w: hm;
    h: hm;
    errorCorrection: QrErrorCorrection;
    /** Symbol background colour; `'transparent'` means light modules see through. */
    fill: string;
    /** Quiet-zone width per side, in modules (already defaulted). */
    quietModules: number;
}

/** Barcode leaf. `symbology` defaults to `DEFAULT_BARCODE_SYMBOLOGY`. */
export interface ResolvedBarcode extends ResolvedBase {
    type: 'barcode';
    text: string;
    placeholder: boolean;
    w: hm;
    h: hm;
    symbology: BarcodeSymbology;
    /** Symbol background colour; see {@link ResolvedQr.fill}. */
    fill: string;
    /** Quiet-zone width per side, in modules (already defaulted). */
    quietModules: number;
}

/**
 * 2D code leaf (P11). Same shape as {@link ResolvedQr} but carries the per-format
 * bcid (`format`) rather than an error-correction level. Unlike QR the raster is
 * not necessarily square (`codeone`, `ultracode`), so it is drawn with a contain
 * fit rather than QR's square-fill.
 */
export interface ResolvedCode extends ResolvedBase {
    type: 'code';
    text: string;
    placeholder: boolean;
    w: hm;
    h: hm;
    format: CodeFormat;
    /** Symbol background colour; see {@link ResolvedQr.fill}. */
    fill: string;
    /** Quiet-zone width per side, in modules (already defaulted). */
    quietModules: number;
}

export type ResolvedNode =
    | ResolvedGroup
    | ResolvedText
    | ResolvedLine
    | ResolvedRectangle
    | ResolvedEllipse
    | ResolvedPolygon
    | ResolvedImage
    | ResolvedQr
    | ResolvedBarcode
    | ResolvedCode;

/**
 * Resolved content for one leaf: the final text plus whether it is the
 * empty-content placeholder. Shared by `resolveContent` (the static/fallback
 * path) and the async binding pre-pass's override map (`prepareContent.ts`).
 */
export interface ResolvedContent {
    text: string;
    placeholder: boolean;
}

export interface ResolveContext {
    /** Text substituted when resolved content is empty. Defaults to `{empty}`. */
    emptyText?: string;
    /**
     * Per-node-id content produced by the async binding pre-pass (P6 W2):
     * evaluated csv/template sources for a given row. When an entry exists it
     * wins over the static/`fallback` path. Absent → today's behaviour. The map
     * is read only; `resolve` never mutates it.
     */
    overrides?: ReadonlyMap<string, ResolvedContent>;
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
 * all handled by the static resolver). Groups have no outline — callers recurse.
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

/**
 * Local outline of what a node **actually draws**, in the node's local space.
 *
 * `image`/`qr`/`barcode` are painted through `fitImageAttrs`. A `contain` fit
 * places the raster in a centred sub-rect of the node's `(0,0,w,h)` box whenever
 * the content aspect differs from the box aspect, so this helper returns that
 * drawn rect — not the raw box — and a keep-out predicate cannot falsely flag a
 * letterboxed symbol/image whose *box* pokes outside the printable area while
 * its *content* stays well inside.
 *
 * - `group`/`shape`/`text` (and anything else) → {@link nodeLocalPoints} unchanged;
 * - `image` with `fit: 'stretch'` or `'cover'` → the raster fills the whole box
 *   (`fitImageAttrs`), so the raw box is returned (no letterbox to allow for);
 * - `image` with `fit: 'contain'` (or absent = default) / `barcode` / `code` → when
 *   `assetSize` is present with positive dimensions, contain-fit using the aspect
 *   `widthPx/heightPx`; otherwise fall back to the raw box;
 * - `qr` → the symbol canvas is always square, so it contain-fits a square into
 *   the box (`side = min(w,h)`, centred). A missing **or non-positive**
 *   `assetSize` is treated as a `1×1` natural size, which yields the same square;
 *   a supplied positive size is honoured.
 *
 * The four rect corners are returned in the node's local space. Pure and
 * side-effect free; `nodeLocalPoints` itself is deliberately left untouched
 * because it feeds resolve bounds used by hit-test/marquee/align.
 */
export const nodeDrawnLocalPoints = (
    node: Node,
    assetSize?: { widthPx: number; heightPx: number },
): [number, number][] => {
    if (
        node.type !== 'image' &&
        node.type !== 'qr' &&
        node.type !== 'barcode' &&
        node.type !== 'code'
    ) {
        return nodeLocalPoints(node);
    }

    // Only `contain` letterboxes inside the box; `stretch`/`cover` both draw the
    // full box (see `fitImageAttrs`), so a `stretch`/`cover` image that genuinely
    // pokes outside must be sampled by its raw box.
    if (node.type === 'image' && node.fit !== undefined && node.fit !== 'contain') {
        return nodeLocalPoints(node);
    }

    const { w, h } = nodeSize(node);

    let srcW: number;
    let srcH: number;
    if (node.type === 'qr') {
        // The QR raster is always square; a 1×1 natural size reproduces the
        // `side = min(w,h)` square fit when the size is absent. A non-positive
        // size is also treated as absent — otherwise `scale` would be Infinity
        // and the bounds NaN, re-introducing the keep-out false positive.
        const hasSize = assetSize !== undefined && assetSize.widthPx > 0 && assetSize.heightPx > 0;
        srcW = hasSize ? assetSize.widthPx : 1;
        srcH = hasSize ? assetSize.heightPx : 1;
    } else {
        // image/barcode without a known aspect cannot be letterboxed here; keep
        // the legacy raw-box behaviour.
        if (!assetSize || assetSize.widthPx <= 0 || assetSize.heightPx <= 0) {
            return nodeLocalPoints(node);
        }
        srcW = assetSize.widthPx;
        srcH = assetSize.heightPx;
    }

    // `contain` fit (mirrors `fitImageAttrs`): preserve aspect, centre in the box.
    const scale = Math.min(w / srcW, h / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    return rectCorners((w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
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
 * Resolve a `ContentSource` without executing anything. An explicit `override`
 * (from the async binding pre-pass) wins outright; otherwise static values pass
 * through and csv/template use their static `fallback` (execution is the P6
 * pre-pass). An empty result becomes the placeholder so an object never renders
 * blank.
 */
export const resolveContent = (
    source: ContentSource,
    emptyText: string = DEFAULT_EMPTY_TEXT,
    override?: ResolvedContent,
): ResolvedContent => {
    if (override !== undefined) return override;
    const raw = source.kind === 'static' ? source.value : source.fallback;
    if (raw.length === 0) return { text: emptyText, placeholder: true };
    return { text: raw, placeholder: false };
};

/**
 * Build the resolved static scene graph. Roots in `nodes[]` order, children in
 * array order, hidden subtrees omitted. Template/CSV content is not executed
 * here; `ctx.overrides` (from the async P6 pre-pass) supplies evaluated content
 * keyed by node id, otherwise csv/template render their static `fallback`.
 */
export const resolve = (doc: LabelDoc, ctx: ResolveContext = {}): ResolvedNode[] => {
    const emptyText = ctx.emptyText ?? DEFAULT_EMPTY_TEXT;
    const overrides = ctx.overrides;
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
                const content = resolveContent(node.text, emptyText, overrides?.get(node.id));
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
                    wrap: node.wrap ?? DEFAULT_TEXT_WRAP,
                    lineHeight: node.lineHeight ?? 1,
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
                            cornerRadius: node.cornerRadius ?? 0,
                            ...shapeStyle(node),
                            bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                        };
                    }
                    case 'ellipse': {
                        const { w, h } = nodeSize(node);
                        // Odd hm widths give a fractional half-axis; round it so the
                        // resolved rx/ry are integers. Bounds use the full box, not
                        // 2×rx, so they never lose the odd millimetre.
                        const rx = Math.round(w / 2);
                        const ry = Math.round(h / 2);
                        return {
                            ...base,
                            type: 'ellipse',
                            rx,
                            ry,
                            ...shapeStyle(node),
                            bounds: transformedBounds(rectCorners(-rx, -ry, w, h), base.transform),
                        };
                    }
                    case 'line':
                    case 'polygon': {
                        const points = node.points ?? [];
                        const closed = isClosedShape(node.shape, node.closed);
                        return {
                            ...base,
                            type: node.shape,
                            points,
                            closed,
                            ...shapeStyle(node),
                            bounds: transformedBounds(points, base.transform),
                        };
                    }
                }
                break;
            case 'image': {
                const { w, h } = nodeSize(node);
                return {
                    ...base,
                    type: 'image',
                    imageId: node.imageId,
                    w,
                    h,
                    fit: node.fit ?? DEFAULT_IMAGE_FIT,
                    bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                };
            }
            case 'qr': {
                const { w, h } = nodeSize(node);
                const content = resolveContent(node.data, emptyText, overrides?.get(node.id));
                return {
                    ...base,
                    type: 'qr',
                    text: content.text,
                    placeholder: content.placeholder,
                    w,
                    h,
                    errorCorrection: node.errorCorrection ?? DEFAULT_QR_ERROR_CORRECTION,
                    fill: node.fill ?? DEFAULT_SYMBOL_FILL,
                    quietModules: node.quietZone ?? DEFAULT_QR_QUIET_MODULES,
                    bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                };
            }
            case 'barcode': {
                const { w, h } = nodeSize(node);
                const content = resolveContent(node.data, emptyText, overrides?.get(node.id));
                const symbology = node.symbology ?? DEFAULT_BARCODE_SYMBOLOGY;
                return {
                    ...base,
                    type: 'barcode',
                    text: content.text,
                    placeholder: content.placeholder,
                    w,
                    h,
                    symbology,
                    fill: node.fill ?? DEFAULT_SYMBOL_FILL,
                    quietModules: node.quietZone ?? barcodeQuietModules(symbology),
                    bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                };
            }
            case 'code': {
                const { w, h } = nodeSize(node);
                const content = resolveContent(node.data, emptyText, overrides?.get(node.id));
                return {
                    ...base,
                    type: 'code',
                    text: content.text,
                    placeholder: content.placeholder,
                    w,
                    h,
                    format: node.format,
                    fill: node.fill ?? DEFAULT_SYMBOL_FILL,
                    quietModules: node.quietZone ?? codeQuietModules(node.format),
                    bounds: transformedBounds(rectCorners(0, 0, w, h), base.transform),
                };
            }
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
