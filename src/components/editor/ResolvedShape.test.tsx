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

const renderPreview = (over: Record<string, unknown>, selected = false) => {
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
                <ResolvedShape node={resolved} selected={selected} />
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
    });

    it('selected thickens a thin explicit stroke to a visible floor', () => {
        const { stage } = renderPreview(
            { shape: 'rectangle', size: { w: 1000, h: 800 }, strokeWidth: 1 },
            true,
        );
        const rect = stage.findOne('Rect') as Konva.Rect;
        expect(rect.strokeWidth()).toBe(2);
    });
});
