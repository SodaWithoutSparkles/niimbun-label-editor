// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo, type CsvRecord } from '../../data/csvRepo';
import { CsvPickDialog } from './CsvPickDialog';
import { DataSourceTab } from './DataSourceTab';

/**
 * "Use existing" CSV attach (phase 9, W3): reference shares the stored table,
 * clone writes a copy under a fresh id. Both attach as one undo entry.
 */

const record: CsvRecord = {
    id: 'csv-1',
    name: 'products.csv',
    columns: ['sku', 'qty'],
    rows: [['A', '1'], ['B', '2']],
};

const emptyDoc = (id = 'doc-1') =>
    createLabelDoc({ id, now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });

/** A promise whose settlement the test controls (hold an operation mid-flight). */
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useStore.setState({ currentDoc: null, csvRepo: null, docPast: [], docFuture: [], editorWarnings: {} });
});

const openPicker = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Use existing' }));
    await waitFor(() => expect(screen.getByText('products.csv')).toBeTruthy());
};

describe('DataSourceTab — use existing (phase 9 W3)', () => {
    it('reference: attaches the existing id, no new record', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        const doc = emptyDoc();
        useStore.setState({ currentDoc: doc, csvRepo });
        render(<DataSourceTab doc={doc} />);

        await openPicker();
        fireEvent.click(screen.getByText('products.csv'));
        fireEvent.click(screen.getByRole('button', { name: 'Reference' }));

        await waitFor(() => expect(useStore.getState().currentDoc!.data.csv?.csvId).toBe('csv-1'));
        expect(useStore.getState().currentDoc!.data.csv?.source).toEqual({
            kind: 'local',
            mediaType: 'text/csv',
            resourceId: 'csv-1',
        });
        expect(await csvRepo.list()).toHaveLength(1);
        // Attach + sample-row reset is one undo entry.
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('clone: writes a new record and attaches its id', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        const doc = emptyDoc();
        useStore.setState({ currentDoc: doc, csvRepo });
        render(<DataSourceTab doc={doc} />);

        await openPicker();
        fireEvent.click(screen.getByText('products.csv'));
        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        await waitFor(() => expect(useStore.getState().currentDoc!.data.csv?.csvId).toBeDefined());
        const csvId = useStore.getState().currentDoc!.data.csv!.csvId;
        expect(csvId).not.toBe('csv-1');

        const list = await csvRepo.list();
        expect(list).toHaveLength(2);
        const copy = list.find((entry) => entry.id === csvId)!;
        expect(copy.name).toBe('products.csv');
        expect(copy.columns).toEqual(record.columns);
        expect(copy.rows).toEqual(record.rows);
        // The original is untouched.
        expect(await csvRepo.get('csv-1')).toEqual(record);
    });

    it('shows an empty state when no tables exist', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        const doc = emptyDoc();
        useStore.setState({ currentDoc: doc, csvRepo });
        render(<DataSourceTab doc={doc} />);

        fireEvent.click(screen.getByRole('button', { name: 'Use existing' }));
        await waitFor(() => expect(screen.getByText('No CSV tables available.')).toBeTruthy());
    });

    it('disables the control when storage is unavailable', () => {
        const doc = emptyDoc();
        useStore.setState({ currentDoc: doc, csvRepo: null });
        render(<DataSourceTab doc={doc} />);
        expect(screen.getByRole('button', { name: 'Use existing' })).toBeDisabled();
    });
});

/**
 * Round-2 regression (phase 9): the picker's cancellation flag was a boolean
 * shared across dialog sessions — closing and reopening reset it, re-enabling a
 * clone still in flight from the previous session against the wrong doc. A
 * per-operation generation token must invalidate it instead.
 */
describe('CsvPickDialog — cancellation across sessions (round 2)', () => {
    it('close + reopen mid-flight: the stale clone continuation does not pick or close', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        useStore.setState({ csvRepo });
        const putSpy = vi.spyOn(csvRepo, 'put');
        const onPick = vi.fn();
        const onClose = vi.fn();
        const put = deferred<void>();
        putSpy.mockReturnValueOnce(put.promise);

        const view = render(<CsvPickDialog open onClose={onClose} onPick={onPick} />);
        await waitFor(() => expect(screen.getByText('products.csv')).toBeTruthy());
        fireEvent.click(screen.getByText('products.csv'));
        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        // In flight: the clone write is still pending.
        expect(putSpy).toHaveBeenCalledTimes(1);

        // Close, then reopen while the write is still pending.
        view.rerender(<CsvPickDialog open={false} onClose={onClose} onPick={onPick} />);
        view.rerender(<CsvPickDialog open onClose={onClose} onPick={onPick} />);

        // The stale operation settles after the reopen.
        await act(async () => {
            put.resolve();
            await put.promise;
        });

        expect(onPick).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
