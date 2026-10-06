// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { PrintPageList } from './PrintPageList';

afterEach(cleanup);

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

const rowIndices = (): number[] =>
    screen
        .getAllByTestId('print-page-row')
        .map((element) => Number(element.getAttribute('data-row-index')));

describe('PrintPageList — windowing', () => {
    it('renders only the visible slice of a large record list', () => {
        const prefetch = vi.fn();
        render(
            <PrintPageList
                rows={range(1000)}
                copiesFor={() => 1}
                urlFor={() => undefined}
                prefetch={prefetch}
                rowHeight={20}
                height={100}
            />,
        );

        // viewport 100px / 20px = 5 visible + 8 overscan = records 0..12.
        expect(rowIndices()).toEqual(range(13));
        expect(screen.queryByText('1000')).not.toBeInTheDocument();
    });

    it('moves the window when the container scrolls', () => {
        render(
            <PrintPageList
                rows={range(1000)}
                copiesFor={() => 1}
                urlFor={() => undefined}
                prefetch={vi.fn()}
                rowHeight={20}
                height={100}
            />,
        );

        const viewport = screen.getByTestId('print-page-list');
        viewport.scrollTop = 2000;
        fireEvent.scroll(viewport);

        // floor(2000/20) = 100, minus 8 overscan = start 92; end 113.
        const indices = rowIndices();
        expect(indices[0]).toBe(92);
        expect(indices.at(-1)).toBe(112);
        expect(indices).not.toContain(0);
    });

    it('prefetches a window around the visible records', () => {
        const prefetch = vi.fn();
        render(
            <PrintPageList
                rows={range(1000)}
                copiesFor={() => 1}
                urlFor={() => undefined}
                prefetch={prefetch}
                rowHeight={20}
                height={100}
            />,
        );

        expect(prefetch).toHaveBeenCalled();
        const [center, radius] = prefetch.mock.calls.at(-1)!;
        // start 0, end 13 → centre index 6; radius covers the visible window.
        expect(center).toBe(6);
        expect(radius).toBeGreaterThan(0);
    });

    it('shows the per-record copy badge and an empty state', () => {
        const { rerender } = render(
            <PrintPageList
                rows={[0, 1]}
                copiesFor={(rowIndex) => (rowIndex === 0 ? 3 : 1)}
                urlFor={() => undefined}
                prefetch={vi.fn()}
                height={200}
            />,
        );

        const badges = screen.getAllByTestId('print-page-copies');
        expect(badges[0]).toHaveTextContent('×3');
        expect(badges[1]).toHaveTextContent('×1');

        rerender(
            <PrintPageList
                rows={[]}
                copiesFor={() => 1}
                urlFor={() => undefined}
                prefetch={vi.fn()}
                height={200}
            />,
        );
        expect(screen.getByText('No rows to print.')).toBeInTheDocument();
    });
});
