// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import type { LabelSummary } from '../../data/labelRepo';
import { LabelCard } from './LabelCard';

/**
 * D-50: the card shows the real preview when `LabelSummary.thumb` (a data URL,
 * resolved by `labelRepo.resolveThumb`) is present, and the geometry
 * `PlaceholderArt` otherwise.
 */

const summary = (overrides: Partial<LabelSummary> = {}): LabelSummary => ({
    id: 'label-1',
    name: 'My label',
    createdAt: 0,
    updatedAt: 0,
    backingW: 2500,
    backingH: 7800,
    ...overrides,
});

const noop = () => {};

afterEach(cleanup);

describe('LabelCard', () => {
    it('renders the thumbnail as an <img> when a thumb is present', () => {
        const { container } = render(
            <LabelCard
                summary={summary({ thumb: 'data:image/png;base64,AAAA' })}
                onOpen={noop}
                onDelete={noop}
            />,
        );

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
        // The placeholder (the white backing outline) is not drawn when a real
        // preview is available.
        expect(container.querySelector('svg rect[fill="#ffffff"][stroke="#9ca3af"]')).toBeNull();
    });

    it('falls back to PlaceholderArt when there is no thumb', () => {
        const { container } = render(
            <LabelCard summary={summary()} onOpen={noop} onDelete={noop} />,
        );

        expect(container.querySelector('img')).toBeNull();
        const rect = container.querySelector('svg rect[fill="#ffffff"][stroke="#9ca3af"]');
        expect(rect).not.toBeNull();
        expect(rect!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
        // Decorative: the card's name (and the open button's aria-label) carries
        // the meaning, so the placeholder must not surface as an unnamed image.
        // `queryByRole` skips `aria-hidden` subtrees, so this pins the outcome in
        // the accessibility tree, not just the attribute.
        expect(rect!.closest('svg')!.getAttribute('aria-hidden')).toBe('true');
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('renders a delete button that calls onDelete with the label id', () => {
        const onDelete = vi.fn();
        render(<LabelCard summary={summary()} onOpen={noop} onDelete={onDelete} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith('label-1');
    });

    it('renders the delete button outside the open button (no nested buttons)', () => {
        render(<LabelCard summary={summary()} onOpen={noop} onDelete={noop} />);

        const deleteButton = screen.getByRole('button', { name: 'Delete' });
        // `closest('button')` is the delete button itself, not a wrapper.
        expect(deleteButton.closest('button')).toBe(deleteButton);
        // The open button contains no nested button.
        const openButton = screen.getByRole('button', { name: 'Open My label' });
        expect(openButton.querySelector('button')).toBeNull();
    });

    it('ships no Quick print control (removed in P3; fill & print arrives in P5)', () => {
        render(<LabelCard summary={summary()} onOpen={noop} onDelete={noop} />);

        // A hard-disabled "coming later" button was a dead control; P3 removes
        // it rather than leaving it on every ordinary label card.
        expect(screen.queryByText('Quick print')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Quick print' })).not.toBeInTheDocument();
        expect(screen.queryByTitle('Printing is not available yet')).not.toBeInTheDocument();
        // The two real actions survive: open (the art block) and delete.
        expect(screen.getByRole('button', { name: 'Open My label' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
});
