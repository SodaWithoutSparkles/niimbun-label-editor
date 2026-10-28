// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { nodeLookup } from '../../core/doc/derive';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { floydSteinberg, rasterDimensions, stucki, type RgbaBuffer } from '../../core/render';
import type { PreparedAsset } from './assets';
import { renderBarcode } from './barcodeImage';
import { clearAssetCache } from './prepareAssets';
import { renderQr } from './qrImage';
import { buildPolicyMask, renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';

/**
 * P2 R8 — stacking / ink-aware policy-mask matrix.
 *
 * Fix (A) changed `buildPolicyMask` so an image/qr/barcode leaf claims only the
 * **visible ink** of its prepared asset (`maskAssetSceneFunc`), tinted to the
 * policy key colour, in z-order (last write wins per pixel). Previously the
 * whole drawn rect was filled.
 *
 * Consequences pinned here, end-to-end through `renderLabelPage` (the shared
 * preview/print path) and structurally on `buildPolicyMask`:
 *  - a `fill: 'transparent'` symbol claims only its opaque modules, so its light
 *    modules + quiet zone leave the leaf below's policy governing those pixels;
 *  - a `fill: '#ffffff'` symbol is fully opaque and claims its whole drawn rect;
 *  - overlapping symbols resolve topmost-wins where the top is opaque, and let
 *    the bottom's policy show through the top's transparent parts;
 *  - a plain opaque image alone still claims its whole drawn rect (regression).
 *
 * A mid-gray under-image is used deliberately: `threshold` maps gray 128 → pure
 * white uniformly, while `floydSteinberg` dithers it into a black/white mix, so
 * "which policy governs this pixel" is observable in the quantized output.
 */

// `renderQr` needs a real rasterizer; nothing is installed until this runs.
beforeAll(() => {
    installCanvasShim();
});
beforeEach(() => {
    clearAssetCache();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const DPI = 254;
/** 4000×2000 hm @254dpi → 400×200 px (a clean 0.1 hm/px stage scale). */
const fullRegions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }];

/** Top-left of the symbol's drawn rect, in device px. */
const ORIGIN = { x: 150, y: 20 };
const QR_PAYLOAD = 'HELLO WORLD';

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

const qrNode = (
    id: string,
    x: number,
    y: number,
    sizeHm: number,
    extra: Record<string, unknown> = {},
): Node =>
    node({
        id,
        parentId: null,
        type: 'qr',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'static', value: QR_PAYLOAD },
        size: { w: sizeHm, h: sizeHm },
        ...extra,
    });

/** A 1D barcode leaf; `w`/`h` are the node box (hm). */
const barcodeNode = (id: string, x: number, y: number, w: number, h: number): Node =>
    node({
        id,
        parentId: null,
        type: 'barcode',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        data: { kind: 'static', value: '123456789012' },
        size: { w, h },
    });

/** A doc with a single inline image resource `i1` (decoded via `resolveImage`). */
let dataUrlSeq = 0;
const imageDoc = (nodes: Node[]): LabelDoc => {
    const doc = createLabelDoc({
        backingW: 4000,
        backingH: 2000,
        dpi: DPI,
        regions: fullRegions,
        nodes,
    });
    doc.resources.images = [
        {
            imageId: 'i1',
            name: 'gray',
            source: {
                kind: 'inline',
                mediaType: 'image/png',
                // Unique per call so the provider-scoped decode cache never
                // reuses one test's raster for another's.
                dataUrl: `data:image/png;base64,R8MASK${dataUrlSeq++}`,
            },
            widthPx: 400,
            heightPx: 200,
        },
    ];
    return doc;
};

const canvasOf = (
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('test canvas has no 2D context');
    draw(ctx);
    return canvas;
};

const assetOf = (canvas: HTMLCanvasElement): PreparedAsset => ({
    image: canvas,
    widthPx: canvas.width,
    heightPx: canvas.height,
});

/** A uniform opaque mid-gray asset filling the whole 400×200 page rect. */
const grayAsset = (): PreparedAsset =>
    assetOf(
        canvasOf(400, 200, (ctx) => {
            ctx.fillStyle = 'rgb(128,128,128)';
            ctx.fillRect(0, 0, 400, 200);
        }),
    );

/** A real QR raster generated with the given `fill` (absent: engine default, opaque white). */
const renderSymbol = (fill?: string) => {
    const generated = renderQr(QR_PAYLOAD, 'M', 130, 130, 1, fill ? { fill } : {});
    if (!generated) throw new Error('renderQr returned null');
    return generated;
};

const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('test canvas has no 2D context');
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
};

/** Number of fully-transparent leading columns (the symbol's quiet zone). */
const quietPxOf = (canvas: HTMLCanvasElement): number => {
    const data = pixelsOf(canvas);
    for (let x = 0; x < canvas.width; x++) {
        for (let y = 0; y < canvas.height; y++) {
            if (data[(y * canvas.width + x) * 4 + 3]! > 0) return x;
        }
    }
    return canvas.width;
};

/** Top-left-most opaque black pixel of a symbol raster (`[u, v]`). */
const darkPixelOf = (canvas: HTMLCanvasElement): [number, number] => {
    const data = pixelsOf(canvas);
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (data[i + 3]! > 0 && data[i]! < 128) return [x, y];
        }
    }
    return [0, 0];
};

/** Top-left-most fully-transparent pixel strictly inside the symbol matrix. */
const lightModulePixelOf = (canvas: HTMLCanvasElement): [number, number] => {
    const data = pixelsOf(canvas);
    const quiet = quietPxOf(canvas);
    for (let y = quiet; y < canvas.height - quiet; y++) {
        for (let x = quiet; x < canvas.width - quiet; x++) {
            if (data[(y * canvas.width + x) * 4 + 3]! === 0) return [x, y];
        }
    }
    return [quiet, quiet];
};

interface Scan {
    black: number;
    white: number;
}

/** Count quantized black/white pixels in the half-open box [x0,x1)×[y0,y1). */
const scan = (rgba: RgbaBuffer, x0: number, y0: number, x1: number, y1: number): Scan => {
    let black = 0;
    let white = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const v = rgba.data[(y * rgba.width + x) * 4]!;
            if (v === 0) black++;
            else if (v === 255) white++;
        }
    }
    return { black, white };
};

const buildMask = async (doc: LabelDoc, assets: ReadonlyMap<string, PreparedAsset>) => {
    const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
    return buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi, assets);
};

describe('renderLabelPage — R8 stacking / ink-aware policy mask', () => {
    it('transparent-fill symbol over a dithered image: quiet zone keeps the image policy, dark modules threshold', async () => {
        const sym = renderSymbol('transparent'); // node below uses an explicit transparent fill
        const size = sym.canvas.width;
        const nodeHm = size * 10; // box px == asset px → 1:1 mapping
        const doc = imageDoc([
            imageNode('img', 0, 0, 4000, 2000),
            qrNode('q', ORIGIN.x * 10, ORIGIN.y * 10, nodeHm, { fill: 'transparent' }),
        ]);
        const gray = grayAsset();

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => gray } });

        const quietPx = quietPxOf(sym.canvas);
        expect(quietPx, 'the generated symbol has a quiet zone').toBeGreaterThan(1);

        // The quiet zone sits over the mid-gray image. Threshold (the symbol's
        // own policy) would render it pure white uniformly; floyd (the image
        // policy) dithers it into a mix — so a black pixel here proves the
        // image policy still governs, i.e. the transparent symbol did not claim
        // the pixels it draws nothing on.
        const quiet = scan(
            page.rgba,
            ORIGIN.x + 1,
            ORIGIN.y + 1,
            ORIGIN.x + quietPx,
            ORIGIN.y + size - 1,
        );
        expect(quiet.black, 'the image dithers through the quiet zone').toBeGreaterThan(0);
        expect(quiet.white, 'the quiet zone is not solid ink').toBeGreaterThan(0);

        // Dark modules are opaque; the symbol's own threshold policy applies.
        const [du, dv] = darkPixelOf(sym.canvas);
        const dark = scan(
            page.rgba,
            ORIGIN.x + du,
            ORIGIN.y + dv,
            ORIGIN.x + du + 2,
            ORIGIN.y + dv + 2,
        );
        expect(dark.black, 'dark modules are pure black').toBeGreaterThan(0);

        // Structural: the mask bytes agree with the pixels.
        const built = await buildMask(
            doc,
            new Map<string, PreparedAsset>([
                ['img', gray],
                ['q', assetOf(sym.canvas)],
            ]),
        );
        expect(built).toBeDefined();
        if (!built) return;
        expect(built.policies.size, 'image policy + symbol policy').toBe(2);
        const w = built.mask.width;
        expect(
            built.mask.data[(ORIGIN.y + 2) * w + (ORIGIN.x + 2)],
            'quiet zone keeps the under-image policy (index 1)',
        ).toBe(1);
        expect(
            built.mask.data[(ORIGIN.y + dv) * w + (ORIGIN.x + du)],
            'dark module takes the symbol policy (index 2)',
        ).toBe(2);

        // A light module inside the symbol matrix is transparent ink too, so it
        // must also leave the image policy below — not be claimed by the symbol.
        const [lu, lv] = lightModulePixelOf(sym.canvas);
        expect(
            built.mask.data[(ORIGIN.y + lv) * w + (ORIGIN.x + lu)],
            'light module keeps the under-image policy (index 1)',
        ).toBe(1);

        // Pixel proof over every transparent (light-module) pixel of the symbol:
        // threshold (the symbol's policy) maps the uniform gray to pure white, so
        // the floyd mix here proves the image dithers through light modules.
        let lightBlack = 0;
        let lightWhite = 0;
        const symData = pixelsOf(sym.canvas);
        for (let v = quietPx; v < size - quietPx; v++) {
            for (let u = quietPx; u < size - quietPx; u++) {
                if (symData[(v * size + u) * 4 + 3]! !== 0) continue;
                const pageV = page.rgba.data[((ORIGIN.y + v) * page.widthPx + (ORIGIN.x + u)) * 4]!;
                if (pageV === 0) lightBlack++;
                else if (pageV === 255) lightWhite++;
            }
        }
        expect(lightBlack, 'the image dithers through light modules').toBeGreaterThan(0);
        expect(lightWhite, 'light modules are not solid ink').toBeGreaterThan(0);
    });

    it('opaque-fill symbol over a dithered image: the whole drawn rect is governed by the symbol policy', async () => {
        const transparent = renderSymbol('transparent'); // geometry twin
        const opaque = renderSymbol('#ffffff');
        const size = opaque.canvas.width;
        const nodeHm = size * 10;
        const doc = imageDoc([
            imageNode('img', 0, 0, 4000, 2000),
            qrNode('q', ORIGIN.x * 10, ORIGIN.y * 10, nodeHm, { fill: '#ffffff' }),
        ]);
        const gray = grayAsset();

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => gray } });

        const quietPx = quietPxOf(transparent.canvas);
        expect(quietPx, 'the symbol geometry has a quiet zone').toBeGreaterThan(1);

        // The opaque white symbol fills its quiet zone, so the symbol's
        // threshold policy governs it: no floyd dither, no image bleed-through.
        const quiet = scan(
            page.rgba,
            ORIGIN.x + 1,
            ORIGIN.y + 1,
            ORIGIN.x + quietPx,
            ORIGIN.y + size - 1,
        );
        expect(quiet.black, 'the image no longer shows through inside the rect').toBe(0);
        expect(quiet.white, 'the quiet zone is opaque white').toBeGreaterThan(0);

        const [du, dv] = darkPixelOf(opaque.canvas);
        const dark = scan(
            page.rgba,
            ORIGIN.x + du,
            ORIGIN.y + dv,
            ORIGIN.x + du + 2,
            ORIGIN.y + dv + 2,
        );
        expect(dark.black, 'dark modules are pure black').toBeGreaterThan(0);

        const built = await buildMask(
            doc,
            new Map<string, PreparedAsset>([
                ['img', gray],
                ['q', assetOf(opaque.canvas)],
            ]),
        );
        expect(built).toBeDefined();
        if (!built) return;
        const w = built.mask.width;
        expect(
            built.mask.data[(ORIGIN.y + 2) * w + (ORIGIN.x + 2)],
            'the whole drawn rect takes the symbol policy (index 2)',
        ).toBe(2);
        expect(
            built.mask.data[(ORIGIN.y + dv) * w + (ORIGIN.x + du)],
            'dark module also takes the symbol policy (index 2)',
        ).toBe(2);
    });

    it('semi-transparent-fill symbol over a dithered image: visible alpha ink claims the symbol policy', async () => {
        // A `#rrggbbaa` fill (ColorPicker format) at 25% alpha: the quiet zone and
        // light modules are visible ink but below the mask reader's old `alpha <
        // 128` test. With coverage snapped binary they still claim the symbol
        // policy — the same class of bug as an unexplained transparent hole.
        const sym = renderSymbol('#00000040');
        const size = sym.canvas.width;
        const nodeHm = size * 10;
        const doc = imageDoc([
            imageNode('img', 0, 0, 4000, 2000),
            qrNode('q', ORIGIN.x * 10, ORIGIN.y * 10, nodeHm, { fill: '#00000040' }),
        ]);
        const gray = grayAsset();

        const built = await buildMask(
            doc,
            new Map<string, PreparedAsset>([
                ['img', gray],
                ['q', assetOf(sym.canvas)],
            ]),
        );
        expect(built).toBeDefined();
        if (!built) return;
        const w = built.mask.width;

        // The semi-transparent fill region (quiet zone) is visible ink, so it must
        // be governed by the **symbol's** policy (index 2), not left partly
        // transparent for the under-image policy (index 1).
        expect(
            built.mask.data[(ORIGIN.y + 2) * w + (ORIGIN.x + 2)],
            'the semi-transparent fill region claims the symbol policy (index 2)',
        ).toBe(2);
        const [du, dv] = darkPixelOf(sym.canvas);
        expect(
            built.mask.data[(ORIGIN.y + dv) * w + (ORIGIN.x + du)],
            'dark modules still take the symbol policy (index 2)',
        ).toBe(2);
    });

    it('cover fit: the mask stencil honours the source crop (raster/mask parity)', async () => {
        // A 200×100 source: opaque left half, transparent right half. A square
        // 1000 hm box with `cover` crops the source centre (fraction x 0.25..0.75),
        // so the left half of the box is ink and the right half is clear.
        const source = assetOf(
            canvasOf(200, 100, (ctx) => {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, 100, 100);
            }),
        );
        const doc = imageDoc([
            node({ ...imageNode('img', 1500, 200, 1000, 1000), fit: 'cover' }),
        ]);

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => source } });

        const built = await buildMask(doc, new Map<string, PreparedAsset>([['img', source]]));
        expect(built).toBeDefined();
        if (!built) return;
        const w = built.mask.width;
        // Box px: x 150..250, y 20..120 (stage scale 0.1 px/hm).
        expect(built.mask.data[30 * w + 160], 'cover ink claims the left half').toBe(1);
        expect(built.mask.data[30 * w + 225], 'the cropped-away source claims nothing').toBe(0);

        // Raster parity: the same split — ink left, clear right.
        const at = (x: number, y: number): number =>
            page.rgba.data[(y * page.widthPx + x) * 4]!;
        expect(at(160, 30), 'raster ink on the left').toBe(0);
        expect(at(225, 30), 'raster clear on the right').toBe(255);
    });

    it('barcode fit: the mask claims the whole box — stretch, no crop and no letterbox', async () => {
        // A real 1D raster with the quiet zone baked in, generated for a 200×40
        // target, placed in a 200×100 px node box: `contain` would letterbox the
        // bars into their own shorter strip; `cover` would crop the source's
        // left/right ends (quiet zone + end bars). 1D barcodes draw `stretch`, so
        // the mask must claim the full box and follow the plain per-axis scales.
        const generated = renderBarcode('123456789012', 'code128', 200, 40, 1, {
            fill: 'transparent',
        });
        if (!generated) throw new Error('renderBarcode returned null');
        const raster = assetOf(generated.canvas);
        const boxW = 200;
        const boxH = 100;
        expect(raster.heightPx, 'the raster is much shorter than the node box').toBeLessThan(boxH);
        expect(raster.widthPx, 'the raster does not fill 200 px exactly').toBeLessThanOrEqual(boxW);

        const doc = imageDoc([
            imageNode('img', 0, 0, 4000, 2000),
            barcodeNode('bc', 1000, 200, boxW * 10, boxH * 10),
        ]);
        const gray = grayAsset();

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => gray } });
        const built = await buildMask(
            doc,
            new Map<string, PreparedAsset>([
                ['img', gray],
                ['bc', raster],
            ]),
        );
        expect(built).toBeDefined();
        if (!built) return;
        const w = built.mask.width;
        const maskAt = (x: number, y: number): number => built.mask.data[y * w + x]!;

        // Box px: x 100..300, y 20..120 (stage scale 0.1 px/hm).
        const xScale = boxW / raster.widthPx;
        const [du, dv] = darkPixelOf(generated.canvas);
        const col = 100 + Math.min(boxW - 1, Math.floor(du * xScale) + 1);
        expect(maskAt(col, 20 + dv), 'a bar claims the barcode policy (index 2)').toBe(2);

        // No letterbox: X and Y stretch independently, so the bars span the whole
        // box height. `contain` would leave the top and bottom rows unclaimed.
        expect(maskAt(col, 20), 'the bars reach the top edge of the box').toBe(2);
        expect(maskAt(col, 119), 'and the bottom edge').toBe(2);

        // No crop: the X mapping is the plain width scale, so the quiet zone keeps
        // its columns and the **last** bar column still lands inside the box.
        const quiet = quietPxOf(generated.canvas);
        expect(quiet, 'the raster has a horizontal quiet zone').toBeGreaterThan(2);
        expect(maskAt(100, 20), 'the left quiet zone claims no bar ink').toBe(1);

        const pixels = pixelsOf(generated.canvas);
        const isDark = (u: number): boolean => {
            const i = u * 4; // row 0
            return pixels[i + 3]! > 0 && pixels[i]! < 128;
        };
        let lastBar = raster.widthPx - 1;
        while (lastBar > 0 && !isDark(lastBar)) lastBar--;
        expect(maskAt(100 + Math.floor(lastBar * xScale), 20), 'the end bar survives').toBe(2);
        expect(100 + Math.floor(lastBar * xScale), 'the last bar is near the box right edge').toBeGreaterThan(250);

        // Raster parity: the page paints the same ink in the same places.
        const inkAt = (x: number, y: number): number => page.rgba.data[(y * page.widthPx + x) * 4]!;
        expect(inkAt(col, 20), 'raster ink at the top of the stretched bar').toBe(0);
        expect(inkAt(100, 20), 'raster clear in the quiet zone').toBe(255);
    });

    it('symbol-over-symbol z-order: top ink wins where opaque, bottom policy shows through transparent parts', async () => {
        // Bottom box px (50..150), top box px (100..200); overlap (100..150).
        // Bottom is fully opaque; top is opaque only on its right half.
        const bottomOpaque = assetOf(
            canvasOf(100, 100, (ctx) => {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, 100, 100);
            }),
        );
        const topHalfTransparent = assetOf(
            canvasOf(100, 100, (ctx) => {
                ctx.fillStyle = '#000000';
                ctx.fillRect(50, 0, 50, 100); // left half transparent
            }),
        );

        const maskFor = async (bottomHint: string, topHint: string) => {
            const doc = createLabelDoc({
                backingW: 4000,
                backingH: 2000,
                dpi: DPI,
                regions: fullRegions,
                nodes: [
                    qrNode('qb', 500, 500, 1000, { quantizerHint: bottomHint }),
                    qrNode('qt', 1000, 500, 1000, { quantizerHint: topHint }),
                ],
            });
            const built = await buildMask(
                doc,
                new Map<string, PreparedAsset>([
                    ['qb', bottomOpaque],
                    ['qt', topHalfTransparent],
                ]),
            );
            if (!built) throw new Error('expected a policy mask');
            return built;
        };

        const at = (mask: { data: Uint8Array; width: number }, x: number, y: number) =>
            mask.data[y * mask.width + x]!;

        // Order A: bottom floydSteinberg (index 1), top stucki (index 2).
        const a = await maskFor('floydSteinberg', 'stucki');
        expect(a.policies.size).toBe(2);
        expect(at(a.mask, 75, 100), 'bottom-only pixel takes the bottom policy').toBe(1);
        expect(
            at(a.mask, 125, 100),
            'top transparent ⇒ the bottom policy shows through',
        ).toBe(1);
        expect(at(a.mask, 175, 100), 'top opaque ink wins').toBe(2);
        expect(at(a.mask, 225, 100), 'uncovered pixels stay global (0)').toBe(0);
        const aPolicies = a.policies.get(2);
        expect(aPolicies && typeof aPolicies !== 'function' ? aPolicies.quantizer : aPolicies)
            .toBe(stucki);

        // Order B: swap the policies; z-order semantics are unchanged.
        const b = await maskFor('stucki', 'floydSteinberg');
        expect(at(b.mask, 75, 100), 'bottom-only pixel takes the bottom policy').toBe(1);
        expect(
            at(b.mask, 125, 100),
            'top transparent ⇒ the bottom policy shows through (swapped)',
        ).toBe(1);
        expect(at(b.mask, 175, 100), 'top opaque ink wins (swapped)').toBe(2);
        const bPolicies = b.policies.get(2);
        expect(bPolicies && typeof bPolicies !== 'function' ? bPolicies.quantizer : bPolicies)
            .toBe(floydSteinberg);
    });

    it('regression: a plain opaque image alone still claims its whole drawn rect', async () => {
        const doc = imageDoc([imageNode('img', 0, 0, 4000, 2000)]);
        const gray = grayAsset();

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => gray } });

        // The mask covers the entire 400×200 drawn rect with the image's own
        // policy (index 1) — the ink-aware stencil must not shrink an opaque
        // image's footprint.
        const built = await buildMask(doc, new Map<string, PreparedAsset>([['img', gray]]));
        expect(built).toBeDefined();
        if (!built) return;
        expect(built.mask.data.length).toBe(page.widthPx * page.heightPx);
        expect(built.mask.data.every((value) => value === 1)).toBe(true);

        // Floyd (the image default) applied across the whole rect dithers the
        // uniform gray into a mix — the common path is unchanged.
        const whole = scan(page.rgba, 0, 0, page.widthPx, page.heightPx);
        expect(whole.black).toBeGreaterThan(0);
        expect(whole.white).toBeGreaterThan(0);
    });
});
