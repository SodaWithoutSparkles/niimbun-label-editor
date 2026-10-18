import type { LabelDoc, Node } from '../core/doc/types';
import { rasterDimensions, type QuantizerByType, type QuantizerDefaults } from '../core/render';
import type { AssetDeps } from './render/assets';
import { MAX_RASTER_PIXELS, type RenderLabelPageOptions } from './render/renderLabelPage';

/**
 * P14 W3 — the live quantized preview's pure policy.
 *
 * While a user tunes a per-node quantization knob in the inspector, the editor
 * paints the **printed** raster over the label area and reverts to the normal
 * colour view ~1.5 s after the last change. This module owns the two decisions
 * that must not drift from the print path, and nothing else — the
 * debounce/idle/cancellation lifecycle lives in
 * `components/editor/useQuantizedPreview.ts`:
 *
 * 1. **What counts as "tuning"** — {@link quantizedPreviewTrigger}.
 * 2. **How much raster we may pay for** — {@link quantizedPreviewDpi}.
 *
 * **Whole page, never one object.** Quantization is a single global pass over
 * the page: per-object policies are resolved into a shared 8-slot mask palette
 * (`renderLabelPage.buildPolicyMask`) and an error diffuser's pattern depends on
 * the pixels around the leaf. Re-rendering just the selected node would show a
 * pattern no printer produces, so the caller renders the whole page through the
 * same `renderLabelPage` the print path uses. The only approximation left is the
 * dpi cap below (risk R14-e).
 *
 * Layer: `editor/` is the pure-logic layer (`.ts` only, no React). It may import
 * `core/` and its own `editor/render/` sibling; the hook that consumes it lives
 * in `components/`.
 */

/**
 * Preview dpi cap. The overlay is for judging **pattern and tone**, not for
 * pixel-peeping — and the dot pattern is itself a function of dpi, so a capped
 * render is an approximation and the UI affordance says so (R14-e). Render cost
 * is dpi², so 150 dpi costs ~55 % of a 203 dpi document-dpi render while staying
 * legible at the editor's on-screen zoom.
 */
export const QUANTIZED_PREVIEW_DPI_CAP = 150;

/** Below this the pattern carries no information: show nothing instead. */
export const QUANTIZED_PREVIEW_MIN_DPI = 20;

/**
 * Preview **pixel** budget. The dpi cap alone is not a cost bound: a 200 mm
 * label at 150 dpi is 1.4 M px, and the pipeline's own `MAX_RASTER_PIXELS`
 * (16 M px) permits a render + quantization pass large enough to freeze editing
 * while a knob pause triggers it. This budget keeps the worst case a hitch.
 *
 * Measured on the shared path (`renderLabelPage`, one text node, 150 dpi,
 * inclusive of resolve → rasterize → policy mask → clip → quantize → encode;
 * three runs per size on a **shared 2-core** box): 0.35 M px ≈ 0.11 s,
 * 0.78 M px ≈ 0.14–0.18 s, **1.0 M px ≈ 0.17–0.25 s**, 1.4 M px ≈ 0.24–0.26 s,
 * 3.1 M px ≈ 0.45 s. An idle-system run of the same code measured up to ~4×
 * faster, so treat these as the pessimistic end of a wide spread.
 *
 * 1 M px is therefore the largest round budget that keeps a pessimistic
 * worst-case render to a quarter of a second — a one-off debounced hitch during a
 * pause in tuning, not a freeze — and it still fits a full 100 × 150 mm label at
 * the 150 dpi cap (524 k px) without any degradation.
 */
export const QUANTIZED_PREVIEW_MAX_PIXELS = 1_000_000;

/**
 * The dpi the preview pays for: the document dpi, capped at
 * {@link QUANTIZED_PREVIEW_DPI_CAP}, then lowered until the raster fits the
 * preview pixel budget (which itself stays inside `MAX_RASTER_PIXELS`, the limit
 * `renderLabelPage` enforces with a `RangeError`). Returns `0` when the document
 * cannot be rendered at any usable dpi — the caller then shows **nothing**,
 * never an error.
 */
export const quantizedPreviewDpi = (doc: LabelDoc): number => {
    const docDpi = doc.label.dpi;
    if (!Number.isFinite(docDpi) || docDpi <= 0) return 0;
    // The preview budget sits below the pipeline cap, so the `RangeError` is
    // unreachable by design; take the min anyway so this stays correct if either
    // number moves.
    const budget = Math.min(QUANTIZED_PREVIEW_MAX_PIXELS, MAX_RASTER_PIXELS);
    let dpi = Math.floor(Math.min(docDpi, QUANTIZED_PREVIEW_DPI_CAP));
    // Iterate until the raster fits or the dpi is no longer usable — **no fixed
    // attempt cap**: a cap could give up on a candidate that fits a few steps
    // later and silently suppress an otherwise renderable preview. Termination is
    // guaranteed by construction: every `floor(dpi * k)` with `k < 1` is strictly
    // smaller than `dpi`, so the loop must fall below the minimum dpi.
    while (dpi >= QUANTIZED_PREVIEW_MIN_DPI) {
        const { widthPx, heightPx } = rasterDimensions(doc.label.backingW, doc.label.backingH, dpi);
        const pixels = widthPx * heightPx;
        if (!Number.isFinite(pixels) || pixels <= 0) return 0;
        if (pixels <= budget) return dpi;
        // Scale by sqrt(budget/pixels) so the next candidate targets the budget
        // (pixel count scales with dpi²). A raster that does *not* scale with
        // dpi² — a degenerate axis clamped to one pixel — converges a step at a
        // time; that is exactly the case a fixed cap used to break.
        const next = Math.floor(dpi * Math.sqrt(budget / pixels));
        // Defensive: cannot happen while `pixels > budget > 0`, but a
        // non-decreasing step would spin here forever.
        if (next >= dpi) return 0;
        dpi = next;
    }
    return 0;
};

/** The selected node's quantization-relevant identity. */
export interface QuantizedPreviewTrigger {
    readonly nodeId: string;
    /** `hint | threshold | strength | serpentine` — the fields the inspector knobs write. */
    readonly key: string;
}

/**
 * The trigger for the live preview, or `null` when nothing is selected.
 *
 * **Owner decision (P14, §W3): the inspector knobs are the only trigger.** The
 * Rendering settings section edits the same knobs, but it is mounted in a native
 * modal `<dialog>` (`Modal.tsx` `showModal()`), so the canvas is not visible
 * behind it and a preview there is pointless.
 *
 * The key names exactly the fields the per-node knobs write — `quantizerHint`
 * and `quantizerParams.threshold|strength|serpentine` (`ObjectTab.tsx`
 * `setNumber`/`setString`). It deliberately **excludes**:
 *   - the node's *effective* quantizer id, which also changes when the per-type
 *     settings change (a settings-only edit must not trigger — the canvas is
 *     behind the modal);
 *   - every other node field, so an unrelated edit never triggers;
 *   - the node's *presence* in the selection: selecting a node is not tuning, so
 *     the hook baselines a new node id without opening a preview.
 */
export const quantizedPreviewTrigger = (node: Node | undefined): QuantizedPreviewTrigger | null => {
    if (node === undefined) return null;
    const params = node.quantizerParams;
    return {
        nodeId: node.id,
        key: [
            node.quantizerHint ?? '',
            params?.threshold ?? '',
            params?.strength ?? '',
            params?.serpentine ?? '',
        ].join('|'),
    };
};

/**
 * The render options for the preview: the **capped** dpi, the editor's prepared
 * asset deps, and the store's dither settings — i.e. the same inputs the print
 * path threads in, minus the print transport overrides. `invert`/`mirror`/
 * `offset` are deliberately absent: the editor canvas shows the logical/label
 * orientation (the same convention `usePrintThumbnails` documents), and the
 * preview must match what is already on screen, not the encoder's feed order.
 *
 * Returns `null` when the document cannot be rendered at any usable dpi, so the
 * caller has one explicit "show nothing" value to branch on.
 */
export const quantizedPreviewOptions = (
    doc: LabelDoc,
    assets?: AssetDeps,
    quantizerDefaults?: QuantizerDefaults,
    defaultQuantizerByType?: QuantizerByType,
): RenderLabelPageOptions | null => {
    const dpi = quantizedPreviewDpi(doc);
    if (dpi <= 0) return null;
    return {
        dpi,
        ...(assets !== undefined ? { assets } : {}),
        ...(quantizerDefaults !== undefined ? { quantizerDefaults } : {}),
        ...(defaultQuantizerByType !== undefined ? { defaultQuantizerByType } : {}),
    };
};
