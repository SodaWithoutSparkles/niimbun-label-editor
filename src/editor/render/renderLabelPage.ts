import Konva from 'konva';
import { nodeLookup } from '../../core/doc/derive';
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
import { applyRegionClip } from './clip';
import { createKonvaNode, matrixToKonvaAttrs } from './konvaFactory';
import {
    DEFAULT_LINE_STROKE_WIDTH,
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
 *   → `quantizeRgba` → `applyRegionClip` again → final encoder canvas.
 *
 * The clip runs **both before and after** quantization: pre-quantize so the
 * diffusion sees a white surround, post-quantize so error diffused across the
 * union boundary can never leave ink outside the printable area (M3).
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
}

export interface RenderedLabelPage {
    /** Final 1-bit black/white RGBA (exact `0`/`255` channels). */
    rgba: RgbaBuffer;
    widthPx: number;
    heightPx: number;
    /** A fresh canvas holding the final quantized, clipped page (safe for the encoder). */
    canvas: HTMLCanvasElement;
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

/** Paint a node's actual coverage (glyphs / filled shape / stroked line) in `color`. */
const paintCoverage = (node: Konva.Shape, color: string): void => {
    if (node instanceof Konva.Line && !node.closed()) {
        node.fillEnabled(false);
        node.strokeEnabled(true);
        node.stroke(color);
        // Match `applyInkDefaults`: a device-px stroke, so the mask registers the
        // same line the raster does (a hm stroke would shrink to sub-pixel).
        node.strokeScaleEnabled(false);
        node.strokeWidth(Math.max(DEFAULT_LINE_STROKE_WIDTH, node.strokeWidth()));
        return;
    }
    node.strokeEnabled(false);
    node.fill(color);
};

/**
 * Build the per-object dither **policy mask** (decision 1).
 *
 * Every rendered non-group leaf is painted, in the **same tree order as the
 * raster** (`flattenResolved` pre-order == Konva's draw order), so mask-topmost
 * equals raster-topmost (M2). A leaf whose `resolveQuantizer` yields a policy
 * paints that policy's key colour; an unhinted/no-default leaf paints the global
 * key (mask value `0`), so it overrides any hinted leaf it covers. Pixels no leaf
 * covers also read `0`.
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
            const konva = createKonvaNode(carrier.node);
            // Absolute transform: a leaf inside a group must be painted where it
            // actually lands, not at its group-local position.
            konva.setAttrs(matrixToKonvaAttrs(carrier.node.transform));
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
 * Render a label page to final 1-bit RGBA. The single entry point for both the
 * preview and the print path; only encoding differs downstream (invariant 7).
 */
export const renderLabelPage = async (
    doc: LabelDoc,
    ctx: ResolveContext = {},
    opts: RenderLabelPageOptions = {},
): Promise<RenderedLabelPage> => {
    const nodes = resolve(doc, ctx);
    const { widthPx, heightPx } = rasterDimensions(
        doc.label.backingW,
        doc.label.backingH,
        doc.label.dpi,
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

    const rasterOpts: RasterizeOptions = { widthPx, heightPx, dpi: doc.label.dpi };
    const { imageData } = await rasterizeResolved(nodes, rasterOpts);

    const byId = nodeLookup(doc.nodes);
    const policy = await buildPolicyMask(nodes, byId, { widthPx, heightPx }, doc.label.dpi);

    const hmPerPx = HM_PER_INCH / doc.label.dpi;
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

    // Post-clip: error diffusion can cross the boundary; guarantee blank outside.
    applyRegionClip(imageData, { widthPx, heightPx }, doc.label.regions, hmPerPx);

    // Final encoder canvas — the Konva canvas is gone (M1).
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) throw new Error('renderLabelPage: no 2D context for the encoder canvas');
    const encoded = canvasCtx.createImageData(widthPx, heightPx);
    encoded.data.set(imageData.data);
    canvasCtx.putImageData(encoded, 0, 0);

    return { rgba: imageData, widthPx, heightPx, canvas };
};
