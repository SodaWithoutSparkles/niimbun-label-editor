import type { AssetRef, LabelDoc } from '../core/doc/types';

/**
 * Orphan sweep core (phase 9, W4; decision D5).
 *
 * Two pure helpers backing the gallery's "unused" badge / "delete unused"
 * action. They are storage-free so they can be unit-tested without IndexedDB:
 *
 *   - {@link collectReferencedIds} walks every document and gathers the storage
 *     ids its refs point at, and
 *   - {@link findOrphanIds} diffs a stored id list against that set.
 *
 * The collector is deliberately **conservative** (R9b): a ref that merely sits
 * in `doc.resources`/`doc.data.csv` counts as referenced even if no node uses it
 * (`removeNode` does not prune `doc.resources.*`). Over-reporting a reference
 * only means we keep a possibly-unused row; under-reporting would let the sweep
 * delete bytes a live document still needs.
 */

/** Storage ids referenced by a set of documents, split by store. */
export interface ReferencedIds {
    /** Ids appearing in `doc.data.csv.csvId`. */
    csvIds: Set<string>;
    /** Ids appearing in a `local` image/font `AssetRef.resourceId`. */
    resourceIds: Set<string>;
}

/**
 * Record the storage id of an asset ref when it lives in the `resources` store.
 * Only `kind: 'local'` carries a `resourceId`; `inline`/`remote`/`external`
 * write nothing and are ignored.
 */
const collectAssetRef = (source: AssetRef | undefined, into: Set<string>): void => {
    if (source && source.kind === 'local' && source.resourceId.length > 0) {
        into.add(source.resourceId);
    }
};

/**
 * Collect every storage id referenced by `docs`.
 *
 * A CSV id comes from `doc.data.csv?.csvId`. A resource id comes from every
 * `doc.resources.images[*].source` and from an imported font's
 * `source.asset` (fonts only reference storage through
 * `source.kind === 'imported'`); both must be `kind: 'local'`.
 */
export const collectReferencedIds = (docs: readonly LabelDoc[]): ReferencedIds => {
    const csvIds = new Set<string>();
    const resourceIds = new Set<string>();

    for (const doc of docs) {
        const csvId = doc.data?.csv?.csvId;
        if (typeof csvId === 'string' && csvId.length > 0) csvIds.add(csvId);

        for (const image of doc.resources?.images ?? []) {
            collectAssetRef(image.source, resourceIds);
        }
        for (const font of doc.resources?.fonts ?? []) {
            if (font.source?.kind === 'imported') {
                collectAssetRef(font.source.asset, resourceIds);
            }
        }
    }

    return { csvIds, resourceIds };
};

/**
 * Ids present in `allIds` but absent from `referenced`, in first-seen order and
 * deduped (a store should never hand back a duplicate key, but a diff must not
 * repeat a delete).
 */
export const findOrphanIds = (
    allIds: readonly string[],
    referenced: ReadonlySet<string>,
): string[] => {
    const seen = new Set<string>();
    const orphans: string[] = [];
    for (const id of allIds) {
        if (referenced.has(id) || seen.has(id)) continue;
        seen.add(id);
        orphans.push(id);
    }
    return orphans;
};
