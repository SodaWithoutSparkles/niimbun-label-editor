// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Konva from 'konva';
import { Layer, Stage } from 'react-konva';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { resolve } from '../../editor/render/resolve';
import { createKonvaNode, shapeStyleAttrs, type ResolvedShapeNode } from '../../editor/render/konvaFactory';
import { measureKonvaText } from '../../editor/render/textMetrics';
import { ResolvedShape } from './ResolvedShape';

/**
 * Preview-side proof for #8: `ResolvedShape` reads the resolved
 * `fill`/`stroke`/`strokeWidth`/`cornerRadius` (via the shared
 * `shapeStyleAttrs`), so the on-screen node matches the print factory by
 * construction. A real Konva Stage is mounted on the canvas shim; the rendered
 * Konva node is inspected directly.
 */

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const shapeDoc = (over: Record<string, unknown>) =>
    createLabelDoc({
        backingW: 3000,
        backingH: 2000,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 's',
                parentId: null,
                type: 'shape',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                ...over,
            }),
        ],
    });

const renderPreview = (over: Record<string, unknown>, selected = false, strokeScale?: number) => {
    const resolved = resolve(shapeDoc(over))[0]!;
    let stage: Konva.Stage | null = null;
    render(
        <Stage
            ref={(instance) => {
                stage = instance;
            }}
            width={300}
            height={200}
        >
            <Layer>
                <ResolvedShape node={resolved} selected={selected} strokeScale={strokeScale} />
            </Layer>
        </Stage>,
    );
    return { resolved, stage: stage as unknown as Konva.Stage };
};

describe('ResolvedShape — preview style (#8)', () => {
    it('draws a rectangle with the resolved fill/stroke/width/radius', () => {
        const { resolved, stage } = renderPreview({ shape: 'rectangle', size: { w: 1000, h: 800 } });
        const rect = stage.findOne('Rect') as Konva.Rect;
        expect(rect).toBeTruthy();
        expect(rect.fill(), 'no fill resolves to the explicit transparent string').toBe('transparent');
        expect(rect.stroke()).toBe('#374151');
        expect(rect.strokeWidth()).toBe(50);
        expect(rect.cornerRadius()).toBe(0);
        // Bug A: the preview node must ignore its own scale so a live
        // Transformer handle cannot thicken the outline.
        expect(rect.strokeScaleEnabled()).toBe(false);
        // The preview and the print factory read the same resolved values.
        expect(shapeStyleAttrs(resolved as ResolvedShapeNode)).toStrictEqual({
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
            cornerRadius: 0,
        });
    });

    it('draws an open line with transparent fill and the resolved stroke', () => {
        const { stage } = renderPreview({ shape: 'line', points: [[0, 0], [1000, 0]], closed: false });
        const line = stage.findOne('Line') as Konva.Line;
        expect(line.fill()).toBe('transparent');
        expect(line.stroke()).toBe('#374151');
        expect(line.strokeWidth()).toBe(50);
        // Bug A: point shapes ignore the node scale for ink width too.
        expect(line.strokeScaleEnabled()).toBe(false);
    });

    it('scales the preview stroke width by the viewport zoom (Bug A: zoom still scales)', () => {
        // `strokeScaleEnabled=false` also cancels the viewport-zoom Layer scale,
        // so the resolved hm width is pre-multiplied by the zoom to keep the
        // on-screen ink equal to the print path's hm × dpi.
        const { stage } = renderPreview(
            { shape: 'rectangle', size: { w: 1000, h: 800 } },
            false,
            0.5,
        );
        const rect = stage.findOne('Rect') as Konva.Rect;
        expect(rect.strokeWidth()).toBe(25);
        expect(rect.strokeScaleEnabled()).toBe(false);
    });

    it('honours explicit style and cornerRadius', () => {
        const { stage } = renderPreview({
            shape: 'rectangle',
            size: { w: 1000, h: 800 },
            fill: '#ff0000',
            stroke: '#00ff00',
            strokeWidth: 4,
            cornerRadius: 7,
        });
        const rect = stage.findOne('Rect') as Konva.Rect;
        expect(rect.fill()).toBe('#ff0000');
        expect(rect.stroke()).toBe('#00ff00');
        expect(rect.strokeWidth()).toBe(4);
        expect(rect.cornerRadius()).toBe(7);
    });

    it('selected overrides the visible stroke without thinning a default shape', () => {
        const { resolved, stage } = renderPreview(
            { shape: 'rectangle', size: { w: 1000, h: 800 } },
            true,
        );
        const rect = stage.findOne('Rect') as Konva.Rect;
        expect(rect.stroke()).toBe('#3b82f6');
        // Default stroke width is 50 hm: the highlight must never thin it to 2.
        expect(rect.strokeWidth()).toBe(50);
        // The print node never carries the selection highlight.
        const printed = createKonvaNode(resolved) as Konva.Rect;
        expect(printed.stroke()).toBe('#374151');
        expect(printed.strokeWidth()).toBe(50);
        // Pin the print invariant: the print factory must keep Konva's default
        // `strokeScaleEnabled` so the raster stage's `hm → px` scale (and the
        // node's own scale) thicken the stroke. A future edit to
        // `shapeStyleAttrs` adding `strokeScaleEnabled: false` fails loudly here.
        expect(printed.strokeScaleEnabled()).toBe(true);
    });

    it('selected thickens a thin explicit stroke to a visible floor', () => {
        const { stage } = renderPreview(
            { shape: 'rectangle', size: { w: 1000, h: 800 }, strokeWidth: 1 },
            true,
        );
        const rect = stage.findOne('Rect') as Konva.Rect;
        expect(rect.strokeWidth()).toBe(2);
    });

    it('pre-multiplies the preview stroke by |scaleX| so it matches print (round 2)', () => {
        // Default resolved hm stroke width is 50; the preview ink is
        // `hm * strokeScale * |scaleX|`. Pin the |scaleX| factor so a future edit
        // cannot silently drop it.
        const base = { shape: 'rectangle', size: { w: 1000, h: 800 } };
        const unscaled = renderPreview(
            { ...base, transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } },
            false,
            0.5,
        );
        const rectUnscaled = unscaled.stage.findOne('Rect') as Konva.Rect;
        expect(rectUnscaled.strokeWidth()).toBe(25); // 50 * 0.5 * 1
        expect(rectUnscaled.strokeScaleEnabled()).toBe(false);

        const scaled = renderPreview(
            { ...base, transform: { x: 0, y: 0, rotDeg: 0, scaleX: 2, scaleY: 1 } },
            false,
            0.5,
        );
        const rectScaled = scaled.stage.findOne('Rect') as Konva.Rect;
        expect(rectScaled.strokeWidth()).toBe(50); // 50 * 0.5 * 2
        expect(rectScaled.strokeScaleEnabled()).toBe(false);
    });
});

describe('ResolvedShape — text wrap preview (P5)', () => {
    const renderStage = (over: Record<string, unknown>): Konva.Stage => {
        const resolved = resolve(
            createLabelDoc({
                id: 'doc-text',
                now: 1_700_000_000,
                backingW: 3000,
                backingH: 2000,
                regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
                nodes: [
                    node({
                        id: 't',
                        parentId: null,
                        type: 'text',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        text: { kind: 'static', value: 'hi' },
                        size: { w: 100, h: 40 },
                        ...over,
                    }),
                ],
            }),
        )[0]!;
        let stage: Konva.Stage | null = null;
        render(
            <Stage
                ref={(instance) => {
                    stage = instance;
                }}
                width={300}
                height={200}
            >
                <Layer>
                    <ResolvedShape node={resolved} />
                </Layer>
            </Stage>,
        );
        return stage as unknown as Konva.Stage;
    };
    const renderText = (over: Record<string, unknown>): Konva.Text =>
        renderStage(over).findOne('Text') as Konva.Text;

    it('renders wrap + lineHeight on the Konva Text (preview ≡ print)', () => {
        expect(renderText({}).wrap()).toBe('word');
        expect(renderText({ wrap: 'char' }).wrap()).toBe('char');
        expect(renderText({ wrap: 'clip' }).wrap()).toBe('word');
        expect(renderText({ lineHeight: 1.5 }).lineHeight()).toBe(1.5);
        expect(renderText({}).letterSpacing()).toBe(0);
        expect(renderText({ letterSpacing: 1.5 }).letterSpacing()).toBe(1.5);
    });

    it('clips a cut text in a group carrying the node transform (P17)', () => {
        const stage = renderStage({
            wrap: 'cut',
            text: { kind: 'static', value: 'a'.repeat(30) },
            size: { w: 100, h: 40 },
            fontSize: 100,
            transform: { x: 20, y: 30, rotDeg: 45, scaleX: 2, scaleY: 2 },
        });
        // `clip` keeps the bare Text; `cut` is the only mode with a group.
        const group = stage.findOne('Group') as Konva.Group;
        expect(group).toBeTruthy();
        expect(group.clipX()).toBe(0);
        expect(group.clipY()).toBe(0);
        expect(group.clipWidth()).toBe(100);
        expect(group.clipHeight()).toBe(40);
        // The group carries the transform, and the box size the editor's
        // box-only resize recipe reads off the registered node.
        expect(group.x()).toBe(20);
        expect(group.y()).toBe(30);
        expect(group.rotation()).toBe(45);
        expect(group.scaleX()).toBe(2);
        expect(group.width()).toBe(100);
        expect(group.height()).toBe(40);
        // The Transformer measures the group's client rect: it must be the node
        // box, not the (cut) text's natural width.
        const clientRect = group.getClientRect({ skipTransform: true });
        expect(clientRect.width).toBe(100);
        expect(clientRect.height).toBe(40);

        const text = group.getChildren()[0] as Konva.Text;
        expect(text).toBeInstanceOf(Konva.Text);
        expect(text.wrap()).toBe('none');
        expect(text.width()).toBe(100);
        expect(text.x()).toBe(0);
        expect(text.y()).toBe(0);
        expect(text.scaleX()).toBe(1);
        // No continuation line: the hard line is cut at the box width.
        expect(text.textArr).toHaveLength(1);
        expect(text.textArr[0]!.text.length).toBeLessThan(30);
        expect(text.getTextWidth()).toBeLessThanOrEqual(100);
    });

    it('keeps the clip preview group-free and word-wrapped', () => {
        const stage = renderStage({ wrap: 'clip', text: { kind: 'static', value: 'a'.repeat(30) } });
        expect(stage.findOne('Group')).toBeUndefined();
        expect((stage.findOne('Text') as Konva.Text).wrap()).toBe('word');
    });

    it('passes a combined bold+italic fontStyle through to the Konva Text', () => {
        // The preview and print factory both read the same resolved `fontStyle`
        // string verbatim; `'bold italic'` must survive so the glyphs render bold
        // in the editor preview (Konva builds `fn.fontStyle + size + family`).
        expect(renderText({}).fontStyle()).toBe('normal');
        expect(renderText({ fontStyle: 'bold italic' }).fontStyle()).toBe('bold italic');
    });

    it('applies the shrink scale in the preview', () => {
        const shrink = renderText({
            text: { kind: 'static', value: 'a'.repeat(26) },
            size: { w: 100, h: 40 },
            fontSize: 100,
            wrap: 'shrink',
        });
        expect(shrink.scaleX()).toBe(shrink.scaleY());
        expect(shrink.scaleX()).toBeGreaterThan(0);
        expect(shrink.scaleX()).toBeLessThanOrEqual(1);
    });

    it('lays shrink text out in the unscaled box, then scales it to fit', () => {
        // Same node as above, but the height assertion: the preview must pass
        // `node.h / shrink` to Konva so no wrapped line hits the fixed-height
        // break before the scale is applied (print and preview share the fix).
        const value = 'a'.repeat(26);
        const text = { kind: 'static' as const, value };
        const shrink = renderText({
            text,
            size: { w: 100, h: 40 },
            fontSize: 100,
            wrap: 'shrink',
        });
        expect(shrink.scaleX()).toBe(shrink.scaleY());
        expect(shrink.scaleX()).toBeGreaterThan(0);
        expect(shrink.scaleX()).toBeLessThan(1);
        expect(shrink.height()).toBeCloseTo(40 / shrink.scaleX(), 6);
        expect(shrink.height() * shrink.scaleX()).toBeCloseTo(40, 6);
        // ... and every natural line survived. This file runs on the real canvas
        // shim, so the count is font-dependent (unlike the fake 10px-per-glyph
        // context in `konvaFactory.test.ts`, where it is exactly 3): take it from
        // the same full-height measurement the renderers use, then prove the
        // rendered node kept them all.
        const naturalLines =
            measureKonvaText({
                text: value,
                width: 100,
                height: 40,
                fontSize: 100,
                fontFamily: shrink.fontFamily(),
                fontStyle: shrink.fontStyle(),
                wrap: 'word',
                lineHeight: shrink.lineHeight(),
            }).height /
            (shrink.fontSize() * shrink.lineHeight());
        expect(naturalLines).toBeGreaterThan(1);
        expect(shrink.textArr).toHaveLength(Math.round(naturalLines));
        expect(shrink.textArr.map((line) => line.text).join('')).toBe(value);
    });

    it('never divides by a zero shrink (degenerate box)', () => {
        // A zero-height box measures to `scale === 0`; the relaxed layout height
        // must fall back to `node.h` and the node must still mount. (A zero-width
        // box lays out no glyphs, so Konva's 0×0 measurement keeps scale 1 — the
        // guard still has to keep both finite.)
        for (const size of [
            { w: 0, h: 40 },
            { w: 100, h: 0 },
        ]) {
            const text = renderText({
                text: { kind: 'static', value: 'a'.repeat(26) },
                size,
                fontSize: 100,
                wrap: 'shrink',
            });
            expect(text, JSON.stringify(size)).toBeTruthy();
            expect(Number.isFinite(text.scaleX()), `scaleX for ${JSON.stringify(size)}`).toBe(true);
            expect(Number.isFinite(text.scaleY()), `scaleY for ${JSON.stringify(size)}`).toBe(true);
            expect(Number.isFinite(text.height()), `height for ${JSON.stringify(size)}`).toBe(true);
            expect(Number.isFinite(text.width()), `width for ${JSON.stringify(size)}`).toBe(true);
            expect(text.height()).toBe(size.h);
        }

        // The exact zero-scale case: a zero-height box (scale stays 0, layout
        // height falls back to the real box).
        const zeroHeight = renderText({
            text: { kind: 'static', value: 'a'.repeat(26) },
            size: { w: 100, h: 0 },
            fontSize: 100,
            wrap: 'shrink',
        });
        expect(zeroHeight.scaleX()).toBe(0);
        expect(zeroHeight.height()).toBe(0);
    });
});
