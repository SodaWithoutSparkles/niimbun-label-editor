import { toCanvas } from 'bwip-js/browser';
import type { BarcodeSymbology } from '../../core/doc/objects';
import type { GeneratedSymbol } from './assets';

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
 * returned and the node's fit helper shrinks it.
 *
 * An invalid payload for a strict format (bad EAN/UPC length, CODE39 charset…)
 * throws inside bwip-js, so everything is caught: the caller gets `null` and
 * renders a placeholder — the pipeline never crashes.
 */

type BwipOptions = Parameters<typeof toCanvas>[1] & Record<string, unknown>;

const integerPx = (value: number): number =>
    Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;

/**
 * Render `text` in `symbology` at the given target pixel box.
 *
 * @param minModulePx device px the narrow module must reach to stay scannable.
 * @returns the integer-scaled bars plus their module verdict, or `null` when the
 * payload is invalid for the symbology.
 */
export const renderBarcode = (
    text: string,
    symbology: BarcodeSymbology,
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
        // (adding resolved padding/scale), so reusing one object would pin later
        // renders to the first values.
        const makeOpts = (sx: number, sy: number): BwipOptions => ({
            bcid: symbology,
            text,
            includetext: false,
            paddingwidth: 0,
            scaleX: sx,
            scaleY: sy,
        });

        // Measure at 1× to derive integer scales that fit the target. The module
        // width is `scaleX`; `scaleY` only stretches the bars vertically.
        const measure = document.createElement('canvas');
        toCanvas(measure, makeOpts(1, 1));
        const baseW = measure.width;
        const baseH = measure.height;
        if (!baseW || !baseH) return null;

        const scaleX = Math.max(1, Math.floor(targetW / baseW));
        const scaleY = Math.max(1, Math.floor(targetH / baseH));

        const canvas = document.createElement('canvas');
        toCanvas(canvas, makeOpts(scaleX, scaleY));
        if (!canvas.width || !canvas.height) return null;

        return { canvas, belowMinModule: scaleX < minModulePx };
    } catch {
        return null;
    }
};
