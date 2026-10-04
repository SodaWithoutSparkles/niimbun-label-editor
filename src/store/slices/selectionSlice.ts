import type { StoreSlice } from '../storeTypes';

/**
 * Document-editor selection.
 *
 * Owns `selectedNodeIds` — selection over `LabelDoc.nodes` — for the editor
 * shell. The legacy drawing model's `canvasSlice` (and its `selectedIds`) was
 * stripped, so this is now the only selection model.
 *
 * Selection is view state: it is never persisted and never touches the doc.
 */
export const createSelectionSlice: StoreSlice = (set) => ({
    selectedNodeIds: [],

    /** Replace the selection with `id`, or clear it when `id` is `null`. */
    selectNode: (id) => set({ selectedNodeIds: id === null ? [] : [id] }),

    /** Add `id` if absent, remove it if present. */
    toggleSelectNode: (id) =>
        set((state) => ({
            selectedNodeIds: state.selectedNodeIds.includes(id)
                ? state.selectedNodeIds.filter((selectedId) => selectedId !== id)
                : [...state.selectedNodeIds, id],
        })),

    /** Replace the selection; duplicates in `ids` collapse to one. */
    selectNodes: (ids) => set({ selectedNodeIds: [...new Set(ids)] }),

    clearNodeSelection: () => set({ selectedNodeIds: [] }),
});
