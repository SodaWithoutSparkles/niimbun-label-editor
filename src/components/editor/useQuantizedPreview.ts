import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LabelDoc } from '../../core/doc/types';
import type { QuantizerByType, QuantizerDefaults } from '../../core/render';
import type { AssetDeps } from '../../editor/render/assets';
import {
    renderLabelPage,
    type RenderedLabelPage,
    type RenderLabelPageOptions,
    type ResolveContext,
} from '../../editor/render';
import {
    quantizedPreviewOptions,
    quantizedPreviewTrigger,
    type QuantizedPreviewTrigger,
} from '../../editor/quantizedPreview';
import { previewOptionsKey, previewOverridesKey } from '../../editor/render/previewKeys';

/**
 * P14 W3 — the live quantized preview's lifecycle (owner decision: the
 * **inspector knobs** are the only trigger).
 *
 * While a user tunes the selected node's quantization state (`quantizerHint` /
 * `quantizerParams.threshold|strength|serpentine`), the preview canvas paints the
 * **printed** raster over the label area and reverts to the normal colour view
 * after a short idle. The pure policy — the trigger key, the dpi cap, the
 * `MAX_RASTER_PIXELS` degradation — lives in `editor/quantizedPreview.ts`; this
 * hook owns only the effects: debounce, supersede, idle revert, teardown.
 *
 * Lifecycle rules (all tested):
 * - **Debounced.** A burst of knob frames (a slider drag writes a transient node
 *   patch per frame) coalesces into one render per pause.
 * - **Cancelled per generation.** Every supersede (a newer change, a revert, a
 *   doc/tool switch, unmount) bumps a token; a render that lands afterwards can
 *   never paint.
 * - **Matches the canvas.** The render gets the caller's `resolveContext` (the
 *   sample-row override map the editor canvas resolves with), and a result is
 *   only painted while **both** its options and the content it was rendered from
 *   (document + override *values*) are still current.
 * - **Auto-revert.** The overlay lives `QUANTIZED_PREVIEW_IDLE_MS` after the last
 *   painted raster, and a non-trigger content change hides it immediately rather
 *   than leaving a stale page up.
 * - **Never mutates the document.** The hook only reads `doc` and renders; it
 *   pushes no undo entry and never touches the print path's thumbnail cache
 *   (which is keyed at a different dpi).
 * - **StrictMode-idempotent.** The scheduling effect has no cleanup: a replay
 *   must not drop a debounce that the first setup armed, and every dependency
 *   change path cancels or reschedules through `clearTimers`.
 */

/**
 * Debounce before rendering. Target < 100 ms (plan W3): long enough to coalesce
 * a slider burst, short enough that a nudged knob feels live.
 */
export const QUANTIZED_PREVIEW_DEBOUNCE_MS = 60;

/** Idle time after the last painted raster before the overlay reverts. */
export const QUANTIZED_PREVIEW_IDLE_MS = 1500;

/** Render seam — injectable so hook tests exercise the lifecycle, not pixels. */
export type RenderQuantizedPreview = (
    doc: LabelDoc,
    ctx: ResolveContext,
    opts: RenderLabelPageOptions,
) => Promise<RenderedLabelPage>;

export interface UseQuantizedPreviewOptions {
    /** The open document (read through a ref at render time). */
    doc: LabelDoc | null;
    /** The editor's selection. More than one node = no trigger (the knobs are single-selection). */
    selectedNodeIds: readonly string[];
    /** Repo-backed providers (`createResourceAssetDeps`), i.e. the editor's assets. */
    assets?: AssetDeps;
    /** The store's per-strategy dither settings, threaded into the shared path. */
    quantizerDefaults?: QuantizerDefaults;
    /** The store's per-type default-quantizer map, threaded into the shared path. */
    defaultQuantizerByType?: QuantizerByType;
    /**
     * The resolve context the editor canvas renders with (`ResolveContext`, i.e.
     * the sample-row override map from the shared pre-pass). Passed straight to
     * the shared render path so the overlay shows the **same content** the canvas
     * shows — a different row, or the static/fallback path, would print a page
     * the user is not looking at.
     */
    resolveContext?: ResolveContext;
    /**
     * Any change to this value dismisses the overlay — the editor's active tool.
     * Tuning is an inspector activity; switching to a drawing tool must not leave
     * a stale raster on the canvas.
     */
    revertOn?: string;
    /** `false` holds no render and drops any overlay (defaults to `true`). */
    enabled?: boolean;
    /** Raster seam; defaults to the shared `renderLabelPage` (invariant 7). */
    renderPage?: RenderQuantizedPreview;
}

export interface QuantizedPreview {
    /** The rendered page raster, or `undefined` while no overlay is showing. */
    image: CanvasImageSource | undefined;
    /** `true` while the overlay should be painted (the chip shows with it). */
    active: boolean;
}

/** A render plan plus its content key; `null` = the document cannot be rendered. */
interface PreviewPlan {
    options: RenderLabelPageOptions;
    key: string;
}

/** The content a raster was rendered from: the document plus the override values. */
interface RenderedContent {
    doc: LabelDoc;
    ctxKey: string;
}

/**
 * Is `content` still what the inputs resolve to? The document is compared by
 * identity (any edit mints a fresh `currentDoc`) and the override map by
 * **value** (`previewOverridesKey`), because the sample-row pass re-commits an
 * equal map every second on a ticking document.
 */
const sameContent = (content: RenderedContent, inputs: UseQuantizedPreviewOptions): boolean =>
    inputs.doc === content.doc && previewOverridesKey(inputs.resolveContext) === content.ctxKey;

export const useQuantizedPreview = (options: UseQuantizedPreviewOptions): QuantizedPreview => {
    const { doc, selectedNodeIds, enabled = true, revertOn, resolveContext } = options;

    const [bitmap, setBitmap] = useState<CanvasImageSource | null>(null);

    // Latest inputs, read at render time. Deliberately not effect dependencies: a
    // fresh (but equal) `assets`/settings/context object, or a doc repaint that
    // does not touch the trigger key, must never restart a render.
    const inputsRef = useRef(options);
    inputsRef.current = options;

    const nodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
    const trigger = quantizedPreviewTrigger(
        nodeId === null ? undefined : doc?.nodes.find((node) => node.id === nodeId),
    );

    // The override map by **value** (see `previewOverridesKey`): re-deriving the
    // key costs a walk of a small map, and the key — never the context object's
    // identity — is what the effects compare, so a fresh-but-equal context cannot
    // mark a live raster stale.
    const ctxKey = useMemo(() => previewOverridesKey(resolveContext), [resolveContext]);

    const generationRef = useRef(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** The last observed trigger, for "did this change tune anything?" comparison. */
    const previousRef = useRef<QuantizedPreviewTrigger | null>(null);
    /** What the currently painted raster was rendered from; `null` = nothing painted. */
    const paintedRef = useRef<RenderedContent | null>(null);

    const clearTimers = useCallback((): void => {
        if (debounceRef.current !== null) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        if (idleRef.current !== null) {
            clearTimeout(idleRef.current);
            idleRef.current = null;
        }
    }, []);

    /** Drop the overlay and supersede anything in flight. */
    const revert = useCallback((): void => {
        generationRef.current += 1;
        clearTimers();
        paintedRef.current = null;
        setBitmap(null);
    }, [clearTimers]);

    /** Plan the render from the newest inputs, with the staleness key. */
    const planNow = useCallback((): PreviewPlan | null => {
        const current = inputsRef.current;
        if (!current.doc) return null;
        const planned = quantizedPreviewOptions(
            current.doc,
            current.assets,
            current.quantizerDefaults,
            current.defaultQuantizerByType,
        );
        if (planned === null) return null;
        return { options: planned, key: previewOptionsKey(planned) };
    }, []);

    const runRender = useCallback(
        async (generation: number): Promise<void> => {
            const inputs = inputsRef.current;
            const target = inputs.doc;
            const plan = planNow();
            if (target === null || plan === null) {
                // Nothing renderable (no doc, or an absurd raster even after the
                // dpi degradation): show nothing rather than a stale or error state.
                if (generationRef.current === generation) revert();
                return;
            }
            // The canvas's own resolve context (frozen with the render): the
            // overlay must show the row the editor is showing, and a result is
            // only painted while that content is still current.
            const ctx = inputs.resolveContext ?? {};
            const content: RenderedContent = { doc: target, ctxKey: previewOverridesKey(ctx) };
            try {
                const page = await (inputs.renderPage ?? renderLabelPage)(target, ctx, plan.options);
                // Superseded mid-flight (a newer change, a revert, a doc/tool
                // switch, unmount): never paint over the newer state.
                if (generationRef.current !== generation) return;
                const latest = planNow();
                if (latest === null || latest.key !== plan.key) return;
                // The content moved under the render (an unrelated edit, a
                // sample-row change): the raster no longer matches the canvas.
                if (!sameContent(content, inputsRef.current)) return;
                paintedRef.current = content;
                setBitmap(page.canvas);
                idleRef.current = setTimeout(() => {
                    idleRef.current = null;
                    paintedRef.current = null;
                    setBitmap(null);
                }, QUANTIZED_PREVIEW_IDLE_MS);
            } catch {
                // A `RangeError` from `MAX_RASTER_PIXELS` or a bad dpi is expected
                // input, not a crash: degrade to no overlay, never to an error.
                if (generationRef.current === generation) revert();
            }
        },
        [planNow, revert],
    );

    const docId = doc?.meta.id ?? null;

    // Dismiss on a document switch or a tool change. Declared before the
    // scheduling effect so that, in a commit where both changed, the dismiss
    // clears the overlay first (the scheduler never schedules into a dead
    // context). `revert` on mount is a no-op state write.
    useEffect(() => {
        revert();
    }, [revert, docId, revertOn]);

    // Re-baseline on a document switch. The same node id can appear in two
    // documents (a duplicated label keeps its node ids), so without this a
    // switch to a doc whose node carries different params would look like a
    // tune and open a preview nobody asked for. Declared before the scheduling
    // effect: React runs effect bodies in declaration order, so the scheduler
    // below sees the cleared baseline in the same commit.
    useEffect(() => {
        previousRef.current = null;
    }, [docId]);

    // The trigger. Only a change to the selected node's quantization-relevant
    // key arms a render; a selection change baselines the new node and drops the
    // previous node's overlay without rendering. The body also re-runs on a
    // **content** change (`doc` identity, override values) — see the non-trigger
    // branch below.
    useEffect(() => {
        if (!enabled || trigger === null) {
            previousRef.current = null;
            revert();
            return;
        }
        const previous = previousRef.current;
        previousRef.current = trigger;
        if (previous === null || previous.nodeId !== trigger.nodeId) {
            revert();
            return;
        }
        if (previous.key === trigger.key) {
            // No tune in this commit. A non-trigger change never *starts* a
            // render, but a raster that is already up may no longer match the
            // canvas (an unrelated edit, a sample-row switch): hide it instead of
            // leaving a stale page on screen.
            const painted = paintedRef.current;
            if (painted !== null && (painted.doc !== doc || painted.ctxKey !== ctxKey)) revert();
            return;
        }
        // Supersede any in-flight render, restart the debounce (a burst coalesces
        // into one raster) and cancel the pending idle revert — the overlay that
        // is already up stays up rather than flickering off between frames.
        generationRef.current += 1;
        clearTimers();
        const generation = generationRef.current;
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            void runRender(generation);
        }, QUANTIZED_PREVIEW_DEBOUNCE_MS);
        // No cleanup: a StrictMode setup → cleanup → setup replay must not drop
        // the debounce the first setup armed. Every dependency change path above
        // either cancels or reschedules through `clearTimers`.
    }, [enabled, trigger?.nodeId, trigger?.key, doc, ctxKey, revert, clearTimers, runRender]);

    // Unmount: supersede in flight (a late resolve must not paint) and drop the
    // timers. Setup re-derives everything, so a StrictMode replay is harmless.
    useEffect(
        () => () => {
            generationRef.current += 1;
            if (debounceRef.current !== null) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
            if (idleRef.current !== null) {
                clearTimeout(idleRef.current);
                idleRef.current = null;
            }
        },
        [],
    );

    return { image: bitmap ?? undefined, active: bitmap !== null };
};
