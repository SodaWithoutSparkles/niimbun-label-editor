import type { StoreSlice } from '../storeTypes';

/**
 * Live, session-scoped editor warnings, grouped by producing source.
 *
 * Not persisted (see `partialize` in `useStore`) and never part of the document:
 * warnings are derived from the current preview/data/print pass and are rebuilt
 * from scratch whenever that pass re-runs. A `group` is keyed to the document
 * it describes (`docId`) and to a producer-chosen `scopeId` (the preview/fonts
 * passes use the document id, CSV uses the attached table id); the Warnings tab
 * ignores stale groups, so a producer that has not yet cleaned up can never
 * surface another document's warnings.
 */
export const createWarningsSlice: StoreSlice = (set) => ({
    editorWarnings: {},

    /**
     * Replace the group for `source`, or remove it when `group` is `null`.
     * Producers pass a group scoped to the document/table they resolved.
     */
    setEditorWarnings: (source, group) => set((state) => {
        const editorWarnings = { ...state.editorWarnings };
        if (group) editorWarnings[source] = group;
        else delete editorWarnings[source];
        return { editorWarnings };
    }),

    /**
     * Drop the group for `source` only when it still belongs to `scopeId` (when
     * given). Guards against a producer clearing a newer group written by a
     * re-mounted/re-scoped producer (StrictMode double-fire, fast doc/CSV
     * switches). Live callers: `preview`/`fonts` pass the document id, the CSV
     * detach passes the attached `csvId`. An omitted `scopeId` clears
     * unconditionally.
     */
    clearEditorWarnings: (source, scopeId) => set((state) => {
        const current = state.editorWarnings[source];
        if (scopeId !== undefined && current?.scopeId !== scopeId) return state;
        const editorWarnings = { ...state.editorWarnings };
        delete editorWarnings[source];
        return { editorWarnings };
    }),
});
