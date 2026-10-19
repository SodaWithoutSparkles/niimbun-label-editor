// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { nodeLookup } from '../../core/doc/derive';
import { parseDoc } from '../../core/doc/serialize';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import { rasterDimensions } from '../../core/render';
import { buildPolicyMask, renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';

/**
 * P14 / gamma — the per-object `quantizerParams.gamma` field, end to end.
 *
 * Only the *effective* gamma is pinned here (node → per-strategy setting →
 * per-strategy engine default), never internals:
 *  - it keys the policy mask, so two same-policy nodes that differ only in
 *    effective gamma must take **distinct** palette slots;
 *  - a per-object value beats the per-strategy `quantizerDefaults[id].gamma`;
 *  - a neutral (`1`) per-object value is a genuine no-op.
 *
 * Fixtures stay tiny on purpose (a 100×50 px page at 254 dpi, one or two grey
 * rects): the real-canvas suites flake under parallel load (tech debt D-23), so
 * this file trades page area for determinism — gamma is a 256-entry LUT, and a
 * flat grey rect makes the dither pattern sensitive to it without a big raster.
 */

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

/** 1000×500 hm @254 dpi → a 100×50 px page (0.1 hm/px). */
const DPI = 254;
const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }];

/**
 * A flat opaque grey rectangle. `hint` makes it claim its own policy; `gamma`
 * is only attached when supplied, so "absent gamma" is genuinely absent.
 */
const greyRect = (
    id: string,
    x: number,
    w: number,
    opts: { hint?: string; gamma?: number; fill?: string } = {},
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
        fill: opts.fill ?? '#808080',
        ...(opts.hint ? { quantizerHint: opts.hint } : {}),
        ...(opts.gamma !== undefined ? { quantizerParams: { gamma: opts.gamma } } : {}),
    });

const docWith = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 1000, backingH: 500, dpi: DPI, regions, nodes });

const maskOf = async (doc: LabelDoc) => {
    const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
    return buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
};

describe('renderLabelPage — per-object gamma', () => {
    it('two same-policy nodes that differ only in effective gamma take distinct mask slots', async () => {
        // Both are floydSteinberg, same threshold/strength/serpentine; the only
        // difference is the effective gamma (explicit 1 vs explicit 2).
        const doc = docWith([
            greyRect('a', 0, 400, { hint: 'floydSteinberg', gamma: 1 }),
            greyRect('b', 500, 400, { hint: 'floydSteinberg', gamma: 2 }),
        ]);

        const built = await maskOf(doc);
        expect(built).toBeDefined();
        if (!built) return;

        // Two policy entries in the palette (indices 1 and 2); nothing overflowed.
        expect(built.policies.size).toBe(2);
        expect(built.overflowCount).toBe(0);

        const width = built.mask.width;
        // Rect a spans px x 0..40, rect b spans x 50..90; sample each centre at y=25.
        const a = built.mask.data[25 * width + 20];
        const b = built.mask.data[25 * width + 70];
        expect(a).not.toBe(b);
        expect([a, b].sort()).toEqual([1, 2]);
        // The gap between the two rects stays on the global slot (index 0).
        expect(built.mask.data[25 * width + 45]).toBe(0);
    });

    it('a per-object gamma overrides the per-strategy setting and changes the 1-bit raster', async () => {
        const defaults = { floydSteinberg: { gamma: 1.6 } };
        // Same doc, same strategy setting; only the node value differs. The
        // node carries gamma 1, the strategy default is 1.6 → different output.
        const withNode = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'floydSteinberg', gamma: 1 })]),
            {},
            { quantizerDefaults: defaults },
        );
        const without = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'floydSteinberg' })]),
            {},
            { quantizerDefaults: defaults },
        );

        expect(withNode.rgba.data).not.toEqual(without.rgba.data);
    });

    it('a neutral per-node gamma is byte-identical to no per-node gamma (threshold)', async () => {
        // `threshold`'s engine default gamma is the neutral 1, so an explicit 1
        // is a no-op there. Grey 160 sits just above the cutoff: a non-neutral
        // gamma would flip it, which is why the contrast render below is used to
        // prove the fixture is actually gamma-sensitive (the identity is not
        // vacuously true on a blank raster).
        const explicit = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'threshold', gamma: 1, fill: '#a0a0a0' })]),
        );
        const absent = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'threshold', fill: '#a0a0a0' })]),
        );
        expect(explicit.rgba.data).toEqual(absent.rgba.data);

        // Sanity: the same fixture *is* sensitive to a non-neutral gamma
        // (0.5 darkens 160 → below the cutoff), so the equality above pins a
        // real no-op rather than an all-white raster.
        const darkened = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'threshold', gamma: 0.5, fill: '#a0a0a0' })]),
        );
        expect(darkened.rgba.data).not.toEqual(explicit.rgba.data);
    });

    it('a per-node gamma wins over a per-strategy setting for the same strategy id', async () => {
        const nodeOnly = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'floydSteinberg', gamma: 0.6 })]),
            {},
            { quantizerDefaults: { floydSteinberg: { gamma: 1.8 } } },
        );
        // Baseline: same effective gamma (0.6) reached purely through the
        // strategy setting — the node value must render identically to it.
        const strategyOnly = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'floydSteinberg' })]),
            {},
            { quantizerDefaults: { floydSteinberg: { gamma: 0.6 } } },
        );
        // The competing strategy value (1.8) would render differently.
        const strategyWins = await renderLabelPage(
            docWith([greyRect('g', 0, 1000, { hint: 'floydSteinberg' })]),
            {},
            { quantizerDefaults: { floydSteinberg: { gamma: 1.8 } } },
        );

        expect(nodeOnly.rgba.data).toEqual(strategyOnly.rgba.data);
        expect(nodeOnly.rgba.data).not.toEqual(strategyWins.rgba.data);
    });

    it('parseDoc keeps a valid quantizerParams.gamma through a save/load round-trip', async () => {
        const doc = docWith([greyRect('g', 0, 1000, { hint: 'threshold', gamma: 2.2 })]);

        const parsed = await parseDoc(JSON.stringify(doc));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc.nodes.find((n) => n.id === 'g')?.quantizerParams?.gamma).toBe(2.2);

        // Save → load → save → load is stable: the value survives re-serialization.
        const reparsed = await parseDoc(JSON.stringify(parsed.doc));
        expect(reparsed.ok).toBe(true);
        if (!reparsed.ok) return;
        expect(reparsed.doc.nodes.find((n) => n.id === 'g')?.quantizerParams?.gamma).toBe(2.2);
        expect(JSON.stringify(reparsed.doc)).toBe(JSON.stringify(parsed.doc));
    });
});
