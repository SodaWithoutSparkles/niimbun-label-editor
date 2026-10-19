import type { StoreSlice } from '../storeTypes';
import {
    DEFAULT_CONNECT_METHOD,
    DEFAULT_GRID_SPACING_HM,
    DEFAULT_QUANTIZER_BY_TYPE,
    DEFAULT_QUANTIZER_DEFAULTS,
    DEFAULT_SCREEN_DPI,
    GRID_SPACING_MAX_HM,
    GRID_SPACING_MIN_HM,
    SCREEN_DPI_MAX,
    SCREEN_DPI_MIN,
    defaultAutoSave,
    defaultKeyboardShortcuts,
    defaultLanguage,
    defaultToolSettings,
    defaultUsePrinterDpi,
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

    // Print raster dpi preference (P2). Persisted with the other global
    // settings; never document data. A value setter (not a toggle) because the
    // print dialog renders a `Toggle` and reports the checked value.
    usePrinterDpi: defaultUsePrinterDpi,
    setUsePrinterDpi: (usePrinterDpi) => set({ usePrinterDpi }),

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
    // The dithered-view hotkey. Sits beside the tool shortcuts because it is the
    // same kind of binding (a bare single key), but it wins over them at runtime.
    setQuantizedViewShortcut: (key) => set((state) => {
        const nextShortcuts = { ...state.keyboardShortcuts, quantizedView: key };
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

    // Printer connect method (§11). Persisted with the other global settings so
    // the printer popover's chooser remembers the last pick; never document data.
    connectMethod: DEFAULT_CONNECT_METHOD,
    setConnectMethod: (connectMethod) => set({ connectMethod }),

    // Per-strategy dithering defaults (§P13 Track R). Persisted with the other
    // global settings; empty means the engine defaults. Never document data.
    quantizerDefaults: DEFAULT_QUANTIZER_DEFAULTS,
    setQuantizerDefaults: (quantizerDefaults) => set({ quantizerDefaults }),

    // Per-object-type default quantizer (§P13 Track R). Persisted; empty means
    // `DEFAULT_POLICY_BY_TYPE` remains the fallback. Never document data.
    defaultQuantizerByType: DEFAULT_QUANTIZER_BY_TYPE,
    setDefaultQuantizerByType: (defaultQuantizerByType) => set({ defaultQuantizerByType }),

    // Preferred paper type for a new label (§11, P8). Optional on purpose: an
    // unset preference means "no default", so the create-label dialog falls
    // back to the first seed / `custom`. Persisted with the other global
    // settings; never document data.
    defaultPaperTypeId: undefined,
    setDefaultPaperTypeId: (defaultPaperTypeId) => set({ defaultPaperTypeId }),

    // Settings-window open state lives in the store (not `Header` local state)
    // so the global Ctrl/Cmd+, handler can open it without prop-drilling.
    isSettingsOpen: false,
    openSettings: () => set({ isSettingsOpen: true }),
    closeSettings: () => set({ isSettingsOpen: false }),

    resetSettings: () => set({
        autoSave: defaultAutoSave,
        usePrinterDpi: defaultUsePrinterDpi,
        keyboardShortcuts: defaultKeyboardShortcuts,
        toolSettings: defaultToolSettings,
        language: defaultLanguage,
        screenDpi: DEFAULT_SCREEN_DPI,
        gridSpacingHm: DEFAULT_GRID_SPACING_HM,
        connectMethod: DEFAULT_CONNECT_METHOD,
        quantizerDefaults: DEFAULT_QUANTIZER_DEFAULTS,
        defaultQuantizerByType: DEFAULT_QUANTIZER_BY_TYPE,
        defaultPaperTypeId: undefined,
    }),
});
