import { useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { normalizeInsertAction, type InsertAction } from '../../store/slices/toolsSlice';
import { effectiveLockedMap, effectiveVisibleMap, rootNodes } from '../../editor/selectors';
import { isTypingTarget } from '../../utils/keyboardTarget';

/**
 * Editor keyboard shortcuts (ui-spec.md §3/§4/§10). Undo/redo/clone/delete/group
 * live here because the header has no on-screen toolbar. Bails while a modal
 * `<dialog>` is open (top-layer inertness does not stop keydown bubbling) and
 * while typing in an input/textarea/contenteditable.
 *
 * Only active in the editor; gallery shortcuts are unaffected.
 */

/** Legacy tool-shortcut ids → the one-shot insert action they arm. */
const SHORTCUT_TO_ACTION: Record<string, InsertAction> = {
    select: 'select',
    text: 'text',
    rectangle: 'shape:rectangle',
    ellipse: 'shape:ellipse',
    line: 'shape:line',
};

/** Arrow keys nudge the selection in world space; `dy` grows downward. */
const ARROW_DELTAS: Record<string, { dx: number; dy: number }> = {
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 },
};

export const EditorKeyboardShortcuts = () => {
    // Escalating step for a held arrow: 0.1 mm → 1 mm → 2 mm per repeat. Reset
    // on the arrow's keyup so a fresh press restarts at the smallest step.
    const arrowRepeatRef = useRef<{ key: string; count: number } | null>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (document.querySelector('dialog[open]')) return;
            if (isTypingTarget(event)) return;

            const state = useStore.getState();
            const mod = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();

            if (state.view !== 'editor') return;

            // Open the print dialog (and suppress the browser's print dialog).
            if (mod && key === 'p') {
                event.preventDefault();
                state.openPrint();
                return;
            }

            if (mod && key === 'z' && !event.shiftKey) {
                event.preventDefault();
                state.undoDoc();
                return;
            }
            if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
                event.preventDefault();
                state.redoDoc();
                return;
            }
            if (mod && key === 'd') {
                event.preventDefault();
                // Duplicate the selection and select the clones (H2).
                const clonedIds: string[] = [];
                for (const id of state.selectedNodeIds) {
                    const cloneId = state.cloneNode(id);
                    if (cloneId !== null) clonedIds.push(cloneId);
                }
                if (clonedIds.length > 0) state.selectNodes(clonedIds);
                return;
            }
            if (mod && key === 'g') {
                event.preventDefault();
                if (event.shiftKey) {
                    for (const id of state.selectedNodeIds) state.ungroupNode(id);
                } else {
                    state.groupNodes([...state.selectedNodeIds]);
                }
                return;
            }
            if (mod && key === 'a') {
                event.preventDefault();
                const doc = state.currentDoc;
                if (doc) {
                    // Only top-level, effectively-visible, unlocked nodes are
                    // selectable (mirrors the canvas hit test, must-fix #16).
                    const visible = effectiveVisibleMap(doc);
                    const locked = effectiveLockedMap(doc);
                    state.selectNodes(
                        rootNodes(doc)
                            .filter((node) => visible.get(node.id) && !locked.get(node.id))
                            .map((node) => node.id),
                    );
                }
                return;
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                for (const id of state.selectedNodeIds) state.removeNode(id);
                return;
            }
            if (event.key === '[') {
                event.preventDefault();
                for (const id of state.selectedNodeIds) state.moveNodeZ(id, 'down');
                return;
            }
            if (event.key === ']') {
                event.preventDefault();
                for (const id of state.selectedNodeIds) state.moveNodeZ(id, 'up');
                return;
            }

            const arrow = ARROW_DELTAS[event.key];
            if (arrow && !mod && !event.altKey && !event.shiftKey) {
                // While an insert/draw tool is armed the arrows belong to the
                // in-progress placement, not the pre-existing selection. `pan`
                // is view-only — the selection stays live — so it still nudges.
                if (state.activeTool !== 'select' && state.activeTool !== 'pan') return;
                event.preventDefault();
                if (state.selectedNodeIds.length === 0) return;
                const ref = arrowRepeatRef.current;
                const count = ref && ref.key === event.key ? ref.count + 1 : 1;
                arrowRepeatRef.current = { key: event.key, count };
                // 1st press 0.1 mm, 2nd 1 mm, 3rd+ 2 mm (hm = 1/100 mm).
                const step = count === 1 ? 10 : count === 2 ? 100 : 200;
                // `count > 1`, not `event.repeat`: the escalation ref is only advanced after the
                // tool/selection guards pass, so a count above 1 proves this hold already pushed
                // a baseline. `event.repeat` does not (a repeat can arrive with a selection made
                // mid-hold, which would swallow the first nudge's undo entry).
                state.nudgeNodes(arrow.dx * step, arrow.dy * step, count > 1);
                return;
            }

            if (!mod && !event.altKey && !event.shiftKey) {
                const shortcut = state.keyboardShortcuts.tools;
                for (const [toolId, mapped] of Object.entries(SHORTCUT_TO_ACTION)) {
                    if (shortcut[toolId as keyof typeof shortcut]?.toLowerCase() === key) {
                        event.preventDefault();
                        state.setActiveTool(normalizeInsertAction(mapped));
                        return;
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        const handleKeyUp = (event: KeyboardEvent) => {
            if (ARROW_DELTAS[event.key]) arrowRepeatRef.current = null;
        };
        window.addEventListener('keyup', handleKeyUp);

        // A missed keyup (alt-tab, devtools, released outside the window) would
        // otherwise leave the escalation stuck; a focus loss resets it.
        const handleBlur = () => {
            arrowRepeatRef.current = null;
        };
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    return null;
};
