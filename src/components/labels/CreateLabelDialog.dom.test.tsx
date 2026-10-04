import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '../../i18n';
import { CreateLabelDialog } from './CreateLabelDialog';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo } from '../../data/labelRepo';

const resetStore = () => {
    useStore.setState({
        gallery: [],
        galleryLoading: false,
        storageError: false,
        labelRepo: null,
        notifications: [],
        view: 'gallery',
    });
};

afterEach(() => {
    cleanup();
    resetStore();
});

describe('CreateLabelDialog — submit robustness', () => {
    it('persists the default F-tag label and closes on success', async () => {
        useStore.setState({ labelRepo: createLabelRepo(createMemoryAdapter()) });
        const onClose = vi.fn();
        render(<CreateLabelDialog open onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(useStore.getState().gallery).toHaveLength(1);
        expect(useStore.getState().gallery[0].name).toBe('F-tag spare 25×78');
    });

    it('releases `saving` and shows a visible error when createLabel rejects', async () => {
        // Force the exact failure the old code left silent: the awaited store
        // action rejects. The dialog must not strand its disabled/spinner state.
        useStore.setState({
            labelRepo: createLabelRepo(createMemoryAdapter()),
            createLabel: async () => {
                throw new Error('unexpected store rejection');
            },
        });
        const onClose = vi.fn();
        render(<CreateLabelDialog open onClose={onClose} />);

        const createButton = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createButton);

        // `saving` released → the button is interactive again.
        await vi.waitFor(() => expect(createButton).toBeEnabled());
        // Failure is visible, not a silent stuck dialog.
        expect(await screen.findByText('Failed to save label')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a visible error when the repo save fails (createLabel yields null)', async () => {
        const repo = createLabelRepo(createMemoryAdapter());
        vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('idb transaction aborted'));
        useStore.setState({ labelRepo: repo });
        const onClose = vi.fn();
        render(<CreateLabelDialog open onClose={onClose} />);

        const createButton = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createButton);

        await vi.waitFor(() => expect(createButton).toBeEnabled());
        expect(await screen.findByText('Failed to save label')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
