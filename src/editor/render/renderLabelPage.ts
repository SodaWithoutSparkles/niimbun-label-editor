import Konva from 'konva';
import { nodeLookup } from '../../core/doc/derive';
import { hasFill, hasStroke } from '../../core/doc/objects';
import type { LabelDoc, Node } from '../../core/doc/types';
import {
    classifyFlatRedBlack,
    DEFAULT_GAMMA_BY_STRATEGY,
    DEFAULT_SCREENTONE,
    diffuseRamp,
    diffuseToPalette,
    grayscaleRampPalette,
    HM_PER_INCH,
    MonoColorSpace,
    monoLuminance,
    QUANTIZERS,
    policyKeyOf,
    quantizeRgba,
    rasterDimensions,
    redBlackPalette,
    resolveQuantizer,
    resolveQuantizerParams,
    type ColorSpace,
    type PageColorMode,
    type RasterDimensions,
    type PolicyMask,
    type QuantizerByType,
    type QuantizerDefaults,
    type QuantizerId,
    type QuantizerPolicy,
    type QuantizerPolicies,
    type RgbaBuffer,
    type ScreentoneAngle,
} from '../../core/render';
import type { AssetDeps, AssetWarning, PreparedAsset } from './assets';
import { applyRegionClip } from './clip';
import { createKonvaNode, maskAssetSceneFunc, matrixToKonvaAttrs } from './konvaFactory';
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
 *   → quantize → `invert` → `mirror` → `applyRegionClip` again → `offset`
 *   → final encoder canvas.
 *
 * Page-colour branch (`opts.pageColor`):
 *   - `'mono'` (default) — the pipeline above: per-object 1-bit policies plus
 *     `quantizeRgba`.
 *   - `'grayscale'` — **no** policy mask and no 1-bit quantize; the raster's
 *     BT.601 luminance is diffused as one scalar plane by
 *     {@link diffuseRamp} through the 16-level ramp, so the encoder receives
 *     exact band-centre greys.
 *   - `'redBlack'` — the policy mask is built as in mono, then turned into a
 *     per-pixel **flat mask**: pixels covered by a `threshold` policy (the
 *     global slot included) take the point-op path
 *     ({@link classifyFlatRedBlack}), everything else diffuses through
 *     {@link redBlackPalette}. Flat art stays crisp, images dither, and the
 *     output is exactly `#ffffff` / `#000000` / `#ff0000` (the encoder's
 *     DoubleColor split depends on the exact bytes).
 *
 * `pageColor: 'redBlack'` uses the **page-level** resolved diffuser knobs
 * (gamma/strength/serpentine), not per-node ones: the per-node strategy still
 * selects flat vs diffuse, but in this mode every diffusing pixel shares the
 * page pass. `screentone` and `ostromoukhov` policies are therefore treated as
 * diffusion here (per-ink screentone is deferred).
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
    /**
     * Per-strategy settings defaults (threshold / strength / serpentine / gamma
     * / the screentone knobs), keyed by quantizer id. A node param overrides
     * these; they override the render-level fallbacks below. Absent/empty = the
     * engine defaults, byte-identical to before this option existed.
     */
    quantizerDefaults?: QuantizerDefaults;
    /**
     * Per-object-type default-quantizer overrides (the user setting). A type
     * absent here still resolves through `DEFAULT_POLICY_BY_TYPE`, so an
     * absent/empty map is behaviourally identical to before. `core/` never
     * imports the store — the map is threaded in by store-aware callers.
     */
    defaultQuantizerByType?: QuantizerByType;
    /**
     * Binary threshold forwarded to every quantizer, **underneath** the
     * per-strategy and per-node values. Default 128.
     */
    threshold?: number;
    /** Diffusion strength forwarded to the error-diffusion quantizers. Default 1. */
    strength?: number;
    /** Serpentine scanning forwarded to the diffusers. Default true. */
    serpentine?: boolean;
    /**
     * Tone-curve gamma forwarded to every quantizer, **underneath** the
     * per-strategy and per-node values. Absent, it resolves to the per-strategy
     * default (`DEFAULT_GAMMA_BY_STRATEGY`: 1 for `threshold`, 1.3 for the
     * diffusers) — never to the engine's neutral 1.
     */
    gamma?: number;
    /**
     * Screentone tone levels (2..8) forwarded **underneath** the per-strategy
     * and per-node values. Absent, it resolves to `DEFAULT_SCREENTONE.levels`.
     */
    screentoneLevels?: number;
    /**
     * Screentone pitch in mm (0.2..2.0) forwarded **underneath** the
     * per-strategy and per-node values. Absent, it resolves to
     * `DEFAULT_SCREENTONE.pitchMm`. Snapped at the effective render dpi.
     */
    screentonePitchMm?: number;
    /** Screentone angle forwarded underneath the per-strategy and per-node values. */
    screentoneAngle?: ScreentoneAngle;
    /**
     * Screentone dot-gain bias in screen levels (-1..1) forwarded **underneath**
     * the per-strategy and per-node values. Absent, it resolves to
     * `DEFAULT_SCREENTONE.boldness` (0, neutral).
     */
    screentoneBoldness?: number;
    /** Per-pixel projection. Defaults to Mono (the only v1 color space). */
    colorSpace?: ColorSpace;
    /**
     * Print-time page colour. Absent = `'mono'` (the 1-bit path, byte-identical).
     *
     * `'grayscale'` skips the per-object 1-bit policies and diffuses the
     * raster's BT.601 luminance as one scalar plane through the 16-level ramp.
     * `'redBlack'` keeps the policy
     * mask but uses it only to split flat (threshold) pixels — crisp exact
     * palette entries — from diffused ones, through the two-ink palette.
     */
    pageColor?: PageColorMode;
    /**
     * Async asset dependencies (image bytes, fonts, resolution cap). When
     * present, image/qr/barcode leaves are prepared first; absent, those leaves
     * simply draw nothing.
     */
    assets?: AssetDeps;
    /**
     * Effective render dpi. Resolution chain: `opts.dpi` → `opts.assets?.dpi`
     * → the label's dpi hint (`doc.label.dpi`). Drives the raster dimensions,
     * the `hm → px` stage scale, `hmPerPx` and the policy-mask scale, so
     * everything downstream stays on one dpi. Thumbnails render at ~100 dpi
     * through this same path (O1).
     */
    dpi?: number;
    /**
     * Post-quantize: invert luminance while keeping hue. For neutral pixels
     * this is exactly `v → 255 - v` (black ↔ white); palette colours keep
     * their hue (red stays red, never cyan).
     */
    invert?: boolean;
    /** Post-quantize: flip the raster horizontally. */
    mirror?: boolean;
    /**
     * Applied last, on a **fresh** canvas: shift the raster by device px at the
     * effective dpi. `inner` keeps the raster size (`putImageData` at `x`/`y`);
     * `outer` expands by `|x|`/`|y|` and places the image at `max(x,0)`/`max(y,0)`.
     */
    offset?: { x: number; y: number; type: 'inner' | 'outer' };
    /**
     * Printer **printhead width in hm** (hundredths of a millimetre). When the
     * raster's head-axis size exceeds it — width for `top`/`bottom`, height for
     * `left`/`right`, matching `printheadOverflow` — the final raster is cropped
     * on that axis (left/top aligned) to the head width. The crop is an exact
     * 1:1 pixel copy (no resampling), so kept pixels stay byte-identical.
     *
     * Applied **after** the offset stage, on both return paths. This is the
     * red/black print workaround for D-77 (the library trims the packet tail to
     * the printable width); callers enable it per page colour. Absent = today's
     * render, byte-identical. Invalid (non-finite, `<= 0`) throws `RangeError`.
     */
    maxHeadHm?: number;
}

export interface RenderedLabelPage {
    /**
     * Number of nodes that used the global policy after exceeding the eight-policy
     * palette. Absent in grayscale, which builds no policy mask.
     */
    policyOverflowCount?: number;
    /**
     * Final palette RGBA. Mono yields exact `0`/`255` channels (1-bit); grayscale
     * yields the exact band-centre bytes of the 16-level ramp; red/black yields
     * exactly `#ffffff`, `#000000` or `#ff0000`.
     */
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


/** Refuse to allocate absurd rasters (invariant 9). Common canvas limit is ~16M px. */
export const MAX_RASTER_PIXELS = 16_000_000;

/** The offset the raster applies last: device px + how they grow the canvas. */
export interface RasterOffset {
    x: number;
    y: number;
    type: 'inner' | 'outer';
}

/**
 * Raster dimensions **after** the offset step. `outer` grows the canvas by the
 * absolute offset per axis (the extra area is filled white); `inner` keeps the
 * base size (`putImageData` clips). Pure and headless, so the print dialog's
 * raster-cap guard can pre-flight exactly the numbers this module throws on.
 */
export const offsetRasterDimensions = (
    widthPx: number,
    heightPx: number,
    offset: RasterOffset,
): RasterDimensions => {
    const outer = offset.type === 'outer';
    return {
        widthPx: outer ? widthPx + Math.abs(offset.x) : widthPx,
        heightPx: outer ? heightPx + Math.abs(offset.y) : heightPx,
    };
};

/** The raster after the D-77 head-width crop. */
interface HeadCroppedRaster {
    rgba: RgbaBuffer;
    widthPx: number;
    heightPx: number;
    canvas: HTMLCanvasElement;
}

/**
 * Crop a composed raster to `limitPx` on the **printhead axis** (D-77 workaround).
 *
 * The head spans the raster's cross-feed axis, exactly like
 * {@link printheadOverflow}: `top`/`bottom` feed the raster unrotated, so the
 * head spans the width and the kept region is the **left columns**;
 * `left`/`right` feed it sideways, so the head spans the height and the kept
 * region is the **top rows**. Left/top aligned, exact 1:1 byte copy — the kept
 * pixels are identical to the uncropped render, never resampled.
 *
 * Returns `undefined` when the raster already fits (no allocation, so the
 * absent/fitting paths stay byte-identical).
 */
const cropHeadAxis = (
    rgba: RgbaBuffer,
    direction: LabelDoc['label']['printDirection'],
    limitPx: number,
): HeadCroppedRaster | undefined => {
    const sideways = direction === 'left' || direction === 'right';
    const { width: sourceWidth, height: sourceHeight } = rgba;
    const axisPx = sideways ? sourceHeight : sourceWidth;
    if (axisPx <= limitPx) return undefined;

    const widthPx = sideways ? sourceWidth : limitPx;
    const heightPx = sideways ? limitPx : sourceHeight;
    const source = rgba.data;
    const rowBytes = widthPx * 4;
    const data = new Uint8ClampedArray(widthPx * heightPx * 4);
    for (let y = 0; y < heightPx; y++) {
        const sourceOffset = y * sourceWidth * 4;
        data.set(source.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
    }

    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('renderLabelPage: no 2D context for the head-crop canvas');
    const image = ctx.createImageData(widthPx, heightPx);
    image.data.set(data);
    ctx.putImageData(image, 0, 0);

    return { rgba: { data, width: widthPx, height: heightPx }, widthPx, heightPx, canvas };
};

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
 * Text fills only its glyphs, and only when the authored fill deposits ink. A
 * shape mirrors its resolved style: the stroke and the fill are each painted
 * only when they deposit ink — a `'transparent'` (no-fill or no-stroke) shape
 * must claim just the parts the raster actually deposits, or the mask would
 * cover pixels the raster leaves white (M2: mask-topmost == raster-topmost).
 */
const paintCoverage = (node: Konva.Node, color: string): void => {
    // A `cut` text is drawn inside a clipping group (Konva's `wrap: 'none'`
    // does not clip), so the mask must paint its glyphs through the group. The
    // group's own clip applies to the mask draw too, keeping mask coverage ==
    // raster ink at the cut edge.
    if (node instanceof Konva.Group) {
        for (const child of node.getChildren()) paintCoverage(child, color);
        return;
    }
    if (node instanceof Konva.Text) {
        node.strokeEnabled(false);
        // Text owns only the glyphs it actually inks. A transparent (or absent)
        // fill deposits nothing, so it must leave the pixels beneath to the leaf
        // below — same presence rule as a shape's fill (see `hasFill`).
        if (hasFill(node.fill() as string | undefined)) node.fill(color);
        else node.fillEnabled(false);
        return;
    }
    const shape = node as Konva.Shape;
    // NOTE: `hasFill` is a *presence* test, not an *ink* test: a light `#eeeeee`
    // or low-alpha `#00000040` fill is claimed at full mask coverage while
    // `threshold` may render it white. Pre-existing; tracked as follow-up debt.
    if (hasFill(shape.fill() as string | undefined)) shape.fill(color);
    else shape.fillEnabled(false);
    // Symmetric no-stroke rule: an invisible stroke must not claim a band.
    if (hasStroke(shape.stroke() as string | undefined)) {
        shape.strokeEnabled(true);
        shape.stroke(color);
    } else {
        shape.strokeEnabled(false);
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
export interface PolicyMaskResult {
    mask: PolicyMask;
    policies: QuantizerPolicies;
    overflowCount: number;
}

/**
 * Render-level fallbacks for a policy's params, applied under the per-strategy
 * settings defaults and under any per-node value.
 */
export interface PolicyParamDefaults {
    threshold?: number;
    strength?: number;
    serpentine?: boolean;
    gamma?: number;
    screentoneLevels?: number;
    screentonePitchMm?: number;
    screentoneAngle?: ScreentoneAngle;
    screentoneBoldness?: number;
    /** Per-strategy settings defaults (see `RenderLabelPageOptions`). */
    quantizerDefaults?: QuantizerDefaults;
    /** Per-object-type default-quantizer override map (see `RenderLabelPageOptions`). */
    defaultQuantizerByType?: QuantizerByType;
}

export const buildPolicyMask = async (
    nodes: readonly ResolvedNode[],
    byId: ReadonlyMap<string, Node>,
    dims: { widthPx: number; heightPx: number },
    dpi: number,
    assets?: ReadonlyMap<string, PreparedAsset>,
    defaults?: PolicyParamDefaults,
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

    const policiesByKey = new Map<
        string,
        {
            id: QuantizerId;
            options: {
                threshold: number;
                strength: number;
                serpentine?: boolean;
                gamma: number;
                screentoneLevels: number;
                screentonePitchMm: number;
                screentoneAngle: ScreentoneAngle;
                screentoneBoldness: number;
            };
            index: number;
        }
    >();
    const carriers: { node: ResolvedNode; value: number }[] = [];
    let overflowCount = 0;

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
            (node.type === 'image' ||
                node.type === 'qr' ||
                node.type === 'barcode' ||
                node.type === 'code') &&
            !assets?.get(node.id)
        ) {
            continue;
        }
        const policy = resolveQuantizer(
            { type: source.type, quantizerHint: source.quantizerHint },
            defaults?.defaultQuantizerByType,
        );
        if (!policy) {
            carriers.push({ node, value: 0 });
            continue;
        }
        // Resolve the **effective** params before keying: node → strategy settings
        // default → render fallback → engine default. `serpentine` is included so
        // two nodes differing only in serpentine get distinct slots (D-57(b)),
        // and `gamma` for the same reason.
        const resolved = resolveQuantizerParams(
            source.quantizerParams,
            policy,
            defaults?.quantizerDefaults,
            {
                threshold: defaults?.threshold,
                strength: defaults?.strength,
                serpentine: defaults?.serpentine,
                gamma: defaults?.gamma,
                screentoneLevels: defaults?.screentoneLevels,
                screentonePitchMm: defaults?.screentonePitchMm,
                screentoneAngle: defaults?.screentoneAngle,
                screentoneBoldness: defaults?.screentoneBoldness,
            },
        );
        const key = policyKeyOf(policy, resolved);
        let entry = policiesByKey.get(key);
        if (entry === undefined) {
            if (policiesByKey.size >= KEY_COLORS.length) {
                overflowCount++;
                carriers.push({ node, value: 0 });
                continue;
            }
            entry = {
                id: policy,
                options: {
                    // Every pixel-changing knob is explicit, both `true` and
                    // `false`, so no masked policy can inherit the base pass's
                    // value by omitting the key (the base is merged *under* each
                    // policy's own options). Since gamma differs **per strategy**,
                    // an omission here would silently apply the global pass's
                    // curve. Dedup is by `policyKeyOf`, not by `options`, so
                    // param-less nodes still share one slot.
                    threshold: resolved.threshold,
                    strength: resolved.strength,
                    serpentine: resolved.serpentine,
                    gamma: resolved.gamma,
                    // Screentone knobs are explicit for the same reason (P13):
                    // the base options carry the *global* strategy's values, so
                    // an omitted key here would silently apply them to this
                    // policy. `dpi` is a render constant inherited from the base.
                    screentoneLevels: resolved.screentoneLevels,
                    screentonePitchMm: resolved.screentonePitchMm,
                    screentoneAngle: resolved.screentoneAngle,
                    screentoneBoldness: resolved.screentoneBoldness,
                },
                index: policiesByKey.size + 1,
            };
            policiesByKey.set(key, entry);
        }
        carriers.push({ node, value: entry.index });
    }
    if (policiesByKey.size === 0) return undefined;

    const policyEntries = [...policiesByKey.values()];
    // Value k → key colour; index 0 is the global key.
    const keyColors: (readonly [number, number, number])[] = [
        GLOBAL_KEY,
        ...KEY_COLORS.slice(0, policyEntries.length),
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
            if (
                leaf.type === 'image' ||
                leaf.type === 'qr' ||
                leaf.type === 'barcode' ||
                leaf.type === 'code'
            ) {
                // Fix A (P2): claim only the asset's **visible ink**, not its whole
                // drawn rect. Transparent pixels (a `fill: 'transparent'` symbol's
                // light modules + quiet zone, or a transparent-PNG photo) draw
                // nothing here, so the leaf below keeps its policy — the same
                // coverage the raster produces. An opaque `fill` makes the whole
                // rect opaque and it legitimately claims all of it.
                const asset = assets?.get(leaf.id);
                if (!asset) continue;
                const fit =
                    leaf.type === 'image'
                        ? leaf.fit
                        : leaf.type === 'barcode'
                          ? 'stretch'
                          : 'contain';
                // Group carries the absolute transform; the stencil keeps the
                // local drawn-rect offset as a child so the two compose (setting
                // both on one node would let the transform's x/y overwrite the
                // offset).
                const box = new Konva.Group();
                box.setAttrs(attrs);
                box.add(
                    new Konva.Shape({
                        listening: false,
                        sceneFunc: maskAssetSceneFunc,
                        mask: {
                            asset,
                            boxW: leaf.w,
                            boxH: leaf.h,
                            fit,
                            color: rgb(keyColors[carrier.value]!),
                            symbol: leaf.type !== 'image',
                        },
                    }),
                );
                layer.add(box);
                continue;
            }
            const konva = createKonvaNode(leaf, assets);
            konva.setAttrs(attrs);
            paintCoverage(konva, rgb(keyColors[carrier.value]!));
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

        const policies: Map<number, QuantizerPolicy> = new Map(
            policyEntries.map(({ id, options, index }) => [
                index,
                { quantizer: QUANTIZERS[id], ...(options ? { options } : {}) },
            ] as const),
        );
        return {
            mask: { data: mask, width: widthPx, height: heightPx },
            policies,
            overflowCount,
        };
    } finally {
        Konva.pixelRatio = previousPixelRatio;
    }
};

/**
 * Build the **global** pass options: the base `QuantizeOptions` for the whole
 * frame (policy index `0`) and the fallback merged *under* every masked policy's
 * own options. The global quantizer's per-strategy settings default applies
 * here, then the render-level fallback. `serpentine` and `gamma` resolve like
 * the others, so a per-strategy default reaches a global diffuser.
 *
 * `gamma` is **always** emitted (never left to the engine's neutral default):
 * the non-neutral diffuser default lives in the policy layer, so an omitted
 * gamma would silently apply the wrong curve to a global diffuser pass. The
 * screentone knobs are emitted for the same reason (their render defaults live
 * in `DEFAULT_SCREENTONE`), and `dpi` — the effective render dpi — is a
 * render-level constant that every masked policy inherits from this base.
 *
 * This base still sits **under** every masked policy, but nothing leaks: with
 * every policy carrying its own explicit knobs, a policy can never inherit the
 * base's value by omission.
 */
const buildQuantizeOptions = (
    opts: RenderLabelPageOptions,
    dpi: number,
): NonNullable<Parameters<typeof quantizeRgba>[2]> => {
    const colorSpace = opts.colorSpace ?? MonoColorSpace;
    const globalId = opts.quantizer ?? 'threshold';
    const strategyDefaults = opts.quantizerDefaults?.[globalId];
    const out: NonNullable<Parameters<typeof quantizeRgba>[2]> = { colorSpace };
    const threshold = strategyDefaults?.threshold ?? opts.threshold;
    const strength = strategyDefaults?.strength ?? opts.strength;
    const serpentine = strategyDefaults?.serpentine ?? opts.serpentine;
    const gamma = strategyDefaults?.gamma ?? opts.gamma ?? DEFAULT_GAMMA_BY_STRATEGY[globalId];
    if (threshold !== undefined) out.threshold = threshold;
    if (strength !== undefined) out.strength = strength;
    if (serpentine !== undefined) out.serpentine = serpentine;
    out.gamma = gamma;
    // The effective render dpi: a render-level constant, inherited by every
    // masked policy from this base (never duplicated per policy).
    out.dpi = dpi;
    // Screentone knobs always resolve, so a global `screentone` pass never falls
    // back to the engine's neutral (2 levels) instead of the policy default.
    out.screentoneLevels =
        strategyDefaults?.screentoneLevels ?? opts.screentoneLevels ?? DEFAULT_SCREENTONE.levels;
    out.screentonePitchMm =
        strategyDefaults?.screentonePitchMm ??
        opts.screentonePitchMm ??
        DEFAULT_SCREENTONE.pitchMm;
    out.screentoneAngle =
        strategyDefaults?.screentoneAngle ?? opts.screentoneAngle ?? DEFAULT_SCREENTONE.angle;
    out.screentoneBoldness =
        strategyDefaults?.screentoneBoldness ??
        opts.screentoneBoldness ??
        DEFAULT_SCREENTONE.boldness;
    return out;
};

/**
 * Post-quantize invert: invert **luminance** and keep hue, instead of flipping
 * every channel.
 *
 * The input domain is post-quantize: every pixel is already an exact palette
 * colour — black, a grayscale-ramp level, or `#ff0000` — never an arbitrary RGB
 * triple.
 *
 * For a neutral pixel this is exactly the old `v → 255 - v`: `L = v`, so the
 * scale `(255 - L) / L` turns `v` into `255 - v`, and the existing 1-bit output
 * stays **byte-identical** — the mono goldens are unaffected. Alpha (opacity)
 * is never touched, so the raster stays opaque; the reference `effects.invert`
 * only touches the colour channels.
 *
 * A per-channel flip would be wrong once pixels are not R=G=B: it maps
 * `#ff0000` to `#00ffff` (cyan), and cyan is not a printable ink — thermal red
 * is heat-selected, not a subtractive primary. Scaling all three channels by
 * one factor preserves hue and saturation, so red stays red: `L(#ff0000) ≈ 76`,
 * `scale ≈ 2.34`, R overflows and clamps at 255, G/B stay 0. Black and white
 * still swap exactly (`L === 0` → white, the division guard; `L === 255` →
 * all channels 0).
 *
 * Exact for the 16-level grayscale ramp: the band centre `255 - 17k` has
 * `L = 255 - 17k`, so it scales to `17k`, which
 * `ImageEncoder.colorToGrayLevel` maps back to level `15 - k`. A grayscale
 * negative is therefore exact at every level, not approximated — no rounding
 * slack anywhere in the ramp.
 *
 * Exported so the pigment goldens can call it directly.
 */
export const invertRgb = (rgba: RgbaBuffer): void => {
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const luminance = monoLuminance(r, g, b);
        if (luminance === 0) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            continue;
        }
        // One scale factor for all three channels: hue and saturation survive.
        // The clamps/rounding happen in the `Uint8ClampedArray` write.
        const scale = (255 - luminance) / luminance;
        data[i] = r * scale;
        data[i + 1] = g * scale;
        data[i + 2] = b * scale;
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
 * Count ink (non-paper) pixels. Only the mirror path pays for this: the region
 * clip can silently erase ink the flip moved outside the printable union, so
 * the before/after counts become a {@link RenderNotice} instead of vanishing.
 *
 * "Ink" means **not paper-white**: `r !== 255 || g !== 255 || b !== 255`, with
 * alpha ignored. After quantization every pixel is an exact palette colour —
 * black, a grey ramp level, or `#ff0000` — and all of those deposit pigment, so
 * the paper test is exact and needs no threshold to calibrate.
 *
 * The old red-channel test (`r < 128`) was a mono-only artifact: it assumed ink
 * is neutral, so red (`r = 255`) counted as paper and vanished from the notice.
 * Every post-quantize pixel is an exact palette colour, so "not white"
 * classifies all inks correctly without a luminance test. Alpha is ignored on
 * purpose: it is opacity metadata, never pigment.
 *
 * Exported so the pigment goldens can call it directly.
 */
export const countInkPx = (rgba: RgbaBuffer): number => {
    const { data } = rgba;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) count++;
    }
    return count;
};

/**
 * Everything the render path produces **before** quantization: the resolved
 * scene, the effective dpi and raster dimensions, the prepared assets and their
 * warnings, and the colour `imageData` the rasterizer read back.
 *
 * The one prelude shared by the print path (`renderLabelPage`) and the colour
 * path (`renderDocPreview` in `docThumbnail.ts`), so the two can never drift on
 * dpi handling, raster limits or asset preparation.
 */
export interface BasePage {
    dpi: number;
    nodes: ResolvedNode[];
    widthPx: number;
    heightPx: number;
    imageData: RgbaBuffer;
    assets: ReadonlyMap<string, PreparedAsset>;
    warnings?: ReadonlyMap<string, AssetWarning>;
}

/**
 * Resolve, pre-flight and rasterize a document to **colour** RGBA at `opts.dpi`
 * (chain: `opts.dpi` → `opts.assets?.dpi` → `doc.label.dpi`). This is exactly
 * the pre-quantize prelude of {@link renderLabelPage}; callers that want the
 * printed 1-bit page continue into the mask/quantize/override stages there.
 */
export const renderPageBase = async (
    doc: LabelDoc,
    ctx: ResolveContext = {},
    opts: { dpi?: number; assets?: AssetDeps } = {},
): Promise<BasePage> => {
    // Validate the effective dpi **before** resolve so a bad `opts.dpi` cannot
    // pay a full resolve/template pass (invariant 9). A caller-supplied
    // `assets.dpi` is honoured, then the label's dpi hint (`doc.label.dpi`).
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
    // the full target dpi (additive: an explicit `assets.imageScale` still
    // wins; absent `dpi`, `prepareAssets` falls back to `doc.label.dpi`).
    const assetDeps: AssetDeps = { ...(opts.assets ?? {}), dpi };
    const { assets, warnings } = await prepareResolvedAssets(nodes, doc, assetDeps);

    const rasterOpts: RasterizeOptions = { widthPx, heightPx, dpi };
    const { imageData } = await rasterizeResolved(nodes, rasterOpts, assets);

    return { dpi, nodes, widthPx, heightPx, imageData, assets, warnings };
};

/**
 * Render a label page to final palette RGBA (1-bit mono by default, 16-level
 * grayscale when `pageColor: 'grayscale'`). The single entry point for both the
 * preview and the print path; only encoding differs downstream (invariant 7).
 */
export const renderLabelPage = async (
    doc: LabelDoc,
    ctx: ResolveContext = {},
    opts: RenderLabelPageOptions = {},
): Promise<RenderedLabelPage> => {
    // Validate the head clamp before resolve/rasterize: a bad value must fail
    // cheaply, exactly like a bad dpi (invariant 9).
    const maxHeadHm = opts.maxHeadHm;
    if (maxHeadHm !== undefined && (!Number.isFinite(maxHeadHm) || maxHeadHm <= 0)) {
        throw new RangeError(`renderLabelPage: maxHeadHm must be > 0 (got ${maxHeadHm})`);
    }

    const {
        dpi,
        nodes,
        widthPx,
        heightPx,
        imageData,
        assets,
        warnings,
    } = await renderPageBase(doc, ctx, {
        ...(opts.dpi !== undefined ? { dpi: opts.dpi } : {}),
        ...(opts.assets !== undefined ? { assets: opts.assets } : {}),
    });

    // Page colour dispatch. Grayscale owns the raster's palette mapping end to
    // end, so it skips the per-object policy mask entirely. Mono and red/black
    // both build it: mono runs one 1-bit pass per slot, red/black only reads the
    // slots to decide which pixels are flat point ops.
    const pageColor = opts.pageColor ?? 'mono';

    // D-77 head-width clamp: the printhead spans a whole number of device dots
    // at the effective render dpi. A sub-pixel width cannot be cropped to.
    const headLimitPx =
        maxHeadHm === undefined ? undefined : Math.round((maxHeadHm * dpi) / HM_PER_INCH);
    if (headLimitPx !== undefined && headLimitPx < 1) {
        throw new RangeError(
            `renderLabelPage: maxHeadHm is narrower than one device pixel at ${dpi} dpi (got ${maxHeadHm})`,
        );
    }

    const byId = nodeLookup(doc.nodes);
    const policy =
        pageColor !== 'grayscale'
            ? await buildPolicyMask(nodes, byId, { widthPx, heightPx }, dpi, assets, {
                  threshold: opts.threshold,
                  strength: opts.strength,
                  serpentine: opts.serpentine,
                  gamma: opts.gamma,
                  screentoneLevels: opts.screentoneLevels,
                  screentonePitchMm: opts.screentonePitchMm,
                  screentoneAngle: opts.screentoneAngle,
                  screentoneBoldness: opts.screentoneBoldness,
                  quantizerDefaults: opts.quantizerDefaults,
                  defaultQuantizerByType: opts.defaultQuantizerByType,
              })
            : undefined;

    const hmPerPx = HM_PER_INCH / dpi;
    // Pre-clip: the diffusion pass sees a white surround outside the union.
    applyRegionClip(imageData, { widthPx, heightPx }, doc.label.regions, hmPerPx);

    const quantizeOptions = buildQuantizeOptions(opts, dpi);
    if (pageColor === 'grayscale') {
        // One scalar-luminance pass over the raster: a neutral ramp has no
        // chroma sink, so diffusing one luminance plane (rather than an RGB
        // error vector) is what keeps saturated sources at their own tone. The
        // diffuser knobs come from the selected global quantizer's effective
        // settings, so the render-level gamma/strength/serpentine still apply;
        // the default `threshold` strategy resolves to the neutral gamma 1.
        diffuseRamp(imageData, grayscaleRampPalette(), {
            gamma: quantizeOptions.gamma,
            strength: quantizeOptions.strength,
            serpentine: quantizeOptions.serpentine,
        });
    } else if (pageColor === 'redBlack') {
        // Per-slot flat/diffuse classification: slot 0 is the global strategy,
        // every masked slot is its own resolved policy. `threshold` is the
        // point-op path (flat art); every diffuser — and, deliberately,
        // `screentone`/`ostromoukhov` in this mode — diffs through the two-ink
        // palette.
        const flatBySlot: boolean[] = [(opts.quantizer ?? 'threshold') === 'threshold'];
        if (policy) {
            for (const [index, entry] of policy.policies) {
                flatBySlot[index] =
                    typeof entry === 'function'
                        ? entry === QUANTIZERS.threshold
                        : entry.quantizer === QUANTIZERS.threshold;
            }
        }

        // One flag per device pixel (`0` = diffuse, `1` = flat). Uncovered
        // pixels read mask slot 0, i.e. the global strategy.
        const pixelCount = widthPx * heightPx;
        const flat = new Uint8Array(pixelCount);
        if (policy) {
            const maskData = policy.mask.data;
            for (let p = 0; p < pixelCount; p++) {
                if (flatBySlot[maskData[p]]) flat[p] = 1;
            }
        } else if (flatBySlot[0]) {
            flat.fill(1);
        }

        // Flat pixels classify the raw source bytes with the same gamma and
        // cutoff the global strategy resolves, so authored red is exact and
        // mid-greys do not turn into dither noise.
        const resolvedThreshold = quantizeOptions.threshold ?? 128;
        const resolvedGamma = quantizeOptions.gamma;
        diffuseToPalette(imageData, redBlackPalette(), {
            gamma: resolvedGamma,
            strength: quantizeOptions.strength,
            serpentine: quantizeOptions.serpentine,
            flat,
            flatNearest: (r, g, b) =>
                classifyFlatRedBlack(r, g, b, resolvedThreshold, resolvedGamma),
        });
    } else {
        quantizeRgba(
            imageData,
            {
                globalQuantizer: QUANTIZERS[opts.quantizer ?? 'threshold'],
                ...(policy ? { policies: policy.policies, mask: policy.mask } : {}),
                colorSpace: opts.colorSpace ?? MonoColorSpace,
            },
            quantizeOptions,
        );
    }

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
    // raster (same `canvas` identity). The D-77 head clamp still applies, on a
    // fresh cropped canvas.
    if (!offset || (offset.x === 0 && offset.y === 0)) {
        const base: RenderedLabelPage = {
            rgba: imageData,
            widthPx,
            heightPx,
            canvas,
            warnings,
            ...(policy?.overflowCount ? { policyOverflowCount: policy.overflowCount } : {}),
            ...(notices ? { notices } : {}),
        };
        const cropped =
            headLimitPx === undefined
                ? undefined
                : cropHeadAxis(imageData, doc.label.printDirection, headLimitPx);
        return cropped === undefined ? base : { ...base, ...cropped };
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
    const { widthPx: outWidthPx, heightPx: outHeightPx } = offsetRasterDimensions(
        widthPx,
        heightPx,
        offset,
    );

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
    const base: RenderedLabelPage = {
        rgba: { data: finalImage.data, width: outWidthPx, height: outHeightPx },
        widthPx: outWidthPx,
        heightPx: outHeightPx,
        canvas: outCanvas,
        warnings,
        ...(policy?.overflowCount ? { policyOverflowCount: policy.overflowCount } : {}),
        ...(notices ? { notices } : {}),
    };
    // Head clamp last: crop the composed (offset-expanded) raster on the head
    // axis so preview == the bytes the printer actually receives.
    const cropped =
        headLimitPx === undefined
            ? undefined
            : cropHeadAxis(base.rgba, doc.label.printDirection, headLimitPx);
    return cropped === undefined ? base : { ...base, ...cropped };
};
