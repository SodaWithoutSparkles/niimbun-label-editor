import { preservesAspectByDefault, resizeNodeGeometry, type Size } from '../core/doc/geometry';
import type { Node } from '../core/doc/types';
import type { NodePatch } from '../store/storeTypes';

/**
 * Pure gesture math for the Preview's pointer interactions (ui-spec.md §5).
 * No Konva, no store, no React — the drag and transform-end behavior the
 * Preview wires up is asserted here without a canvas.
 *
 * Both gestures bake into geometry rather than compounding the transform scale
 * (plan §13): the Transformer's live scale/rotation never reaches the document.
 */

/** A node's committed transform + the origin values a drag must preserve. */
export interface DragOrigin {
    x: number;
    y: number;
    rotDeg: number;
    scaleX: number;
    scaleY: number;
}

export const dragOriginOf = (node: Node): DragOrigin => ({ ...node.transform });

/**
 * Patch for a move gesture: only `x`/`y` change; the node's own `rotDeg`,
 * `scaleX` and `scaleY` are carried through unchanged (must-fix #4 — a
 * hard-coded `rotDeg: 0, scaleX: 1, scaleY: 1` silently un-rotates/un-scales).
 */
export const movePatch = (
    origin: DragOrigin,
    dx: number,
    dy: number,
): { transform: DragOrigin } => ({
    transform: {
        x: Math.round(origin.x + dx),
        y: Math.round(origin.y + dy),
        rotDeg: origin.rotDeg,
        scaleX: origin.scaleX,
        scaleY: origin.scaleY,
    },
});

/**
 * Patch that combines a free/aspect-locked resize with the node's final
 * rotation, as one op. Resize bakes into `size`/`points`/`strokeWidth`/
 * `fontSize`/`cornerRadius`; the transform's scale resets to 1 and carries the
 * new `rotDeg`.
 */
export const transformEndPatch = (
    node: Node,
    target: Size,
    preserveAspect: boolean,
    rotation: number,
): NodePatch => {
    const resized = resizeNodeGeometry(node, target, { preserveAspect });
    // `resizeNodeGeometry` returns a new node; take its geometry fields and
    // reset the transform scale (the live Transformer scale is not persisted).
    const { size, points, cornerRadius, strokeWidth, fontSize } = resized as Node & {
        size?: Size;
        points?: [number, number][];
        cornerRadius?: number;
        strokeWidth?: number;
        fontSize?: number;
    };
    return {
        ...(size !== undefined ? { size } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(cornerRadius !== undefined ? { cornerRadius } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth } : {}),
        ...(fontSize !== undefined ? { fontSize } : {}),
        transform: { ...node.transform, rotDeg: rotation, scaleX: 1, scaleY: 1 },
    } as NodePatch;
};

/**
 * Whether a transform gesture should preserve aspect. The plan default is
 * aspect-preserving for circle/ellipse/QR/image and free for
 * rect/line/polygon/text; a shift/alt press **inverts** that default, so the
 * user can opt out (or in) per gesture from the UI.
 */
export const preserveAspectFor = (node: Node, inverted: boolean): boolean => {
    const byDefault = preservesAspectByDefault(node);
    return inverted ? !byDefault : byDefault;
};
