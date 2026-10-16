import type { LabelDoc } from '../core/doc/types';
import { hitTestWorld, type HitTestable, type Point, type Rect } from '../core/viewport';
import { flattenResolved, resolve } from './render/resolve';

/**
 * Selection-model helpers (ui-spec.md §10). Pure functions over the document and
 * the current selection id list, so the click/shift/marquee behavior is
 * unit-testable without React or Konva.
 */

/** `Esc` / empty-canvas click → clear. */
export const clearedSelection = (): string[] => [];

/** The selection transition a pointer-down produces, plus a deferred collapse. */
export interface PointerDownSelection {
    /** The selection that should be active while the gesture runs. */
    selection: string[];
    /**
     * A node the selection should collapse to on release **if the gesture never
     * moved** (i.e. it was a click, not a drag). Non-null only for a plain
     * pointer-down on an already-selected node: the whole selection must be
     * preserved so a drag moves everything, and the click-to-focus collapse is
     * deferred to `finalizeGesture`.
     */
    collapseTo: string | null;
}

/**
 * Resolve a pointer-down against the current selection:
 *   - `null` target (empty canvas) → clear, unless additive (shift keeps it).
 *   - shift/ctrl/meta (additive) → toggle membership.
 *   - plain click on a node **not** selected → replace with `[hitId]`.
 *   - plain click on an already-selected node → keep the whole selection so the
 *     drag moves all of it; `collapseTo` carries the hit id so a release without
 *     movement can collapse to just that node.
 */
export const pointerDownSelection = (
    current: readonly string[],
    hitId: string | null,
    additive: boolean,
): PointerDownSelection => {
    if (hitId === null) {
        return { selection: additive ? [...current] : [], collapseTo: null };
    }
    if (additive) {
        return {
            selection: current.includes(hitId)
                ? current.filter((id) => id !== hitId)
                : [...current, hitId],
            collapseTo: null,
        };
    }
    if (current.includes(hitId)) {
        return { selection: [...current], collapseTo: hitId };
    }
    return { selection: [hitId], collapseTo: null };
};

/**
 * Resolve a hit-test click:
 *   - `null` target (empty canvas) → clear, unless additive (shift keeps it).
 *   - shift/ctrl-click → toggle membership.
 *   - plain click → replace with the single id.
 *
 * Kept as the click-only projection of `pointerDownSelection` so existing
 * callers/tests keep the same behavior.
 */
export const selectionAfterClick = (
    current: readonly string[],
    hitId: string | null,
    additive: boolean,
): string[] => pointerDownSelection(current, hitId, additive).selection;

/** Do two axis-aligned rects overlap (touching edges count)? */
export const rectsIntersect = (a: Rect, b: Rect): boolean =>
    a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

/**
 * The node a press should target, with round-2 overlapping-object priority: the
 * `hitTestWorld` topmost node at the point, **unless** the point falls inside
 * the world AABB of a node that is currently selected. A selection made from
 * the layer list (or by marquee) is therefore still the node under the pointer
 * — and so the node the ensuing drag moves — even when another node is stacked
 * above it. A press outside the selection's own box keeps the plain topmost
 * result.
 *
 * The AABB is the deliberate box: for an unrotated node it *is* the
 * Transformer's control box (the Transformer wraps the node's client rect); for
 * a rotated node it is a superset of that box, so it can never miss a press
 * inside the control box — it only adds the corners. The Transformer's own
 * anchors/border never reach here: `isTransformerTarget` returns first and
 * leaves those to Konva.
 *
 * The priority scan mirrors `hitTestWorld` exactly: the same `visible`/`locked`
 * filter (a locked or hidden node is never selectable, selected or not) and the
 * same last-match-wins order, so the *topmost* selected box wins when several
 * selected boxes contain the point. `hitTestWorld` stays the baseline rather
 * than being re-implemented here, so the topmost/filter semantics have one
 * source of truth.
 */
export const pickNodeAt = (
    point: Point,
    targets: readonly HitTestable[],
    selectedIds: readonly string[],
): string | null => {
    const hit = hitTestWorld(point, targets);
    // Nothing selectable under the point, an empty selection, or the topmost
    // node is itself selected: the baseline already is the priority result.
    if (hit === null || selectedIds.length === 0 || selectedIds.includes(hit)) return hit;
    const selected = new Set(selectedIds);
    let priority: string | null = null;
    for (const target of targets) {
        if (!selected.has(target.id) || !target.visible || target.locked) continue;
        const b = target.bounds;
        if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) priority = target.id;
    }
    return priority ?? hit;
};

/**
 * Ids whose world bounds fall inside a marquee rect (ui-spec.md §10). Locked or
 * hidden nodes are never marquee-selectable. Tests overlap, not containment, so
 * a marquee dragged across an object still catches it.
 */
export const nodesInMarquee = (doc: LabelDoc, marquee: Rect): string[] => {
    const out: string[] = [];
    for (const node of flattenResolved(resolve(doc))) {
        if (node.type === 'group') continue;
        if (!node.visible || node.locked) continue;
        if (rectsIntersect(node.bounds, marquee)) out.push(node.id);
    }
    return out;
};
