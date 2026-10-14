// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo, type ResourceRecord, type ResourceRepo } from '../../data/resourceRepo';
import { createFtagSpareDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import type { LabelRepo } from '../../data/labelRepo';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs/dialogService';
import { MediaSection } from './MediaSection';

/**
 * MediaSection (phase 9, W2): list / search / upload / delete over
 * `resourceRepo`, mirroring `CsvSection.dom.test.tsx`.
 *
 * The upload reads the picked file's bytes through happy-dom's `File.arrayBuffer`
 * — no parser is involved, so the real bytes reach the repo. Object URLs are
 * stubbed so an image tile renders deterministically without a real Blob backend.
 */

vi.mock('../common/dialogs/dialogService', () => ({ confirm: vi.fn() }));

beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useStore.setState({ resourceRepo: null, labelRepo: null, notifications: [] });
});

const record = (id: string, mediaType: string, name: string): ResourceRecord => ({
    id,
    mediaType,
    name,
    bytes: new Uint8Array([1, 2, 3]),
});

/** A repo pre-seeded with two records (r1 first, so it renders first). */
const seededRepo = async (): Promise<ResourceRepo> => {
    const repo = createResourceRepo(createMemoryAdapter());
    await repo.put(record('r1', 'font/ttf', 'Brand Sans'));
    await repo.put(record('r2', 'image/png', 'Logo'));
    return repo;
};

/** Drive the hidden file input with a picked file. */
const pickFile = (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
};

describe('MediaSection', () => {
    it('renders a card per seeded resource (name + type)', async () => {
        useStore.setState({ resourceRepo: await seededRepo() });
        render(<MediaSection />);

        expect(await screen.findByText('Brand Sans')).toBeInTheDocument();
        expect(screen.getByText('Logo')).toBeInTheDocument();
        expect(screen.getByText('Font')).toBeInTheDocument();
        expect(screen.getByText('Image')).toBeInTheDocument();
    });

    it('narrows the grid through the search input', async () => {
        useStore.setState({ resourceRepo: await seededRepo() });
        render(<MediaSection />);
        await screen.findByText('Brand Sans');

        fireEvent.change(screen.getByLabelText('Search by name or type'), {
            target: { value: 'logo' },
        });

        expect(screen.getByText('Logo')).toBeInTheDocument();
        expect(screen.queryByText('Brand Sans')).not.toBeInTheDocument();
    });

    it('shows the empty state when the catalogue has no records', async () => {
        useStore.setState({ resourceRepo: createResourceRepo(createMemoryAdapter()) });
        render(<MediaSection />);

        expect(await screen.findByText('No media yet.')).toBeInTheDocument();
    });

    it('reads an uploaded file into a record named after the file', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        useStore.setState({ resourceRepo: repo });

        render(<MediaSection />);
        await screen.findByText('No media yet.');

        pickFile(
            screen.getByLabelText('Upload media') as HTMLInputElement,
            new File([new Uint8Array([9, 8, 7])], 'photo.png', { type: 'image/png' }),
        );

        expect(await screen.findByText('photo.png')).toBeInTheDocument();
        const stored = await repo.list();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ name: 'photo.png', mediaType: 'image/png' });
        expect([...stored[0]!.bytes]).toEqual([9, 8, 7]);
    });

    it('confirms, then removes a resource', async () => {
        const repo = await seededRepo();
        useStore.setState({ resourceRepo: repo });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<MediaSection />);

        await screen.findByText('Brand Sans');
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        await waitFor(() => expect(screen.queryByText('Brand Sans')).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({ danger: true, message: expect.stringContaining('Brand Sans') }),
        );
        expect(await repo.has('r1')).toBe(false);
    });

    it('keeps the record when the delete confirm is dismissed', async () => {
        useStore.setState({ resourceRepo: await seededRepo() });
        vi.mocked(confirm).mockResolvedValue(false);
        render(<MediaSection />);

        await screen.findByText('Brand Sans');
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Brand Sans')).toBeInTheDocument();
    });

    it('shows the read-error state when list() rejects', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        const failing: ResourceRepo = {
            ...repo,
            list: vi.fn().mockRejectedValue(new Error('idb read failed')),
        };
        useStore.setState({ resourceRepo: failing });
        render(<MediaSection />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load media.');
    });

    it('renames a resource through the rename dialog', async () => {
        const repo = await seededRepo();
        useStore.setState({ resourceRepo: repo });
        render(<MediaSection />);

        await screen.findByText('Brand Sans');
        fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!);

        fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Brand Sans Bold' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Brand Sans Bold')).toBeInTheDocument();
        expect(await repo.get('r1')).toMatchObject({ id: 'r1', name: 'Brand Sans Bold' });
    });

    it('badges unused media while a referenced resource stays (W4)', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record('r1', 'image/png', 'Logo'));
        await repo.put(record('r2', 'image/png', 'Old Photo'));

        // One document references `r1` through a local image ref.
        const doc = createFtagSpareDoc({ name: 'Label', now: 1 });
        doc.meta.id = 'd1';
        doc.resources.images = [
            {
                imageId: 'r1',
                name: 'Logo',
                source: { kind: 'local', mediaType: 'image/png', resourceId: 'r1' },
                widthPx: 1,
                heightPx: 1,
            },
        ];
        const labelRepo = {
            list: vi.fn(async () => [{ id: 'd1' }]),
            get: vi.fn(async () => doc),
        } as unknown as LabelRepo;

        useStore.setState({ resourceRepo: repo, labelRepo });
        render(<MediaSection />);

        await screen.findByText('Logo');
        // Exactly one badge: the unreferenced resource.
        expect(screen.getByText('Unused')).toBeInTheDocument();
        expect(await repo.has('r1')).toBe(true);
        expect(await repo.has('r2')).toBe(true);
    });

    it('keeps a shared resource referenced by a normal ref and a reference import (W4)', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record('shared', 'image/png', 'Shared Logo'));
        await repo.put(record('orphan', 'image/png', 'Old Photo'));

        // Doc A references `shared` the normal way: imageId === source.resourceId.
        const docA = createFtagSpareDoc({ name: 'A', now: 1 });
        docA.meta.id = 'd1';
        docA.resources.images = [
            {
                imageId: 'shared',
                name: 'Shared Logo',
                source: { kind: 'local', mediaType: 'image/png', resourceId: 'shared' },
                widthPx: 1,
                heightPx: 1,
            },
        ];

        // Doc B references the same record via a "use existing → reference"
        // import: a document-local imageId pointing at the shared resourceId.
        const docB = createFtagSpareDoc({ name: 'B', now: 2 });
        docB.meta.id = 'd2';
        docB.resources.images = [
            {
                imageId: 'doc-b-local-image',
                name: 'Shared Logo',
                source: { kind: 'local', mediaType: 'image/png', resourceId: 'shared' },
                widthPx: 1,
                heightPx: 1,
            },
        ];

        const docs: Record<string, LabelDoc> = { d1: docA, d2: docB };
        const labelRepo = {
            list: vi.fn(async () => [{ id: 'd1' }, { id: 'd2' }]),
            get: vi.fn(async (id: string) => docs[id]),
        } as unknown as LabelRepo;

        useStore.setState({ resourceRepo: repo, labelRepo });
        vi.mocked(confirm).mockResolvedValue(true);
        render(<MediaSection />);

        await screen.findByText('Shared Logo');
        // Only the genuinely unreferenced resource carries the badge.
        expect(screen.getByText('Unused')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete unused (1)' }));

        await waitFor(() => expect(screen.queryByText('Old Photo')).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({ danger: true, message: expect.stringContaining('1 unused') }),
        );
        // The shared resource survives; only the unreferenced one is gone.
        expect(screen.getByText('Shared Logo')).toBeInTheDocument();
        expect(await repo.has('shared')).toBe(true);
        expect(await repo.has('orphan')).toBe(false);
    });
});
