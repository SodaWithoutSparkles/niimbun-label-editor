// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo } from '../../data/resourceRepo';
import { resolve } from '../../editor/render/resolve';
import type { FontRef, ImageRef, LabelDoc, Node } from '../../core/doc/types';
import type { PreparedAsset } from '../../editor/render/assets';
import type { ResolvedBarcode, ResolvedNode, ResolvedQr } from '../../editor/render/resolve';

/**
 * The render seam is mocked so these tests exercise the hook's orchestration
 * (font registration order + content-keyed results), not the decoders.
 */
const { ensureFontsSpy, prepareSpy } = vi.hoisted(() => ({
    ensureFontsSpy: vi.fn(async () => {}),
    prepareSpy: vi.fn(),
}));

vi.mock('../../editor/render/fontAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/render/fontAssets')>();
    return {
        ...actual,
        createFontProvider: vi.fn(() => ({ ensureFonts: ensureFontsSpy })),
    };
});

vi.mock('../../editor/render/prepareAssets', () => ({
    prepareResolvedAssets: prepareSpy,
}));

import { assetSignatureOf, usePreparedAssets, createResourceAssetDeps } from './usePreparedAssets';

const emptyPrepared = () => ({ assets: new Map<string, PreparedAsset>(), warnings: new Map() });

/** Stable identity, as `PreviewStage` supplies via `useMemo`. */
const NO_NODES: readonly ResolvedNode[] = [];

const transform = { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };

const qrNode = (id = 'q1', value = 'hello', w = 100, h = 100): Node => ({
    id,
    parentId: null,
    type: 'qr',
    visible: true,
    locked: false,
    transform: { ...transform },
    size: { w, h },
    data: { kind: 'static', value },
});

const imageNode = (id = 'i1', imageId = 'img-1'): Node => ({
    id,
    parentId: null,
    type: 'image',
    visible: true,
    locked: false,
    transform: { ...transform },
    size: { w: 200, h: 200 },
    imageId,
});

const textNode = (id = 't1'): Node => ({
    id,
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { ...transform },
    size: { w: 100, h: 40 },
    text: { kind: 'static', value: 'hi' },
});

const barcodeNode = (id = 'b1', value = '123456', w = 200, h = 60): Node => ({
    id,
    parentId: null,
    type: 'barcode',
    visible: true,
    locked: false,
    transform: { ...transform },
    size: { w, h },
    data: { kind: 'static', value },
});

/** A group node plus the given children re-parented under it. */
const groupWith = (id: string, children: Node[]): Node[] => [
    {
        id,
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { ...transform },
    },
    ...children.map((child) => ({ ...child, parentId: id })),
];

const makeDoc = (
    nodes: Node[],
    opts: { id?: string; images?: ImageRef[]; dpi?: number } = {},
): LabelDoc => {
    const doc = createLabelDoc({
        id: opts.id ?? 'doc-1',
        now: 1_700_000_000,
        backingW: 3000,
        backingH: 2000,
        nodes,
        ...(opts.dpi !== undefined ? { dpi: opts.dpi } : {}),
    });
    doc.resources.images = opts.images ?? [];
    return doc;
};

/** The scene graph `PreviewStage` builds synchronously from the live doc. */
const resolveDoc = (doc: LabelDoc): ResolvedNode[] => resolve(doc);

const localImage = (resourceId = 'r1', fingerprint?: string): ImageRef => ({
    imageId: 'img-1',
    name: 'img',
    widthPx: 200,
    heightPx: 200,
    source: {
        kind: 'local',
        mediaType: 'image/png',
        resourceId,
        ...(fingerprint !== undefined ? { fingerprint } : {}),
    },
});

const preparedAsset = (): PreparedAsset => ({
    image: {} as unknown as CanvasImageSource,
    widthPx: 1,
    heightPx: 1,
});

const preparedWith = (id: string) => ({
    assets: new Map([[id, preparedAsset()]]),
    warnings: new Map(),
});

const importedFont: FontRef = {
    fontId: 'f1',
    familyName: 'Imported',
    name: 'Imported',
    source: { kind: 'imported', asset: { kind: 'local', mediaType: 'font/ttf', resourceId: 'f1' } },
};

const withRepo = (): void => {
    const repo = createResourceRepo(createMemoryAdapter());
    useStore.setState({ resourceRepo: repo, effectiveZoom: 1 });
};

beforeEach(() => {
    prepareSpy.mockReset();
    prepareSpy.mockResolvedValue(emptyPrepared());
    ensureFontsSpy.mockClear();
});

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, resourceRepo: null, effectiveZoom: 1 });
});

describe('usePreparedAssets (P5 render seam)', () => {
    it('registers imported fonts before preparing (must-fix #3)', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        doc.resources.fonts.push(importedFont);
        const nodes = resolveDoc(doc);

        const { result } = renderHook(() => usePreparedAssets(nodes, doc));

        await waitFor(() => expect(ensureFontsSpy).toHaveBeenCalledWith(doc));
        await waitFor(() => expect(result.current.assets).toBeInstanceOf(Map));
        // Fonts are registered before the prepare call, not after.
        expect(ensureFontsSpy.mock.invocationCallOrder[0]).toBeLessThan(
            prepareSpy.mock.invocationCallOrder[0]!,
        );
    });

    it('reports empty assets for a changed document until its prepare settles (must-fix #6)', async () => {
        withRepo();
        const docA = makeDoc([qrNode()]);
        const nodes = resolveDoc(docA);
        prepareSpy.mockResolvedValueOnce(preparedWith('q1'));

        const { result, rerender } = renderHook(
            ({ doc }: { doc: LabelDoc | null }) => usePreparedAssets(nodes, doc),
            { initialProps: { doc: docA as LabelDoc | null } },
        );

        await waitFor(() => expect(result.current.assets.size).toBe(1));

        // A new document: its prepare never settles, so the previous document's
        // assets must not leak into the new render.
        prepareSpy.mockImplementation(() => new Promise(() => {}));
        const docB = makeDoc([qrNode()], { id: 'doc-2' });
        rerender({ doc: docB });

        expect(result.current.assets.size).toBe(0);
        expect(result.current.warnings.size).toBe(0);
    });

    it('never throws when font registration rejects', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        const nodes = resolveDoc(doc);
        ensureFontsSpy.mockRejectedValueOnce(new Error('no fonts'));

        const { result } = renderHook(() => usePreparedAssets(nodes, doc));

        // The prepare still runs and the hook still resolves to a result.
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledWith(nodes, doc, expect.anything()));
        await waitFor(() => expect(result.current).toBeDefined());
    });

    it('keeps provider identity stable across a zoom change (cache + font registration survive)', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        const nodes = resolveDoc(doc);

        renderHook(() => usePreparedAssets(nodes, doc));
        await waitFor(() => expect(prepareSpy).toHaveBeenCalled());
        const firstDeps = prepareSpy.mock.calls[0]![2];

        // A zoom tick must NOT rebuild the providers: their identity is the
        // decode-cache scope and the FontFace registry. Only the cap changes.
        act(() => {
            useStore.setState({ effectiveZoom: 2 });
        });
        await waitFor(() => expect(prepareSpy.mock.calls.length).toBeGreaterThan(1));
        const lastDeps = prepareSpy.mock.calls.at(-1)![2];

        expect(lastDeps.images).toBe(firstDeps.images);
        expect(lastDeps.fonts).toBe(firstDeps.fonts);
        expect(lastDeps.imageScale).not.toBe(firstDeps.imageScale);
    });

    it('drops a zero/non-finite imageScale so it falls back to the doc dpi', () => {
        const repo = createResourceRepo(createMemoryAdapter());
        // The initial `effectiveZoom` is 0: a zero-size cap must never be built.
        expect('imageScale' in createResourceAssetDeps(repo, 0)).toBe(false);
        expect('imageScale' in createResourceAssetDeps(repo, Number.NaN)).toBe(false);
        expect('imageScale' in createResourceAssetDeps(repo, Number.POSITIVE_INFINITY)).toBe(false);
        // A finite, positive scale is still forwarded.
        expect(createResourceAssetDeps(repo, 1.5).imageScale).toBe(1.5);
    });
});

describe('usePreparedAssets — content-keyed raster cache (canvas-flash fix)', () => {
    it('keeps the previous rasters when a new nodes identity carries identical content', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        const first = resolveDoc(doc);
        const second = resolveDoc(doc); // fresh identity, byte-identical content
        expect(second).not.toBe(first);

        prepareSpy.mockResolvedValue(preparedWith('q1'));
        const { result, rerender } = renderHook(
            ({ nodes }: { nodes: readonly ResolvedNode[] }) => usePreparedAssets(nodes, doc),
            { initialProps: { nodes: first } },
        );
        await waitFor(() => expect(result.current.assets.size).toBe(1));
        expect(prepareSpy).toHaveBeenCalledTimes(1);
        const retained = result.current;

        prepareSpy.mockClear();
        ensureFontsSpy.mockClear();
        rerender({ nodes: second });

        // Same content signature → the previous rasters survive (no EMPTY frame)
        // and neither the font pass nor the prepare re-runs.
        expect(result.current).toBe(retained);
        expect(result.current.assets.size).toBe(1);
        expect(prepareSpy).not.toHaveBeenCalled();
        expect(ensureFontsSpy).not.toHaveBeenCalled();
    });

    it('clears then re-prepares when a qr text changes', async () => {
        withRepo();
        const docA = makeDoc([qrNode('q1', 'A')]);
        const docB = makeDoc([qrNode('q1', 'B')]);
        prepareSpy.mockResolvedValue(preparedWith('q1'));

        const { result, rerender } = renderHook(
            ({ nodes, doc }: { nodes: readonly ResolvedNode[]; doc: LabelDoc }) =>
                usePreparedAssets(nodes, doc),
            { initialProps: { nodes: resolveDoc(docA), doc: docA } },
        );
        await waitFor(() => expect(result.current.assets.size).toBe(1));

        rerender({ nodes: resolveDoc(docB), doc: docB });
        expect(result.current.assets.size).toBe(0); // EMPTY for one render
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.assets.size).toBe(1));
    });

    it('clears then re-prepares when the referenced image bytes change', async () => {
        withRepo();
        const docA = makeDoc([imageNode()], { images: [localImage('r1')] });
        const docB = makeDoc([imageNode()], { images: [localImage('r2')] });
        // The resolved node content is identical; only the ImageRef source differs.
        const nodes = resolveDoc(docA);
        expect(resolveDoc(docB)).toEqual(nodes);
        prepareSpy.mockResolvedValue(preparedWith('i1'));

        const { result, rerender } = renderHook(
            ({ doc }: { doc: LabelDoc }) => usePreparedAssets(nodes, doc),
            { initialProps: { doc: docA } },
        );
        await waitFor(() => expect(result.current.assets.size).toBe(1));

        rerender({ doc: docB });
        expect(result.current.assets.size).toBe(0);
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
    });

    it('clears then re-prepares when an asset leaf w/h changes', async () => {
        withRepo();
        const docA = makeDoc([qrNode('q1', 'hello', 100, 100)]);
        const docB = makeDoc([qrNode('q1', 'hello', 200, 100)]);
        prepareSpy.mockResolvedValue(preparedWith('q1'));

        const { result, rerender } = renderHook(
            ({ nodes, doc }: { nodes: readonly ResolvedNode[]; doc: LabelDoc }) =>
                usePreparedAssets(nodes, doc),
            { initialProps: { nodes: resolveDoc(docA), doc: docA } },
        );
        await waitFor(() => expect(result.current.assets.size).toBe(1));

        rerender({ nodes: resolveDoc(docB), doc: docB });
        expect(result.current.assets.size).toBe(0);
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
    });

    it('keeps the previous raster across a zoom change, then swaps in the re-capped one', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        const nodes = resolveDoc(doc);
        // A fresh result per call so the committed re-cap is observable.
        prepareSpy.mockImplementation(async () => preparedWith('q1'));

        const { result } = renderHook(() => usePreparedAssets(nodes, doc));
        await waitFor(() => expect(result.current.assets.size).toBe(1));
        const beforeZoom = result.current;
        expect(prepareSpy).toHaveBeenCalledTimes(1);

        // A zoom changes `imageScale`/`symbolScale` (deps), not the resolved
        // content, so the previous raster is retained for the frame before the
        // re-capped one lands — no empty frame (the pre-fix behaviour).
        act(() => {
            useStore.setState({ effectiveZoom: 2 });
        });
        expect(result.current).toBe(beforeZoom);
        expect(result.current.assets.size).toBe(1);

        // The prepare still re-runs and commits the freshly re-capped raster.
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current).not.toBe(beforeZoom));
        expect(result.current.assets.size).toBe(1);
    });

    it('clears on a document switch even with identical content (must-fix #6)', async () => {
        withRepo();
        const docA = makeDoc([qrNode()], { id: 'doc-1' });
        const docB = makeDoc([qrNode()], { id: 'doc-2' });
        const nodes = resolveDoc(docA);
        expect(resolveDoc(docB)).toEqual(nodes);
        prepareSpy.mockResolvedValue(preparedWith('q1'));

        const { result, rerender } = renderHook(
            ({ doc }: { doc: LabelDoc }) => usePreparedAssets(nodes, doc),
            { initialProps: { doc: docA } },
        );
        await waitFor(() => expect(result.current.assets.size).toBe(1));

        rerender({ doc: docB });
        expect(result.current.assets.size).toBe(0);
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
    });

    it('never prepares a document with only shapes/text', async () => {
        withRepo();
        const doc = makeDoc([textNode()]);
        const nodes = resolveDoc(doc);

        const { result } = renderHook(() => usePreparedAssets(nodes, doc));

        // The effect still runs (fonts register) but there is nothing to rasterize.
        await waitFor(() => expect(ensureFontsSpy).toHaveBeenCalled());
        expect(prepareSpy).not.toHaveBeenCalled();
        expect(result.current.assets.size).toBe(0);
    });

    it('prepares an asset leaf nested inside a group', async () => {
        withRepo();
        const docA = makeDoc(groupWith('g1', [qrNode('q1', 'A')]));
        const docB = makeDoc(groupWith('g1', [qrNode('q1', 'B')]));
        prepareSpy.mockResolvedValue(preparedWith('q1'));

        const { result, rerender } = renderHook(
            ({ nodes, doc }: { nodes: readonly ResolvedNode[]; doc: LabelDoc }) =>
                usePreparedAssets(nodes, doc),
            { initialProps: { nodes: resolveDoc(docA), doc: docA } },
        );
        await waitFor(() => expect(result.current.assets.size).toBe(1));

        // The nested leaf's content change must still clear + re-prepare.
        rerender({ nodes: resolveDoc(docB), doc: docB });
        expect(result.current.assets.size).toBe(0);
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
    });
});

describe('usePreparedAssets — bounded self-heal for failed assets', () => {
    const failing = { assets: new Map(), warnings: new Map([['q1', 'missing']]) };

    it('arms a focus/online retry on failure and disarms it after a success', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        const nodes = resolveDoc(doc);
        prepareSpy.mockResolvedValue(failing);

        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        try {
            const { result } = renderHook(() => usePreparedAssets(nodes, doc));
            await waitFor(() => expect(result.current.warnings.get('q1')).toBe('missing'));

            const armed = addSpy.mock.calls
                .map(([type]) => type)
                .filter((type) => type === 'focus' || type === 'online');
            expect(armed).toEqual(['online', 'focus']);

            // The next focus re-runs the (still failing) prepare.
            const before = prepareSpy.mock.calls.length;
            act(() => {
                window.dispatchEvent(new Event('focus'));
            });
            await waitFor(() => expect(prepareSpy.mock.calls.length).toBeGreaterThan(before));

            // A later failure-free result disarms the retry.
            prepareSpy.mockResolvedValue(preparedWith('q1'));
            act(() => {
                window.dispatchEvent(new Event('focus'));
            });
            await waitFor(() => expect(result.current.assets.size).toBe(1));
            await waitFor(() =>
                expect(removeSpy.mock.calls.some(([type]) => type === 'focus')).toBe(true),
            );
        } finally {
            addSpy.mockRestore();
            removeSpy.mockRestore();
        }
    });

    it('arms no retry when the prepare reports no failures', async () => {
        withRepo();
        const doc = makeDoc([qrNode()]);
        const nodes = resolveDoc(doc);
        prepareSpy.mockResolvedValue(preparedWith('q1'));

        const addSpy = vi.spyOn(window, 'addEventListener');
        try {
            const { result } = renderHook(() => usePreparedAssets(nodes, doc));
            await waitFor(() => expect(result.current.assets.size).toBe(1));

            const armed = addSpy.mock.calls
                .map(([type]) => type)
                .filter((type) => type === 'focus' || type === 'online');
            expect(armed).toEqual([]);
        } finally {
            addSpy.mockRestore();
        }
    });
});

describe('assetSignatureOf', () => {
    it('is stable across identities with identical content and differs per real input', () => {
        const doc = makeDoc([qrNode('q1', 'hello', 100, 100), imageNode()], {
            images: [localImage('r1')],
        });
        const base = assetSignatureOf(resolveDoc(doc), doc);

        expect(assetSignatureOf(resolveDoc(doc), doc).key).toBe(base.key);
        expect(base.hasLeaves).toBe(true);

        const textChange = makeDoc([qrNode('q1', 'bye', 100, 100)], { images: [localImage('r1')] });
        expect(assetSignatureOf(resolveDoc(textChange), textChange).key).not.toBe(base.key);

        const sizeChange = makeDoc([qrNode('q1', 'hello', 200, 100)], { images: [localImage('r1')] });
        expect(assetSignatureOf(resolveDoc(sizeChange), sizeChange).key).not.toBe(base.key);

        const bytesChange = makeDoc([qrNode('q1', 'hello', 100, 100), imageNode()], {
            images: [localImage('r1', 'fingerprint-2')],
        });
        expect(assetSignatureOf(resolveDoc(bytesChange), bytesChange).key).not.toBe(base.key);

        const docSwitch = makeDoc([qrNode('q1', 'hello', 100, 100), imageNode()], {
            id: 'doc-2',
            images: [localImage('r1')],
        });
        expect(assetSignatureOf(resolveDoc(docSwitch), docSwitch).key).not.toBe(base.key);
    });

    it('reports no leaves for a shapes/text-only document', () => {
        const doc = makeDoc([textNode()]);
        expect(assetSignatureOf(resolveDoc(doc), doc)).toEqual({
            key: expect.any(String),
            hasLeaves: false,
        });
        expect(assetSignatureOf(NO_NODES, null).hasLeaves).toBe(false);
    });
});

describe('assetSignatureOf — per-field coverage', () => {
    it('covers every qr field the prepare reads', () => {
        const doc = makeDoc([qrNode()]);
        const leaves = resolveDoc(doc);
        const qr = leaves[0] as ResolvedQr;
        const key = assetSignatureOf(leaves, doc).key;
        const flip = (patch: Partial<ResolvedQr>): string =>
            assetSignatureOf([{ ...qr, ...patch }], doc).key;

        expect(flip({ text: `${qr.text}x` })).not.toBe(key);
        expect(flip({ placeholder: !qr.placeholder })).not.toBe(key);
        expect(flip({ errorCorrection: qr.errorCorrection === 'H' ? 'L' : 'H' })).not.toBe(key);
        expect(flip({ quietModules: qr.quietModules + 1 })).not.toBe(key);
        expect(flip({ fill: qr.fill === '#000000' ? '#ffffff' : '#000000' })).not.toBe(key);
        expect(flip({ w: qr.w + 1 })).not.toBe(key);
        expect(flip({ h: qr.h + 1 })).not.toBe(key);
    });

    it('covers every barcode field the prepare reads', () => {
        const doc = makeDoc([barcodeNode()]);
        const leaves = resolveDoc(doc);
        const barcode = leaves[0] as ResolvedBarcode;
        const key = assetSignatureOf(leaves, doc).key;
        const flip = (patch: Partial<ResolvedBarcode>): string =>
            assetSignatureOf([{ ...barcode, ...patch }], doc).key;

        expect(flip({ text: `${barcode.text}x` })).not.toBe(key);
        expect(flip({ placeholder: !barcode.placeholder })).not.toBe(key);
        expect(flip({ symbology: barcode.symbology === 'ean13' ? 'code128' : 'ean13' })).not.toBe(key);
        expect(flip({ quietModules: barcode.quietModules + 1 })).not.toBe(key);
        expect(flip({ fill: barcode.fill === '#000000' ? '#ffffff' : '#000000' })).not.toBe(key);
        expect(flip({ w: barcode.w + 1 })).not.toBe(key);
        expect(flip({ h: barcode.h + 1 })).not.toBe(key);
    });

    it('reaches an asset leaf nested inside a group', () => {
        const doc = makeDoc(groupWith('g1', [qrNode('q1', 'A')]));
        const sig = assetSignatureOf(resolveDoc(doc), doc);
        expect(sig.hasLeaves).toBe(true);

        const changed = makeDoc(groupWith('g1', [qrNode('q1', 'B')]));
        expect(assetSignatureOf(resolveDoc(changed), changed).key).not.toBe(sig.key);
    });

    it('keeps the key stable across a deep-cloned but content-equal document', () => {
        // The first transient drag frame deep-clones the doc (`cloneDoc` =
        // `structuredClone`), minting new-but-equal source objects. The key must
        // survive that — a bare monotonic identity token would change here and
        // flash every raster for a frame at drag start.
        const doc = makeDoc([imageNode()], { images: [localImage('r1')] });
        const clone = structuredClone(doc);
        expect(clone.resources.images[0]!.source).not.toBe(doc.resources.images[0]!.source);

        expect(assetSignatureOf(resolveDoc(clone), clone).key).toBe(
            assetSignatureOf(resolveDoc(doc), doc).key,
        );
    });
});
