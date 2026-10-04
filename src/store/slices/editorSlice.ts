import { newLabelId, roundNode } from '../../core/doc/factory';
import { resizeNodeGeometry } from '../../core/doc/geometry';
import { roundHm } from '../../core/hm';
import type { GroupNode, LabelDoc, Node } from '../../core/doc/types';
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

/** Integer hm, or 0 for a non-finite number (matches `factory.ts` discipline). */
const safeRoundHm = (value: number): number => (Number.isFinite(value) ? roundHm(value) : 0);

/** `null`/missing parent is a valid root; otherwise the parent must be a group. */
const isValidParent = (nodes: readonly Node[], parentId: string | null): boolean => {
    if (parentId === null) return true;
    const parent = nodes.find((entry) => entry.id === parentId);
    return parent !== undefined && parent.type === 'group';
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

    // Baseline of an in-progress transient gesture. `null` when no gesture is
    // active; otherwise `currentDoc` is the working copy and this holds the
    // committed doc the gesture started from (the single undo target) plus its
    // id, so a doc switch mid-gesture can be detected and the stale baseline
    // discarded instead of committed into the wrong document's history.
    let transientBase: { docId: string; doc: LabelDoc } | null = null;

    /**
     * Persist `doc` through the repo if the current preferences allow a
     * background save. Never throws: a failed autosave is invisible by design
     * (the explicit save path owns user-visible errors), and `Promise.resolve()`
     * also catches a *synchronous* throw from `save`.
     */
    const saveDoc = (doc: LabelDoc, repo: NonNullable<ReturnType<typeof get>['labelRepo']>): void => {
        void Promise.resolve()
            .then(() => repo.save(doc))
            .then(() => get().setLastAutoSaveAt(Date.now()))
            .catch(() => undefined);
    };

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
            saveDoc(pending, repo);
        }, get().docAutosaveDelayMs);
    };

    /**
     * Flush a pending autosave immediately (if one is scheduled), saving the doc
     * captured at schedule time. Called on the view/doc boundary so leaving the
     * editor cannot drop the last edit. The write is independent of `view` (a
     * switch to the gallery must still persist), but still honours `autoSave`
     * and the presence of a repo.
     */
    const flushAutosave = (): void => {
        const pending = pendingAutosaveDoc;
        cancelAutosave();
        if (!pending) return;
        const state = get();
        if (!state.autoSave) return;
        const repo = state.labelRepo;
        if (!repo) return;
        saveDoc(pending, repo);
    };

    /**
     * Drop the undo/redo stacks and any transient baseline. The doc-switch
     * boundary calls this so history from doc A can never be applied to doc B.
     */
    const clearDocHistory = (): void => {
        transientBase = null;
        set({ docPast: [], docFuture: [] });
    };

    /** Replace the doc, push the previous snapshot, clear redo, autosave. */
    const commit = (next: LabelDoc, previous: LabelDoc): void => {
        // A committed op ends any transient gesture; its baseline must not leak
        // into a later `commitDoc`.
        transientBase = null;
        next.meta.updatedAt = nowSeconds();
        set((state) => ({
            currentDoc: next,
            docPast: [...state.docPast, previous].slice(-DOC_HISTORY_CAP),
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
            const clamped = Math.max(0, Math.round(index));
            // A no-op change must not create an undo entry (mirrors commitDoc).
            if (clamped === doc.data.sampleRowIndex) return;
            const next = cloneDoc(doc);
            next.data.sampleRowIndex = clamped;
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

        clearDocHistory: () => {
            clearDocHistory();
        },

        flushAutosave: () => {
            flushAutosave();
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
            for (const child of children) child.parentId = groupNode.parentId;
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
