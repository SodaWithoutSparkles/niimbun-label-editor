import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { LabelDoc } from '../../core/doc/types';
import {
    renderLabelPage,
    type RenderedLabelPage,
    type RenderLabelPageOptions,
    type RenderNotice,
    type ResolveContext,
} from '../../editor/render';

/**
 * Single-label print preview (W5 / decision D5).
 *
 * The `Page` half of the dialog's `View as` switch: **one** record rendered
 * through the shared path at the **document dpi** (`doc.label.dpi`, passed in
 * via `renderOptions`) and shown large, instead of the queue's ~100 dpi
 * thumbnail list. It deliberately does **not** touch `usePrintThumbnails`: that
 * cache is keyed by `rowIndex` alone and sized for 64 px rows, so a doc-dpi
 * raster must never enter it (R10d).
 *
 * Lifecycle: exactly one render per `(doc, rowIndex, renderOptions)` identity —
 * never one per queue row. The effect latches a `cancelled` flag and drops any
 * late result, so a page step, a doc/override change or a StrictMode
 * setup/cleanup/setup replay can never paint a stale page. The render is gated
 * on `enabled` because `Modal` keeps its children mounted while closed.
 *
 * A `RangeError` from the render (the `MAX_RASTER_PIXELS` pre-flight, or an
 * unusable dpi/offset) is expected input — a too-large label — not a crash: it
 * degrades to a notice and the queue view stays usable.
 */

/** Discrete zoom ladder; `1` is fit-the-viewport. Cheapest clampable readout. */
export const PREVIEW_ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** Default index: ×1, i.e. the whole label fitted into the viewport. */
const DEFAULT_ZOOM_INDEX = 2;

/** Viewport height in px — same as `PrintPageList`'s default, so switching views does not jump. */
const DEFAULT_HEIGHT = 320;

/** Why the page could not be shown. `too-large` is the `RangeError` degradation. */
type PreviewFailure = 'too-large' | 'error';

/**
 * Render signals the dialog folds into its warning centre.
 *
 * `doc` + `key` identify the render the report belongs to, so the dialog can
 * discard a report left over from a superseded doc or override by **value**
 * (never by object identity — a caller may hand over a fresh options/assets
 * object every render without it meaning anything changed).
 */
export interface PrintPreviewReport {
    readonly doc: LabelDoc;
    /** `previewOptionsKey(renderOptions)` of the render this came from. */
    readonly key: string;
    /**
     * Record index this page rendered. Part of the report's identity so a
     * report from a *different* page — same doc, same override values — is
     * discarded instead of lingering after the stepper moves on.
     */
    readonly rowIndex: number;
    readonly policyOverflowCount: number;
    readonly notices: readonly RenderNotice[];
}

/**
 * Content key for the render inputs, mirroring `usePrintThumbnails`'s cache
 * key: only the **values** that change pixels. `assets` is deliberately absent
 * (it is read through a ref), so a fresh-but-equal options object does not
 * restart the doc-dpi render — and therefore cannot make a report loop back
 * into another render.
 */
export const previewOptionsKey = (options: RenderLabelPageOptions): string => {
    const offset = options.offset;
    return [
        options.dpi ?? '-',
        options.invert === true ? 1 : 0,
        options.mirror === true ? 1 : 0,
        offset === undefined ? '-' : `${offset.x},${offset.y},${offset.type}`,
    ].join('|');
};

export interface PrintPagePreviewProps {
    doc: LabelDoc;
    /** The record to render — the selected active row, never the whole queue. */
    rowIndex: number;
    /**
     * Render options built by the dialog, **including `dpi`** (the document
     * dpi). Used as the effect's identity, so it must be memoized by the caller.
     */
    renderOptions: RenderLabelPageOptions;
    /** Per-row async content prep (csv/template). Absent = static/fallback only. */
    prepareRow?: (rowIndex: number) => Promise<ResolveContext>;
    /** Zero-based position of `rowIndex` among `total`, for the stepper. */
    pageIndex: number;
    /** Number of records the stepper walks (the active queue length). */
    total: number;
    onPrev: () => void;
    onNext: () => void;
    /** Palette-overflow / notice signals of the rendered page. */
    onReport?: (report: PrintPreviewReport) => void;
    /** `false` = hold no render (a closed dialog); children stay mounted in `Modal`. */
    enabled?: boolean;
    /** Viewport height in px. Invalid/`<= 0` falls back to 320. */
    height?: number;
    className?: string;
}

const ICON_BUTTON =
    'rounded border border-gray-600 p-1 text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40';

const ToolbarButton = ({
    label,
    disabled,
    onClick,
    children,
}: {
    label: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        className={ICON_BUTTON}
    >
        {children}
    </button>
);

export const PrintPagePreview = ({
    doc,
    rowIndex,
    renderOptions,
    prepareRow,
    pageIndex,
    total,
    onPrev,
    onNext,
    onReport,
    enabled = true,
    height,
    className,
}: PrintPagePreviewProps) => {
    const { t } = useTranslation();
    const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
    const [url, setUrl] = useState<string | undefined>(undefined);
    const [failure, setFailure] = useState<PreviewFailure | null>(null);

    // Latest inputs read by the render effect through refs: a caller handing
    // over a fresh `prepareRow`/`onReport` closure — or a fresh-but-equal
    // `renderOptions`/`assets` object — must not restart the render.
    const prepareRowRef = useRef(prepareRow);
    prepareRowRef.current = prepareRow;
    const onReportRef = useRef(onReport);
    onReportRef.current = onReport;
    const renderOptionsRef = useRef(renderOptions);
    renderOptionsRef.current = renderOptions;

    const optionsKey = previewOptionsKey(renderOptions);

    const viewport = height !== undefined && height > 0 ? height : DEFAULT_HEIGHT;
    const zoom = PREVIEW_ZOOM_STEPS[zoomIndex] ?? 1;
    const atMinZoom = zoomIndex <= 0;
    const atMaxZoom = zoomIndex >= PREVIEW_ZOOM_STEPS.length - 1;

    // One render per (doc, row, options *value*) identity; the latched flag
    // drops any result whose effect generation has been superseded (page step,
    // doc or override change, StrictMode replay, unmount). Keyed by value, not
    // object identity, so a parent re-render cannot re-run the doc-dpi raster.
    useEffect(() => {
        if (!enabled) {
            setUrl(undefined);
            setFailure(null);
            return;
        }
        let cancelled = false;
        setUrl(undefined);
        setFailure(null);
        void (async () => {
            try {
                const options = renderOptionsRef.current;
                const prepare = prepareRowRef.current;
                const ctx = prepare ? await prepare(rowIndex) : {};
                const page: RenderedLabelPage = await renderLabelPage(doc, ctx, options);
                if (cancelled) return;
                if (
                    (page.policyOverflowCount ?? 0) > 0 ||
                    (page.notices !== undefined && page.notices.length > 0)
                ) {
                    onReportRef.current?.({
                        doc,
                        key: optionsKey,
                        rowIndex,
                        policyOverflowCount: page.policyOverflowCount ?? 0,
                        notices: page.notices ?? [],
                    });
                }
                setUrl(page.canvas.toDataURL('image/png'));
            } catch (error) {
                // Expected for an absurd raster (`MAX_RASTER_PIXELS`) or a bad
                // dpi/offset: degrade to a notice. Never an unhandled rejection.
                if (cancelled) return;
                setFailure(error instanceof RangeError ? 'too-large' : 'error');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled, doc, rowIndex, optionsKey]);

    const zoomLabel = t('print.zoomFactor', { zoom });

    return (
        <div
            data-testid="print-page-preview"
            className={cn(
                'flex flex-col overflow-hidden rounded border border-gray-700 bg-gray-900',
                className,
            )}
        >
            <div className="flex items-center justify-between gap-2 border-b border-gray-700 px-2 py-1">
                <ToolbarButton
                    label={t('print.zoomOut')}
                    disabled={atMinZoom}
                    onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
                >
                    <ZoomOut size={16} />
                </ToolbarButton>
                <div className="flex items-center gap-1">
                    <ToolbarButton
                        label={t('print.prevPage')}
                        disabled={pageIndex <= 0}
                        onClick={onPrev}
                    >
                        <ChevronLeft size={16} />
                    </ToolbarButton>
                    <span
                        data-testid="print-page-stepper"
                        className="min-w-16 text-center text-xs tabular-nums text-gray-300"
                    >
                        {t('print.pageOf', { page: pageIndex + 1, total })}
                    </span>
                    <ToolbarButton
                        label={t('print.nextPage')}
                        disabled={pageIndex >= total - 1}
                        onClick={onNext}
                    >
                        <ChevronRight size={16} />
                    </ToolbarButton>
                </div>
                <div className="flex items-center gap-1">
                    <span
                        data-testid="print-zoom-factor"
                        className="text-xs tabular-nums text-gray-400"
                    >
                        {zoomLabel}
                    </span>
                    <ToolbarButton
                        label={t('print.zoomIn')}
                        disabled={atMaxZoom}
                        onClick={() =>
                            setZoomIndex((index) =>
                                Math.min(PREVIEW_ZOOM_STEPS.length - 1, index + 1),
                            )
                        }
                    >
                        <ZoomIn size={16} />
                    </ToolbarButton>
                </div>
            </div>
            <div className="overflow-auto p-2" style={{ height: viewport }}>
                {url !== undefined ? (
                    <img
                        data-testid="print-page-image"
                        src={url}
                        alt={t('print.pageAlt', { row: rowIndex + 1 })}
                        className="block max-w-none object-contain"
                        // ×1 = the image box equals the viewport, so `object-contain`
                        // fits the label; >1 overflows into the scrollbars.
                        style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center">
                        {failure === null ? (
                            <span className="text-xs text-gray-500 italic">
                                {t('print.pagePlaceholder')}
                            </span>
                        ) : (
                            <p
                                data-testid="print-preview-notice"
                                role="status"
                                className="max-w-xs text-center text-xs text-amber-200"
                            >
                                {failure === 'too-large'
                                    ? t('print.previewTooLarge', { dpi: doc.label.dpi })
                                    : t('print.previewRenderError')}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
