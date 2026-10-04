import type { StoreSlice } from '../storeTypes';

/**
 * Non-preference/misc state. The preference fields (autoSave, keyboard
 * shortcuts) now live in `settingsSlice`; this slice keeps runtime and
 * transient UI state (history, last autosave timestamp).
 */
export const createPreferencesSlice: StoreSlice = (set) => ({
    history: [],
    historyUndoCount: 0,
    addToHistory: (action) => set((state) => {
        const trimmedHistory = state.historyUndoCount > 0
            ? state.history.slice(state.historyUndoCount)
            : state.history;
        return {
            history: [action, ...trimmedHistory].slice(0, 50),
            historyUndoCount: 0
        };
    }),

    lastAutoSaveAt: null,
    setLastAutoSaveAt: (timestamp) => set({ lastAutoSaveAt: timestamp }),
});
