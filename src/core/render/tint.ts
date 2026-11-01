/**
 * Luminance tinting: recolour an RGBA raster toward one ink colour.
 *
 * Pure and headless — it operates on the structural `RgbaBuffer` shape, not the
 * DOM `ImageData` (though an `ImageData` is structurally compatible).
 *
 * The rule, per pixel:
 *
 *     out = 255 + (tint - 255) * (1 - L / 255),  L = monoLuminance(r, g, b)
 *
 * i.e. blend white → tint by source **darkness**. The source hue is ignored on
 * purpose: a tint selects the **ink colour**, while the source luminance selects
 * ink **density**.
 *
 * - red tint on a neutral grey `L` yields `(255, L, L)` — the red/black palette
 *   then diffuses it into red/white dots in proportion to darkness (a greyscale
 *   image "dithered in red only");
 * - black tint on neutral grey is the identity (`out = L`); a white tint erases
 *   (all channels 255);
 * - the alpha byte is never touched.
 *
 * `'transparent'` or an unparseable colour is a no-op (validation already
 * rejects the latter; this keeps the helper total).
 */

import type { RgbaBuffer } from './colorspace';
import { monoLuminance } from './colorspace';

/**
 * Parse a `ColorPicker` hex colour into its RGB channels. Accepts the same
 * forms validation does: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Alpha (when
 * present) is ignored — a tint is opaque; its role is picking the ink hue.
 */
export const parseHexColor = (color: string): [number, number, number] | undefined => {
    if (typeof color !== 'string' || color.charAt(0) !== '#') return undefined;
    const hex = color.slice(1);
    if (hex.length !== 3 && hex.length !== 4 && hex.length !== 6 && hex.length !== 8) {
        return undefined;
    }
    if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
    const expand = (pair: string): number => parseInt(pair, 16);
    if (hex.length === 3 || hex.length === 4) {
        return [
            expand(hex.charAt(0) + hex.charAt(0)),
            expand(hex.charAt(1) + hex.charAt(1)),
            expand(hex.charAt(2) + hex.charAt(2)),
        ];
    }
    return [
        expand(hex.slice(0, 2)),
        expand(hex.slice(2, 4)),
        expand(hex.slice(4, 6)),
    ];
};

/** Clamp to a byte, rounding half up (so the result is deterministic). */
const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Recolour every RGB triple by luminance toward `tint`, preserving alpha.
 * `'transparent'` / unparseable colours are a no-op. Mutates in place and
 * returns the same buffer.
 */
export const tintRgbaByLuminance = (rgba: RgbaBuffer, tint: string): RgbaBuffer => {
    if (tint === 'transparent') return rgba;
    const target = parseHexColor(tint);
    if (!target) return rgba;
    const [tr, tg, tb] = target;
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        // 1 - L/255: how dark the source pixel is (1 = black, 0 = white).
        const darkness = 1 - monoLuminance(r, g, b) / 255;
        data[i] = byte(255 + (tr - 255) * darkness);
        data[i + 1] = byte(255 + (tg - 255) * darkness);
        data[i + 2] = byte(255 + (tb - 255) * darkness);
    }
    return rgba;
};
