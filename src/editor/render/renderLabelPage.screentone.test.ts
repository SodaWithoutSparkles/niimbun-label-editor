// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { nodeLookup } from '../../core/doc/derive';
import type { LabelDoc, Node } from '../../core/doc/types';
import {
    DEFAULT_POLICY_BY_TYPE,
    floydSteinberg,
    rasterDimensions,
    resolveQuantizer,
    screentone,
    threshold,
    type RgbaBuffer,
} from '../../core/render';
import type { PreparedAsset } from './assets';
import { buildPolicyMask, renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';

/**
 * P4 — screentone integration through the shared preview/print path.
 *
 * What is pinned here, all end-to-end through `buildPolicyMask` /
 * `renderLabelPage`:
 *  - every screentone knob keys the 8-slot mask palette (D-57(b)), so two
 *    otherwise-identical nodes differing in one knob get distinct slots;
 *  - palette pressure (D-64): nine distinct screentone policies exhaust the
 *    eight colour-keyed slots; the ninth leaf degrades to the global policy and
 *    is reported through `overflowCount`;
 *  - the effective render `dpi` reaches the quantizer: a 0.5 mm / 0° screen
 *    snaps to 6 px at 300 dpi and 4 px at 203 dpi, and the two planes differ;
 *  - `strength` is inert for a point op (`screentone`) even though it keys a
 *    distinct policy slot — the planes are byte-identical;
 *  - screentone is never a default: unhinted `text`/`qr`/`image` keep their
 *    `DEFAULT_POLICY_BY_TYPE` policy.
 *
 * Fixtures stay tiny (100×50 px, and a 300×300 px page only for the dpi case):
 * the real-canvas suites flake under parallel load (tech debt D-23), so this
 * file trades page area for determinism.
 */

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

/** 1000×500 hm @254 dpi → a 100×50 px page (0.1 hm/px). */
const DPI = 254;

/** A flat mid-grey rectangle carrying an explicit screentone policy. */
const screentoneRect = (
    id: string,
    x: number,
    w: number,
    params: Record<string, unknown>,
    opts: { hint?: string; h?: number; fill?: string } = {},
): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w, h: opts.h ?? 500 },
        fill: opts.fill ?? '#808080',
        quantizerHint: opts.hint ?? 'screentone',
        quantizerParams: params,
    });

const docOf = (
    nodes: Node[],
    dims: { backingW: number; backingH: number; dpi: number } = {
        backingW: 1000,
        backingH: 500,
        dpi: DPI,
    },
): LabelDoc =>
    createLabelDoc({
        backingW: dims.backingW,
        backingH: dims.backingH,
        dpi: dims.dpi,
        regions: [{ kind: 'rect', x: 0, y: 0, w: dims.backingW, h: dims.backingH }],
        nodes,
    });

const buildMask = async (doc: LabelDoc, assets?: ReadonlyMap<string, PreparedAsset>) => {
    const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
    return buildPolicyMask(
        resolve(doc),
        nodeLookup(doc.nodes),
        dims,
        doc.label.dpi,
        assets,
    );
};

/** Distinct non-zero mask indices present in a mask, ascending. */
const slotsOf = (mask: { data: Uint8Array }): number[] =>
    [...new Set(mask.data)].filter((value) => value !== 0).sort((a, b) => a - b);

const maskByteAt = (
    mask: { data: Uint8Array; width: number },
    x: number,
    y: number,
): number => mask.data[y * mask.width + x]!;

/** A row of red-channel values (all 0 or 255 after quantization). */
const rowOf = (rgba: RgbaBuffer, y: number): number[] =>
    Array.from({ length: rgba.width }, (_, x) => rgba.data[(y * rgba.width + x) * 4]!);

/**
 * Smallest `p` such that the row repeats every `p` pixels over the sampled
 * width. Derived from the plane itself — no re-implementation of the engine.
 */
const minimalPeriod = (row: readonly number[]): number => {
    for (let period = 1; period <= Math.floor(row.length / 2); period++) {
        let periodic = true;
        for (let x = 0; x + period < row.length; x++) {
            if (row[x] !== row[x + period]) {
                periodic = false;
                break;
            }
        }
        if (periodic) return period;
    }
    return row.length;
};

/** A 100×100 opaque mid-grey asset for the image leaf in the "never default" case. */
const greyAsset = (): PreparedAsset => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('test canvas has no 2D context');
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, 100, 100);
    return { image: canvas, widthPx: 100, heightPx: 100 };
};

describe('renderLabelPage — screentone policy integration', () => {
    it('two nodes differing only in screentoneLevels take distinct mask slots', async () => {
        const doc = docOf([
            screentoneRect('a', 0, 400, { screentoneLevels: 4 }),
            screentoneRect('b', 500, 400, { screentoneLevels: 6 }),
        ]);

        const built = await buildMask(doc);
        expect(built).toBeDefined();
        if (!built) return;

        expect(built.policies.size, 'one slot per distinct level count').toBe(2);
        expect(built.overflowCount).toBe(0);
        expect(slotsOf(built.mask)).toEqual([1, 2]);

        const a = maskByteAt(built.mask, 20, 25);
        const b = maskByteAt(built.mask, 70, 25);
        expect([a, b].sort()).toEqual([1, 2]);
        expect(maskByteAt(built.mask, 45, 25), 'the gap stays global').toBe(0);

        // Distinct slots must carry distinct *effective* levels, not just
        // distinct keys: the options are what the quantizer actually sees.
        const levelsAt = (index: number): number | undefined => {
            const entry = built.policies.get(index);
            return entry && typeof entry !== 'function' ? entry.options?.screentoneLevels : undefined;
        };
        expect(levelsAt(a)).toBe(4);
        expect(levelsAt(b)).toBe(6);
    });

    it('two nodes differing only in screentoneAngle take distinct mask slots', async () => {
        const doc = docOf([
            screentoneRect('a', 0, 400, { screentoneAngle: 0 }),
            screentoneRect('b', 500, 400, { screentoneAngle: 45 }),
        ]);

        const built = await buildMask(doc);
        expect(built).toBeDefined();
        if (!built) return;

        expect(built.policies.size, 'one slot per distinct angle').toBe(2);
        expect(built.overflowCount).toBe(0);
        expect(slotsOf(built.mask)).toEqual([1, 2]);

        const a = maskByteAt(built.mask, 20, 25);
        const b = maskByteAt(built.mask, 70, 25);
        expect([a, b].sort()).toEqual([1, 2]);

        const angleAt = (index: number): number | undefined => {
            const entry = built.policies.get(index);
            return entry && typeof entry !== 'function' ? entry.options?.screentoneAngle : undefined;
        };
        expect(angleAt(a)).toBe(0);
        expect(angleAt(b)).toBe(45);
    });

    it('D-64 palette pressure: nine distinct screentone policies fill eight slots, the ninth degrades to global', async () => {
        // Nine distinct screentone policies: the seven level counts, plus two
        // distinct angles at the shared default pitch. Every pair differs in
        // exactly one keyed knob, so all nine keys are genuinely distinct.
        const paramsFor = (index: number): Record<string, unknown> =>
            index < 7
                ? { screentoneLevels: 2 + index }
                : { screentoneLevels: 4, screentoneAngle: index === 7 ? 0 : 14 };

        // 2000×400 hm @254 dpi → 200×40 px. Nine 180 hm (18 px) rects at
        // x = i·220 hm (22 px); centres land on odd px columns.
        const nodes = Array.from({ length: 9 }, (_, index) =>
            screentoneRect(`s${index}`, index * 220, 180, paramsFor(index)),
        );
        const doc = docOf(nodes, { backingW: 2000, backingH: 400, dpi: DPI });

        const built = await buildMask(doc);
        expect(built).toBeDefined();
        if (!built) return;

        // D-64 measurement: the 8-slot `KEY_COLORS` palette holds exactly eight
        // distinct screentone keys; the ninth node overflows to the global slot.
        expect(built.policies.size, 'the palette caps at eight policies').toBe(8);
        expect(built.overflowCount).toBe(1);

        for (let index = 0; index < 8; index++) {
            expect(
                maskByteAt(built.mask, index * 22 + 9, 20),
                `node ${index} keeps its own policy index ${index + 1}`,
            ).toBe(index + 1);
        }
        expect(
            maskByteAt(built.mask, 8 * 22 + 9, 20),
            'the ninth node fell back to the global key (0)',
        ).toBe(0);

        // The whole ninth rect (px x 176..194, y 0..40) reads global: the
        // overflow demotes the leaf's entire coverage, not just its centre.
        for (let y = 1; y < 39; y++) {
            for (let x = 177; x < 193; x++) {
                expect(
                    maskByteAt(built.mask, x, y),
                    `overflowed node keeps global coverage at (${x},${y})`,
                ).toBe(0);
            }
        }
    });

    it('threads the effective dpi into the quantizer: 0.5 mm at 0° snaps to 6 px @300 and 4 px @203', async () => {
        // 2540×2540 hm = exactly 1 inch: 300×300 px @300 dpi, 203×203 px @203.
        const doc = docOf(
            [
                screentoneRect(
                    'tone',
                    0,
                    2540,
                    { screentoneAngle: 0, screentonePitchMm: 0.5, screentoneLevels: 4 },
                    { h: 2540 },
                ),
            ],
            { backingW: 2540, backingH: 2540, dpi: 300 },
        );

        const at300 = await renderLabelPage(doc, {}, { dpi: 300 });
        const at203 = await renderLabelPage(doc, {}, { dpi: 203 });

        expect([at300.widthPx, at300.heightPx]).toEqual([300, 300]);
        expect([at203.widthPx, at203.heightPx]).toEqual([203, 203]);

        // Same content, different snapped pitch → different 1-bit planes.
        expect(at300.rgba.data).not.toEqual(at203.rgba.data);

        // Row 50 crosses the screen at a cell phase that carries ink (other
        // phases are legitimately all-paper at K=4). The 8 px at each page edge
        // are excluded: they are the rect's antialiased page-boundary columns,
        // which the screen does not govern. Inside the window the plane is pure
        // screen.
        const EDGE = 8;
        const interior = (row: readonly number[]): number[] => row.slice(EDGE, row.length - EDGE);
        const row300 = interior(rowOf(at300.rgba, 50));
        const row203 = interior(rowOf(at203.rgba, 50));

        // Non-vacuous: the row really is a halftone, not a flat plane.
        for (const row of [row300, row203]) {
            expect(row.includes(0), 'row has ink').toBe(true);
            expect(row.includes(255), 'row has paper').toBe(true);
        }

        // The period is the snapped physical pitch at each dpi: round(0.5 mm ·
        // dpi/25.4) = 6 @300, 4 @203 — derived from the rendered plane.
        expect(minimalPeriod(row300), '300 dpi snaps 0.5 mm to 6 px').toBe(6);
        expect(minimalPeriod(row203), '203 dpi snaps 0.5 mm to 4 px').toBe(4);

        // And the period is not an artifact of a shorter accidental cycle: the
        // planes are invariant under their own snapped pitch for every row start.
        for (const [row, period] of [
            [row300, 6],
            [row203, 4],
        ] as const) {
            for (let x = 0; x + period < row.length; x++) {
                expect(row[x + period], `x=${x} repeats after ${period} px`).toBe(row[x]);
            }
        }
    });

    it('strength is inert end-to-end: 0 and 4 render byte-identically', async () => {
        const docWithStrength = (strength: number): LabelDoc =>
            docOf([screentoneRect('tone', 0, 1000, { strength })]);

        const zero = await renderLabelPage(docWithStrength(0));
        const four = await renderLabelPage(docWithStrength(4));

        expect([zero.widthPx, zero.heightPx]).toEqual([four.widthPx, four.heightPx]);
        expect(zero.rgba.data).toEqual(four.rgba.data);

        // Non-vacuous: the shared plane is an actual halftone, not blank.
        const plane = zero.rgba.data;
        let black = 0;
        let white = 0;
        for (let i = 0; i < plane.length; i += 4) {
            if (plane[i] === 0) black++;
            else if (plane[i] === 255) white++;
        }
        expect(black).toBeGreaterThan(0);
        expect(white).toBeGreaterThan(0);
    });

    it('is never a default: unhinted text/qr/image keep their usual policy', async () => {
        // The resolver contract, directly.
        expect(resolveQuantizer({ type: 'text' })).toBe('threshold');
        expect(resolveQuantizer({ type: 'qr' })).toBe('threshold');
        expect(resolveQuantizer({ type: 'image' })).toBe('floydSteinberg');
        expect(DEFAULT_POLICY_BY_TYPE['screentone']).toBeUndefined();

        // And structurally through the mask: an unhinted text leaf resolves to
        // `threshold`, an unhinted image leaf to `floydSteinberg` — never
        // `screentone` — with the usual defaults (4/0.5/45) only as inert
        // quantizer options.
        const doc = docOf([
            node({
                id: 'txt',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'X' },
                size: { w: 500, h: 500 },
                fontSize: 400,
            }),
            node({
                id: 'img',
                parentId: null,
                type: 'image',
                visible: true,
                locked: false,
                transform: { x: 500, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                imageId: 'i1',
                size: { w: 500, h: 500 },
            }),
        ]);

        const built = await buildMask(doc, new Map<string, PreparedAsset>([['img', greyAsset()]]));
        expect(built).toBeDefined();
        if (!built) return;

        expect(built.policies.size).toBe(2);
        const quantizers = [...built.policies.values()].map((entry) =>
            typeof entry === 'function' ? entry : entry.quantizer,
        );
        expect(quantizers).toContain(threshold);
        expect(quantizers).toContain(floydSteinberg);
        expect(quantizers).not.toContain(screentone);
    });
});
