import { CURRENT_VERSION } from '../../types';
import type { SaveFile } from '../../types';
import type { StoreSlice } from '../storeTypes';
import { createDefaultProjectName } from '../../utils/projectName';

export const createProjectSlice: StoreSlice = (set) => ({
    projectName: createDefaultProjectName(),
    setProjectName: (name) => set({ projectName: name }),
    createdAt: null,
    setCreatedAt: (timestamp) => set({ createdAt: timestamp }),
    saveFileName: null,
    setSaveFileName: (name) => set({ saveFileName: name }),
    fileHandle: null,
    setFileHandle: (handle) => set({ fileHandle: handle }),
    lastSavedAt: null,
    setLastSavedAt: (timestamp) => set({ lastSavedAt: timestamp }),
    version: CURRENT_VERSION,

    loadProject: (data: SaveFile) => {
        set((state) => ({
            ...data.canvas,
            ...data.colors,
            ...data.tools,
            ...data.preferences,
            ...data.navigation,
            projectName: data.projectName ?? state.projectName,
            createdAt: data.createdAt ?? Date.now(),
            history: ['Loaded Project'],
            historyUndoCount: 0,
            past: [],
            future: [],
            selectedIds: [],
            selectionColorSnapshot: null,
            hasPerformedClearAll: false
        }));
    },

    resetProject: () => set({
        projectName: createDefaultProjectName(),
        createdAt: Date.now(),
        saveFileName: null,
        fileHandle: null,
        lastSavedAt: null,
        objects: [],
        past: [],
        future: [],
        selectedIds: [],
        selectionColorSnapshot: null,
        hasPerformedClearAll: false,
        history: ['New Project'],
        historyUndoCount: 0
    }),
});
