// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import { createLabelDoc } from '../core/doc/factory';
import type { LabelDoc, Node } from '../core/doc/types';
import { installCanvasShim } from '../test/canvasHarness';
import { createKonvaNode } from './render/konvaFactory';
import { resolve } from './render/resolve';
import { transformEndPatch, transformerTargetSize } from './transformGesture';

/**
 * Real-canvas parity for the ellipse centre-origin claim (#13). The resolved
 * ellipse is centre-origin (`resolve.ts` bounds are `rectCorners(-rx, -ry, …)`
 * about the node's own `x`/`y`) and Konva's `Ellipse` origin is its centre too.
 * So committing the live Konva `x()/y()` verbatim is WYSIWYG — a naive
 * "AABB top-left" conversion would move the node by `(rx, ry)`.
 *
 * This needs a real rasterizer (Konva shapes probe a canvas on construction and
 * `getClientRect` reads shape geometry), so it lives beside the pure-math tests
 * rather than inside `transformGesture.test.ts`.
 *
 * The second describe exercises the **commit path** end to end: a simulated
 * Transformer resize on a real Konva ellipse is fed through `transformEndPatch`,
 * applied to the doc, re-resolved, and checked against the live node — so a
 * wrong origin conversion (or a dropped mirror) cannot pass.
 */

beforeAll(() => {
    installCanvasShim();
});

const ellipseNode = (): Node => ({
    id: 'e',
    parentId: null,
    type: 'shape',
    shape: 'ellipse',
    visible: true,
    locked: false,
    transform: { x: 150, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 200, h: 100 },
});

type Patch = ReturnType<typeof transformEndPatch>;

/** Apply a commit patch to one node of a doc (as the store would). */
const applyPatch = (doc: LabelDoc, id: string, patch: Patch): LabelDoc => ({
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === id ? ({ ...node, ...patch } as Node) : node)),
});

const resolvedNode = (doc: LabelDoc, id: string) => resolve(doc).find((entry) => entry.id === id)!;

describe('ellipse origin (#13 centre-origin parity, real canvas)', () => {
    it('resolves bounds centred on the same point as Konva Ellipse.x()/y()', () => {
        const doc = createLabelDoc({
            id: 'doc-1',
            backingW: 3000,
            backingH: 2000,
            nodes: [ellipseNode()],
        });
        const resolved = resolvedNode(doc, 'e');
        const konva = createKonvaNode(resolved) as Konva.Ellipse;

        // Konva's ellipse origin is the node's transform origin (its centre).
        expect(konva.x()).toBe(150);
        expect(konva.y()).toBe(100);

        // The resolved bounds are centred on that same origin...
        expect(resolved.bounds.x + resolved.bounds.w / 2).toBeCloseTo(konva.x());
        expect(resolved.bounds.y + resolved.bounds.h / 2).toBeCloseTo(konva.y());

        // ...and Konva's own AABB is symmetric about it.
        const rect = konva.getClientRect();
        expect(rect.x + rect.width / 2).toBeCloseTo(konva.x());
        expect(rect.y + rect.height / 2).toBeCloseTo(konva.y());
    });
});

describe('ellipse commit path (#13 origin + FLIP-1 mirror, real canvas)', () => {
    it('commits the live origin so the resolved centre does not shift', () => {
        const source = ellipseNode();
        const doc = createLabelDoc({
            id: 'doc-2',
            backingW: 3000,
            backingH: 2000,
            nodes: [source],
        });
        const resolved = resolvedNode(doc, 'e');
        const konva = createKonvaNode(resolved) as Konva.Ellipse;

        // Simulate a bottom-right corner drag: Konva's Transformer scales about
        // the anchor and writes the post-gesture x/y back onto the node so the
        // opposite (top-left) corner stays fixed. The ellipse origin is its
        // centre (150,100) with radii (100,50); a ×2 uniform scale pins the
        // top-left AABB corner (50,50), giving x = 50 + 100·2 = 250 and
        // y = 50 + 50·2 = 150.
        konva.scaleX(2);
        konva.scaleY(2);
        konva.x(250);
        konva.y(150);

        const target = transformerTargetSize({ w: 200, h: 100 }, konva.scaleX(), konva.scaleY());
        const patch = transformEndPatch(
            source,
            { w: Math.round(target.w), h: Math.round(target.h) },
            true,
            {
                x: konva.x(),
                y: konva.y(),
                rotDeg: konva.rotation(),
                scaleX: konva.scaleX(),
                scaleY: konva.scaleY(),
            },
            2,
        );

        const committed = resolvedNode(applyPatch(doc, 'e', patch), 'e');
        const centre = {
            x: committed.bounds.x + committed.bounds.w / 2,
            y: committed.bounds.y + committed.bounds.h / 2,
        };
        // A naive "AABB top-left" conversion would move the centre by the radii
        // (100, 50); committing Konva's own origin leaves it exactly on the live
        // node's centre.
        expect(centre.x).toBeCloseTo(konva.x());
        expect(centre.y).toBeCloseTo(konva.y());

        // The size baked positive and matches the live target (2× the base box).
        expect(committed.bounds.w).toBeCloseTo(400);
        expect(committed.bounds.h).toBeCloseTo(200);
    });

    it('preserves a mirrored (negative) live scale through the commit (FLIP-1)', () => {
        const source = ellipseNode();
        const doc = createLabelDoc({
            id: 'doc-3',
            backingW: 3000,
            backingH: 2000,
            nodes: [source],
        });
        const resolved = resolvedNode(doc, 'e');
        const konva = createKonvaNode(resolved) as Konva.Ellipse;

        // A handle dragged past the opposite edge mirrors the node: Konva
        // reports a negative scale. The commit must keep the sign or the mirror
        // reverts on release.
        konva.scaleX(-1);
        konva.scaleY(1);
        konva.x(250);
        konva.y(150);

        const target = transformerTargetSize({ w: 200, h: 100 }, konva.scaleX(), konva.scaleY());
        const patch = transformEndPatch(
            source,
            { w: Math.round(target.w), h: Math.round(target.h) },
            false,
            {
                x: konva.x(),
                y: konva.y(),
                rotDeg: konva.rotation(),
                scaleX: konva.scaleX(),
                scaleY: konva.scaleY(),
            },
        );

        expect(patch.transform?.scaleX).toBe(-1);
        expect(patch.transform?.scaleY).toBe(1);
        // The size stays positive even under a flip.
        expect((patch as { size?: { w: number } }).size?.w).toBe(200);

        const committed = resolvedNode(applyPatch(doc, 'e', patch), 'e');
        const m = committed.localTransform;
        const det = m.a * m.d - m.b * m.c;
        // A negative determinant is a mirror.
        expect(det).toBeLessThan(0);

        // Both renderers decompose that same matrix with `matrixToKonvaAttrs`
        // (ResolvedShape / konvaFactory), so the mirror survives into the actual
        // Konva node as a negative scale — preview≡print keeps the flip.
        const printed = createKonvaNode(committed);
        expect(printed.scaleX() * printed.scaleY()).toBeLessThan(0);
    });
});
