import { newLabelId } from '../core/doc/factory';
import type { AssetRef, FontRef, ImageRef, LabelDoc } from '../core/doc/types';
import { isLabelDoc, migrate } from '../core/doc/validate';
import type { CsvRecord, CsvRepo } from './csvRepo';
import { isCsvRecord } from './csvRepo';
import { errorMessage, isRecord } from './guards';
import type { LabelRepo } from './labelRepo';
import type { ResourceRepo } from './resourceRepo';

/**
 * Label bundle — the self-contained export/import data layer (2026-10-22
 * storage-safety run, P8a).
 *
 * A bundle carries whole documents plus every binary/table asset they reference,
 * so a label can move between devices without the original IDB stores:
 *
 *   - only the assets a document's nodes actually use are carried
 *     ({@link referencedAssetIds}); `doc.resources.*` is append-only — deleting a
 *     node never prunes it — so the export prunes its cloned copy to the node
 *     references before inlining. The in-memory document is left untouched, and
 *     an unreferenced ref is dropped whether it is `local`, `inline`, `remote`
 *     or `external` (an unused inline image bloats the file just as much),
 *   - `local` image/font refs are rewritten to `inline` data URLs on export and
 *     back to fresh `local` refs on import (bytes stored in `resources`),
 *   - the CSV table a doc is attached to is embedded once and re-minted on
 *     import (`doc.data.csv.csvId` is rewritten, as is a `local` source's
 *     `resourceId` — they are the same key by design),
 *   - `remote`/`external` refs travel as-is: they are provenance, not bytes.
 *
 * Safety rules (same discipline as `labelRepo`):
 *   - `importBundle` never throws — every failure becomes a per-document error
 *     or a non-fatal warning, and one bad document never aborts the others,
 *   - imported documents always get a **fresh** `meta.id`; trust is keyed by doc
 *     id, so an imported label starts at `ask` (the trust store is not touched),
 *   - `buildBundle` never mutates its input (`structuredClone` first),
 *   - the round trip is byte-exact, including `0x00`/`0xFF` (base64, not text).
 *
 * This module is data-layer only: no UI, no `LabelDoc` schema change. The
 * File-menu wiring is P8b.
 */

export const BUNDLE_KIND = 'niimbun-label-bundle';
export const BUNDLE_VERSION = 1;
/** UI `file.size` guard — keep the import dialog from reading a huge file. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface LabelBundle {
    kind: typeof BUNDLE_KIND;
    version: typeof BUNDLE_VERSION;
    exportedAt: number; // epoch seconds
    /** Documents with every `local` image/font ref rewritten to `inline`. */
    docs: LabelDoc[];
    /** CSV tables the docs reference, embedded by original id. */
    csvs: CsvRecord[];
}

export interface BundleReadDeps {
    resourceRepo: Pick<ResourceRepo, 'get'> | null;
    csvRepo: Pick<CsvRepo, 'get'> | null;
    now?: number;
}

export interface BundleWriteDeps {
    labelRepo: Pick<LabelRepo, 'save'>;
    resourceRepo: Pick<ResourceRepo, 'put'> | null;
    csvRepo: Pick<CsvRepo, 'put'> | null;
    now?: number;
}

export interface ExportBundleResult {
    bundle: LabelBundle;
    /**
     * **Referenced** local refs that could not be read (left `local` in the
     * export). An unreferenced unreadable ref is pruned, not counted.
     */
    missing: number;
}

export interface ImportBundleResult {
    imported: number;
    /** Per-document fatal problems (validation / storage). */
    errors: string[];
    /** Non-fatal: a referenced CSV/resource was not in the bundle. */
    warnings: number;
}

/** Epoch seconds, floored; `NaN`/absent falls back to now. */
const epochSeconds = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.floor(value)
        : Math.floor(Date.now() / 1000);

/** Fresh storage key for an imported asset/table. Same fallback as `newLabelId`. */
const newAssetId = (): string => {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return cryptoObj.randomUUID();
    }
    return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Chunked `btoa` (the pattern from `labelRepo.ts`): `String.fromCharCode.apply`
 * on a whole large image would blow the argument limit.
 */
export const bytesToDataUrl = (bytes: Uint8Array, mediaType: string): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return `data:${mediaType};base64,${btoa(binary)}`;
};

/** Only `data:...;base64,` payloads decode; anything else yields `null`. */
const DATA_URL_BASE64 = /^data:[^,]*;base64,/i;

export const dataUrlToBytes = (dataUrl: string): Uint8Array | null => {
    const match = DATA_URL_BASE64.exec(dataUrl);
    if (!match) return null;
    // Whitespace is legal inside a base64 body (line wrapping) and `atob` on
    // some runtimes rejects it, so strip it the way `validate` does.
    const payload = dataUrl.slice(match[0].length).replace(/\s+/g, '');
    try {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
};

/**
 * Shallow structural check only: `kind`, `version` and both arrays. Documents
 * are validated per item by `importBundle`, so one bad doc does not reject the
 * whole file.
 */
export const isLabelBundle = (value: unknown): value is LabelBundle =>
    isRecord(value) &&
    value.kind === BUNDLE_KIND &&
    value.version === BUNDLE_VERSION &&
    Array.isArray(value.docs) &&
    Array.isArray(value.csvs);

type LocalAssetRef = Extract<AssetRef, { kind: 'local' }>;

/** Read a stored resource and inline it; `null` means "not found / no repo". */
const inlineLocalRef = async (
    source: LocalAssetRef,
    repo: Pick<ResourceRepo, 'get'> | null,
): Promise<AssetRef | null> => {
    if (!repo) return null;
    try {
        const record = await repo.get(source.resourceId);
        if (!record) return null;
        return {
            kind: 'inline',
            mediaType: record.mediaType,
            dataUrl: bytesToDataUrl(record.bytes, record.mediaType),
        };
    } catch {
        return null;
    }
};

/**
 * Asset refs a document's nodes actually use. The exported registry is derived
 * from this, not from `doc.resources`, which is append-only (see `orphans.ts`).
 *
 *   - `imageIds` — `node.type === 'image'` → `node.imageId`,
 *   - `fontIds` — `node.type === 'text'` → `node.fontId` (when set),
 *   - `fontFamilies` — every non-empty `node.fontFamily`. It is collected even
 *     when `fontId` is set: the render path resolves text through
 *     `node.fontFamily` (`resolve.ts`) and `ensureFonts(doc)` registers a font
 *     by its `familyName`, so a font the node names by family is still usable
 *     even if its `fontId` differs. Legacy docs that carry no `fontId` rely on
 *     this clause exclusively.
 */
export const referencedAssetIds = (
    doc: LabelDoc,
): { imageIds: Set<string>; fontIds: Set<string>; fontFamilies: Set<string> } => {
    const imageIds = new Set<string>();
    const fontIds = new Set<string>();
    const fontFamilies = new Set<string>();

    for (const node of doc.nodes) {
        if (node.type === 'image') {
            imageIds.add(node.imageId);
        } else if (node.type === 'text') {
            if (node.fontId) fontIds.add(node.fontId);
            if (node.fontFamily) fontFamilies.add(node.fontFamily);
        }
    }

    return { imageIds, fontIds, fontFamilies };
};

/**
 * Build a self-contained bundle. Each document is cloned first, so the caller's
 * docs are never mutated. The clone's registries are pruned to the assets the
 * nodes reference (a duplicate `imageId`/`fontId` collapses to its **last**
 * entry, matching the renderer's map) before anything is inlined: a document
 * with deleted nodes does not ship their bytes. A **referenced** local ref that
 * cannot be read stays `local` and is counted in `missing` — the export is
 * still produced.
 */
export const buildBundle = async (
    docs: readonly LabelDoc[],
    deps: BundleReadDeps,
): Promise<ExportBundleResult> => {
    const exported: LabelDoc[] = [];
    const csvs: CsvRecord[] = [];
    const seenCsvIds = new Set<string>();
    let missing = 0;

    for (const doc of docs) {
        const copy = structuredClone(doc);

        // Prune before inlining: unreferenced refs must not contribute bytes
        // (they are also not "missing" — the bundle needs nothing from them).
        const { imageIds, fontIds, fontFamilies } = referencedAssetIds(copy);
        // A registry can hold duplicate `imageId`s; the renderer's map
        // (`prepareAssets`) keeps the **last** entry, so the bundle must too —
        // keeping both would ship bytes no renderer ever picks. Walk backwards
        // and reverse to preserve registry order for the refs that survive.
        const keptImages: ImageRef[] = [];
        const seenImageIds = new Set<string>();
        for (let index = copy.resources.images.length - 1; index >= 0; index -= 1) {
            const ref = copy.resources.images[index];
            if (!imageIds.has(ref.imageId) || seenImageIds.has(ref.imageId)) continue;
            seenImageIds.add(ref.imageId);
            keptImages.push(ref);
        }
        copy.resources.images = keptImages.reverse();
        // Same rule for fonts: a hand-edited registry can duplicate a `fontId`,
        // and only the last entry is reachable, so shipping both would repeat
        // the same bytes in the bundle.
        const keptFonts: FontRef[] = [];
        const seenFontIds = new Set<string>();
        for (let index = copy.resources.fonts.length - 1; index >= 0; index -= 1) {
            const ref = copy.resources.fonts[index];
            const referenced = fontIds.has(ref.fontId) || fontFamilies.has(ref.familyName);
            if (!referenced || seenFontIds.has(ref.fontId)) continue;
            seenFontIds.add(ref.fontId);
            keptFonts.push(ref);
        }
        copy.resources.fonts = keptFonts.reverse();

        for (const image of copy.resources.images) {
            if (image.source.kind !== 'local') continue;
            const inlined = await inlineLocalRef(image.source, deps.resourceRepo);
            if (inlined) image.source = inlined;
            else missing += 1;
        }

        for (const font of copy.resources.fonts) {
            if (font.source.kind !== 'imported' || font.source.asset.kind !== 'local') continue;
            const inlined = await inlineLocalRef(font.source.asset, deps.resourceRepo);
            if (inlined) font.source.asset = inlined;
            else missing += 1;
        }

        const csv = copy.data.csv;
        if (csv && !seenCsvIds.has(csv.csvId)) {
            const record = deps.csvRepo ? await readCsv(deps.csvRepo, csv.csvId) : null;
            if (record) {
                // Dedupe across docs only after a successful read, so a transient
                // failure can still be retried by a later document.
                seenCsvIds.add(csv.csvId);
                csvs.push(record);
            } else {
                missing += 1;
            }
        }

        exported.push(copy);
    }

    return {
        bundle: {
            kind: BUNDLE_KIND,
            version: BUNDLE_VERSION,
            exportedAt: epochSeconds(deps.now),
            docs: exported,
            csvs,
        },
        missing,
    };
};

/** CSV read that never throws; the record is cloned so the bundle owns it. */
const readCsv = async (
    repo: Pick<CsvRepo, 'get'>,
    id: string,
): Promise<CsvRecord | null> => {
    try {
        const record = await repo.get(id);
        return record ? structuredClone(record) : null;
    } catch {
        return null;
    }
};

interface NormalisedBundle {
    docs: unknown[];
    /** Valid embedded tables by original id; invalid rows are ignored (a doc referencing one gets a warning). */
    csvs: Map<string, CsvRecord>;
}

/** Bundle envelope, document array, or single document; `null` = not importable. */
const normalise = (raw: unknown): NormalisedBundle | null => {
    if (isRecord(raw) && raw.kind === BUNDLE_KIND) {
        if (!isLabelBundle(raw)) return null;
        const csvs = new Map<string, CsvRecord>();
        for (const value of raw.csvs) {
            const record = isCsvRecord(value) ? value : null;
            if (record) csvs.set(record.id, record);
        }
        return { docs: raw.docs, csvs };
    }
    if (Array.isArray(raw)) return { docs: raw, csvs: new Map() };
    if (isRecord(raw)) return { docs: [raw], csvs: new Map() };
    return null;
};

/**
 * Store inline bytes and return the `local` ref that replaces them. `null` means
 * the data URL was undecodable or no repo was supplied (caller warns).
 */
const writeInlineRef = async (
    repo: Pick<ResourceRepo, 'put'> | null,
    ref: { mediaType: string; dataUrl: string },
    meta: { name: string; widthPx?: number; heightPx?: number },
): Promise<AssetRef | null> => {
    if (!repo) return null;
    const bytes = dataUrlToBytes(ref.dataUrl);
    if (!bytes) return null;
    const id = newAssetId();
    await repo.put({
        id,
        mediaType: ref.mediaType,
        bytes,
        name: meta.name,
        ...(meta.widthPx !== undefined ? { widthPx: meta.widthPx } : {}),
        ...(meta.heightPx !== undefined ? { heightPx: meta.heightPx } : {}),
    });
    return { kind: 'local', mediaType: ref.mediaType, resourceId: id };
};

/** Rewrite one image/font inline ref to local storage; `false` = warning. */
const importImage = async (
    image: ImageRef,
    repo: Pick<ResourceRepo, 'put'> | null,
): Promise<boolean> => {
    if (image.source.kind !== 'inline') return true;
    try {
        const local = await writeInlineRef(repo, image.source, {
            name: image.name,
            widthPx: image.widthPx,
            heightPx: image.heightPx,
        });
        if (!local) return false;
        image.source = local;
        return true;
    } catch {
        return false;
    }
};

const importFont = async (
    font: FontRef,
    repo: Pick<ResourceRepo, 'put'> | null,
): Promise<boolean> => {
    if (font.source.kind !== 'imported' || font.source.asset.kind !== 'inline') return true;
    try {
        const local = await writeInlineRef(repo, font.source.asset, { name: font.name });
        if (!local) return false;
        font.source.asset = local;
        return true;
    } catch {
        return false;
    }
};

/**
 * Import a bundle (or a bare doc / doc list). Never throws: invalid documents
 * and storage failures are reported in `errors`, missing referenced assets in
 * `warnings`. Every imported doc is a copy under a fresh id, stamped `updatedAt`
 * so it sorts to the top of the gallery.
 */
export const importBundle = async (
    raw: unknown,
    deps: BundleWriteDeps,
): Promise<ImportBundleResult> => {
    const result: ImportBundleResult = { imported: 0, errors: [], warnings: 0 };
    const now = epochSeconds(deps.now);

    // A bundle-shaped payload with an unknown version must not fall through to
    // the single-document branch (that reports a misleading doc-version error).
    if (isRecord(raw) && raw.kind === BUNDLE_KIND && raw.version !== BUNDLE_VERSION) {
        result.errors.push(`bundle: unsupported bundle version ${String(raw.version)}`);
        return result;
    }

    const normalised = normalise(raw);
    if (!normalised) {
        result.errors.push(
            'bundle: expected a label bundle, an array of documents, or a single document',
        );
        return result;
    }

    for (const rawDoc of normalised.docs) {
        try {
            const parsed = isLabelDoc(migrate(rawDoc));
            if (!parsed.ok) {
                result.errors.push(...parsed.errors);
                continue;
            }

            const doc = structuredClone(parsed.doc);
            // A fresh id is also the trust boundary: trust is keyed by doc id and
            // an unknown id resolves to `ask`, so the import cannot inherit it.
            doc.meta.id = newLabelId();
            doc.meta.updatedAt = now;

            for (const image of doc.resources.images) {
                if (!(await importImage(image, deps.resourceRepo))) result.warnings += 1;
            }
            for (const font of doc.resources.fonts) {
                if (!(await importFont(font, deps.resourceRepo))) result.warnings += 1;
            }

            const csv = doc.data.csv;
            if (csv) {
                const record = normalised.csvs.get(csv.csvId);
                if (!record || !deps.csvRepo) {
                    // Left as-is: the existing missing-CSV warning covers it.
                    result.warnings += 1;
                } else {
                    try {
                        const id = newAssetId();
                        await deps.csvRepo.put({ ...structuredClone(record), id });
                        csv.csvId = id;
                        // `local` CSV refs use the table id as their resource key.
                        if (csv.source.kind === 'local') {
                            csv.source = { ...csv.source, resourceId: id };
                        }
                    } catch {
                        result.warnings += 1;
                    }
                }
            }

            try {
                await deps.labelRepo.save(doc);
                result.imported += 1;
            } catch (error) {
                result.errors.push(`save: ${errorMessage(error)}`);
            }
        } catch (error) {
            // Defensive: a clone/validation surprise must not abort the file.
            result.errors.push(errorMessage(error));
        }
    }

    return result;
};
