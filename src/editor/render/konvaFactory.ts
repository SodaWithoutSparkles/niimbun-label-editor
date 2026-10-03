import Konva from 'konva';
import type { Mat2D } from '../../core/doc/derive';
import type { ResolvedNode } from './resolve';

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

const flattenPoints = (points: readonly [number, number][]): number[] => {
    const out: number[] = [];
    for (const [x, y] of points) out.push(x, y);
    return out;
};

/** Build an offscreen plain-Konva node for a resolved node (recurses for groups). */
export const createKonvaNode = (node: ResolvedNode): Konva.Group | Konva.Shape => {
    switch (node.type) {
        case 'group': {
            const group = new Konva.Group();
            for (const child of node.children) group.add(createKonvaNode(child));
            return withTransform(group, node.localTransform);
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
            return withTransform(
                new Konva.Line({ points: flattenPoints(node.points), closed: node.closed }),
                node.localTransform,
            );
        case 'polygon':
            return withTransform(
                new Konva.Line({ points: flattenPoints(node.points), closed: node.closed }),
                node.localTransform,
            );
        case 'rectangle':
            return withTransform(
                new Konva.Rect({ x: 0, y: 0, width: node.w, height: node.h }),
                node.localTransform,
            );
        case 'ellipse':
            return withTransform(
                new Konva.Ellipse({ x: 0, y: 0, radiusX: node.rx, radiusY: node.ry }),
                node.localTransform,
            );
    }
};
