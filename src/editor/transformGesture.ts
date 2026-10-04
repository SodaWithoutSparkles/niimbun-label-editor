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
 * The live geometry Konva's Transformer decomposed the gesture into. Konva
 * mutates the node's own `x`/`y` (so a top/left anchor keeps the opposite
 * corner fixed) and its `rotation`; all three must be committed or the node
 * jumps on release (must-fix #6).
 */
export interface LiveTransform {
    x: number;
    y: number;
    rotDeg: number;
}

/**
 * Patch that combines a free/aspect-locked resize with the node's final
 * position + rotation, as one op. Resize bakes into `size`/`points`/
 * `strokeWidth`/`fontSize`/`cornerRadius`; the transform takes the **live**
 * decomposed x/y/rotDeg and resets the scale to 1 (the live Transformer scale
 * is baked into geometry, not persisted).
 */
export const transformEndPatch = (
    node: Node,
    target: Size,
    preserveAspect: boolean,
    live: LiveTransform,
): NodePatch => {
    const resized = resizeNodeGeometry(node, target, { preserveAspect });
    // `resizeNodeGeometry` returns a new node; take its geometry fields and fold
    // in the live transform (translation included — dropping x/y was the jump).
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
        transform: {
            x: Math.round(live.x),
            y: Math.round(live.y),
            rotDeg: live.rotDeg,
            scaleX: 1,
            scaleY: 1,
        },
    } as NodePatch;
};

/**
 * Resize target for a Transformer gesture (must-fix #2): the node's real base
 * extent scaled by the live Konva scale. `Konva.Line`/polygon have no
 * `width()`/`height()`, so the caller must pass `pointsExtent` as the base
 * rather than reading the node's box. `scaleX`/`scaleY` of 0 fall back to 1.
 */
export const transformerTargetSize = (base: Size, scaleX: number, scaleY: number): Size => ({
    w: base.w * (Math.abs(scaleX) || 1),
    h: base.h * (Math.abs(scaleY) || 1),
});

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
