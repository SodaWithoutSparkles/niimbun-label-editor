/**
 * Print smoke panel (W4) — dev-only WYSIWYG check.
 *
 * Not a route: mounted as an overlay only when the URL carries `?print=1`
 * (see `App.tsx`). Renders the store's open document (or an in-memory F-tag
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

/**
 * In-memory F-tag sample: the preset's real regions plus a filled rect and a
 * static text node inside the flag block, so the raster has ink to encode.
 */
const sampleNodes: Node[] = [
    {
        id: 'smoke-rect',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 300, y: 300, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1900, h: 1400 },
    },
    {
        id: 'smoke-text',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 300, y: 2000, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1900, h: 700 },
        fontSize: 500,
        text: { kind: 'static', value: 'PRINT W4' },
    },
];

const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export function PrintSmoke() {
    const currentDoc = useStore((state) => state.currentDoc);

    // One stable sample doc for the session; `createLabelDoc` mints an id/time.
    const sampleDoc = useMemo<LabelDoc>(
        () =>
            createLabelDoc({
                name: 'Print smoke sample',
                preset: 'ftagSpare-25x78',
                nodes: sampleNodes,
            }),
        [],
    );
    const doc = currentDoc ?? sampleDoc;

    const transportRef = useRef<PrinterTransport | undefined>(undefined);
    const pageRef = useRef<RenderedLabelPage | undefined>(undefined);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const [kind, setKind] = useState<TransportKind>('mock');
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
        renderLabelPage(doc)
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
    }, [doc]);

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
            info(`building print job from "${doc.meta.name || 'untitled'}"…`);
            const job = await buildLabelPrintJob(doc, { quantity: 1 });
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
                    {currentDoc ? `Open doc: ${doc.meta.name || 'untitled'}` : 'Sample F-tag (no doc open)'}
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
                        Print (1 copy)
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
