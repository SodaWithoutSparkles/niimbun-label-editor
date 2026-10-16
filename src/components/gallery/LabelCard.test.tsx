// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
            />,
        );

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
        // The placeholder (the only `role="img"` svg) is not drawn when a real
        // preview is available. (`querySelector('svg')` alone would match the
        // card's always-present Printer lucide icon.)
        expect(container.querySelector('svg[role="img"]')).toBeNull();
    });

    it('falls back to PlaceholderArt when there is no thumb', () => {
        const { container } = render(<LabelCard summary={summary()} onOpen={noop} />);

        expect(container.querySelector('img')).toBeNull();
        const rect = container.querySelector('svg[role="img"] rect');
        expect(rect).not.toBeNull();
        expect(rect!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    });
});
