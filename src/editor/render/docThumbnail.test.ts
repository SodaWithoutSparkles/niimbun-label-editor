// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { ImageRef, LabelDoc, Node } from '../../core/doc/types';
import type { AssetDeps } from './assets';

/**
 * D-50 producer: `renderDocThumbnail` renders a document to a small PNG blob
 * through the shared `renderLabelPage` path, must resolve `null` (never reject)
 * for anything it cannot render, and must forward the caller's `assets` so a
 * document with a locally-stored image renders its real content.
 */

// Spy seam: `renderLabelPage` imports `prepareResolvedAssets` by name, so wrap
// the module and pass arguments through unchanged (same technique as
// `renderLabelPage.test.ts`). This proves the `assets` argument reaches the
// asset-preparation stage.
const prepareSpy = vi.hoisted(() => vi.fn());

vi.mock('./prepareAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./prepareAssets')>();
    return {
        ...actual,
        prepareResolvedAssets: ((
            ...args: Parameters<typeof actual.prepareResolvedAssets>
        ) => {
            prepareSpy(...args);
            return actual.prepareResolvedAssets(...args);
        }) as typeof actual.prepareResolvedAssets,
    };
});

import { GALLERY_THUMBNAIL_DPI, renderDocThumbnail } from './docThumbnail';

beforeAll(() => {
    installCanvasShim();
});

const textNode: Node = {
    id: 't',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 100, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hello' },
    size: { w: 2000, h: 600 },
    fontSize: 400,
};

const imageNode: Node = {
    id: 'i1',
    parentId: null,
    type: 'image',
    imageId: 'img-1',
    visible: true,
    locked: false,
    transform: { x: 500, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 2000, h: 2000 },
};

const localImageRef: ImageRef = {
    imageId: 'img-1',
    name: 'Logo',
    source: { kind: 'local', mediaType: 'image/png', resourceId: 'r-1' },
    widthPx: 8,
    heightPx: 8,
};

const docWithImage = (): LabelDoc => {
    const doc = createLabelDoc({ id: 'doc-img', name: 'Image', nodes: [imageNode], now: 1_000 });
    doc.resources.images.push(localImageRef);
    return doc;
};

/** An opaque black raster, standing in for a decoded local image. */
const blackRaster = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 8, 8);
    return canvas;
};

describe('renderDocThumbnail', () => {
    it('renders a simple document to a small PNG blob', async () => {
        const doc = createLabelDoc({ id: 'doc-1', name: 'Test', nodes: [textNode], now: 1_000 });

        const blob = await renderDocThumbnail(doc);

        expect(blob).toBeInstanceOf(Blob);
        expect(blob!.type).toBe('image/png');
        expect(blob!.size).toBeGreaterThan(0);
    }, 15_000);

    it('resolves null (never rejects) for a document that cannot render', async () => {
        // A physical size past the 16M-pixel raster cap makes `renderLabelPage`
        // throw on its pre-flight; the helper must swallow it.
        const broken = createLabelDoc({
            id: 'doc-2',
            name: 'Broken',
            backingW: 500_000,
            backingH: 500_000,
            now: 1_000,
        });

        await expect(renderDocThumbnail(broken)).resolves.toBeNull();
    }, 15_000);

    it('resolves null (never rejects) for a malformed document', async () => {
        await expect(renderDocThumbnail({} as LabelDoc)).resolves.toBeNull();
    });

    it('forwards the assets argument into the shared render path', async () => {
        const doc = docWithImage();
        const assets: AssetDeps = { resolveImage: () => ({ image: blackRaster(), widthPx: 8, heightPx: 8 }) };

        prepareSpy.mockClear();
        await renderDocThumbnail(doc, assets, {});
        // `renderLabelPage` spreads `opts.assets` and adds a `dpi`, so the deps
        // object identity changes — compare the provider we care about.
        expect(prepareSpy).toHaveBeenCalled();
        expect(prepareSpy.mock.calls.at(-1)![2].resolveImage).toBe(assets.resolveImage);
        // The render is at the thumbnail dpi, not the document dpi.
        expect(prepareSpy.mock.calls.at(-1)![2].dpi).toBe(GALLERY_THUMBNAIL_DPI);

        prepareSpy.mockClear();
        await renderDocThumbnail(doc);
        expect(prepareSpy).toHaveBeenCalled();
        expect(prepareSpy.mock.calls.at(-1)![2].resolveImage).toBeUndefined();
    }, 15_000);

    // Differential proof that `assets` changes the pixels: a local-image doc
    // renders different bytes with the provider (image drawn as ink) than
    // without it (image missing → blank page). Same doc, same dpi.
    it('renders a local image only when the assets provider is passed', async () => {
        const doc = docWithImage();
        const assets: AssetDeps = { resolveImage: () => ({ image: blackRaster(), widthPx: 8, heightPx: 8 }) };

        const withAsset = await renderDocThumbnail(doc, assets, {});
        const withoutAsset = await renderDocThumbnail(doc);

        expect(withAsset).toBeInstanceOf(Blob);
        expect(withoutAsset).toBeInstanceOf(Blob);
        const a = new Uint8Array(await withAsset!.arrayBuffer());
        const b = new Uint8Array(await withoutAsset!.arrayBuffer());
        expect(a).not.toEqual(b);
    }, 15_000);
});
