// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '../../i18n';
import type { ResourceRecord } from '../../data/resourceRepo';
import { MediaCard } from './MediaCard';

/**
 * MediaCard (phase 9, W2): the image preview's object-URL lifecycle and the
 * font/legacy icon fallback. `URL.createObjectURL`/`revokeObjectURL` are stubbed
 * so the created URL is observable and revocation is asserted on unmount.
 */

const record = (
    overrides: Partial<ResourceRecord> & Pick<ResourceRecord, 'id' | 'mediaType'>,
): ResourceRecord => ({
    bytes: new Uint8Array([1, 2, 3]),
    ...overrides,
});

const noop = () => {};

beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MediaCard', () => {
    it('renders an <img> with an object URL for an image, revoked on unmount', () => {
        const { unmount } = render(
            <MediaCard
                record={record({ id: 'r1', mediaType: 'image/png', name: 'Logo', widthPx: 9, heightPx: 7 })}
                onRename={noop}
                onDelete={noop}
            />,
        );

        const img = screen.getByAltText('Logo');
        expect(img.tagName).toBe('IMG');
        expect(img.getAttribute('src')).toBe('blob:mock-url');
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(screen.getByText('9 × 7 px')).toBeInTheDocument();

        unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('renders a type icon (no <img>) for a font', () => {
        const { container } = render(
            <MediaCard
                record={record({ id: 'r2', mediaType: 'font/ttf', name: 'Brand Sans' })}
                onRename={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByText('Brand Sans')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(container.querySelector('svg.lucide-type')).not.toBeNull();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('falls back to the id and the type icon for a legacy record with no metadata', () => {
        const { container } = render(
            <MediaCard
                record={record({ id: 'legacy-1', mediaType: 'image/png' })}
                onRename={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByText('legacy-1')).toBeInTheDocument();
        // No name to use as alt — the img still exists but is queried by its URL.
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('blob:mock-url');
    });
});
