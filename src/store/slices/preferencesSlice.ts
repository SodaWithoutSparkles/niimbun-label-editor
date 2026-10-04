import type { StoreSlice } from '../storeTypes';

/**
 * Non-preference/misc state. The preference fields (autoSave, keyboard
 * shortcuts) live in `settingsSlice`; this slice keeps the runtime autosave
 * timestamp.
 */
export const createPreferencesSlice: StoreSlice = (set) => ({
    lastAutoSaveAt: null,
    setLastAutoSaveAt: (timestamp) => set({ lastAutoSaveAt: timestamp }),
});
