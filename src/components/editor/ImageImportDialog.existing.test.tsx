// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo, type ResourceRecord } from '../../data/resourceRepo';
import type { ImageRef } from '../../core/doc/types';
import { resolveResourceDimensions } from '../../editor/assetImport';
import { ImageImportDialog } from './ImageImportDialog';

/**
 * "Use existing" image import (phase 9, W3). Unlike the P5 dialog tests, the
 * real `assetImport` helpers run here so the produced `ImageRef` shape and the
 * repo side effects are the thing under test. Only `resolveResourceDimensions`
 * is swapped for a controllable double (delegating to the real implementation
 * by default) so the cancellation tests can hold an import mid-flight.
 */

const dimsMock = vi.hoisted(() => ({
    real: undefined as unknown as (
        record: Pick<ResourceRecord, 'mediaType' | 'bytes' | 'widthPx' | 'heightPx'>,
    ) => Promise<{ widthPx: number; heightPx: number }>,
}));

vi.mock('../../editor/assetImport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/assetImport')>();
    dimsMock.real = actual.resolveResourceDimensions;
    return {
        ...actual,
        resolveResourceDimensions: vi.fn(actual.resolveResourceDimensions),
    };
});

const resolveDims = vi.mocked(resolveResourceDimensions);

const record: ResourceRecord = {
    id: 'res-1',
    mediaType: 'image/png',
    name: 'logo.png',
    widthPx: 120,
    heightPx: 60,
    bytes: new Uint8Array([1, 2, 3]),
};

/** A promise whose settlement the test controls (hold an operation mid-flight). */
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

beforeEach(() => {
    // Every test starts from the real dimension resolver.
    resolveDims.mockImplementation(dimsMock.real);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useStore.setState({ resourceRepo: null });
});

/** Open the "Use existing" tab and wait for the seeded record to render. */
const openExisting = async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Use existing' }));
    await waitFor(() => expect(screen.getByText('logo.png')).toBeTruthy());
};

describe('ImageImportDialog — use existing (phase 9 W3)', () => {
    it('reference: fresh imageId, shared source.resourceId, no copy written', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record);
        useStore.setState({ resourceRepo: repo });
        const onImported = vi.fn();
        render(<ImageImportDialog open onClose={vi.fn()} onImported={onImported} />);

        await openExisting();
        fireEvent.click(screen.getByText('logo.png'));
        fireEvent.click(screen.getByRole('button', { name: 'Reference' }));

        await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
        const ref = onImported.mock.calls[0]![0] as ImageRef;
        expect(ref.source).toEqual({ kind: 'local', mediaType: 'image/png', resourceId: 'res-1' });
        expect(ref.imageId).not.toBe('res-1');
        expect(ref.name).toBe('logo.png');
        expect(ref.widthPx).toBe(120);
        expect(ref.heightPx).toBe(60);

        // A reference writes nothing: the store is unchanged.
        expect(await repo.list()).toHaveLength(1);
    });

    it('clone: writes a new record (equal bytes) and points at the copy', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record);
        useStore.setState({ resourceRepo: repo });
        const onImported = vi.fn();
        render(<ImageImportDialog open onClose={vi.fn()} onImported={onImported} />);

        await openExisting();
        fireEvent.click(screen.getByText('logo.png'));
        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
        const ref = onImported.mock.calls[0]![0] as ImageRef;
        expect(ref.imageId).toBe((ref.source as { resourceId: string }).resourceId);

        const list = await repo.list();
        expect(list).toHaveLength(2);
        const copy = list.find((entry) => entry.id === ref.imageId)!;
        expect(copy).toBeDefined();
        expect(Array.from(copy.bytes)).toEqual([1, 2, 3]);
        expect(copy.name).toBe('logo.png');
    });

    it('disables the mode when storage is unavailable', () => {
        useStore.setState({ resourceRepo: null });
        render(<ImageImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
        expect(screen.getByRole('tab', { name: 'Use existing' })).toBeDisabled();
    });

    it('shows an empty state when the library has no images', async () => {
        useStore.setState({ resourceRepo: createResourceRepo(createMemoryAdapter()) });
        render(<ImageImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

        fireEvent.click(screen.getByRole('tab', { name: 'Use existing' }));
        await waitFor(() => expect(screen.getByText('No images in your media library.')).toBeTruthy());
    });
});

/**
 * Round-2 regression (phase 9): the cancellation flag was a boolean shared
 * across dialog sessions — reopening reset it to "not cancelled" and re-enabled
 * a continuation still in flight from the *previous* session. A per-operation
 * generation token must invalidate it instead.
 */
describe('ImageImportDialog — cancellation across sessions (round 2)', () => {
    it('close + reopen mid-flight: the stale clone continuation neither imports nor persists', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record);
        useStore.setState({ resourceRepo: repo });
        const putSpy = vi.spyOn(repo, 'put');
        const onImported = vi.fn();
        const onClose = vi.fn();
        const dims = deferred<{ widthPx: number; heightPx: number }>();
        resolveDims.mockReturnValueOnce(dims.promise);

        const view = render(<ImageImportDialog open onClose={onClose} onImported={onImported} />);
        await openExisting();
        fireEvent.click(screen.getByText('logo.png'));
        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        // In flight: the dimensions are still resolving, so no write yet.
        expect(putSpy).not.toHaveBeenCalled();

        // Close, then reopen while the first clone is still pending.
        view.rerender(<ImageImportDialog open={false} onClose={onClose} onImported={onImported} />);
        view.rerender(<ImageImportDialog open onClose={onClose} onImported={onImported} />);

        // The stale operation settles after the reopen.
        await act(async () => {
            dims.resolve({ widthPx: 120, heightPx: 60 });
            await dims.promise;
        });

        expect(onImported).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        // A cancelled clone is never persisted (no unattached resource record).
        expect(putSpy).not.toHaveBeenCalled();
        expect(await repo.list()).toHaveLength(1);
    });

    it('cancelled clone is not persisted: put never runs once the dims resolve after close', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record);
        useStore.setState({ resourceRepo: repo });
        const putSpy = vi.spyOn(repo, 'put');
        const onImported = vi.fn();
        const dims = deferred<{ widthPx: number; heightPx: number }>();
        resolveDims.mockReturnValueOnce(dims.promise);

        const view = render(<ImageImportDialog open onClose={vi.fn()} onImported={onImported} />);
        await openExisting();
        fireEvent.click(screen.getByText('logo.png'));
        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        // Close while the dimensions are still resolving.
        view.rerender(<ImageImportDialog open={false} onClose={vi.fn()} onImported={onImported} />);

        await act(async () => {
            dims.resolve({ widthPx: 120, heightPx: 60 });
            await dims.promise;
        });

        // The clone write must not start: it would leave an orphan record.
        expect(putSpy).not.toHaveBeenCalled();
        expect(onImported).not.toHaveBeenCalled();
        expect(await repo.list()).toHaveLength(1);
    });
});
