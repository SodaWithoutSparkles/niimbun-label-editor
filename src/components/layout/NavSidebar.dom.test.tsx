// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '../../i18n';
import { NavSidebar } from './NavSidebar';
import { useStore } from '../../store/useStore';

/**
 * P3 partition: the sidebar's Recent list shows ordinary labels only, and the
 * `templates` section (user-facing "Label presets") now has a real pane, so its
 * hint replaces the old "Coming soon" placeholder.
 */

afterEach(() => {
    cleanup();
    useStore.setState({ gallery: [], gallerySection: 'recent', notifications: [] });
});

describe('NavSidebar', () => {
    it('hides presets from the Recent list', () => {
        useStore.setState({
            gallerySection: 'recent',
            gallery: [
                {
                    id: 'label-1',
                    name: 'Ordinary label',
                    createdAt: 0,
                    updatedAt: 100,
                    backingW: 2500,
                    backingH: 7800,
                },
                {
                    id: 'preset-1',
                    name: 'Shipping preset',
                    createdAt: 0,
                    updatedAt: 200,
                    backingW: 2500,
                    backingH: 7800,
                    kind: 'preset',
                },
            ],
        });
        render(<NavSidebar />);

        expect(screen.getByText('Ordinary label')).toBeInTheDocument();
        expect(screen.queryByText('Shipping preset')).not.toBeInTheDocument();
    });

    it('shows the presets hint for the templates section, not "Coming soon"', () => {
        useStore.setState({ gallerySection: 'templates' });
        render(<NavSidebar />);

        expect(screen.getByText('Your label presets appear in the main pane.')).toBeInTheDocument();
        expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    });
});
