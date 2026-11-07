// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import { grayLevelColor, type RgbaBuffer } from '../../core/render';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { installCanvasShim } from '../../test/canvasHarness';
import type { PreparedAsset } from './assets';
import { renderLabelPage } from './renderLabelPage';

/**
 * P5 wave A — red/black page colour end to end through the shared render path.
 *
 * The page is one `diffuseToPalette` pass over `redBlackPalette`, but the
 * per-object policy mask decides each pixel's path:
 *
 *  - `threshold` policies (text / qr / barcode / code, shapes and uncovered
 *    pixels via the global slot) are **flat point ops** classified straight to
 *    one exact entry — authored red stays crisp red, mid-greys stay white;
 *  - every diffusing policy (`image` → `floydSteinberg`) dithers through the
 *    two-ink palette.
 *
 * The encoder's DoubleColor split matches exact `0xffffff` / `0xff0000`, so the
 * channel contract is asserted on every pixel rather than sampled.
 *
 * Fixtures stay small (100×50 px at 254 dpi), same as the grayscale suite.
 */

beforeAll(() => {
    installCanvasShim();
});

const DPI = 254;
/** 1000×500 hm @254 dpi → a 100×50 px page (0.1 hm/px). */
const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }];

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const docWith = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 1000, backingH: 500, dpi: DPI, regions, nodes });

/** A doc with a single inline image resource `i1` (decoded via `resolveImage`). */
let dataUrlSeq = 0;
const imageDoc = (nodes: Node[]): LabelDoc => {
    const doc = docWith(nodes);
    doc.resources.images = [
        {
            imageId: 'i1',
            name: 'gray',
            source: {
                kind: 'inline',
                mediaType: 'image/png',
                // Unique per call so the provider-scoped decode cache never
                // reuses one test's raster for another's.
                dataUrl: `data:image/png;base64,RBFLAT${dataUrlSeq++}`,
            },
            widthPx: 100,
            heightPx: 50,
        },
    ];
    return doc;
};

/** A text leaf; `fill` absent means the default (black) ink. */
const textNode = (id: string, x: number, fill?: string): Node =>
    node({
        id,
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x, y: 5, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'static', value: 'H' },
        size: { w: 400, h: 500 },
        fontSize: 400,
        ...(fill !== undefined ? { fill } : {}),
    });

/** A flat opaque rectangle; `extra` carries quantizer hints for the mask tests. */
const rect = (
    id: string,
    x: number,
    w: number,
    fill: string,
    extra: Record<string, unknown> = {},
): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w, h: 500 },
        fill,
        stroke: 'transparent',
        ...extra,
    });

/** A full-page image leaf backed by `i1`. */
const imageNode = (id: string, extra: Record<string, unknown> = {}): Node =>
    node({
        id,
        parentId: null,
        type: 'image',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        imageId: 'i1',
        size: { w: 1000, h: 500 },
        ...extra,
    });

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

/** A uniform opaque mid-grey asset matching the 100×50 page rect 1:1. */
const grayAsset = (): PreparedAsset => {
    const canvas = canvasOf(100, 50, (ctx) => {
        ctx.fillStyle = 'rgb(128,128,128)';
        ctx.fillRect(0, 0, 100, 50);
    });
    return { image: canvas, widthPx: 100, heightPx: 50 };
};

const pixelAt = (rgba: RgbaBuffer, x: number, y: number): number[] => {
    const index = (y * rgba.width + x) * 4;
    return Array.from(rgba.data.slice(index, index + 4));
};

interface Tally {
    white: number;
    black: number;
    red: number;
    other: number;
}

/** Count how many pixels are each exact palette entry (alpha ignored). */
const tally = (rgba: RgbaBuffer): Tally => {
    const counts: Tally = { white: 0, black: 0, red: 0, other: 0 };
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r === 255 && g === 255 && b === 255) counts.white++;
        else if (r === 0 && g === 0 && b === 0) counts.black++;
        else if (r === 255 && g === 0 && b === 0) counts.red++;
        else counts.other++;
    }
    return counts;
};

describe('renderLabelPage — red/black page colour', () => {
    it('renders flat red text as exact red glyphs on white, with no black', async () => {
        const page = await renderLabelPage(
            docWith([textNode('t', 100, '#ff0000')]),
            {},
            { pageColor: 'redBlack' },
        );

        const counts = tally(page.rgba);
        expect(counts.red, 'the glyphs are red ink').toBeGreaterThan(0);
        expect(counts.white, 'the paper stays white').toBeGreaterThan(0);
        expect(counts.black, 'no pixel was dithered to black').toBe(0);
        expect(counts.other, 'only exact palette entries are written').toBe(0);
        // Away from the glyph box (100..500 hm = 10..50 px, height 50 px).
        expect(pixelAt(page.rgba, 90, 45)).toEqual([255, 255, 255, 255]);
    });

    it('renders default text as exact black glyphs on white', async () => {
        const page = await renderLabelPage(
            docWith([textNode('t', 100)]),
            {},
            { pageColor: 'redBlack' },
        );

        const counts = tally(page.rgba);
        expect(counts.black).toBeGreaterThan(0);
        expect(counts.white).toBeGreaterThan(0);
        expect(counts.red, 'neutral text never becomes red').toBe(0);
        expect(counts.other).toBe(0);
    });

    it('renders mid-grey flat text white: luminance 128 is not below the cutoff', async () => {
        const page = await renderLabelPage(
            docWith([textNode('t', 100, '#808080')]),
            {},
            { pageColor: 'redBlack' },
        );

        // Flat path only: no dither banks of black or red can appear. A plain
        // nearest-RGB classifier would send 128 to white too, but the diffusion
        // path would dither it — this pins that the text stayed flat.
        const counts = tally(page.rgba);
        expect(counts.black).toBe(0);
        expect(counts.red).toBe(0);
        expect(counts.other).toBe(0);
        expect(counts.white).toBe(page.widthPx * page.heightPx);
    });

    it('dithers a mid-grey image into black and white, with no red', async () => {
        const page = await renderLabelPage(
            imageDoc([imageNode('img')]),
            {},
            { pageColor: 'redBlack', assets: { resolveImage: () => grayAsset() } },
        );

        const counts = tally(page.rgba);
        expect(counts.black, 'the diffuser ran').toBeGreaterThan(0);
        expect(counts.white, 'the image is not solid ink').toBeGreaterThan(0);
        expect(counts.red, 'a neutral image has no red ink').toBe(0);
        expect(counts.other).toBe(0);
    });

    it('dithers a red-tinted image into red and white, with no black', async () => {
        const page = await renderLabelPage(
            imageDoc([imageNode('img', { tint: '#ff0000' })]),
            {},
            { pageColor: 'redBlack', assets: { resolveImage: () => grayAsset() } },
        );

        const counts = tally(page.rgba);
        expect(counts.red, 'the tint selects red ink').toBeGreaterThan(0);
        expect(counts.white, 'the red dots are spaced by paper').toBeGreaterThan(0);
        expect(counts.black, 'black must not mix into a red-only tint').toBe(0);
        expect(counts.other).toBe(0);
    });

    it('renders flat shapes solid in the global (threshold) slot', async () => {
        const red = await renderLabelPage(
            docWith([rect('r', 0, 400, '#ff0000')]),
            {},
            { pageColor: 'redBlack' },
        );
        expect(pixelAt(red.rgba, 20, 25)).toEqual([255, 0, 0, 255]);
        expect(tally(red.rgba).black, 'a red rect has no black dither').toBe(0);

        const black = await renderLabelPage(
            docWith([rect('r', 0, 400, '#000000')]),
            {},
            { pageColor: 'redBlack' },
        );
        expect(pixelAt(black.rgba, 20, 25)).toEqual([0, 0, 0, 255]);
        expect(tally(black.rgba).red, 'a black rect has no red dither').toBe(0);
    });

    it('writes only exact #ffffff, #000000 and #ff0000 anywhere', async () => {
        const page = await renderLabelPage(
            imageDoc([
                imageNode('img'),
                textNode('red', 100, '#ff0000'),
                textNode('black', 500),
            ]),
            {},
            { pageColor: 'redBlack', assets: { resolveImage: () => grayAsset() } },
        );

        const counts = tally(page.rgba);
        expect(counts.other, 'the encoder keys on exact channel bytes').toBe(0);
        expect(counts.red).toBeGreaterThan(0);
        expect(counts.black).toBeGreaterThan(0);
        expect(counts.white).toBeGreaterThan(0);
    });

    it('reports policy overflow and still renders exact entries', async () => {
        // Nine distinct threshold params → nine policy slots; the ninth falls
        // back to the global slot (threshold), so the page still renders flat.
        const nodes: Node[] = Array.from({ length: 9 }, (_, index) =>
            rect(`r${index}`, index * 100, 80, '#000000', {
                quantizerHint: 'threshold',
                quantizerParams: { threshold: 10 * (index + 1) },
            }),
        );
        const page = await renderLabelPage(docWith(nodes), {}, { pageColor: 'redBlack' });

        expect(page.policyOverflowCount).toBe(1);
        expect(tally(page.rgba).other).toBe(0);
    });

    it('leaves mono 1-bit and grayscale 16-level (smoke)', async () => {
        const doc = docWith([rect('r', 0, 1000, '#808080')]);

        const mono = await renderLabelPage(doc);
        let oneBit = true;
        for (let i = 0; i < mono.rgba.data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                const value = mono.rgba.data[i + c];
                if (value !== 0 && value !== 255) oneBit = false;
            }
        }
        expect(oneBit).toBe(true);

        const grayscale = await renderLabelPage(doc, {}, { pageColor: 'grayscale' });
        const levels = new Set(Array.from({ length: 16 }, (_, level) => grayLevelColor(level)));
        let sixteenLevel = true;
        for (let i = 0; i < grayscale.rgba.data.length; i += 4) {
            const r = grayscale.rgba.data[i];
            const g = grayscale.rgba.data[i + 1];
            const b = grayscale.rgba.data[i + 2];
            if (r !== g || g !== b || !levels.has(r)) sixteenLevel = false;
        }
        expect(sixteenLevel).toBe(true);
    });
});
