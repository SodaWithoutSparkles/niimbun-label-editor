// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import { useCatalogue, type CatalogueRepo } from './useCatalogue';

/**
 * Focused unit tests for the repo-agnostic catalogue hook (phase 9, W1),
 * mirroring the `PaperTypeSection.dom.test.tsx` harness with an injected fake
 * repo so the load/mutation semantics are pinned independently of the shell.
 */

type Item = { id: string; name: string };

const item = (id: string): Item => ({ id, name: id });

const messages = { saveFailed: 'save failed', deleteFailed: 'delete failed' };

const makeRepo = (overrides: Partial<CatalogueRepo<Item>> = {}): CatalogueRepo<Item> => ({
    list: vi.fn(async () => []),
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...overrides,
});

afterEach(() => {
    cleanup();
    useStore.setState({ notifications: [] });
});

describe('useCatalogue', () => {
    it('starts loading, then exposes the items from list()', async () => {
        const repo = makeRepo({ list: vi.fn(async () => [item('a'), item('b')]) });
        const { result } = renderHook(() => useCatalogue<Item>({ repo, messages }));

        expect(result.current.loading).toBe(true);

        await waitFor(() => expect(result.current.items).toHaveLength(2));
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(false);
        expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']);
    });

    it('treats a null repo as an empty catalogue, not an error', async () => {
        const { result } = renderHook(() => useCatalogue<Item>({ repo: null, messages }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.items).toEqual([]);
        expect(result.current.error).toBe(false);
    });

    it('flips error when list() rejects', async () => {
        const repo = makeRepo({
            list: vi.fn(async () => {
                throw new Error('idb read failed');
            }),
        });
        const { result } = renderHook(() => useCatalogue<Item>({ repo, messages }));

        await waitFor(() => expect(result.current.error).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.items).toEqual([]);
    });

    it('notifies and reports failure when remove() rejects', async () => {
        const repo = makeRepo({
            list: vi.fn(async () => [item('a')]),
            remove: vi.fn(async () => {
                throw new Error('delete failed');
            }),
        });
        const { result } = renderHook(() => useCatalogue<Item>({ repo, messages }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let ok: boolean | undefined;
        await act(async () => {
            ok = await result.current.remove('a');
        });

        expect(ok).toBe(false);
        expect(useStore.getState().notifications).toEqual([
            expect.objectContaining({ type: 'error', message: 'delete failed' }),
        ]);
    });

    it('reloads after a successful remove()', async () => {
        const repo = makeRepo({ list: vi.fn(async () => [item('a')]) });
        const { result } = renderHook(() => useCatalogue<Item>({ repo, messages }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.remove('a');
        });

        expect(repo.remove).toHaveBeenCalledWith('a');
        expect(repo.list).toHaveBeenCalledTimes(2);
    });

    it('notifies and reports failure when save() rejects', async () => {
        const repo = makeRepo({
            put: vi.fn(async () => {
                throw new Error('quota exceeded');
            }),
        });
        const { result } = renderHook(() => useCatalogue<Item>({ repo, messages }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let ok: boolean | undefined;
        await act(async () => {
            ok = await result.current.save(item('a'));
        });

        expect(ok).toBe(false);
        expect(useStore.getState().notifications).toEqual([
            expect.objectContaining({ type: 'error', message: 'save failed' }),
        ]);
    });
});
