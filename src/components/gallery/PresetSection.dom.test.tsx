// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { PresetSection } from './PresetSection';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo, type LabelRepo } from '../../data/labelRepo';
import { createLabelDoc } from '../../core/doc/factory';
import { confirm } from '../common/dialogs/dialogService';

/**
 * P3 — the Label presets pane. Presets are ordinary `labels` rows whose
 * `meta.kind` is `'preset'`; deletion must go through the store's
 * `deleteLabel` contract (confirm → repo remove → gallery refresh), never a raw
 * repo call.
 */

vi.mock('../common/dialogs/dialogService', () => ({ confirm: vi.fn() }));

// The fill dialog's own content/print wiring is covered by its own test; here
// the section only owns *which* preset is open.
vi.mock('./FillPresetDialog', () => ({
    FillPresetDialog: ({ open, presetId }: { open: boolean; presetId: string | null }) =>
        open ? <div data-testid="fill-dialog">{presetId}</div> : null,
}));

afterEach(() => {
    cleanup();
    vi.mocked(confirm).mockReset();
    useStore.setState({
        gallery: [],
        galleryLoading: false,
        storageError: false,
        labelRepo: null,
        notifications: [],
    });
});

/**
 * Seed one preset and one ordinary label into a real label repo (memory
 * adapter) and publish the repo's own summaries, mirroring
 * `GalleryView.dom.test.tsx`.
 */
const seedLibrary = async (): Promise<LabelRepo> => {
    const repo = createLabelRepo(createMemoryAdapter());
    await repo.save(
        createLabelDoc({ id: 'preset-1', name: 'Shipping preset', kind: 'preset', now: 1_000_000 }),
    );
    await repo.save(createLabelDoc({ id: 'label-1', name: 'Ordinary label', now: 1_000_100 }));
    const { ok } = await repo.listDetailed();
    useStore.setState({ labelRepo: repo, galleryLoading: false, gallery: ok });
    return repo;
};

describe('PresetSection', () => {
    it('renders only presets, never ordinary labels', async () => {
        await seedLibrary();
        render(<PresetSection />);

        expect(await screen.findByText('Shipping preset')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Label presets' })).toBeInTheDocument();
        expect(screen.queryByText('Ordinary label')).not.toBeInTheDocument();
    });

    it('renders the empty state when there are no presets', async () => {
        useStore.setState({
            labelRepo: createLabelRepo(createMemoryAdapter()),
            galleryLoading: false,
            gallery: [],
        });
        render(<PresetSection />);

        expect(await screen.findByText('No presets yet')).toBeInTheDocument();
        expect(
            screen.getByText(
                'A preset is a label with the data left to fill in. Save one from the editor to reuse it.',
            ),
        ).toBeInTheDocument();
    });

    it('opens the fill dialog from the card art, with a sibling delete button', async () => {
        await seedLibrary();
        render(<PresetSection />);
        await screen.findByText('Shipping preset');

        const openButton = screen.getByRole('button', { name: 'Fill in Shipping preset' });
        const deleteButton = screen.getByRole('button', { name: 'Delete' });
        expect(openButton.contains(deleteButton)).toBe(false);

        fireEvent.click(openButton);

        expect(await screen.findByTestId('fill-dialog')).toHaveTextContent('preset-1');
    });

    it('deletes a preset without opening the fill dialog', async () => {
        const repo = await seedLibrary();
        const remove = vi.spyOn(repo, 'remove');
        vi.mocked(confirm).mockResolvedValue(true);
        render(<PresetSection />);
        await screen.findByText('Shipping preset');

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('preset-1'));
        expect(screen.queryByTestId('fill-dialog')).not.toBeInTheDocument();
    });

    it('deletes a preset through the store after the confirm is accepted', async () => {
        const repo = await seedLibrary();
        const remove = vi.spyOn(repo, 'remove');
        vi.mocked(confirm).mockResolvedValue(true);
        render(<PresetSection />);
        await screen.findByText('Shipping preset');

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('preset-1'));
        expect(confirm).toHaveBeenCalledWith({
            danger: true,
            message: 'Delete "Shipping preset"? This cannot be undone.',
        });
        // The store's refresh re-lists the repo: the preset is gone, the label
        // survives (and is still not rendered by this pane).
        await vi.waitFor(() =>
            expect(useStore.getState().gallery.map((summary) => summary.id)).toEqual(['label-1']),
        );
        expect(screen.queryByText('Shipping preset')).not.toBeInTheDocument();
        expect(await screen.findByText('No presets yet')).toBeInTheDocument();
    });

    it('keeps the preset when the delete confirm is dismissed', async () => {
        const repo = await seedLibrary();
        const remove = vi.spyOn(repo, 'remove');
        vi.mocked(confirm).mockResolvedValue(false);
        render(<PresetSection />);
        await screen.findByText('Shipping preset');

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(remove).not.toHaveBeenCalled();
        expect(screen.getByText('Shipping preset')).toBeInTheDocument();
        expect(useStore.getState().gallery).toHaveLength(2);
    });
});
