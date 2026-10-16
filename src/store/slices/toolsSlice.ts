import type { StoreSlice } from '../storeTypes';

/**
 * Tool actions. `select` is the resting state; the insert-rail entries are
 * **one-shot** armed actions that clear back to `select` after placing an
 * object or on `Esc` (shape variants are distinct actions so the rail can arm a
 * specific default shape). `pan` is the one **view-only** member: it is not a
 * rail button (see `VIEW_TOOL_ACTIONS`) but a canvas mode armed from the VIEW
 * block — it stays armed across gestures and never inserts anything.
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
    | 'barcode'
    | 'code'
    | 'pan';

/** The insert-rail vocabulary. NOT the whole `InsertAction` union — `pan` is a
 * view-only tool (see `VIEW_TOOL_ACTIONS`) and is deliberately absent here. */
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
    'code',
];

/**
 * Valid `InsertAction`s that are NOT insert-rail buttons. `pan` is armed from
 * the VIEW icon block (`ViewControls`), so it must never appear in
 * `INSERT_ACTIONS` (which is exactly the rail's vocabulary).
 */
export const VIEW_TOOL_ACTIONS: readonly InsertAction[] = ['pan'];

/**
 * Every id {@link normalizeInsertAction} accepts: the insert-rail vocabulary
 * plus the view-only tools. Kept separate from `INSERT_ACTIONS` so the rail
 * list stays exactly the rail's buttons.
 */
const VALID_TOOL_ACTIONS: readonly string[] = [...INSERT_ACTIONS, ...VIEW_TOOL_ACTIONS];

/**
 * Coerce an untrusted/legacy tool id (from an old save file) to a valid
 * `InsertAction`. Anything unrecognised — including removed legacy tools
 * (`arrow`, `callout`, …) — falls back to the resting `select` state.
 */
export const normalizeInsertAction = (value: unknown): InsertAction =>
    typeof value === 'string' && VALID_TOOL_ACTIONS.includes(value)
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
});
