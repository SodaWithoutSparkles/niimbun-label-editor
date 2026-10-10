import Konva from 'konva';
import type { Mat2D } from '../../core/doc/derive';
import type { ImageFit, TextWrap } from '../../core/doc/objects';
import type { PreparedAsset } from './assets';
import { measureKonvaText } from './textMetrics';
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
 *
 * `strokeWidth` is in `hm` and is invariant under a node's own scale: a resize
 * changes geometry, not ink width. The print factory keeps Konva's default
 * `strokeScaleEnabled` so the raster stage's `hm → px` scale thickens the stroke
 * to `dpi`, and the node's own committed `transform.scale` scales it further; the
 * preview disables stroke scaling on its nodes and pre-multiplies the width by
 * the viewport zoom and `|transform.scaleX|` instead. Both paths therefore render
 * the same on-screen line width when `|transform.scale| == 1` (and approximately
 * so otherwise: for a non-uniform node scale print renders an elliptical stroke,
 * which the preview's `strokeScaleEnabled: false` cannot reproduce; parity is
 * also only approximate for a node nested under a scaled ancestor group, where
 * the preview cancels the group scale but print composes it). This mapping
 * must NOT carry `strokeScaleEnabled: false` — that would cancel the print stage's
 * scale and render the stroke at device px.
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

/**
 * The **one** mapping from a text node's `wrap` mode to Konva's `wrap` prop
 * (P5). `word` wraps at words; `char` wraps per character; `clip` and `shrink`
 * both wrap at words (`clip` then relies on Konva hiding lines past the box
 * height; `shrink` is downscaled by `measureKonvaText`). Shared by both
 * renderers so preview ≡ print.
 */
export const konvaTextWrap = (wrap: TextWrap): 'word' | 'char' =>
    wrap === 'char' ? 'char' : 'word';

/** The box + fit an image leaf uses; barcodes cover to prioritize full width. */
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
 * Custom `sceneFunc` for a prepared **symbol** (qr/barcode) `Konva.Image`: draw
 * the raster with `imageSmoothingEnabled = false` so a fractional fit pitch
 * produces hard module edges instead of antialiased greys straddling the
 * quantizer threshold (owner decision D, P1 #13).
 *
 * A per-node `imageSmoothingEnabled` config is **not** honoured on the normal
 * scene draw: `Konva.Image._useBufferCanvas()` is `false` for our images (no
 * fill + stroke + non-1 opacity), and only that buffer path reads the attr — so
 * the toggle must wrap the actual draw. This mirrors
 * `Konva.Image._sceneFunc` (`konva/lib/shapes/Image.js`): crop-vs-plain
 * `drawImage` plus the fill/stroke/corner-radius branch, and always restores the
 * raw context state in a `finally`. Photos never use this function and keep the
 * default smoothing.
 */
export const symbolSceneFunc = (context: Konva.Context, shape: Konva.Shape): void => {
    const image = shape.attrs.image as CanvasImageSource | undefined;
    const raw = context._context;
    const previousSmoothing = raw.imageSmoothingEnabled;
    raw.imageSmoothingEnabled = false;
    try {
        const width = shape.width();
        const height = shape.height();
        const cornerRadius = (shape as Konva.Image).cornerRadius();
        if (shape.hasFill() || shape.hasStroke() || cornerRadius) {
            context.beginPath();
            if (cornerRadius) Konva.Util.drawRoundedRectPath(context, width, height, cornerRadius);
            else context.rect(0, 0, width, height);
            context.closePath();
            context.fillStrokeShape(shape);
        }
        if (image) {
            if (cornerRadius) context.clip();
            const cropWidth = shape.attrs.cropWidth as number | undefined;
            const cropHeight = shape.attrs.cropHeight as number | undefined;
            if (cropWidth && cropHeight) {
                const img = shape as Konva.Image;
                context.drawImage(
                    image,
                    img.cropX(),
                    img.cropY(),
                    cropWidth,
                    cropHeight,
                    0,
                    0,
                    width,
                    height,
                );
            } else {
                context.drawImage(image, 0, 0, width, height);
            }
        }
    } finally {
        raw.imageSmoothingEnabled = previousSmoothing;
    }
};

/**
 * Custom `sceneFunc` for the **policy mask** stencil (P2 fix A). Draws a
 * prepared asset's **visible ink** tinted to the policy key colour: the asset is
 * rendered into a scratch canvas, tinted with `source-in`, then blitted into the
 * current (transformed) mask space. Transparent pixels draw nothing, so the leaf
 * below keeps its policy — the coverage approximation that caused the stacking
 * bug is gone. `fill`-opaque symbols are fully opaque and claim their whole rect.
 *
 * The scratch canvas is drawn 1:1 (never resampled) so the tint boundary matches
 * the raster's module edges; for a `cover` fit the source crop is honoured.
 *
 * Coverage is snapped to **binary** before the blit: any visible ink (non-zero
 * alpha) claims its policy, transparent claims nothing. The tint colour is
 * therefore always full-strength at the nearest-key reader, so no key-colour
 * blending can occur — a semi-transparent `fill` (`#rrggbbaa`) or a
 * partially-opaque PNG claims exactly the pixels where the raster deposits ink.
 */
export interface MaskAssetAttrs {
    asset: PreparedAsset;
    boxW: number;
    boxH: number;
    fit: ImageFit;
    /** Key colour for this leaf's policy (`rgb(...)`). */
    color: string;
    /** qr/barcode (nearest-neighbour, option D). Photos are not symbols: smoothing stays on (only the tinted edge matters). */
    symbol: boolean;
}

export const maskAssetSceneFunc = (context: Konva.Context, shape: Konva.Shape): void => {
    const attrs = shape.attrs.mask as MaskAssetAttrs | undefined;
    if (!attrs) return;
    const { asset, boxW, boxH, fit, color, symbol } = attrs;
    const srcW = Math.max(1, Math.round(asset.widthPx));
    const srcH = Math.max(1, Math.round(asset.heightPx));
    const scratch = document.createElement('canvas');
    scratch.width = srcW;
    scratch.height = srcH;
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) return;
    scratchCtx.drawImage(asset.image, 0, 0, srcW, srcH);
    scratchCtx.globalCompositeOperation = 'source-in';
    scratchCtx.fillStyle = color;
    scratchCtx.fillRect(0, 0, srcW, srcH);

    // Snap coverage to binary: any non-zero alpha claims its policy, zero claims
    // nothing. Without this a semi-transparent `fill` (`#rrggbbaa`) or a
    // partially-opaque PNG keeps a partial alpha that the mask reader's
    // `alpha < 128` test drops — ink in the raster that claims no policy.
    const img = scratchCtx.getImageData(0, 0, srcW, srcH);
    const data = img.data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) data[i] = 255;
    scratchCtx.putImageData(img, 0, 0);

    const { crop, ...rect } = fitImageAttrs(boxW, boxH, asset.widthPx, asset.heightPx, fit);
    const raw = context._context;
    const previousSmoothing = raw.imageSmoothingEnabled;
    // Symbol masks are thresholded on hard module edges; a photo's coverage is
    // its drawn rect either way, so smoothing only matters for the tinted edge.
    raw.imageSmoothingEnabled = symbol ? false : true;
    try {
        if (crop) {
            context.drawImage(
                scratch,
                crop.x,
                crop.y,
                crop.width,
                crop.height,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
            );
        } else {
            context.drawImage(scratch, rect.x, rect.y, rect.width, rect.height);
        }
    } finally {
        raw.imageSmoothingEnabled = previousSmoothing;
    }
};

/**
 * Build a `Konva.Image` for a prepared asset from {@link fitImageAttrs}.
 *
 * `symbol` selects nearest-neighbour drawing for a qr/barcode raster (option D);
 * photos keep the default smoothing (their module grid is not a hard edge).
 */
const createFittedImage = (box: FitBox, asset: PreparedAsset, symbol: boolean): Konva.Image => {
    const { crop, ...rect } = fitImageAttrs(box.w, box.h, asset.widthPx, asset.heightPx, box.fit);
    return new Konva.Image({
        image: asset.image,
        ...rect,
        ...(crop ? { crop } : {}),
        ...(symbol ? { sceneFunc: symbolSceneFunc } : {}),
    });
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
            const fit: ImageFit = node.type === 'image' ? node.fit : node.type === 'barcode' ? 'cover' : 'contain';
            // The node transform lives on a group so the fitted image keeps its
            // local fit offset (`contain` centring / `cover` crop origin). Setting
            // the transform on the image itself would overwrite that x/y with the
            // node's translation (contain images rendered top-left anchored).
            const imageGroup = new Konva.Group();
            imageGroup.add(
                createFittedImage({ w: node.w, h: node.h, fit }, asset, node.type !== 'image'),
            );
            return withTransform(imageGroup, node.localTransform);
        }
        case 'text': {
            const attrs = matrixToKonvaAttrs(node.localTransform);
            const text = new Konva.Text({
                text: node.text,
                width: node.w,
                height: node.h,
                fontSize: node.fontSize,
                fontFamily: node.fontFamily,
                fontStyle: node.fontStyle,
                align: node.align,
                padding: node.paddingHm,
                wrap: konvaTextWrap(node.wrap),
                lineHeight: node.lineHeight,
            });
            if (node.wrap === 'shrink') {
                const metrics = measureKonvaText({
                    text: node.text,
                    width: node.w,
                    height: node.h,
                    fontSize: node.fontSize,
                    fontFamily: node.fontFamily,
                    fontStyle: node.fontStyle,
                    wrap: 'word',
                    lineHeight: node.lineHeight,
                });
                // Shrink scale composes with the node's own transform scale
                // (Konva scales a text from its top-left origin, offset 0).
                attrs.scaleX *= metrics.scale;
                attrs.scaleY *= metrics.scale;
            }
            text.setAttrs(attrs);
            return text;
        }
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
