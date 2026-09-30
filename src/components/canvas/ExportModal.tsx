import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type Konva from 'konva';
import type { RefObject } from 'react';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms/Input';
import { Select } from '../common/forms/Select';
import { captureStageData } from './hooks/export/capture';
import type { StageCapture } from './hooks/export/capture';
import { downloadDataUrl } from './hooks/export/download';
import { computeTrimBoundsFromDataUrl } from './hooks/export/utils';

type ExportExtension = 'png' | 'jpg' | 'webp';

interface TrimBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface PreviewSize {
    width: number;
    height: number;
}

interface ExportModalProps {
    open: boolean;
    onClose: () => void;
    stageRef: RefObject<Konva.Stage | null>;
    defaultFilename: string;
}

const MIME_BY_EXT: Record<ExportExtension, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp'
};

const EXT_OPTIONS = [
    { value: 'png', label: '.png' },
    { value: 'jpg', label: '.jpg' },
    { value: 'webp', label: '.webp' }
];

const LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wider text-gray-400';
const CARD_CLASS = 'flex flex-col gap-2.5 rounded-xl border border-gray-700 bg-gray-900 p-3.5';
const SLIDER_CLASS = 'w-full accent-sky-400';

/**
 * Draw the trimmed/scaled preview onto the canvas and report its pixel size.
 * Plain function, no DOM lookups -- ported from the old hook's drawPreview().
 */
const renderPreview = (
    canvas: HTMLCanvasElement,
    image: HTMLImageElement,
    trimBorder: number,
    bounds: TrimBounds,
    scale: number
): PreviewSize | null => {
    const contentWidth = Math.round(bounds.width * scale);
    const contentHeight = Math.round(bounds.height * scale);
    const baseWidth = contentWidth + trimBorder * 2;
    const baseHeight = contentHeight + trimBorder * 2;

    canvas.width = baseWidth;
    canvas.height = baseHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, baseWidth, baseHeight);
    ctx.drawImage(
        image,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        trimBorder,
        trimBorder,
        contentWidth,
        contentHeight
    );

    return { width: baseWidth, height: baseHeight };
};

/**
 * Export preview dialog.
 *
 * Replaces the old imperative useCanvasExport hook: no string-built markup,
 * no injected stylesheet, no manual node lookup. All export maths is
 * preserved verbatim.
 */
export const ExportModal: React.FC<ExportModalProps> = ({
    open,
    onClose,
    stageRef,
    defaultFilename
}) => {
    const { t } = useTranslation();
    const id = useId();
    // Single source of truth for the fallback export name.
    const fallbackName = t('export.defaultFilename');

    const [filename, setFilename] = useState('');
    const [ext, setExt] = useState<ExportExtension>('png');
    const [scale, setScale] = useState(1);
    const [quality, setQuality] = useState(0.92);
    const [trim, setTrim] = useState(true);
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const [trimBounds, setTrimBounds] = useState<TrimBounds | null>(null);
    const [previewSize, setPreviewSize] = useState<PreviewSize | null>(null);
    const [previewScale, setPreviewScale] = useState(1);
    // Readiness is tied to the capture that produced the image: the sequence
    // number of the capture whose `onload` fired, not a bare boolean. A
    // superseded capture's late `onload` must not mark a newer image ready.
    const [imageReadySeq, setImageReadySeq] = useState(0);
    const [status, setStatus] = useState<'capturing' | 'ready' | 'failed'>('capturing');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    // StrictMode runs effects twice; this guard keeps a single capture queued.
    const captureStartedRef = useRef(false);
    // Monotonic capture id. Every capture increments it and bails out of its
    // continuations once the ref has moved on, so a stale async write can never
    // clobber the current capture's preview.
    const captureSeqRef = useRef(0);

    const updatePreviewScale = useCallback(() => {
        const viewport = viewportRef.current;
        const canvas = canvasRef.current;
        if (!viewport || !canvas) return;
        const availableWidth = viewport.clientWidth;
        const availableHeight = viewport.clientHeight;
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        if (!availableWidth || !availableHeight || !canvasWidth || !canvasHeight) return;
        const fitScale = Math.min(1, availableWidth / canvasWidth, availableHeight / canvasHeight);
        setPreviewScale(fitScale);
    }, []);

    const runCapture = useCallback(async (trimEnabled: boolean) => {
        const stage = stageRef.current;
        if (!stage) return;

        const seq = ++captureSeqRef.current;

        setStatus('capturing');
        setPreviewSize(null);
        setImageReadySeq(0);
        setTrimBounds(null);

        let capture: StageCapture | null;
        try {
            capture = captureStageData(stage, 2);
        } catch {
            // A tainted canvas makes toDataURL throw. Report a failure instead
            // of leaving the modal stuck on the capturing placeholder.
            if (captureSeqRef.current === seq) setStatus('failed');
            return;
        }
        if (!capture) return;

        setDataUrl(capture.dataUrl);

        const stageImage = new Image();
        stageImage.onload = () => {
            if (captureSeqRef.current !== seq) return;
            setImageReadySeq(seq);
        };
        stageImage.src = capture.dataUrl;
        imageRef.current = stageImage;

        if (trimEnabled) {
            try {
                const bounds = await computeTrimBoundsFromDataUrl(capture.dataUrl);
                if (captureSeqRef.current !== seq) return;
                setTrimBounds(bounds);
            } catch {
                if (captureSeqRef.current !== seq) return;
                setTrimBounds(null);
            }
        }
    }, [stageRef]);

    // Reset to defaults and capture once per open.
    useEffect(() => {
        if (!open) {
            captureStartedRef.current = false;
            return;
        }
        if (captureStartedRef.current) return;
        captureStartedRef.current = true;

        setFilename(defaultFilename || fallbackName);
        setExt('png');
        setScale(1);
        setQuality(0.92);
        setTrim(true);
        void runCapture(true);
    }, [open, defaultFilename, fallbackName, runCapture]);

    // Static "capturing" placeholder on the preview canvas.
    useEffect(() => {
        if (!open || status !== 'capturing') return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, w, h);
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.1, 0, Math.PI * 1.5);
        ctx.lineWidth = Math.min(w, h) * 0.01;
        ctx.strokeStyle = '#44ccff';
        ctx.stroke();
        ctx.font = `${Math.min(w, h) * 0.04}px sans-serif`;
        ctx.fillStyle = '#333333';
        ctx.textAlign = 'center';
        ctx.fillText(t('export.capturingShort'), w / 2, h / 2 + Math.min(w, h) * 0.2);
    }, [open, status, t]);

    // Draw the preview whenever the current capture's image, trim bounds or
    // scale change.
    useEffect(() => {
        if (!open || !imageReadySeq || !dataUrl) return;
        const image = imageRef.current;
        const canvas = canvasRef.current;
        if (!image || !canvas || !image.complete) return;

        const trimBorder = trim ? 10 : 0;
        if (trim && !trimBounds) return;

        const fullBounds = { x: 0, y: 0, width: image.width, height: image.height };
        const bounds = trim && trimBounds ? trimBounds : fullBounds;

        const size = renderPreview(canvas, image, trimBorder, bounds, scale);
        if (!size) return;

        setPreviewSize(size);
        setStatus('ready');
        updatePreviewScale();
    }, [open, imageReadySeq, dataUrl, trimBounds, scale, trim, updatePreviewScale]);

    useEffect(() => {
        if (!open) return;
        const handleResize = () => updatePreviewScale();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [open, updatePreviewScale]);

    const handleFilenameChange = (value: string) => {
        setFilename(value.trim() === '' ? fallbackName : value);
    };

    const handleTrimChange = (checked: boolean) => {
        setTrim(checked);
        void runCapture(checked);
    };

    const handleDownload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const mime = MIME_BY_EXT[ext];
        const exportQuality = ext === 'png' ? undefined : quality;
        const previewDataUrl = canvas.toDataURL(mime, exportQuality);
        const name = filename.trim() || fallbackName;
        downloadDataUrl(previewDataUrl, `${name}.${ext}`);
    };

    const previewReady = status === 'ready' && previewSize !== null;
    const previewMeta = status === 'failed'
        ? t('export.captureFailed')
        : previewSize && status === 'ready'
            ? t('export.previewReady', { width: previewSize.width, height: previewSize.height })
            : t('export.capturing');
    const sizeText = status === 'failed'
        ? t('export.captureFailed')
        : previewSize && status === 'ready'
            ? `${previewSize.width} × ${previewSize.height} px`
            : t('export.loading');
    const qualityHint = ext === 'png' ? t('export.qualityHintPng') : t('export.qualityHint');

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('export.title')}
            size="xl"
            className="h-[min(800px,94vh)] max-h-[94vh] w-[min(1200px,94vw)] max-w-[min(1200px,94vw)]"
            headerActions={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-95"
                    >
                        {t('export.close')}
                    </button>
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!previewReady}
                        className="rounded-lg bg-sky-400 px-3 py-1.5 text-sm font-medium text-slate-900 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {t('export.download')}
                    </button>
                </>
            }
        >
            <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] gap-6 max-lg:grid-cols-1">
                <div className="flex min-h-0 flex-col gap-3">
                    <div
                        ref={viewportRef}
                        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-gray-700 bg-gray-950"
                    >
                        {status === 'failed' ? (
                            <p className="px-6 text-center text-sm text-red-400">
                                {t('export.captureFailed')}
                            </p>
                        ) : (
                            <canvas
                                ref={canvasRef}
                                className="block rounded-xl border border-gray-700 bg-gray-950"
                                style={{ transform: `scale(${previewScale})`, transformOrigin: 'center' }}
                            />
                        )}
                    </div>
                    <div className="text-xs text-gray-400">{previewMeta}</div>
                    <div className="text-xs text-gray-400">{t('export.zoomHint')}</div>
                </div>

                <div className="flex flex-col gap-4 rounded-xl border border-gray-700 bg-gray-800/60 p-4">
                    <div className={CARD_CLASS}>
                        <label htmlFor={`${id}-filename`} className={LABEL_CLASS}>{t('export.filename')}</label>
                        <div className="flex items-center gap-2">
                            <Input
                                id={`${id}-filename`}
                                value={filename}
                                onChange={handleFilenameChange}
                                placeholder={t('export.defaultFilename')}
                            />
                            <Select
                                value={ext}
                                onChange={(value) => setExt(value as ExportExtension)}
                                options={EXT_OPTIONS}
                                className="w-28 shrink-0"
                            />
                        </div>
                    </div>

                    <div className={CARD_CLASS}>
                        <label htmlFor={`${id}-scale`} className={LABEL_CLASS}>{t('export.size')}</label>
                        <input
                            id={`${id}-scale`}
                            type="range"
                            min={0.5}
                            max={3}
                            step={0.1}
                            value={scale}
                            onChange={(e) => setScale(Number(e.target.value))}
                            className={SLIDER_CLASS}
                        />
                        <div className="flex items-center justify-between text-xs text-gray-300">
                            <span>{Math.round(scale * 100)}%</span>
                            <span>{sizeText}</span>
                        </div>
                    </div>

                    <div className={CARD_CLASS}>
                        <label htmlFor={`${id}-quality`} className={LABEL_CLASS}>{t('export.quality')}</label>
                        <input
                            id={`${id}-quality`}
                            type="range"
                            min={0.5}
                            max={1}
                            step={0.02}
                            value={quality}
                            disabled={ext === 'png'}
                            onChange={(e) => setQuality(Number(e.target.value))}
                            className="w-full accent-sky-400 disabled:opacity-50"
                        />
                        <div className="flex items-center justify-between text-xs text-gray-300">
                            <span>{Math.round(quality * 100)}%</span>
                            <span className="text-gray-400">{qualityHint}</span>
                        </div>
                    </div>

                    <div className={CARD_CLASS}>
                        <label htmlFor={`${id}-trim`} className={LABEL_CLASS}>{t('export.trim')}</label>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-300">{t('export.trimShort')}</span>
                            <input
                                id={`${id}-trim`}
                                type="checkbox"
                                checked={trim}
                                onChange={(e) => handleTrimChange(e.target.checked)}
                                className="h-4 w-4 accent-sky-400"
                            />
                        </div>
                        <p className="text-[11px] text-gray-500">{t('export.trimHint')}</p>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
