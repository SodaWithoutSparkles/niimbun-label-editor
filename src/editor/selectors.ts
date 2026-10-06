import {
    childrenFromParentId,
    effectiveLocked,
    effectiveVisible,
    nodeLookup,
} from '../core/doc/derive';
import type { LabelDoc, Node, NodeType } from '../core/doc/types';

/**
 * Pure selectors over a `LabelDoc` for the Object / layers panel and the
 * inspector. **Zero store, zero React, zero Konva** — these are plain functions
 * of the document so any view (or a test) can call them directly.
 *
 * Hierarchy follows `parentId`; sibling z-order is the flat `nodes[]` array
 * order (plan §Data model: "array order = z-order"). All traversals are
 * cycle-safe and tolerate a `parentId` that points at a missing node by
 * stopping the walk rather than looping.
 *
 * Effective visibility/lock are *derived* (never stored): a hidden or locked
 * ancestor dims/locks the whole subtree. `derive.ts` owns the semantics; this
 * module only batches them into per-node maps the panel can read in O(1).
 */

/** Direct children of `parentId`, in array order (sibling z-order). */
export const childrenOf = (doc: LabelDoc, parentId: string | null): Node[] =>
    childrenFromParentId(doc.nodes, parentId);

/** Top-level nodes (`parentId === null`), in array order. */
export const rootNodes = (doc: LabelDoc): Node[] => childrenFromParentId(doc.nodes, null);

/** The node with `id`, or `undefined`. */
export const nodeById = (doc: LabelDoc, id: string): Node | undefined =>
    doc.nodes.find((node) => node.id === id);

/**
 * Root→parent ancestry of `id` (immediate parent last), excluding the node
 * itself. Stops at a missing parent or a cycle.
 */
export const ancestors = (doc: LabelDoc, id: string): Node[] => {
    const byId = nodeLookup(doc.nodes);
    const chain: Node[] = [];
    const seen = new Set<string>([id]);
    let current = byId.get(id)?.parentId ?? null;
    while (current !== null && !seen.has(current)) {
        seen.add(current);
        const parent = byId.get(current);
        if (!parent) break;
        chain.push(parent);
        current = parent.parentId;
    }
    return chain.reverse();
};

/**
 * All descendants of `id`, excluding the node itself, in depth-first pre-order
 * (a parent appears before its children; siblings keep array order).
 */
export const descendants = (doc: LabelDoc, id: string): Node[] => {
    const out: Node[] = [];
    const seen = new Set<string>([id]);
    const walk = (parentId: string): void => {
        for (const child of childrenFromParentId(doc.nodes, parentId)) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            out.push(child);
            walk(child.id);
        }
    };
    walk(id);
    return out;
};

// ---------------------------------------------------------------------------
// Z-order views over the flat `nodes[]`
// ---------------------------------------------------------------------------

/** Direct siblings of `id` (including `id`), in z-order back-to-front. */
export const siblingZOrder = (doc: LabelDoc, id: string): Node[] => {
    const node = nodeById(doc, id);
    if (!node) return [];
    return childrenFromParentId(doc.nodes, node.parentId);
};

/** Index of `id` among its siblings (0 = back), or -1 when absent. */
export const siblingIndex = (doc: LabelDoc, id: string): number =>
    siblingZOrder(doc, id).findIndex((node) => node.id === id);

/**
 * Flat paint order (back-to-front) as a depth-first pre-order: roots in array
 * order, each group followed by its children in array order. Hidden nodes are
 * included — the render path filters those; the panel must still list them.
 */
export const paintOrder = (doc: LabelDoc): Node[] => {
    const out: Node[] = [];
    const seen = new Set<string>();
    const walk = (parentId: string | null): void => {
        for (const node of childrenFromParentId(doc.nodes, parentId)) {
            if (seen.has(node.id)) continue;
            seen.add(node.id);
            out.push(node);
            walk(node.id);
        }
    };
    walk(null);
    return out;
};

// ---------------------------------------------------------------------------
// Effective layer state
// ---------------------------------------------------------------------------

/** `effectiveVisible` for every node, keyed by id. */
export const effectiveVisibleMap = (doc: LabelDoc): Map<string, boolean> => {
    const byId = nodeLookup(doc.nodes);
    const map = new Map<string, boolean>();
    for (const node of doc.nodes) map.set(node.id, effectiveVisible(node, byId));
    return map;
};

/** `effectiveLocked` for every node, keyed by id. */
export const effectiveLockedMap = (doc: LabelDoc): Map<string, boolean> => {
    const byId = nodeLookup(doc.nodes);
    const map = new Map<string, boolean>();
    for (const node of doc.nodes) map.set(node.id, effectiveLocked(node, byId));
    return map;
};

/** The two derived layer flags for one node. */
export interface LayerState {
    effectiveVisible: boolean;
    effectiveLocked: boolean;
}

/** Combined `effectiveVisible`/`effectiveLocked` map for the whole doc. */
export const layerStateMap = (doc: LabelDoc): Map<string, LayerState> => {
    const byId = nodeLookup(doc.nodes);
    const map = new Map<string, LayerState>();
    for (const node of doc.nodes) {
        map.set(node.id, {
            effectiveVisible: effectiveVisible(node, byId),
            effectiveLocked: effectiveLocked(node, byId),
        });
    }
    return map;
};

// ---------------------------------------------------------------------------
// Tree rows (data only — the panel renders them)
// ---------------------------------------------------------------------------

export interface TreeRow {
    id: string;
    /** 0 for a root; +1 per level of nesting. */
    depth: number;
    type: NodeType;
    name?: string;
    /** The node's own flags (what its row toggles). */
    visible: boolean;
    locked: boolean;
    /** Inherited flags (what the row is dimmed by). */
    effectiveVisible: boolean;
    effectiveLocked: boolean;
}

export interface TreeRowsOptions {
    /**
     * Emit front-most siblings first at every level (Photoshop layer order).
     * Parents still precede their own children. Defaults to `false` (array
     * order, back-to-front) so existing callers are unaffected.
     */
    frontToBack?: boolean;
}

/**
 * Flat, depth-first tree rows for the Object / layers panel. Hidden nodes are
 * included (dimmed via `effectiveVisible`) so the user can re-show them.
 *
 * Sibling order is array order (back-to-front) by default; pass
 * `{ frontToBack: true }` to list the front-most sibling first at every level.
 * A global `.reverse()` is *not* equivalent — it would flip parents below their
 * own children — hence the per-level option.
 */
export const treeRows = (doc: LabelDoc, options: TreeRowsOptions = {}): TreeRow[] => {
    const byId = nodeLookup(doc.nodes);
    const rows: TreeRow[] = [];
    const seen = new Set<string>();
    const walk = (parentId: string | null, depth: number): void => {
        const children = childrenFromParentId(doc.nodes, parentId);
        const ordered = options.frontToBack ? [...children].reverse() : children;
        for (const node of ordered) {
            if (seen.has(node.id)) continue;
            seen.add(node.id);
            rows.push({
                id: node.id,
                depth,
                type: node.type,
                ...(node.name !== undefined ? { name: node.name } : {}),
                visible: node.visible,
                locked: node.locked,
                effectiveVisible: effectiveVisible(node, byId),
                effectiveLocked: effectiveLocked(node, byId),
            });
            walk(node.id, depth + 1);
        }
    };
    walk(null, 0);
    return rows;
};
