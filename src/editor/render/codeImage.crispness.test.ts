// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toCanvas } from 'bwip-js/browser';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { CODE_FORMAT_PX_PER_MODULE, codeQuietModules } from '../../core/doc/objects';
import type { CodeFormat } from '../../core/doc/objects';
import type { LabelDoc, Node } from '../../core/doc/types';
import { renderCode } from './codeImage';
import { clearAssetCache } from './prepareAssets';
import { renderLabelPage } from './renderLabelPage';

/**
 * P11 W5: the 2D `code` raster must be a **crisp integer-scaled module grid** —
 * no fractional resample, no intermediate greys. `renderCode` picks the largest
 * uniform integer `scale` and composites the symbol 1:1 ((smoothing off)), so the
 * module pitch is exactly `pxPerModule · scale` and the copied bytes are
 * identical to a bare bwip render at that scale. A non-square format (`pdf417`)
 * must hold the same guarantee, which is what the per-format px/module lookup
 * buys.
 *
 * The pattern mirrors `assets.test.ts`'s QR "1:1 copy" test (byte-exact region
 * compare + dark-box offset); the greys scan is the extra assertion code adds.
 */

beforeAll(() => {
    installCanvasShim();
});

beforeEach(() => {
    clearAssetCache();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const PAYLOAD = 'LABEL-EDITOR-2D';

/** bwip-js options plus the encoder keys it accepts. */
type BwipTestOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

/** A fresh bwip render at an integer scale (never reuse: toCanvas mutates opts). */
const reference = (format: CodeFormat, scale: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    toCanvas(canvas, {
        bcid: format,
        text: PAYLOAD,
        scale,
        paddingwidth: 0,
        paddingheight: 0,
    } as BwipTestOptions);
    return canvas;
};

/** A rectangular RGBA region. */
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

/** Count pixels that are neither pure opaque black nor pure opaque white. */
const nonPureCount = (canvas: HTMLCanvasElement): number => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let bad = 0;
    for (let i = 0; i < data.length; i += 4) {
        const black = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255;
        const white =
            data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
        if (!black && !white) bad += 1;
    }
    return bad;
};

const countDark = (canvas: HTMLCanvasElement): number => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 128 && data[i + 3]! > 0) dark += 1;
    return dark;
};

/** Independent re-derivation of `renderCode`'s layout for a square target. */
const layoutOf = (format: CodeFormat, target: number) => {
    const px = CODE_FORMAT_PX_PER_MODULE[format];
    const quiet = codeQuietModules(format);
    const one = reference(format, 1);
    const modulesW = one.width / px;
    const modulesH = one.height / px;
    const totalW = modulesW + 2 * quiet;
    const totalH = modulesH + 2 * quiet;
    const scale = Math.max(
        1,
        Math.floor(Math.min(target / (totalW * px), target / (totalH * px))),
    );
    const modulePx = px * scale;
    const quietPx = quiet * modulePx;
    return { px, quiet, modulesW, modulesH, scale, modulePx, quietPx };
};

const CASES: Array<{ format: CodeFormat; target: number }> = [
    { format: 'datamatrix', target: 400 },
    { format: 'pdf417', target: 400 },
];

describe('renderCode — crisp integer module grid (P11 W5)', () => {
    it('renders every pixel pure black/white at an exact integer pitch', () => {
        for (const { format, target } of CASES) {
            const layout = layoutOf(format, target);
            expect(layout.scale, `${format} picks an integer scale > 1`).toBeGreaterThan(1);

            const generated = renderCode(PAYLOAD, format, target, target);
            expect(generated, format).not.toBeNull();
            if (!generated) return;

            // Padded canvas = (modules + 2·quiet) · modulePx, exactly.
            expect(generated.canvas.width, `${format} width`).toBe(
                (layout.modulesW + 2 * layout.quiet) * layout.modulePx,
            );
            expect(generated.canvas.height, `${format} height`).toBe(
                (layout.modulesH + 2 * layout.quiet) * layout.modulePx,
            );
            // The module pitch is an exact integer multiple of px/module.
            const symbolW = generated.canvas.width - 2 * layout.quietPx;
            const pitch = symbolW / layout.modulesW;
            expect(Number.isInteger(pitch), `${format} integer pitch`).toBe(true);
            expect(pitch, `${format} pitch = px/module · scale`).toBe(
                layout.px * layout.scale,
            );

            // No fractional edges: every pixel is pure opaque black or white.
            expect(nonPureCount(generated.canvas), `${format} no intermediate greys`).toBe(0);
            expect(countDark(generated.canvas), `${format} has ink`).toBeGreaterThan(0);
        }
    });

    it('the symbol is a byte-exact 1:1 copy of a bare bwip render at that scale', () => {
        for (const { format, target } of CASES) {
            const layout = layoutOf(format, target);
            const ref = reference(format, layout.scale);

            // Explicit transparent fill so the composite matches the bare render
            // byte-for-byte inside the symbol region.
            const generated = renderCode(PAYLOAD, format, target, target, 1, {
                fill: 'transparent',
            });
            expect(generated, format).not.toBeNull();
            if (!generated) return;

            expect(
                differingBytes(
                    region(
                        generated.canvas,
                        layout.quietPx,
                        layout.quietPx,
                        ref.width,
                        ref.height,
                    ),
                    region(ref, 0, 0, ref.width, ref.height),
                ),
                `${format} symbol is a byte-exact 1:1 copy`,
            ).toBe(0);
        }
    });

    // Sanity check only: nothing non-binary survives the contain-fit + quantize
    // pipeline. The symbol-raster *crispness* guarantee is carried by the two
    // tests above it — the integer module pitch assertion and the byte-exact 1:1
    // copy of the bare bwip render — not by this binary-page scan.
    it('the final rendered page is pure 0/255 (no grey survives the pipeline)', async () => {
        for (const format of ['datamatrix', 'pdf417'] as const) {
            const doc: LabelDoc = createLabelDoc({
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
                        size: { w: 1500, h: 1500 },
                    }),
                ],
            });
            const page = await renderLabelPage(doc);
            const { data } = page.rgba;
            for (let i = 0; i < data.length; i += 4) {
                // Mono output: every colour channel is exactly 0 or 255.
                if (data[i] !== 0 && data[i] !== 255) {
                    throw new Error(`${format}: page channel ${i} is ${data[i]}`);
                }
            }
        }
    });
});
