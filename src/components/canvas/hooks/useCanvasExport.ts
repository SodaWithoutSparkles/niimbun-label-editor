import { useEffect, useRef, type RefObject } from 'react';
import { computeTrimBoundsFromDataUrl } from './export/utils';
import { getExportModalStyles } from './export/styles';
import { getExportModalTemplate } from './export/template';

interface ExportOptions {
    filename: string;
}

export const useCanvasExport = (
    exportTrigger: number,
    stageRef: RefObject<any>,
    trRef: RefObject<any>,
    options: ExportOptions
) => {
    const optionsRef = useRef<ExportOptions>(options);

    useEffect(() => {
        optionsRef.current = options;
    }, [options]);

    const captureStageData = async () => {
        if (!stageRef.current) return null;

        const pixelRatio = 2;

        const transformerConfig = trRef.current?.nodes();
        trRef.current?.nodes([]);

        const dataUrl = stageRef.current.toDataURL({ pixelRatio });
        const width = stageRef.current.width() * pixelRatio;
        const height = stageRef.current.height() * pixelRatio;

        if (transformerConfig) {
            trRef.current?.nodes(transformerConfig);
        }

        return {
            dataUrl,
            width,
            height
        };
    };

    useEffect(() => {
        if (exportTrigger <= 0 || !stageRef.current) return;

        const existingModal = document.getElementById('export-preview-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const styleId = 'export-preview-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            styleTag.textContent = getExportModalStyles();
            document.head.appendChild(styleTag);
        }

        const modal = document.createElement('div');
        modal.id = 'export-preview-modal';
        modal.innerHTML = getExportModalTemplate();

        document.body.appendChild(modal);

        const overlay = modal.querySelector('[data-export-overlay]') as HTMLDivElement | null;
        const closeButton = modal.querySelector('[data-export-close]') as HTMLButtonElement | null;
        const previewCanvas = modal.querySelector('#previewCanvas') as HTMLCanvasElement | null;
        const previewViewport = previewCanvas?.closest('.preview-viewport') as HTMLDivElement | null;
        const previewMeta = modal.querySelector('#previewMeta') as HTMLDivElement | null;
        const filenameInput = modal.querySelector('#filename') as HTMLInputElement | null;
        const extSelect = modal.querySelector('#ext') as HTMLSelectElement | null;
        const scaleInput = modal.querySelector('#scale') as HTMLInputElement | null;
        const scaleValue = modal.querySelector('#scaleValue') as HTMLSpanElement | null;
        const sizeValue = modal.querySelector('#sizeValue') as HTMLSpanElement | null;
        const qualityInput = modal.querySelector('#quality') as HTMLInputElement | null;
        const qualityValue = modal.querySelector('#qualityValue') as HTMLSpanElement | null;
        const qualityHint = modal.querySelector('#qualityHint') as HTMLSpanElement | null;
        const downloadBtn = modal.querySelector('#downloadBtn') as HTMLButtonElement | null;
        const trimCheckbox = modal.querySelector('#trimEmpty') as HTMLInputElement | null;

        if (!previewCanvas || !previewViewport || !previewMeta || !filenameInput || !extSelect || !scaleInput || !scaleValue || !sizeValue || !qualityInput || !qualityValue || !qualityHint || !downloadBtn || !trimCheckbox) {
            modal.remove();
            return;
        }

        const state = {
            stageDataUrl: null as string | null,
            stageWidth: 0,
            stageHeight: 0,
            scale: 1,
            quality: 0.92,
            ext: 'png',
            trimEmpty: true,
            trimBounds: null as { x: number; y: number; width: number; height: number } | null
        };

        const stageImage = new Image();
        stageImage.onload = () => {
            drawPreview();
        };

        const updateQualityState = () => {
            const isLossy = state.ext !== 'png';
            qualityInput.disabled = !isLossy;
            qualityHint.textContent = isLossy ? 'JPG/WebP only' : 'PNG ignores quality';
        };

        const updateScaleLabel = () => {
            scaleValue.textContent = Math.round(state.scale * 100) + '%';
        };

        const updateQualityLabel = () => {
            qualityValue.textContent = Math.round(state.quality * 100) + '%';
        };

        const updatePreviewScale = () => {
            const availableWidth = previewViewport.clientWidth;
            const availableHeight = previewViewport.clientHeight;
            const canvasWidth = previewCanvas.width;
            const canvasHeight = previewCanvas.height;
            if (!availableWidth || !availableHeight || !canvasWidth || !canvasHeight) return;
            const fitScale = Math.min(1, availableWidth / canvasWidth, availableHeight / canvasHeight);
            previewViewport.style.setProperty('--preview-scale', String(fitScale));
        };

        const drawPreview = () => {
            if (!state.stageDataUrl || !stageImage.complete) return;

            const trimBorder = state.trimEmpty ? 10 : 0;
            if (state.trimEmpty && !state.trimBounds) {
                return;
            }

            const trimBounds = state.trimBounds ?? {
                x: 0,
                y: 0,
                width: stageImage.width,
                height: stageImage.height
            };

            const contentWidth = Math.round(trimBounds.width * state.scale);
            const contentHeight = Math.round(trimBounds.height * state.scale);
            const baseWidth = contentWidth + trimBorder * 2;
            const baseHeight = contentHeight + trimBorder * 2;

            previewCanvas.width = baseWidth;
            previewCanvas.height = baseHeight;
            const ctx = previewCanvas.getContext('2d');
            if (!ctx) return;

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, baseWidth, baseHeight);
            const drawX = trimBorder;
            const drawY = trimBorder;
            ctx.drawImage(
                stageImage,
                trimBounds.x,
                trimBounds.y,
                trimBounds.width,
                trimBounds.height,
                drawX,
                drawY,
                contentWidth,
                contentHeight
            );

            sizeValue.textContent = baseWidth + ' × ' + baseHeight + ' px';
            previewMeta.textContent = 'Preview ready • ' + baseWidth + ' × ' + baseHeight + 'px';
            downloadBtn.disabled = false;
            updatePreviewScale();
        };

        const updateStageCapture = async () => {
            downloadBtn.disabled = true;
            previewMeta.textContent = 'Capturing preview...';
            sizeValue.textContent = 'Loading...';

            // Draw a placeholder spinner on canvas
            const ctx = previewCanvas.getContext('2d');
            if (ctx) {
                const w = previewCanvas.width;
                const h = previewCanvas.height;
                ctx.clearRect(0, 0, w, h);
                ctx.fillStyle = '#f0f0f0';
                ctx.fillRect(0, 0, w, h);
                // Simple static spinner
                ctx.beginPath();
                ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.1, 0, Math.PI * 1.5);
                ctx.lineWidth = Math.min(w, h) * 0.01;
                ctx.strokeStyle = '#44ccff';
                ctx.stroke();

                ctx.font = `${Math.min(w, h) * 0.04}px sans-serif`;
                ctx.fillStyle = '#333333';
                ctx.textAlign = 'center';
                ctx.fillText('Capturing preview...', w / 2, h / 2 + Math.min(w, h) * 0.2);
            }

            const capture = await captureStageData();
            if (!capture) return;

            state.stageDataUrl = capture.dataUrl;
            state.stageWidth = capture.width;
            state.stageHeight = capture.height;
            state.trimBounds = null;

            if (filenameInput.value.trim().length === 0) {
                filenameInput.value = optionsRef.current.filename || 'drawing-export';
            }

            stageImage.src = capture.dataUrl;

            if (state.trimEmpty) {
                try {
                    state.trimBounds = await computeTrimBoundsFromDataUrl(capture.dataUrl);
                } catch {
                    state.trimBounds = null;
                }
                drawPreview();
            }
        };

        const closeModal = () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', handleResize);
            modal.remove();
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeModal();
            }
        };

        const handleResize = () => {
            updatePreviewScale();
        };

        overlay?.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeModal();
            }
        });

        closeButton?.addEventListener('click', () => closeModal());
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', handleResize);

        filenameInput.value = optionsRef.current.filename || 'drawing-export';

        filenameInput.addEventListener('input', () => {
            if (!filenameInput.value.trim()) {
                filenameInput.value = 'drawing-export';
            }
        });

        extSelect.addEventListener('change', () => {
            state.ext = extSelect.value;
            updateQualityState();
        });

        scaleInput.addEventListener('input', () => {
            state.scale = Number(scaleInput.value);
            updateScaleLabel();
            drawPreview();
        });

        qualityInput.addEventListener('input', () => {
            state.quality = Number(qualityInput.value);
            updateQualityLabel();
        });

        trimCheckbox.addEventListener('change', () => {
            state.trimEmpty = trimCheckbox.checked;
            void updateStageCapture();
        });

        downloadBtn.addEventListener('click', () => {
            const ext = state.ext;
            const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
            const quality = ext === 'png' ? undefined : state.quality;
            const dataUrl = previewCanvas.toDataURL(mime, quality);
            const link = document.createElement('a');
            const name = filenameInput.value.trim() || 'drawing-export';
            link.download = name + '.' + ext;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });

        updateScaleLabel();
        updateQualityLabel();
        updateQualityState();

        void updateStageCapture();

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('resize', handleResize);
            modal.remove();
        };
    }, [exportTrigger, stageRef, trRef]);
};
