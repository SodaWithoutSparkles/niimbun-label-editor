import type { StoreSlice } from '../storeTypes';
import { defaultToolSettings } from '../storeDefaults';
import { readJSON, STORAGE_KEYS, writeJSON } from '../storage';

export const createToolsSlice: StoreSlice = (set) => ({
    activeTool: 'select',
    setActiveTool: (tool) => set((state) => {
        // Show settings popup if clicking the same tool
        if (state.activeTool === tool && tool !== 'select') {
            return { showToolSettings: true };
        }
        return { activeTool: tool, showToolSettings: false };
    }),
    toolSettings: readJSON(STORAGE_KEYS.toolSettings, defaultToolSettings),
    setToolSettings: (settings) => set((state) => {
        const nextSettings = { ...state.toolSettings, ...settings };
        writeJSON(STORAGE_KEYS.toolSettings, nextSettings);
        return { toolSettings: nextSettings };
    }),
    showToolSettings: false,
    setShowToolSettings: (show) => set({ showToolSettings: show }),
});
