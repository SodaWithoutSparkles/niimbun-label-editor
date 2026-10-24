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
    const renderText = (over: Record<string, unknown>): Konva.Text => {
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
        return (stage as unknown as Konva.Stage).findOne('Text') as Konva.Text;
    };

    it('renders wrap + lineHeight on the Konva Text (preview ≡ print)', () => {
        expect(renderText({}).wrap()).toBe('word');
        expect(renderText({ wrap: 'char' }).wrap()).toBe('char');
        expect(renderText({ wrap: 'clip' }).wrap()).toBe('word');
        expect(renderText({ lineHeight: 1.5 }).lineHeight()).toBe(1.5);
        expect(renderText({}).letterSpacing()).toBe(0);
        expect(renderText({ letterSpacing: 1.5 }).letterSpacing()).toBe(1.5);
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
});
