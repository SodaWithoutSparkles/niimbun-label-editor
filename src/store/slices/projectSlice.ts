import { CURRENT_VERSION } from '../../types';
import type { SaveFile } from '../../types';
import type { AppState, StoreSlice } from '../storeTypes';
import { normalizeInsertAction } from './toolsSlice';
import { createDefaultProjectName } from '../../utils/projectName';

/**
 * Project/canvas fields a save file is allowed to restore on load. Deliberately
 * an explicit list: the file is untrusted input, and the previous
 * `...data.<subObject>` spreads let a crafted file smuggle preference keys
 * (`autoSave`, `keyboardShortcuts`, `toolSettings`, `colors`, `colorPresets`,
 * `selectedPresetIndex`, `language`) through any sub-object, overwriting the
 * user's independently-persisted settings and durably re-persisting them.
 *
 * Nothing outside this list is ever read from `data`, so a preference key
 * cannot be applied no matter which sub-object carries it, and prototype keys
 * (`__proto__`/`constructor`) never reach `set`.
 */
type ProjectFields = Pick<
    AppState,
    | 'objects'
    | 'activeTool'
    | 'showToolSettings'
    | 'isDropperActive'
    | 'pickedColor'
    | 'canvasPosition'
>;

const pickProjectFields = (data: SaveFile, state: AppState): ProjectFields => ({
    objects: data.canvas?.objects ?? state.objects,
    activeTool: normalizeInsertAction(data.tools?.activeTool ?? state.activeTool),
    showToolSettings: data.tools?.showToolSettings ?? state.showToolSettings,
    isDropperActive: data.colors?.isDropperActive ?? state.isDropperActive,
    pickedColor: data.colors?.pickedColor ?? state.pickedColor,
    canvasPosition: data.navigation?.canvasPosition ?? state.canvasPosition,
});

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
        // User preferences win: the file may carry `autoSave`, `keyboardShortcuts`,
        // `toolSettings`, `colors`, `colorPresets`, and `selectedPresetIndex`, but
        // those persist independently and must not be overwritten (and durably
        // re-persisted) by opening a project. Apply only the explicitly whitelisted
        // project/canvas fields — never spread an untrusted sub-object.
        set((state) => ({
            ...pickProjectFields(data, state),
            projectName: data.projectName ?? state.projectName,
            createdAt: data.createdAt ?? Date.now(),
            // Undo history is intentionally reset on load rather than restored, and
            // deliberately overrides the (whitelisted) canvas fields above.
            history: [{ key: 'history.loadedProject' }],
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
        history: [{ key: 'history.newProject' }],
        historyUndoCount: 0
    }),
});
