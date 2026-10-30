// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { Header } from './Header';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createLabelRepo } from '../../data/labelRepo';
import type { LabelRepo } from '../../data/labelRepo';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';

/**
 * P4 end-to-end: File ▸ Save as preset must persist a COPY through the real
 * (memory-adapter) repo and leave the open document alone. The store-level
 * behaviour is covered in `docSlice.test.ts`; this pins the Header wiring, the
 * success notification and the item's visibility rule.
 */

const fieldNode: Node = {
    id: 'n1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'field', name: 'price', fallback: '$0' },
};

const seedLabel = async (name = 'My label') => {
    const adapter = createMemoryAdapter();
    const repo = createLabelRepo(adapter);
    const doc = createLabelDoc({
        id: 'label-1',
        name,
        now: 1_000_000,
        nodes: [fieldNode],
    });
    await repo.save(doc);
    return { adapter, repo, doc };
};

/** The stored record's `meta` (raw adapter read: no gzip decode needed). */
const storedMeta = async (
    adapter: ReturnType<typeof createMemoryAdapter>,
    id: string,
): Promise<Record<string, unknown> | undefined> => {
    const record = (await adapter.get('labels', id)) as { meta?: Record<string, unknown> } | undefined;
    return record?.meta;
};

const openFileMenu = () => fireEvent.click(screen.getByText('File'));

afterEach(() => {
    cleanup();
    useStore.setState({
        view: 'gallery',
        currentDoc: null,
        labelRepo: null,
        gallery: [],
        galleryLoading: false,
        storageError: false,
        notifications: [],
        isSettingsOpen: false,
    });
});

describe('Header — File ▸ Save as preset (P4)', () => {
    it('persists a preset copy, notifies, and leaves the open doc untouched', async () => {
        const { adapter, repo, doc } = await seedLabel();
        useStore.setState({
            view: 'editor',
            currentDoc: doc,
            labelRepo: repo,
            galleryLoading: false,
            notifications: [],
        });
        const before = structuredClone(doc);

        render(<Header />);
        openFileMenu();
        fireEvent.click(screen.getByText('Save as preset'));

        await vi.waitFor(() => expect(useStore.getState().gallery).toHaveLength(2));

        // The copy is stored as a preset under a fresh id…
        const preset = useStore
            .getState()
            .gallery.find((summary) => summary.id !== doc.meta.id);
        expect(preset).toBeDefined();
        expect(preset!.kind).toBe('preset');
        expect(preset!.name).toBe('My label');

        const stored = await storedMeta(adapter, preset!.id);
        expect(stored).toBeDefined();
        expect(stored!.kind).toBe('preset');
        expect(stored!.id).toBe(preset!.id);
        // A stored record exists for the fresh id (the source keeps its own).
        expect(await storedMeta(adapter, doc.meta.id)).toMatchObject({ id: 'label-1' });

        // The success notification names the new preset record.
        const notifications = useStore.getState().notifications;
        expect(notifications).toHaveLength(1);
        expect(notifications[0]).toMatchObject({
            type: 'success',
            message: 'Saved "My label" as a preset.',
        });

        // The open document is untouched, still open in the editor.
        const current = useStore.getState().currentDoc!;
        expect(current).toBe(doc);
        expect(current.meta.id).toBe('label-1');
        expect(current.meta.kind).toBe('label');
        expect(current).toEqual(before);
        expect(useStore.getState().view).toBe('editor');
    });

    it('notifies an error and leaves the open doc untouched when the preset write fails', async () => {
        const { repo, doc } = await seedLabel();
        // A repo whose write rejects: `saveCopy` contractually turns that into
        // `null`, so the Header must surface the failure notification.
        const failingRepo: LabelRepo = {
            ...repo,
            save: async () => {
                throw new Error('disk full');
            },
        };
        useStore.setState({
            view: 'editor',
            currentDoc: doc,
            galleryLoading: false,
            notifications: [],
        });
        useStore.getState().setLabelRepo(failingRepo);
        const before = structuredClone(doc);

        render(<Header />);
        openFileMenu();
        fireEvent.click(screen.getByText('Save as preset'));

        await vi.waitFor(() => expect(useStore.getState().notifications).toHaveLength(1));

        expect(useStore.getState().notifications[0]).toMatchObject({
            type: 'error',
            message: 'Could not save the preset.',
        });

        // The failed copy never touched the open document or the view.
        const current = useStore.getState().currentDoc!;
        expect(current).toBe(doc);
        expect(current).toEqual(before);
        expect(useStore.getState().view).toBe('editor');

        // No stray write reached the backing store: the seeded label is still
        // the only record, and it never turned into a preset.
        const stored = await repo.list();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ id: 'label-1', kind: 'label' });
    });

    it('does not offer "Save as preset" when the open doc is already a preset', async () => {
        const { repo, doc } = await seedLabel();
        const presetDoc: LabelDoc = { ...doc, meta: { ...doc.meta, kind: 'preset' } };
        useStore.setState({
            view: 'editor',
            currentDoc: presetDoc,
            labelRepo: repo,
            galleryLoading: false,
            notifications: [],
        });

        render(<Header />);
        openFileMenu();

        // The menu is up (Save is visible) but the copy item is absent.
        expect(screen.getByText('Save Label')).toBeInTheDocument();
        expect(screen.queryByText('Save as preset')).toBeNull();
    });
});
