import type { StoreSlice } from '../storeTypes';

/**
 * Insert-rail actions (ui-spec.md §4). `select` is the resting state; every
 * other entry is a **one-shot** armed action that clears back to `select` after
 * placing an object or on `Esc`. Shape variants are distinct actions so the
 * rail can arm a specific default shape.
 */
export type InsertAction =
    | 'select'
    | 'text'
    | 'image'
    | 'shape:line'
    | 'shape:rectangle'
    | 'shape:ellipse'
    | 'shape:polygon'
    | 'qr'
    | 'barcode';

/** Every valid `InsertAction`, for runtime validation of untrusted input. */
export const INSERT_ACTIONS: readonly InsertAction[] = [
    'select',
    'text',
    'image',
    'shape:line',
    'shape:rectangle',
    'shape:ellipse',
    'shape:polygon',
    'qr',
    'barcode',
];

/**
 * Coerce an untrusted/legacy tool id (from an old save file) to a valid
 * `InsertAction`. Anything unrecognised — including removed legacy tools
 * (`arrow`, `callout`, …) — falls back to the resting `select` state.
 */
export const normalizeInsertAction = (value: unknown): InsertAction =>
    typeof value === 'string' && (INSERT_ACTIONS as readonly string[]).includes(value)
        ? (value as InsertAction)
        : 'select';

export const createToolsSlice: StoreSlice = (set) => ({
    /**
     * The armed insert action. `select` is the resting state. Unlike the
     * template's persistent tool model, an armed action is consumed on place —
     * the app returns to `select` (ui-spec.md §4).
     */
    activeTool: 'select',
    // Single choke point: an untrusted/legacy id (old save blob, a stray cast)
    // is coerced to a valid `InsertAction` before it can reach the store.
    setActiveTool: (tool) => set({ activeTool: normalizeInsertAction(tool) }),
    /** Return to the resting select state (after place, or on Esc). */
    clearActiveTool: () => set({ activeTool: 'select' }),

    // Legacy template popup state, retained so not-yet-stripped components
    // (LeftSidebar / ToolSettingsModal / Header save blob) still typecheck.
    // W6 removes them; the new editor path never reads these (ui-spec.md §4).
    showToolSettings: false,
    setShowToolSettings: (show) => set({ showToolSettings: show }),
});
