import { describe, expect, it, vi } from 'vitest';

/**
 * CSV store wiring (P6 W1): the undoable `setDocCsv` action and the `csvRepo`
 * created on the adapter returned by `createIdbAdapter` during boot.
 *
 * `createIdbAdapter` is mocked (mirroring `docSlice.persistence.test.ts`) so the
 * boot runs against an in-memory adapter we control.
 */
const { createIdbAdapterMock } = vi.hoisted(() => ({ createIdbAdapterMock: vi.fn() }));

vi.mock('../data/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../data/db')>();
    return { ...actual, createIdbAdapter: createIdbAdapterMock };
});

import { createAppStore } from './useStore';
import { createMemoryAdapter } from '../data/db';
import { createCsvRepo, type CsvRecord } from '../data/csvRepo';
import { createLabelDoc } from '../core/doc/factory';
import type { CsvRef } from '../core/doc/types';
import type { DocCsvAttachment } from './storeTypes';

const attachInput = (): DocCsvAttachment => ({ csvId: 'csv-1', name: 'products.csv' });

/** The ref the store is expected to build from `attachInput()` (always local). */
const expectedRef = (): CsvRef => ({
    csvId: 'csv-1',
    name: 'products.csv',
    source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' },
});

describe('setDocCsv', () => {
    it('attaches the CSV as one undoable change and undo removes it', () => {
        const store = createAppStore();
        store.setState({ currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000 }) });

        store.getState().setDocCsv(attachInput());

        expect(store.getState().currentDoc?.data.csv).toEqual(expectedRef());
        expect(store.getState().docPast).toHaveLength(1);

        store.getState().undoDoc();
        expect(store.getState().currentDoc?.data.csv).toBeUndefined();

        store.getState().redoDoc();
        expect(store.getState().currentDoc?.data.csv).toEqual(expectedRef());
    });

    it('builds a local source whose resourceId matches the csvId', () => {
        const store = createAppStore();
        store.setState({ currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000 }) });

        store.getState().setDocCsv({ csvId: '  csv-9  ', name: 'orders.csv' });

        const ref = store.getState().currentDoc?.data.csv;
        expect(ref).toEqual({
            csvId: 'csv-9',
            name: 'orders.csv',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-9' },
        });
    });

    it('rejects a blank csvId without touching the doc or history', () => {
        const store = createAppStore();
        store.setState({ currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000 }) });

        store.getState().setDocCsv({ csvId: '   ', name: 'products.csv' });

        expect(store.getState().currentDoc?.data.csv).toBeUndefined();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('clears the CSV as its own undo entry', () => {
        const store = createAppStore();
        store.setState({ currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000 }) });

        store.getState().setDocCsv(attachInput());
        store.getState().setDocCsv(null);

        expect(store.getState().currentDoc?.data.csv).toBeUndefined();
        expect(store.getState().docPast).toHaveLength(2);

        store.getState().undoDoc();
        expect(store.getState().currentDoc?.data.csv).toEqual(expectedRef());
    });

    it('does not create dead undo entries for no-op writes', () => {
        const store = createAppStore();
        store.setState({ currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000 }) });

        // Clearing an absent CSV is a no-op.
        store.getState().setDocCsv(null);
        expect(store.getState().docPast).toHaveLength(0);

        store.getState().setDocCsv(attachInput());
        // Re-attaching an identical attachment is a no-op.
        store.getState().setDocCsv(attachInput());
        expect(store.getState().docPast).toHaveLength(1);
    });

    it('is a no-op with no open document', () => {
        const store = createAppStore();
        store.getState().setDocCsv(attachInput());

        expect(store.getState().currentDoc).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);
    });
});

describe('csvRepo wiring', () => {
    it('creates csvRepo on the adapter returned by createIdbAdapter', async () => {
        const adapter = createMemoryAdapter();
        createIdbAdapterMock.mockReset();
        createIdbAdapterMock.mockResolvedValueOnce(adapter);

        const store = createAppStore();
        await store.getState().initPersistence();

        const repo = store.getState().csvRepo;
        expect(repo).not.toBeNull();

        const record: CsvRecord = {
            id: 'csv-1',
            name: 'products.csv',
            columns: ['sku'],
            rows: [['A']],
        };
        await repo!.put(record);

        // A separate repo over the same adapter sees the row, proving the shared
        // adapter (one DB connection / one migration pass).
        expect(await createCsvRepo(adapter).get('csv-1')).toEqual(record);
    });
});
