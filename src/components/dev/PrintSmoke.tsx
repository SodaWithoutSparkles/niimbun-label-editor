/**
 * Print smoke panel (W4) — dev-only WYSIWYG check.
 *
 * Not a route: mounted as an overlay only when the URL carries `?print=1`
 * (see `App.tsx`). Renders the store's open document (or an in-memory 50×30
 * sample when none is open) through the shared `renderLabelPage` path, paints
 * the exact raster the encoder sees, and prints it through the selected
 * transport.
 *
 *     bun run dev        # open http://localhost:5173/?print=1
 *
 * Strings are hardcoded like `HardwareSmoke` (its dev-only precedent); this is
 * not product UI, so it deliberately stays out of the i18n catalog.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import { renderLabelPage, type RenderedLabelPage } from '../../editor/render';
import { createResourceAssetDeps } from '../editor/usePreparedAssets';
import { MockTransport } from '../../print/mockTransport';
import { NiimbotTransport } from '../../print/niimbotAdapter';
import { buildLabelPrintJob } from '../../print/printLabel';
import type {
    PrintProgress,
    PrinterStatus,
    PrinterTransport,
} from '../../print/transport';
import { useStore } from '../../store/useStore';

type TransportKind = 'mock' | 'niimbot';
type LogLine = { kind: 'info' | 'error'; text: string };

/** Deterministic 8×8 checkerboard PNG (inline, so the sample needs no storage). */
const SAMPLE_IMAGE_ID = 'smoke-image-ref';
const SAMPLE_IMAGE_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAF0lEQVR42mNgYGD4//8/FhK7KAQMPh0AXXNfoWyFCAcAAAAASUVORK5CYII=';

/**
 * In-memory 50×30 sample (rounded50x30, 5000×3000 hm backing): a static text
 * node, an inline image, a QR and a wide code128 barcode, laid out with a small
 * margin inside the rounded region. P5 adds the image, QR and barcode so the
 * print path exercises the async asset seam without any network or storage
 * dependency.
 */
const sampleNodes: Node[] = [
    {
        id: 'smoke-text',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 300, y: 250, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 4400, h: 650 },
        fontSize: 380,
        text: { kind: 'static', value: 'PRINT W4' },
    },
    {
        id: 'smoke-image',
        parentId: null,
        type: 'image',
        imageId: SAMPLE_IMAGE_ID,
        visible: true,
        locked: false,
        transform: { x: 300, y: 1100, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 800, h: 800 },
        fit: 'contain',
    },
    {
        id: 'smoke-qr',
        parentId: null,
        type: 'qr',
        data: { kind: 'static', value: 'https://example.com' },
        errorCorrection: 'M',
        visible: true,
        locked: false,
        transform: { x: 1250, y: 1100, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 800, h: 800 },
    },
    {
        id: 'smoke-rect',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 2300, y: 1200, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 2100, h: 600 },
    },
    {
        id: 'smoke-barcode',
        parentId: null,
        type: 'barcode',
        data: { kind: 'static', value: '123456789012' },
        symbology: 'code128',
        visible: true,
        locked: false,
        transform: { x: 250, y: 2050, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 4500, h: 850 },
    },
];

type SampleKind = 'objects' | 'ruler';

/**
 * Ruler/calibration sample (rounded50x30, 5000×3000 hm = 50×30 mm). A ruler
 * across the top (1 mm ticks, taller 5 mm / 10 mm ticks with mm labels) plus
 * full-width known-length bars below, so the owner can print it and measure the
 * printed geometry with calipers. Calibration only — no image/QR/barcode.
 *
 * All geometry is exact hm (1/100 mm). The bars are drawn slightly thinner than
 * the 300 hm suggested so six of them plus the ruler fit inside the 3000 hm
 * height; their *lengths* — the thing the calipers measure — are exact.
 */
const RULER_BASELINE_Y = 750;
const RULER_TICK_W = 30;
const RULER_TICK_H = { mm1: 250, mm5: 450, mm10: 700 } as const;
const RULER_LABEL_FONT = 150;
const BAR_H = 230;

const rulerNodes = (): Node[] => {
    const nodes: Node[] = [];

    // Horizontal ruler: thin baseline across the top, ticks rising from it.
    for (let x = 0; x <= 5000; x += 100) {
        const h = x % 1000 === 0 ? RULER_TICK_H.mm10 : x % 500 === 0 ? RULER_TICK_H.mm5 : RULER_TICK_H.mm1;
        const tickX = Math.min(Math.max(x - RULER_TICK_W / 2, 0), 5000 - RULER_TICK_W);
        nodes.push({
            id: `ruler-tick-${x}`,
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: false,
            transform: { x: tickX, y: RULER_BASELINE_Y - h, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: RULER_TICK_W, h },
        });
    }
    nodes.push({
        id: 'ruler-baseline',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: RULER_BASELINE_Y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 5000, h: 30 },
    });

    // mm value under every 10 mm tick (0, 10, … 50).
    for (let mm = 0; mm <= 50; mm += 10) {
        const x = mm * 100;
        const labelW = 300;
        const labelX = Math.min(Math.max(x - labelW / 2, 0), 5000 - labelW);
        nodes.push({
            id: `ruler-mm-label-${mm}`,
            parentId: null,
            type: 'text',
            visible: true,
            locked: false,
            transform: { x: labelX, y: RULER_BASELINE_Y + 50, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: labelW, h: RULER_LABEL_FONT },
            fontSize: RULER_LABEL_FONT,
            align: 'center',
            text: { kind: 'static', value: String(mm) },
        });
    }

    // Known-length bars, each from x = 0, stacked with a small gap. The 2100 hm
    // (21 mm) bar is the exact one the owner measured; it is labelled distinctly.
    const bars: { len: number; label: string; gapBefore: number }[] = [
        { len: 1000, label: '10 mm', gapBefore: 0 },
        { len: 2000, label: '20 mm', gapBefore: 105 },
        { len: 2100, label: '21 mm', gapBefore: 105 },
        { len: 3000, label: '30 mm', gapBefore: 105 },
        { len: 4000, label: '40 mm', gapBefore: 105 },
        { len: 5000, label: '50 mm', gapBefore: 180 },
    ];
    const labelW = 900;
    let y = 990;
    for (const bar of bars) {
        y += bar.gapBefore;
        nodes.push({
            id: `ruler-bar-${bar.len}`,
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: false,
            transform: { x: 0, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: bar.len, h: BAR_H },
        });
        const isFullWidth = bar.len === 5000;
        nodes.push({
            id: `ruler-bar-label-${bar.len}`,
            parentId: null,
            type: 'text',
            visible: true,
            locked: false,
            // A full-width bar leaves no room to its right, so its label sits in
            // the gap above, right-aligned to the bar end.
            transform: isFullWidth
                ? { x: 5000 - 40 - labelW, y: y - 180 + 15, rotDeg: 0, scaleX: 1, scaleY: 1 }
                : { x: bar.len + 40, y: y + (BAR_H - RULER_LABEL_FONT) / 2, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: labelW, h: RULER_LABEL_FONT },
            fontSize: RULER_LABEL_FONT,
            align: isFullWidth ? 'right' : 'left',
            text: { kind: 'static', value: bar.label },
        });
        y += BAR_H;
    }

    return nodes;
};

const buildSampleDoc = (kind: SampleKind): LabelDoc => {
    const built = createLabelDoc({
        name: kind === 'ruler' ? 'Ruler calibration sample' : 'Print smoke sample',
        preset: 'rounded50x30',
        nodes: kind === 'ruler' ? rulerNodes() : sampleNodes,
    });
    if (kind === 'objects') {
        built.resources.images.push({
            imageId: SAMPLE_IMAGE_ID,
            name: 'smoke-checker.png',
            source: { kind: 'inline', mediaType: 'image/png', dataUrl: SAMPLE_IMAGE_DATA_URL },
            widthPx: 8,
            heightPx: 8,
        });
    }
    return built;
};

const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export function PrintSmoke() {
    const currentDoc = useStore((state) => state.currentDoc);
    const resourceRepo = useStore((state) => state.resourceRepo);

    // One stable sample doc per choice; `createLabelDoc` mints an id/time.
    const [sampleKind, setSampleKind] = useState<SampleKind>('objects');
    const sampleDoc = useMemo<LabelDoc>(() => buildSampleDoc(sampleKind), [sampleKind]);
    const doc = currentDoc ?? sampleDoc;

    // Local image bytes + imported fonts resolve through the shared repo; with
    // none injected the inline sample image and qr/barcode still prepare.
    const assetDeps = useMemo(() => createResourceAssetDeps(resourceRepo), [resourceRepo]);

    const transportRef = useRef<PrinterTransport | undefined>(undefined);
    const pageRef = useRef<RenderedLabelPage | undefined>(undefined);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const [kind, setKind] = useState<TransportKind>('mock');
    const [quantity, setQuantity] = useState(1);
    const [status, setStatus] = useState<PrinterStatus | undefined>(undefined);
    const [progress, setProgress] = useState<PrintProgress | undefined>(undefined);
    const [pageSize, setPageSize] = useState<{ widthPx: number; heightPx: number } | undefined>(undefined);
    const [previewError, setPreviewError] = useState<string | undefined>(undefined);
    const [lines, setLines] = useState<LogLine[]>([]);
    const [busy, setBusy] = useState(false);

    const push = (line: LogLine['kind'], text: string): void => {
        setLines((prev) => [...prev, { kind: line, text }]);
    };
    const info = (text: string): void => push('info', text);
    const fail = (text: string): void => push('error', text);

    // Build/replace the transport whenever the picker changes.
    useEffect(() => {
        const transport =
            kind === 'mock'
                ? new MockTransport()
                : new NiimbotTransport({ transport: 'bluetooth' });
        transportRef.current = transport;
        const offStatus = transport.onStatus(setStatus);
        const offProgress = transport.onProgress(setProgress);
        return () => {
            offStatus();
            offProgress();
            void transport.disconnect().catch(() => undefined);
            if (transportRef.current === transport) transportRef.current = undefined;
        };
    }, [kind]);

    // Render the current doc through the shared path and paint its raster.
    useEffect(() => {
        let cancelled = false;
        setPreviewError(undefined);
        renderLabelPage(doc, {}, { assets: assetDeps })
            .then((page) => {
                if (cancelled) return;
                pageRef.current = page;
                setPageSize({ widthPx: page.widthPx, heightPx: page.heightPx });
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
                if (!cancelled) setPreviewError(messageOf(error));
            });
        return () => {
            cancelled = true;
        };
    }, [doc, assetDeps]);

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
        if (!transport || busy) return;
        setBusy(true);
        try {
            info(`building print job from "${doc.meta.name || 'untitled'}" (quantity=${quantity})…`);
            const job = await buildLabelPrintJob(doc, { quantity }, { assets: assetDeps });
            const encoded = pageRef.current;
            info(
                `job totalPages=${job.totalPages} pageColor=${job.pageColor}` +
                    (encoded ? ` raster=${encoded.widthPx}×${encoded.heightPx}` : '') +
                    ` source=${currentDoc ? 'open doc' : 'sample'}`,
            );
            const result = await transport.print(job);
            info(`print done ${JSON.stringify(result)}`);
        } catch (error) {
            fail(`ERROR ${messageOf(error)}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center gap-6 overflow-auto bg-white/95 p-6">
            <div className="flex flex-col items-center gap-2">
                <h1 className="text-lg font-semibold">Print smoke</h1>
                <p className="text-xs text-gray-500">
                    {currentDoc ? `Open doc: ${doc.meta.name || 'untitled'}` : 'Sample 50×30 (no doc open)'}
                    {pageSize ? ` · ${pageSize.widthPx}×${pageSize.heightPx} px` : ''}
                </p>
                <canvas
                    ref={canvasRef}
                    className="max-h-[70vh] border border-gray-300 bg-white"
                    style={{ width: 'auto', imageRendering: 'pixelated' }}
                />
            </div>

            <div className="flex w-[28rem] max-w-full flex-col gap-3">
                <label className="text-sm">
                    Transport:{' '}
                    <select
                        value={kind}
                        onChange={(event) => setKind(event.target.value as TransportKind)}
                        disabled={busy}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                        <option value="mock">Mock</option>
                        <option value="niimbot">NIIMBOT (Bluetooth)</option>
                    </select>
                </label>

                <label className="text-sm">
                    Sample:{' '}
                    <select
                        value={sampleKind}
                        onChange={(event) => setSampleKind(event.target.value as SampleKind)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                        <option value="objects">Objects</option>
                        <option value="ruler">Ruler</option>
                    </select>
                </label>

                <label className="text-sm">
                    Quantity:{' '}
                    <input
                        type="number"
                        min={1}
                        max={4}
                        value={quantity}
                        onChange={(event) => {
                            const next = event.target.valueAsNumber;
                            setQuantity(
                                Number.isFinite(next) ? Math.min(4, Math.max(1, next)) : 1,
                            );
                        }}
                        disabled={busy}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                </label>

                <div className="text-xs text-gray-600">
                    <div>status: {status ? JSON.stringify(status) : '—'}</div>
                    <div>progress: {progress ? JSON.stringify(progress) : '—'}</div>
                    <div>preview: {previewError ? `ERROR ${previewError}` : 'ok'}</div>
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
                        disabled={busy}
                        className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                        Print ({quantity} {quantity === 1 ? 'copy' : 'copies'})
                    </button>
                </div>

                <pre className="h-64 overflow-auto rounded bg-gray-900 p-3 text-xs leading-5 text-gray-100">
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
