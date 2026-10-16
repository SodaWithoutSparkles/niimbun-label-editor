import { toCanvas } from 'bwip-js/browser';
import { DEFAULT_QR_QUIET_MODULES, DEFAULT_SYMBOL_FILL } from '../../core/doc/objects';
import type { QrErrorCorrection } from '../../core/doc/objects';
import { quietModulesOf, type GeneratedSymbol, type SymbolRenderOptions } from './assets';
import { integerPx, padSymbol, qrBwipOptions } from './symbolEngine';

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
 * A **quiet zone** (default 4 modules/side, P2) is composited around the symbol
 * ourselves — never via bwip's scale-unit `paddingwidth`. The padded canvas is
 * what gets fitted into the node box, so the effective module pitch is
 * `box / (moduleCount + 2·quietModules)`; the verdict is measured on that pitch.
 * `fill` (default `DEFAULT_SYMBOL_FILL`, opaque white) is the quiet-zone/background
 * colour: it paints an opaque background, `'transparent'` leaves the zone (and
 * light modules) see-through.
 *
 * Any failure — empty payload, oversized data, a drawing error — returns `null`
 * and the caller renders nothing rather than crashing the pipeline.
 */

/**
 * Render `text` as a QR at the given target pixel box.
 *
 * @param minModulePx device px the module must reach to stay scannable.
 * @returns the integer-scaled, quiet-zone-padded symbol plus its module verdict,
 * or `null` when the payload cannot be rendered.
 */
export const renderQr = (
    text: string,
    errorCorrection: QrErrorCorrection,
    targetWpx: number,
    targetHpx: number,
    minModulePx = 1,
    options: SymbolRenderOptions = {},
): GeneratedSymbol | null => {
    if (!text) return null;
    if (typeof document === 'undefined') return null;
    const targetW = integerPx(targetWpx);
    const targetH = integerPx(targetHpx);
    const quietModules = quietModulesOf(options.quietModules, DEFAULT_QR_QUIET_MODULES);
    const fill = options.fill ?? DEFAULT_SYMBOL_FILL;
    try {
        // Measure the symbol at scale 1 to derive a largest integer scale that
        // fits the **padded** canvas. One scale for both axes keeps the module
        // grid square.
        const measure = document.createElement('canvas');
        toCanvas(measure, qrBwipOptions(text, errorCorrection, 1));
        const baseW = measure.width;
        const baseH = measure.height;
        if (!baseW || !baseH) return null;

        // bwip's `qrcode` lays down 2 device px per module at scale 1.
        const moduleCount = Math.max(1, baseW / 2);
        const totalModules = moduleCount + 2 * quietModules;
        const paddedBaseW = totalModules * 2;
        const scale = Math.max(1, Math.floor(Math.min(targetW / paddedBaseW, targetH / paddedBaseW)));

        const symbolCanvas = document.createElement('canvas');
        toCanvas(symbolCanvas, qrBwipOptions(text, errorCorrection, scale));
        if (!symbolCanvas.width || !symbolCanvas.height) return null;

        const modulePx = symbolCanvas.width / moduleCount; // = 2 * scale
        const quietPx = Math.round(quietModules * modulePx);

        const canvas = padSymbol(symbolCanvas, quietPx, quietPx, fill);
        if (!canvas) return null;

        // The verdict is on the **printed module**, not the integer raster scale.
        // The padded symbol fills the authored box (owner decision D), so the
        // limiting box side over the total module count (symbol + quiet zone) is
        // the printed module pitch.
        const limitingPx = Math.min(targetW, targetH);
        return { canvas, belowMinModule: limitingPx / totalModules < minModulePx };
    } catch {
        return null;
    }
};
