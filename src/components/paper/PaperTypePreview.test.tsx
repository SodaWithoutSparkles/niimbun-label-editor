// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { installCanvasShim } from '../../test/canvasHarness';
import { mmToHm } from '../../core/hm';
import type { Guide, Region } from '../../core/doc/types';
import { PaperTypePreview } from './PaperTypePreview';

beforeAll(() => {
    installCanvasShim();
});

interface CtxCall {
    method: string;
    args: unknown[];
}

let restoreGetContext: (() => void) | null = null;

/**
 * Records every method call the component makes on its 2D context. Wraps the
 * harness' `getContext` (installed by {@link installCanvasShim}) in a Proxy
 * rather than patching the context prototype globally, so only this canvas is
 * observed. The returned array is filled as the component draws.
 */
const recordContextCalls = (): CtxCall[] => {
    const calls: CtxCall[] = [];
    const original = HTMLCanvasElement.prototype.getContext as unknown as (
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
    ) => unknown;
    HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
    ): unknown {
        const ctx = original.call(this, contextId, ...args) as CanvasRenderingContext2D | null;
        if (contextId !== '2d' || !ctx) return ctx;
        return new Proxy(ctx, {
            get(target, prop) {
                const value = Reflect.get(target, prop) as unknown;
                if (typeof value !== 'function') return value;
                return (...callArgs: unknown[]) => {
                    calls.push({ method: String(prop), args: callArgs });
                    return (value as (...a: unknown[]) => unknown).apply(target, callArgs);
                };
            },
            // Reflect onto the target itself (not the proxy) so napi's native
            // setters still receive their own context.
            set(target, prop, value) {
                return Reflect.set(target, prop, value);
            },
        }) as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;
    restoreGetContext = () => {
        HTMLCanvasElement.prototype.getContext = original as typeof HTMLCanvasElement.prototype.getContext;
    };
    return calls;
};

afterEach(() => {
    cleanup();
    restoreGetContext?.();
    restoreGetContext = null;
});

const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: mmToHm(25), h: mmToHm(78) }];
const guides: Guide[] = [
    { id: 'score', kind: 'score', line: { x1: mmToHm(12.5), y1: 0, x2: mmToHm(12.5), y2: mmToHm(38) } },
];

const findAfter = (calls: CtxCall[], index: number, method: string): CtxCall | undefined =>
    calls.slice(index + 1).find((entry) => entry.method === method);

describe('PaperTypePreview', () => {
    it('draws a nonzero-filled silhouette then guides as a separate stroked pass', () => {
        const calls = recordContextCalls();
        const dpr = window.devicePixelRatio || 1;
        render(<PaperTypePreview regions={regions} guides={guides} />);

        // DPR-aware transform.
        expect(
            calls.some(
                (c) =>
                    c.method === 'setTransform' &&
                    c.args.length === 6 &&
                    c.args[0] === dpr &&
                    c.args[1] === 0 &&
                    c.args[2] === 0 &&
                    c.args[3] === dpr &&
                    c.args[4] === 0 &&
                    c.args[5] === 0,
            ),
        ).toBe(true);

        // The silhouette is filled with the default nonzero winding — never evenodd.
        const fillIndex = calls.findIndex((c) => c.method === 'fill');
        expect(fillIndex).toBeGreaterThanOrEqual(0);
        for (const fill of calls.filter((c) => c.method === 'fill')) {
            expect(fill.args[0]).not.toBe('evenodd');
        }

        // Guides are stroked in a pass *after* the fill.
        expect(findAfter(calls, fillIndex, 'stroke')).toBeDefined();

        // The guide endpoints reach the context via moveTo/lineTo: one vertical
        // segment at x = 12.5 mm from y = 0 to y = 38 mm.
        const move = findAfter(calls, fillIndex, 'moveTo');
        const line = findAfter(calls, fillIndex, 'lineTo');
        expect(move).toBeDefined();
        expect(line).toBeDefined();
        const scale = (move!.args[0] as number) / mmToHm(12.5);
        expect(line!.args[0]).toBeCloseTo(move!.args[0] as number);
        expect(move!.args[1]).toBeCloseTo(0);
        expect(line!.args[1]).toBeCloseTo(mmToHm(38) * scale);
    });

    it('excludes guide geometry from the silhouette (union) pass', () => {
        const calls = recordContextCalls();
        // The region sits at the origin; the guide is far away, so if the union
        // pass wrongly traced it the pre-fill path would carry the guide's
        // coordinates.
        const region: Region[] = [{ kind: 'rect', x: 0, y: 0, w: mmToHm(10), h: mmToHm(10) }];
        const farGuide: Guide[] = [
            {
                id: 'score',
                kind: 'score',
                line: { x1: mmToHm(50), y1: mmToHm(50), x2: mmToHm(50), y2: mmToHm(60) },
            },
        ];
        render(<PaperTypePreview regions={region} guides={farGuide} />);

        const fillIndex = calls.findIndex((c) => c.method === 'fill');
        expect(fillIndex).toBeGreaterThanOrEqual(0);

        // The guide's own segment is the moveTo/lineTo *after* the fill (the
        // stroke pass); take its exact context coordinates as the probe.
        const guideMove = findAfter(calls, fillIndex, 'moveTo');
        const guideLine = findAfter(calls, fillIndex, 'lineTo');
        expect(guideMove).toBeDefined();
        expect(guideLine).toBeDefined();

        // None of the union-pass path commands before the fill may carry the
        // guide's coordinates: the guide is stroked later, never filled.
        const beforeFill = calls.slice(0, fillIndex);
        const carriesGuideMove = beforeFill.some(
            (c) => c.method === 'moveTo' && c.args[0] === guideMove!.args[0] && c.args[1] === guideMove!.args[1],
        );
        const carriesGuideLine = beforeFill.some(
            (c) => c.method === 'lineTo' && c.args[0] === guideLine!.args[0] && c.args[1] === guideLine!.args[1],
        );
        expect(carriesGuideMove).toBe(false);
        expect(carriesGuideLine).toBe(false);
    });

    it('mounts with empty regions (backing outline only, never a filled box)', () => {
        const calls = recordContextCalls();
        const { container } = render(<PaperTypePreview regions={[]} guides={[]} />);

        expect(container.querySelector('canvas')).not.toBeNull();
        expect(calls.some((c) => c.method === 'strokeRect')).toBe(true);
        expect(calls.some((c) => c.method === 'fill')).toBe(false);
    });

    it('strokes a guide and never fills when there is no region', () => {
        const calls = recordContextCalls();
        render(<PaperTypePreview regions={[]} guides={guides} />);

        // Backing outline for the sheet, guide stroked, no blank filled box.
        expect(calls.some((c) => c.method === 'strokeRect')).toBe(true);
        expect(calls.some((c) => c.method === 'stroke')).toBe(true);
        expect(calls.some((c) => c.method === 'fill')).toBe(false);

        const move = calls.find((c) => c.method === 'moveTo');
        const line = calls.find((c) => c.method === 'lineTo');
        expect(move).toBeDefined();
        expect(line).toBeDefined();
        expect(line!.args[0]).toBeCloseTo(move!.args[0] as number);
    });
});
