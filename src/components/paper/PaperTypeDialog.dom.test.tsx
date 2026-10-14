// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { mmToHm } from '../../core/hm';
import type { PaperRecord } from '../../data/paperRepo';
import { createMemoryAdapter } from '../../data/db';
import { createPaperRepo } from '../../data/paperRepo';
import { useStore } from '../../store/useStore';
import { PaperTypeDialog } from './PaperTypeDialog';

afterEach(() => {
    cleanup();
    useStore.setState({ paperRepo: null, notifications: [] });
});

const fillSize = (w: string, h: string) => {
    fireEvent.change(screen.getByLabelText('Width (mm)'), { target: { value: w } });
    fireEvent.change(screen.getByLabelText('Height (mm)'), { target: { value: h } });
};

describe('PaperTypeDialog', () => {
    it('saves a new record with its regions and guides', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const put = vi.spyOn(repo, 'put');
        useStore.setState({ paperRepo: repo });
        const onSaved = vi.fn();
        const onClose = vi.fn();
        render(<PaperTypeDialog open initial={null} onClose={onClose} onSaved={onSaved} />);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My paper' } });
        fillSize('25', '78');
        fireEvent.click(screen.getByRole('button', { name: 'Add region' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add guide' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
        const saved = put.mock.calls[0]![0] as PaperRecord;
        expect(saved.id.length).toBeGreaterThan(0);
        expect(saved.name).toBe('My paper');
        expect(saved.backingW).toBe(mmToHm(25));
        expect(saved.backingH).toBe(mmToHm(78));
        expect(saved.regions).toHaveLength(1);
        expect(saved.guides).toHaveLength(1);
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('blocks save while a polygon region is invalid', () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const put = vi.spyOn(repo, 'put');
        useStore.setState({ paperRepo: repo });
        const invalid: PaperRecord = {
            id: 'p1',
            name: 'Broken',
            backingW: mmToHm(25),
            backingH: mmToHm(78),
            regions: [{ kind: 'polygon', points: [[0, 0], [mmToHm(10), 0]], closed: true }],
            guides: [],
        };
        render(<PaperTypeDialog open initial={invalid} onClose={vi.fn()} onSaved={vi.fn()} />);

        expect(screen.getByText('Enter at least 3 distinct, non-collinear points.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(put).not.toHaveBeenCalled();
    });

    it('prefills from `initial` when editing and saves under the same id', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const put = vi.spyOn(repo, 'put');
        useStore.setState({ paperRepo: repo });
        const initial: PaperRecord = {
            id: 'p1',
            name: 'Tag',
            backingW: mmToHm(25),
            backingH: mmToHm(78),
            regions: [],
            guides: [{ id: 'g1', kind: 'score', line: { x1: mmToHm(12.5), y1: 0, x2: mmToHm(12.5), y2: mmToHm(38) } }],
        };
        render(<PaperTypeDialog open initial={initial} onClose={vi.fn()} onSaved={vi.fn()} />);

        expect(screen.getByLabelText('Name')).toHaveValue('Tag');
        expect(screen.getByLabelText('Width (mm)')).toHaveValue(25);
        expect(screen.getByLabelText('Height (mm)')).toHaveValue(78);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
        expect(put.mock.calls[0]![0]).toMatchObject({ id: 'p1', name: 'Renamed' });
    });

    it('keeps the dialog open and shows the error when the write fails', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        vi.spyOn(repo, 'put').mockRejectedValueOnce(new Error('idb transaction aborted'));
        useStore.setState({ paperRepo: repo });
        const onClose = vi.fn();
        render(<PaperTypeDialog open initial={null} onClose={onClose} onSaved={vi.fn()} />);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My paper' } });
        fillSize('25', '78');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Could not save the paper type.')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
