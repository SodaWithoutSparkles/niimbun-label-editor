import { newLabelId } from '../core/doc/factory';
import type { hm } from '../core/hm';
import type { LabelDoc, Node, ImageRef } from '../core/doc/types';
import type { ResourceRepo } from '../data/resourceRepo';
import { importImageFile } from './assetImport';
import { createImageNodeForRef, createNodeForInsert } from './insertActions';

/**
 * System paste on the editor canvas (backlog: "Handle paste properly"). A paste
 * with an image creates a new image object; a paste with text creates a new
 * text object.
 *
 * Split in two so the interesting half is testable without DOM events:
 *
 * - {@link pastePayload} / {@link htmlToText} / {@link isEditableTarget} /
 *   {@link shouldIgnorePaste} / {@link centeredInLabel} are pure.
 * - {@link installPasteHandler} owns the window listener and the DOM-only guard
 *   (`dialog[open]`). Its store seams come from {@link storePasteHandlers}, so
 *   the module imports no store: a test can pass the real store (or a fake).
 *
 * One undo entry per paste. The text path inserts through `addNode`, which is
 * already exactly one committed op (the trailing `selectNode` is view state, not
 * history). The image path has to write **two** things — the `ImageRef` and the
 * node — and the store exposes no combined action (`addImageRef` and `addNode`
 * each commit on their own), so it builds the complete next doc and hands it to
 * `replaceDoc` *once*: one `docPast` entry removes ref and node together.
 *
 * Placement reuses `insertActions` and centres the new node's box in the label
 * backing — the `InsertRail.handleImageImported` convention. A *viewport*-centre
 * helper is not reachable from here: the viewport is local state inside
 * `PreviewStage`, so no stray screen-to-world math is re-implemented.
 *
 * An image paste that cannot be placed — the document was switched or closed
 * while the bytes were still decoding, or a store write was refused — reclaims
 * the blob `importImageFile` already stored, so an aborted paste leaves no
 * orphaned resource behind. Nothing in the paste path rejects: a failure is a
 * no-op, never an unhandled rejection out of an event handler.
 */

/** What a paste should create, or `null` when nothing usable is on the clipboard. */
export type PastePayload = { kind: 'image'; file: File } | { kind: 'text'; text: string };

/** The `DataTransferItem` fields the decision core reads. */
export interface PasteItem {
    kind: string;
    type: string;
    getAsFile(): File | null;
}

/** Structural subset of `DataTransfer` the decision core needs (fake-friendly). */
export interface PasteData {
    items?: ArrayLike<PasteItem> | null;
    getData(type: string): string;
}

/**
 * Plain text from a `text/html` clipboard payload. A copy from a browser or
 * Office often carries the readable text **only** in `text/html` (with a blank
 * or missing `text/plain`), so the markup is parsed and its text content taken,
 * then whitespace-collapsed. Returns `''` when the markup carries no text.
 *
 * `DOMParser` is guarded: this module is also imported in DOM-less environments.
 */
export const htmlToText = (html: string): string => {
    if (typeof DOMParser === 'undefined') return '';
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    // `textContent` would otherwise include the *source* of `<script>`/`<style>`
    // (a copied page or CMS snippet), which is never label text.
    parsed.querySelectorAll('script,style').forEach((node) => node.remove());
    return (parsed.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/**
 * Decide what a paste should create. Images win over text: an image paste
 * usually carries a text fallback too (the file name, or an empty `text/html`),
 * and the image is what the user means. Non-`image/*` file items are ignored,
 * and so is blank text — `text/plain` first, then `text/html` as the fallback.
 * `null` means "nothing to insert".
 */
export const pastePayload = (data: PasteData): PastePayload | null => {
    const items = data.items;
    if (items) {
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (!item || item.kind !== 'file' || !item.type.startsWith('image/')) continue;
            const file = item.getAsFile();
            if (file) return { kind: 'image', file };
        }
    }
    const text = data.getData('text/plain');
    if (text.trim() !== '') return { kind: 'text', text };
    const fromHtml = htmlToText(data.getData('text/html'));
    return fromHtml === '' ? null : { kind: 'text', text: fromHtml };
};

/**
 * True when a paste targets a text-entry control — an `input`, `textarea`, any
 * `contenteditable` element (or a descendant of one). The global canvas handler
 * then leaves the event alone, so the browser's native paste runs: the inline
 * text editor (`TextEditorOverlay`) and the inspector fields rely on it. Widens
 * `utils/keyboardTarget.isTypingTarget` to the `[contenteditable]` ancestor case.
 */
export const isEditableTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element || typeof element.tagName !== 'string') return false;
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if (element.isContentEditable === true) return true;
    return typeof element.closest === 'function' && element.closest('[contenteditable]') !== null;
};

/** The DOM-level bails the window handler must apply. */
export interface PasteGuards {
    /** A *modal* `<dialog open>` is in the document. */
    modalOpen: boolean;
    /** A document is open. */
    hasDoc: boolean;
}

/**
 * The guard order the handler applies: behind ANY modal, then an editable
 * target, then no open document. `inert` on a top-layer dialog does not stop
 * `paste` from bubbling to `window` (same rule as `EditorKeyboardShortcuts`),
 * so the modal check has to live here.
 */
export const shouldIgnorePaste = (target: EventTarget | null, guards: PasteGuards): boolean =>
    guards.modalOpen || isEditableTarget(target) || !guards.hasDoc;

/** The store seams the handler needs; each is read/called at paste time. */
export interface PasteHandlers {
    /** The open document, or `null`. */
    getDoc(): LabelDoc | null;
    /** Resource storage; without it image bytes cannot be stored, so no image node. */
    getResourceRepo(): ResourceRepo | null;
    /** Mints the real id; returns it, or `null` when the add was refused. */
    addNode(node: Node): string | null;
    selectNode(id: string): void;
    /**
     * Replace the open document with `next` as exactly ONE undo entry. Wired to
     * the store's `restoreDoc` — the only public whole-doc write (the slice's
     * `commit` is private). Guarded by the caller: it must never be handed a doc
     * built from another document.
     */
    replaceDoc(next: LabelDoc): void;
}

/** The store slice of `AppState` the seams read (`useStore` satisfies this). */
export interface PasteStore {
    getState(): {
        currentDoc: LabelDoc | null;
        resourceRepo: ResourceRepo | null;
        addNode(node: Node): string | null;
        selectNode(id: string): void;
        restoreDoc(doc: LabelDoc): void;
    };
}

/** Bind the paste seams to a store, reading live state at paste time (no stale closure). */
export const storePasteHandlers = (store: PasteStore): PasteHandlers => ({
    getDoc: () => store.getState().currentDoc,
    getResourceRepo: () => store.getState().resourceRepo,
    addNode: (node) => store.getState().addNode(node),
    selectNode: (id) => store.getState().selectNode(id),
    replaceDoc: (next) => store.getState().restoreDoc(next),
});

/** The `ClipboardEvent` fields the handler reads (fake-friendly). */
export interface PasteEventLike {
    clipboardData: PasteData | null;
    target: EventTarget | null;
    preventDefault(): void;
}

/**
 * Top-left of a `w×h` box centred in the label backing (hm), mirroring
 * `InsertRail.handleImageImported`.
 */
export const centeredInLabel = (backingW: hm, backingH: hm, w: hm, h: hm): { x: hm; y: hm } => ({
    x: Math.round((backingW - w) / 2),
    y: Math.round((backingH - h) / 2),
});

/** Build the text node for a pasted string, centred, then add + select it. */
const createTextAtCentre = (handlers: PasteHandlers, value: string): void => {
    const doc = handlers.getDoc();
    if (!doc) return;
    const node = createNodeForInsert('text', 0, 0);
    if (!node || node.type !== 'text' || node.text.kind !== 'static') return;
    // The pasted string replaces the empty default payload before the store
    // clones the node, so the whole insert is one undo entry.
    node.text.value = value;
    const centre = centeredInLabel(doc.label.backingW, doc.label.backingH, node.size?.w ?? 0, node.size?.h ?? 0);
    node.transform.x = centre.x;
    node.transform.y = centre.y;
    const id = handlers.addNode(node);
    if (id) handlers.selectNode(id);
};

/**
 * Stage the ref and the node into ONE doc replacement, so one undo removes both
 * (two store calls would leave an orphaned ref behind when the node is undone).
 * The store action is `restoreDoc`, which pushes the doc now on screen onto
 * `docPast` and adopts the given doc — exactly one entry.
 *
 * Returns whether `ref`'s own bytes are now referenced by the doc: `false` when
 * an entry with the same `imageId` was already registered, in which case the
 * just-imported blob is unreferenced and the caller reclaims it.
 */
const stageImagePaste = (doc: LabelDoc, handlers: PasteHandlers, ref: ImageRef): boolean => {
    const next = structuredClone(doc);
    // `importImageFile` mints a fresh resource id per import, so a duplicate can
    // only come from a caller handing us a ref twice; never store it twice.
    const alreadyRegistered = next.resources.images.some((entry) => entry.imageId === ref.imageId);
    if (!alreadyRegistered) next.resources.images.push(structuredClone(ref));
    const maxSide = Math.max(500, Math.min(doc.label.backingW, doc.label.backingH) - 200);
    const node = createImageNodeForRef(0, 0, ref, maxSide as hm);
    const centre = centeredInLabel(doc.label.backingW, doc.label.backingH, node.size?.w ?? 0, node.size?.h ?? 0);
    node.transform.x = centre.x;
    node.transform.y = centre.y;
    // The store's `addNode` mints ids; this path must mint the same way, because
    // it writes the node itself rather than through that action.
    const id = newLabelId();
    next.nodes.push({ ...node, id });
    handlers.replaceDoc(next);
    handlers.selectNode(id);
    return !alreadyRegistered;
};

/**
 * Drop an imported-but-abandoned local resource. Best effort: the gallery's
 * orphan sweep is the backstop, so nothing here may surface — not a failing
 * delete, and not a failing `getDoc`.
 *
 * A blob another ref still points at is never deleted: the duplicate-`imageId`
 * branch registers none of ours but can share the stored blob.
 */
const reclaimImportedRef = async (handlers: PasteHandlers, repo: ResourceRepo, ref: ImageRef): Promise<void> => {
    try {
        if (ref.source.kind !== 'local') return;
        const resourceId = ref.source.resourceId;
        const doc = handlers.getDoc();
        const stillReferenced = doc?.resources.images.some(
            (entry) => entry.source.kind === 'local' && entry.source.resourceId === resourceId,
        );
        if (stillReferenced) return;
        await repo.remove(resourceId);
    } catch {
        // Opportunistic reclaim only.
    }
};

/**
 * Import the pasted file, register the ref, place the node centred, select it.
 *
 * The import is the only async step, so a document switch while it is in flight
 * must place nothing: the paste is dropped rather than written into whatever is
 * open by the time the bytes decode. `importImageFile` has already stored the
 * bytes by then, so every abandoned path hands them back rather than leaving an
 * orphan blob behind. If the *same* document was edited meanwhile the paste is
 * re-applied on top of the live state (never on the stale snapshot).
 *
 * Nothing here may reject: a refused store write is not worth an unhandled
 * rejection in an event handler.
 */
const createImageAtCentre = async (handlers: PasteHandlers, file: File): Promise<void> => {
    let repo: ResourceRepo | null = null;
    let ref: ImageRef | null = null;
    let registered = false;
    try {
        repo = handlers.getResourceRepo();
        const startedDoc = handlers.getDoc();
        if (!repo || !startedDoc) return;
        ({ ref } = await importImageFile(file, repo, {}));
        const doc = handlers.getDoc();
        // `replaceDoc`/`restoreDoc` has no cross-document guard of its own
        // (`commit`'s `docId` check covers `commitDoc`, not this path).
        if (doc && doc.meta.id === startedDoc.meta.id) registered = stageImagePaste(doc, handlers, ref);
    } catch {
        // An undecodable image, or a store seam refusing the write: both end as
        // "no paste". A doc switch is not an error — it simply leaves
        // `registered` false — but it needs the same reclaim.
        registered = false;
    }
    if (!registered && ref && repo) await reclaimImportedRef(handlers, repo, ref);
};

/**
 * Apply one paste event: guard, decide, insert. Separated from the listener so
 * a test can drive it with a fake event and fake handlers.
 */
export const applyPaste = (event: PasteEventLike, handlers: PasteHandlers, guards: PasteGuards): void => {
    if (shouldIgnorePaste(event.target, guards)) return;
    const data = event.clipboardData;
    if (!data) return;
    const payload = pastePayload(data);
    if (!payload) return;
    // A usable payload is consumed here; the browser default (e.g. navigating to
    // a dropped file) must not also run.
    event.preventDefault();
    if (payload.kind === 'text') {
        createTextAtCentre(handlers, payload.text);
        return;
    }
    void createImageAtCentre(handlers, payload.file);
};

/**
 * Install the editor's window `paste` listener. StrictMode-safe / idempotent:
 * one listener per call and the returned cleanup removes exactly that one.
 */
export const installPasteHandler = (handlers: PasteHandlers): (() => void) => {
    const onPaste = (event: Event) => {
        applyPaste(event as unknown as PasteEventLike, handlers, {
            // Only real modals suppress paste: a non-modal popover is also a
            // `<dialog open>` (`ConnectionChip`'s `data-popover`), and typing a
            // paste while it is up must still reach the canvas (mirrors
            // `NotificationCenter`'s scoped query).
            modalOpen: document.querySelector('dialog[open]:not([data-popover])') !== null,
            hasDoc: handlers.getDoc() !== null,
        });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
};
