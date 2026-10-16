// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../store/useStore';
import { createLabelDoc } from '../core/doc/factory';
import type { ImageNode, ImageRef, LabelDoc, Node, TextNode } from '../core/doc/types';
import type { ResourceRepo } from '../data/resourceRepo';
import {
    applyPaste,
    centeredInLabel,
    htmlToText,
    installPasteHandler,
    isEditableTarget,
    pastePayload,
    shouldIgnorePaste,
    storePasteHandlers,
} from './clipboardPaste';
import type { PasteData, PasteEventLike, PasteHandlers, PasteItem } from './clipboardPaste';

/**
 * Mock the whole import seam: the pixel decode needs a real canvas, and the
 * import is the one async step whose timing these tests drive.
 */
const importImageFileMock = vi.fn();
vi.mock('./assetImport', () => ({ importImageFile: (...args: unknown[]) => importImageFileMock(...args) }));

const IMAGE_REF: ImageRef = {
    imageId: 'img-1',
    name: 'pasted.png',
    source: { kind: 'local', mediaType: 'image/png', resourceId: 'img-1' },
    widthPx: 200,
    heightPx: 100,
};

const fileItem = (type: string, file: File | null = new File([new Uint8Array([1])], 'pasted.png', { type })): PasteItem => ({
    kind: 'file',
    type,
    getAsFile: () => file,
});

const textItem = (type = 'text/plain'): PasteItem => ({ kind: 'string', type, getAsFile: () => null });

/** A `DataTransfer` stand-in: the payload decision core only reads these. */
const dataTransfer = (items: PasteItem[], text = '', html = ''): PasteData => ({
    items,
    getData: (type) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
});

const event = (data: PasteData | null, target: EventTarget | null = null): PasteEventLike => ({
    clipboardData: data,
    target,
    preventDefault: vi.fn(),
});

/** Minimal in-memory `Storage`, mirroring the other store tests. */
const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => {
            map.delete(key);
        },
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
};

const fakeRepo = () => ({ put: vi.fn() }) as unknown as ResourceRepo;

const makeHandlers = (over: Partial<PasteHandlers> = {}) => {
    const doc = createLabelDoc({ id: 'doc-1', now: 1, backingW: 4000, backingH: 3000 });
    const added: Node[] = [];
    const replaced: LabelDoc[] = [];
    const handlers: PasteHandlers = {
        getDoc: () => doc,
        getResourceRepo: () => fakeRepo(),
        addNode: vi.fn((node: Node) => {
            added.push(node);
            return 'node-1';
        }),
        selectNode: vi.fn(),
        replaceDoc: vi.fn((next: LabelDoc) => {
            replaced.push(next);
        }),
        ...over,
    };
    return { handlers, added, replaced, doc };
};

afterEach(() => {
    importImageFileMock.mockReset();
});

describe('pastePayload', () => {
    it('prefers an image item over the text fallback', () => {
        const payload = pastePayload(dataTransfer([textItem(), fileItem('image/png')], 'pasted.png'));

        expect(payload?.kind).toBe('image');
        expect((payload as { file: File }).file.type).toBe('image/png');
    });

    it('prefers an image item over an HTML fallback too', () => {
        const payload = pastePayload(dataTransfer([fileItem('image/png'), textItem('text/html')], '', '<img src="x">'));

        expect(payload?.kind).toBe('image');
    });

    it('returns text when there is no image item', () => {
        expect(pastePayload(dataTransfer([textItem()], 'hello'))).toEqual({ kind: 'text', text: 'hello' });
    });

    it('returns null for whitespace-only text', () => {
        expect(pastePayload(dataTransfer([textItem()], '  \n\t '))).toBeNull();
    });

    it('returns null when the clipboard has no items and no text', () => {
        expect(pastePayload(dataTransfer([], ''))).toBeNull();
        // A missing `items` list (older/synthetic events) is fine too.
        expect(pastePayload({ getData: () => '' })).toBeNull();
    });

    it('ignores file items that are not images', () => {
        expect(pastePayload(dataTransfer([fileItem('text/plain')], ''))).toBeNull();
        expect(pastePayload(dataTransfer([fileItem('application/pdf'), fileItem('')], ''))).toBeNull();
    });

    it('takes the first usable image when several items are present', () => {
        const payload = pastePayload(
            dataTransfer([fileItem('application/pdf'), fileItem('image/jpeg'), fileItem('image/png')], ''),
        );

        expect((payload as { file: File }).file.type).toBe('image/jpeg');
    });

    it('falls through to text when an image item carries no file', () => {
        expect(pastePayload(dataTransfer([fileItem('image/png', null)], 'fallback'))).toEqual({
            kind: 'text',
            text: 'fallback',
        });
    });
});

describe('htmlToText / HTML-only clipboard', () => {
    it('takes the text content of the markup, whitespace collapsed', () => {
        expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
        expect(htmlToText('<div>a</div>\n   <div>b</div>')).toBe('a b');
    });

    it('pastes a text node from an HTML-only clipboard', () => {
        const payload = pastePayload(dataTransfer([textItem('text/html')], '', '<p>Hello <b>world</b></p>'));

        expect(payload).toEqual({ kind: 'text', text: 'Hello world' });
    });

    it('prefers the plain text when both flavours carry text', () => {
        const payload = pastePayload(dataTransfer([textItem(), textItem('text/html')], 'plain', '<p>html</p>'));

        expect(payload).toEqual({ kind: 'text', text: 'plain' });
    });

    it('returns null when the HTML carries no text', () => {
        expect(pastePayload(dataTransfer([textItem('text/html')], '   ', '<div></div>'))).toBeNull();
        expect(pastePayload(dataTransfer([], '', '<!-- a comment only -->'))).toBeNull();
    });

    it('drops <script> and <style> source text', () => {
        const html = '<style>p { color: red }</style><p>Hello <b>world</b></p><script>evil()</script>';

        expect(htmlToText(html)).toBe('Hello world');
        expect(pastePayload(dataTransfer([textItem('text/html')], '', html))).toEqual({ kind: 'text', text: 'Hello world' });
    });
});

describe('isEditableTarget / shouldIgnorePaste', () => {
    const fake = (fields: Record<string, unknown>) => fields as unknown as EventTarget;

    it('treats input / textarea / contenteditable as editable', () => {
        expect(isEditableTarget(fake({ tagName: 'INPUT' }))).toBe(true);
        expect(isEditableTarget(fake({ tagName: 'TEXTAREA' }))).toBe(true);
        expect(isEditableTarget(fake({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
        // A descendant of a contenteditable host.
        expect(isEditableTarget(fake({ tagName: 'SPAN', isContentEditable: false, closest: () => ({}) }))).toBe(true);
    });

    it('leaves the canvas and non-elements alone', () => {
        expect(isEditableTarget(fake({ tagName: 'CANVAS', isContentEditable: false, closest: () => null }))).toBe(false);
        expect(isEditableTarget(null)).toBe(false);
        expect(isEditableTarget(fake({}))).toBe(false);
    });

    it('ignores a paste behind an open modal even on the canvas', () => {
        expect(shouldIgnorePaste(fake({ tagName: 'CANVAS', closest: () => null }), { modalOpen: true, hasDoc: true })).toBe(
            true,
        );
    });

    it('ignores a paste with no open document, and honours an editable target', () => {
        expect(shouldIgnorePaste(fake({ tagName: 'CANVAS', closest: () => null }), { modalOpen: false, hasDoc: false })).toBe(
            true,
        );
        expect(shouldIgnorePaste(fake({ tagName: 'INPUT' }), { modalOpen: false, hasDoc: true })).toBe(true);
        expect(shouldIgnorePaste(fake({ tagName: 'CANVAS', closest: () => null }), { modalOpen: false, hasDoc: true })).toBe(
            false,
        );
    });

    it('applies the guards in the documented order: modal → editable → no doc', () => {
        // The target is only touched when the editable guard runs, so the order
        // is observable even though every branch returns the same answer here.
        const closest = vi.fn(() => null);
        const target = fake({ tagName: 'SPAN', isContentEditable: false, closest });

        expect(shouldIgnorePaste(target, { modalOpen: false, hasDoc: false })).toBe(true);
        expect(closest).toHaveBeenCalledWith('[contenteditable]');

        closest.mockClear();
        expect(shouldIgnorePaste(target, { modalOpen: true, hasDoc: true })).toBe(true);
        expect(closest).not.toHaveBeenCalled();
    });
});

describe('centeredInLabel', () => {
    it('centres the box in the backing', () => {
        expect(centeredInLabel(4000, 3000, 2000, 800)).toEqual({ x: 1000, y: 1100 });
    });
});

describe('applyPaste — text', () => {
    it('adds a centred text node carrying the pasted string and selects it', () => {
        const { handlers, added } = makeHandlers();
        const pasteEvent = event(dataTransfer([textItem()], 'hello'));

        applyPaste(pasteEvent, handlers, { modalOpen: false, hasDoc: true });

        expect(pasteEvent.preventDefault).toHaveBeenCalled();
        expect(added).toHaveLength(1);
        const node = added[0] as TextNode;
        expect(node.type).toBe('text');
        expect(node.text).toEqual({ kind: 'static', value: 'hello' });
        // Text default box is 2000×800 hm ⇒ centred in the 4000×3000 backing.
        expect(node.transform.x).toBe(1000);
        expect(node.transform.y).toBe(1100);
        expect(handlers.selectNode).toHaveBeenCalledWith('node-1');
        // `addNode` alone is the insert: no second doc write.
        expect(handlers.replaceDoc).not.toHaveBeenCalled();
    });

    it('does nothing when the guard rejects the paste', () => {
        const { handlers, added } = makeHandlers();

        applyPaste(event(dataTransfer([textItem()], 'hello')), handlers, { modalOpen: true, hasDoc: true });
        applyPaste(event(dataTransfer([textItem()], 'hello')), handlers, { modalOpen: false, hasDoc: false });

        expect(added).toHaveLength(0);
        expect(handlers.addNode).not.toHaveBeenCalled();
    });
});

describe('applyPaste — image', () => {
    it('writes the ref and the node in ONE doc replacement, then selects the node', async () => {
        importImageFileMock.mockResolvedValue({ ref: IMAGE_REF, bytes: new Uint8Array() });
        const { handlers, replaced, doc } = makeHandlers();

        applyPaste(event(dataTransfer([fileItem('image/png')])), handlers, { modalOpen: false, hasDoc: true });
        await vi.waitFor(() => expect(replaced).toHaveLength(1));

        const next = replaced[0]!;
        expect(next).not.toBe(doc);
        expect(next.resources.images).toHaveLength(1);
        expect(next.resources.images[0]).toEqual(IMAGE_REF);
        expect(next.nodes).toHaveLength(1);
        const node = next.nodes[0] as ImageNode;
        expect(node.type).toBe('image');
        expect(node.imageId).toBe('img-1');
        // A real minted id, not the factory's placeholder.
        expect(node.id).not.toBe('pending-insert');
        // maxSide = min(4000, 3000) - 200 = 2800; a 2:1 source → 2800×1400.
        expect(node.size).toEqual({ w: 2800, h: 1400 });
        expect(node.transform).toMatchObject({ x: 600, y: 800 });
        expect(handlers.selectNode).toHaveBeenCalledWith(node.id);
        // `addNode` would be a second commit, orphaning the ref on undo.
        expect(handlers.addNode).not.toHaveBeenCalled();
    });

    it('does not touch the source doc', async () => {
        importImageFileMock.mockResolvedValue({ ref: IMAGE_REF, bytes: new Uint8Array() });
        const { handlers, doc } = makeHandlers();

        applyPaste(event(dataTransfer([fileItem('image/png')])), handlers, { modalOpen: false, hasDoc: true });
        await vi.waitFor(() => expect(handlers.replaceDoc).toHaveBeenCalled());

        expect(doc.nodes).toHaveLength(0);
        expect(doc.resources.images).toHaveLength(0);
    });

    it('places nothing when the bytes cannot be decoded', async () => {
        importImageFileMock.mockRejectedValue(new Error('could not decode'));
        const { handlers, replaced } = makeHandlers();

        applyPaste(event(dataTransfer([fileItem('image/png')])), handlers, { modalOpen: false, hasDoc: true });

        await vi.waitFor(() => expect(importImageFileMock).toHaveBeenCalled());
        expect(replaced).toHaveLength(0);
        expect(handlers.replaceDoc).not.toHaveBeenCalled();
    });

    it('survives a refused store write (no rejection) and reclaims the stored bytes', async () => {
        importImageFileMock.mockResolvedValue({ ref: IMAGE_REF, bytes: new Uint8Array() });
        const repo = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } as unknown as ResourceRepo;
        const { handlers } = makeHandlers({
            getResourceRepo: () => repo,
            replaceDoc: vi.fn(() => {
                throw new Error('store refused the write');
            }),
        });

        applyPaste(event(dataTransfer([fileItem('image/png')])), handlers, { modalOpen: false, hasDoc: true });

        // The failure path is fully handled: it reclaims and never selects, so
        // there is nothing left to reject out of the event handler.
        await vi.waitFor(() => expect(repo.remove).toHaveBeenCalledWith('img-1'));
        expect(handlers.selectNode).not.toHaveBeenCalled();
    });

    it('never stores the same imageId twice, and reclaims the redundant bytes', async () => {
        // `importImageFile` mints a fresh resource id per import, so a colliding
        // `imageId` can only come from the caller — the branch is defensive.
        const freshRef: ImageRef = { ...IMAGE_REF, source: { kind: 'local', mediaType: 'image/png', resourceId: 'res-fresh' } };
        importImageFileMock.mockResolvedValue({ ref: freshRef, bytes: new Uint8Array() });
        const repo = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } as unknown as ResourceRepo;
        const registered = createLabelDoc({ id: 'doc-1', now: 1, backingW: 4000, backingH: 3000 });
        registered.resources.images.push(IMAGE_REF);
        const { handlers, replaced } = makeHandlers({ getDoc: () => registered, getResourceRepo: () => repo });

        applyPaste(event(dataTransfer([fileItem('image/png')])), handlers, { modalOpen: false, hasDoc: true });
        await vi.waitFor(() => expect(replaced).toHaveLength(1));

        // The node still points at the registered ref; only the fresh blob goes.
        expect(replaced[0]!.resources.images).toHaveLength(1);
        expect(replaced[0]!.resources.images[0]!.source).toEqual(IMAGE_REF.source);
        expect(replaced[0]!.nodes).toHaveLength(1);
        expect(repo.remove).toHaveBeenCalledTimes(1);
        expect(repo.remove).toHaveBeenCalledWith('res-fresh');
    });

    it('places nothing without resource storage', () => {
        const { handlers, replaced } = makeHandlers({ getResourceRepo: () => null });

        applyPaste(event(dataTransfer([fileItem('image/png')])), handlers, { modalOpen: false, hasDoc: true });

        expect(importImageFileMock).not.toHaveBeenCalled();
        expect(replaced).toHaveLength(0);
    });
});

// The store seams are the production ones, so these tests pin the real history
// behaviour (one undo entry per paste) rather than a mock's call count.
describe('applyPaste — undo depth (real store)', () => {
    const makeStore = (id = 'doc-1') => {
        const store = createAppStore(makeStorage());
        /** A repo spy: `put` is stubbed out by the mocked import, `remove` is the reclaim seam. */
        const repo = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } as unknown as ResourceRepo;
        store.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id, now: 1, backingW: 4000, backingH: 3000 }),
            selectedNodeIds: [],
            resourceRepo: repo,
            docPast: [],
            docFuture: [],
        });
        return { store, repo };
    };

    it('an image paste is exactly one undo entry, removing ref and node together', async () => {
        importImageFileMock.mockResolvedValue({ ref: IMAGE_REF, bytes: new Uint8Array() });
        const { store, repo } = makeStore();

        applyPaste(event(dataTransfer([fileItem('image/png')])), storePasteHandlers(store), {
            modalOpen: false,
            hasDoc: true,
        });
        await vi.waitFor(() => expect(store.getState().currentDoc?.nodes).toHaveLength(1));

        expect(store.getState().currentDoc?.resources.images).toHaveLength(1);
        expect(store.getState().docPast).toHaveLength(1);
        expect(store.getState().selectedNodeIds).toHaveLength(1);
        // A placed ref is never reclaimed.
        expect(repo.remove).not.toHaveBeenCalled();

        store.getState().undoDoc();

        expect(store.getState().currentDoc?.nodes).toHaveLength(0);
        expect(store.getState().currentDoc?.resources.images).toHaveLength(0);
    });

    it('a text paste is exactly one undo entry', () => {
        const { store } = makeStore();

        applyPaste(event(dataTransfer([textItem()], 'hello')), storePasteHandlers(store), {
            modalOpen: false,
            hasDoc: true,
        });

        expect(store.getState().currentDoc?.nodes).toHaveLength(1);
        expect(store.getState().docPast).toHaveLength(1);

        store.getState().undoDoc();

        expect(store.getState().currentDoc?.nodes).toHaveLength(0);
    });

    it('drops an image paste whose import resolves after the user switched documents', async () => {
        let releaseImport!: (value: { ref: ImageRef; bytes: Uint8Array }) => void;
        importImageFileMock.mockImplementation(
            () =>
                new Promise<{ ref: ImageRef; bytes: Uint8Array }>((resolve) => {
                    releaseImport = resolve;
                }),
        );
        const { store, repo } = makeStore('doc-a');

        applyPaste(event(dataTransfer([fileItem('image/png')])), storePasteHandlers(store), {
            modalOpen: false,
            hasDoc: true,
        });
        await vi.waitFor(() => expect(importImageFileMock).toHaveBeenCalled());
        expect(store.getState().currentDoc?.nodes).toHaveLength(0);

        // The user opens another label while the bytes are still decoding.
        store.setState({
            currentDoc: createLabelDoc({ id: 'doc-b', now: 2, backingW: 4000, backingH: 3000 }),
            selectedNodeIds: [],
            docPast: [],
        });
        releaseImport({ ref: IMAGE_REF, bytes: new Uint8Array() });
        // The bytes `importImageFile` already stored must be reclaimed: no ref
        // points at them any more, in either document.
        await vi.waitFor(() => expect(repo.remove).toHaveBeenCalledWith('img-1'));

        expect(store.getState().currentDoc?.meta.id).toBe('doc-b');
        expect(store.getState().currentDoc?.nodes).toHaveLength(0);
        expect(store.getState().currentDoc?.resources.images).toHaveLength(0);
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().selectedNodeIds).toHaveLength(0);
    });

    it('applies an image paste onto the live same-document state', async () => {
        importImageFileMock.mockResolvedValue({ ref: IMAGE_REF, bytes: new Uint8Array() });
        const { store } = makeStore();

        applyPaste(event(dataTransfer([fileItem('image/png')])), storePasteHandlers(store), {
            modalOpen: false,
            hasDoc: true,
        });
        // An edit lands while the import is in flight; the paste must not revert it.
        store.getState().renameDoc('renamed mid-import');
        await vi.waitFor(() => expect(store.getState().currentDoc?.nodes).toHaveLength(1));

        expect(store.getState().currentDoc?.meta.name).toBe('renamed mid-import');
        expect(store.getState().currentDoc?.resources.images).toHaveLength(1);
    });
});

// The real listener is exercised through the DOM: only the two DOM-only facts
// (the `dialog[open]` query and the event target) live outside `applyPaste`.
describe('installPasteHandler', () => {
    const pasteOn = (target: EventTarget, data: PasteData) => {
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data as unknown as DataTransfer,
        });
        target.dispatchEvent(pasteEvent);
        return pasteEvent;
    };

    it('inserts on a canvas paste and stops after cleanup', () => {
        const { handlers, added } = makeHandlers();
        const cleanup = installPasteHandler(handlers);

        pasteOn(document.body, dataTransfer([textItem()], 'hello'));
        expect(added).toHaveLength(1);

        cleanup();
        pasteOn(document.body, dataTransfer([textItem()], 'again'));
        expect(added).toHaveLength(1);
    });

    it('bails behind a modal dialog', () => {
        const { handlers, added } = makeHandlers();
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        const cleanup = installPasteHandler(handlers);

        try {
            pasteOn(document.body, dataTransfer([textItem()], 'hello'));
            expect(added).toHaveLength(0);
        } finally {
            cleanup();
            dialog.remove();
        }
    });

    it('still pastes while a non-modal [data-popover] dialog is open', () => {
        const { handlers, added } = makeHandlers();
        const popover = document.createElement('dialog');
        popover.setAttribute('open', '');
        popover.setAttribute('data-popover', '');
        document.body.appendChild(popover);
        const cleanup = installPasteHandler(handlers);

        try {
            pasteOn(document.body, dataTransfer([textItem()], 'hello'));
            expect(added).toHaveLength(1);
        } finally {
            cleanup();
            popover.remove();
        }
    });

    it('keeps the native paste inside an editable target', () => {
        const { handlers, added } = makeHandlers();
        const input = document.createElement('input');
        document.body.appendChild(input);
        const cleanup = installPasteHandler(handlers);

        try {
            pasteOn(input, dataTransfer([textItem()], 'hello'));
            expect(added).toHaveLength(0);
        } finally {
            cleanup();
            input.remove();
        }
    });
});
