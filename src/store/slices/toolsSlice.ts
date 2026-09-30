import type { StoreSlice } from '../storeTypes';

/**
 * Tool selection + quick-access settings popup state. `toolSettings` /
 * `setToolSettings` moved to `settingsSlice`; they had no other coupling here.
 */
export const createToolsSlice: StoreSlice = (set) => ({
    activeTool: 'select',
    setActiveTool: (tool) => set((state) => {
        // Show settings popup if clicking the same tool
        if (state.activeTool === tool && tool !== 'select') {
            return { showToolSettings: true };
        }
        return { activeTool: tool, showToolSettings: false };
    }),
    showToolSettings: false,
    setShowToolSettings: (show) => set({ showToolSettings: show }),
});
