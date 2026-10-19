// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadImage } from '@napi-rs/canvas';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { parseDoc } from '../../core/doc/serialize';
import { THUMB_MAX_BYTES, THUMB_MAX_SIDE } from '../../core/doc/validate';
import type { ImageRef, LabelDoc, Node, Region } from '../../core/doc/types';
import { rasterDimensions } from '../../core/render';
import type { AssetDeps } from './assets';

/**
 * D-50 colour producer: `renderDocPreview` renders the **design the user made**
 * (no policy mask, no quantization, no print-only overrides), at
 * `GALLERY_THUMBNAIL_DPI`, plus the downscaled `meta.thumb` data URL. It must
 * never reject: anything it cannot render resolves `null`, and a `meta.thumb`
 * that cannot fit the caps is `undefined` (never a failed preview).
 */

// Spy seam: `renderPageBase` imports `prepareResolvedAssets` by name, so wrap
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

import { GALLERY_THUMBNAIL_DPI, renderDocPreview, type MetaThumb } from './docThumbnail';

beforeAll(() => {
    installCanvasShim();
});

const rect = (fill: string, hint?: 'threshold'): Node => ({
    id: 'r1',
    parentId: null,
    type: 'shape',
    shape: 'rectangle',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 4000, h: 3000 },
    fill,
    ...(hint ? { quantizerHint: hint } : {}),
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
    id: 'photo',
    parentId: null,
    type: 'image',
    imageId: 'img-1',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 8000, h: 8000 },
};

const localImageRef: ImageRef = {
    imageId: 'img-1',
    name: 'Photo',
    source: { kind: 'local', mediaType: 'image/png', resourceId: 'r-1' },
    widthPx: 512,
    heightPx: 512,
};

const doc = (nodes: Node[], regions: Region[] = [], backing?: { w: number; h: number }): LabelDoc =>
    createLabelDoc({
        id: 'doc-1',
        name: 'Test',
        nodes,
        regions,
        ...(backing ? { backingW: backing.w, backingH: backing.h } : {}),
        now: 1_000,
    });

const pixelAt = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] => {
    const i = (y * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
};

/** A deterministic high-entropy RGB raster, standing in for a photo. */
const noiseCanvas = (size = 512): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(size, size);
    let seed = 0x12345678;
    for (let i = 0; i < image.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        image.data[i] = seed >>> 24;
        image.data[i + 1] = (seed >>> 16) & 0xff;
        image.data[i + 2] = (seed >>> 8) & 0xff;
        image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
};

/** Decoded byte count + raster size of a `meta.thumb`, as the validator sees it. */
const thumbStats = async (
    thumb: MetaThumb,
): Promise<{ bytes: number; width: number; height: number }> => {
    const base64 = thumb.dataUrl.slice(thumb.dataUrl.indexOf(',') + 1);
    const image = await loadImage(thumb.dataUrl);
    return { bytes: atob(base64).length, width: image.width, height: image.height };
};

/** Assert a thumb fits the caps and survives `parseDoc` with the thumb kept. */
const expectValidMetaThumb = async (thumb: MetaThumb | undefined): Promise<void> => {
    expect(thumb).toBeDefined();
    if (!thumb) return;
    const stats = await thumbStats(thumb);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.bytes).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    expect(Math.max(stats.width, stats.height)).toBeLessThanOrEqual(THUMB_MAX_SIDE);
    // `mediaType` mirrors the data URL's own MIME segment.
    expect(thumb.dataUrl.startsWith(`data:${thumb.mediaType};base64,`)).toBe(true);
    expect(Math.abs(thumb.at - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2);

    const base = doc([]);
    const parsed = await parseDoc(JSON.stringify({ ...base, meta: { ...base.meta, thumb } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.meta.thumb).toEqual(thumb);
};

describe('renderDocPreview', () => {
    it('renders colour: a threshold-hinted node still yields intermediate RGB', async () => {
        // `#808080` quantizes to pure black or white; colour keeps the mid-grey.
        const source = doc([rect('#808080', 'threshold'), textNode]);
        const preview = await renderDocPreview(source);
        expect(preview).not.toBeNull();
        if (!preview) return;

        const dims = rasterDimensions(source.label.backingW, source.label.backingH, GALLERY_THUMBNAIL_DPI);
        expect(preview.rgba.width).toBe(dims.widthPx);
        expect(preview.rgba.height).toBe(dims.heightPx);
        const mid = pixelAt(
            preview.rgba.data,
            preview.rgba.width,
            Math.floor(preview.rgba.width / 2),
            Math.floor(preview.rgba.height / 2),
        );
        expect(mid[0]).toBeGreaterThan(60);
        expect(mid[0]).toBeLessThan(200);
        expect(mid[0]).toBe(mid[1]);
        expect(mid[1]).toBe(mid[2]);

        // The canvas holds the same colour pixels (not a 1-bit readback).
        const ctx = preview.canvas.getContext('2d')!;
        const canvasPixel = ctx.getImageData(
            Math.floor(preview.canvas.width / 2),
            Math.floor(preview.canvas.height / 2),
            1,
            1,
        ).data;
        expect(canvasPixel[0]).toBe(mid[0]);
        expect(canvasPixel[1]).toBe(mid[1]);
        expect(canvasPixel[2]).toBe(mid[2]);
    }, 15_000);

    it('still clips to the label regions (outside the union is white)', async () => {
        const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 2000, h: 3000 }];
        const preview = await renderDocPreview(doc([rect('#808080')], regions));
        expect(preview).not.toBeNull();
        if (!preview) return;

        const y = Math.floor(preview.rgba.height / 2);
        const inside = pixelAt(preview.rgba.data, preview.rgba.width, 10, y);
        const outside = pixelAt(preview.rgba.data, preview.rgba.width, preview.rgba.width - 3, y);
        expect(inside[0]).toBeLessThan(200); // the grey node survives inside
        expect(outside).toEqual([255, 255, 255, 255]); // white outside the union
    }, 15_000);

    it('produces a colour PNG blob at the 100-dpi raster size', async () => {
        const source = doc([rect('#3366cc', 'threshold')]);
        const preview = await renderDocPreview(source);
        expect(preview).not.toBeNull();
        if (!preview) return;

        const dims = rasterDimensions(source.label.backingW, source.label.backingH, GALLERY_THUMBNAIL_DPI);
        expect(preview.canvas.width).toBe(dims.widthPx);
        expect(preview.canvas.height).toBe(dims.heightPx);
        expect(preview.blob).toBeInstanceOf(Blob);
        expect(preview.blob!.type).toBe('image/png');
        expect(preview.blob!.size).toBeGreaterThan(0);

        const encoded = await loadImage(new Uint8Array(await preview.blob!.arrayBuffer()));
        expect(encoded.width).toBe(dims.widthPx);
        expect(encoded.height).toBe(dims.heightPx);
    }, 15_000);

    it('builds a capped meta thumb for a large label', async () => {
        const large = doc(
            [
                rect('#ffffff'),
                { ...textNode, transform: { x: 2000, y: 2000, rotDeg: 0, scaleX: 1, scaleY: 1 } },
            ],
            [],
            { w: 20_000, h: 15_000 },
        );
        const preview = await renderDocPreview(large);
        expect(preview).not.toBeNull();
        if (!preview) return;

        // The source raster is wider than the cap, so the thumb is downscaled.
        expect(Math.max(preview.canvas.width, preview.canvas.height)).toBeGreaterThan(THUMB_MAX_SIDE);
        await expectValidMetaThumb(preview.metaThumb);
    }, 15_000);

    it('falls back to JPEG (and shrinks) for a photo-heavy label', async () => {
        const photo = doc([imageNode], [], { w: 8000, h: 8000 });
        photo.resources.images.push(localImageRef);
        const assets: AssetDeps = {
            resolveImage: () => ({ image: noiseCanvas(), widthPx: 512, heightPx: 512 }),
        };

        const preview = await renderDocPreview(photo, assets);
        expect(preview).not.toBeNull();
        if (!preview) return;

        // High-entropy content cannot fit 64 KB as a 512 px PNG; the producer
        // must have moved to JPEG/smaller sizes rather than failing.
        expect(preview.metaThumb?.mediaType).toBe('image/jpeg');
        await expectValidMetaThumb(preview.metaThumb);
    }, 15_000);

    it('resolves null (never rejects) for a document that cannot render', async () => {
        const broken = createLabelDoc({
            id: 'doc-2',
            name: 'Broken',
            backingW: 500_000,
            backingH: 500_000,
            now: 1_000,
        });

        await expect(renderDocPreview(broken)).resolves.toBeNull();
    }, 15_000);

    it('resolves null (never rejects) for a malformed document', async () => {
        await expect(renderDocPreview({} as LabelDoc)).resolves.toBeNull();
    });

    it('forwards the assets argument into the shared render path at the thumbnail dpi', async () => {
        const photo = doc([imageNode], [], { w: 8000, h: 8000 });
        photo.resources.images.push(localImageRef);
        const assets: AssetDeps = {
            resolveImage: () => ({ image: noiseCanvas(32), widthPx: 32, heightPx: 32 }),
        };

        prepareSpy.mockClear();
        await renderDocPreview(photo, assets, {});
        // `renderPageBase` spreads `opts.assets` and adds a `dpi`, so the deps
        // object identity changes — compare the provider we care about.
        expect(prepareSpy).toHaveBeenCalled();
        expect(prepareSpy.mock.calls.at(-1)![2].resolveImage).toBe(assets.resolveImage);
        // The render is at the thumbnail dpi, not the document dpi.
        expect(prepareSpy.mock.calls.at(-1)![2].dpi).toBe(GALLERY_THUMBNAIL_DPI);

        prepareSpy.mockClear();
        await renderDocPreview(photo);
        expect(prepareSpy).toHaveBeenCalled();
        expect(prepareSpy.mock.calls.at(-1)![2].resolveImage).toBeUndefined();
    }, 15_000);

    // Differential proof that `assets` changes the pixels: a local-image doc
    // renders different bytes with the provider (image drawn) than without it
    // (image missing → white page). Same doc, same dpi.
    it('renders a local image only when the assets provider is passed', async () => {
        const photo = doc([imageNode], [], { w: 8000, h: 8000 });
        photo.resources.images.push(localImageRef);
        const assets: AssetDeps = {
            resolveImage: () => ({ image: noiseCanvas(64), widthPx: 64, heightPx: 64 }),
        };

        const withAsset = await renderDocPreview(photo, assets, {});
        const withoutAsset = await renderDocPreview(photo);

        expect(withAsset).not.toBeNull();
        expect(withoutAsset).not.toBeNull();
        if (!withAsset || !withoutAsset) return;
        expect(withAsset.rgba.data).not.toEqual(withoutAsset.rgba.data);
    }, 15_000);
});
