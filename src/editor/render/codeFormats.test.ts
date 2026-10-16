// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toCanvas } from 'bwip-js/browser';
import { installCanvasShim } from '../../test/canvasHarness';
import {
    CODE_FORMAT_PX_PER_MODULE,
    CODE_FORMAT_QUIET_MODULES,
    CODE_FORMATS,
    DEFAULT_CODE_FORMAT,
    codeQuietModules,
} from '../../core/doc/objects';
import type { CodeFormat } from '../../core/doc/objects';
import { renderCode } from './codeImage';

beforeAll(() => {
    installCanvasShim();
});

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

/** bwip-js options plus the encoder-specific keys it accepts. */
type BwipTestOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

/** Measure a bwip-js symbol at scale 1 (used to prove integer scaling). */
const baseSymbol = (opts: BwipTestOptions): { w: number; h: number } => {
    const canvas = document.createElement('canvas');
    toCanvas(canvas, opts);
    return { w: canvas.width, h: canvas.height };
};

const PAYLOAD = 'LABEL-EDITOR-2D';

/**
 * Fresh bwip-js options for a 2D format at a given integer scale. It must be a
 * fresh object per call: bwip-js's `FixupOptions` **mutates** the options it is
 * handed (it writes back `scaleX`/`scaleY`), so reusing/spreading a used object
 * would leak a stale `scaleX` and silently defeat a later `scale`.
 */
const symbolOpts = (format: CodeFormat, scale: number): BwipTestOptions => ({
    bcid: format,
    text: PAYLOAD,
    scale,
    paddingwidth: 0,
    paddingheight: 0,
});

/**
 * Recorded module grid per 2D format, measured once from bwip-js at scale 1
 * with `paddingwidth`/`paddingheight` 0 and written in as the pinned fact. The
 * device-px extent is `modulesW · CODE_FORMAT_PX_PER_MODULE[format]` — the
 * "2 device px per module" assumption the QR path relies on, except for
 * `pdf417`, whose `/modunit 1` breaks it.
 */
const RECORDED: Record<CodeFormat, { modulesW: number; modulesH: number }> = {
    datamatrix: { modulesW: 18, modulesH: 18 },
    azteccode: { modulesW: 23, modulesH: 23 },
    pdf417: { modulesW: 103, modulesH: 27 },
    microqrcode: { modulesW: 17, modulesH: 17 },
    codeone: { modulesW: 22, modulesH: 22 },
    hanxin: { modulesW: 25, modulesH: 25 },
    ultracode: { modulesW: 20, modulesH: 13 },
};

describe('2D-code module grid (pins the bwip device-px-per-module assumption)', () => {
    it('draws a clean integer module grid per format and honours integer scale', () => {
        for (const format of CODE_FORMATS) {
            const px = CODE_FORMAT_PX_PER_MODULE[format];
            const one = baseSymbol(symbolOpts(format, 1));
            expect(one.w, `${format} width`).toBeGreaterThan(0);
            expect(one.h, `${format} height`).toBeGreaterThan(0);

            // The device-px extent divides cleanly into whole modules.
            expect(one.w % px, `${format} width divisible by ${px}`).toBe(0);
            expect(one.h % px, `${format} height divisible by ${px}`).toBe(0);
            expect(Number.isInteger(one.w / px) && Number.isInteger(one.h / px)).toBe(true);

            // The derived module counts are the recorded constants.
            const { modulesW, modulesH } = RECORDED[format];
            expect(one.w / px, `${format} modulesW`).toBe(modulesW);
            expect(one.h / px, `${format} modulesH`).toBe(modulesH);

            // Integer scaling: scale 2 exactly doubles both axes.
            const two = baseSymbol(symbolOpts(format, 2));
            expect(two.w, `${format} scale-2 width`).toBe(2 * one.w);
            expect(two.h, `${format} scale-2 height`).toBe(2 * one.h);
        }
    });

    it('pdf417 draws 1 px/module while every other matrix code draws 2', () => {
        expect(CODE_FORMAT_PX_PER_MODULE.pdf417).toBe(1);
        for (const format of CODE_FORMATS) {
            if (format === 'pdf417') continue;
            expect(CODE_FORMAT_PX_PER_MODULE[format], format).toBe(2);
        }

        const pdf417 = baseSymbol(symbolOpts('pdf417', 1));
        // The QR `baseW / 2 = moduleCount` rule does NOT generalize: pdf417's
        // true module width exceeds the `/2` guess (103 > 51.5).
        expect(RECORDED.pdf417.modulesW).toBeGreaterThan(pdf417.w / 2);
        // Its px/module is 1, so the module width is the raw device px.
        expect(RECORDED.pdf417.modulesW).toBe(pdf417.w);
    });

    it('pins the per-format quiet-zone table (all 7 formats present)', () => {
        for (const format of CODE_FORMATS) {
            expect(codeQuietModules(format), format).toBe(CODE_FORMAT_QUIET_MODULES[format]);
        }
        expect(CODE_FORMATS).toHaveLength(7);
        expect(new Set(CODE_FORMATS).size).toBe(7);
        expect(CODE_FORMATS).toContain(DEFAULT_CODE_FORMAT);
    });
});

/**
 * Mirror `renderCode`'s documented P11 W1 formula independently: recover the
 * module grid from the scale-1 symbol, pick the largest uniform integer scale
 * that fits the quiet-zone-padded device-px extent, and pad by `quietPx`.
 */
const codeLayout = (
    format: CodeFormat,
    target: number,
    quietModules = codeQuietModules(format),
): { modulesW: number; modulesH: number; scale: number; symbolW: number; quietPx: number; canvasW: number } => {
    const px = CODE_FORMAT_PX_PER_MODULE[format];
    const one = baseSymbol(symbolOpts(format, 1));
    const modulesW = one.w / px;
    const modulesH = one.h / px;
    const totalW = modulesW + 2 * quietModules;
    const totalH = modulesH + 2 * quietModules;
    const scale = Math.max(1, Math.floor(Math.min(target / (totalW * px), target / (totalH * px))));
    const modulePx = px * scale;
    const symbolW = modulesW * modulePx;
    return { modulesW, modulesH, scale, symbolW, quietPx: quietModules * modulePx, canvasW: symbolW + 2 * quietModules * modulePx };
};

describe('renderCode — padded size, quiet zone and fill', () => {
    it('pads the symbol by the per-format quiet zone (datamatrix = 1 module/side)', () => {
        const target = 400;
        const layout = codeLayout('datamatrix', target);
        expect(layout.scale).toBeGreaterThan(1);

        const generated = renderCode(PAYLOAD, 'datamatrix', target, target);
        expect(generated).not.toBeNull();
        if (!generated) return;

        // The padded canvas is `symbol + 2·quietPx` on both axes.
        expect(generated.canvas.width).toBe(layout.symbolW + 2 * layout.quietPx);
        expect(generated.canvas.height).toBe(layout.symbolW + 2 * layout.quietPx);
        // Derived from the module grid: `(modulesW + 2·quiet) · pxPerModule · scale`.
        const px = CODE_FORMAT_PX_PER_MODULE.datamatrix;
        const quiet = codeQuietModules('datamatrix');
        expect(quiet).toBe(1);
        expect(generated.canvas.width).toBe((layout.modulesW + 2 * quiet) * px * layout.scale);
        expect(generated.canvas.height).toBe((layout.modulesH + 2 * quiet) * px * layout.scale);
        expect(generated.canvas.width - layout.modulesW * px * layout.scale).toBe(2 * layout.quietPx);
        // The module pitch is exact by construction: `symbol / modules = px·scale`.
        expect(layout.symbolW / layout.modulesW).toBe(px * layout.scale);
    });

    it('quietZone 0 strips the code quiet zone', () => {
        const target = 400;
        const px = CODE_FORMAT_PX_PER_MODULE.datamatrix;
        const layout = codeLayout('datamatrix', target, 0);

        const generated = renderCode(PAYLOAD, 'datamatrix', target, target, 1, { quietModules: 0 });
        expect(generated).not.toBeNull();
        if (!generated) return;
        expect(layout.quietPx).toBe(0);
        expect(generated.canvas.width).toBe(layout.modulesW * px * layout.scale);
        expect(generated.canvas.height).toBe(layout.modulesH * px * layout.scale);
    });

    it('the default fill paints the padded background opaque white; explicit transparent leaves it clear', () => {
        const target = 400;

        const defaultFill = renderCode(PAYLOAD, 'datamatrix', target, target);
        expect(defaultFill).not.toBeNull();
        if (!defaultFill) return;
        // (0,0) lies inside the 1-module quiet zone: opaque white proves the
        // background (quiet zone included) was painted.
        expect(pixelAt(defaultFill.canvas, 0, 0)).toEqual([255, 255, 255, 255]);

        const clear = renderCode(PAYLOAD, 'datamatrix', target, target, 1, { fill: 'transparent' });
        expect(clear).not.toBeNull();
        if (!clear) return;
        expect(pixelAt(clear.canvas, 0, 0)).toEqual([0, 0, 0, 0]);
    });
});
