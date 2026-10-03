import type { LabelDoc } from '../core/doc/types';
import type { Rect } from '../core/viewport';
import { flattenResolved, resolve } from './render/resolve';

/**
 * Selection-model helpers (ui-spec.md §10). Pure functions over the document and
 * the current selection id list, so the click/shift/marquee behavior is
 * unit-testable without React or Konva.
 */

/** `Esc` / empty-canvas click → clear. */
export const clearedSelection = (): string[] => [];

/**
 * Resolve a hit-test click:
 *   - `null` target (empty canvas) → clear, unless additive (shift keeps it).
 *   - shift/ctrl-click → toggle membership.
 *   - plain click → replace with the single id.
 */
export const selectionAfterClick = (
    current: readonly string[],
    hitId: string | null,
    additive: boolean,
): string[] => {
    if (hitId === null) return additive ? [...current] : [];
    if (additive) {
        return current.includes(hitId)
            ? current.filter((id) => id !== hitId)
            : [...current, hitId];
    }
    return [hitId];
};

/** Do two axis-aligned rects overlap (touching edges count)? */
export const rectsIntersect = (a: Rect, b: Rect): boolean =>
    a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

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
