// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImage } from '@napi-rs/canvas';
import { toCanvas } from 'bwip-js/browser';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { ImageRef, LabelDoc, Node } from '../../core/doc/types';
import type { PreparedAsset } from './assets';
import { capImageAsset, loadImageRef } from './imageAssets';
import { clearAssetCache, prepareResolvedAssets } from './prepareAssets';
import { renderQr } from './qrImage';
import { renderBarcode } from './barcodeImage';
import { renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';

beforeAll(() => {
    installCanvasShim();
});

beforeEach(() => {
    clearAssetCache();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const imageNode = (id: string, x: number, y: number, w: number, h: number): Node =>
    node({
        id,
        parentId: null,
        type: 'image',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        imageId: 'i1',
        size: { w, h },
    });

const qrNode = (id: string, value: string, w = 400, h = 400): Node =>
    node({
        id,
        parentId: null,
        type: 'qr',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'static', value },
        size: { w, h },
    });

const barcodeNode = (id: string, value: string, w = 1500, h = 500): Node =>
    node({
        id,
        parentId: null,
        type: 'barcode',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'static', value },
        size: { w, h },
    });

const fullRegions = [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }] as const;

const countDark = (canvas: HTMLCanvasElement): number => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 128 && data[i + 3]! > 0) dark++;
    }
    return dark;
};

/** Build an `@napi-rs/canvas` `Image` from a shim canvas (drawable by the test shim). */
const toDrawable = async (canvas: HTMLCanvasElement): Promise<PreparedAsset['image']> =>
    (await loadImage(canvas.toDataURL('image/png'))) as unknown as PreparedAsset['image'];

/** A `size`×`size` asset with a black top-left quadrant, transparent elsewhere. */
const inkAsset = async (size = 100): Promise<PreparedAsset> => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, Math.floor(size / 2), Math.floor(size / 2));
    return { image: await toDrawable(canvas), widthPx: size, heightPx: size };
};

const quadrantAsset = (): Promise<PreparedAsset> => inkAsset(100);

const darkBBox = (canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { x: 0, y: 0, w: 0, h: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (data[i]! < 128 && data[i + 3]! > 0) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/** A `w`×`h` solid-black asset drawable by the test shim. */
const solidAsset = async (w: number, h: number): Promise<PreparedAsset> => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    return { image: await toDrawable(canvas), widthPx: w, heightPx: h };
};

/** bwip-js options plus the encoder-specific keys (eclevel, padding…) it accepts. */
type BwipTestOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

/** Measure a bwip-js symbol at scale 1 (used to prove integer scaling). */
const baseSymbol = (opts: BwipTestOptions): { w: number; h: number } => {
    const canvas = document.createElement('canvas');
    toCanvas(canvas, opts);
    return { w: canvas.width, h: canvas.height };
};

describe('resolve — image / qr / barcode leaves', () => {
    it('emits geometry, bounds and defaults for all three types', () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [
                imageNode('img', 100, 200, 400, 300),
                qrNode('q', 'hello'),
                barcodeNode('bc', '123456789012'),
            ],
        });
        const byId = new Map(resolve(doc).map((n) => [n.id, n] as const));

        const image = byId.get('img');
        expect(image?.type).toBe('image');
        if (image?.type !== 'image') return;
        expect(image.imageId).toBe('i1');
        expect(image.w).toBe(400);
        expect(image.h).toBe(300);
        expect(image.fit).toBe('contain');
        expect(image.bounds).toEqual({ x: 100, y: 200, w: 400, h: 300 });

        const qr = byId.get('q');
        expect(qr?.type).toBe('qr');
        if (qr?.type !== 'qr') return;
        expect(qr.text).toBe('hello');
        expect(qr.placeholder).toBe(false);
        expect(qr.errorCorrection).toBe('M');
        expect(qr.bounds).toEqual({ x: 0, y: 0, w: 400, h: 400 });

        const barcode = byId.get('bc');
        expect(barcode?.type).toBe('barcode');
        if (barcode?.type !== 'barcode') return;
        expect(barcode.text).toBe('123456789012');
        expect(barcode.placeholder).toBe(false);
        expect(barcode.symbology).toBe('code128');
        expect(barcode.bounds).toEqual({ x: 0, y: 0, w: 1500, h: 500 });
    });

    it('substitutes the placeholder for an empty qr payload', () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [qrNode('q', '')],
        });
        const qr = resolve(doc)[0];
        expect(qr?.type).toBe('qr');
        if (qr?.type !== 'qr') return;
        expect(qr.placeholder).toBe(true);
        expect(qr.text).toBe('{empty}');
    });

    it('honours explicit fit / errorCorrection / symbology fields', () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [
                node({ ...imageNode('img', 0, 0, 100, 100), fit: 'cover' }),
                node({ ...qrNode('q', 'x'), errorCorrection: 'H' }),
                node({ ...barcodeNode('bc', '123456789012'), symbology: 'ean13' }),
            ],
        });
        const [image, qr, barcode] = resolve(doc);
        expect(image?.type === 'image' && image.fit).toBe('cover');
        expect(qr?.type === 'qr' && qr.errorCorrection).toBe('H');
        expect(barcode?.type === 'barcode' && barcode.symbology).toBe('ean13');
    });
});

describe('capImageAsset — never upscale, aspect-preserving cap', () => {
    it('caps down to the required box', async () => {
        const asset = await quadrantAsset();
        const capped = capImageAsset(asset, 40, 20);
        // scale = min(1, 40/100, 20/100) = 0.2 → 20×20 (aspect preserved).
        expect(capped.widthPx).toBe(20);
        expect(capped.heightPx).toBe(20);
        expect(capped.image).not.toBe(asset.image);
        expect(countDark(capped.image as HTMLCanvasElement)).toBeGreaterThan(0);
    });

    it('preserves a non-square aspect (1000×100 capped to 100×100 → 100×10)', async () => {
        const asset = await solidAsset(1000, 100);
        const capped = capImageAsset(asset, 100, 100);
        expect(capped.widthPx).toBe(100);
        expect(capped.heightPx).toBe(10);
    });

    it('returns the asset unchanged when the target is at least the source on both axes', async () => {
        const asset = await quadrantAsset();
        expect(capImageAsset(asset, 500, 500)).toBe(asset);
        expect(capImageAsset(asset, 100, 100)).toBe(asset);
    });
});

describe('qr / barcode engines', () => {
    it('renders a valid QR with ink', () => {
        const qr = renderQr('https://example.com', 'M', 200, 200);
        expect(qr).not.toBeNull();
        if (!qr) return;
        expect(qr.canvas.width).toBeGreaterThan(0);
        expect(countDark(qr.canvas)).toBeGreaterThan(0);
    });

    it('returns null for an empty QR payload', () => {
        expect(renderQr('', 'M', 200, 200)).toBeNull();
    });

    it('renders a valid barcode with ink', () => {
        const bc = renderBarcode('123456789012', 'code128', 400, 160);
        expect(bc).not.toBeNull();
        if (!bc) return;
        expect(countDark(bc.canvas)).toBeGreaterThan(0);
    });

    it('returns null for an invalid barcode payload', () => {
        expect(renderBarcode('x', 'ean13', 400, 160)).toBeNull();
        expect(renderBarcode('', 'code128', 400, 160)).toBeNull();
    });

    it('renders a crisp integer-scaled QR for a comfortably large target', () => {
        const text = 'https://example.com';
        const base = baseSymbol({
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale: 1,
            paddingwidth: 0,
            paddingheight: 0,
        });
        const target = 400;
        const generated = renderQr(text, 'M', target, target);
        expect(generated).not.toBeNull();
        if (!generated) return;
        const scale = Math.max(1, Math.floor(Math.min(target / base.w, target / base.h)));
        expect(scale).toBeGreaterThan(1);
        expect(generated.belowMinModule).toBe(false);

        // The returned canvas is exactly the integer-scaled symbol (one module =
        // `scale` px), never a fractional resample.
        const ref = document.createElement('canvas');
        toCanvas(ref, {
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale,
            paddingwidth: 0,
            paddingheight: 0,
        } as BwipTestOptions);
        expect(generated.canvas.width).toBe(ref.width);
        expect(generated.canvas.height).toBe(ref.height);
        expect(ref.width / scale, 'module width is the integer scale').toBe(base.w);
        expect(darkBBox(generated.canvas)).toEqual(darkBBox(ref));
    });

    it('measures the target module pitch, not the integer raster scale (#12)', () => {
        const text = 'https://example.com';
        const base = baseSymbol({
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale: 1,
            paddingwidth: 0,
            paddingheight: 0,
        });
        // bwip's qrcode draws 2 device px / module at scale 1; this payload is 25
        // modules (version 2-M).
        expect(base.w / 2).toBe(25);
        const minModulePx = 3;

        // 100 px / 25 modules = 4 px/module ≥ 3 → scannable. The old
        // `scale < minModulePx` (2 < 3) wrongly flagged it.
        const ok = renderQr(text, 'M', 100, 100, minModulePx);
        expect(ok).not.toBeNull();
        expect(ok?.belowMinModule).toBe(false);
        // The raster selection is unchanged: the integer scale still fits the box.
        expect(ok?.canvas.width).toBe(100);

        // 74 px / 25 = 2.96 px/module < 3 → too small.
        const small = renderQr(text, 'M', 74, 74, minModulePx);
        expect(small).not.toBeNull();
        expect(small?.belowMinModule).toBe(true);
        // Oversized scale-1 symbol returned un-resampled (still the integer path).
        expect(small?.canvas.width).toBe(base.w);
    });

    it('renders a crisp integer-scaled barcode for a comfortably large target', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        const targetW = 1500;
        const targetH = 500;
        const generated = renderBarcode(text, 'code128', targetW, targetH);
        expect(generated).not.toBeNull();
        if (!generated) return;
        const scaleX = Math.max(1, Math.floor(targetW / base.w));
        const scaleY = Math.max(1, Math.floor(targetH / base.h));
        expect(scaleX).toBeGreaterThan(1);

        const ref = document.createElement('canvas');
        toCanvas(ref, {
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX,
            scaleY,
        } as BwipTestOptions);
        expect(generated.canvas.width).toBe(ref.width);
        expect(generated.canvas.height).toBe(ref.height);
        // Module width is `scaleX` exactly — no dropped/merged bar columns.
        expect(generated.canvas.width, 'integer module width, no resample').toBe(base.w * scaleX);
        expect(darkBBox(generated.canvas)).toEqual(darkBBox(ref));
    });

    it('returns a scale-1 QR with belowMinModule when the target is too small', () => {
        const text = 'https://example.com/a/longer/payload';
        const base = baseSymbol({
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale: 1,
            paddingwidth: 0,
            paddingheight: 0,
        });
        // Smaller than the scale-1 symbol forces the overflow path.
        const target = Math.max(8, base.w - 7);
        const generated = renderQr(text, 'M', target, target, 3);
        expect(generated).not.toBeNull();
        if (!generated) return;
        expect(generated.belowMinModule).toBe(true);
        // Not resampled: the un-touched scale-1 symbol is returned even though it
        // exceeds the target.
        expect(generated.canvas.width).toBe(base.w);
        expect(generated.canvas.height).toBe(base.h);
        expect(countDark(generated.canvas)).toBeGreaterThan(0);
    });

    it('keeps the barcode verdict as scaleX < minModulePx — parity (no change)', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        // A 1D narrow module IS a device-px scaleX, so the verdict stays a direct
        // comparison (unlike QR's 2 px/module raster).
        const large = renderBarcode(text, 'code128', 1500, 500, 3);
        const scaleX = Math.max(1, Math.floor(1500 / base.w));
        expect(large?.belowMinModule).toBe(scaleX < 3);
        // A tiny target forces scaleX 1 → below the minimum.
        const tinyTarget = Math.max(8, base.w - 1);
        const tiny = renderBarcode(text, 'code128', tinyTarget, 20, 3);
        const tinyScaleX = Math.max(1, Math.floor(tinyTarget / base.w));
        expect(tiny?.belowMinModule).toBe(tinyScaleX < 3);
        expect(tiny?.belowMinModule).toBe(true);
    });

    it('returns a scale-1 barcode with belowMinModule when the target is too small', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        const generated = renderBarcode(text, 'code128', Math.max(8, base.w - 1), 20, 3);
        expect(generated).not.toBeNull();
        if (!generated) return;
        expect(generated.belowMinModule).toBe(true);
        expect(generated.canvas.width).toBe(base.w);
        expect(countDark(generated.canvas)).toBeGreaterThan(0);
    });
});

describe('loadImageRef — remote fetch guard', () => {
    const remoteRef = (url: string): ImageRef => ({
        imageId: 'i1',
        name: 'r',
        source: { kind: 'remote', url, mediaType: 'image/png' },
        widthPx: 1,
        heightPx: 1,
    });

    it('passes a timeout signal and returns null for an oversized body', async () => {
        const calls: Array<RequestInit | undefined> = [];
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            calls.push(init);
            return {
                ok: true,
                headers: {
                    get: (name: string) =>
                        name === 'content-length' ? String(30 * 1024 * 1024) : null,
                },
                arrayBuffer: async () => new ArrayBuffer(0),
            };
        });
        const originalFetch = globalThis.fetch;
        (globalThis as { fetch: unknown }).fetch = fetchMock;
        try {
            const asset = await loadImageRef(remoteRef('https://example.test/big.png'), {});
            expect(asset).toBeNull();
            expect(fetchMock).toHaveBeenCalledTimes(1);
            // The timeout signal is wired wherever the host implements it.
            let timeoutWorks = false;
            try {
                AbortSignal.timeout(1);
                timeoutWorks = true;
            } catch {
                timeoutWorks = false;
            }
            if (timeoutWorks) expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
        } finally {
            (globalThis as { fetch: unknown }).fetch = originalFetch;
            vi.unstubAllGlobals();
        }
    });

    it('returns null when the fetch rejects (never throws)', async () => {
        const originalFetch = globalThis.fetch;
        (globalThis as { fetch: unknown }).fetch = vi.fn(async () => {
            throw new Error('network');
        });
        try {
            expect(await loadImageRef(remoteRef('https://example.test/x.png'), {})).toBeNull();
        } finally {
            (globalThis as { fetch: unknown }).fetch = originalFetch;
        }
    });
});

describe('prepareResolvedAssets', () => {
    const docWithImage = (): LabelDoc => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [imageNode('img', 0, 0, 1000, 1000)],
        });
        const ref: ImageRef = {
            imageId: 'i1',
            name: 'photo',
            source: { kind: 'external', mediaType: 'image/png', filename: 'photo.png' },
            widthPx: 500,
            heightPx: 500,
        };
        doc.resources.images.push(ref);
        return doc;
    };

    it('resolves an injected image and caps it to the node’s required px', async () => {
        const doc = docWithImage();
        const asset = await inkAsset(500);
        const resolveImage = vi.fn(() => asset);
        const { assets } = await prepareResolvedAssets(resolve(doc), doc, { resolveImage });

        // 1000 hm at doc dpi 300 → 118 px requested; the 500 px source caps down.
        const prepared = assets.get('img');
        expect(prepared).toBeDefined();
        expect(prepared?.widthPx).toBe(118);
        expect(prepared?.heightPx).toBe(118);
        expect(resolveImage).toHaveBeenCalledTimes(1);
    });

    it('uses the effective AssetDeps.dpi for the default image scale (thumbnail)', async () => {
        const doc = docWithImage();
        const asset = await inkAsset(500);
        const { assets } = await prepareResolvedAssets(resolve(doc), doc, {
            resolveImage: () => asset,
            dpi: 50,
        });

        // 1000 hm at 50 dpi → round(1000 * 50/2540) = 20 px, not the 118 px at
        // the document's 300 dpi. A `dpi: 50` thumbnail must not decode at full dpi.
        expect(assets.get('img')?.widthPx).toBe(20);
        expect(assets.get('img')?.heightPx).toBe(20);
    });

    it('decodes once per imageId within a call', async () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [imageNode('a', 0, 0, 500, 500), imageNode('b', 500, 0, 800, 800)],
        });
        doc.resources.images.push({
            imageId: 'i1',
            name: 'photo',
            source: { kind: 'external', mediaType: 'image/png', filename: 'p.png' },
            widthPx: 500,
            heightPx: 500,
        });
        const asset = await quadrantAsset();
        const resolveImage = vi.fn(() => asset);
        const { assets } = await prepareResolvedAssets(resolve(doc), doc, { resolveImage });

        expect(resolveImage).toHaveBeenCalledTimes(1);
        expect(assets.get('a')?.widthPx).toBe(59);
        expect(assets.get('b')?.widthPx).toBe(94);
    });

    it('yields no entry for a missing image resource and warns missing', async () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [imageNode('img', 0, 0, 500, 500)],
        });
        const { assets, warnings } = await prepareResolvedAssets(resolve(doc), doc, {});
        expect(assets.has('img')).toBe(false);
        expect(warnings.get('img')).toBe('missing');
    });

    it('warns invalid for an invalid barcode but still resolves other leaves', async () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [barcodeNode('bc', 'x'), qrNode('q', 'ok')],
        });
        const invalid = doc.nodes.find((n) => n.id === 'bc');
        if (invalid?.type === 'barcode') invalid.symbology = 'ean13';
        const { assets, warnings } = await prepareResolvedAssets(resolve(doc), doc, {});
        expect(assets.has('bc')).toBe(false);
        expect(warnings.get('bc')).toBe('invalid');
        expect(assets.has('q')).toBe(true);
    });

    it('warns too-small when a generated symbol cannot meet the module minimum', async () => {
        // imageScale 1 px/hm → min module = ceil(0.25*1*100) = 25 px. A 400 hm
        // QR box is ~400 px wide, far below 25 px/module at scale 1.
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [qrNode('q', 'hello')],
        });
        const { assets, warnings } = await prepareResolvedAssets(resolve(doc), doc, { imageScale: 1 });
        expect(assets.has('q')).toBe(true);
        expect(warnings.get('q')).toBe('too-small');
    });

    it('decodes/fetches once for the same image across calls (provider-scoped cache)', async () => {
        const doc = docWithImage();
        const asset = await inkAsset(500);
        const resolveImage = vi.fn(async () => asset);

        const first = await prepareResolvedAssets(resolve(doc), doc, { resolveImage });
        const second = await prepareResolvedAssets(resolve(doc), doc, { resolveImage });

        expect(resolveImage).toHaveBeenCalledTimes(1);
        expect(first.assets.get('img')).toBeDefined();
        expect(second.assets.get('img')?.widthPx).toBe(first.assets.get('img')?.widthPx);
        // The cache stores the uncapped asset; each call caps it fresh.
        expect(second.assets.get('img')?.image).not.toBe(first.assets.get('img')?.image);
    });

    it('does not share a raster between two providers serving the same resourceId', async () => {
        const doc = docWithImage();
        const assetA = await solidAsset(500, 500);
        const assetB = await solidAsset(300, 300);
        const providerA = vi.fn(() => assetA);
        const providerB = vi.fn(() => assetB);

        await prepareResolvedAssets(resolve(doc), doc, { resolveImage: providerA });
        await prepareResolvedAssets(resolve(doc), doc, { resolveImage: providerB });

        expect(providerA).toHaveBeenCalledTimes(1);
        expect(providerB).toHaveBeenCalledTimes(1);
    });
});

describe('renderLabelPage — image asset seam', () => {
    it('renders the injected image with ink and does not black-fill it', async () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            dpi: 300,
            regions: [...fullRegions],
            nodes: [imageNode('img', 500, 500, 1000, 1000)],
        });
        doc.resources.images.push({
            imageId: 'i1',
            name: 'photo',
            source: { kind: 'external', mediaType: 'image/png', filename: 'p.png' },
            widthPx: 100,
            heightPx: 100,
        });
        const asset = await quadrantAsset();
        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => asset } });

        const sx = 300 / 2540;
        const at = (x: number, y: number): number[] => {
            const i = (y * page.widthPx + x) * 4;
            return [page.rgba.data[i]!, page.rgba.data[i + 1]!, page.rgba.data[i + 2]!, page.rgba.data[i + 3]!];
        };

        // Box spans hm 500..1500 → px 59..177. The black quadrant lands top-left.
        const inkPx = at(Math.round(700 * sx), Math.round(700 * sx));
        expect(inkPx[0], 'image content is drawn').toBeLessThan(64);

        // If `applyInkDefaults` black-filled the Konva.Image the whole box would
        // be black; the transparent bottom-right quadrant must stay white.
        const clearPx = at(Math.round(1400 * sx), Math.round(1400 * sx));
        expect(clearPx[0], 'transparent image area is not blacked out').toBeGreaterThan(200);
    });

    it('does not throw for an invalid barcode payload', async () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            dpi: 300,
            regions: [...fullRegions],
            nodes: [
                node({
                    id: 'r',
                    parentId: null,
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 100, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 800, h: 800 },
                    // Explicit black so the rect is an ink source regardless of
                    // the (transparent) shape-style default.
                    fill: '#000000',
                }),
                barcodeNode('bc', 'x'),
            ],
        });
        const invalid = doc.nodes.find((n) => n.id === 'bc');
        if (invalid?.type === 'barcode') invalid.symbology = 'ean13';

        let dark = 0;
        const page = await renderLabelPage(doc);
        for (let i = 0; i < page.rgba.data.length; i += 4) {
            if (page.rgba.data[i]! < 128) dark++;
        }
        expect(dark, 'the valid rect still produces ink').toBeGreaterThan(0);
    });

    it('surfaces per-leaf asset warnings on the returned page', async () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            dpi: 300,
            regions: [...fullRegions],
            nodes: [imageNode('img', 0, 0, 1000, 1000)],
        });
        // No matching resource → the image is 'missing'.
        const page = await renderLabelPage(doc);
        expect(page.warnings).toBeDefined();
        expect(page.warnings?.get('img')).toBe('missing');
    });
});
