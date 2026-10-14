import type { FontRef, ImageRef } from '../core/doc/types';
import type { ResourceRecord, ResourceRepo } from '../data/resourceRepo';
import { sha256Hex } from '../data/hash';
import { decodeImageBytes } from './render/imageAssets';

/**
 * Import a `File`/URL into a document asset reference (P5 §2.3, W4).
 *
 * Import is the **single** place a fingerprint is computed: bytes → SHA-256 →
 * stored once on the `AssetRef.local`/`FontRef`, never re-hashed. Images are
 * decoded once to capture natural pixel dimensions; fonts are not decoded (the
 * browser owns font parsing at `FontFace` load time).
 *
 * Provenance follows the locked decision: a file upload writes `local` bytes to
 * the `resources` IDB store, while a URL import records `remote` provenance and
 * writes nothing — the URL is fetched again at render time. `inline`/`external`
 * are P8 export policy and are never produced here.
 */

/** Fresh asset id: `crypto.randomUUID`, with the same fallback as `newLabelId`. */
export const newResourceId = (): string => {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return cryptoObj.randomUUID();
    }
    return `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/** Last path segment of a URL/filename, ignoring any query/hash. */
const basename = (url: string): string => {
    const withoutQuery = url.split(/[?#]/, 1)[0] ?? url;
    const segments = withoutQuery.split('/');
    const last = segments[segments.length - 1] ?? '';
    return last.length > 0 ? last : url;
};

/** Filename without its final extension (`My Font.ttf` → `My Font`). */
const stripExtension = (filename: string): string => {
    const base = basename(filename);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
};

const FONT_MEDIA_TYPES: Record<string, string> = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
    ttc: 'font/collection',
    eot: 'application/vnd.ms-fontobject',
};

/** Font MIME from the filename extension; `application/octet-stream` when unknown. */
const guessFontMediaType = (filename: string): string => {
    const base = basename(filename);
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
    return FONT_MEDIA_TYPES[ext] ?? 'application/octet-stream';
};

export interface ImportImageOptions {
    name?: string;
    alt?: string;
}

export interface ImportFontOptions extends ImportImageOptions {
    familyName?: string;
}

export interface ImportedImage {
    ref: ImageRef;
    bytes: Uint8Array;
}

export interface ImportedFont {
    ref: FontRef;
    bytes: Uint8Array;
}

/**
 * Import an image file: compute bytes + fingerprint, decode natural size, store
 * the bytes, and return a `local`-provenance `ImageRef` whose `imageId` is the
 * resource key.
 *
 * @throws {Error} when the bytes cannot be decoded (unsupported/corrupt image);
 *   the caller surfaces a visible import failure rather than storing a broken ref.
 */
export const importImageFile = async (
    file: File,
    repo: ResourceRepo,
    opts: ImportImageOptions = {},
): Promise<ImportedImage> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = file.type || 'application/octet-stream';
    const fingerprint = await sha256Hex(bytes);

    const decoded = await decodeImageBytes(bytes, mediaType);
    if (!decoded) {
        throw new Error(`importImageFile: could not decode image "${file.name}"`);
    }

    // `imageId` and the IDB resource key are the same id: the ref is the lookup.
    const resourceId = newResourceId();
    // Persist display metadata alongside the bytes (phase 9, D2) so the media
    // gallery can name/dimension a resource without decoding it again.
    const name = opts.name ?? file.name;
    await repo.put({
        id: resourceId,
        mediaType,
        name,
        widthPx: decoded.widthPx,
        heightPx: decoded.heightPx,
        bytes,
    });

    const ref: ImageRef = {
        imageId: resourceId,
        name,
        ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
        source: { kind: 'local', mediaType, resourceId, fingerprint },
        widthPx: decoded.widthPx,
        heightPx: decoded.heightPx,
    };
    return { ref, bytes };
};

/**
 * Import an image URL as `remote` provenance: fetch → decode natural size, but
 * **write nothing to IDB** (the URL is re-fetched at render time). A fresh
 * `imageId` still identifies the ref inside the document.
 *
 * @throws {Error} on a failed fetch or undecodable payload.
 */
export const importImageUrl = async (
    url: string,
    opts: ImportImageOptions = {},
): Promise<{ ref: ImageRef }> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`importImageUrl: fetch failed (${response.status}) for ${url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mediaType =
        response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';

    const decoded = await decodeImageBytes(bytes, mediaType);
    if (!decoded) {
        throw new Error(`importImageUrl: could not decode image at ${url}`);
    }

    const ref: ImageRef = {
        imageId: newResourceId(),
        name: opts.name ?? basename(url),
        ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
        source: { kind: 'remote', mediaType, url },
        widthPx: decoded.widthPx,
        heightPx: decoded.heightPx,
    };
    return { ref };
};

/**
 * Import a font file: compute bytes + fingerprint, store the bytes, and return
 * an `imported` `FontRef`. `familyName` defaults to the filename without its
 * extension (the user can still rename it in the inspector).
 */
export const importFontFile = async (
    file: File,
    repo: ResourceRepo,
    opts: ImportFontOptions = {},
): Promise<ImportedFont> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = file.type || guessFontMediaType(file.name);
    const fingerprint = await sha256Hex(bytes);

    const fontId = newResourceId();
    // The record's display name mirrors the ref's family name (phase 9, D2);
    // fonts carry no pixel dimensions.
    const familyName = opts.familyName ?? stripExtension(file.name);
    await repo.put({ id: fontId, mediaType, name: familyName, bytes });

    const ref: FontRef = {
        fontId,
        familyName,
        name: opts.name ?? file.name,
        ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
        source: {
            kind: 'imported',
            asset: { kind: 'local', mediaType, resourceId: fontId, fingerprint },
            fingerprint,
        },
    };
    return { ref, bytes };
};

/**
 * "Import an existing resource" choice (phase 9, W3):
 *
 * - `reference` — point the new ref at the **shared** stored record; deleting
 *   the source document never touches it (the `resources` store is not part of
 *   document delete).
 * - `clone` — copy the record under a fresh id so later edits/deletes of the
 *   original do not affect this document.
 */
export type ExistingImportMode = 'clone' | 'reference';

/**
 * Copy a stored resource under a fresh id ("import by clone"). Display metadata
 * (name, dimensions, media type) is preserved and the bytes are copied so the
 * clone never aliases the original's buffer.
 */
export const cloneResourceRecord = (
    record: ResourceRecord,
    id: string = newResourceId(),
): ResourceRecord => ({
    ...record,
    id,
    bytes: record.bytes.slice(),
});

/**
 * Build the `ImageRef` for a resource that already exists in the media store.
 *
 * - `reference`: `imageId` is a fresh document-local id while
 *   `source.resourceId` stays the original key. They are intentionally
 *   different — the render seam resolves `local` bytes by `source.resourceId`
 *   (`loadImageRef` → `deps.images.getBytes(ref.source.resourceId)`), so the
 *   ref works against the shared record.
 * - `clone`: `imageId === source.resourceId === newId`; the caller must write
 *   the cloned record under `newId` first (see {@link cloneResourceRecord}).
 */
export const buildImageRefForExisting = (
    record: Pick<ResourceRecord, 'id' | 'mediaType' | 'name'>,
    dimensions: { widthPx: number; heightPx: number },
    mode: ExistingImportMode,
    newId: string = newResourceId(),
): ImageRef => {
    const resourceId = mode === 'clone' ? newId : record.id;
    return {
        imageId: newId,
        name: record.name ?? record.id,
        source: { kind: 'local', mediaType: record.mediaType, resourceId },
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
    };
};

/**
 * Natural pixel dimensions of an existing image resource: the stored metadata
 * when present, otherwise the same decode path `importImageFile` uses. A decode
 * failure yields `0 × 0` rather than throwing (the UI can still show the name).
 */
export const resolveResourceDimensions = async (
    record: Pick<ResourceRecord, 'mediaType' | 'bytes' | 'widthPx' | 'heightPx'>,
): Promise<{ widthPx: number; heightPx: number }> => {
    if (record.widthPx !== undefined && record.heightPx !== undefined) {
        return { widthPx: record.widthPx, heightPx: record.heightPx };
    }
    const decoded = await decodeImageBytes(record.bytes, record.mediaType);
    return decoded
        ? { widthPx: decoded.widthPx, heightPx: decoded.heightPx }
        : { widthPx: 0, heightPx: 0 };
};
