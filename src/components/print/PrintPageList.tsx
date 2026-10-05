import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

/**
 * Windowed record list for the print dialog (W4).
 *
 * Reuses the `CsvPreviewTable` windowing math (fixed row height, viewport
 * height from a prop, `OVERSCAN` either side, two spacer blocks) so a 50k-row
 * CSV mounts a few dozen rows at a time (invariant 9). Each row renders the
 * record's thumbnail (once resolved) plus its copy badge.
 *
 * Self-contained by contract: no store access, no data loading. The parent
 * supplies `rows` (active record indices), `urlFor` and `prefetch`; the
 * thumbnail cache lives in `usePrintThumbnails`.
 */

export interface PrintPageListProps {
    /** Active record indices, ascending (zero-copy rows already removed). */
    rows: readonly number[];
    /** Copies for a record (`times × global copies`), for the badge. */
    copiesFor: (rowIndex: number) => number;
    /** Resolved thumbnail data URL, or `undefined` while it renders. */
    urlFor: (rowIndex: number) => string | undefined;
    /** Warm the cache around the visible window. */
    prefetch: (center: number, radius: number) => void;
    /** Row height in px. Invalid/`<= 0` falls back to 64. */
    rowHeight?: number;
    /** Scrollable viewport height in px. Invalid/`<= 0` falls back to 360. */
    height?: number;
    className?: string;
}

/** Rows rendered beyond the viewport, so fast scrolling does not flash blank. */
const OVERSCAN = 8;
const DEFAULT_ROW_HEIGHT = 64;
const DEFAULT_HEIGHT = 360;

const positiveOr = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

export const PrintPageList = ({
    rows,
    copiesFor,
    urlFor,
    prefetch,
    rowHeight,
    height,
    className,
}: PrintPageListProps) => {
    const { t } = useTranslation();
    const [scrollTop, setScrollTop] = useState(0);

    const lineHeight = positiveOr(rowHeight, DEFAULT_ROW_HEIGHT);
    const viewport = positiveOr(height, DEFAULT_HEIGHT);

    // Clamp to the current row set: a shrinking list while scrolled near the old
    // end must not yield an empty window and a huge spacer.
    const lastIndex = Math.max(0, rows.length - 1);
    const first = Math.min(Math.floor(scrollTop / lineHeight), lastIndex);
    const visibleCount = Math.ceil(viewport / lineHeight);
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(rows.length, first + visibleCount + OVERSCAN);
    const visible = rows.slice(start, end);
    const topPad = start * lineHeight;
    const bottomPad = (rows.length - end) * lineHeight;

    // Warm the cache around the visible window whenever it moves. Best-effort:
    // `prefetch` never rejects and sits behind interactive `get`s.
    useEffect(() => {
        if (rows.length === 0) return;
        const centerIndex = Math.min(
            rows.length - 1,
            Math.floor((start + Math.max(start, end - 1)) / 2),
        );
        const center = rows[Math.max(0, centerIndex)];
        if (center === undefined) return;
        prefetch(center, Math.max(1, visibleCount + OVERSCAN));
    }, [rows, start, end, visibleCount, prefetch]);

    return (
        <div
            data-testid="print-page-list"
            className={cn(
                'overflow-auto rounded border border-gray-700 bg-gray-900',
                className,
            )}
            style={{ height: viewport }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            aria-label={t('print.pagesTitle')}
        >
            {topPad > 0 && <div aria-hidden="true" style={{ height: topPad }} />}
            {visible.map((rowIndex) => {
                const url = urlFor(rowIndex);
                const copies = copiesFor(rowIndex);
                return (
                    <div
                        key={rowIndex}
                        data-testid="print-page-row"
                        data-row-index={rowIndex}
                        style={{ height: lineHeight }}
                        className="flex items-center gap-3 border-b border-gray-800 px-2"
                    >
                        <span className="w-10 shrink-0 text-right text-xs text-gray-500">
                            {rowIndex + 1}
                        </span>
                        <div className="flex min-w-0 flex-1 items-center justify-center">
                            {url !== undefined ? (
                                <img
                                    src={url}
                                    alt={t('print.pageAlt', { row: rowIndex + 1 })}
                                    className="max-h-full max-w-full object-contain"
                                />
                            ) : (
                                <span className="text-xs text-gray-500 italic">
                                    {t('print.pagePlaceholder')}
                                </span>
                            )}
                        </div>
                        <span
                            data-testid="print-page-copies"
                            className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300"
                        >
                            {t('print.rowCopies', { copies })}
                        </span>
                    </div>
                );
            })}
            {bottomPad > 0 && <div aria-hidden="true" style={{ height: bottomPad }} />}
            {rows.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-gray-500 italic">
                    {t('print.emptyPages')}
                </p>
            )}
        </div>
    );
};
