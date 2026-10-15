import { effectiveTransform } from '../core/doc/derive';
import { nodeLocalPoints, transformedBounds } from './render/resolve';
import { translateWorldPatch } from './transformPatch';
import type { Node } from '../core/doc/types';
import type { NodePatch } from '../store/storeTypes';

/**
 * Arrange geometry (ui-spec.md §10) — pure helpers shared by the Object tab and
 * the top-right icon block (`ViewControls`). Nothing here touches the store or
 * React: `alignTransformPatch` / `tileLayout` / `tileTransformPatch` return
 * world-space patches, and the caller commits them (`useArrange`).
 */

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type TileAxis = 'vertical' | 'horizontal';

/** World-space AABB of a node under its effective parent chain. */
export const nodeWorldBounds = (node: Node, byId: ReadonlyMap<string, Node>) =>
    transformedBounds(nodeLocalPoints(node), effectiveTransform(node, byId));

/**
 * True when a node carries real local geometry. A `group` (and a point-shape
 * with no points) has none: `nodeLocalPoints` returns `[]`, so `nodeWorldBounds`
 * is the degenerate `{0,0,0,0}` box at the world origin. Such a fake origin must
 * never win a tiling sort or be aligned, so tile/align skip these nodes.
 */
export const hasLocalGeometry = (node: Node): boolean => nodeLocalPoints(node).length > 0;

/**
 * Patch that aligns a node to a backing edge (must-fix #10). The target is
 * computed from the node's resolved **world** bounds and its real geometry
 * (`nodeLocalPoints`, so line/polygon work too). The resulting world delta is
 * converted into the parent-local space before it is folded into `transform.x/y`,
 * so aligning under a translated/rotated parent does not jump.
 *
 * A geometry-less node (a group, or a point-shape with no points) has no bounds
 * to align — its degenerate world box sits at the origin — so this returns
 * `null` and the caller leaves it untouched.
 */
export const alignTransformPatch = (
    node: Node,
    byId: ReadonlyMap<string, Node>,
    backingW: number,
    backingH: number,
    edge: AlignEdge,
): NodePatch | null => {
    if (!hasLocalGeometry(node)) return null;
    const bounds = nodeWorldBounds(node, byId);
    let worldDx = 0;
    let worldDy = 0;
    if (edge === 'left') worldDx = -bounds.x;
    else if (edge === 'center') worldDx = Math.round(backingW / 2 - (bounds.x + bounds.w / 2));
    else if (edge === 'right') worldDx = Math.round(backingW - (bounds.x + bounds.w));
    else if (edge === 'top') worldDy = -bounds.y;
    else if (edge === 'middle') worldDy = Math.round(backingH / 2 - (bounds.y + bounds.h / 2));
    else worldDy = Math.round(backingH - (bounds.y + bounds.h));

    return translateWorldPatch(node, byId, worldDx, worldDy);
};

/** Gap between tiled neighbours in hm (1/100 mm): 100 hm = 1 mm. */
export const TILE_GAP_HM = 100;

/** World-space center along the tiling axis (`vertical` stacks by cy). */
const centerAlong = (node: Node, byId: ReadonlyMap<string, Node>, axis: TileAxis): number => {
    const bounds = nodeWorldBounds(node, byId);
    return axis === 'vertical' ? bounds.y + bounds.h / 2 : bounds.x + bounds.w / 2;
};

/**
 * Target world top-left for every node in a vertical/horizontal tile. The
 * anchor is the first node ordered by world center along the axis (smallest `cy`
 * for vertical, smallest `cx` for horizontal) and keeps its position. Each
 * following node is placed adjacent to the previous one with a fixed `gapHm`,
 * cross-axis-aligned to the anchor's bounds edge. Tiling only translates, so
 * each node keeps its own size.
 *
 * Geometry-less nodes (groups, empty point-shapes) are dropped entirely: their
 * degenerate `{0,0,0,0}` world bounds would otherwise sort to the fake origin,
 * become the anchor, and tile the whole selection into the world origin. They
 * are neither in the returned map nor eligible as the anchor.
 */
export const tileLayout = (
    nodes: readonly Node[],
    byId: ReadonlyMap<string, Node>,
    axis: TileAxis,
    gapHm: number,
): Map<string, { x: number; y: number }> => {
    const targets = new Map<string, { x: number; y: number }>();
    const ordered = nodes
        .filter(hasLocalGeometry)
        .sort((a, b) => centerAlong(a, byId, axis) - centerAlong(b, byId, axis));
    const anchor = ordered[0];
    if (!anchor) return targets;
    const anchorBounds = nodeWorldBounds(anchor, byId);
    const cross = axis === 'vertical' ? anchorBounds.x : anchorBounds.y;
    let cursor = axis === 'vertical' ? anchorBounds.y : anchorBounds.x;
    for (const node of ordered) {
        targets.set(node.id, axis === 'vertical' ? { x: cross, y: cursor } : { x: cursor, y: cross });
        const bounds = nodeWorldBounds(node, byId);
        cursor += (axis === 'vertical' ? bounds.h : bounds.w) + gapHm;
    }
    return targets;
};

/** Patch that translates a node so its world top-left lands on the target. */
export const tileTransformPatch = (
    node: Node,
    byId: ReadonlyMap<string, Node>,
    targetWorldX: number,
    targetWorldY: number,
): NodePatch | null => {
    const bounds = nodeWorldBounds(node, byId);
    return translateWorldPatch(node, byId, targetWorldX - bounds.x, targetWorldY - bounds.y);
};
