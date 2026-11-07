// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { ImageRef, LabelDoc, Node } from '../../core/doc/types';
import type { PreparedAsset } from './assets';
import { prepareResolvedAssets } from './prepareAssets';
import { resolve } from './resolve';

/**
 * Wave A (P4 A7): an image leaf's `tint` is applied to the **prepared** asset,
 * after the shared decode cache, so print/preview/thumbnails all share one
 * implementation. The cached (injected) asset must never be mutated.
 */

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const imageDoc = (tint?: string): LabelDoc => {
    const doc = createLabelDoc({
        id: 'doc-tint',
        now: 1_700_000_000,
        backingW: 3000,
        backingH: 2000,
        dpi: 300,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 'img',
                parentId: null,
                type: 'image',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                imageId: 'i1',
                size: { w: 100, h: 100 },
                ...(tint !== undefined ? { tint } : {}),
            }),
        ],
    });
    const ref: ImageRef = {
        imageId: 'i1',
        name: 'grey',
        source: { kind: 'inline', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AA==' },
        widthPx: 2,
        heightPx: 2,
    };
    doc.resources.images = [ref];
    return doc;
};

/** A 2×2 opaque mid-grey raster — the injected "decoded" image. */
const greyAsset = (): PreparedAsset => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.fillRect(0, 0, 2, 2);
    return { image: canvas, widthPx: 2, heightPx: 2 };
};

const pixelAt = (asset: PreparedAsset): number[] => {
    const canvas = asset.image as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
};

describe('prepareResolvedAssets — image tint (P4 A7)', () => {
    it('tints a prepared image leaf toward red by luminance', async () => {
        const doc = imageDoc('#ff0000');
        const asset = greyAsset();
        const { assets, warnings } = await prepareResolvedAssets(resolve(doc), doc, {
            resolveImage: () => asset,
        });

        expect(warnings.size).toBe(0);
        const prepared = assets.get('img');
        expect(prepared).toBeDefined();
        // Not the cached raster: a fresh canvas, and the source is untouched.
        expect(prepared!.image).not.toBe(asset.image);
        expect(pixelAt(asset)).toEqual([128, 128, 128, 255]);
        // Red tint on a neutral grey L=128 → (255, L, L), alpha preserved.
        expect(pixelAt(prepared!)).toEqual([255, 128, 128, 255]);
    });

    it('returns the asset unchanged (same image identity) when no tint is set', async () => {
        const doc = imageDoc();
        const asset = greyAsset();
        const { assets } = await prepareResolvedAssets(resolve(doc), doc, {
            resolveImage: () => asset,
        });

        const prepared = assets.get('img');
        expect(prepared).toBeDefined();
        expect(prepared!.image).toBe(asset.image);
        expect(prepared!.widthPx).toBe(asset.widthPx);
        expect(prepared!.heightPx).toBe(asset.heightPx);
    });

    it("leaves the asset untinted for an explicit 'transparent' tint", async () => {
        const doc = imageDoc('transparent');
        const asset = greyAsset();
        const { assets } = await prepareResolvedAssets(resolve(doc), doc, {
            resolveImage: () => asset,
        });
        expect(assets.get('img')!.image).toBe(asset.image);
    });
});
