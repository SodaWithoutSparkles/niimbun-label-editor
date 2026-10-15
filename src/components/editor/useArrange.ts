import { useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { nodeLookup } from '../../core/doc/derive';
import {
    TILE_GAP_HM,
    alignTransformPatch,
    hasLocalGeometry,
    tileLayout,
    tileTransformPatch,
    type AlignEdge,
    type TileAxis,
} from '../../editor/arrange';
import type { Node, TextAlign } from '../../core/doc/types';

/**
 * Arrange commands (ui-spec.md §10) — the single implementation of align / tile /
 * text-align for the whole editor. `ViewControls` renders the object-specific
 * icon block and calls these; the patches come from `editor/arrange`.
 *
 * A click is exactly **one** undo entry, however many nodes are selected: the
 * patches go through the store's transient gesture seam
 * (`updateNodeTransient` × N, then a single `commitDoc`), mirroring `nudgeNodes`.
 * A click whose patches all round back onto the node's own values writes
 * nothing and touches no history: `updateNodeTransient` was never called, so
 * there is no gesture of ours to commit *and* none to reset. It must NOT call
 * `resetTransient` — that clears the store-wide transient baseline and would
 * silently discard a different, in-progress gesture.
 */

export interface ArrangeActions {
    /** Align the selection to a backing edge (left/center/right/top/middle/bottom). */
    align: (edge: AlignEdge) => void;
    /** Tile the selection along one axis, anchored on its first node. */
    tile: (axis: TileAxis) => void;
    /** Set the text alignment of every selected text node (inspector `align` field). */
    setTextAlign: (align: TextAlign) => void;
}

export const useArrange = (selected: readonly Node[]): ArrangeActions => {
    const updateNodeTransient = useStore((state) => state.updateNodeTransient);
    const commitDoc = useStore((state) => state.commitDoc);

    /** Ends the gesture: one undo entry if anything moved, none if nothing did. */
    const finish = useCallback(
        (changed: boolean) => {
            if (changed) commitDoc();
        },
        [commitDoc],
    );

    const align = useCallback(
        (edge: AlignEdge) => {
            const doc = useStore.getState().currentDoc;
            if (!doc) return;
            const byId = nodeLookup(doc.nodes);
            let changed = false;
            for (const node of selected) {
                const patch = alignTransformPatch(node, byId, doc.label.backingW, doc.label.backingH, edge);
                const target = patch?.transform;
                // A patch that rounds back onto the node's own position (or a
                // geometry-less node with no patch at all) is not a change.
                if (!patch || !target) continue;
                if (target.x === node.transform.x && target.y === node.transform.y) continue;
                updateNodeTransient(node.id, patch);
                changed = true;
            }
            finish(changed);
        },
        [selected, updateNodeTransient, finish],
    );

    const tile = useCallback(
        (axis: TileAxis) => {
            const doc = useStore.getState().currentDoc;
            if (!doc) return;
            const byId = nodeLookup(doc.nodes);
            const targets = tileLayout(selected, byId, axis, TILE_GAP_HM);
            let changed = false;
            for (const node of selected) {
                if (!hasLocalGeometry(node)) continue;
                const target = targets.get(node.id);
                if (!target) continue;
                const patch = tileTransformPatch(node, byId, target.x, target.y);
                const transform = patch?.transform;
                if (!patch || !transform) continue;
                // The anchor of the tile keeps its place: that patch is a no-op.
                if (transform.x === node.transform.x && transform.y === node.transform.y) continue;
                updateNodeTransient(node.id, patch);
                changed = true;
            }
            finish(changed);
        },
        [selected, updateNodeTransient, finish],
    );

    const setTextAlign = useCallback(
        (align: TextAlign) => {
            const doc = useStore.getState().currentDoc;
            if (!doc) return;
            let changed = false;
            for (const node of selected) {
                if (node.type !== 'text') continue;
                // Already at this alignment: no write, so no dead undo entry.
                if (node.align === align) continue;
                updateNodeTransient(node.id, { align });
                changed = true;
            }
            finish(changed);
        },
        [selected, updateNodeTransient, finish],
    );

    return { align, tile, setTextAlign };
};
