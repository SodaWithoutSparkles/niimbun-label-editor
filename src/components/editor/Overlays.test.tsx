// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createLabelDoc } from '../../core/doc/factory';
import type { hm } from '../../core/hm';

/**
 * Task 9 regression: the grid must paint **after** the opaque white union
 * silhouette, otherwise the silhouette hides it. A full react-konva render
 * needs a real canvas, so this test stubs the react-konva primitives and
 * asserts the emitted child order + the screen-space stroke flag instead.
 */
vi.mock('react-konva', async () => {
    const ReactModule = await import('react');
    const stub = (name: string) => {
        const Component = (props: { children?: React.ReactNode; strokeScaleEnabled?: boolean }) => {
            const attrs: Record<string, string> = { 'data-konva': name };
            if (props.strokeScaleEnabled !== undefined) {
                attrs['data-stroke-scale-enabled'] = String(props.strokeScaleEnabled);
            }
            return ReactModule.createElement('div', attrs, props.children);
        };
        Component.displayName = name;
        return Component;
    };
    return {
        Layer: stub('Layer'),
        Line: stub('Line'),
        Shape: stub('Shape'),
        Rect: stub('Rect'),
        Text: stub('Text'),
    };
});

// Imported after the mock so `Overlays` binds the stubbed react-konva.
import { Overlays } from './Overlays';

afterEach(cleanup);

const renderOverlays = (overrides: Partial<React.ComponentProps<typeof Overlays>> = {}) => {
    const doc = createLabelDoc({
        backingW: 4000,
        backingH: 3000,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 3000 }],
    });
    return render(
        <Overlays
            doc={doc}
            guides={[]}
            showGrid
            gridStepHm={500 as hm}
            snapLines={[]}
            keepOutIds={[]}
            keepOutBounds={new Map()}
            layerAttrs={{ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0 }}
            {...overrides}
        />,
    );
};

/** Grid lines are the only `Line`s that pin `strokeScaleEnabled` (to false). */
const GRID_LINE_SELECTOR = '[data-konva="Line"][data-stroke-scale-enabled]';

describe('Overlays — grid visibility', () => {
    it('paints the grid after the union silhouette', () => {
        const { container } = renderOverlays();
        const order = Array.from(container.querySelectorAll('[data-konva]'));
        const shapeIndex = order.findIndex((el) => el.getAttribute('data-konva') === 'Shape');
        const firstLineIndex = order.findIndex((el) => el.matches(GRID_LINE_SELECTOR));

        expect(shapeIndex).toBeGreaterThanOrEqual(0);
        expect(firstLineIndex).toBeGreaterThan(shapeIndex);
    });

    it('keeps the grid 1 screen px at any zoom (strokeScaleEnabled=false)', () => {
        // Populate guides/snap/keep-out so the assertion cannot be satisfied by
        // their `Line`s: only grid lines carry the stroke-scale flag.
        const { container } = renderOverlays({
            guides: [
                { id: 'g1', kind: 'score', line: { x1: 100, y1: 0, x2: 100, y2: 3000 } },
            ],
            snapLines: [{ axis: 'x', guide: 200, extent: 3000 }],
            keepOutIds: ['ko'],
            keepOutBounds: new Map([['ko', { x: 0, y: 0, w: 500, h: 500 }]]),
        });
        const gridLines = Array.from(container.querySelectorAll(GRID_LINE_SELECTOR));

        expect(gridLines.length).toBeGreaterThan(0);
        for (const line of gridLines) {
            expect(line.getAttribute('data-stroke-scale-enabled')).toBe('false');
        }
    });
});
