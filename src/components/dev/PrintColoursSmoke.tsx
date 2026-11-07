/**
 * Print-colours smoke panel (P7 wave A) — dev-only, owner-run.
 *
 * Not a route: mounted as an overlay only when the URL carries `?printcolours`
 * (see `App.tsx`). It builds the deterministic test patterns from
 * `printColoursPatterns.ts`, previews each one through the **real**
 * `renderLabelPage` path at 100 dpi (tone check before spending tape), and
 * prints it as Mono / Grayscale / Red & black through a mock or the real
 * Bluetooth transport.
 *
 * The docs are built in memory and never handed to the store: this harness
 * cannot save, mutate or replace the open document.
 *
 *     bun run dev        # open http://localhost:5173/?printcolours
 *
 * Strings are hardcoded like `PrintSmoke` (its dev-only precedent); this is not
 * product UI, so it deliberately stays out of the i18n catalog.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageColorType } from '@mmote/niimbluelib';
import type { AssetDeps } from '../../editor/render';
import { renderLabelPage, type RenderedLabelPage } from '../../editor/render';
import { MockTransport } from '../../print/mockTransport';
import { NiimbotTransport } from '../../print/niimbotAdapter';
import { buildCsvPrintJob, renderOptionsOf } from '../../print/printLabel';
import type { PrintProgress, PrinterStatus, PrinterTransport } from '../../print/transport';
import {
    buildColourPatterns,
    buildDensitySweep,
    buildRedBlackCalibrationPattern,
    type ColourPattern,
    type ColourPatternId,
} from './printColoursPatterns';

type TransportKind = 'mock' | 'niimbot';
type LogLine = { kind: 'info' | 'error'; text: string };

/** Inline PNGs decode without providers; no store resource repo is involved. */
const ASSETS: AssetDeps = {};

/** Preview resolution: enough to judge banding, small enough to stay cheap. */
const PREVIEW_DPI = 100;

const PAGE_COLOR_OPTIONS: readonly { value: PageColorType; label: string }[] = [
    { value: PageColorType.SingleColor, label: 'Mono' },
    { value: PageColorType.Grayscale, label: 'Grayscale' },
    { value: PageColorType.DoubleColor, label: 'Red & black' },
];

const pageColorLabel = (pageColor: PageColorType): string =>
    PAGE_COLOR_OPTIONS.find((option) => option.value === pageColor)?.label ?? String(pageColor);

const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export function PrintColoursSmoke() {
    const patterns = useMemo(() => buildColourPatterns(), []);
    const [patternId, setPatternId] = useState<ColourPatternId>('grayscale');
    const pattern = patterns.find((candidate) => candidate.id === patternId) ?? patterns[0]!;
    const [pageColor, setPageColor] = useState<PageColorType>(pattern.pageColor);

    const transportRef = useRef<PrinterTransport | undefined>(undefined);
    const pageRef = useRef<RenderedLabelPage | undefined>(undefined);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const [kind, setKind] = useState<TransportKind>('mock');
    // undefined = printer default; reset per transport because capabilities differ.
    const [density, setDensity] = useState<number | undefined>(undefined);
    const [status, setStatus] = useState<PrinterStatus | undefined>(undefined);
    const [progress, setProgress] = useState<PrintProgress | undefined>(undefined);
    const [pageSize, setPageSize] = useState<{ widthPx: number; heightPx: number } | undefined>(undefined);
    const [previewError, setPreviewError] = useState<string | undefined>(undefined);
    const [previewPending, setPreviewPending] = useState(true);
    const [lastResult, setLastResult] = useState<string | undefined>(undefined);
    const [lines, setLines] = useState<LogLine[]>([]);
    const [busy, setBusy] = useState(false);

    const push = (line: LogLine['kind'], text: string): void => {
        setLines((prev) => [...prev, { kind: line, text }]);
    };
    const info = (text: string): void => push('info', text);
    const fail = (text: string): void => push('error', text);

    // Density range from the reported capabilities, with plain fallbacks.
    const rawDensityMin = status?.capabilities?.densityMin ?? 1;
    const rawDensityMax = status?.capabilities?.densityMax ?? 5;
    const densityRangeOk =
        Number.isFinite(rawDensityMin) &&
        Number.isFinite(rawDensityMax) &&
        rawDensityMax >= rawDensityMin &&
        rawDensityMax - rawDensityMin <= 100;
    const densityMin = densityRangeOk ? rawDensityMin : 1;
    const densityMax = densityRangeOk ? rawDensityMax : 5;
    const densityDefault = densityRangeOk ? (status?.capabilities?.densityDefault ?? 3) : 3;
    const densityOptions = Array.from(
        { length: densityMax - densityMin + 1 },
        (_, index) => densityMin + index,
    );

    // Same rebuild as the print path: the calibration pattern stamps the chosen
    // density into its caption, so the preview must show that doc, not `pattern.doc`.
    const previewDoc = useMemo(
        () =>
            pattern.id === 'redBlackCalibration'
                ? buildRedBlackCalibrationPattern(density ?? densityDefault).doc
                : pattern.doc,
        [pattern, density, densityDefault],
    );

    const selectPattern = (id: ColourPatternId): void => {
        setPatternId(id);
        const next = patterns.find((candidate) => candidate.id === id);
        if (next) setPageColor(next.pageColor);
    };

    // Build/replace the transport whenever the picker changes (the
    // `PrintSmoke` pattern — including the real adapter's construction).
    useEffect(() => {
        const transport =
            kind === 'mock'
                ? new MockTransport({
                      pageDelayMs: 800,
                      capabilities: { grayscale: true, doubleColor: true },
                  })
                : new NiimbotTransport({ transport: 'bluetooth' });
        transportRef.current = transport;
        setStatus(undefined);
        setProgress(undefined);
        setDensity(undefined);
        const offStatus = transport.onStatus(setStatus);
        const offProgress = transport.onProgress(setProgress);
        return () => {
            offStatus();
            offProgress();
            void transport.disconnect().catch(() => undefined);
            if (transportRef.current === transport) transportRef.current = undefined;
        };
    }, [kind]);

    // Render through the shared path at preview dpi. The options are the same
    // split the print job uses (`renderOptionsOf`), so the preview's palette
    // matches the page colour the job will encode — only the dpi differs.
    useEffect(() => {
        let cancelled = false;
        setPreviewError(undefined);
        setPreviewPending(true);
        pageRef.current = undefined;
        setPageSize(undefined);
        const staleCanvas = canvasRef.current;
        if (staleCanvas) {
            staleCanvas
                .getContext('2d')
                ?.clearRect(0, 0, staleCanvas.width, staleCanvas.height);
        }
        renderLabelPage(
            previewDoc,
            {},
            { ...renderOptionsOf({ pageColor }, ASSETS), dpi: PREVIEW_DPI },
        )
            .then((page) => {
                if (cancelled) return;
                pageRef.current = page;
                setPageSize({ widthPx: page.widthPx, heightPx: page.heightPx });
                setPreviewPending(false);
                const canvas = canvasRef.current;
                if (!canvas) return;
                canvas.width = page.widthPx;
                canvas.height = page.heightPx;
                const target = canvas.getContext('2d');
                if (!target) {
                    setPreviewError('2D canvas context unavailable');
                    return;
                }
                target.drawImage(page.canvas, 0, 0);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setPreviewPending(false);
                pageRef.current = undefined;
                setPreviewError(messageOf(error));
            });
        return () => {
            cancelled = true;
        };
    }, [previewDoc, pageColor]);

    const connect = async (): Promise<void> => {
        const transport = transportRef.current;
        if (!transport || busy) return;
        setBusy(true);
        try {
            info(`connecting (${kind})…${kind === 'niimbot' ? ' accept the Bluetooth prompt' : ''}`);
            await transport.connect();
            info('connected');
        } catch (error) {
            fail(`ERROR ${messageOf(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const print = async (): Promise<void> => {
        const transport = transportRef.current;
        if (!transport || busy || previewPending || !pageRef.current) return;
        setBusy(true);
        try {
            info(
                `building "${pattern.label}" · pageColor=${pageColorLabel(pageColor)} · density=${density ?? 'default'}` +
                    (pageSize ? ` · preview ${pageSize.widthPx}×${pageSize.heightPx} px` : ''),
            );
            // NOT `buildLabelPrintJob`: that hardcodes SingleColor, so the page
            // colour has to arrive as an override here.
            //
            // The calibration pattern stamps the chosen density into its caption,
            // so rebuild that doc with the same density the job carries.
            const doc =
                pattern.id === 'redBlackCalibration'
                    ? buildRedBlackCalibrationPattern(density ?? densityDefault).doc
                    : pattern.doc;
            const job = buildCsvPrintJob(
                doc,
                null,
                {
                    order: 'grouped',
                    copies: 1,
                    overrides: { pageColor, ...(density !== undefined ? { density } : {}) },
                },
                { assets: ASSETS },
            );
            info(`job totalPages=${job.totalPages} pageColor=${job.pageColor}`);
            const result = await transport.print(job);
            setLastResult(`printed ${result.pagesPrinted} / ${job.totalPages} page(s)`);
            info(`print done ${JSON.stringify(result)}`);
        } catch (error) {
            const text = messageOf(error);
            setLastResult(`ERROR ${text}`);
            fail(`ERROR ${text}`);
        } finally {
            setBusy(false);
        }
    };

    const printDensitySweep = async (): Promise<void> => {
        const transport = transportRef.current;
        if (!transport || busy || previewPending) return;
        const total = densityOptions.length;
        let printed = 0;
        setBusy(true);
        try {
            info(`density sweep: ${total} calibration label(s), densities ${densityMin}–${densityMax}`);
            let sweep: ColourPattern[];
            try {
                // Build inside the try: a build throw must log and abort cleanly,
                // never escape as an unhandled rejection.
                sweep = buildDensitySweep(densityOptions);
            } catch (error) {
                const text = messageOf(error);
                fail(`density sweep: ERROR ${text} — sweep aborted`);
                setLastResult(`density sweep ERROR: ${text}`);
                return;
            }
            for (const [index, calibration] of sweep.entries()) {
                const sweepDensity = densityOptions[index]!;
                try {
                    const job = buildCsvPrintJob(
                        calibration.doc,
                        null,
                        {
                            order: 'grouped',
                            copies: 1,
                            overrides: {
                                pageColor: PageColorType.DoubleColor,
                                density: sweepDensity,
                            },
                        },
                        { assets: ASSETS },
                    );
                    const result = await transport.print(job);
                    printed += 1;
                    info(
                        `density ${sweepDensity}: printed ${result.pagesPrinted}/${job.totalPages}`,
                    );
                } catch (error) {
                    const text = messageOf(error);
                    fail(`density ${sweepDensity}: ERROR ${text} — sweep aborted`);
                    setLastResult(`density sweep ERROR at ${sweepDensity}: ${printed}/${total} printed`);
                    return;
                }
            }
            info(`density sweep done (${total} labels)`);
            setLastResult(`density sweep printed ${printed}/${total} labels`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center gap-6 overflow-auto bg-white/95 p-6">
            <div className="flex flex-col items-center gap-2">
                <h1 className="text-lg font-semibold">Print colours smoke</h1>
                <p className="text-xs text-gray-500">
                    {pattern.label} · {pageSize ? `${pageSize.widthPx}×${pageSize.heightPx} px` : '—'}
                </p>
                <canvas
                    ref={canvasRef}
                    className="max-h-[70vh] border border-gray-300 bg-white"
                    style={{ width: 'auto', imageRendering: 'pixelated' }}
                />
            </div>

            <div className="flex w-[28rem] max-w-full flex-col gap-3">
                <label className="text-sm">
                    Pattern:{' '}
                    <select
                        value={patternId}
                        onChange={(event) => selectPattern(event.target.value as ColourPatternId)}
                        disabled={busy}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                        {patterns.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                                {candidate.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="text-sm">
                    Page colour:{' '}
                    <select
                        value={pageColor}
                        onChange={(event) => setPageColor(Number(event.target.value) as PageColorType)}
                        disabled={busy}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                        {PAGE_COLOR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="text-sm">
                    Transport:{' '}
                    <select
                        value={kind}
                        onChange={(event) => setKind(event.target.value as TransportKind)}
                        disabled={busy}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                        <option value="mock">Mock</option>
                        <option value="niimbot">Real printer (Bluetooth)</option>
                    </select>
                </label>

                <label className="text-sm">
                    Density:{' '}
                    <select
                        value={density === undefined ? '' : String(density)}
                        onChange={(event) =>
                            setDensity(event.target.value === '' ? undefined : Number(event.target.value))
                        }
                        disabled={busy}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                        <option value="">Printer default ({densityDefault})</option>
                        {densityOptions.map((value) => (
                            <option key={value} value={value}>
                                {value}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="text-xs text-gray-600">
                    <div>status: {status ? JSON.stringify(status) : '—'}</div>
                    <div>progress: {progress ? JSON.stringify(progress) : '—'}</div>
                    <div>
                        preview: {previewPending ? 'rendering…' : previewError ? `ERROR ${previewError}` : 'ok'}
                    </div>
                    <div>last print: {lastResult ?? '—'}</div>
                </div>

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => void connect()}
                        disabled={busy}
                        className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                        {busy ? 'Working…' : 'Connect'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void print()}
                        disabled={busy || previewPending || !pageRef.current}
                        className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                        Print 1 page
                    </button>
                    <button
                        type="button"
                        onClick={() => void printDensitySweep()}
                        disabled={busy || previewPending}
                        className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                        Print density sweep ({densityOptions.length})
                    </button>
                </div>

                <p className="text-xs text-gray-500">
                    Prints one calibration label per density in the reported range (red/black tape
                    is expensive).
                </p>

                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-gray-800">
                    <div className="font-semibold">Physical questions these prints answer</div>
                    <p className="mt-1">
                        Density is the printer's heat/energy setting (higher = darker). It does not
                        change the grayscale ramp mapping.
                    </p>
                    <ul className="mt-1 list-disc pl-4 leading-5">
                        <li>
                            Grayscale: banding? Are all 16 levels visually distinct, and is the
                            gradient smooth?
                        </li>
                        <li>Flat art: are the bars, sweep and text crisp (no dithering)?</li>
                        <li>Red-tinted gradient: red/white only, no black bleed?</li>
                        <li>Colour gradient: correct mix of black / red / white?</li>
                        <li>Red vs black ink density: does red print as dark as black?</li>
                        <li>
                            Long 50×160 mm page: does the print finish without a buffer error or
                            truncation?
                        </li>
                        <li>
                            Paper/RFID: if the roll is not recognised, select the paper type
                            manually on the printer.
                        </li>
                    </ul>
                </div>

                <pre className="h-56 overflow-auto rounded bg-gray-900 p-3 text-xs leading-5 text-gray-100">
                    {lines.length === 0
                        ? 'Ready.'
                        : lines.map((line, index) => (
                              <div
                                  key={index}
                                  className={line.kind === 'error' ? 'text-red-400' : undefined}
                              >
                                  {line.text}
                              </div>
                          ))}
                </pre>
            </div>
        </div>
    );
}
