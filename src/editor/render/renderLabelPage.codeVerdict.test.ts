// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toCanvas } from 'bwip-js/browser';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { CODE_FORMAT_PX_PER_MODULE, codeQuietModules } from '../../core/doc/objects';
import type { CodeFormat } from '../../core/doc/objects';
import type { LabelDoc, Node } from '../../core/doc/types';
import { clearAssetCache } from './prepareAssets';
import { renderLabelPage } from './renderLabelPage';

/**
 * P11 W5: the 2D `code` too-small verdict, proved end-to-end through
 * `renderLabelPage`. QR's P1 #12 verdict scores `target / paddedModules`; `code`
 * cannot reuse it for two reasons this file pins:
 *
 *  1. **px/module is per-format** (`CODE_FORMAT_PX_PER_MODULE`): matrix codes
 *     draw 2 device px/module at bwip scale 1, `pdf417` draws **1**. A shared
 *     engine that copied QR's `/2` would mis-measure `pdf417`'s module grid
 *     (R11-b — the regression this phase guards).
 *  2. **`code` uses contain-fit**, so the printed pitch is the integer
 *     `modulePx` shrunk by `min(targetW/canvasW, targetH/canvasH)` — the same
 *     drawn-pitch rule the barcode path uses.
 *
 * `dpi 254` → `imageScale = 0.1` → `minModulePxFor(0.1) = ceil(0.25·0.1·100) = 3`.
 * The helper below re-derives the verdict straight from the documented formula,
 * parameterised by px/module so a `/2`-assumption variant can be scored too.
 */

beforeAll(() => {
    installCanvasShim();
});

beforeEach(() => {
    clearAssetCache();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const PAYLOAD = 'LABEL-EDITOR-2D';

/** A `sizeHm`×`sizeHm` code node (square box → square target px). */
const codeDoc = (format: CodeFormat, sizeHm: number): LabelDoc =>
    createLabelDoc({
        backingW: 3000,
        backingH: 2000,
        dpi: 254,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 'c',
                parentId: null,
                type: 'code',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                format,
                data: { kind: 'static', value: PAYLOAD },
                size: { w: sizeHm, h: sizeHm },
            }),
        ],
    });

/** bwip-js options plus the encoder keys it accepts. */
type BwipTestOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

/** Measure the raw bwip scale-1 symbol for `format` (fresh options per call). */
const baseSymbol = (format: CodeFormat): { w: number; h: number } => {
    const canvas = document.createElement('canvas');
    toCanvas(canvas, {
        bcid: format,
        text: PAYLOAD,
        scale: 1,
        paddingwidth: 0,
        paddingheight: 0,
    } as BwipTestOptions);
    return { w: canvas.width, h: canvas.height };
};

/** Bounding box of the dark (ink) pixels on a canvas; copied from `assets.test.ts`. */
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

/**
 * The **drawn** module pitch `renderCode` would report for a square `targetPx`
 * box, re-derived from the documented W1 formula. `pxPerModule` is a parameter
 * so the same geometry can be scored under the wrong `/2` assumption (pass 2 for
 * `pdf417`) to prove the verdict would flip.
 */
const drawnPitch = (format: CodeFormat, targetPx: number, pxPerModule: number): number => {
    const { w, h } = baseSymbol(format);
    const quiet = codeQuietModules(format);
    const modulesW = w / pxPerModule;
    const modulesH = h / pxPerModule;
    const totalW = modulesW + 2 * quiet;
    const totalH = modulesH + 2 * quiet;
    const scale = Math.max(
        1,
        Math.floor(Math.min(targetPx / (totalW * pxPerModule), targetPx / (totalH * pxPerModule))),
    );
    const modulePx = pxPerModule * scale;
    const canvasW = modulesW * modulePx + 2 * quiet * modulePx;
    const canvasH = modulesH * modulePx + 2 * quiet * modulePx;
    const drawScale = Math.min(targetPx / canvasW, targetPx / canvasH);
    return modulePx * drawScale;
};

const MIN_MODULE_PX = 3;
const expectWarning = async (format: CodeFormat, sizeHm: number): Promise<void> => {
    const page = await renderLabelPage(codeDoc(format, sizeHm));
    // 0.1 px/hm at dpi 254 → the node box in device px.
    const targetPx = Math.round(sizeHm * 0.1);
    const pitch = drawnPitch(format, targetPx, CODE_FORMAT_PX_PER_MODULE[format]);
    if (pitch < MIN_MODULE_PX) {
        expect(page.warnings?.get('c'), `${format}@${sizeHm}hm ${targetPx}px`).toBe('too-small');
    } else {
        expect(page.warnings?.get('c'), `${format}@${sizeHm}hm ${targetPx}px`).toBeUndefined();
    }
};

describe('renderLabelPage — code module verdict per unit class (P11 W5)', () => {
    it('datamatrix (2 px/module): the warning tracks the real module budget', async () => {
        // modules 18×18, quiet 1 → padded 20 modules → canvas/scale = 40 device px.
        // Contain pitch = target/20, so the minimum is reached at exactly 60 px.
        const { w } = baseSymbol('datamatrix');
        expect(w / CODE_FORMAT_PX_PER_MODULE.datamatrix).toBe(18);

        // 600 hm → 60 px → 60/20 = 3 px/module → OK.
        await expectWarning('datamatrix', 600);
        // 590 hm → 59 px → 2.95 px/module → too small.
        await expectWarning('datamatrix', 590);

        // Pin the boundary formula explicitly (not just the two samples).
        expect(drawnPitch('datamatrix', 60, 2)).toBe(MIN_MODULE_PX);
        expect(drawnPitch('datamatrix', 59, 2)).toBeLessThan(MIN_MODULE_PX);
    });

    it('pdf417 (1 px/module): the warning tracks the real module budget', async () => {
        // modules 103×27, quiet 2 → padded 107 modules. Because px/module is 1 the
        // padded device extent is 107 px, so the contain pitch is target/107 and
        // the minimum is reached at 321 px (a far larger box than the /2 guess).
        const { w, h } = baseSymbol('pdf417');
        expect(w / CODE_FORMAT_PX_PER_MODULE.pdf417).toBe(103);
        expect(h / CODE_FORMAT_PX_PER_MODULE.pdf417).toBe(27);

        // 3300 hm → 330 px → 3.08 px/module → OK (node box may exceed the label).
        await expectWarning('pdf417', 3300);
        // 3100 hm → 310 px → 2.90 px/module → too small.
        await expectWarning('pdf417', 3100);

        expect(drawnPitch('pdf417', 321, 1)).toBeGreaterThanOrEqual(MIN_MODULE_PX);
        expect(drawnPitch('pdf417', 320, 1)).toBeLessThan(MIN_MODULE_PX);
    });

    it('pdf417: a /2 assumption would flip the verdict (R11-b regression guard)', async () => {
        // 2400 hm → 240 px. The true 1 px/module grid gives 240/107 = 2.24 →
        // too-small; a shared engine that copied QR's `/2` would instead compute
        // 2·240/111 = 4.32 → falsely "scannable".
        const targetPx = 240;
        const real = drawnPitch('pdf417', targetPx, CODE_FORMAT_PX_PER_MODULE.pdf417);
        const naive = drawnPitch('pdf417', targetPx, 2);

        expect(real, 'the true 1 px/module pitch is below the minimum').toBeLessThan(MIN_MODULE_PX);
        expect(naive, 'the /2 pitch would look scannable').toBeGreaterThanOrEqual(MIN_MODULE_PX);

        const page = await renderLabelPage(codeDoc('pdf417', 2400));
        expect(page.warnings?.get('c')).toBe('too-small');

        // A matrix format at the same box is NOT flagged — the difference is the
        // unit class, not the box.
        const matrix = await renderLabelPage(codeDoc('datamatrix', 2400));
        expect(matrix.warnings?.get('c')).toBeUndefined();
    });

    it('ultracode (payload-dependent non-square): contain-fit letterboxes, never stretches to the box', async () => {
        // `code` fits **contain** (unlike a 1D barcode, which stretches to its
        // box), so a non-square symbol keeps its own aspect inside the box
        // instead of QR's square-fill stretch. At this payload ultracode
        // measures 20×13 modules, quiet 1.
        const px = CODE_FORMAT_PX_PER_MODULE.ultracode; // 2
        const quiet = codeQuietModules('ultracode'); // 1
        const { w: baseW, h: baseH } = baseSymbol('ultracode');
        // These counts pin the bwip-js version; a bwip bump may legitimately change them.
        const modulesW = baseW / px;
        const modulesH = baseH / px;
        expect(modulesW).toBe(20);
        expect(modulesH).toBe(13);
        expect(modulesW, 'the symbol is genuinely non-square').not.toBe(modulesH);

        // Padded symbol extent, straight from the documented `renderCode` formula.
        const totalW = modulesW + 2 * quiet;
        const totalH = modulesH + 2 * quiet;

        // Square box = `totalW · px · S` device px → the documented integer scale
        // is exactly S on both axes (S = 4 ⇒ scale ≥ 2, not the scale-1 path).
        const S = 4;
        const targetPx = totalW * px * S;
        const scale = Math.max(
            1,
            Math.floor(
                Math.min(targetPx / (totalW * px), targetPx / (totalH * px)),
            ),
        );
        expect(scale).toBe(S);

        const modulePx = px * scale;
        const paddedCanvasW = totalW * modulePx;
        const paddedCanvasH = totalH * modulePx;
        // The node draws the padded raster with `contain`; a square box against a
        // non-square symbol letterboxes (width fits exactly, height is centred).
        const containScale = Math.min(targetPx / paddedCanvasW, targetPx / paddedCanvasH);
        expect(containScale).toBe(1);
        expect(1, 'box aspect ≠ symbol aspect').not.toBeCloseTo(
            paddedCanvasW / paddedCanvasH,
            2,
        );

        // Node box in hm (0.1 px/hm at dpi 254) → targetPx device px, square.
        const page = await renderLabelPage(codeDoc('ultracode', targetPx * 10));
        const bbox = darkBBox(page.canvas);

        // Drawn ink is the symbol grid — the padded canvas minus its 2·quiet
        // border — under the contain scale. Letterboxed, not stretched to the box.
        expect(bbox.w).toBe((paddedCanvasW - 2 * quiet * modulePx) * containScale);
        expect(bbox.h).toBe((paddedCanvasH - 2 * quiet * modulePx) * containScale);

        // Modules stay square: the same integer `modulePx` on both axes.
        expect(Number.isInteger(modulePx)).toBe(true);
        expect(bbox.w / modulesW).toBe(modulePx);
        expect(bbox.h / modulesH).toBe(modulePx);

        // The drawn aspect is the symbol's (20/13), not the box's (1).
        expect(bbox.w / bbox.h).toBeCloseTo(modulesW / modulesH, 5);
        expect(bbox.w / bbox.h).not.toBeCloseTo(targetPx / targetPx, 2);
    });
});
