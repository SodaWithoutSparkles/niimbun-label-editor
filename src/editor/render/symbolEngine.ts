import type { toCanvas } from 'bwip-js/browser';
import { hasFill } from '../../core/doc/objects';
import type { BarcodeSymbology, CodeFormat, QrErrorCorrection } from '../../core/doc/objects';

/**
 * Shared bwip-js symbol internals (P11 W1) — the pieces `renderQr`,
 * `renderBarcode` and `renderCode` used to copy-paste: the options type, the
 * integer-pixel clamp, the per-shape options builders, the quiet-zone-padded
 * composite, and the drawn-pitch verdict.
 *
 * Pure adapter code: no Konva, no `prepareAssets`, no document model. Renderers
 * own their own scale math (QR and 1D codes budget against the padded module
 * count; 2D codes against the padded device-px extent) and call in here only for
 * the shared mechanics.
 */

/** bwip-js options plus the encoder-specific keys it accepts (`eclevel`, `scaleX`…). */
export type BwipOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

/** Non-negative integer device px; a non-finite value falls back to 1. */
export const integerPx = (value: number): number =>
    Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;

/**
 * Fresh bwip-js options for a QR at a given integer `scale`. Must be a fresh
 * object per call: `toCanvas` mutates its options (writing back resolved
 * scaleX/scaleY), so reusing one would pin later renders to the first scale.
 */
export const qrBwipOptions = (
    text: string,
    errorCorrection: QrErrorCorrection,
    scale: number,
): BwipOptions => ({
    bcid: 'qrcode',
    text,
    eclevel: errorCorrection,
    scale,
    paddingwidth: 0,
    paddingheight: 0,
});

/**
 * Fresh bwip-js options for a 1D barcode at the given integer narrow-module
 * scales. Fresh per call for the same reason as {@link qrBwipOptions}.
 */
export const barcodeBwipOptions = (
    text: string,
    symbology: BarcodeSymbology,
    scaleX: number,
    scaleY: number,
): BwipOptions => ({
    bcid: symbology,
    text,
    includetext: false,
    paddingwidth: 0,
    scaleX,
    scaleY,
});

/**
 * Fresh bwip-js options for a 2D code at a given **uniform integer** `scale`
 * (both axes share one scale so modules stay square; non-square formats letterbox
 * under the node's `contain` fit). Fresh per call, as above.
 */
export const codeBwipOptions = (text: string, format: CodeFormat, scale: number): BwipOptions => ({
    bcid: format,
    text,
    scale,
    paddingwidth: 0,
    paddingheight: 0,
});

/**
 * Composite a rendered bwip-js symbol into a quiet-zone-padded canvas: paint the
 * whole canvas in `fill` when it deposits ink, then copy the symbol 1:1 at
 * `(quietPxX, quietPxY)` with smoothing off (never resample the module matrix).
 *
 * @returns the padded canvas, or `null` when no 2D context is available.
 */
export const padSymbol = (
    symbolCanvas: HTMLCanvasElement,
    quietPxX: number,
    quietPxY: number,
    fill: string,
): HTMLCanvasElement | null => {
    const canvas = document.createElement('canvas');
    canvas.width = symbolCanvas.width + 2 * quietPxX;
    canvas.height = symbolCanvas.height + 2 * quietPxY;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (hasFill(fill)) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(symbolCanvas, quietPxX, quietPxY);
    return canvas;
};

/**
 * Verdict for the **drawn** module pitch: the node draws the whole raster with a
 * uniform `contain` fit, so the printed pitch is `modulePx` shrunk by
 * `min(targetW/canvasW, targetH/canvasH)`. True when that falls below
 * `minModulePx` (a height-constrained box shrinks the whole raster, matrix codes
 * included).
 */
export const drawnPitchBelowMinModule = (
    modulePx: number,
    targetW: number,
    targetH: number,
    canvasW: number,
    canvasH: number,
    minModulePx: number,
): boolean => {
    const drawScale =
        canvasW > 0 && canvasH > 0 ? Math.min(targetW / canvasW, targetH / canvasH) : 1;
    return modulePx * drawScale < minModulePx;
};
