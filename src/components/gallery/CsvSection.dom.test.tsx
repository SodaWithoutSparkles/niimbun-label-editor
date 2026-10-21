// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo, type CsvRecord, type CsvRepo } from '../../data/csvRepo';
import { createFtagSpareDoc } from '../../core/doc/factory';
import type { LabelRepo } from '../../data/labelRepo';
import { parseCsvFile, parseCsvText } from '../../data/csvImport';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs/dialogService';
import { CsvSection } from './CsvSection';

/**
 * CsvSection (phase 9, W1b): list / search / upload / view / delete over
 * `csvRepo`, mirroring `PaperTypeSection.dom.test.tsx`.
 *
 * The file read is stubbed (as `DataSourceTab.test.tsx` does) so the test feeds a
 * real CSV string through the real `parseCsvText` helper instead of depending on
 * happy-dom's `FileReader`.
 */

vi.mock('../common/dialogs/dialogService', () => ({ confirm: vi.fn() }));
vi.mock('../../data/csvImport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../data/csvImport')>();
    return { ...actual, parseCsvFile: vi.fn() };
});

afterEach(() => {
    cleanup();
    useStore.setState({ csvRepo: null, labelRepo: null, notifications: [] });
});

const record = (id: string, name: string, columns: string[], rows: string[][]): CsvRecord => ({
    id,
    name,
    columns,
    rows,
});

/** A repo pre-seeded with two records (c1 first, so it renders first). */
const seededRepo = async (): Promise<CsvRepo> => {
    const repo = createCsvRepo(createMemoryAdapter());
    await repo.put(
        record('c1', 'Products', ['sku', 'qty'], [
            ['A', '1'],
            ['B', '2'],
        ]),
    );
    await repo.put(record('c2', 'Customers', ['name', 'email'], [['Ann', 'ann@example.com']]));
    return repo;
};

/** Drive the hidden file input with a picked file. */
const pickFile = (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
};

describe('CsvSection', () => {
    it('renders a card per seeded table (name + row/column counts)', async () => {
        useStore.setState({ csvRepo: await seededRepo() });
        render(<CsvSection />);

        expect(await screen.findByText('Products')).toBeInTheDocument();
        expect(screen.getByText('Customers')).toBeInTheDocument();
        expect(screen.getByText('2 rows × 2 columns')).toBeInTheDocument();
        expect(screen.getByText('1 rows × 2 columns')).toBeInTheDocument();
    });

    it('narrows the grid through the search input (by column name too)', async () => {
        useStore.setState({ csvRepo: await seededRepo() });
        render(<CsvSection />);
        await screen.findByText('Products');

        fireEvent.change(screen.getByLabelText('Search by name or column'), {
            target: { value: 'email' },
        });

        expect(screen.getByText('Customers')).toBeInTheDocument();
        expect(screen.queryByText('Products')).not.toBeInTheDocument();
    });

    it('shows the empty state when the catalogue has no records', async () => {
        useStore.setState({ csvRepo: createCsvRepo(createMemoryAdapter()) });
        render(<CsvSection />);

        expect(await screen.findByText('No CSV tables yet.')).toBeInTheDocument();
    });

    it('parses an uploaded file and stores a record named after the file', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        useStore.setState({ csvRepo: repo });
        vi.mocked(parseCsvFile).mockResolvedValueOnce(parseCsvText('sku,qty\nA,1\nB,2\n'));

        render(<CsvSection />);
        await screen.findByText('No CSV tables yet.');

        pickFile(
            screen.getByLabelText('Upload CSV') as HTMLInputElement,
            new File(['sku,qty\nA,1\nB,2\n'], 'products.csv', { type: 'text/csv' }),
        );

        expect(await screen.findByText('products.csv')).toBeInTheDocument();
        const stored = await repo.list();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
            name: 'products.csv',
            columns: ['sku', 'qty'],
            rows: [
                ['A', '1'],
                ['B', '2'],
            ],
        });
    });

    it('confirms, then removes a table', async () => {
        const repo = await seededRepo();
        useStore.setState({ csvRepo: repo });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        await waitFor(() => expect(screen.queryByText('Products')).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({ danger: true, message: expect.stringContaining('Products') }),
        );
        expect(await repo.has('c1')).toBe(false);
    });

    it('keeps the record when the delete confirm is dismissed', async () => {
        useStore.setState({ csvRepo: await seededRepo() });
        vi.mocked(confirm).mockResolvedValue(false);
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Products')).toBeInTheDocument();
    });

    it('shows the read-error state when list() rejects', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        const failing: CsvRepo = { ...repo, list: vi.fn().mockRejectedValue(new Error('idb read failed')) };
        useStore.setState({ csvRepo: failing });
        render(<CsvSection />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load CSV tables.');
    });

    it('opens the read-only view dialog with the columns and rows', async () => {
        useStore.setState({ csvRepo: await seededRepo() });
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!);

        // The card shows the joined columns ("sku, qty"); the dialog shows the
        // header cells and data cells separately.
        expect(await screen.findByText('sku')).toBeInTheDocument();
        expect(screen.getByText('qty')).toBeInTheDocument();
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('notes truncation in the view dialog for a long table', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        const rows = Array.from({ length: 60 }, (_, index) => [String(index)]);
        await repo.put(record('big', 'Big', ['n'], rows));
        useStore.setState({ csvRepo: repo });
        render(<CsvSection />);

        await screen.findByText('Big');
        fireEvent.click(screen.getByRole('button', { name: 'View' }));

        expect(await screen.findByText('Showing the first 50 of 60 rows.')).toBeInTheDocument();
    });

    it('renames a table through the rename dialog', async () => {
        const repo = await seededRepo();
        useStore.setState({ csvRepo: repo });
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!);

        fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Catalog' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Catalog')).toBeInTheDocument();
        expect(await repo.get('c1')).toMatchObject({ id: 'c1', name: 'Catalog', columns: ['sku', 'qty'] });
    });

    it('badges unused tables and deletes only the orphans (W4)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Products', ['sku'], [['A']]));
        await repo.put(record('c2', 'Scratch', ['n'], [['1']]));

        // One document references `c1` (via `data.csv`) and nothing else.
        const doc = createFtagSpareDoc({ name: 'Label', now: 1 });
        doc.meta.id = 'd1';
        doc.data.csv = {
            csvId: 'c1',
            name: 'Products',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'c1' },
        };
        const labelRepo = {
            listDetailed: vi.fn(async () => ({ ok: [{ id: 'd1' }], errors: [] })),
            get: vi.fn(async () => doc),
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<CsvSection />);

        await screen.findByText('Products');
        // Only the unreferenced table carries the badge.
        expect(screen.getByText('Unused')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete unused (1)' }));

        await waitFor(() => expect(screen.queryByText('Scratch')).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({ danger: true, message: expect.stringContaining('1 unused') }),
        );
        // The referenced table is untouched.
        expect(screen.getByText('Products')).toBeInTheDocument();
        expect(await repo.has('c2')).toBe(false);
        expect(await repo.has('c1')).toBe(true);
    });

    it('warns in-use before deleting a referenced table, and keeps it on dismiss (P2)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Products', ['sku'], [['A']]));

        // One document references `c1` through `data.csv`.
        const doc = createFtagSpareDoc({ name: 'Label', now: 1 });
        doc.meta.id = 'd1';
        doc.data.csv = {
            csvId: 'c1',
            name: 'Products',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'c1' },
        };
        const labelRepo = {
            listDetailed: vi.fn(async () => ({ ok: [{ id: 'd1' }], errors: [] })),
            get: vi.fn(async () => doc),
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(false);
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() =>
            expect(confirm).toHaveBeenCalledWith(
                expect.objectContaining({
                    danger: true,
                    message:
                        '"Products" is used by a label. Deleting it will break that label. Delete anyway?',
                }),
            ),
        );
        // Dismissing keeps the record (override is opt-in, not automatic).
        expect(screen.getByText('Products')).toBeInTheDocument();
        expect(await repo.has('c1')).toBe(true);
    });

    it('deletes a referenced table when the user overrides the in-use warning (P2)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Products', ['sku'], [['A']]));

        const doc = createFtagSpareDoc({ name: 'Label', now: 1 });
        doc.meta.id = 'd1';
        doc.data.csv = {
            csvId: 'c1',
            name: 'Products',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'c1' },
        };
        const labelRepo = {
            listDetailed: vi.fn(async () => ({ ok: [{ id: 'd1' }], errors: [] })),
            get: vi.fn(async () => doc),
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(screen.queryByText('Products')).not.toBeInTheDocument());
        expect(await repo.has('c1')).toBe(false);
    });

    it('uses the plain delete confirm for a proven orphan (P2)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Products', ['sku'], [['A']]));

        // A complete inventory that references nothing: `c1` is a proven orphan.
        const labelRepo = {
            listDetailed: vi.fn(async () => ({ ok: [], errors: [] })),
            get: vi.fn(async () => null),
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(false);
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() =>
            expect(confirm).toHaveBeenCalledWith(
                expect.objectContaining({
                    danger: true,
                    message: 'Delete "Products"? This cannot be undone.',
                }),
            ),
        );
    });

    it('warns unverified before deleting when the scan is incomplete (P2)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Products', ['sku'], [['A']]));

        // An unreadable label may reference the table.
        const labelRepo = {
            listDetailed: vi.fn(async () => ({
                ok: [],
                errors: [{ id: '', error: 'idb read failed' }],
            })),
            get: vi.fn(async () => null),
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(false);
        render(<CsvSection />);

        await screen.findByText('Products');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() =>
            expect(confirm).toHaveBeenCalledWith(
                expect.objectContaining({
                    danger: true,
                    message:
                        'Could not verify whether "Products" is used by a label. Delete anyway?',
                }),
            ),
        );
        expect(await repo.has('c1')).toBe(true);
    });

    it('re-scans after the batch confirm and spares a record now referenced (P2)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Scratch', ['n'], [['1']]));

        // Initially the label references nothing, so `c1` is offered as unused.
        const unreferencing = createFtagSpareDoc({ name: 'Label', now: 1 });
        unreferencing.meta.id = 'd1';

        // Later the label starts referencing `c1` (another tab, or an autosave
        // that just landed between render and confirm).
        const referencing = createFtagSpareDoc({ name: 'Label', now: 1 });
        referencing.meta.id = 'd1';
        referencing.data.csv = {
            csvId: 'c1',
            name: 'Scratch',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'c1' },
        };

        const getDoc = vi.fn(async () => unreferencing);
        const labelRepo = {
            listDetailed: vi.fn(async () => ({ ok: [{ id: 'd1' }], errors: [] })),
            get: getDoc,
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<CsvSection />);

        await screen.findByText('Scratch');
        expect(screen.getByText('Unused')).toBeInTheDocument();

        getDoc.mockResolvedValue(referencing);

        fireEvent.click(screen.getByRole('button', { name: 'Delete unused (1)' }));

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        // The fresh scan proves it is referenced, so the batch deletes nothing.
        expect(await repo.has('c1')).toBe(true);
        expect(screen.getByText('Scratch')).toBeInTheDocument();
    });

    it('hides the unused-cleanup action when the reference scan is incomplete (#4)', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1', 'Scratch', ['n'], [['1']]));

        // The label store cannot be read: nothing may be offered for deletion.
        const labelRepo = {
            listDetailed: vi.fn(async () => ({
                ok: [],
                errors: [{ id: '', error: 'idb read failed' }],
            })),
            get: vi.fn(async () => null),
        } as unknown as LabelRepo;

        useStore.setState({ csvRepo: repo, labelRepo });
        render(<CsvSection />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not check for unused CSV tables.',
        );
        expect(screen.queryByRole('button', { name: /Delete unused/ })).not.toBeInTheDocument();
    });
});
