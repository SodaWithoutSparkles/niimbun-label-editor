// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImage } from '@napi-rs/canvas';
import { toCanvas } from 'bwip-js/browser';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { DEFAULT_QR_QUIET_MODULES, barcodeQuietModules } from '../../core/doc/objects';
import type { ImageRef, LabelDoc, Node } from '../../core/doc/types';
import type { PreparedAsset } from './assets';
import { capImageAsset, loadImageRef } from './imageAssets';
import { clearAssetCache, prepareResolvedAssets } from './prepareAssets';
import { renderQr } from './qrImage';
import { renderBarcode } from './barcodeImage';
import { renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';
import { createResourceAssetProviders } from '../../components/editor/usePreparedAssets';
import type { ResourceRepo } from '../../data/resourceRepo';

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

/** One RGBA pixel; `undefined` when the coordinates are off-canvas. */
const pixelAt = (
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
): [number, number, number, number] | undefined => {
    const ctx = canvas.getContext('2d');
    if (!ctx || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return undefined;
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]!];
};

/** A rectangular RGBA region of a canvas. */
const region = (
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(x, y, w, h).data;

/** Count differing bytes between two RGBA buffers (crisp 1:1 copy ⇒ 0). */
const differingBytes = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    if (a.length !== b.length) return Number.POSITIVE_INFINITY;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
    return diff;
};

/**
 * The expected QR raster for a square target, derived independently from the
 * engine's documented P2 formula: integer scale chosen against the
 * quiet-zone-padded module count, canvas padded by `2·quietPx`. Mirrors the
 * `renderQr` math so a test can assert the padded size without importing it.
 */
const qrLayout = (
    baseW: number,
    target: number,
    quietModules = DEFAULT_QR_QUIET_MODULES,
): { scale: number; symbolW: number; quietPx: number; canvasW: number } => {
    const moduleCount = baseW / 2; // bwip qrcode = 2 device px/module at scale 1
    const paddedBaseW = (moduleCount + 2 * quietModules) * 2;
    const scale = Math.max(1, Math.floor(target / paddedBaseW));
    const symbolW = baseW * scale;
    const quietPx = Math.round(quietModules * (symbolW / moduleCount));
    return { scale, symbolW, quietPx, canvasW: symbolW + 2 * quietPx };
};

/** The expected 1D raster: `scaleX` chosen against the padded width (P2). */
const barcodeLayout = (
    baseW: number,
    targetW: number,
    quietModules: number,
): { scaleX: number; quietPx: number; canvasW: number } => {
    const totalModules = baseW + 2 * quietModules;
    const scaleX = Math.max(1, Math.floor(targetW / totalModules));
    return { scaleX, quietPx: quietModules * scaleX, canvasW: baseW * scaleX + 2 * quietModules * scaleX };
};

/**
 * The **drawn** X-module pitch of a returned 1D barcode: the integer
 * narrow-module scale `scaleX` (recovered from the padded canvas width) times
 * the node's stretch X draw scale `targetW / canvasW`. Mirror of
 * `drawnPitchBelowMinModule(…, 'stretch')` so a test can score the verdict
 * without re-deriving the engine internals. The box **height** deliberately does
 * not enter it: a 1D bar pitch is an X measurement and stretch never shrinks the
 * width to fit the height.
 */
const drawnPitch = (
    symbol: { canvas: HTMLCanvasElement } | null,
    paddedModules: number,
    targetW: number,
): number | null => {
    if (!symbol) return null;
    const { canvas } = symbol;
    if (!canvas.width || !canvas.height) return null;
    const scaleX = Math.round(canvas.width / paddedModules);
    return scaleX * (targetW / canvas.width);
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
        // Explicit transparent fill so the composite matches the bare `toCanvas`
        // reference byte-for-byte below.
        const generated = renderQr(text, 'M', target, target, 1, { fill: 'transparent' });
        expect(generated).not.toBeNull();
        if (!generated) return;
        // P2: the integer scale is chosen against the quiet-zone-padded budget.
        const layout = qrLayout(base.w, target);
        expect(layout.scale).toBeGreaterThan(1);
        expect(generated.belowMinModule).toBe(false);

        // The symbol is generated at the integer scale (one module = `scale` px),
        // then wrapped in the default quiet zone — the returned canvas is the
        // padded one, never a fractional resample.
        const ref = document.createElement('canvas');
        toCanvas(ref, {
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale: layout.scale,
            paddingwidth: 0,
            paddingheight: 0,
        } as BwipTestOptions);
        expect(ref.width / layout.scale, 'module width is the integer scale').toBe(base.w);
        expect(generated.canvas.width).toBe(ref.width + 2 * layout.quietPx);
        expect(generated.canvas.height).toBe(ref.height + 2 * layout.quietPx);

        // Crispness: the symbol is copied 1:1 at the quiet-zone offset — every
        // byte of the symbol region matches the un-resampled reference, so there
        // are no fractional (blurry) module edges.
        expect(
            differingBytes(
                region(generated.canvas, layout.quietPx, layout.quietPx, ref.width, ref.height),
                region(ref, 0, 0, ref.width, ref.height),
            ),
            'padded symbol is a byte-exact 1:1 copy',
        ).toBe(0);
        expect(darkBBox(generated.canvas)).toEqual({
            x: darkBBox(ref).x + layout.quietPx,
            y: darkBBox(ref).y + layout.quietPx,
            w: darkBBox(ref).w,
            h: darkBBox(ref).h,
        });
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
        const totalModules = base.w / 2 + 2 * DEFAULT_QR_QUIET_MODULES; // 33

        // 100 px / 33 padded modules = 3.03 px/module ≥ 3 → scannable. The old
        // `scale < minModulePx` (floor(100/66) = 1 < 3) wrongly flagged it.
        const ok = renderQr(text, 'M', 100, 100, minModulePx);
        expect(ok).not.toBeNull();
        expect(ok?.belowMinModule).toBe(false);
        // The raster still fits the box on the integer path — now measured and
        // padded: scale 1 symbol + its default quiet zone.
        expect(ok?.canvas.width).toBe(qrLayout(base.w, 100).canvasW);

        // 74 px / 33 = 2.24 px/module < 3 → too small.
        const small = renderQr(text, 'M', 74, 74, minModulePx);
        expect(small).not.toBeNull();
        expect(small?.belowMinModule).toBe(true);
        // The scale-1 symbol is returned un-resampled, wrapped in its
        // quiet-zone-padded budget (no integer scale fits the 74 px box).
        expect(small?.canvas.width).toBe(qrLayout(base.w, 74).canvasW);

        // The verdict is the P2 padded pitch, not the integer raster scale.
        expect(ok?.belowMinModule).toBe(100 / totalModules < minModulePx);
        expect(small?.belowMinModule).toBe(74 / totalModules < minModulePx);
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
        // Explicit transparent fill so the composite matches the bare `toCanvas`
        // reference byte-for-byte below.
        const generated = renderBarcode(text, 'code128', targetW, targetH, 1, { fill: 'transparent' });
        expect(generated).not.toBeNull();
        if (!generated) return;
        const quiet = barcodeQuietModules('code128');
        // P2: `scaleX` is chosen against the quiet-zone-padded width.
        const scaleX = Math.max(1, Math.floor(targetW / (base.w + 2 * quiet)));
        const scaleY = Math.max(1, Math.floor(targetH / base.h));
        expect(scaleX).toBeGreaterThan(1);
        const layout = barcodeLayout(base.w, targetW, quiet);

        const ref = document.createElement('canvas');
        toCanvas(ref, {
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX,
            scaleY,
        } as BwipTestOptions);
        expect(generated.canvas.width).toBe(ref.width + 2 * layout.quietPx);
        expect(generated.canvas.height).toBe(ref.height);
        // Module width is `scaleX` exactly — no dropped/merged bar columns.
        expect(generated.canvas.width, 'integer module width, no resample').toBe(base.w * scaleX + 2 * layout.quietPx);

        // Crispness: the bars are copied 1:1 after the horizontal quiet zone —
        // every byte matches the un-resampled reference.
        expect(
            differingBytes(
                region(generated.canvas, layout.quietPx, 0, ref.width, ref.height),
                region(ref, 0, 0, ref.width, ref.height),
            ),
            'padded bars are a byte-exact 1:1 copy',
        ).toBe(0);
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
        // exceeds the target, wrapped in its default quiet zone.
        const layout = qrLayout(base.w, target);
        expect(layout.scale).toBe(1);
        expect(generated.canvas.width).toBe(base.w + 2 * layout.quietPx);
        expect(generated.canvas.height).toBe(base.h + 2 * layout.quietPx);
        expect(countDark(generated.canvas)).toBeGreaterThan(0);
    });

    it('scores the barcode verdict on the stretch X pitch, not the raw scaleX (P2/P13)', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        const paddedModules = base.w + 2 * barcodeQuietModules('code128');
        const minModulePx = 3;

        // A large box: the integer scaleX is comfortably over the minimum and the
        // padded raster already spans the box width, so the stretch X scale is ~1
        // and the drawn pitch stays `scaleX`.
        const large = renderBarcode(text, 'code128', 1500, 500, minModulePx);
        expect(large?.belowMinModule).toBe(false);
        expect(large?.belowMinModule).toBe(
            (drawnPitch(large, paddedModules, 1500) ?? 0) < minModulePx,
        );

        // A tiny target forces scaleX 1 but is narrower than the padded raster, so
        // the stretch X scale (`targetW / canvasW`) is below 1 and drags the
        // printed pitch under the minimum.
        const tinyTargetW = Math.max(8, base.w - 1);
        const tiny = renderBarcode(text, 'code128', tinyTargetW, 20, minModulePx);
        expect(tiny?.belowMinModule).toBe(true);
        expect(tiny?.belowMinModule).toBe(
            (drawnPitch(tiny, paddedModules, tinyTargetW) ?? 0) < minModulePx,
        );
    });

    it('a height-constrained box no longer shrinks the barcode X pitch (stretch, P13)', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        const paddedModules = base.w + 2 * barcodeQuietModules('code128');
        const minModulePx = 3;

        // Width forces scaleX 4 (≥ the minimum) while the box is half the raster
        // high. 1D barcodes draw `stretch`, so a short box only shortens the bars:
        // the X pitch is `scaleX · targetW / canvasW` and never sees `targetH`.
        // The old `contain` verdict scored a uniform shrink the printer never
        // applied, which is why this case used to (wrongly) warn.
        const targetW = paddedModules * 4;
        const targetH = Math.max(1, Math.floor(base.h / 2));
        const generated = renderBarcode(text, 'code128', targetW, targetH, minModulePx);
        expect(generated).not.toBeNull();
        if (!generated) return;

        const scaleX = Math.round(generated.canvas.width / paddedModules);
        expect(generated.canvas.width, 'the padded raster spans the box width').toBe(targetW);
        expect(generated.canvas.height, 'the raster is taller than the box').toBeGreaterThan(
            targetH,
        );
        expect(scaleX, 'the integer narrow-module scale meets the minimum').toBeGreaterThanOrEqual(
            minModulePx,
        );
        expect(
            drawnPitch(generated, paddedModules, targetW),
            'the stretched printed pitch is the width pitch, independent of box height',
        ).toBe(scaleX);
        expect(generated.belowMinModule, 'a short box does not shrink a 1D bar').toBe(false);
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
        const targetW = Math.max(8, base.w - 1);
        const generated = renderBarcode(text, 'code128', targetW, 20, 3);
        expect(generated).not.toBeNull();
        if (!generated) return;
        expect(generated.belowMinModule).toBe(true);
        // Scale-1 bars returned un-resampled, with the default horizontal quiet zone.
        const layout = barcodeLayout(base.w, targetW, barcodeQuietModules('code128'));
        expect(layout.scaleX).toBe(1);
        expect(generated.canvas.width).toBe(base.w + 2 * layout.quietPx);
        expect(countDark(generated.canvas)).toBeGreaterThan(0);
    });

    it('pads a QR with the default 4-module quiet zone; quietZone 0 strips it', () => {
        const text = 'https://example.com';
        const base = baseSymbol({
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale: 1,
            paddingwidth: 0,
            paddingheight: 0,
        });
        expect(DEFAULT_QR_QUIET_MODULES).toBe(4);
        const target = 400;

        const padded = renderQr(text, 'M', target, target);
        expect(padded).not.toBeNull();
        if (!padded) return;
        const layout = qrLayout(base.w, target, DEFAULT_QR_QUIET_MODULES);
        expect(padded.canvas.width).toBe(layout.canvasW);
        // The padding is exactly `2·quietPx`; the symbol itself is `symbolW`.
        expect(padded.canvas.width - base.w * layout.scale).toBe(2 * layout.quietPx);
        expect(padded.canvas.width - layout.symbolW).toBe(2 * layout.quietPx);

        const bare = renderQr(text, 'M', target, target, 1, { quietModules: 0 });
        expect(bare).not.toBeNull();
        if (!bare) return;
        // quietZone 0 removes the padding: canvas == the symbol canvas, exactly.
        const bareLayout = qrLayout(base.w, target, 0);
        expect(bareLayout.quietPx).toBe(0);
        expect(bare.canvas.width).toBe(base.w * bareLayout.scale);
        expect(bare.canvas.height).toBe(base.h * bareLayout.scale);
    });

    it('the default fill paints the padded QR background opaque white; explicit transparent leaves it clear', () => {
        const text = 'https://example.com';
        const target = 400;

        // No options: the default symbol fill is opaque white.
        const defaultFill = renderQr(text, 'M', target, target);
        expect(defaultFill).not.toBeNull();
        if (!defaultFill) return;
        // (0,0) lies inside the quiet zone: opaque white proves the background
        // (quiet zone included) was painted.
        expect(pixelAt(defaultFill.canvas, 0, 0)).toEqual([255, 255, 255, 255]);

        // An explicit `'transparent'` opts the quiet zone/light modules to see
        // through.
        const clear = renderQr(text, 'M', target, target, 1, { fill: 'transparent' });
        expect(clear).not.toBeNull();
        if (!clear) return;
        expect(pixelAt(clear.canvas, 0, 0)).toEqual([0, 0, 0, 0]);
    });

    it('pads a barcode with its per-symbology quiet zone (code128 = 10X); quietZone 0 strips it', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        const quiet = barcodeQuietModules('code128');
        expect(quiet).toBe(10);
        const targetW = 1500;
        const targetH = 500;

        const padded = renderBarcode(text, 'code128', targetW, targetH);
        expect(padded).not.toBeNull();
        if (!padded) return;
        const layout = barcodeLayout(base.w, targetW, quiet);
        expect(padded.canvas.width).toBe(layout.canvasW);
        // Horizontal quiet zone only: exactly `2·quietPx` beyond the bars.
        expect(padded.canvas.width - base.w * layout.scaleX).toBe(2 * layout.quietPx);

        const bare = renderBarcode(text, 'code128', targetW, targetH, 1, { quietModules: 0 });
        expect(bare).not.toBeNull();
        if (!bare) return;
        const bareLayout = barcodeLayout(base.w, targetW, 0);
        expect(bareLayout.quietPx).toBe(0);
        expect(bare.canvas.width).toBe(base.w * bareLayout.scaleX);
    });

    it('pins the per-symbology quiet-zone module counts (code128 falls back to 10)', () => {
        const cases: Array<[Parameters<typeof barcodeQuietModules>[0], number]> = [
            ['ean13', 11],
            ['ean8', 7],
            ['upca', 9],
            ['upce', 9],
            ['ean5', 12],
            ['ean2', 12],
            ['itf14', 10],
            ['pharmacode', 10],
            ['pharmacode2', 10],
            ['code128', 10], // not in the explicit table → fallback path
        ];
        for (const [symbology, expected] of cases) {
            expect(barcodeQuietModules(symbology), symbology).toBe(expected);
        }
    });

    it('the default fill paints the padded barcode background opaque white', () => {
        // No options: the default symbol fill is opaque white.
        const filled = renderBarcode('123456789012', 'code128', 1500, 500);
        expect(filled).not.toBeNull();
        if (!filled) return;
        expect(pixelAt(filled.canvas, 0, 0)).toEqual([255, 255, 255, 255]);

        // An explicit `'transparent'` leaves the quiet zone see-through.
        const clear = renderBarcode('123456789012', 'code128', 1500, 500, 1, {
            fill: 'transparent',
        });
        expect(clear).not.toBeNull();
        if (!clear) return;
        // (0,0) sits in the left quiet zone: no ink, so see-through.
        expect(pixelAt(clear.canvas, 0, 0)?.[3]).toBe(0);
    });

    it('scores the QR verdict on the padded module pitch, not the integer raster scale (P2)', () => {
        const text = 'https://example.com';
        const base = baseSymbol({
            bcid: 'qrcode',
            text,
            eclevel: 'M',
            scale: 1,
            paddingwidth: 0,
            paddingheight: 0,
        });
        const totalModules = base.w / 2 + 2 * DEFAULT_QR_QUIET_MODULES; // 33
        const minModulePx = 3;

        // 160 / 33 = 4.85 px/module ≥ 3 → scannable, although the integer raster
        // scale (floor(160/66) = 2) is below 3. The old scale-based verdict was
        // wrong; the P2 verdict is on the printed pitch.
        const ok = renderQr(text, 'M', 160, 160, minModulePx);
        expect(ok).not.toBeNull();
        expect(ok?.belowMinModule).toBe(false);
        expect(ok?.belowMinModule).toBe(160 / totalModules < minModulePx);
        expect(Math.floor(160 / (totalModules * 2)) < minModulePx, 'old scale verdict').toBe(true);

        // 90 / 33 = 2.73 px/module < 3 → too small on the padded pitch.
        const small = renderQr(text, 'M', 90, 90, minModulePx);
        expect(small).not.toBeNull();
        expect(small?.belowMinModule).toBe(true);
        expect(small?.belowMinModule).toBe(90 / totalModules < minModulePx);
    });

    it('scores the barcode verdict on the stretch-scaled padded X-module pitch (P2/P13)', () => {
        const text = '123456789012';
        const base = baseSymbol({
            bcid: 'code128',
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: 1,
            scaleY: 1,
        });
        const totalModules = base.w + 2 * barcodeQuietModules('code128');
        const minModulePx = 3;

        // A target at / just below the padded minimum: scaleX 3 (scannable) vs 2
        // (too small). The bare-bar budget would score the smaller box as ≥ 3.
        const atMin = totalModules * minModulePx;
        const belowMin = atMin - 1;
        const ok = renderBarcode(text, 'code128', atMin, 500, minModulePx);
        expect(ok?.belowMinModule).toBe(false);
        expect(ok?.belowMinModule).toBe(
            (drawnPitch(ok, totalModules, atMin) ?? 0) < minModulePx,
        );

        const small = renderBarcode(text, 'code128', belowMin, 500, minModulePx);
        expect(small?.belowMinModule).toBe(true);
        expect(small?.belowMinModule).toBe(
            (drawnPitch(small, totalModules, belowMin) ?? 0) < minModulePx,
        );
        // The bare-bar budget (ignoring the quiet zone) would call it scannable,
        // which is why the padded budget is the correct verdict.
        expect(Math.floor(belowMin / base.w) < minModulePx, 'bare-bar budget').toBe(false);
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

describe('provider-scope isolation (D-28)', () => {
    /**
     * The primitive the print dialog relies on for D-28: two provider objects
     * from the same repo are two decode scopes. The dialog's own wiring (queue
     * thumbnails vs the print/preview pass) is covered in
     * `components/print/PrintDialog.test.tsx`.
     */
    const docWithLocalImage = (): LabelDoc => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [...fullRegions],
            nodes: [imageNode('img', 0, 0, 1000, 1000)],
        });
        doc.resources.images.push({
            imageId: 'i1',
            name: 'photo',
            source: { kind: 'local', mediaType: 'image/png', resourceId: 'r1' },
            widthPx: 10,
            heightPx: 10,
        });
        return doc;
    };

    /** A repo whose `get` counts how many times the bytes provider was asked. */
    const countingRepo = (): { repo: ResourceRepo; get: ReturnType<typeof vi.fn> } => {
        const bytes = new Uint8Array([1, 2, 3]);
        const get = vi.fn(async (id: string) => ({ id, mediaType: 'image/png', bytes }));
        return { repo: { get } as unknown as ResourceRepo, get };
    };

    it('two provider objects from the same repo decode independently (separate scopes)', async () => {
        const doc = docWithLocalImage();
        const nodes = resolve(doc);
        const { repo, get } = countingRepo();

        // `createResourceAssetProviders` mints a fresh `images` provider object
        // each call — the decode cache's scope key.
        const depsA = createResourceAssetProviders(repo);
        const depsB = createResourceAssetProviders(repo);
        expect(depsA.images).not.toBe(depsB.images);

        const first = prepareResolvedAssets(nodes, doc, depsA);
        const second = prepareResolvedAssets(nodes, doc, depsB);
        await Promise.all([first, second]);

        // Two scopes ask the provider twice for the same ref. A shared scope
        // would have deduped the in-flight promise and asked once.
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('one shared provider scope decodes the same ref once', async () => {
        const doc = docWithLocalImage();
        const nodes = resolve(doc);
        const { repo, get } = countingRepo();

        const deps = createResourceAssetProviders(repo);
        const first = prepareResolvedAssets(nodes, doc, deps);
        const second = prepareResolvedAssets(nodes, doc, deps);
        await Promise.all([first, second]);

        expect(get).toHaveBeenCalledTimes(1);
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
