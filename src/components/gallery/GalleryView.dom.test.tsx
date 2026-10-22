// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import '../../i18n';
import { GalleryView } from './GalleryView';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo, type LabelSummary } from '../../data/labelRepo';
import { createLabelDoc } from '../../core/doc/factory';
import { confirm } from '../common/dialogs/dialogService';

vi.mock('../common/dialogs/dialogService', () => ({ confirm: vi.fn() }));

afterEach(() => {
    cleanup();
    vi.mocked(confirm).mockReset();
    useStore.setState({ gallery: [], galleryLoading: false, storageError: false, labelRepo: null, notifications: [] });
});

/** Seed one stored label and publish its gallery summary. */
const seedLabel = async (name = 'My label'): Promise<LabelSummary> => {
    const repo = createLabelRepo(createMemoryAdapter());
    const doc = createLabelDoc({ id: 'label-1', name, now: 1_000_000 });
    await repo.save(doc);
    const summary: LabelSummary = {
        id: doc.meta.id,
        name: doc.meta.name,
        createdAt: doc.meta.createdAt,
        updatedAt: doc.meta.updatedAt,
        backingW: doc.label.backingW,
        backingH: doc.label.backingH,
    };
    useStore.setState({ labelRepo: repo, galleryLoading: false, gallery: [summary] });
    return summary;
};

describe('GalleryView', () => {
    it('renders the empty state when there are no labels', async () => {
        useStore.setState({ gallery: [], galleryLoading: false, storageError: false });
        render(<GalleryView />);
        expect(await screen.findByText('No labels yet')).toBeInTheDocument();
    });

    it('renders a distinct storage-unavailable state on boot failure', async () => {
        useStore.setState({ gallery: [], galleryLoading: false, storageError: true });
        render(<GalleryView />);
        expect(await screen.findByText('Label storage unavailable')).toBeInTheDocument();
        // It must NOT reuse the genuinely-empty state.
        expect(screen.queryByText('No labels yet')).not.toBeInTheDocument();
    });

    it('renders a card for each label', async () => {
        useStore.setState({
            galleryLoading: false,
            labelRepo: createLabelRepo(createMemoryAdapter()),
            gallery: [
                {
                    id: 'label-1',
                    name: 'My label',
                    createdAt: 0,
                    updatedAt: 0,
                    backingW: 2500,
                    backingH: 7800,
                },
            ],
        });
        render(<GalleryView />);

        expect(await screen.findByText('My label')).toBeInTheDocument();
        expect(screen.getByText('25 × 78 mm')).toBeInTheDocument();
    });

    it('draws the placeholder backing outline at a constant 1 px whatever the aspect ratio', async () => {
        // The `viewBox` is in hm, so a user-unit stroke scales with the fit: a
        // 25×78 mm label used to render a 0.46 px hairline on the white art area
        // and the card looked empty.
        useStore.setState({
            galleryLoading: false,
            labelRepo: createLabelRepo(createMemoryAdapter()),
            gallery: [
                {
                    id: 'label-1',
                    name: 'Tall label',
                    createdAt: 0,
                    updatedAt: 0,
                    backingW: 2500,
                    backingH: 7800,
                },
            ],
        });
        const { container } = render(<GalleryView />);

        const rect = await vi.waitFor(() => {
            const found = container.querySelector('svg rect');
            if (!found) throw new Error('placeholder not rendered');
            return found;
        });
        expect(rect.getAttribute('stroke-width')).toBe('1');
        expect(rect.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    });

    it('surfaces an error when opening a corrupt label instead of a silent no-op', async () => {
        const adapter = createMemoryAdapter({
            // Present but unreadable: `get()` yields null rather than a doc.
            labels: { 'label-1': { meta: {}, docGz: new Uint8Array() } },
        });
        useStore.setState({
            galleryLoading: false,
            labelRepo: createLabelRepo(adapter),
            notifications: [],
            gallery: [
                {
                    id: 'label-1',
                    name: 'Broken label',
                    createdAt: 0,
                    updatedAt: 0,
                    backingW: 100,
                    backingH: 100,
                },
            ],
        });
        render(<GalleryView />);

        fireEvent.click(screen.getByRole('button', { name: 'Open Broken label' }));

        await vi.waitFor(() => {
            expect(useStore.getState().notifications.some((n) => n.type === 'error')).toBe(true);
        });
        // The click must not silently switch to the editor.
        expect(useStore.getState().view).toBe('gallery');
    });

    it('keeps the card when the delete confirm is dismissed', async () => {
        await seedLabel();
        const repo = useStore.getState().labelRepo!;
        const remove = vi.spyOn(repo, 'remove');
        vi.mocked(confirm).mockResolvedValue(false);
        render(<GalleryView />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(confirm).toHaveBeenCalledWith({
            danger: true,
            message: 'Delete "My label"? This cannot be undone.',
        });
        expect(remove).not.toHaveBeenCalled();
        expect(screen.getByText('My label')).toBeInTheDocument();
        expect(useStore.getState().gallery).toHaveLength(1);
    });

    it('deletes the label and refreshes the gallery when the confirm is accepted', async () => {
        await seedLabel();
        const repo = useStore.getState().labelRepo!;
        const remove = vi.spyOn(repo, 'remove');
        vi.mocked(confirm).mockResolvedValue(true);
        render(<GalleryView />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('label-1'));
        // The refreshed (now empty) gallery drops the card.
        await vi.waitFor(() => expect(screen.queryByText('My label')).not.toBeInTheDocument());
        expect(useStore.getState().gallery).toHaveLength(0);
    });
});
