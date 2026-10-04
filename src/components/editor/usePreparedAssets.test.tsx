import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo } from '../../data/resourceRepo';
import type { FontRef, LabelDoc } from '../../core/doc/types';
import type { PreparedAsset } from '../../editor/render/assets';
import type { ResolvedNode } from '../../editor/render/resolve';

/**
 * The render seam is mocked so these tests exercise the hook's orchestration
 * (font registration order + input-keyed results), not the decoders.
 */
const { ensureFontsSpy, prepareSpy } = vi.hoisted(() => ({
    ensureFontsSpy: vi.fn(async () => {}),
    prepareSpy: vi.fn(),
}));

vi.mock('../../editor/render/fontAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/render/fontAssets')>();
    return {
        ...actual,
        createFontProvider: vi.fn(() => ({ ensureFonts: ensureFontsSpy })),
    };
});

vi.mock('../../editor/render/prepareAssets', () => ({
    prepareResolvedAssets: prepareSpy,
}));

import { usePreparedAssets } from './usePreparedAssets';

const emptyPrepared = () => ({ assets: new Map<string, PreparedAsset>(), warnings: new Map() });

/** Stable identity, as `PreviewStage` supplies via `useMemo`. */
const NO_NODES: readonly ResolvedNode[] = [];

const makeDoc = () =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });

const importedFont: FontRef = {
    fontId: 'f1',
    familyName: 'Imported',
    name: 'Imported',
    source: { kind: 'imported', asset: { kind: 'local', mediaType: 'font/ttf', resourceId: 'f1' } },
};

beforeEach(() => {
    prepareSpy.mockReset();
    prepareSpy.mockResolvedValue(emptyPrepared());
    ensureFontsSpy.mockClear();
});

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, resourceRepo: null, effectiveZoom: 1 });
});

describe('usePreparedAssets (P5 render seam)', () => {
    it('registers imported fonts before preparing (must-fix #3)', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        const doc = makeDoc();
        doc.resources.fonts.push(importedFont);
        useStore.setState({ resourceRepo: repo, effectiveZoom: 1 });

        const { result } = renderHook(() => usePreparedAssets(NO_NODES, doc));

        await waitFor(() => expect(ensureFontsSpy).toHaveBeenCalledWith(doc));
        await waitFor(() => expect(result.current.assets).toBeInstanceOf(Map));
        // Fonts are registered before the prepare call, not after.
        expect(ensureFontsSpy.mock.invocationCallOrder[0]).toBeLessThan(
            prepareSpy.mock.invocationCallOrder[0]!,
        );
    });

    it('reports empty assets for a changed document until its prepare settles (must-fix #6)', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        const docA = makeDoc();
        useStore.setState({ resourceRepo: repo, effectiveZoom: 1 });

        const prepared: PreparedAsset = {
            image: {} as unknown as CanvasImageSource,
            widthPx: 1,
            heightPx: 1,
        };
        prepareSpy.mockResolvedValueOnce({
            assets: new Map([['n1', prepared]]),
            warnings: new Map(),
        });

        const { result, rerender } = renderHook(
            ({ doc }: { doc: LabelDoc | null }) => usePreparedAssets(NO_NODES, doc),
            { initialProps: { doc: docA as LabelDoc | null } },
        );

        await waitFor(() => expect(result.current.assets.size).toBe(1));

        // A new document: its prepare never settles, so the previous document's
        // assets must not leak into the new render.
        prepareSpy.mockImplementation(() => new Promise(() => {}));
        const docB = createLabelDoc({ id: 'doc-2', now: 1_700_000_001, backingW: 3000, backingH: 2000, nodes: [] });
        rerender({ doc: docB });

        expect(result.current.assets.size).toBe(0);
        expect(result.current.warnings.size).toBe(0);
    });

    it('never throws when font registration rejects', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        const doc = makeDoc();
        useStore.setState({ resourceRepo: repo, effectiveZoom: 1 });
        ensureFontsSpy.mockRejectedValueOnce(new Error('no fonts'));

        const { result } = renderHook(() => usePreparedAssets(NO_NODES, doc));

        // The prepare still runs and the hook still resolves to a result.
        await waitFor(() => expect(prepareSpy).toHaveBeenCalledWith(NO_NODES, doc, expect.anything()));
        await waitFor(() => expect(result.current).toBeDefined());
    });
});
