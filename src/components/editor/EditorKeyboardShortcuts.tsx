import { useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { normalizeInsertAction, type InsertAction } from '../../store/slices/toolsSlice';
import type { RenderMode } from '../../store/slices/viewSlice';
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

/** Time the bare `Q` key must stay down before it peeks instead of toggling. */
export const RENDER_MODE_HOLD_MS = 300;

/** A bare view-key press in flight: the timer, the key, the mode to restore, and the peek state. */
interface RenderModeHold {
    timer: ReturnType<typeof setTimeout>;
    /** The lowercased configured key at press time; keyup must match it. */
    key: string;
    /** The mode before the press; restored only when the peek is still showing. */
    previous: RenderMode;
    /** Set once the press outlived the threshold, i.e. it is a hold, not a tap. */
    peeked: boolean;
    /**
     * Set when the peek actually changed the mode. A hold that started in the
     * dithered view changes nothing, so there is nothing for keyup to undo.
     */
    applied: boolean;
}

/**
 * Undo a peek on release/blur/unmount — but only when the mode on screen is
 * still the one the peek produced. The status-bar chip stays clickable during a
 * hold, so an explicit change after the peek must win over the automatic
 * restore.
 */
const undoPeek = (hold: RenderModeHold): void => {
    if (!hold.peeked || !hold.applied) return;
    const state = useStore.getState();
    if (state.renderMode === 'quantized') state.setRenderMode(hold.previous);
};

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
    /** The bare dithered-view tap/hold gesture in flight, if any (see its branch below). */
    const renderModeHoldRef = useRef<RenderModeHold | null>(null);

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

            // Dithered-view toggle (P5). A bare press of the **configured** view
            // key (Settings ▸ Shortcuts ▸ View; default `q`) only, and this
            // branch runs **before** the configurable tool-shortcut loop below,
            // so a tool mapped to the same key can never hijack it. Tap = toggle;
            // hold ≥ RENDER_MODE_HOLD_MS = peek the printed raster, release = back
            // to the previous mode.
            const viewKey = state.keyboardShortcuts.quantizedView.toLowerCase();
            if (!mod && !event.altKey && !event.shiftKey && key === viewKey) {
                event.preventDefault();
                // `event.repeat` is the OS auto-repeat of a press we already own;
                // a second keydown without a keyup is the same press.
                if (event.repeat || renderModeHoldRef.current !== null) return;
                const hold: RenderModeHold = {
                    key: viewKey,
                    previous: state.renderMode,
                    peeked: false,
                    applied: false,
                    timer: setTimeout(() => {
                        // Outlived the threshold with the key still down: peek.
                        hold.peeked = true;
                        // The press started in the dithered view: the peek changes
                        // nothing, so never write `quantized` here. `applied` stays
                        // false, so an explicit chip click to normal during the hold
                        // survives the release/blur/unmount.
                        if (hold.previous === 'quantized') return;
                        hold.applied = true;
                        useStore.getState().setRenderMode('quantized');
                    }, RENDER_MODE_HOLD_MS),
                };
                renderModeHoldRef.current = hold;
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
            // Match the key this press actually started with (a remap mid-hold
            // must not strand the gesture). A keyup always closes the gesture,
            // even if the keydown started in a context that has since changed (a
            // dialog opened mid-hold): the mode must never stay stuck.
            const hold = renderModeHoldRef.current;
            if (hold === null || event.key.toLowerCase() !== hold.key) return;
            renderModeHoldRef.current = null;
            clearTimeout(hold.timer);
            if (hold.peeked) undoPeek(hold);
            else useStore.getState().toggleRenderMode();
        };
        window.addEventListener('keyup', handleKeyUp);

        // A missed keyup (alt-tab, devtools, released outside the window) would
        // otherwise leave the escalation or a view peek stuck; a focus loss resets
        // both (a peek is undone only while it is still the mode on screen).
        const handleBlur = () => {
            arrowRepeatRef.current = null;
            const hold = renderModeHoldRef.current;
            if (hold === null) return;
            renderModeHoldRef.current = null;
            clearTimeout(hold.timer);
            undoPeek(hold);
        };
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
            // An editor unmount mid-hold must not leave the timer running (it
            // would flip the store after teardown) nor a peek applied.
            const hold = renderModeHoldRef.current;
            if (hold === null) return;
            renderModeHoldRef.current = null;
            clearTimeout(hold.timer);
            undoPeek(hold);
        };
    }, []);

    return null;
};
