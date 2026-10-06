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
 *
 * `x`/`y` are the node's own origin, not the Transformer's AABB: for a rect
 * that is the top-left, for an ellipse it is the **centre** (`resolve.ts`
 * bounds are centre-origin). Konva positions that origin for the anchored edge,
 * so committing it verbatim is exactly WYSIWYG for both kinds.
 */
export interface LiveTransform {
    x: number;
    y: number;
    rotDeg: number;
    /**
     * The live Transformer's **signed** scale. Konva's `Transformer.flipEnabled`
     * defaults to `true`, so dragging a handle past the opposite edge mirrors the
     * node and `_fitNodesInto` writes a **negative** scale; that sign must reach
     * the commit or the mirror reverts on release. Optional so a caller that
     * knows the gesture did not flip (and legacy tests) may omit it — it then
     * defaults to a positive `1`.
     */
    scaleX?: number;
    scaleY?: number;
}

/**
 * True when a Transformer anchor is one of the four diagonal corners
 * (`top-left`, `top-right`, `bottom-left`, `bottom-right`). Konva applies
 * `keepRatio` **only** to corners; the four side anchors (`top-center`,
 * `bottom-center`, `middle-left`, `middle-right`) always free-stretch, and the
 * `rotater` is not a resize anchor at all (#13).
 */
const CORNER_ANCHOR = /^(top|bottom)-(left|right)$/;
export const isCornerAnchor = (anchor: string | null | undefined): boolean =>
    CORNER_ANCHOR.test(anchor ?? '');

/**
 * Patch that combines a free/aspect-locked resize with the node's final
 * position + rotation, as one op. Resize bakes the **magnitude** into
 * `size`/`points`/`strokeWidth`/`fontSize`/`cornerRadius`; the transform takes
 * the **live** decomposed x/y/rotDeg and collapses the live scale to its
 * **sign** (`-1`/`1`, never the magnitude — that is baked into geometry).
 *
 * The sign is preserved because Konva's `Transformer.flipEnabled` defaults to
 * `true`: dragging a handle **past the opposite edge** mirrors the node and
 * `_fitNodesInto` produces a negative scale. Resetting it to `1` made the
 * mirrored live result revert on release (not WYSIWYG). The size stays baked
 * positive because `target` already comes from `transformerTargetSize`, which
 * takes the magnitudes, so the geometry is symmetric and only the transform
 * needs the sign.
 *
 * `uniformScale` is the live gesture's single factor for a corner drag; passing
 * it lets the resize use the exact live ratio instead of re-deriving one from
 * the (integer-rounded) target box.
 */
export const transformEndPatch = (
    node: Node,
    target: Size,
    preserveAspect: boolean,
    live: LiveTransform,
    uniformScale?: number,
): NodePatch => {
    const resized = resizeNodeGeometry(node, target, { preserveAspect, uniformScale });
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
            // Konva's live x/y already holds the anchored edge; commit it as-is.
            // `Math.round` snaps to the doc-wide integer-hm granularity (print
            // math reads integer hm), costing at most 0.5 hm (< 0.005 mm) of
            // drift on release — below the printer's resolution and invisible at
            // preview scale, so it is acceptable. Translation is not the only
            // source of release drift: the caller also rounds the target box.
            // `transformerTargetSize` folds the node's **stored**
            // `transform.scale` into that target, and `resizeNodeGeometry` bakes
            // the same factor into `size` before the scale collapses to its sign
            // below. Passing
            // `uniformScale = |scaleX|` (stored scale × live gesture factor)
            // keeps all three consistent, so the rounded box cannot bias the
            // committed geometry off the live gesture.
            x: Math.round(live.x),
            y: Math.round(live.y),
            rotDeg: live.rotDeg,
            // Preserve the **sign** of the live scale (a handle dragged past the
            // opposite edge mirrors the node); the magnitude is already baked
            // into the geometry above. `Math.sign(x) || 1` maps 0/NaN to 1.
            scaleX: Math.sign(live.scaleX ?? 1) || 1,
            scaleY: Math.sign(live.scaleY ?? 1) || 1,
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

/**
 * Whether a Transformer gesture should preserve aspect **at commit**, mirroring
 * the live gesture exactly (#13).
 *
 * Konva applies `keepRatio` only to the four corner anchors, so:
 * - a **side** anchor (or the `rotater`) always free-stretches ⇒ `false`;
 * - a **corner** holds the ratio only when the live Transformer had `keepRatio`
 *   on (`selectionLocked` — a single aspect-default node) or a modifier forces
 *   it (Konva's default `shiftBehavior` ORs Shift into the ratio).
 *
 * The modifier then inverts the per-node default via `preserveAspectFor`, so
 * Shift/Alt can opt a non-aspect node into (or an aspect node out of) the lock.
 * This replaces the old unconditional `preserveAspectFor(node, inverted)`, which
 * locked a side-anchor drag and snapped it to `Math.max(rawX, rawY)` on release.
 */
export const gesturePreservesAspect = (
    node: Node,
    anchor: string | null | undefined,
    inverted: boolean,
    selectionLocked: boolean,
): boolean =>
    isCornerAnchor(anchor) &&
    (selectionLocked || inverted) &&
    preserveAspectFor(node, inverted);

/**
 * Whether a Transformer gesture should **commit** with the ratio held, given
 * what the live gesture actually did (`liveUniform` = the node's live
 * `|scaleX| == |scaleY|`). This is the live↔commit parity check (#13): the
 * commit must mirror Konva's real uniform/free choice, not re-derive it.
 *
 * Konva's corner decision is `keepRatio || shift` (`Transformer.js`), so a
 * single aspect-default node (`keepRatio` on, `selectionLocked`) **always** ran
 * its corner uniform — including with a modifier held, which the
 * modifier-inverted policy (`gesturePreservesAspect`) would wrongly release.
 * For those nodes the observed `liveUniform` is authoritative. A non-aspect
 * node's corner locked only when a modifier forced it, so the policy decides;
 * `liveUniform` still guards it because the modifier ref cannot tell Shift
 * (which forces the ratio) from centred-only Alt (which does not). Side anchors
 * (`isCornerAnchor` false) always free-stretch.
 */
export const commitPreservesAspect = (
    node: Node,
    anchor: string | null | undefined,
    inverted: boolean,
    selectionLocked: boolean,
    liveUniform: boolean,
): boolean =>
    preservesAspectByDefault(node)
        ? isCornerAnchor(anchor) && liveUniform
        : gesturePreservesAspect(node, anchor, inverted, selectionLocked) && liveUniform;
