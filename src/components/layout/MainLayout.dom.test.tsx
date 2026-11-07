// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '../../i18n';
import { MainLayout } from './MainLayout';
import { useStore } from '../../store/useStore';

/**
 * P3 routing: the sidebar section id is `templates`, and it must swap the main
 * pane to the Label presets surface. `recent` still renders the label grid.
 *
 * The chrome (`Header`, `NavSidebar`) and the editor shell are stubbed so this
 * test only pins the section → pane mapping; the real panes are rendered.
 */

vi.mock('./Header', () => ({ Header: () => <header /> }));
vi.mock('./NavSidebar', () => ({ NavSidebar: () => <nav /> }));
vi.mock('../editor/EditorShell', () => ({ EditorShell: () => <div /> }));

const originalInitPersistence = useStore.getState().initPersistence;

beforeEach(() => {
    // The shell boots persistence on mount; stub it so the routing test does
    // not race an async gallery refresh (and never touches IndexedDB).
    useStore.setState({
        view: 'gallery',
        gallerySection: 'recent',
        gallery: [],
        galleryLoading: false,
        storageError: false,
        labelRepo: null,
        initPersistence: () => Promise.resolve(),
    });
});

afterEach(() => {
    cleanup();
    useStore.setState({
        initPersistence: originalInitPersistence,
        gallerySection: 'recent',
        notifications: [],
    });
});

describe('MainLayout gallery panes', () => {
    it('renders the label presets pane for gallerySection "templates"', async () => {
        useStore.setState({ gallerySection: 'templates' });
        render(<MainLayout />);

        expect(await screen.findByRole('heading', { name: 'Label presets' })).toBeInTheDocument();
        expect(await screen.findByText('No presets yet')).toBeInTheDocument();
    });

    it('still renders the labels grid for gallerySection "recent"', async () => {
        render(<MainLayout />);

        expect(await screen.findByText('No labels yet')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Label presets' })).not.toBeInTheDocument();
    });
});
