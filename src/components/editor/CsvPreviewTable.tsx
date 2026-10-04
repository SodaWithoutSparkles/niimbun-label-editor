import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

/**
 * Read-only, windowed CSV preview table (P6 W1).
 *
 * Self-contained by contract: no store access, no side effects, no data
 * loading. It renders only the rows inside the visible window (plus `OVERSCAN`
 * either side) and pads the rest with two spacer rows, so a 50k-row table
 * mounts a few dozen `<tr>` at a time. The viewport height comes from the
 * `height` prop rather than a measured `clientHeight`, which keeps the window
 * deterministic and testable under happy-dom (where layout metrics are 0).
 *
 * The fixed `rowHeight` + `<tr style={{ height }}>` is the layout primitive; a
 * real browser honours it because the table is `border-collapse: collapse`.
 */

export interface CsvPreviewTableProps {
    columns: string[];
    rows: string[][];
    /** Row height in px. Invalid/`<= 0` falls back to 24. */
    rowHeight?: number;
    /** Scrollable viewport height in px. Invalid/`<= 0` falls back to 240. */
    height?: number;
    className?: string;
}

/** Rows rendered beyond the viewport, so fast scrolling does not flash blank. */
const OVERSCAN = 8;
const DEFAULT_ROW_HEIGHT = 24;
const DEFAULT_HEIGHT = 240;

const positiveOr = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

export const CsvPreviewTable = ({
    columns,
    rows,
    rowHeight,
    height,
    className,
}: CsvPreviewTableProps) => {
    const { t } = useTranslation();
    const [scrollTop, setScrollTop] = useState(0);

    const lineHeight = positiveOr(rowHeight, DEFAULT_ROW_HEIGHT);
    const viewport = positiveOr(height, DEFAULT_HEIGHT);

    // Clamp the first visible index to the current row set: when `rows` shrinks
    // while the container is scrolled near its old end, `scrollTop` can point
    // past the data, which would otherwise yield an empty window and a huge
    // spacer. Deriving `first` from `rows.length` re-clamps on every render.
    const lastIndex = Math.max(0, rows.length - 1);
    const first = Math.min(Math.floor(scrollTop / lineHeight), lastIndex);
    const visibleCount = Math.ceil(viewport / lineHeight);
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(rows.length, first + visibleCount + OVERSCAN);
    const visible = rows.slice(start, end);
    const topPad = start * lineHeight;
    const bottomPad = (rows.length - end) * lineHeight;
    const colSpan = columns.length + 1;

    return (
        <div
            data-testid="csv-preview"
            className={cn('overflow-auto rounded border border-gray-700 bg-gray-900', className)}
            style={{ height: viewport }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
            <table
                className="w-full border-collapse text-left text-xs text-gray-300"
                aria-label={t('editor.csvPreview.label')}
            >
                <thead className="sticky top-0 z-10 bg-gray-800 text-gray-400">
                    <tr>
                        <th scope="col" className="px-2 py-1 font-medium">
                            #
                        </th>
                        {columns.map((column, index) => (
                            <th
                                key={`${column}-${index}`}
                                scope="col"
                                className="border-l border-gray-700 px-2 py-1 font-medium"
                            >
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {topPad > 0 && (
                        <tr aria-hidden="true" style={{ height: topPad }}>
                            <td colSpan={colSpan} />
                        </tr>
                    )}
                    {visible.map((row, offset) => {
                        const rowIndex = start + offset;
                        return (
                            <tr
                                key={rowIndex}
                                style={{ height: lineHeight }}
                                className="border-t border-gray-800"
                            >
                                <td className="px-2 text-right text-gray-500">{rowIndex + 1}</td>
                                {columns.map((column, columnIndex) => (
                                    <td
                                        key={`${column}-${columnIndex}`}
                                        className="border-l border-gray-800 px-2 whitespace-nowrap"
                                    >
                                        {row[columnIndex] ?? ''}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                    {bottomPad > 0 && (
                        <tr aria-hidden="true" style={{ height: bottomPad }}>
                            <td colSpan={colSpan} />
                        </tr>
                    )}
                    {rows.length === 0 && (
                        <tr>
                            <td
                                colSpan={colSpan}
                                className="px-2 py-3 text-center text-gray-500 italic"
                            >
                                {t('editor.csvPreview.empty')}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};
