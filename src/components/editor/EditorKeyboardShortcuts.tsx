import { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { normalizeInsertAction, type InsertAction } from '../../store/slices/toolsSlice';
import { effectiveLockedMap, effectiveVisibleMap, rootNodes } from '../../editor/selectors';

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

export const EditorKeyboardShortcuts = () => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (document.querySelector('dialog[open]')) return;
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

            const state = useStore.getState();
            const mod = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();

            // Global settings. The legacy `common/KeyboardShortcuts` that used to
            // own this is no longer mounted (must-fix #9); this is the single
            // handler now, and it already owns the dialog + input guards above.
            if (mod && key === ',') {
                event.preventDefault();
                state.openSettings();
                return;
            }

            if (state.view !== 'editor') return;

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
                for (const id of state.selectedNodeIds) state.cloneNode(id);
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
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return null;
};
