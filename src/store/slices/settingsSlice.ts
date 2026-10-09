import type { StoreSlice } from '../storeTypes';
import {
    DEFAULT_GRID_SPACING_HM,
    DEFAULT_SCREEN_DPI,
    GRID_SPACING_MAX_HM,
    GRID_SPACING_MIN_HM,
    SCREEN_DPI_MAX,
    SCREEN_DPI_MIN,
    defaultAutoSave,
    defaultKeyboardShortcuts,
    defaultLanguage,
    defaultToolSettings,
} from '../storeDefaults';

/**
 * Preference fields and actions. Moved verbatim out of `preferencesSlice`
 * (autoSave + keyboard shortcuts) and `toolsSlice` (toolSettings). No state key
 * or action name was renamed — slices are spread flat, so consumers are blind
 * to the move.
 */
export const createSettingsSlice: StoreSlice = (set) => ({
    autoSave: defaultAutoSave,
    toggleAutoSave: () => set((state) => {
        const nextAutoSave = !state.autoSave;
        return { autoSave: nextAutoSave };
    }),

    keyboardShortcuts: defaultKeyboardShortcuts,
    setModifyKey: (key) => set((state) => {
        const nextShortcuts = { ...state.keyboardShortcuts, modifyKey: key };
        return { keyboardShortcuts: nextShortcuts };
    }),
    setCancelKey: (key) => set((state) => {
        const nextShortcuts = { ...state.keyboardShortcuts, cancelKey: key };
        return { keyboardShortcuts: nextShortcuts };
    }),
    setTextSaveShortcut: (modifier, key) => set((state) => {
        const nextShortcuts = {
            ...state.keyboardShortcuts,
            textSave: { modifier, key }
        };
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
        return { keyboardShortcuts: nextShortcuts };
    }),

    toolSettings: defaultToolSettings,
    setToolSettings: (settings) => set((state) => {
        const nextSettings = { ...state.toolSettings, ...settings };
        return { toolSettings: nextSettings };
    }),

    language: defaultLanguage,
    setLanguage: (language) => set({ language }),

    // Screen-DPI calibration (§6 `real` zoom, §11 setting). Persisted with the
    // other global settings; never document data.
    screenDpi: DEFAULT_SCREEN_DPI,
    setScreenDpi: (screenDpi) => set({
        screenDpi: Math.min(SCREEN_DPI_MAX, Math.max(SCREEN_DPI_MIN, Math.round(screenDpi))),
    }),

    // Preview grid spacing (§6, §11). Persisted with the other global settings;
    // rounded to whole hm and clamped so the grid can never collapse or vanish.
    gridSpacingHm: DEFAULT_GRID_SPACING_HM,
    setGridSpacingHm: (hm) => set({
        gridSpacingHm: Math.min(GRID_SPACING_MAX_HM, Math.max(GRID_SPACING_MIN_HM, Math.round(hm))),
    }),

    // Settings-window open state lives in the store (not `Header` local state)
    // so the global Ctrl/Cmd+, handler can open it without prop-drilling.
    isSettingsOpen: false,
    openSettings: () => set({ isSettingsOpen: true }),
    closeSettings: () => set({ isSettingsOpen: false }),

    resetSettings: () => set({
        autoSave: defaultAutoSave,
        keyboardShortcuts: defaultKeyboardShortcuts,
        toolSettings: defaultToolSettings,
        language: defaultLanguage,
        screenDpi: DEFAULT_SCREEN_DPI,
        gridSpacingHm: DEFAULT_GRID_SPACING_HM,
    }),
});
