import { newLabelId, roundNode } from '../../core/doc/factory';
import { normalizeDpi } from '../../core/doc/validate';
import { resizeNodeGeometry } from '../../core/doc/geometry';
import { effectiveTransform, IDENTITY_MAT2D, nodeLookup, worldPreservingTransform, type Mat2D } from '../../core/doc/derive';
import { roundHm } from '../../core/hm';
import { translateWorldPatch } from '../../editor/transformPatch';
import { effectiveLockedMap } from '../../editor/selectors';
import type { CsvRef, FontRef, GlobalSpec, GroupNode, ImageRef, LabelDoc, Node } from '../../core/doc/types';
import type { NodePatch, StoreSlice } from '../storeTypes';

/**
 * Editor document operations — pure over `LabelDoc`, undoable, autosaved.
 *
 * Every mutation action follows one shape: clone the current doc, apply the
 * change to the clone, stamp `meta.updatedAt`, then replace `currentDoc` while
 * pushing the *previous* doc onto `docPast` and clearing `docFuture`. The stored
 * doc is therefore never mutated in place, and each successful op is exactly one
 * undo entry.
 *
 * Undo history is named `docPast`/`docFuture` (actions `undoDoc`/`redoDoc`).
 * Neither stack is in `useStore`'s `partialize`, so it is never serialized into
 * `.lbl.json.gz` or localStorage. History is scoped to one document: `openLabel`/
 * `deleteLabel` clear both stacks at the doc-switch boundary, and `undoDoc`/
 * `redoDoc` additionally refuse (and clear) a snapshot whose `meta.id` does not
 * match the open doc — so undo can never load doc A into doc B's editor.
 *
 * Behaviour with no open document (`currentDoc === null`, i.e. the gallery):
 * every operation is a **no-op** and returns `null`/`void` without touching
 * history or autosave. This matches `openLabel` being the only way to get a
 * `currentDoc`.
 *
 * Autosave: a debounced `labelRepo.save(doc)` runs after any doc change, where
 * `doc` is captured when the debounce is *scheduled*. It is skipped when
 * `view !== 'editor'`, when there is no repo, or when the `autoSave` preference
 * is off. The debounce delay lives in `docAutosaveDelayMs` (settable via
 * `setDocAutosaveDelay`) so tests can inject a value and drive it with fake
 * timers. Switching the view or the doc flushes a pending save instead of
 * dropping it; a save scheduled for doc A can never fire against doc B.
 *
 * Every write is tracked in a per-store promise chain (`autosaveWrites`),
 * not just the debounce timer: once the timer fires the write is in flight and
 * `flushAutosave` can no longer see it, so a delete could complete first and
 * the late write would recreate the label. Flushing awaits that chain.
 *
 * Transient gestures (drag/resize): `updateNodeTransient` mutates a private
 * working copy of `currentDoc` without touching history, `updatedAt` or
 * autosave. The committed doc the gesture started from is captured as the
 * baseline, and a single `commitDoc()` pushes exactly one `docPast` entry.
 */

/** Undo depth, matching the reference template's `UNDO_MAX` (20). */
export const DOC_HISTORY_CAP = 20;

/** Default autosave debounce; long enough to coalesce a drag/typing burst. */
export const DEFAULT_DOC_AUTOSAVE_DELAY_MS = 800;

/** Offset applied to a cloned node's root so it does not sit exactly on top. */
export const CLONE_OFFSET_HM = 100;

const cloneDoc = (doc: LabelDoc): LabelDoc => structuredClone(doc);

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Structural equality for plain-JSON docs; skips no-op undo entries. */
const docsEqual = (a: LabelDoc, b: LabelDoc): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Field-wise CSV-ref equality, so a preserved `alt`/fingerprint is not a change. */
const csvRefsEqual = (a: CsvRef, b: CsvRef): boolean =>
    a.csvId === b.csvId &&
    a.name === b.name &&
    a.alt === b.alt &&
    a.source.kind === b.source.kind &&
    a.source.mediaType === b.source.mediaType &&
    (a.source.kind !== 'local' ||
        b.source.kind !== 'local' ||
        (a.source.resourceId === b.source.resourceId && a.source.fingerprint === b.source.fingerprint));

/** Integer hm, or 0 for a non-finite number (matches `factory.ts` discipline). */
const safeRoundHm = (value: number): number => (Number.isFinite(value) ? roundHm(value) : 0);

/** Non-negative integer, or 0 for a non-finite number (image px discipline). */
const nonNegativeInt = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/**
 * Apply an asset-reference patch in place with the stable id restored. `alt` is
 * the only optional field: an explicit `undefined` clears it (the key is
 * deleted, matching `applyNodePatch`). Restoring the id means a runtime `as`
 * cast can never re-key a resource and silently break every node that
 * references it.
 */
const applyRefPatch = (
    ref: ImageRef | FontRef,
    idKey: 'imageId' | 'fontId',
    id: string,
    patch: Partial<Omit<ImageRef, 'imageId'>> | Partial<Omit<FontRef, 'fontId'>>,
): void => {
    Object.assign(ref, patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'alt') && patch.alt === undefined) {
        delete (ref as unknown as Record<string, unknown>).alt;
    }
    (ref as unknown as Record<string, unknown>)[idKey] = id;
};

/** `null`/missing parent is a valid root; otherwise the parent must be a group. */
const isValidParent = (nodes: readonly Node[], parentId: string | null): boolean => {
    if (parentId === null) return true;
    const parent = nodes.find((entry) => entry.id === parentId);
    return parent !== undefined && parent.type === 'group';
};

/** World matrix of a parent id (identity at the root / for a missing parent). */
const parentWorldMatrix = (
    parentId: string | null,
    byId: ReadonlyMap<string, Node>,
): Mat2D => {
    if (parentId === null) return IDENTITY_MAT2D;
    const parent = byId.get(parentId);
    return parent ? effectiveTransform(parent, byId) : IDENTITY_MAT2D;
};

/**
 * Rewrite `node.transform` so its world placement is unchanged when it moves
 * from `oldParentId` to `newParentId` (must-fix #4). Without this a reparent
 * under a translated/rotated group makes the content jump by the delta of the
 * two effective parent transforms.
 */
const preserveWorldTransform = (
    node: Node,
    oldParentId: string | null,
    newParentId: string | null,
    byId: ReadonlyMap<string, Node>,
): void => {
    const oldParent = parentWorldMatrix(oldParentId, byId);
    const newParent = parentWorldMatrix(newParentId, byId);
    node.transform = worldPreservingTransform(node.transform, oldParent, newParent);
};

/**
 * Apply a `NodePatch` to `node` with the structural keys restored. The type
 * already forbids `id`/`parentId`/`type`; restoring them defensively means a
 * runtime `as NodePatch` cast can never smuggle a reparent past
 * `reparentNode`'s cycle guard. All hm geometry carried by the patch (transform
 * x/y, `size`, `fontSize`, `cornerRadius`, `strokeWidth`, `points`) is rounded
 * via the factory's `roundNode`, so a patch can never persist a float hm.
 */
const applyNodePatch = (node: Node, patch: NodePatch): void => {
    const { id, parentId, type, transform } = node;
    Object.assign(node, patch);
    // A patch value of `undefined` means "clear this optional field": delete the
    // key instead of leaving a live `quantizerHint: undefined` own property
    // (which would break `'key' in node` checks and strict snapshots).
    const target = node as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete target[key];
    }
    Object.assign(node, { id, parentId, type });
    // A cast patch may carry `transform: undefined`; restore the original rather
    // than letting the rounding below throw on a missing transform.
    if (node.transform === undefined) {
        node.transform = transform;
        return;
    }
    // `roundNode` returns a new object; copy the rounded fields back onto the
    // node so its identity (and the patch's in-place contract) is preserved.
    Object.assign(node, roundNode(node));
};

/** Ids of `rootId` and every descendant, including `rootId` itself. */
const collectSubtreeIds = (nodes: readonly Node[], rootId: string): Set<string> => {
    const childrenOf = new Map<string | null, string[]>();
    for (const node of nodes) {
        const siblings = childrenOf.get(node.parentId);
        if (siblings) siblings.push(node.id);
        else childrenOf.set(node.parentId, [node.id]);
    }
    const result = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (result.has(current)) continue;
        result.add(current);
        for (const child of childrenOf.get(current) ?? []) stack.push(child);
    }
    return result;
};

/**
 * Deep-clone `rootId` and its descendants with fresh ids. Returns the clones in
 * the original array order (preserving sibling z-order) plus the new root id.
 * `parentId` is remapped inside the subtree and left untouched otherwise.
 */
const cloneSubtree = (
    nodes: readonly Node[],
    rootId: string,
): { clones: Node[]; newRootId: string } | null => {
    if (!nodes.some((node) => node.id === rootId)) return null;
    const subtreeIds = collectSubtreeIds(nodes, rootId);
    const idMap = new Map<string, string>();
    for (const oldId of subtreeIds) idMap.set(oldId, newLabelId());

    const clones: Node[] = [];
    for (const original of nodes) {
        if (!subtreeIds.has(original.id)) continue;
        const copy = structuredClone(original) as Node;
        copy.id = idMap.get(original.id)!;
        copy.parentId =
            original.parentId !== null && idMap.has(original.parentId)
                ? idMap.get(original.parentId)!
                : original.parentId;
        clones.push(copy);
    }
    return { clones, newRootId: idMap.get(rootId)! };
};

const makeGroupNode = (id: string, parentId: string | null): GroupNode => ({
    id,
    parentId,
    type: 'group',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

export const createEditorSlice: StoreSlice = (set, get) => {
    // Per-store-instance debounce handle, so two stores in one test never share
    // a timer.
    let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
    // The doc captured when the pending autosave was scheduled. Held separately
    // from `currentDoc` so a switch can flush exactly what was scheduled, and so
    // the timer never reads a *newer* doc than the edits it represents.
    let pendingAutosaveDoc: LabelDoc | null = null;
    /**
     * Every autosave write started so far, serialized. The debounce timer alone
     * is not enough: once it fires, the write is in flight and `flushAutosave`
     * could not see it, so a delete could complete first and the late write
     * would recreate the label (must-fix: delete-before-save inversion).
     */
    let autosaveWrites: Promise<void> = Promise.resolve();

    /**
     * Newest snapshot waiting for the writer loop. Only one can be queued: while
     * a write is stalled, later debounce ticks supersede it instead of growing
     * the chain without bound (a full `LabelDoc` per queued write).
     */
    let queuedAutosave: {
        doc: LabelDoc;
        repo: NonNullable<ReturnType<typeof get>['labelRepo']>;
    } | null = null;

    /** True while the writer loop is draining `queuedAutosave`. */
    let drainingAutosaves = false;

    /**
     * Queue one autosave write. Coalesces to the newest snapshot while a write
     * is in flight; `autosaveWrites` always covers everything queued so far.
     */
    const enqueueAutosave = (
        doc: LabelDoc,
        repo: NonNullable<ReturnType<typeof get>['labelRepo']>,
    ): void => {
        queuedAutosave = { doc, repo };
        if (drainingAutosaves) return;
        drainingAutosaves = true;
        autosaveWrites = (async () => {
            try {
                while (queuedAutosave) {
                    const next = queuedAutosave;
                    queuedAutosave = null;
                    await saveDoc(next.doc, next.repo);
                }
            } finally {
                // `saveDoc` never rejects today; the guard keeps a future change
                // from stranding every later autosave behind a stuck flag.
                drainingAutosaves = false;
            }
        })();
    };

    // Baseline of an in-progress transient gesture. `null` when no gesture is
    // active; otherwise `currentDoc` is the working copy and this holds the
    // committed doc the gesture started from (the single undo target) plus its
    // id, so a doc switch mid-gesture can be detected and the stale baseline
    // discarded instead of committed into the wrong document's history.
    let transientBase: { docId: string; doc: LabelDoc } | null = null;

    /**
     * Persist `doc` through the repo if the current preferences allow a
     * background save. Never rejects: a failed autosave is invisible by design
     * (the explicit save path owns user-visible errors), and `Promise.resolve()`
     * also catches a *synchronous* throw from `save`. Returns when the write has
     * settled, so a caller that needs deterministic ordering can await it.
     */
    const saveDoc = (
        doc: LabelDoc,
        repo: NonNullable<ReturnType<typeof get>['labelRepo']>,
    ): Promise<void> =>
        Promise.resolve()
            .then(() => repo.save(doc))
            .then(() => get().setLastAutoSaveAt(Date.now()))
            .catch(() => undefined);

    /** Cancel any pending debounce and forget its captured doc. */
    const cancelAutosave = (): void => {
        if (autosaveTimer !== null) {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
        }
        pendingAutosaveDoc = null;
    };

    /**
     * Schedule a debounced autosave. The doc is captured at *schedule* time (not
     * read when the timer fires) so a later `setView('gallery')`/`openLabel`
     * cannot drop the pending edit — and the captured identity lets the fire
     * path refuse to write if the doc has since been replaced.
     */
    const scheduleAutosave = (doc: LabelDoc): void => {
        cancelAutosave();
        pendingAutosaveDoc = doc;
        autosaveTimer = setTimeout(() => {
            autosaveTimer = null;
            const pending = pendingAutosaveDoc;
            pendingAutosaveDoc = null;
            if (!pending) return;
            const state = get();
            // A doc switch since scheduling invalidates this write.
            if (state.currentDoc?.meta.id !== pending.meta.id) return;
            if (!state.autoSave) return;
            if (state.view !== 'editor') return;
            const repo = state.labelRepo;
            if (!repo) return;
            enqueueAutosave(pending, repo);
        }, get().docAutosaveDelayMs);
    };
    /**
     * Flush a pending autosave immediately (if one is scheduled), saving the doc
     * captured at schedule time, and resolve once **every** write started up to
     * this call has settled. Called on the view/doc boundary so leaving the
     * editor cannot drop the last edit. The write is independent of `view` (a
     * switch to the gallery must still persist), but still honours `autoSave`
     * and the presence of a repo.
     *
     * Returning a promise is load-bearing for `saveCurrentLabel` and
     * `deleteLabel`: they must **await** the older pending write before their
     * own (newer) save/remove, or the deferred autosave lands last and clobbers
     * the explicit save / recreates the deleted label (must-fix #8).
     */
    const flushAutosave = (): Promise<void> => {
        const pending = pendingAutosaveDoc;
        cancelAutosave();
        const state = get();
        if (pending && state.autoSave && state.labelRepo) {
            enqueueAutosave(pending, state.labelRepo);
        }
        // Resolves once every write started up to this call has settled. Writes
        // scheduled later chain after this snapshot.
        return autosaveWrites.then(() => undefined);
    };

    /**
     * Drop the undo/redo stacks and any transient baseline. The doc-switch
     * boundary calls this so history from doc A can never be applied to doc B.
     */
    const clearDocHistory = (): void => {
        transientBase = null;
        set({ docPast: [], docFuture: [] });
    };

    /**
     * Replace the doc, push the previous snapshot, clear redo, autosave.
     *
     * `coalesce` folds an auto-repeat into the gesture already on the undo
     * stack: the first press of a hold pushes the pre-move doc as the baseline,
     * each subsequent repeat mutates the working doc **without** pushing, so one
     * key-hold is exactly one `docPast` entry. Everything else (current doc,
     * `updatedAt`, redo clear, autosave) is identical.
     */
    const commit = (next: LabelDoc, previous: LabelDoc, coalesce = false): void => {
        // A committed op ends any transient gesture; its baseline must not leak
        // into a later `commitDoc`.
        transientBase = null;
        next.meta.updatedAt = nowSeconds();
        set((state) => ({
            currentDoc: next,
            docPast: coalesce ? state.docPast : [...state.docPast, previous].slice(-DOC_HISTORY_CAP),
            docFuture: [],
        }));
        scheduleAutosave(next);
    };

    return {
        // Undo/redo stacks — never serialized (not in `partialize`).
        docPast: [],
        docFuture: [],

        // Autosave debounce delay (ms). Injectable so tests can use fake timers.
        docAutosaveDelayMs: DEFAULT_DOC_AUTOSAVE_DELAY_MS,
        setDocAutosaveDelay: (ms) => set({ docAutosaveDelayMs: ms }),

        addNode: (node) => {
            const doc = get().currentDoc;
            if (!doc) return null;
            // A node may only be parented to a group (or the root).
            if (!isValidParent(doc.nodes, node.parentId)) return null;
            const next = cloneDoc(doc);
            const copy = structuredClone(node) as Node;
            // Decision 39: the slice owns id minting, so an incoming id can
            // never collide with an existing node.
            copy.id = newLabelId();
            next.nodes.push(copy);
            commit(next, doc);
            return copy.id;
        },

        updateNode: (id, patch) => {
            const doc = get().currentDoc;
            if (!doc || !doc.nodes.some((node) => node.id === id)) return;
            const next = cloneDoc(doc);
            const node = next.nodes.find((entry) => entry.id === id)!;
            applyNodePatch(node, patch);
            commit(next, doc);
        },

        nudgeNodes: (dx, dy, coalesce = false) => {
            const state = get();
            const doc = state.currentDoc;
            if (!doc || state.selectedNodeIds.length === 0) return;
            const selected = new Set(state.selectedNodeIds);
            const byId = nodeLookup(doc.nodes);
            // A node selected before it was locked must not move; drag/hit-test
            // skip locked nodes too.
            const locked = effectiveLockedMap(doc);
            // Move only the top level of the selection: a selected node whose
            // ancestor is also selected is carried by that ancestor, so patching
            // it too would apply the delta twice.
            const movable = doc.nodes.filter((node) => {
                if (!selected.has(node.id)) return false;
                if (locked.get(node.id)) return false;
                for (
                    let parentId = node.parentId;
                    parentId !== null;
                    parentId = byId.get(parentId)?.parentId ?? null
                ) {
                    if (selected.has(parentId)) return false;
                }
                return true;
            });
            if (movable.length === 0) return;
            // One working clone, one `commit`: the whole nudge is a single undo
            // entry regardless of how many nodes are selected. `coalesce` lets a
            // key-hold's auto-repeats share the first press's undo entry.
            const next = cloneDoc(doc);
            let changed = false;
            for (const node of movable) {
                const patch = translateWorldPatch(node, byId, dx, dy);
                const target = patch?.transform;
                if (!patch || !target) continue;
                // The patch carries already-rounded hm, so a zero or sub-hm
                // delta that rounds away leaves x/y equal. Comparing before
                // applying keeps the hot auto-repeat path off a whole-doc
                // `docsEqual`.
                if (target.x === node.transform.x && target.y === node.transform.y) continue;
                applyNodePatch(next.nodes.find((entry) => entry.id === node.id)!, patch);
                changed = true;
            }
            // A singular chain or a delta that rounds away must not create a dead
            // undo entry.
            if (!changed) return;
            commit(next, doc, coalesce);
        },

        addImageRef: (ref) => {
            const doc = get().currentDoc;
            if (!doc) return false;
            // A duplicate id would make every node referencing it ambiguous.
            if (doc.resources.images.some((entry) => entry.imageId === ref.imageId)) return false;
            const next = cloneDoc(doc);
            next.resources.images.push(structuredClone(ref));
            commit(next, doc);
            return true;
        },

        updateImageRef: (imageId, patch) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const index = doc.resources.images.findIndex((entry) => entry.imageId === imageId);
            if (index < 0) return;
            const next = cloneDoc(doc);
            const ref = next.resources.images[index]!;
            applyRefPatch(ref, 'imageId', imageId, patch);
            // px dimensions are stored as non-negative integers.
            if (patch.widthPx !== undefined) ref.widthPx = nonNegativeInt(patch.widthPx);
            if (patch.heightPx !== undefined) ref.heightPx = nonNegativeInt(patch.heightPx);
            commit(next, doc);
        },

        addFontRef: (ref) => {
            const doc = get().currentDoc;
            if (!doc) return false;
            if (doc.resources.fonts.some((entry) => entry.fontId === ref.fontId)) return false;
            const next = cloneDoc(doc);
            next.resources.fonts.push(structuredClone(ref));
            commit(next, doc);
            return true;
        },

        updateFontRef: (fontId, patch) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const index = doc.resources.fonts.findIndex((entry) => entry.fontId === fontId);
            if (index < 0) return;
            const next = cloneDoc(doc);
            applyRefPatch(next.resources.fonts[index]!, 'fontId', fontId, patch);
            commit(next, doc);
        },

        renameDoc: (name) => {
            const doc = get().currentDoc;
            if (!doc) return;
            // An empty/whitespace name would erase the gallery title; keep the
            // current name instead. A no-op rename must not create an undo entry.
            const trimmed = name.trim();
            const next = trimmed.length > 0 ? trimmed : doc.meta.name;
            if (next === doc.meta.name) return;
            const nextDoc = cloneDoc(doc);
            nextDoc.meta.name = next;
            commit(nextDoc, doc);
        },

        setSampleRowIndex: (index) => {
            const doc = get().currentDoc;
            if (!doc) return;
            // Reject non-finite input before rounding (NaN/Infinity would become
            // NaN/Infinity and corrupt the stored index).
            if (!Number.isFinite(index)) return;
            const clamped = Math.max(0, Math.round(index));
            // A no-op change must not create an undo entry (mirrors commitDoc).
            if (clamped === doc.data.sampleRowIndex) return;
            const next = cloneDoc(doc);
            next.data.sampleRowIndex = clamped;
            commit(next, doc);
        },

        setPrintDirection: (direction) => {
            const doc = get().currentDoc;
            if (!doc) return;
            // A no-op change must not create an undo entry (mirrors commitDoc).
            if (doc.label.printDirection === direction) return;
            const next = cloneDoc(doc);
            next.label.printDirection = direction;
            commit(next, doc);
        },

        setLabelDpi: (dpi) => {
            const doc = get().currentDoc;
            if (!doc) return;
            // Clamp exactly like the document validator so a write-back cannot
            // store a corrupt hint; a no-op change creates no undo entry.
            const clamped = normalizeDpi(dpi);
            if (clamped === doc.label.dpi) return;
            const next = cloneDoc(doc);
            next.label.dpi = clamped;
            commit(next, doc);
        },

        setDocThumb: (docId, thumb) => {
            const doc = get().currentDoc;
            // A late render must never patch another (now open) document.
            if (!doc || doc.meta.id !== docId) return;
            // Compare the data URL only: `at` changes on every render, so it
            // would turn an identical image into an endless patch/render loop.
            if (doc.meta.thumb?.dataUrl === thumb?.dataUrl) return;
            // No clone of the whole doc and no history/`updatedAt`: the preview
            // is cosmetic. The new `meta` object gives `currentDoc` a new
            // identity so subscribers repaint.
            const next: LabelDoc = { ...doc, meta: { ...doc.meta, thumb } };
            set({ currentDoc: next });
            scheduleAutosave(next);
        },

        setDocCsv: (csv) => {
            const doc = get().currentDoc;
            if (!doc) return;
            // Build the ref from scratch: provenance must be `local` and the IDB
            // key must match, or a caller could attach a dangling/remote source.
            let ref: CsvRef | null = null;
            if (csv !== null) {
                const csvId = csv.csvId.trim();
                if (csvId.length === 0) return;
                // Re-attaching the same table preserves its identity fields
                // (`fingerprint`, `alt`) instead of dropping them.
                const previous = doc.data.csv;
                const sameId = previous?.csvId === csvId;
                ref = {
                    csvId,
                    name: csv.name,
                    ...(sameId && previous?.alt !== undefined ? { alt: previous.alt } : {}),
                    source: {
                        kind: 'local',
                        mediaType: 'text/csv',
                        resourceId: csvId,
                        ...(sameId && previous?.source.kind === 'local' && previous.source.fingerprint !== undefined
                            ? { fingerprint: previous.source.fingerprint }
                            : {}),
                    },
                };
            }
            const current = doc.data.csv;
            // No-op guard: an identical ref or clearing an absent one must not
            // create a dead undo entry. Compared field-wise so a preserved
            // `alt`/`fingerprint` does not spuriously count as a change.
            if (ref === null) {
                if (current === undefined) return;
            } else if (current !== undefined && csvRefsEqual(current, ref)) {
                return;
            }
            const next = cloneDoc(doc);
            if (ref === null) delete next.data.csv;
            else next.data.csv = ref;
            commit(next, doc);
        },

        /**
         * Attach a CSV **and** reset the sample row in ONE undo entry. Importing
         * a fresh table must not leave two undo steps (`setDocCsv` +
         * `setSampleRowIndex`), and the sample row must not point past the new
         * data. Clearing (`null`) leaves the row untouched.
         */
        attachCsv: (csv) => {
            const doc = get().currentDoc;
            if (!doc) return;
            if (csv === null) {
                get().setDocCsv(null);
                return;
            }
            const csvId = csv.csvId.trim();
            if (csvId.length === 0) return;
            const current = doc.data.csv;
            const sameId = current?.csvId === csvId;
            const ref: CsvRef = {
                csvId,
                name: csv.name,
                ...(sameId && current?.alt !== undefined ? { alt: current.alt } : {}),
                source: {
                    kind: 'local',
                    mediaType: 'text/csv',
                    resourceId: csvId,
                    ...(sameId && current?.source.kind === 'local' && current.source.fingerprint !== undefined
                        ? { fingerprint: current.source.fingerprint }
                        : {}),
                },
            };
            // A re-attach of the identical ref with the row already at 0 is a no-op.
            if (current !== undefined && csvRefsEqual(current, ref) && doc.data.sampleRowIndex === 0) return;
            const next = cloneDoc(doc);
            next.data.csv = ref;
            next.data.sampleRowIndex = 0;
            commit(next, doc);
        },

        setDocGlobals: (globals) => {
            const doc = get().currentDoc;
            if (!doc) return;
            // Normalize to the stored shape and drop specs the template layer
            // could never use: a blank `name` cannot be addressed as
            // `globals.<name>`. Remote specs trim their URL and floor
            // `expiresAt` to a finite epoch-second value; static specs keep
            // their literal value verbatim. A malformed spec is dropped rather
            // than persisted.
            const next_globals: GlobalSpec[] = [];
            for (const spec of globals) {
                const name = spec.name.trim();
                if (name.length === 0) continue;
                if (spec.kind === 'static') {
                    next_globals.push({ kind: 'static', name, value: spec.value });
                } else {
                    next_globals.push({
                        kind: 'remote',
                        name,
                        url: spec.url.trim(),
                        extract: spec.extract,
                        expiresAt: Number.isFinite(spec.expiresAt) ? Math.max(0, Math.floor(spec.expiresAt)) : 0,
                    });
                }
            }
            // No-op guard: an identical list must not create a dead undo entry.
            if (JSON.stringify(doc.data.globals) === JSON.stringify(next_globals)) return;
            const next = cloneDoc(doc);
            next.data.globals = next_globals;
            commit(next, doc);
        },

        resizeNode: (id, target, opts) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const existing = doc.nodes.find((entry) => entry.id === id);
            // Groups carry no resizable geometry; nothing to commit.
            if (!existing || existing.type === 'group') return;
            const next = cloneDoc(doc);
            const at = next.nodes.findIndex((entry) => entry.id === id);
            const resized = resizeNodeGeometry(next.nodes[at]!, target, opts);
            // `resizeNodeGeometry` already yields integer hm; roundNode keeps the
            // transform/other hm fields under the same factory discipline. Both
            // produce new objects, and the clone above is still private.
            next.nodes[at] = roundNode(resized);
            commit(next, doc);
        },

        updateNodeTransient: (id, patch) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const node = doc.nodes.find((entry) => entry.id === id);
            if (!node) return;
            // A baseline captured on another document (openLabel switched docs
            // mid-gesture) must never be committed here: discard it and start a
            // fresh gesture against the doc now on screen.
            if (transientBase === null || transientBase.docId !== doc.meta.id) {
                transientBase = { docId: doc.meta.id, doc };
                const working = cloneDoc(doc);
                applyNodePatch(working.nodes.find((entry) => entry.id === id)!, patch);
                set({ currentDoc: working });
                return;
            }
            // Subsequent calls mutate the working copy in place — no clone, no
            // history, no `updatedAt` stamp. A shallow copy of the doc (new
            // identity, shared node objects) makes `useStore(s => s.currentDoc)`
            // repaint instead of bailing on `Object.is`.
            applyNodePatch(node, patch);
            set({ currentDoc: { ...doc, nodes: [...doc.nodes] } });
        },

        commitDoc: () => {
            const base = transientBase;
            if (base === null) return;
            const current = get().currentDoc;
            transientBase = null;
            // The doc changed under the gesture: the baseline belongs to another
            // document, so drop it without touching this doc's history.
            if (!current || current.meta.id !== base.docId) return;
            // A click, or a drag returned to its origin, changed nothing: no undo
            // entry (otherwise undo would look dead).
            if (docsEqual(current, base.doc)) return;
            current.meta.updatedAt = nowSeconds();
            set((state) => ({
                currentDoc: current,
                docPast: [...state.docPast, base.doc].slice(-DOC_HISTORY_CAP),
                docFuture: [],
            }));
            scheduleAutosave(current);
        },

        resetTransient: () => {
            transientBase = null;
        },

        restoreDoc: (previous) => {
            const current = get().currentDoc;
            // No open doc (gallery): nothing to restore onto.
            if (!current) return;
            // Semantic no-op guard (Esc with no edits): the pre-edit snapshot is
            // a `structuredClone` of the doc the session started from, so an
            // unedited session compares equal. Drop the transient baseline and
            // add no history entry, or undo would look dead.
            if (docsEqual(current, previous)) {
                transientBase = null;
                return;
            }
            // Restore the snapshot exactly as a committed op lands: the doc on
            // screen now (the live edit session's working copy) becomes the one
            // `docPast` entry, so `undoDoc` brings it back. `commit` clones
            // nothing, so clone the caller's snapshot first — the stored doc, its
            // `updatedAt` stamp and the pending autosave must not alias the
            // snapshot the caller still owns. `commit` also drops the transient
            // baseline and clears `docFuture`, matching `commitDoc`.
            commit(cloneDoc(previous), current);
        },

        clearDocHistory: () => {
            clearDocHistory();
        },

        flushAutosave: () => {
            return flushAutosave();
        },

        removeNode: (id) => {
            const doc = get().currentDoc;
            if (!doc || !doc.nodes.some((node) => node.id === id)) return;
            const next = cloneDoc(doc);
            const doomed = collectSubtreeIds(next.nodes, id);
            next.nodes = next.nodes.filter((node) => !doomed.has(node.id));
            commit(next, doc);
        },

        cloneNode: (id) => {
            const doc = get().currentDoc;
            if (!doc) return null;
            if (!doc.nodes.some((node) => node.id === id)) return null;
            const next = cloneDoc(doc);
            const result = cloneSubtree(next.nodes, id);
            if (!result) return null;
            const { clones, newRootId } = result;
            const rootClone = clones.find((node) => node.id === newRootId)!;
            rootClone.transform.x = safeRoundHm(rootClone.transform.x + CLONE_OFFSET_HM);
            rootClone.transform.y = safeRoundHm(rootClone.transform.y + CLONE_OFFSET_HM);
            const at = next.nodes.findIndex((node) => node.id === id);
            next.nodes.splice(at + 1, 0, ...clones);
            commit(next, doc);
            return newRootId;
        },

        reparentNode: (id, parentId, index) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const node = doc.nodes.find((entry) => entry.id === id);
            if (!node) return;
            // The new parent must be the root or a group.
            if (!isValidParent(doc.nodes, parentId)) return;
            // Cycle guard: a node may not become a child of itself or any of its
            // descendants. `collectSubtreeIds` includes `id`, so the first check
            // is the `parentId === id` case.
            if (parentId !== null && collectSubtreeIds(doc.nodes, id).has(parentId)) return;

            const next = cloneDoc(doc);
            const moved = next.nodes.find((entry) => entry.id === id)!;
            // Preserve the node's world placement across the parent change
            // (must-fix #4): fold the delta between the old and new effective
            // parent transforms into its local transform. `byId` is read before
            // the parentId flip, so the old parent chain is intact. Skip when
            // the parent is unchanged (plain sibling reorder) — the round-trip
            // through decompose/recompose would drift the transform.
            if (moved.parentId !== parentId) {
                preserveWorldTransform(moved, moved.parentId, parentId, nodeLookup(next.nodes));
            }
            moved.parentId = parentId;
            // Drop the node, then reinsert it among its new siblings at the
            // requested index so array order keeps encoding sibling z-order.
            const without = next.nodes.filter((entry) => entry.id !== id);
            const siblings = without.filter((entry) => entry.parentId === parentId);
            const clamped = Math.max(0, Math.min(index, siblings.length));
            let insertAt: number;
            if (clamped < siblings.length) insertAt = without.indexOf(siblings[clamped]!);
            else if (siblings.length > 0) insertAt = without.indexOf(siblings[siblings.length - 1]!) + 1;
            else insertAt = without.length;
            without.splice(insertAt, 0, moved);
            next.nodes = without;
            commit(next, doc);
        },

        moveNodeZ: (id, dir) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const node = doc.nodes.find((entry) => entry.id === id);
            if (!node) return;
            const siblings = doc.nodes.filter((entry) => entry.parentId === node.parentId);
            const position = siblings.findIndex((entry) => entry.id === id);
            const target = dir === 'up' ? position + 1 : position - 1;
            // Already front/back: no-op, no history entry, no clone.
            if (target < 0 || target >= siblings.length) return;
            const next = cloneDoc(doc);
            const neighbour = siblings[target]!;
            const from = next.nodes.findIndex((entry) => entry.id === id);
            const to = next.nodes.findIndex((entry) => entry.id === neighbour.id);
            [next.nodes[from], next.nodes[to]] = [next.nodes[to]!, next.nodes[from]!];
            commit(next, doc);
        },

        groupNodes: (ids) => {
            const doc = get().currentDoc;
            if (!doc) return null;
            const selected = new Set(
                ids.filter((id, index) => ids.indexOf(id) === index && doc.nodes.some((node) => node.id === id)),
            );
            // A group of one is pointless; require at least two members. This
            // also covers the empty case (`size === 0 < 2`).
            if (selected.size < 2) return null;
            const selectedNodes = doc.nodes.filter((node) => selected.has(node.id));
            // All grouped nodes must be siblings: grouping across parents would
            // silently re-parent nodes and break their local transforms.
            const parentId = selectedNodes[0]!.parentId;
            if (selectedNodes.some((node) => node.parentId !== parentId)) return null;
            // A group must not contain an ancestor together with its descendant.
            for (const node of selectedNodes) {
                const subtree = collectSubtreeIds(doc.nodes, node.id);
                if (selectedNodes.some((other) => other.id !== node.id && subtree.has(other.id))) {
                    return null;
                }
            }
            const next = cloneDoc(doc);
            const groupId = newLabelId();
            // Place the group at the topmost selected node's z slot.
            let insertAt = next.nodes.length;
            for (let i = 0; i < next.nodes.length; i += 1) {
                if (selected.has(next.nodes[i]!.id)) insertAt = i + 1;
            }
            for (const node of next.nodes) {
                if (selected.has(node.id)) node.parentId = groupId;
            }
            next.nodes.splice(insertAt, 0, makeGroupNode(groupId, parentId));
            commit(next, doc);
            return groupId;
        },

        ungroupNode: (id) => {
            const doc = get().currentDoc;
            if (!doc) return;
            const group = doc.nodes.find((entry) => entry.id === id);
            if (!group || group.type !== 'group') return;
            const next = cloneDoc(doc);
            const groupNode = next.nodes.find((entry) => entry.id === id)!;
            const children = next.nodes.filter((entry) => entry.parentId === id);
            // Filter by id (not parentId): the children's parentId is reassigned
            // below, so a parentId filter would stop matching them.
            const childIds = new Set(children.map((child) => child.id));
            // Preserve each child's world placement: the group's transform is
            // folded out and the group's parent transform folded in (must-fix
            // #4), so ungrouping a moved/rotated group leaves content in place.
            // `byId` is built before any parentId changes.
            const byId = nodeLookup(next.nodes);
            const groupWorld = effectiveTransform(groupNode, byId);
            const newParentWorld = parentWorldMatrix(groupNode.parentId, byId);
            for (const child of children) {
                const local = worldPreservingTransform(child.transform, groupWorld, newParentWorld);
                child.transform = local;
                child.parentId = groupNode.parentId;
            }
            // Splice the children into the group's own z slot, preserving their
            // relative order and dropping the group entry.
            const at = next.nodes.findIndex((entry) => entry.id === id);
            const before = next.nodes.slice(0, at).filter((entry) => !childIds.has(entry.id));
            const after = next.nodes.slice(at + 1).filter((entry) => !childIds.has(entry.id));
            next.nodes = [...before, ...children, ...after];
            commit(next, doc);
        },

        undoDoc: () => {
            const state = get();
            if (state.docPast.length === 0) return;
            const current = state.currentDoc;
            if (!current) return;
            const previous = state.docPast[state.docPast.length - 1]!;
            // Defensive identity guard: history is cleared on a doc switch, but a
            // snapshot from another document must never load into this editor
            // (the subsequent edits+autosave would corrupt the other label).
            if (previous.meta.id !== current.meta.id) {
                clearDocHistory();
                return;
            }
            // Any in-flight transient gesture is abandoned by undo.
            transientBase = null;
            const past = state.docPast.slice(0, -1);
            // Re-stamp `updatedAt` (epoch seconds): the gallery sorts on it, and
            // restoring a snapshot must surface as fresh activity.
            previous.meta.updatedAt = nowSeconds();
            set({
                currentDoc: previous,
                docPast: past,
                // LIFO: `redoDoc` takes from the front.
                docFuture: [current, ...state.docFuture],
            });
            scheduleAutosave(previous);
        },

        redoDoc: () => {
            const state = get();
            if (state.docFuture.length === 0) return;
            const current = state.currentDoc;
            const [next, ...rest] = state.docFuture;
            if (!next) return;
            // Same identity guard as `undoDoc`: never restore another doc's
            // snapshot into this editor.
            if (current && next.meta.id !== current.meta.id) {
                clearDocHistory();
                return;
            }
            transientBase = null;
            // Re-stamp on restore, matching `undoDoc` (gallery sort key).
            next.meta.updatedAt = nowSeconds();
            set({
                currentDoc: next,
                docPast: current
                    ? [...state.docPast, current].slice(-DOC_HISTORY_CAP)
                    : state.docPast,
                docFuture: rest,
            });
            scheduleAutosave(next);
        },
    };
};
