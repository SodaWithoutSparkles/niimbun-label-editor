import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { CsvPreviewTable } from './CsvPreviewTable';

const makeRows = (count: number): string[][] =>
    Array.from({ length: count }, (_, index) => [`r${index}`, `c${index}`]);

afterEach(cleanup);

describe('CsvPreviewTable — windowing', () => {
    it('renders only the visible window of a large table', () => {
        render(
            <CsvPreviewTable
                columns={['a', 'b']}
                rows={makeRows(1000)}
                rowHeight={20}
                height={100}
            />,
        );

        // viewport 100px / 20px = 5 visible + 8 overscan = rows 0..12.
        expect(screen.getByText('r0')).toBeInTheDocument();
        expect(screen.getByText('r12')).toBeInTheDocument();
        expect(screen.queryByText('r13')).not.toBeInTheDocument();
        expect(screen.queryByText('r999')).not.toBeInTheDocument();
    });

    it('moves the window when the container scrolls', () => {
        render(
            <CsvPreviewTable
                columns={['a', 'b']}
                rows={makeRows(1000)}
                rowHeight={20}
                height={100}
            />,
        );

        const viewport = screen.getByTestId('csv-preview');
        viewport.scrollTop = 2000;
        fireEvent.scroll(viewport);

        // floor(2000/20) = 100, minus 8 overscan = start 92; end 113.
        expect(screen.getByText('r92')).toBeInTheDocument();
        expect(screen.getByText('r112')).toBeInTheDocument();
        expect(screen.queryByText('r91')).not.toBeInTheDocument();
        expect(screen.queryByText('r0')).not.toBeInTheDocument();
    });

    it('shows the localized empty state and no data rows for an empty table', () => {
        render(<CsvPreviewTable columns={['a', 'b']} rows={[]} />);

        expect(screen.getByText('No rows')).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'CSV preview' })).toBeInTheDocument();
    });

    it('falls back to defaults for an invalid row height', () => {
        render(<CsvPreviewTable columns={['a']} rows={makeRows(10)} rowHeight={0} height={0} />);

        expect(screen.getByText('r0')).toBeInTheDocument();
        expect(screen.getByText('r9')).toBeInTheDocument();
    });

    it('re-clamps the window when rows shrink while scrolled near the end', () => {
        const { rerender } = render(
            <CsvPreviewTable
                columns={['a', 'b']}
                rows={makeRows(1000)}
                rowHeight={20}
                height={100}
            />,
        );

        const viewport = screen.getByTestId('csv-preview');
        viewport.scrollTop = 20_000; // past the end of a 1000-row table
        fireEvent.scroll(viewport);

        rerender(
            <CsvPreviewTable columns={['a', 'b']} rows={makeRows(5)} rowHeight={20} height={100} />,
        );

        // Window clamps to rows 0..4 — no empty window and no oversized spacer.
        expect(screen.getByText('r0')).toBeInTheDocument();
        expect(screen.getByText('r4')).toBeInTheDocument();
        expect(screen.queryByText('r5')).not.toBeInTheDocument();
        // header + 5 data rows, no spacer/empty rows.
        expect(screen.getAllByRole('row')).toHaveLength(6);
    });
});
