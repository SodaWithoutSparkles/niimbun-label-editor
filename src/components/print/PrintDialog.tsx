import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabelType, PageColorType } from '@mmote/niimbluelib';
import { Modal } from '../common/dialogs/Modal';
import { Input, Select, SettingRow, Toggle } from '../common/forms';
import { rasterDimensions } from '../../core/render';
import type { LabelDoc } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import {
    renderLabelPage,
    type AssetDeps,
    type RenderLabelPageOptions,
    type ResolveContext,
} from '../../editor/render';
import {
    hasInkBeyondPrinthead,
    printheadOverflow,
    type LabelPrintDirection,
} from '../../editor/render/printOrientation';
import { planSequence, type PrintOrder } from '../../print/sequence';
import { buildCsvPrintJob, renderOptionsOf, type PrintOverrides } from '../../print/printLabel';
import type { JobProgress, JobRunner } from '../../print/jobRunner';
import type { PrinterStatus } from '../../print/transport';
import { useStore } from '../../store/useStore';
import type { EditorWarning } from '../../editor/warnings';
import { usePrintThumbnails, type PrintThumbnailOverrides } from './usePrintThumbnails';
import { PrintPageList } from './PrintPageList';
import {
    activeRecords,
    rollDpiMismatch,
    rowCountOf,
    timesForCsv,
} from './printDialogModel';

/**
 * Print dialog (P7 W4).
 *
 * `Modal`-based batch-print surface: a virtualized record list with ~50 dpi
 * thumbnails, a capability-gated override panel, non-blocking warnings and a
 * monotonic progress bar. The print job itself comes from the shared pipeline
 * (`buildCsvPrintJob` → `planSequence` → `renderLabelPage`/`orientForPrint`,
 * invariant 7); this component only collects options and drives a
 * {@link JobRunner}.
 *
 * Content arrives through `prepareRow` (decision 42): this component never
 * imports the template engine or the trust gate.
 */

export interface PrintDialogProps {
    open: boolean;
    onClose: () => void;
    doc: LabelDoc;
    csv: CsvRecord | null;
    prepareRow?: (rowIndex: number) => Promise<ResolveContext>;
    assets?: AssetDeps;
    /** `createJobRunner(transport)` — one active job (W5 wires it). */
    runner: JobRunner;
    /** Capabilities + reported roll size/dpi gate the controls and warnings. */
    printerStatus: PrinterStatus;
    /**
     * Store-agnostic print-direction setter (D-30): the select reports the chosen
     * `doc.label.printDirection` and `EditorShell`/the dev harness persists it.
     * Omitted = the control still renders (read-only value) but does nothing.
     */
    onPrintDirectionChange?: (direction: LabelPrintDirection) => void;
}

type Outcome =
    | { kind: 'success'; pagesPrinted: number }
    | { kind: 'cancelled'; pagesPrinted: number }
    | { kind: 'error'; message: string };

/** All selectable paper types; ones absent from `paperTypes` are marked, not blocked. */
const LABEL_TYPE_OPTIONS = [
    { value: LabelType.WithGaps, key: 'print.labelTypeNames.withGaps' },
    { value: LabelType.Black, key: 'print.labelTypeNames.black' },
    { value: LabelType.Continuous, key: 'print.labelTypeNames.continuous' },
    { value: LabelType.Perforated, key: 'print.labelTypeNames.perforated' },
    { value: LabelType.Transparent, key: 'print.labelTypeNames.transparent' },
    { value: LabelType.PvcTag, key: 'print.labelTypeNames.pvcTag' },
    { value: LabelType.BlackMarkGap, key: 'print.labelTypeNames.blackMarkGap' },
    { value: LabelType.HeatShrinkTube, key: 'print.labelTypeNames.heatShrinkTube' },
] as const;

const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export const PrintDialog: React.FC<PrintDialogProps> = ({
    open,
    onClose,
    doc,
    csv,
    prepareRow,
    assets,
    runner,
    printerStatus,
    onPrintDirectionChange,
}) => {
    const { t } = useTranslation();
    const setEditorWarnings = useStore((state) => state.setEditorWarnings);
    const clearEditorWarnings = useStore((state) => state.clearEditorWarnings);
    const capabilities = printerStatus.capabilities;

    const [order, setOrder] = useState<PrintOrder>('grouped');
    const [copies, setCopies] = useState(1);
    const [density, setDensity] = useState<number | undefined>(undefined);
    const [speed, setSpeed] = useState<0 | 1>(0);
    const [labelType, setLabelType] = useState<LabelType | undefined>(undefined);
    const [invert, setInvert] = useState(false);
    const [mirror, setMirror] = useState(false);
    const [offsetX, setOffsetX] = useState('0');
    const [offsetY, setOffsetY] = useState('0');
    const [offsetType, setOffsetType] = useState<'inner' | 'outer'>('inner');
    const [progress, setProgress] = useState<JobProgress | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [busy, setBusy] = useState(false);

    // Fresh form each time the dialog opens; never carry a previous job's
    // overrides or outcome into a new one.
    useEffect(() => {
        if (!open) return;
        setOrder('grouped');
        setCopies(1);
        setDensity(undefined);
        setSpeed(0);
        setLabelType(undefined);
        setInvert(false);
        setMirror(false);
        setOffsetX('0');
        setOffsetY('0');
        setOffsetType('inner');
        setProgress(null);
        setOutcome(null);
        setBusy(false);
    }, [open]);

    const rows = rowCountOf(csv);
    const timesFor = useMemo(() => timesForCsv(csv), [csv]);
    const activeRows = useMemo(
        () => activeRecords(rows, timesFor, copies),
        [rows, timesFor, copies],
    );

    const plan = useMemo(() => {
        try {
            return planSequence(rows, timesFor, { order, copies });
        } catch {
            // An absurd total ($times) must not crash the dialog; Print stays off.
            return null;
        }
    }, [rows, timesFor, order, copies]);

    const dims = useMemo(
        () =>
            rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi),
        [doc.label.backingW, doc.label.backingH, doc.label.dpi],
    );
    const orientedWidthPx =
        doc.label.printDirection === 'left' || doc.label.printDirection === 'right'
            ? dims.heightPx
            : dims.widthPx;
    const overflows = printheadOverflow(
        dims.widthPx,
        dims.heightPx,
        doc.label.printDirection,
        capabilities?.printheadPixels,
    );
    const mismatch = rollDpiMismatch(doc, printerStatus);

    const densityMin = capabilities?.densityMin;
    const densityMax = capabilities?.densityMax;
    const densityEnabled = densityMin !== undefined && densityMax !== undefined;
    const densityBoundsMin = densityMin ?? 1;
    const densityBoundsMax = densityMax ?? 5;
    const densityValue = Math.min(
        densityBoundsMax,
        Math.max(densityBoundsMin, density ?? capabilities?.densityDefault ?? densityBoundsMin),
    );
    const speedEnabled = capabilities?.supportsSpeed === true;
    const labelTypeEnabled = capabilities !== undefined;
    const paperTypes = capabilities?.paperTypes;
    const effectiveLabelType = labelType ?? LabelType.WithGaps;

    const parsedOffset = useMemo(() => {
        const x = Number.parseInt(offsetX, 10);
        const y = Number.parseInt(offsetY, 10);
        if (!Number.isInteger(x) || !Number.isInteger(y) || (x === 0 && y === 0)) {
            return undefined;
        }
        return { x, y, type: offsetType };
    }, [offsetX, offsetY, offsetType]);

    const thumbnailOverrides = useMemo<PrintThumbnailOverrides>(
        () => ({
            ...(invert ? { invert: true } : {}),
            ...(mirror ? { mirror: true } : {}),
            ...(parsedOffset ? { offset: parsedOffset } : {}),
        }),
        [invert, mirror, parsedOffset],
    );

    const { urlFor, prefetch, notices, policyOverflowCount } = usePrintThumbnails({
        doc,
        csv,
        prepareRow,
        assets,
        overrides: thumbnailOverrides,
        enabled: open,
    });

    const printOverrides = useMemo<PrintOverrides>(
        () => ({
            ...(densityEnabled ? { density: densityValue } : {}),
            ...(speedEnabled ? { speed } : {}),
            ...(labelTypeEnabled ? { labelType: effectiveLabelType } : {}),
            // v1 prints single-colour only (spike: B1_PRO supports Single|Double).
            pageColor: PageColorType.SingleColor,
            ...(invert ? { invert: true } : {}),
            ...(mirror ? { mirror: true } : {}),
            ...(parsedOffset ? { offset: parsedOffset } : {}),
        }),
        [
            densityEnabled,
            densityValue,
            speedEnabled,
            speed,
            labelTypeEnabled,
            effectiveLabelType,
            invert,
            mirror,
            parsedOffset,
        ],
    );

    // D-31: `printheadOverflow` above is only the cheap **size** trigger. A blank
    // over-width label must not warn, so once it trips we lazily render the page
    // at the document dpi through the shared path (invariant 7) and warn only if
    // ink actually lands past the head. `renderOptionsOf` applies the *identical*
    // override split the print job uses, so the sample matches what would print.
    //
    // The sample uses the **first active record's** `prepareRow` context. CSV
    // content is per-row, so a later row with narrower ink can only over-warn
    // (never miss a clip), which is acceptable for a non-blocking warning. The
    // check is recomputed only while the size check trips (and the dialog is
    // open); the effect re-runs on the doc + override values.
    const inkRenderOptions = useMemo<RenderLabelPageOptions>(
        () => renderOptionsOf(printOverrides, assets),
        [printOverrides, assets],
    );
    const firstActiveRowIndex = activeRows[0];
    const [inkOverflow, setInkOverflow] = useState(false);

    useEffect(() => {
        if (!open || !overflows || firstActiveRowIndex === undefined) {
            setInkOverflow(false);
            return;
        }
        // Clear the previous verdict: while the new async render is in flight a
        // stale "may be clipped" warning must not linger.
        setInkOverflow(false);
        let cancelled = false;
        void (async () => {
            try {
                const ctx = prepareRow ? await prepareRow(firstActiveRowIndex) : {};
                const page = await renderLabelPage(doc, ctx, inkRenderOptions);
                if (!cancelled) {
                    setInkOverflow(
                        hasInkBeyondPrinthead(
                            page,
                            doc.label.printDirection,
                            capabilities?.printheadPixels,
                        ),
                    );
                }
            } catch {
                // A render failure must never leave a stale warning up.
                if (!cancelled) setInkOverflow(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        open,
        overflows,
        firstActiveRowIndex,
        prepareRow,
        doc,
        inkRenderOptions,
        capabilities?.printheadPixels,
    ]);

    const showOverflow = overflows && inkOverflow;
    const mirrorLostPx = notices.reduce(
        (sum, notice) => (notice.kind === 'mirror-clipped-ink' ? sum + notice.lostPx : sum),
        0,
    );
    useEffect(() => {
        if (!open) {
            clearEditorWarnings('print');
            return;
        }
        const warnings: EditorWarning[] = [];
        if (showOverflow && capabilities?.printheadPixels !== undefined) {
            warnings.push({ id: 'print:overflow', kind: 'print-overflow', width: orientedWidthPx, head: capabilities.printheadPixels });
        }
        if (plan?.warning) warnings.push({ id: 'print:interleaved', kind: 'print-interleaved', pages: plan.warning.pages, cap: plan.warning.cap });
        if (mismatch) warnings.push({ id: 'print:mismatch', kind: 'print-mismatch', labelW: mismatch.labelW, labelH: mismatch.labelH, labelDpi: mismatch.labelDpi });
        if (policyOverflowCount > 0) warnings.push({ id: 'print:policy-overflow', kind: 'print-policy-overflow', count: policyOverflowCount });
        if (notices.length > 0) warnings.push({ id: 'print:mirror-clipped', kind: 'print-mirror-clipped', pixels: mirrorLostPx });
        setEditorWarnings('print', { docId: doc.meta.id, warnings });
        return () => setEditorWarnings('print', null);
    }, [open, showOverflow, capabilities?.printheadPixels, orientedWidthPx, plan?.warning, mismatch, policyOverflowCount, notices, mirrorLostPx, doc.meta.id, setEditorWarnings]);

    const handleProgress = (next: JobProgress): void => {
        setProgress((previous) => ({
            ...next,
            percent: Math.max(previous?.percent ?? 0, next.percent),
        }));
    };

    const handlePrint = async (): Promise<void> => {
        if (busy || runner.isBusy()) return;
        setBusy(true);
        setOutcome(null);
        setProgress({
            page: 0,
            pagesTotal: plan?.totalPages ?? 0,
            percent: 0,
            phase: 'sending',
        });
        try {
            const job = buildCsvPrintJob(
                doc,
                csv,
                { order, copies, overrides: printOverrides },
                { prepareRow, assets },
            );
            const result = await runner.run(job, { onProgress: handleProgress });
            setOutcome(
                result.cancelled
                    ? { kind: 'cancelled', pagesPrinted: result.pagesPrinted }
                    : { kind: 'success', pagesPrinted: result.pagesPrinted },
            );
        } catch (error) {
            setOutcome({ kind: 'error', message: messageOf(error) });
        } finally {
            setBusy(false);
        }
    };

    const labelTypeOptions = LABEL_TYPE_OPTIONS.map((option) => {
        const name = t(option.key);
        const supported = paperTypes === undefined || paperTypes.includes(option.value);
        return {
            value: String(option.value),
            label: supported ? name : t('print.labelTypeUnsupported', { name }),
        };
    });

    const printDisabled = busy || runner.isBusy() || plan === null || plan.totalPages === 0;
    const hasWarnings =
        showOverflow ||
        plan?.warning !== undefined ||
        mismatch !== undefined ||
        notices.length > 0 ||
        policyOverflowCount > 0;

    const outcomeText = (value: Outcome): string => {
        if (value.kind === 'success') {
            return t('print.outcome.success', { pages: value.pagesPrinted });
        }
        if (value.kind === 'cancelled') {
            return t('print.outcome.cancelled', { pages: value.pagesPrinted });
        }
        return t('print.outcome.error', { message: value.message });
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            closeDisabled={busy}
            title={t('print.title')}
            size="xl"
            className="max-w-none w-[75vw]"
            footer={
                <>
                    {outcome && (
                        <span
                            role="status"
                            data-testid="print-outcome"
                            className="mr-auto text-xs text-gray-400"
                        >
                            {outcomeText(outcome)}
                        </span>
                    )}
                    {busy && (
                        <button
                            type="button"
                            onClick={() => runner.cancel()}
                            className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
                        >
                            {t('print.cancel')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                    >
                        {t('print.close')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handlePrint()}
                        disabled={printDisabled}
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                        {t('print.action')}
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                    <section className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-gray-200">
                                {t('print.pagesTitle')}
                            </h3>
                            <span className="text-xs text-gray-400">
                                {plan === null
                                    ? t('print.planError')
                                    : t('print.totalPages', { pages: plan.totalPages })}
                            </span>
                        </div>
                        <SettingRow label={t('print.order')}>
                            <Select
                                value={order}
                                onChange={(value) =>
                                    setOrder(value === 'interleaved' ? 'interleaved' : 'grouped')
                                }
                                options={[
                                    { value: 'grouped', label: t('print.orderGrouped') },
                                    {
                                        value: 'interleaved',
                                        label: t('print.orderInterleaved'),
                                    },
                                ]}
                                className="w-40"
                                aria-label={t('print.order')}
                            />
                        </SettingRow>
                        <PrintPageList
                            rows={activeRows}
                            copiesFor={(rowIndex) => timesFor(rowIndex) * copies}
                            urlFor={urlFor}
                            prefetch={prefetch}
                            height={320}
                        />
                    </section>

                    <section className="space-y-1">
                        <h3 className="text-sm font-semibold text-gray-200">
                            {t('print.overridesTitle')}
                        </h3>
                        <SettingRow label={t('print.copies')}>
                            <Input
                                type="number"
                                min={1}
                                value={String(copies)}
                                onChange={(value) =>
                                    setCopies(Math.max(1, Math.floor(Number(value) || 1)))
                                }
                                className="w-20"
                                aria-label={t('print.copies')}
                            />
                        </SettingRow>
                        <SettingRow label={t('print.density')}>
                            <input
                                type="range"
                                min={densityBoundsMin}
                                max={densityBoundsMax}
                                value={densityValue}
                                disabled={!densityEnabled}
                                onChange={(event) => setDensity(Number(event.target.value))}
                                className="w-40 accent-blue-500 disabled:opacity-50"
                                aria-label={t('print.density')}
                            />
                        </SettingRow>
                        {speedEnabled && (
                            <SettingRow label={t('print.speed')}>
                                <Select
                                    value={String(speed)}
                                    onChange={(value) => setSpeed(value === '1' ? 1 : 0)}
                                    options={[
                                        { value: '0', label: t('print.speedOptions.quality') },
                                        { value: '1', label: t('print.speedOptions.normal') },
                                    ]}
                                    className="w-32"
                                    aria-label={t('print.speed')}
                                />
                            </SettingRow>
                        )}
                        <SettingRow label={t('print.labelType')}>
                            <Select
                                value={String(effectiveLabelType)}
                                onChange={(value) =>
                                    setLabelType(Number(value) as LabelType)
                                }
                                options={labelTypeOptions}
                                disabled={!labelTypeEnabled}
                                className="w-44"
                                aria-label={t('print.labelType')}
                            />
                        </SettingRow>
                        <SettingRow label={t('print.printDirection')}>
                            <Select
                                value={doc.label.printDirection}
                                onChange={(value) => {
                                    if (
                                        value === 'top' ||
                                        value === 'left' ||
                                        value === 'bottom' ||
                                        value === 'right'
                                    ) {
                                        onPrintDirectionChange?.(value);
                                    }
                                }}
                                options={[
                                    { value: 'top', label: t('print.printDirectionOptions.top') },
                                    { value: 'left', label: t('print.printDirectionOptions.left') },
                                    {
                                        value: 'bottom',
                                        label: t('print.printDirectionOptions.bottom'),
                                    },
                                    {
                                        value: 'right',
                                        label: t('print.printDirectionOptions.right'),
                                    },
                                ]}
                                className="w-36"
                                aria-label={t('print.printDirection')}
                            />
                        </SettingRow>
                        <SettingRow label={t('print.pageColor')}>
                            <Select
                                value="single"
                                onChange={() => undefined}
                                options={[
                                    { value: 'single', label: t('print.pageColorSingle') },
                                ]}
                                className="w-32"
                                aria-label={t('print.pageColor')}
                            />
                        </SettingRow>
                        <SettingRow label={t('print.invert')}>
                            <Toggle
                                checked={invert}
                                onChange={setInvert}
                                aria-label={t('print.invert')}
                            />
                        </SettingRow>
                        <SettingRow label={t('print.mirror')}>
                            <Toggle
                                checked={mirror}
                                onChange={setMirror}
                                aria-label={t('print.mirror')}
                            />
                        </SettingRow>
                        <SettingRow label={t('print.offset')}>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={offsetX}
                                    onChange={setOffsetX}
                                    className="w-16"
                                    aria-label={t('print.offsetX')}
                                />
                                <Input
                                    value={offsetY}
                                    onChange={setOffsetY}
                                    className="w-16"
                                    aria-label={t('print.offsetY')}
                                />
                                <Select
                                    value={offsetType}
                                    onChange={(value) =>
                                        setOffsetType(value === 'outer' ? 'outer' : 'inner')
                                    }
                                    options={[
                                        { value: 'inner', label: t('print.offsetInner') },
                                        { value: 'outer', label: t('print.offsetOuter') },
                                    ]}
                                    className="w-24"
                                    aria-label={t('print.offsetType')}
                                />
                            </div>
                        </SettingRow>
                    </section>
                </div>

                {hasWarnings && (
                    <div className="space-y-1">
                        {showOverflow && (
                            <p
                                data-testid="print-warning-overflow"
                                role="alert"
                                className="rounded border border-amber-500 bg-amber-900/40 px-3 py-2 text-sm font-medium text-amber-100"
                            >
                                {t('print.warnings.overflow', {
                                    width: orientedWidthPx,
                                    head: capabilities?.printheadPixels,
                                })}
                            </p>
                        )}
                        {plan?.warning !== undefined && (
                            <p
                                data-testid="print-warning-interleaved"
                                className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-xs text-amber-200"
                            >
                                {t('print.warnings.interleaved', {
                                    pages: plan.warning.pages,
                                    cap: plan.warning.cap,
                                })}
                            </p>
                        )}
                        {mismatch !== undefined && (
                            <p
                                data-testid="print-warning-mismatch"
                                className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-xs text-amber-200"
                            >
                                {t('print.warnings.mismatch', {
                                    labelW: mismatch.labelW,
                                    labelH: mismatch.labelH,
                                    labelDpi: mismatch.labelDpi,
                                })}
                            </p>
                        )}
                        {policyOverflowCount > 0 && (
                            <p data-testid="print-warning-policy-overflow" role="alert" className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-xs text-amber-200">
                                {t('print.warnings.policyOverflow', { count: policyOverflowCount })}
                            </p>
                        )}
                        {notices.length > 0 && (
                            <p
                                data-testid="print-warning-mirror"
                                className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-xs text-amber-200"
                            >
                                {t('print.warnings.mirrorClipped', { pixels: mirrorLostPx })}
                            </p>
                        )}
                    </div>
                )}

                {progress && (
                    <div className="space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded bg-gray-700">
                            <div
                                data-testid="print-progress-bar"
                                className="h-full bg-blue-500 transition-[width]"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-400">
                            {progress.phase === 'sending'
                                ? t('print.progress.sending')
                                : t('print.progress.printing', {
                                      page: progress.page,
                                      total: progress.pagesTotal,
                                  })}
                            {' · '}
                            {t('print.progress.percent', { percent: progress.percent })}
                        </p>
                    </div>
                )}
            </div>
        </Modal>
    );
};
