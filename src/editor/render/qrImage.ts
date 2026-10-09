import { toCanvas } from 'bwip-js/browser';
import type { QrErrorCorrection } from '../../core/doc/objects';
import type { GeneratedSymbol } from './assets';

/**
 * QR engine (P5 W2) — bwip-js `bcid:'qrcode'`.
 *
 * The render path is synchronous, so a QR is generated up-front as a raster by
 * `prepareResolvedAssets`. The symbol is rendered at the **largest integer scale
 * ≥ 1** that fits the target box and returned as-is: generated codes are never
 * resampled, because a nearest-neighbour downscale corrupts the module matrix.
 * When even scale 1 exceeds the target the scale-1 symbol is returned anyway
 * (`belowMinModule` reports the shortfall) and the node's fit helper places it —
 * the generator never returns `null` for an oversized box.
 *
 * Any failure — empty payload, oversized data, a drawing error — returns `null`
 * and the caller renders nothing rather than crashing the pipeline.
 */

type BwipOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

const integerPx = (value: number): number =>
    Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;

/**
 * Render `text` as a QR at the given target pixel box.
 *
 * @param minModulePx device px the module must reach to stay scannable.
 * @returns the integer-scaled symbol plus its module verdict, or `null` when the
 * payload cannot be rendered.
 */
export const renderQr = (
    text: string,
    errorCorrection: QrErrorCorrection,
    targetWpx: number,
    targetHpx: number,
    minModulePx = 1,
): GeneratedSymbol | null => {
    if (!text) return null;
    if (typeof document === 'undefined') return null;
    const targetW = integerPx(targetWpx);
    const targetH = integerPx(targetHpx);
    try {
        // A fresh options object per render: `toCanvas` mutates its options
        // (adding resolved scaleX/scaleY), so reusing one object would pin later
        // renders to the first scale.
        const makeOpts = (scale: number): BwipOptions => ({
            bcid: 'qrcode',
            text,
            eclevel: errorCorrection,
            scale,
            paddingwidth: 0,
            paddingheight: 0,
        });
        // Measure the symbol at scale 1 to derive a largest integer scale that
        // fits. One scale for both axes keeps the module grid square.
        const measure = document.createElement('canvas');
        toCanvas(measure, makeOpts(1));
        const baseW = measure.width;
        const baseH = measure.height;
        if (!baseW || !baseH) return null;

        const scale = Math.max(1, Math.floor(Math.min(targetW / baseW, targetH / baseH)));
        const canvas = document.createElement('canvas');
        toCanvas(canvas, makeOpts(scale));
        if (!canvas.width || !canvas.height) return null;

        // The verdict is on the **printed module**, not the integer raster scale.
        // bwip's `qrcode` lays down 2 device px per module at scale 1, so the
        // scale-1 `baseW` encodes `baseW / 2` modules. The symbol fills the
        // authored box (owner decision D), so the limiting box side divided by the
        // module count is the printed module pitch. `scale` is a unitless integer
        // and was wrongly compared to `minModulePx` (a 2× unit error). Other
        // bcids must be measured the same way before reusing this formula (P11).
        const moduleCount = Math.max(1, baseW / 2);
        const limitingPx = Math.min(targetW, targetH);
        return { canvas, belowMinModule: limitingPx / moduleCount < minModulePx };
    } catch {
        return null;
    }
};
