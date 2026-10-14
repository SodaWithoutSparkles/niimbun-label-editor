// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { mmToHm } from '../../core/hm';
import { createMemoryAdapter } from '../../data/db';
import { createPaperRepo, type PaperRecord, type PaperRepo } from '../../data/paperRepo';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs/dialogService';
import { PaperTypeSection } from './PaperTypeSection';

vi.mock('../common/dialogs/dialogService', () => ({ confirm: vi.fn() }));

afterEach(() => {
    cleanup();
    useStore.setState({ paperRepo: null, defaultPaperTypeId: undefined, notifications: [] });
});

const record = (id: string, name: string, wMm: number, hMm: number): PaperRecord => ({
    id,
    name,
    backingW: mmToHm(wMm),
    backingH: mmToHm(hMm),
    regions: [{ kind: 'rect', x: 0, y: 0, w: mmToHm(wMm), h: mmToHm(hMm) }],
    guides: [],
});

/** A repo pre-seeded with two valid records (p1 first, so it renders first). */
const seededRepo = async (): Promise<PaperRepo> => {
    const repo = createPaperRepo(createMemoryAdapter());
    await repo.put(record('p1', 'F-tag spare', 25, 78));
    await repo.put(record('p2', 'Rounded 30x20', 30, 20));
    return repo;
};

describe('PaperTypeSection', () => {
    it('renders a card per seeded paper type (name, size, region count)', async () => {
        useStore.setState({ paperRepo: await seededRepo() });
        render(<PaperTypeSection />);

        expect(await screen.findByText('F-tag spare')).toBeInTheDocument();
        expect(screen.getByText('Rounded 30x20')).toBeInTheDocument();
        expect(screen.getByText('25 × 78 mm')).toBeInTheDocument();
        expect(screen.getAllByText('Regions: 1')).toHaveLength(2);
    });

    it('narrows the grid through the search input', async () => {
        useStore.setState({ paperRepo: await seededRepo() });
        render(<PaperTypeSection />);
        await screen.findByText('F-tag spare');

        fireEvent.change(screen.getByLabelText('Search by name or size'), { target: { value: '30x20' } });

        expect(screen.getByText('Rounded 30x20')).toBeInTheDocument();
        expect(screen.queryByText('F-tag spare')).not.toBeInTheDocument();
    });

    it('shows the empty state when the catalogue has no records', async () => {
        useStore.setState({ paperRepo: createPaperRepo(createMemoryAdapter()) });
        render(<PaperTypeSection />);

        expect(await screen.findByText('No paper types yet.')).toBeInTheDocument();
    });

    it('confirms, then removes a paper type; deleting the default clears the preference', async () => {
        const repo = await seededRepo();
        useStore.setState({ paperRepo: repo, defaultPaperTypeId: 'p1' });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<PaperTypeSection />);

        await screen.findByText('F-tag spare');
        expect(screen.getByRole('button', { name: 'Default for new labels' })).toBeDisabled();

        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        await waitFor(() => expect(screen.queryByText('F-tag spare')).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({ danger: true, message: expect.stringContaining('F-tag spare') }),
        );
        expect(await repo.has('p1')).toBe(false);
        expect(useStore.getState().defaultPaperTypeId).toBeUndefined();
    });

    it('keeps the record when the delete confirm is dismissed', async () => {
        useStore.setState({ paperRepo: await seededRepo() });
        vi.mocked(confirm).mockResolvedValue(false);
        render(<PaperTypeSection />);

        await screen.findByText('F-tag spare');
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(screen.getByText('F-tag spare')).toBeInTheDocument();
    });

    it('sets the default paper type in the store', async () => {
        useStore.setState({ paperRepo: await seededRepo(), defaultPaperTypeId: undefined });
        render(<PaperTypeSection />);

        await screen.findByText('F-tag spare');
        fireEvent.click(screen.getAllByRole('button', { name: 'Set as default' })[0]!);

        expect(useStore.getState().defaultPaperTypeId).toBe('p1');
        const defaultBtn = screen.getByRole('button', { name: 'Default for new labels' });
        expect(defaultBtn).toBeDisabled();
    });

    it('shows the read-error state when list() rejects', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const failing: PaperRepo = { ...repo, list: vi.fn().mockRejectedValue(new Error('idb read failed')) };
        useStore.setState({ paperRepo: failing });
        render(<PaperTypeSection />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load paper types.');
    });
});
