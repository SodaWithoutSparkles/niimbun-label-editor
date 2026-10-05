import type { ImageRef, LabelDoc } from '../../core/doc/types';

/**
 * Shared asset seams for the P5 render pipeline. Interfaces + types ONLY — no
 * logic, no IDB, no Konva. Both the render seam (`prepareAssets`) and the
 * resource-backed providers (`assetProviders`, `fontAssets`) code against these.
 */

/** A decoded, ready-to-draw raster plus its natural pixel size. */
export interface PreparedAsset {
    /** A canvas, ImageBitmap, or HTMLImageElement drawable by Konva. */
    image: CanvasImageSource;
    widthPx: number;
    heightPx: number;
}

/**
 * A generated QR/barcode raster. `canvas` is the bwip-js symbol rendered at an
 * **integer** scale (never resampled); `belowMinModule` reports that the chosen
 * module size is under the scannable minimum (0.25 mm at the render dpi).
 */
export interface GeneratedSymbol {
    canvas: HTMLCanvasElement;
    belowMinModule: boolean;
}

/**
 * A per-leaf asset problem surfaced to the editor so it can badge the node.
 * - `missing`: an image leaf whose resource cannot be found/resolved;
 * - `invalid`: a qr/barcode payload bwip-js rejects;
 * - `too-small`: the symbol generated, but its module is below the print minimum.
 */
export type AssetWarning = 'missing' | 'invalid' | 'too-small';

/** Supplies the raw bytes of a locally-stored resource (IDB `resources`). */
export interface BytesProvider {
    getBytes(resourceId: string): Promise<Uint8Array | null>;
}

/** Registers any imported fonts a document needs before text is rasterized. */
export interface FontProvider {
    ensureFonts(doc: LabelDoc): Promise<void>;
}

/** Dependencies injected into the async asset-preparation step. All optional. */
export interface AssetDeps {
    /** Decodes `AssetRef.local` images from the IDB resource store. */
    images?: BytesProvider;
    /** Registers imported `FontFace`s before text rasterization. */
    fonts?: FontProvider;
    /**
     * Device px per hm used for the image resolution cap: never upscale past the
     * source and never allocate more than the current viewport/print needs.
     * Defaults to the document dpi (the print requirement).
     */
    imageScale?: number;
    /**
     * Effective render dpi. When set (and no explicit `imageScale`), it overrides
     * `doc.label.dpi` for the default device-px-per-hm scale, so a thumbnail
     * render decodes assets at its own resolution. Additive: absent ⇒ today's
     * behaviour (document dpi).
     */
    dpi?: number;
    /**
     * Injectable image decoder. When present, `prepareResolvedAssets` resolves
     * an `ImageRef` through this instead of fetching/decoding its `AssetRef`
     * bytes. Lets tests and embeds supply a prepared raster with no network and
     * no bytes provider.
     */
    resolveImage?: (ref: ImageRef) => PreparedAsset | null | Promise<PreparedAsset | null>;
}
