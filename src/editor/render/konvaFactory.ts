import Konva from 'konva';
import type { Mat2D } from '../../core/doc/derive';
import type { ImageFit } from '../../core/doc/objects';
import type { PreparedAsset } from './assets';
import type {
    ResolvedEllipse,
    ResolvedLine,
    ResolvedNode,
    ResolvedPolygon,
    ResolvedRectangle,
} from './resolve';

/**
 * Plain-Konva node factory (plan decision 9 — shared with P4 later).
 *
 * **No react-konva.** Given a resolved node it returns an offscreen Konva node
 * whose transform reproduces the node's `localTransform`; groups nest, so Konva
 * recomposes the same parent × child product as `derive.effectiveTransform`.
 *
 * `resolvedNode.transform` (the absolute matrix) is the authority for bounds and
 * P4; this factory uses `localTransform` only so the scene graph nests correctly.
 * Konva cannot store a raw matrix, so `matrixToKonvaAttrs` decomposes one into
 * Konva's translate/rotate/skew/scale attrs exactly (including shear).
 */

export interface KonvaTransformAttrs {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    skewX: number;
}

/**
 * Decompose an affine matrix into Konva attrs. Konva composes
 * `translate → rotate → skew → scale`, i.e. `T · R · K · S`, which is invertible
 * for any affine matrix. `skewX` is Konva's raw shear factor (`x' = x + skewX·y`).
 */
export const matrixToKonvaAttrs = (m: Mat2D): KonvaTransformAttrs => {
    const { a, b, c, d, e, f } = m;
    const scaleX = Math.hypot(a, b);
    const det = a * d - b * c;
    const scaleY = scaleX === 0 ? 0 : det / scaleX;
    const rotation = scaleX === 0 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
    const skewX = det === 0 ? 0 : (a * c + b * d) / det;
    return { x: e, y: f, rotation, scaleX, scaleY, skewX };
};

const withTransform = <T extends Konva.Node>(node: T, m: Mat2D): T => {
    node.setAttrs(matrixToKonvaAttrs(m));
    return node;
};

/** A resolved shape leaf (the four kinds that carry `ResolvedShapeStyle`). */
export type ResolvedShapeNode =
    | ResolvedLine
    | ResolvedRectangle
    | ResolvedEllipse
    | ResolvedPolygon;

/** Konva fill/stroke attrs for a resolved shape leaf. `fill` is always a string. */
export interface ShapeStyleAttrs {
    fill: string;
    stroke: string;
    strokeWidth: number;
    cornerRadius?: number;
}

/**
 * The **one** mapping from a resolved shape leaf to its Konva style attrs (#8).
 * The preview (`ResolvedShape.tsx`) and the print factory both read this, so
 * `fill`/`stroke`/`strokeWidth`/`cornerRadius` start identical — preview ≡ print
 * by construction. The preview then overrides `stroke`/`strokeWidth` **only** for
 * the editor's selection/warn highlight, never for print. No Konva default or
 * local constant is consulted here; `resolve` already applied the defaults.
 */
export const shapeStyleAttrs = (node: ResolvedShapeNode): ShapeStyleAttrs => ({
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    ...(node.type === 'rectangle' ? { cornerRadius: node.cornerRadius } : {}),
});

const flattenPoints = (points: readonly [number, number][]): number[] => {
    const out: number[] = [];
    for (const [x, y] of points) out.push(x, y);
    return out;
};

/** The box + fit an image leaves uses; qr/barcode are always `contain`. */
interface FitBox {
    w: number;
    h: number;
    fit: ImageFit;
}

/** A source-pixel crop rect for `cover`. */
export interface ImageCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The drawn rect (box-local px) plus an optional source crop. */
export interface FittedImageAttrs {
    x: number;
    y: number;
    width: number;
    height: number;
    crop?: ImageCrop;
}

/**
 * Compute the draw rect for a prepared asset inside `boxW`×`boxH`:
 *   - `contain` (default): preserve aspect, centre inside the box;
 *   - `cover`: preserve aspect, fill the box and crop the overflow;
 *   - `stretch`: fill the box without preserving aspect.
 *
 * Exported so the policy mask can paint the **drawn** rect (not the whole box)
 * for an image/qr/barcode leaf, keeping mask-topmost == raster-topmost.
 */
export const fitImageAttrs = (
    boxW: number,
    boxH: number,
    srcW: number,
    srcH: number,
    fit: ImageFit,
): FittedImageAttrs => {
    if (fit === 'stretch') {
        return { x: 0, y: 0, width: boxW, height: boxH };
    }

    if (fit === 'cover' && srcW > 0 && srcH > 0 && boxW > 0 && boxH > 0) {
        const boxAspect = boxW / boxH;
        const imageAspect = srcW / srcH;
        let crop: ImageCrop;
        if (imageAspect > boxAspect) {
            const cropW = srcH * boxAspect;
            crop = { x: (srcW - cropW) / 2, y: 0, width: cropW, height: srcH };
        } else {
            const cropH = srcW / boxAspect;
            crop = { x: 0, y: (srcH - cropH) / 2, width: srcW, height: cropH };
        }
        return { x: 0, y: 0, width: boxW, height: boxH, crop };
    }

    // contain (and the guarded fallback for a degenerate box).
    const scale = srcW > 0 && srcH > 0 ? Math.min(boxW / srcW, boxH / srcH) : 0;
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    return { x: (boxW - drawW) / 2, y: (boxH - drawH) / 2, width: drawW, height: drawH };
};

/**
 * Build a `Konva.Image` for a prepared asset from {@link fitImageAttrs}.
 */
const createFittedImage = (box: FitBox, asset: PreparedAsset): Konva.Image => {
    const { crop, ...rect } = fitImageAttrs(box.w, box.h, asset.widthPx, asset.heightPx, box.fit);
    return new Konva.Image({ image: asset.image, ...rect, ...(crop ? { crop } : {}) });
};

/** Build an offscreen plain-Konva node for a resolved node (recurses for groups). */
export const createKonvaNode = (
    node: ResolvedNode,
    assets?: ReadonlyMap<string, PreparedAsset>,
): Konva.Group | Konva.Shape => {
    switch (node.type) {
        case 'group': {
            const group = new Konva.Group();
            for (const child of node.children) group.add(createKonvaNode(child, assets));
            return withTransform(group, node.localTransform);
        }
        case 'image':
        case 'qr':
        case 'barcode': {
            const asset = assets?.get(node.id);
            if (!asset) {
                // Missing/unprepared asset draws nothing (the editor overlays a
                // labelled placeholder; the print path stays blank-white).
                return withTransform(new Konva.Group(), node.localTransform);
            }
            const fit: ImageFit = node.type === 'image' ? node.fit : 'contain';
            // The node transform lives on a group so the fitted image keeps its
            // local fit offset (`contain` centring / `cover` crop origin). Setting
            // the transform on the image itself would overwrite that x/y with the
            // node's translation (contain images rendered top-left anchored).
            const imageGroup = new Konva.Group();
            imageGroup.add(createFittedImage({ w: node.w, h: node.h, fit }, asset));
            return withTransform(imageGroup, node.localTransform);
        }
        case 'text':
            return withTransform(
                new Konva.Text({
                    text: node.text,
                    width: node.w,
                    height: node.h,
                    fontSize: node.fontSize,
                    fontFamily: node.fontFamily,
                    fontStyle: node.fontStyle,
                    align: node.align,
                    padding: node.paddingHm,
                }),
                node.localTransform,
            );
        case 'line':
        case 'polygon':
            return withTransform(
                new Konva.Line({
                    points: flattenPoints(node.points),
                    closed: node.closed,
                    ...shapeStyleAttrs(node),
                }),
                node.localTransform,
            );
        case 'rectangle':
            return withTransform(
                new Konva.Rect({
                    x: 0,
                    y: 0,
                    width: node.w,
                    height: node.h,
                    ...shapeStyleAttrs(node),
                }),
                node.localTransform,
            );
        case 'ellipse':
            return withTransform(
                new Konva.Ellipse({
                    x: 0,
                    y: 0,
                    radiusX: node.rx,
                    radiusY: node.ry,
                    ...shapeStyleAttrs(node),
                }),
                node.localTransform,
            );
    }
};
