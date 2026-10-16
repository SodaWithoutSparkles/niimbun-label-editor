// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { nodeLookup } from '../../core/doc/derive';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { rasterDimensions, type RgbaBuffer } from '../../core/render';
import type { PreparedAsset } from './assets';
import { renderCode } from './codeImage';
import { clearAssetCache } from './prepareAssets';
import { buildPolicyMask, renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';

/**
 * P11 W5: ink-mask carrier coverage for the `code` leaf — the silent trap from
 * the plan (`renderLabelPage.ts:254,312`). Without `code` in the carrier cases
 * the new object claims no ink-mask coverage: an opaque code would let the
 * under-image's dither show through its dark modules and a transparent code
 * would wrongly claim its quiet zone. This mirrors
 * `renderLabelPage.mask.test.ts`'s qr cases one-for-one.
 *
 * The mid-gray under-image is deliberate: `threshold` (the code policy) maps gray
 * 128 → pure white uniformly, while `floydSteinberg` (the image policy) dithers
 * it into a black/white mix, so "which policy governs this pixel" is observable.
 */

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
const CODE_PAYLOAD = 'HELLO WORLD';

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

const codeNode = (
    id: string,
    x: number,
    y: number,
    sizeHm: number,
    extra: Record<string, unknown> = {},
): Node =>
    node({
        id,
        parentId: null,
        type: 'code',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        format: 'datamatrix',
        data: { kind: 'static', value: CODE_PAYLOAD },
        size: { w: sizeHm, h: sizeHm },
        ...extra,
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
                dataUrl: `data:image/png;base64,R8CODEMASK${dataUrlSeq++}`,
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

/** A real 2D-code raster (absent fill: engine default opaque white). */
const renderSymbol = (fill?: string) => {
    const generated = renderCode(CODE_PAYLOAD, 'datamatrix', 130, 130, 1, fill ? { fill } : {});
    if (!generated) throw new Error('renderCode returned null');
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

describe('renderLabelPage — code ink-mask carrier (P11 W5)', () => {
    it('a lone opaque code still participates in the mask (silent-trap guard)', async () => {
        const sym = renderSymbol('#ffffff');
        const size = sym.canvas.width;
        const doc = imageDoc([codeNode('c', ORIGIN.x * 10, ORIGIN.y * 10, size * 10, { fill: '#ffffff' })]);

        const built = await buildMask(doc, new Map<string, PreparedAsset>([['c', assetOf(sym.canvas)]]));
        // If `code` were not a carrier case, `buildPolicyMask` would find zero
        // policies and return `undefined` — the trap this asserts against.
        expect(built).toBeDefined();
        if (!built) return;
        expect(built.policies.size, 'code contributes its threshold policy').toBe(1);

        const w = built.mask.width;
        const [du, dv] = darkPixelOf(sym.canvas);
        expect(
            built.mask.data[(ORIGIN.y + dv) * w + (ORIGIN.x + du)],
            'a dark module is claimed by the code policy (index 1)',
        ).toBe(1);
    });

    it('transparent-fill code over a dithered image: quiet zone keeps the image policy, dark modules threshold', async () => {
        const sym = renderSymbol('transparent');
        const size = sym.canvas.width;
        const doc = imageDoc([
            imageNode('img', 0, 0, 4000, 2000),
            codeNode('c', ORIGIN.x * 10, ORIGIN.y * 10, size * 10, { fill: 'transparent' }),
        ]);
        const gray = grayAsset();

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => gray } });

        const quietPx = quietPxOf(sym.canvas);
        expect(quietPx, 'the generated code has a quiet zone').toBeGreaterThan(1);

        // The quiet zone sits over the mid-gray image: the image's floyd policy
        // dithers it (black AND white) rather than threshold's uniform white.
        const quiet = scan(
            page.rgba,
            ORIGIN.x + 1,
            ORIGIN.y + 1,
            ORIGIN.x + quietPx,
            ORIGIN.y + size - 1,
        );
        expect(quiet.black, 'the image dithers through the quiet zone').toBeGreaterThan(0);
        expect(quiet.white, 'the quiet zone is not solid ink').toBeGreaterThan(0);

        // Structural: the mask bytes agree with the pixels.
        const built = await buildMask(
            doc,
            new Map<string, PreparedAsset>([
                ['img', gray],
                ['c', assetOf(sym.canvas)],
            ]),
        );
        expect(built).toBeDefined();
        if (!built) return;
        expect(built.policies.size, 'image policy + code policy').toBe(2);
        const w = built.mask.width;
        expect(
            built.mask.data[(ORIGIN.y + 2) * w + (ORIGIN.x + 2)],
            'quiet zone keeps the under-image policy (index 1)',
        ).toBe(1);
        const [du, dv] = darkPixelOf(sym.canvas);
        expect(
            built.mask.data[(ORIGIN.y + dv) * w + (ORIGIN.x + du)],
            'dark module takes the code policy (index 2)',
        ).toBe(2);

        // A light module inside the matrix is transparent ink too, so it must
        // also leave the image policy below — not be claimed by the code.
        const [lu, lv] = lightModulePixelOf(sym.canvas);
        expect(
            built.mask.data[(ORIGIN.y + lv) * w + (ORIGIN.x + lu)],
            'light module keeps the under-image policy (index 1)',
        ).toBe(1);
    });

    it('opaque-fill code over a dithered image: the whole drawn rect is governed by the code policy', async () => {
        const transparent = renderSymbol('transparent'); // geometry twin
        const opaque = renderSymbol('#ffffff');
        const size = opaque.canvas.width;
        const doc = imageDoc([
            imageNode('img', 0, 0, 4000, 2000),
            codeNode('c', ORIGIN.x * 10, ORIGIN.y * 10, size * 10, { fill: '#ffffff' }),
        ]);
        const gray = grayAsset();

        const page = await renderLabelPage(doc, {}, { assets: { resolveImage: () => gray } });

        const quietPx = quietPxOf(transparent.canvas);
        expect(quietPx, 'the code geometry has a quiet zone').toBeGreaterThan(1);

        // The opaque white fill paints the quiet zone, so the code's threshold
        // policy governs it: no floyd dither, no image bleed-through.
        const quiet = scan(
            page.rgba,
            ORIGIN.x + 1,
            ORIGIN.y + 1,
            ORIGIN.x + quietPx,
            ORIGIN.y + size - 1,
        );
        expect(quiet.black, 'the image no longer shows through inside the rect').toBe(0);
        expect(quiet.white, 'the quiet zone is opaque white').toBeGreaterThan(0);

        const built = await buildMask(
            doc,
            new Map<string, PreparedAsset>([
                ['img', gray],
                ['c', assetOf(opaque.canvas)],
            ]),
        );
        expect(built).toBeDefined();
        if (!built) return;
        const w = built.mask.width;
        expect(
            built.mask.data[(ORIGIN.y + 2) * w + (ORIGIN.x + 2)],
            'the whole drawn rect takes the code policy (index 2)',
        ).toBe(2);
        const [du, dv] = darkPixelOf(opaque.canvas);
        expect(
            built.mask.data[(ORIGIN.y + dv) * w + (ORIGIN.x + du)],
            'dark module also takes the code policy (index 2)',
        ).toBe(2);
    });
});
