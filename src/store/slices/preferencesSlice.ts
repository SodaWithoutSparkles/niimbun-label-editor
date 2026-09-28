import type { StoreSlice } from '../storeTypes';
import { defaultKeyboardShortcuts } from '../storeDefaults';
import { readBoolean, readJSON, STORAGE_KEYS, writeBoolean, writeJSON } from '../storage';

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

    autoSave: readBoolean(STORAGE_KEYS.autoSave, true),
    toggleAutoSave: () => set((state) => {
        const nextAutoSave = !state.autoSave;
        writeBoolean(STORAGE_KEYS.autoSave, nextAutoSave);
        return { autoSave: nextAutoSave };
    }),
    lastAutoSaveAt: null,
    setLastAutoSaveAt: (timestamp) => set({ lastAutoSaveAt: timestamp }),

    exportTrigger: 0,
    triggerExport: () => set((state) => ({ exportTrigger: state.exportTrigger + 1 })),

    keyboardShortcuts: readJSON(STORAGE_KEYS.keyboardShortcuts, defaultKeyboardShortcuts),
    setModifyKey: (key) => set((state) => {
        const nextShortcuts = { ...state.keyboardShortcuts, modifyKey: key };
        writeJSON(STORAGE_KEYS.keyboardShortcuts, nextShortcuts);
        return { keyboardShortcuts: nextShortcuts };
    }),
    setCancelKey: (key) => set((state) => {
        const nextShortcuts = { ...state.keyboardShortcuts, cancelKey: key };
        writeJSON(STORAGE_KEYS.keyboardShortcuts, nextShortcuts);
        return { keyboardShortcuts: nextShortcuts };
    }),
    setTextSaveShortcut: (modifier, key) => set((state) => {
        const nextShortcuts = {
            ...state.keyboardShortcuts,
            textSave: { modifier, key }
        };
        writeJSON(STORAGE_KEYS.keyboardShortcuts, nextShortcuts);
        return { keyboardShortcuts: nextShortcuts };
    }),
    setToolShortcut: (tool, key) => set((state) => {
        const nextShortcuts = {
            ...state.keyboardShortcuts,
            tools: {
                ...state.keyboardShortcuts.tools,
                [tool]: key
            }
        };
        writeJSON(STORAGE_KEYS.keyboardShortcuts, nextShortcuts);
        return { keyboardShortcuts: nextShortcuts };
    }),
});
