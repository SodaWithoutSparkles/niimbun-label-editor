import type { CanvasItem } from '../../types';
import type { StoreSlice } from '../storeTypes';

export const createCanvasSlice: StoreSlice = (set) => ({
    objects: [],
    past: [],
    future: [],
    hasPerformedClearAll: false,

    addItem: (item: CanvasItem) => set((state) => {
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: [...state.objects, item],
            history: [`Added ${item.type}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),
    updateItem: (id, updates) => set((state) => {
        const target = state.objects.find((item) => item.id === id);
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: state.objects.map((item) => (item.id === id ? { ...item, ...updates } : item)) as CanvasItem[],
            history: [`Updated ${target?.type ?? 'item'}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),
    updateItems: (ids, updates) => set((state) => {
        if (ids.length === 0) return {};
        const idSet = new Set(ids);
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: state.objects.map((item) => (idSet.has(item.id) ? { ...item, ...updates } : item)) as CanvasItem[],
            history: [`Updated ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),
    moveItemsByDelta: (ids, delta) => set((state) => {
        if (ids.length === 0) return {};
        if (delta.x === 0 && delta.y === 0) return {};
        const idSet = new Set(ids);
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: state.objects.map((item) => (
                idSet.has(item.id)
                    ? { ...item, x: item.x + delta.x, y: item.y + delta.y }
                    : item
            )) as CanvasItem[],
            history: [`Moved ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),
    moveItemsByDeltaTransient: (ids, delta) => set((state) => {
        if (ids.length === 0) return {};
        if (delta.x === 0 && delta.y === 0) return {};
        const idSet = new Set(ids);
        return {
            objects: state.objects.map((item) => (
                idSet.has(item.id)
                    ? { ...item, x: item.x + delta.x, y: item.y + delta.y }
                    : item
            )) as CanvasItem[]
        };
    }),
    commitHistory: (snapshot) => set((state) => {
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            past: [...state.past, snapshot],
            history: ['Moved items', ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            future: []
        };
    }),
    removeItem: (id) => set((state) => {
        const target = state.objects.find((item) => item.id === id);
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: state.objects.filter((item) => item.id !== id),
            history: [`Deleted ${target?.type ?? 'item'}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),

    deleteSelected: () => set((state) => {
        if (state.selectedIds.length === 0) return {};
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: state.objects.filter((item) => !state.selectedIds.includes(item.id)),
            selectedIds: [],
            colors: state.selectionColorSnapshot ?? state.colors,
            selectionColorSnapshot: null,
            history: [`Deleted ${state.selectedIds.length} ${state.selectedIds.length === 1 ? 'item' : 'items'}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),

    deleteAllItems: () => set((state) => {
        if (state.objects.length === 0) return {};
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: [],
            selectedIds: [],
            colors: state.selectionColorSnapshot ?? state.colors, // Restore global colors if we were selecting
            selectionColorSnapshot: null,
            history: ['Deleted all items', ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: [],
            hasPerformedClearAll: true
        };
    }),

    undo: () => set((state) => {
        if (state.past.length === 0) return {};
        const newPast = [...state.past];
        const previous = newPast.pop();
        if (!previous) return {};
        const nextUndoCount = Math.min(state.historyUndoCount + 1, state.history.length);
        return {
            objects: previous,
            past: newPast,
            future: [state.objects, ...state.future],
            historyUndoCount: nextUndoCount
        };
    }),
    redo: () => set((state) => {
        if (state.future.length === 0) return {};
        const newFuture = [...state.future];
        const next = newFuture.shift();
        if (!next) return {};
        const nextUndoCount = Math.max(state.historyUndoCount - 1, 0);
        return {
            objects: next,
            past: [...state.past, state.objects],
            future: newFuture,
            historyUndoCount: nextUndoCount
        };
    }),

    cloneSelected: () => set((state) => {
        if (state.selectedIds.length === 0) return {};
        const toClone = state.objects.filter(i => state.selectedIds.includes(i.id));
        const newItems = toClone.map(item => ({
            ...item,
            id: Math.random().toString(36).slice(2, 11),
            x: item.x + 20,
            y: item.y + 20
        }));
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            objects: [...state.objects, ...newItems],
            history: [`Cloned ${newItems.length} ${newItems.length === 1 ? 'item' : 'items'}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: [],
            selectedIds: newItems.map(i => i.id),
            activeTool: 'select'
        };
    }),

    moveSelectedLayer: (direction) => set((state) => {
        if (state.selectedIds.length === 0) return {};
        const newItems = [...state.objects];
        const id = state.selectedIds[0];
        const idx = newItems.findIndex(i => i.id === id);
        if (idx === -1) return {};

        if (direction === 'up' && idx < newItems.length - 1) {
            const temp = newItems[idx];
            newItems[idx] = newItems[idx + 1];
            newItems[idx + 1] = temp;
        } else if (direction === 'down' && idx > 0) {
            const temp = newItems[idx];
            newItems[idx] = newItems[idx - 1];
            newItems[idx - 1] = temp;
        }

        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;

        return {
            objects: newItems,
            history: [`Moved layer ${direction}`, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0,
            past: [...state.past, state.objects],
            future: []
        };
    }),

    selectedIds: [],
    selectionColorSnapshot: null,
    selectItem: (id) => set((state) => {
        if (!id) {
            return {
                selectedIds: [],
                colors: state.selectionColorSnapshot ?? state.colors,
                selectionColorSnapshot: null
            };
        }

        const selectedItem = state.objects.find((item) => item.id === id);
        const snapshot = state.selectionColorSnapshot ?? state.colors;
        const nextColors = selectedItem
            ? { ...state.colors, stroke: selectedItem.stroke, fill: selectedItem.fill }
            : state.colors;

        return {
            selectedIds: [id],
            selectionColorSnapshot: snapshot,
            colors: nextColors
        };
    }),
    toggleSelectItem: (id) => set((state) => {
        const isSelected = state.selectedIds.includes(id);
        const nextSelectedIds = isSelected
            ? state.selectedIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedIds, id];

        if (nextSelectedIds.length === 0) {
            return {
                selectedIds: [],
                colors: state.selectionColorSnapshot ?? state.colors,
                selectionColorSnapshot: null
            };
        }

        const anchorId = isSelected ? nextSelectedIds[nextSelectedIds.length - 1] : id;
        const anchorItem = state.objects.find((item) => item.id === anchorId);
        const snapshot = state.selectionColorSnapshot ?? state.colors;
        const nextColors = anchorItem
            ? { ...state.colors, stroke: anchorItem.stroke, fill: anchorItem.fill }
            : state.colors;

        return {
            selectedIds: nextSelectedIds,
            selectionColorSnapshot: snapshot,
            colors: nextColors
        };
    }),
    selectAllItems: () => set((state) => {
        if (state.objects.length === 0) return {};

        const nextSelectedIds = state.objects.map((item) => item.id);
        const anchorId = state.selectedIds[0] ?? nextSelectedIds[0];
        const anchorItem = state.objects.find((item) => item.id === anchorId);
        const snapshot = state.selectionColorSnapshot ?? state.colors;
        const nextColors = anchorItem
            ? { ...state.colors, stroke: anchorItem.stroke, fill: anchorItem.fill }
            : state.colors;

        return {
            selectedIds: nextSelectedIds,
            selectionColorSnapshot: snapshot,
            colors: nextColors
        };
    }),
    clearSelection: () => set((state) => ({
        selectedIds: [],
        colors: state.selectionColorSnapshot ?? state.colors,
        selectionColorSnapshot: null
    })),
});
