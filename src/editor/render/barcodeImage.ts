import { toCanvas } from 'bwip-js/browser';
import { DEFAULT_SYMBOL_FILL, barcodeQuietModules } from '../../core/doc/objects';
import type { BarcodeSymbology } from '../../core/doc/objects';
import { quietModulesOf, type GeneratedSymbol, type SymbolRenderOptions } from './assets';
import { barcodeBwipOptions, drawnPitchBelowMinModule, integerPx, padSymbol } from './symbolEngine';

/**
 * Barcode engine (P5 W3) — bwip-js, one generic path over every `bcid` in
 * `BARCODE_SYMBOLOGIES`.
 *
 * Like QR, barcodes are generated up-front as a raster. Integer `scaleX`/`scaleY`
 * (≥ 1) are chosen so the symbol fits the target box, and the symbol is returned
 * **as generated** — never resampled, because downscaling drops/merges bar
 * columns and makes the code unscannable. Text is disabled and the horizontal
 * padding removed so the bars fill the box. `belowMinModule` reports an
 * X-module below the 0.25 mm print minimum; an oversized symbol is still
 * returned and the node's fit helper **stretches** it to the box (1D barcodes
 * never letterbox and never crop — the raster is generated at the box size, so
 * stretch is ~identity). The verdict is on the **drawn** X-module pitch: the
 * integer `scaleX` times the node's X draw scale `targetW / canvasW`, not the
 * bare integer `scaleX`. The box height does not enter it, because a 1D bar
 * pitch is an X measurement.
 *
 * A **horizontal quiet zone** (default per symbology, P2) is composited around
 * the bars ourselves. `scaleX` is chosen against the **padded** width and stays
 * the integer narrow-module scale of the generated raster; `fill` (default
 * `DEFAULT_SYMBOL_FILL`, opaque white) is the background/quiet-zone colour.
 *
 * An invalid payload for a strict format (bad EAN/UPC length, CODE39 charset…)
 * throws inside bwip-js, so everything is caught: the caller gets `null` and
 * renders a placeholder — the pipeline never crashes.
 */

/**
 * Render `text` in `symbology` at the given target pixel box.
 *
 * @param minModulePx device px the narrow module must reach to stay scannable.
 * @returns the integer-scaled, quiet-zone-padded bars plus their module verdict,
 * or `null` when the payload is invalid for the symbology.
 */
export const renderBarcode = (
    text: string,
    symbology: BarcodeSymbology,
    targetWpx: number,
    targetHpx: number,
    minModulePx = 1,
    options: SymbolRenderOptions = {},
): GeneratedSymbol | null => {
    if (!text) return null;
    if (typeof document === 'undefined') return null;
    const targetW = integerPx(targetWpx);
    const targetH = integerPx(targetHpx);
    const quietModules = quietModulesOf(options.quietModules, barcodeQuietModules(symbology));
    const fill = options.fill ?? DEFAULT_SYMBOL_FILL;
    try {
        // Measure at 1× to derive integer scales that fit the target. At scale 1
        // the narrow module is 1 px, so `baseW` is the total narrow-module count
        // and `scaleX` is the module pitch. The quiet zone is horizontal only.
        const measure = document.createElement('canvas');
        toCanvas(measure, barcodeBwipOptions(text, symbology, 1, 1));
        const baseW = measure.width;
        const baseH = measure.height;
        if (!baseW || !baseH) return null;

        const totalModules = baseW + 2 * quietModules;
        const scaleX = Math.max(1, Math.floor(targetW / totalModules));
        const scaleY = Math.max(1, Math.floor(targetH / baseH));

        const symbolCanvas = document.createElement('canvas');
        toCanvas(symbolCanvas, barcodeBwipOptions(text, symbology, scaleX, scaleY));
        if (!symbolCanvas.width || !symbolCanvas.height) return null;

        const quietPx = quietModules * scaleX;
        const canvas = padSymbol(symbolCanvas, quietPx, 0, fill);
        if (!canvas) return null;

        // `scaleX` was chosen against the padded width, so it is the integer
        // narrow-module scale of the raster we return. The node draws the whole
        // canvas with `fit: 'stretch'` (1D barcodes fill their box; no crop, no
        // letterbox), so the **printed** X-module pitch is `scaleX` times
        // `targetW / canvas.width` — the width scale only. The box height never
        // shrinks a bar; it only rescales their length.
        return {
            canvas,
            belowMinModule: drawnPitchBelowMinModule(
                scaleX,
                targetW,
                targetH,
                canvas.width,
                canvas.height,
                minModulePx,
                'stretch',
            ),
        };
    } catch {
        return null;
    }
};
