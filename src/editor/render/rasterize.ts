import Konva from 'konva';
import { HM_PER_INCH, type RgbaBuffer } from '../../core/render';
import type { ResolvedNode } from './resolve';
import { createKonvaNode } from './konvaFactory';

/**
 * Offscreen rasterization of a resolved scene graph onto a real canvas.
 *
 * **The one raster path** preview and print both run (invariant 7). Resolved
 * nodes are plain-Konva objects in `hm`; this module sizes an offscreen stage in
 * device `px` and applies the `hm → px` scale **once** at the stage level
 * (`dpi / HM_PER_INCH`), so every child composes in hm exactly as `resolve`
 * measured it. A white background covers the full raster.
 *
 * Konva/`createKonvaNode` leave shapes unstyled; v1 documents carry no colour and
 * no fill, so `applyInkDefaults` gives unfilled shapes/text black ink (the
 * documented v1 default). Lines without a fill are stroked.
 *
 * The returned pixels are the payload. `stage.destroy()` frees the Konva layer
 * canvas (Konva's `releaseCanvasOnDestroy` zeroes it), so callers must not keep
 * or read that canvas — `renderLabelPage` builds the final encoder canvas from
 * the quantized RGBA instead (M1).
 *
 * Fonts: `prepareTextFonts` best-effort preloads each resolved family via
 * `document.fonts.load` and then awaits `document.fonts.ready`, all guarded for
 * environments without `document.fonts` (happy-dom).
 */

export interface RasterizeOptions {
    widthPx: number;
    heightPx: number;
    dpi: number;
}

export interface Rasterized {
    /** Pixels read back once, here; the canvas that produced them is already destroyed. */
    imageData: RgbaBuffer;
    widthPx: number;
    heightPx: number;
}

/**
 * Await `document.fonts.ready` when present. Never throws and never rejects the
 * pipeline: a missing/failed font set degrades to the browser's fallback font.
 */
export const awaitFontsReady = async (): Promise<void> => {
    if (typeof document === 'undefined') return;
    const ready = document.fonts?.ready;
    if (ready && typeof (ready as Promise<unknown>).then === 'function') {
        try {
            await ready;
        } catch {
            // A font that failed to load must not break rendering.
        }
    }
};

/** Collect every distinct `fontFamily` used by resolved text nodes. */
const collectFontFamilies = (nodes: readonly ResolvedNode[]): Set<string> => {
    const families = new Set<string>();
    const walk = (list: readonly ResolvedNode[]): void => {
        for (const node of list) {
            if (node.type === 'group') walk(node.children);
            else if (node.type === 'text' && node.fontFamily) families.add(node.fontFamily);
        }
    };
    walk(nodes);
    return families;
};

/**
 * Best-effort preload of every family a resolved tree uses, then await
 * `document.fonts.ready`. Guarded and non-throwing so a missing FontFaceSet or
 * an individual load failure falls back to the browser font.
 */
export const prepareTextFonts = async (nodes: readonly ResolvedNode[]): Promise<void> => {
    if (typeof document !== 'undefined' && typeof document.fonts?.load === 'function') {
        for (const family of collectFontFamilies(nodes)) {
            try {
                await document.fonts.load(`1em ${family}`);
            } catch {
                // Fall back to whatever the browser can supply.
            }
        }
    }
    await awaitFontsReady();
};

/**
 * Give an unstyled plain-Konva node the v1 default ink. Text already defaults to
 * black; filled shape kinds get a black fill; an open line is stroked instead.
 *
 * Open-line strokes use `strokeScaleEnabled(false)` plus a **device-px**
 * `strokeWidth` (≥ 1). Without it Konva interprets the width in hm and the stage
 * scale shrinks a line to ~0.12 px at 300 dpi, which `threshold` then maps to
 * white — lines printed as nothing.
 */
export const DEFAULT_LINE_STROKE_WIDTH = 1;

export const applyInkDefaults = (node: Konva.Node): void => {
    if (node instanceof Konva.Line && !node.closed()) {
        if (!node.stroke()) node.stroke('black');
        node.strokeScaleEnabled(false);
        node.strokeWidth(Math.max(DEFAULT_LINE_STROKE_WIDTH, node.strokeWidth()));
        return;
    }
    if (node instanceof Konva.Shape) {
        if (!node.fill()) node.fill('black');
    }
};

const applyInkDefaultsDeep = (node: Konva.Node): void => {
    applyInkDefaults(node);
    if (node instanceof Konva.Group) {
        for (const child of node.getChildren()) applyInkDefaultsDeep(child);
    }
};

/**
 * Rasterize resolved nodes to device px and return the read-back RGBA. The
 * offscreen stage (and its canvas) is destroyed before returning; only the
 * pixels survive. Deterministic for a fixed node list and options.
 *
 * **Device ratio is forced to 1 for the offscreen render** (save/restore of
 * `Konva.pixelRatio` in a `try/finally`). Konva otherwise builds the layer
 * backing store at `window.devicePixelRatio`, so on a HiDPI display the canvas
 * is `widthPx*DPR` and a `getImageData(0, 0, widthPx, heightPx)` would read only
 * the top-left — overscaled/truncated output. Forcing ratio 1 makes the backing
 * store exactly `widthPx × heightPx`.
 */
export const rasterizeResolved = async (
    nodes: readonly ResolvedNode[],
    opts: RasterizeOptions,
): Promise<Rasterized> => {
    const { widthPx, heightPx, dpi } = opts;
    if (!Number.isFinite(dpi) || dpi <= 0) {
        throw new RangeError(`rasterizeResolved: dpi must be > 0 (got ${dpi})`);
    }
    const scale = dpi / HM_PER_INCH; // hm → px

    await prepareTextFonts(nodes);

    // Force the backing store to 1:1 with the requested raster regardless of the
    // host device ratio. Restored in `finally` so the global never leaks.
    const previousPixelRatio = Konva.pixelRatio;
    Konva.pixelRatio = 1;
    try {
        // Detached, off-screen container: Konva never needs it laid out, and a
        // detached node cannot affect production layout.
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-100000px';
        container.style.top = '0';

        const stage = new Konva.Stage({ container, width: widthPx, height: heightPx });
        stage.scale({ x: scale, y: scale });
        const layer = new Konva.Layer();
        stage.add(layer);

        // White background spans the full raster (sized in hm so the stage scale
        // lands it exactly on widthPx × heightPx).
        layer.add(
            new Konva.Rect({
                x: 0,
                y: 0,
                width: widthPx / scale,
                height: heightPx / scale,
                fill: 'white',
                listening: false,
            }),
        );

        for (const node of nodes) {
            const konva = createKonvaNode(node);
            applyInkDefaultsDeep(konva);
            layer.add(konva);
        }

        stage.draw();

        const canvas = layer.getCanvas()._canvas as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('rasterizeResolved: layer canvas has no 2D context');
        const raw = ctx.getImageData(0, 0, widthPx, heightPx);
        const imageData: RgbaBuffer = { data: raw.data, width: raw.width, height: raw.height };

        // Konva zeroes the layer canvas on destroy (releaseCanvasOnDestroy), so
        // read the pixels first and hand only the buffer back (M1).
        stage.destroy();
        return { imageData, widthPx, heightPx };
    } finally {
        Konva.pixelRatio = previousPixelRatio;
    }
};
