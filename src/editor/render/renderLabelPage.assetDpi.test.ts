// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';

/**
 * W2 review: `renderLabelPage` must (a) validate the effective dpi **before**
 * `resolve`, and (b) thread that effective dpi into `prepareResolvedAssets` so a
 * `dpi: 50` thumbnail never decodes assets at the full document dpi.
 *
 * Both seams are wrapped with `vi.mock` so the calls (and their arguments) are
 * observable from the outside — the rendered pixels cannot reveal the decoded
 * asset scale (a uniform cap preserves aspect, so the drawn rect is identical).
 */

const resolveSpy = vi.hoisted(() => vi.fn());
const prepareSpy = vi.hoisted(() => vi.fn());

vi.mock('./resolve', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./resolve')>();
    return {
        ...actual,
        resolve: ((...args: Parameters<typeof actual.resolve>) => {
            resolveSpy(...args);
            return actual.resolve(...args);
        }) as typeof actual.resolve,
    };
});

vi.mock('./prepareAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./prepareAssets')>();
    return {
        ...actual,
        prepareResolvedAssets: ((
            ...args: Parameters<typeof actual.prepareResolvedAssets>
        ) => {
            prepareSpy(...args);
            return actual.prepareResolvedAssets(...args);
        }) as typeof actual.prepareResolvedAssets,
    };
});

// Imported after the mocks so the render path picks up the wrappers.
import { renderLabelPage } from './renderLabelPage';

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const image = (id: string, x: number, y: number, w: number, h: number): Node =>
    node({
        id,
        parentId: null,
        type: 'image',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        imageId: 'i1',
        size: { w, h },
    });

const doc = (): LabelDoc =>
    createLabelDoc({
        backingW: 4000,
        backingH: 2000,
        dpi: 254,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
        nodes: [image('img', 0, 0, 2000, 1000)],
    });

describe('renderLabelPage — asset dpi threading (W2 review)', () => {
    it('passes the effective dpi into prepareResolvedAssets', async () => {
        prepareSpy.mockClear();
        await renderLabelPage(doc(), {}, { dpi: 50 });
        expect(prepareSpy).toHaveBeenCalledTimes(1);
        const deps = prepareSpy.mock.calls[0]![2] as { dpi?: number } | undefined;
        expect(deps?.dpi).toBe(50);
    });

    it('passes the document dpi when no override is given', async () => {
        prepareSpy.mockClear();
        await renderLabelPage(doc());
        const deps = prepareSpy.mock.calls[0]![2] as { dpi?: number } | undefined;
        expect(deps?.dpi).toBe(254);
    });

    it('validates opts.dpi before resolve (no full resolve/template pass)', async () => {
        resolveSpy.mockClear();
        await expect(renderLabelPage(doc(), {}, { dpi: 0 })).rejects.toThrow(RangeError);
        await expect(renderLabelPage(doc(), {}, { dpi: Number.NaN })).rejects.toThrow(RangeError);
        expect(resolveSpy).not.toHaveBeenCalled();
    });
});
