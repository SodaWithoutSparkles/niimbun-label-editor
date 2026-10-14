// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../../i18n';
import { CreateLabelDialog } from './CreateLabelDialog';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo } from '../../data/labelRepo';
import { createPaperRepo } from '../../data/paperRepo';
import { paperSeedRecords } from '../../data/paperSeeds';
import { StreamReadingResponse } from '../../test/streamResponse';

/**
 * Same platform-gap adaptation as `src/data/labelRepo.test.ts`: the test
 * runtime's `DecompressionStream` writes into Node's `zlib`, which rejects a
 * raw `ArrayBuffer` and only accepts a view, and happy-dom's `Response` cannot
 * read a compression readable. The repo read path is adapted here; production
 * code is untouched.
 */
const NativeDecompressionStream = globalThis.DecompressionStream;

class ArrayBufferTolerantDecompressionStream extends NativeDecompressionStream {
    constructor(format: CompressionFormat = 'gzip') {
        super(format);
        const writable = this.writable;
        const getWriter = writable.getWriter.bind(writable);
        Object.defineProperty(writable, 'getWriter', {
            configurable: true,
            value: () => {
                const writer = getWriter();
                const write = writer.write.bind(writer);
                Object.defineProperty(writer, 'write', {
                    configurable: true,
                    value: (chunk: BufferSource) =>
                        write(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk),
                });
                return writer;
            },
        });
    }
}

const realCreateLabel = useStore.getState().createLabel;

const resetStore = () => {
    useStore.setState({
        gallery: [],
        galleryLoading: false,
        storageError: false,
        labelRepo: null,
        paperRepo: null,
        defaultPaperTypeId: undefined,
        createLabel: realCreateLabel,
        notifications: [],
        view: 'gallery',
    });
};

/** Renders the dialog and waits for the async paper-catalogue resolve. */
const renderReady = async (onClose: () => void) => {
    render(<CreateLabelDialog open onClose={onClose} />);
    const createButton = screen.getByRole('button', { name: 'Create' });
    // While the catalogue loads the Create button is disabled; wait for it.
    await waitFor(() => expect(createButton).toBeEnabled());
    return createButton;
};

/** A label repo + a paper repo (seeded with the built-in catalogue) over one adapter. */
const seededRepos = async () => {
    const adapter = createMemoryAdapter();
    const paperRepo = createPaperRepo(adapter);
    await paperRepo.saveAll(paperSeedRecords());
    return { adapter, paperRepo };
};

beforeEach(() => {
    vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
    vi.stubGlobal('Response', StreamReadingResponse);
});

afterEach(() => {
    cleanup();
    resetStore();
});

describe('CreateLabelDialog — paper-type catalogue', () => {
    it('seeds the default paper type and persists its geometry + guides', async () => {
        const { adapter, paperRepo } = await seededRepos();
        useStore.setState({
            labelRepo: createLabelRepo(adapter),
            paperRepo,
            defaultPaperTypeId: 'ftagSpare-25x78',
        });
        const onClose = vi.fn();
        const createButton = await renderReady(onClose);

        // The name is seeded from the record.
        expect(screen.getByRole('textbox')).toHaveValue('F-tag spare 25×78');

        fireEvent.click(createButton);

        await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const gallery = useStore.getState().gallery;
        expect(gallery).toHaveLength(1);
        expect(gallery[0].name).toBe('F-tag spare 25×78');

        const stored = await useStore.getState().labelRepo!.get(gallery[0].id);
        expect(stored).not.toBeNull();
        expect(stored!.meta.paperTypeId).toBe('ftagSpare-25x78');
        expect(stored!.label.backingW).toBe(2500);
        expect(stored!.label.backingH).toBe(7800);
        // The F-tag score line survives label creation.
        expect(stored!.label.guides).toEqual([
            { id: 'ftag-spare-score', kind: 'score', line: { x1: 1250, y1: 0, x2: 1250, y2: 3800 } },
        ]);
    });

    it('falls back to custom geometry when the default paper type is deleted/dangling', async () => {
        const { adapter, paperRepo } = await seededRepos();
        useStore.setState({
            labelRepo: createLabelRepo(adapter),
            paperRepo,
            defaultPaperTypeId: 'gone',
        });
        const onClose = vi.fn();
        const createButton = await renderReady(onClose);

        // No record resolves → blank custom geometry (40×30 mm), empty name.
        expect(screen.getByRole('textbox')).toHaveValue('');

        fireEvent.click(createButton);

        await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const stored = await useStore.getState().labelRepo!.get(useStore.getState().gallery[0].id);
        expect(stored).not.toBeNull();
        expect(stored!.meta.paperTypeId).toBeUndefined();
        expect(stored!.label.backingW).toBe(4000);
        expect(stored!.label.backingH).toBe(3000);
        expect(stored!.label.guides).toEqual([]);
    });

    it('seeds geometry and guides when a different catalogue record is selected', async () => {
        const { adapter, paperRepo } = await seededRepos();
        useStore.setState({
            labelRepo: createLabelRepo(adapter),
            paperRepo,
            defaultPaperTypeId: 'ftagSpare-25x78',
        });
        const onClose = vi.fn();
        const createButton = await renderReady(onClose);

        // The shared `RegionEditor` adds one kind-select per region, so target the
        // paper-type picker by name rather than the only combobox.
        fireEvent.change(screen.getByRole('combobox', { name: 'Paper type' }), {
            target: { value: 'rounded30x20' },
        });
        expect(screen.getByRole('textbox')).toHaveValue('Rounded 30×20 (r 2)');

        fireEvent.click(createButton);

        await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const stored = await useStore.getState().labelRepo!.get(useStore.getState().gallery[0].id);
        expect(stored).not.toBeNull();
        expect(stored!.meta.paperTypeId).toBe('rounded30x20');
        expect(stored!.label.backingW).toBe(3000);
        expect(stored!.label.backingH).toBe(2000);
        expect(stored!.label.guides).toEqual([]);
        expect(stored!.label.regions).toEqual([{ kind: 'roundedRect', x: 0, y: 0, w: 3000, h: 2000, r: 200 }]);
    });
});

describe('CreateLabelDialog — submit robustness', () => {
    it('releases `saving` and shows a visible error when createLabel rejects', async () => {
        // Force the exact failure the old code left silent: the awaited store
        // action rejects. The dialog must not strand its disabled/spinner state.
        const { adapter, paperRepo } = await seededRepos();
        useStore.setState({
            labelRepo: createLabelRepo(adapter),
            paperRepo,
            createLabel: async () => {
                throw new Error('unexpected store rejection');
            },
        });
        const onClose = vi.fn();
        const createButton = await renderReady(onClose);

        fireEvent.click(createButton);

        // `saving` released → the button is interactive again.
        await vi.waitFor(() => expect(createButton).toBeEnabled());
        // Failure is visible, not a silent stuck dialog.
        expect(await screen.findByText('Failed to save label')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a visible error when the repo save fails (createLabel yields null)', async () => {
        const { adapter, paperRepo } = await seededRepos();
        const repo = createLabelRepo(adapter);
        vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('idb transaction aborted'));
        useStore.setState({ labelRepo: repo, paperRepo });
        const onClose = vi.fn();
        const createButton = await renderReady(onClose);

        fireEvent.click(createButton);

        await vi.waitFor(() => expect(createButton).toBeEnabled());
        expect(await screen.findByText('Failed to save label')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
