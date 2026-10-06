// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo, type CsvRecord } from '../../data/csvRepo';
import { parseCsvFile, type ParsedCsv } from '../../data/csvImport';
import { DataSourceTab } from './DataSourceTab';

/**
 * DataSourceTab (P6 W6): attached CSV name/rows/columns, sample-row pick, table,
 * and the attach lifecycle (one undo entry, previous bytes retained for undo,
 * double-attach guard, doc-switch safety).
 */

// The parse itself is exercised by `csvImport.test.ts`; here it is stubbed so a
// test can hold an attach in flight and observe the guard/scheduling behaviour.
vi.mock('../../data/csvImport', () => ({ parseCsvFile: vi.fn() }));

const record: CsvRecord = { id: 'csv-1', name: 'products.csv', columns: ['sku', 'qty'], rows: [['A', '1'], ['B', '2']] };

const parsed = (over: Partial<ParsedCsv> = {}): ParsedCsv => ({
    columns: ['sku', 'qty'],
    rows: [['A', '1']],
    rowCount: 1,
    warnings: [],
    ...over,
});

const makeDoc = (id = 'doc-1') => {
    const doc = createLabelDoc({ id, now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });
    doc.data.csv = { csvId: 'csv-1', name: 'products.csv', source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' } };
    return doc;
};

const emptyDoc = (id = 'doc-1') =>
    createLabelDoc({ id, now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });

/** Drive the hidden file input with a picked file. */
const pickFile = (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
};

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, csvRepo: null, docPast: [], docFuture: [] });
});

describe('DataSourceTab', () => {
    it('shows the attached CSV name, row count, columns and preview table', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc, csvRepo });

        render(<DataSourceTab doc={doc} />);

        await waitFor(() => expect(screen.getByText(/products\.csv/)).toBeTruthy());
        await waitFor(() => expect(screen.getAllByText(/2 rows/).length).toBeGreaterThan(0));
        expect(screen.getByText('sku, qty')).toBeTruthy();
        expect(screen.getByTestId('csv-preview')).toBeTruthy();
        expect(screen.getByLabelText('Sample row')).toBeTruthy();
    });

    it('writes the sample row through the undoable store action', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc, csvRepo });

        render(<DataSourceTab doc={doc} />);
        await waitFor(() => expect(screen.getByLabelText('Sample row')).toBeTruthy());

        const select = screen.getByLabelText('Sample row') as HTMLSelectElement;
        select.value = '1';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        await waitFor(() => expect(useStore.getState().currentDoc?.data.sampleRowIndex).toBe(1));
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('shows an empty state when no CSV is attached', () => {
        const doc = createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });
        useStore.setState({ currentDoc: doc, csvRepo: createCsvRepo(createMemoryAdapter()) });

        render(<DataSourceTab doc={doc} />);
        expect(screen.getByText('No CSV attached.')).toBeTruthy();
    });

    it('attaches a new CSV as one undo entry and keeps the previous record for undo', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        const removeSpy = vi.spyOn(csvRepo, 'remove');
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc, csvRepo });
        vi.mocked(parseCsvFile).mockResolvedValueOnce(parsed());

        render(<DataSourceTab doc={doc} />);
        await waitFor(() => expect(screen.getByLabelText('Sample row')).toBeTruthy());

        pickFile(screen.getByLabelText('Choose file') as HTMLInputElement, new File(['sku,qty\nA,1'], 'new.csv', { type: 'text/csv' }));

        await waitFor(() => expect(useStore.getState().currentDoc!.data.csv?.name).toBe('new.csv'));
        // Exactly one undo entry for the whole attach (ref + row reset).
        expect(useStore.getState().docPast).toHaveLength(1);
        // The replaced table's bytes are NOT deleted on the write path: the `csvs`
        // store is not undoable, so deleting them would leave `Ctrl+Z` dangling.
        expect(removeSpy).not.toHaveBeenCalled();
        expect(await csvRepo.get('csv-1')).toEqual(record);

        // Undo restores the previous ref and its bytes still resolve.
        useStore.getState().undoDoc();
        const restored = useStore.getState().currentDoc!.data.csv!;
        expect(restored.csvId).toBe('csv-1');
        expect(await csvRepo.get(restored.csvId)).toEqual(record);
    });

    it('detaches without deleting the stored record', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        await csvRepo.put(record);
        const removeSpy = vi.spyOn(csvRepo, 'remove');
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc, csvRepo });

        render(<DataSourceTab doc={doc} />);
        await waitFor(() => expect(screen.getByText('Detach')).toBeTruthy());
        fireEvent.click(screen.getByText('Detach'));

        expect(useStore.getState().currentDoc!.data.csv).toBeUndefined();
        expect(removeSpy).not.toHaveBeenCalled();
        expect(await csvRepo.get('csv-1')).toEqual(record);

        // Undo restores the detached ref; its bytes are still there.
        useStore.getState().undoDoc();
        expect(useStore.getState().currentDoc!.data.csv?.csvId).toBe('csv-1');
        expect(await csvRepo.get('csv-1')).toEqual(record);
    });

    it('ignores a second file pick while the first attach is still in flight', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        const putSpy = vi.spyOn(csvRepo, 'put');
        const doc = emptyDoc();
        useStore.setState({ currentDoc: doc, csvRepo });

        let release: ((value: ParsedCsv) => void) | undefined;
        vi.mocked(parseCsvFile).mockReturnValueOnce(new Promise<ParsedCsv>((resolve) => { release = resolve; }));

        render(<DataSourceTab doc={doc} />);
        const input = screen.getByLabelText('Choose file') as HTMLInputElement;
        const file = new File(['a'], 'a.csv', { type: 'text/csv' });
        pickFile(input, file);
        pickFile(input, file);

        release!(parsed());
        await waitFor(() => expect(useStore.getState().currentDoc!.data.csv).toBeDefined());
        expect(putSpy).toHaveBeenCalledTimes(1);
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('does not attach to a different document if the doc switches mid-parse', async () => {
        const csvRepo = createCsvRepo(createMemoryAdapter());
        const docA = emptyDoc('doc-a');
        const docB = emptyDoc('doc-b');
        useStore.setState({ currentDoc: docA, csvRepo });

        let release: ((value: ParsedCsv) => void) | undefined;
        vi.mocked(parseCsvFile).mockReturnValueOnce(new Promise<ParsedCsv>((resolve) => { release = resolve; }));

        const view = render(<DataSourceTab doc={docA} />);
        pickFile(screen.getByLabelText('Choose file') as HTMLInputElement, new File(['a'], 'a.csv', { type: 'text/csv' }));

        // The open document changes before the parse settles.
        useStore.setState({ currentDoc: docB });
        view.rerender(<DataSourceTab doc={docB} />);

        release!(parsed());
        await waitFor(() => expect(useStore.getState().currentDoc!.meta.id).toBe('doc-b'));
        expect(useStore.getState().currentDoc!.data.csv).toBeUndefined();
        expect(useStore.getState().docPast).toHaveLength(0);
    });
});
