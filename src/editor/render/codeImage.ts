import { toCanvas } from 'bwip-js/browser';
import {
    CODE_FORMAT_PX_PER_MODULE,
    DEFAULT_SYMBOL_FILL,
    codeQuietModules,
} from '../../core/doc/objects';
import type { CodeFormat } from '../../core/doc/objects';
import { quietModulesOf, type GeneratedSymbol, type SymbolRenderOptions } from './assets';
import { codeBwipOptions, drawnPitchBelowMinModule, integerPx, padSymbol } from './symbolEngine';

/**
 * 2D-code engine (P11 W1) — bwip-js over every `bcid` in `CODE_FORMATS`
 * (datamatrix, azteccode, pdf417, microqrcode, codeone, hanxin, ultracode).
 *
 * Like QR/barcodes, the symbol is generated up-front as a raster at the largest
 * **integer** scale ≥ 1 that fits the target box, and returned **as generated**
 * (never resampled — a nearest-neighbour downscale corrupts the module matrix).
 * One uniform `scale` on both axes keeps modules square; a non-square format
 * (pdf417, and payload-dependent codeone/ultracode) letterboxes under the node's
 * `contain` fit — the QR path; 1D barcodes stretch instead.
 *
 * Device px per module is per-format (`CODE_FORMAT_PX_PER_MODULE`: the matrix
 * codes draw 2 px/module at scale 1, `pdf417` draws 1), so the measured symbol
 * extent is divided by it to recover the module grid. A **quiet zone** (default
 * per format, P2) is composited around the symbol ourselves — bwip's
 * `paddingwidth`/`paddingheight` stay 0 and `backgroundcolor` is never set, or
 * bwip would draw its own border and our quiet zone would double-count. `fill`
 * (default `DEFAULT_SYMBOL_FILL`, opaque white) is the background/quiet-zone
 * colour.
 *
 * The verdict is the **drawn** module pitch after the node's uniform `contain`
 * fit, not QR's target-based pitch: because codeone/ultracode are
 * payload-dependent and non-square, the "padded symbol fills the box" premise
 * does not hold, so we score `modulePx · containScale` instead.
 *
 * Any failure — empty payload, a format that rejects the data, a drawing error —
 * returns `null` and the caller renders a placeholder; the pipeline never
 * crashes.
 */

/**
 * Render `text` in `format` at the given target pixel box.
 *
 * @param minModulePx device px the module must reach to stay scannable.
 * @returns the integer-scaled, quiet-zone-padded symbol plus its module verdict,
 * or `null` when the payload cannot be rendered.
 */
export const renderCode = (
    text: string,
    format: CodeFormat,
    targetWpx: number,
    targetHpx: number,
    minModulePx = 1,
    options: SymbolRenderOptions = {},
): GeneratedSymbol | null => {
    if (!text) return null;
    if (typeof document === 'undefined') return null;
    const targetW = integerPx(targetWpx);
    const targetH = integerPx(targetHpx);
    const pxPerModule = CODE_FORMAT_PX_PER_MODULE[format];
    const quietModules = quietModulesOf(options.quietModules, codeQuietModules(format));
    const fill = options.fill ?? DEFAULT_SYMBOL_FILL;
    try {
        // Measure at scale 1 to recover the module grid and derive a largest
        // integer scale. `scale` divides the symbol into whole modules:
        // `baseW`/`baseH` are exact multiples of `pxPerModule` (pinned by the
        // `codeFormats` unit test), so the division has no remainder.
        const measure = document.createElement('canvas');
        toCanvas(measure, codeBwipOptions(text, format, 1));
        const baseW = measure.width;
        const baseH = measure.height;
        if (!baseW || !baseH) return null;

        const modulesW = baseW / pxPerModule;
        const modulesH = baseH / pxPerModule;
        const totalW = modulesW + 2 * quietModules;
        const totalH = modulesH + 2 * quietModules;
        const scale = Math.max(
            1,
            Math.floor(
                Math.min(targetW / (totalW * pxPerModule), targetH / (totalH * pxPerModule)),
            ),
        );

        const symbolCanvas = document.createElement('canvas');
        toCanvas(symbolCanvas, codeBwipOptions(text, format, scale));
        if (!symbolCanvas.width || !symbolCanvas.height) return null;

        // The module pitch is exact by construction (`pxPerModule · scale`); do
        // not recompute it from the rendered canvas.
        const modulePx = pxPerModule * scale;
        const quietPx = quietModules * modulePx;
        const canvas = padSymbol(symbolCanvas, quietPx, quietPx, fill);
        if (!canvas) return null;

        // The node draws the whole raster with `fit: 'contain'`, so the printed
        // module pitch is `modulePx` shrunk by the uniform contain scale.
        return {
            canvas,
            belowMinModule: drawnPitchBelowMinModule(
                modulePx,
                targetW,
                targetH,
                canvas.width,
                canvas.height,
                minModulePx,
            ),
        };
    } catch {
        return null;
    }
};
