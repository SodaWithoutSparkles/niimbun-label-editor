import Konva from 'konva';
import { nodeLookup } from '../../core/doc/derive';
import { hasFill, hasStroke } from '../../core/doc/objects';
import type { LabelDoc, Node } from '../../core/doc/types';
import {
    HM_PER_INCH,
    MonoColorSpace,
    QUANTIZERS,
    quantizeRgba,
    rasterDimensions,
    resolveQuantizer,
    type ColorSpace,
    type PolicyMask,
    type Quantizer,
    type QuantizerId,
    type QuantizerPolicies,
    type RgbaBuffer,
} from '../../core/render';
import type { AssetDeps, AssetWarning, PreparedAsset } from './assets';
import { applyRegionClip } from './clip';
import { createKonvaNode, fitImageAttrs, matrixToKonvaAttrs } from './konvaFactory';
import { prepareResolvedAssets } from './prepareAssets';
import {
    prepareTextFonts,
    rasterizeResolved,
    type RasterizeOptions,
} from './rasterize';
import { flattenResolved, resolve, type ResolvedNode, type ResolveContext } from './resolve';

/**
 * The **one shared render path** preview and print both call (invariant 7).
 *
 * Pipeline (plan §5):
 *   `resolve(doc)` → `rasterizeResolved` → build policy mask → `applyRegionClip`
 *   → `quantizeRgba` → `invert` → `mirror` → `applyRegionClip` again → `offset`
 *   → final encoder canvas.
 *
 * The clip runs **both before and after** quantization: pre-quantize so the
 * diffusion sees a white surround, post-quantize so error diffused across the
 * union boundary can never leave ink outside the printable area (M3).
 *
 * Post-quantize override order is fixed: `quantize → invert → mirror →
 * post-clip → offset`. Invert/mirror run **before** the post-clip so they can
 * never deposit ink in the guaranteed-white margin; offset runs last, on a
 * fresh canvas. A mirror that pushes ink across the union boundary is clipped
 * away — that silent loss is reported via {@link RenderNotice} so the UI can
 * warn instead of shipping a quietly-damaged label.
 *
 * `rasterizeResolved` destroys its Konva canvas on return, so the final encoder
 * canvas is built here from the quantized RGBA via `putImageData` (M1).
 *
 * No document mutation (invariant 2) and deterministic: the same doc + context +
 * options produce byte-identical `rgba`. Templates/CSV are never executed here —
 * `resolve` already substitutes static/fallback content (P6 owns execution).
 */

export interface RenderLabelPageOptions {
    /** Global quantizer. Defaults to `'threshold'`. */
    quantizer?: QuantizerId;
    /** Binary threshold forwarded to every quantizer. Default 128. */
    threshold?: number;
    /** Diffusion strength forwarded to the error-diffusion quantizers. Default 1. */
    strength?: number;
    /** Serpentine scanning forwarded to the diffusers. Default true. */
    serpentine?: boolean;
    /** Per-pixel projection. Defaults to Mono (the only v1 color space). */
    colorSpace?: ColorSpace;
    /**
     * Async asset dependencies (image bytes, fonts, resolution cap). When
     * present, image/qr/barcode leaves are prepared first; absent, those leaves
     * simply draw nothing.
     */
    assets?: AssetDeps;
    /**
     * Effective render dpi; defaults to `doc.label.dpi`. Drives the raster
     * dimensions, the `hm → px` stage scale, `hmPerPx` and the policy-mask
     * scale, so everything downstream stays on one dpi. Thumbnails render at
     * ~50 dpi through this same path (O1).
     */
    dpi?: number;
    /** Post-quantize: flip every RGB channel (`v → 255 - v`), so black ↔ white. */
    invert?: boolean;
    /** Post-quantize: flip the raster horizontally. */
    mirror?: boolean;
    /**
     * Applied last, on a **fresh** canvas: shift the raster by device px at the
     * effective dpi. `inner` keeps the raster size (`putImageData` at `x`/`y`);
     * `outer` expands by `|x|`/`|y|` and places the image at `max(x,0)`/`max(y,0)`.
     */
    offset?: { x: number; y: number; type: 'inner' | 'outer' };
}

export interface RenderedLabelPage {
    /** Final 1-bit black/white RGBA (exact `0`/`255` channels). */
    rgba: RgbaBuffer;
    widthPx: number;
    heightPx: number;
    /** A fresh canvas holding the final quantized, clipped page (safe for the encoder). */
    canvas: HTMLCanvasElement;
    /**
     * Per-leaf asset problems (missing/invalid/too-small) so the editor can badge
     * the node. Absent/empty when every asset prepared cleanly.
     */
    warnings?: ReadonlyMap<string, AssetWarning>;
    /**
     * Non-fatal render outcomes the UI can surface. Absent when there is nothing
     * to report. Populated only on the mirror path, where the post-clip can
     * silently erase ink the flip moved outside the printable union.
     */
    notices?: readonly RenderNotice[];
}

/**
 * A non-fatal rendering outcome. Today only the mirror override uses it:
 * flattening the raster across the printable union can destroy deposited ink,
 * which is unacceptable to do silently.
 */
export interface RenderNotice {
    kind: 'mirror-clipped-ink';
    /** Ink pixels the post-quantize clip removed after the horizontal flip. */
    lostPx: number;
}

/** A built policy mask plus the quantizers its indices resolve to. */
export interface PolicyMaskResult {
    mask: PolicyMask;
    /** Index `0` is reserved for the global quantizer; indices start at 1. */
    policies: QuantizerPolicies;
}

/** Refuse to allocate absurd rasters (invariant 9). Common canvas limit is ~16M px. */
export const MAX_RASTER_PIXELS = 16_000_000;

/**
 * Key colours are assigned 1-based per policy index by convention; there is
 * always at least one policy so the constant is never read directly.
 */
const KEY_COLORS: readonly (readonly [number, number, number])[] = [
    [255, 0, 0],
    [0, 0, 255],
    [0, 200, 0],
    [255, 0, 255],
    [0, 180, 180],
    [255, 128, 0],
    [128, 0, 255],
    [255, 255, 0],
];

/**
 * The mask value `0` (global quantizer) key colour. Unhinted leaves paint this,
 * so an unhinted topmost shape overrides a hinted leaf beneath it (M2).
 */
const GLOBAL_KEY: readonly [number, number, number] = [0, 0, 0];

const rgb = (color: readonly [number, number, number]): string => `rgb(${color[0]},${color[1]},${color[2]})`;

/**
 * Paint a node's **actual coverage** (glyphs / filled shape / stroked outline) in
 * `color`, matching the raster exactly.
 *
 * Text fills its glyphs. A shape mirrors its resolved style: the stroke and the
 * fill are each painted only when they deposit ink — a `'transparent'` (no-fill
 * or no-stroke) shape must claim just the parts the raster actually deposits, or
 * the mask would cover pixels the raster leaves white (M2: mask-topmost ==
 * raster-topmost).
 */
const paintCoverage = (node: Konva.Shape, color: string): void => {
    if (node instanceof Konva.Text) {
        node.strokeEnabled(false);
        node.fill(color);
        return;
    }
    // NOTE: `hasFill` is a *presence* test, not an *ink* test: a light `#eeeeee`
    // or low-alpha `#00000040` fill is claimed at full mask coverage while
    // `threshold` may render it white. Pre-existing; tracked as follow-up debt.
    if (hasFill(node.fill() as string | undefined)) node.fill(color);
    else node.fillEnabled(false);
    // Symmetric no-stroke rule: an invisible stroke must not claim a band.
    if (hasStroke(node.stroke() as string | undefined)) {
        node.strokeEnabled(true);
        node.stroke(color);
    } else {
        node.strokeEnabled(false);
    }
};

/**
 * Build the per-object dither **policy mask** (decision 1).
 *
 * Every rendered non-group leaf is painted, in the **same tree order as the
 * raster** (`flattenResolved` pre-order == Konva's draw order), so mask-topmost
 * equals raster-topmost (M2). An image/qr/barcode leaf with no prepared asset
 * draws nothing and is skipped entirely; with one it claims only its **drawn
 * rect** (the `fitImageAttrs` rect), so a `contain` letterbox stays uncovered. A
 * leaf whose `resolveQuantizer` yields a policy paints that policy's key colour;
 * an unhinted/no-default leaf paints the global key (mask value `0`), so it
 * overrides any hinted leaf it covers. Pixels no leaf covers also read `0`.
 *
 * Guardrail: if **no** leaf resolves to a policy the whole mask is skipped
 * (`undefined`) and the caller runs one global pass, byte-identical.
 *
 * Each leaf is painted with its **absolute** `transform` onto one transparent
 * offscreen canvas, so a leaf nested in a group lands where it actually draws.
 * Konva paints glyphs and filled outlines, not bounding boxes. Approximation:
 * antialiased boundary pixels are resolved by an alpha ≥ 128 coverage test and
 * nearest key colour; interiors of overlapping opaque coverage are exact.
 */
export const buildPolicyMask = async (
    nodes: readonly ResolvedNode[],
    byId: ReadonlyMap<string, Node>,
    dims: { widthPx: number; heightPx: number },
    dpi: number,
    assets?: ReadonlyMap<string, PreparedAsset>,
): Promise<PolicyMaskResult | undefined> => {
    // This is re-exported public surface; fail clearly before touching Konva.
    if (!Number.isFinite(dpi) || dpi <= 0) {
        throw new RangeError(`buildPolicyMask: dpi must be > 0 (got ${dpi})`);
    }
    // Canvas sizes coerce to integers, but the mask allocation and returned dims
    // would stay fractional — require whole device px (dpi may be fractional).
    if (
        !Number.isInteger(dims.widthPx) ||
        dims.widthPx <= 0 ||
        !Number.isInteger(dims.heightPx) ||
        dims.heightPx <= 0
    ) {
        throw new RangeError(
            `buildPolicyMask: widthPx/heightPx must be positive integers (got ${dims.widthPx}×${dims.heightPx})`,
        );
    }

    const policyIds: QuantizerId[] = [];
    const indexByPolicy = new Map<QuantizerId, number>();
    const carriers: { node: ResolvedNode; value: number }[] = [];
    let anyPolicy = false;

    for (const node of flattenResolved(nodes)) {
        if (node.type === 'group') continue;
        const source = byId.get(node.id);
        if (!source) {
            // `resolve` only emits nodes from the document, so a miss is an
            // invariant violation — never silently drop a mask carrier.
            throw new Error(`buildPolicyMask: resolved node "${node.id}" is missing from the document`);
        }
        // An image/qr/barcode with no prepared asset draws nothing, so it must
        // not claim any mask coverage either: a missing topmost asset would
        // otherwise override a visible lower node's quantizer policy.
        if (
            (node.type === 'image' || node.type === 'qr' || node.type === 'barcode') &&
            !assets?.get(node.id)
        ) {
            continue;
        }
        const policy = resolveQuantizer({ type: source.type, quantizerHint: source.quantizerHint });
        if (policy) {
            let index = indexByPolicy.get(policy);
            if (index === undefined) {
                index = policyIds.length + 1;
                indexByPolicy.set(policy, index);
                policyIds.push(policy);
            }
            carriers.push({ node, value: index });
            anyPolicy = true;
        } else {
            carriers.push({ node, value: 0 });
        }
    }
    if (!anyPolicy) return undefined;
    if (policyIds.length > KEY_COLORS.length) {
        throw new Error(
            `buildPolicyMask: ${policyIds.length} distinct policies exceed the ${KEY_COLORS.length}-colour key palette`,
        );
    }

    // Value k → key colour; index 0 is the global key.
    const keyColors: (readonly [number, number, number])[] = [
        GLOBAL_KEY,
        ...KEY_COLORS.slice(0, policyIds.length),
    ];

    const { widthPx, heightPx } = dims;
    const scale = dpi / HM_PER_INCH;

    await prepareTextFonts(nodes);

    // Force a 1:1 backing store (same reason as `rasterizeResolved`): on HiDPI
    // Konva would allocate `widthPx*DPR` and we would read only the top-left
    // quadrant. Restored in `finally` so the global never leaks.
    const previousPixelRatio = Konva.pixelRatio;
    Konva.pixelRatio = 1;
    try {
        const container = document.createElement('div');
        const stage = new Konva.Stage({ container, width: widthPx, height: heightPx });
        stage.scale({ x: scale, y: scale });
        const layer = new Konva.Layer();
        stage.add(layer);

        for (const carrier of carriers) {
            // Absolute transform: a leaf inside a group must be painted where it
            // actually lands, not at its group-local position.
            const attrs = matrixToKonvaAttrs(carrier.node.transform);
            const leaf = carrier.node;
            if (leaf.type === 'image' || leaf.type === 'qr' || leaf.type === 'barcode') {
                // Paint only the **drawn** rect: for `contain` the letterbox is
                // transparent in the raster, so it must not claim coverage.
                const asset = assets?.get(leaf.id);
                if (!asset) continue;
                const fit = leaf.type === 'image' ? leaf.fit : 'contain';
                const rect = fitImageAttrs(leaf.w, leaf.h, asset.widthPx, asset.heightPx, fit);
                // Group carries the absolute transform; the rect keeps the local
                // drawn-rect offset as a child so the two compose (setting both on
                // one node would let the transform's x/y overwrite the offset).
                const box = new Konva.Group();
                box.setAttrs(attrs);
                box.add(
                    new Konva.Rect({
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        fill: rgb(keyColors[carrier.value]!),
                    }),
                );
                layer.add(box);
                continue;
            }
            const konva = createKonvaNode(leaf, assets);
            konva.setAttrs(attrs);
            paintCoverage(konva as Konva.Shape, rgb(keyColors[carrier.value]!));
            layer.add(konva);
        }

        stage.draw();

        const canvas = layer.getCanvas()._canvas as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('buildPolicyMask: layer canvas has no 2D context');
        const raw = ctx.getImageData(0, 0, widthPx, heightPx).data;

        const mask = new Uint8Array(widthPx * heightPx);
        for (let p = 0; p < mask.length; p++) {
            const i = p * 4;
            if (raw[i + 3] < 128) continue; // uncovered → 0 (global)
            const r = raw[i]!;
            const g = raw[i + 1]!;
            const b = raw[i + 2]!;
            let best = 0;
            let bestDistance = Infinity;
            for (let k = 0; k < keyColors.length; k++) {
                const [kr, kg, kb] = keyColors[k]!;
                const distance = (r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2;
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = k;
                }
            }
            mask[p] = best;
        }

        stage.destroy();

        const policies: Map<number, Quantizer> = new Map(
            policyIds.map((id, i) => [i + 1, QUANTIZERS[id]] as const),
        );
        return { mask: { data: mask, width: widthPx, height: heightPx }, policies };
    } finally {
        Konva.pixelRatio = previousPixelRatio;
    }
};

const buildQuantizeOptions = (opts: RenderLabelPageOptions): Parameters<typeof quantizeRgba>[2] => {
    const colorSpace = opts.colorSpace ?? MonoColorSpace;
    const out: NonNullable<Parameters<typeof quantizeRgba>[2]> = { colorSpace };
    if (opts.threshold !== undefined) out.threshold = opts.threshold;
    if (opts.strength !== undefined) out.strength = opts.strength;
    if (opts.serpentine !== undefined) out.serpentine = opts.serpentine;
    return out;
};

/**
 * Post-quantize invert: `v → 255 - v` on R/G/B. Alpha (opacity) is left intact
 * so the raster stays opaque — the reference `effects.invert` only touches the
 * colour channels.
 */
const invertRgb = (rgba: RgbaBuffer): void => {
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i]!;
        data[i + 1] = 255 - data[i + 1]!;
        data[i + 2] = 255 - data[i + 2]!;
    }
};

/** Post-quantize horizontal flip, in place (all four channels). */
const mirrorRgba = (rgba: RgbaBuffer): void => {
    const { data, width, height } = rgba;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < Math.floor(width / 2); x++) {
            const left = (row + x) * 4;
            const right = (row + width - 1 - x) * 4;
            for (let c = 0; c < 4; c++) {
                const tmp = data[left + c]!;
                data[left + c] = data[right + c]!;
                data[right + c] = tmp;
            }
        }
    }
};

/**
 * Count dark (ink) pixels. Only the mirror path pays for this: the region clip
 * can silently erase ink the flip moved outside the printable union, so the
 * before/after counts become a {@link RenderNotice} instead of vanishing.
 */
const countInkPx = (rgba: RgbaBuffer): number => {
    const { data } = rgba;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 128) count++;
    }
    return count;
};

/**
 * Render a label page to final 1-bit RGBA. The single entry point for both the
 * preview and the print path; only encoding differs downstream (invariant 7).
 */
export const renderLabelPage = async (
    doc: LabelDoc,
    ctx: ResolveContext = {},
    opts: RenderLabelPageOptions = {},
): Promise<RenderedLabelPage> => {
    // Validate the effective dpi **before** resolve so a bad `opts.dpi` cannot
    // pay a full resolve/template pass (invariant 9). A caller-supplied
    // `assets.dpi` is honoured, then the document dpi.
    const dpi = opts.dpi ?? opts.assets?.dpi ?? doc.label.dpi;
    if (!Number.isFinite(dpi) || dpi <= 0) {
        throw new RangeError(`renderLabelPage: dpi must be > 0 (got ${dpi})`);
    }
    const nodes = resolve(doc, ctx);
    const { widthPx, heightPx } = rasterDimensions(
        doc.label.backingW,
        doc.label.backingH,
        dpi,
    );

    // Pre-flight before any allocation (invariant 9).
    if (!Number.isInteger(widthPx) || widthPx <= 0 || !Number.isInteger(heightPx) || heightPx <= 0) {
        throw new RangeError(
            `renderLabelPage: raster dimensions must be positive integers (got ${widthPx}×${heightPx})`,
        );
    }
    const pixels = widthPx * heightPx;
    if (pixels > MAX_RASTER_PIXELS) {
        throw new RangeError(
            `renderLabelPage: raster ${widthPx}×${heightPx} = ${pixels} px exceeds the ${MAX_RASTER_PIXELS}-pixel cap`,
        );
    }

    // Register any imported fonts the document needs before text is measured.
    // A rejected provider degrades to the browser's fallback fonts.
    if (opts.assets?.fonts?.ensureFonts) {
        try {
            await opts.assets.fonts.ensureFonts(doc);
        } catch {
            // Never fail preview/print because a font could not be registered.
        }
    }
    // Thread the **effective** dpi into asset preparation so a `dpi: 50`
    // thumbnail decodes image/QR/barcode assets at its own resolution instead of
    // the full document dpi (additive: an explicit `assets.imageScale` still
    // wins; absent `dpi`, `prepareAssets` falls back to `doc.label.dpi`).
    const assetDeps: AssetDeps = { ...(opts.assets ?? {}), dpi };
    const { assets, warnings } = await prepareResolvedAssets(nodes, doc, assetDeps);

    const rasterOpts: RasterizeOptions = { widthPx, heightPx, dpi };
    const { imageData } = await rasterizeResolved(nodes, rasterOpts, assets);

    const byId = nodeLookup(doc.nodes);
    const policy = await buildPolicyMask(nodes, byId, { widthPx, heightPx }, dpi, assets);

    const hmPerPx = HM_PER_INCH / dpi;
    // Pre-clip: the diffusion pass sees a white surround outside the union.
    applyRegionClip(imageData, { widthPx, heightPx }, doc.label.regions, hmPerPx);

    const quantizeOptions = buildQuantizeOptions(opts);
    quantizeRgba(
        imageData,
        {
            globalQuantizer: QUANTIZERS[opts.quantizer ?? 'threshold'],
            ...(policy ? { policies: policy.policies, mask: policy.mask } : {}),
            colorSpace: opts.colorSpace ?? MonoColorSpace,
        },
        quantizeOptions,
    );

    // Post-quantize overrides, applied **before** the post-clip: invert must not
    // blacken the guaranteed-white margin, and mirror must not move ink outside
    // the union. Order: quantize → invert → mirror → post-clip → offset.
    if (opts.invert) invertRgb(imageData);

    // Post-clip: error diffusion can cross the boundary; guarantee blank outside.
    // Only the mirror path counts ink around the clip: the flip is the one
    // override that can push already-deposited ink across the union, and the
    // common path must stay free of the extra scan. A non-zero loss is surfaced
    // as a notice rather than silently swallowed.
    let notices: RenderNotice[] | undefined;
    if (opts.mirror) {
        mirrorRgba(imageData);
        const inkBefore = countInkPx(imageData);
        applyRegionClip(imageData, { widthPx, heightPx }, doc.label.regions, hmPerPx);
        const lostPx = inkBefore - countInkPx(imageData);
        if (lostPx > 0) {
            notices = [{ kind: 'mirror-clipped-ink', lostPx }];
        }
    } else {
        applyRegionClip(imageData, { widthPx, heightPx }, doc.label.regions, hmPerPx);
    }

    // Final encoder canvas — the Konva canvas is gone (M1).
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) throw new Error('renderLabelPage: no 2D context for the encoder canvas');
    const encoded = canvasCtx.createImageData(widthPx, heightPx);
    encoded.data.set(imageData.data);
    canvasCtx.putImageData(encoded, 0, 0);

    const offset = opts.offset;
    // `{0,0}` is a no-op: skip the extra-canvas round trip and return the base
    // raster (same `canvas` identity).
    if (!offset || (offset.x === 0 && offset.y === 0)) {
        return { rgba: imageData, widthPx, heightPx, canvas, warnings, ...(notices ? { notices } : {}) };
    }
    // Offset x/y are device px, so they must be integers (and finite: NaN/
    // Infinity fail `Number.isInteger`). Validate before any offset allocation.
    if (!Number.isInteger(offset.x) || !Number.isInteger(offset.y)) {
        throw new RangeError(
            `renderLabelPage: offset must be integer device px (got x=${offset.x}, y=${offset.y})`,
        );
    }

    // Offset is applied last, on a **fresh** canvas: the base `canvas` above is
    // never mutated. `putImageData` writes (does not composite) and clips to the
    // canvas, matching the reference `inner`/`outer` semantics.
    const { x, y, type } = offset;
    const outer = type === 'outer';
    const outWidthPx = outer ? widthPx + Math.abs(x) : widthPx;
    const outHeightPx = outer ? heightPx + Math.abs(y) : heightPx;

    // Pre-flight the offset raster before allocating (invariant 9).
    if (
        !Number.isInteger(outWidthPx) ||
        outWidthPx <= 0 ||
        !Number.isInteger(outHeightPx) ||
        outHeightPx <= 0
    ) {
        throw new RangeError(
            `renderLabelPage: offset raster dimensions must be positive integers (got ${outWidthPx}×${outHeightPx})`,
        );
    }
    const outPixels = outWidthPx * outHeightPx;
    if (outPixels > MAX_RASTER_PIXELS) {
        throw new RangeError(
            `renderLabelPage: offset raster ${outWidthPx}×${outHeightPx} = ${outPixels} px exceeds the ${MAX_RASTER_PIXELS}-pixel cap`,
        );
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outWidthPx;
    outCanvas.height = outHeightPx;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error('renderLabelPage: no 2D context for the offset canvas');
    outCtx.fillStyle = 'white';
    outCtx.fillRect(0, 0, outWidthPx, outHeightPx);
    const offsetData = outCtx.createImageData(widthPx, heightPx);
    offsetData.data.set(imageData.data);
    outCtx.putImageData(offsetData, outer ? Math.max(x, 0) : x, outer ? Math.max(y, 0) : y);

    // Read the composed raster back so `rgba` is exactly the final canvas.
    const finalImage = outCtx.getImageData(0, 0, outWidthPx, outHeightPx);
    return {
        rgba: { data: finalImage.data, width: outWidthPx, height: outHeightPx },
        widthPx: outWidthPx,
        heightPx: outHeightPx,
        canvas: outCanvas,
        warnings,
        ...(notices ? { notices } : {}),
    };
};
