import type { ImageRef } from '../../core/doc/types';
import type { AssetDeps, PreparedAsset } from './assets';

/**
 * Image engine for the async asset seam (P5 W1).
 *
 * Turns an `ImageRef` (`local`/`inline`/`remote`/`external`) into a decoded,
 * ready-to-draw {@link PreparedAsset}. Everything is guarded and best-effort:
 * a missing bytes provider, an undecodable payload, or a failed fetch resolves
 * to `null` — never throws — so one bad asset can never break a render.
 *
 * Decoding prefers `createImageBitmap(blob)` and falls back to `new Image()` +
 * an object URL. Both are feature-detected so the module behaves across the
 * browser and the `@napi-rs/canvas` test shim.
 */

type CreateImageBitmapFn = (source: Blob) => Promise<ImageBitmap>;

const preparedFromImage = (image: HTMLImageElement): PreparedAsset | null => {
    const widthPx = image.naturalWidth || image.width;
    const heightPx = image.naturalHeight || image.height;
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
        return null;
    }
    return { image, widthPx, heightPx };
};

/**
 * Load an `HTMLImageElement` from any URL (object URL, data URL, http).
 * Resolves to `null` on error. `decode()` is raced with the load event so a
 * host that never fires `load` (e.g. happy-dom on a blob URL) still settles.
 */
const loadImageElement = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
        if (typeof Image === 'undefined') {
            resolve(null);
            return;
        }
        let settled = false;
        const done = (value: HTMLImageElement | null): void => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        let image: HTMLImageElement;
        try {
            image = new Image();
        } catch {
            done(null);
            return;
        }
        image.onload = () => done(image);
        image.onerror = () => done(null);
        try {
            image.src = src;
        } catch {
            done(null);
            return;
        }
        if (typeof image.decode === 'function') {
            // `decode()` resolves once pixels are usable in a real browser. In a
            // DOM shim it can resolve before/without dimensions; then report
            // failure rather than hanging on a `load` event that never comes.
            image
                .decode()
                .then(() => done(preparedFromImage(image) ? image : null))
                .catch(() => done(null));
        }
    });

/**
 * Decode image bytes into a drawable asset. Robust across happy-dom +
 * `@napi-rs/canvas`: tries `createImageBitmap(new Blob(...))`, then falls back
 * to an `Image` element. NEVER throws — returns `null` on any failure.
 */
export const decodeImageBytes = async (
    bytes: Uint8Array,
    mediaType: string,
): Promise<PreparedAsset | null> => {
    try {
        const blob = new Blob([bytes as unknown as BlobPart], { type: mediaType || 'application/octet-stream' });

        const createBitmap = (globalThis as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
        if (typeof createBitmap === 'function') {
            try {
                const bitmap = await createBitmap(blob);
                if (bitmap.width > 0 && bitmap.height > 0) {
                    return { image: bitmap, widthPx: bitmap.width, heightPx: bitmap.height };
                }
            } catch {
                // Fall through to the <img> path.
            }
        }

        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
        let url: string;
        try {
            url = URL.createObjectURL(blob);
        } catch {
            return null;
        }
        try {
            const image = await loadImageElement(url);
            return image ? preparedFromImage(image) : null;
        } finally {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // ignore
            }
        }
    } catch {
        return null;
    }
};

/** Decode an `inline` data URL through the `Image` element (no fetch needed). */
const decodeDataUrl = async (dataUrl: string): Promise<PreparedAsset | null> => {
    const image = await loadImageElement(dataUrl);
    return image ? preparedFromImage(image) : null;
};

/** Hard timeout for a remote image fetch so a hanging URL cannot stall a render. */
export const FETCH_TIMEOUT_MS = 15_000;

/** Refuse to buffer a remote image larger than this (20 MB). */
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/**
 * Fetch remote bytes with a timeout and a size cap. Returns `null` on a missing
 * `fetch`, a non-OK response, a timeout/abort, an oversized body, or any other
 * failure — it never throws and never leaves the render hanging.
 */
const fetchBytes = async (url: string): Promise<Uint8Array | null> => {
    if (typeof fetch !== 'function') return null;
    try {
        const init: RequestInit = {};
        // `AbortSignal.timeout` is not present in every host; guard it and call
        // it bound (some shims require `this`). A host that throws must not skip
        // the fetch.
        try {
            const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal })
                .timeout;
            if (typeof timeout === 'function') {
                init.signal = timeout.call(AbortSignal, FETCH_TIMEOUT_MS);
            }
        } catch {
            // No timeout support: fetch proceeds unguarded.
        }

        const response = await fetch(url, init);
        if (!response.ok) return null;

        const declared = Number(response.headers?.get?.('content-length') ?? '');
        if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) return null;

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_FETCH_BYTES) return null;
        return new Uint8Array(buffer);
    } catch {
        return null;
    }
};

/**
 * Resolve a stored `ImageRef` to a decoded asset. `local` reads bytes from the
 * injected `deps.images` provider, `inline` decodes its data URL, `remote`
 * fetches its URL, and `external` is not carried by the document → `null`.
 * A missing provider/bytes/decoder yields `null`, never a throw.
 */
export const loadImageRef = async (
    ref: ImageRef,
    deps: AssetDeps,
): Promise<PreparedAsset | null> => {
    try {
        switch (ref.source.kind) {
            case 'local': {
                const bytes = await deps.images?.getBytes(ref.source.resourceId);
                if (!bytes) return null;
                return await decodeImageBytes(bytes, ref.source.mediaType);
            }
            case 'inline':
                return await decodeDataUrl(ref.source.dataUrl);
            case 'remote': {
                const bytes = await fetchBytes(ref.source.url);
                if (!bytes) return null;
                return await decodeImageBytes(bytes, ref.source.mediaType);
            }
            case 'external':
                return null;
        }
    } catch {
        return null;
    }
};

/**
 * Apply the resolution cap with a **single aspect-preserving scale**:
 * `scale = min(1, requiredWpx/widthPx, requiredHpx/heightPx)`. When every
 * required axis is at least the source (`scale >= 1`) the asset is returned
 * unchanged — never upscaled. Otherwise the image is drawn down to
 * `round(widthPx*scale) × round(heightPx*scale)` (each ≥ 1 px), so a 1000×100
 * source capped to a 100×100 box becomes 100×10, not a distorted 100×100.
 */
export const capImageAsset = (
    asset: PreparedAsset,
    requiredWpx: number,
    requiredHpx: number,
): PreparedAsset => {
    const scale = Math.min(1, requiredWpx / asset.widthPx, requiredHpx / asset.heightPx);
    if (!Number.isFinite(scale) || scale >= 1) return asset;
    const width = Math.max(1, Math.round(asset.widthPx * scale));
    const height = Math.max(1, Math.round(asset.heightPx * scale));
    if (typeof document === 'undefined') return asset;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return asset;
        // A high-quality downscale preserves more of the source than the default.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(asset.image, 0, 0, width, height);
        return { image: canvas, widthPx: width, heightPx: height };
    } catch {
        // A draw failure (e.g. a cross-origin source) must not break the render.
        return asset;
    }
};
