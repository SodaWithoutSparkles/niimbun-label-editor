import type { StoreSlice } from '../storeTypes';

/**
 * Editor **view state** (ui-spec.md §5/§6). Zoom, view rotation and the
 * grid/snap/rulers toggles. This is view-only by invariant: nothing here ever
 * mutates the document, and none of it is persisted (a reload starts fit /
 * unrotated, matching the gallery default).
 *
 * `effectiveZoom` is the resolved CSS px per `hm` currently in use. The Preview
 * recomputes it (fit / real / manual) and writes it back so the status bar and
 * view controls render the same number without duplicating the container-size
 * math.
 */

export type ZoomMode = 'fit' | 'real' | 'manual';

export const createViewSlice: StoreSlice = (set) => ({
    /** Grid overlay on the preview. */
    gridVisible: false,
    toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),

    /** Snap-to-edges/grid while dragging. */
    snapEnabled: true,
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),

    /** mm rulers on the preview's top/left edges. */
    rulersVisible: true,
    toggleRulers: () => set((state) => ({ rulersVisible: !state.rulersVisible })),

    /** View-only rotation; never touches the document (§5). */
    viewRotation: 0,
    /**
     * True once the user has toggled the view rotation by hand, so the
     * long-axis auto-pick never fights a manual choice.
     */
    viewRotationUserSet: false,
    toggleViewRotation: () =>
        set((state) => ({ viewRotation: state.viewRotation === 0 ? 90 : 0, viewRotationUserSet: true })),
    /**
     * Default view orientation for a freshly opened document (§6): the label's
     * long axis horizontal when its backing is taller than it is wide. View-only
     * (invariant 1) — it never writes the document. A no-op once the user has
     * toggled rotation by hand, so it can never clobber a manual choice (it is
     * only ever invoked at the doc-open boundary, never from a render/resize).
     */
    applyDefaultViewOrientation: (backingW, backingH) =>
        set((state) =>
            state.viewRotationUserSet
                ? {}
                : { viewRotation: backingH > backingW ? 90 : 0 },
        ),
    /** Re-arm the auto-pick at a doc-open boundary (before applying it). */
    resetViewOrientation: () => set({ viewRotationUserSet: false }),

    /** How `effectiveZoom` is derived. `fit` is the default resting mode. */
    zoomMode: 'fit',
    /** Zoom used when `zoomMode === 'manual'` (CSS px per `hm`). */
    manualZoom: 0.05,
    /** See the `recenterToken` contract on `AppState`. */
    recenterToken: 0,
    /**
     * An explicit Fit/Real pick bumps `recenterToken` so the Preview re-derives
     * even when the mode is already active. `setManualZoom` (wheel/toolbar)
     * deliberately does NOT bump it: those steps must not force a recenter.
     */
    setZoomMode: (zoomMode) =>
        set((state) => ({ zoomMode, recenterToken: state.recenterToken + 1 })),
    setManualZoom: (manualZoom) => set({ manualZoom, zoomMode: 'manual' }),

    /** Resolved zoom, kept in sync by the Preview. */
    effectiveZoom: 0,
    setEffectiveZoom: (effectiveZoom) => set({ effectiveZoom }),
});
