import { monoLuminance, type RgbaBuffer } from './colorspace';
import { buildToneLut, normalizeGamma, toByte } from './preprocess';

/**
 * Palette diffusion: tone-mapped RGBA(A) → exact N-entry palette pixels. Pure
 * and headless — no React, Konva, DOM, document or store state.
 *
 * The mono engine (`quantize.ts`) is the 2-entry special case, but this module
 * is kept separate rather than widening it: the existing 1-bit strategies and
 * their goldens must stay byte-identical, and a palette engine needs a
 * per-entry nearest test plus a 3-channel error vector.
 *
 * Two palette engines live here:
 *
 *  - {@link diffuseToPalette} spreads a full RGB **vector**
 *    (`source - chosenEntry`) on all three channel planes. That is correct for
 *    `redBlackPalette`, whose entries differ in hue: decomposing into two scalar
 *    diffusions (black plane + red plane) would mis-mix dark red regions, where
 *    every pixel sits *between* black and red rather than on one of them.
 *  - {@link diffuseRamp} spreads **one scalar luminance plane** for an ordered
 *    neutral ramp (`grayscaleRampPalette`). A neutral palette has no chroma
 *    sink, so an RGB-vector residual would clip against `0..255` and collapse
 *    the luminance instead of dithering it.
 *
 * Memory: three `Float32Array(width * height)` working planes at ≈12 bytes/px
 * on top of the 4-byte/px RGBA buffer. At the run's 16 M px cap that is
 * ~192 MB, hence the long-label buffer risk already tracked by the run; keep
 * the planes scoped to the call and never cache them.
 */

/**
 * Print-time page colour. The document itself stays colour-agnostic: the same
 * authored pixels are mapped to a different printable palette when the page is
 * rendered for a given mode.
 *
 * - `'mono'` — the 1-bit black/white page (the pre-existing path).
 * - `'grayscale'` — the printer's 16-level grey ramp ({@link grayscaleRampPalette}).
 * - `'redBlack'` — a two-ink page ({@link redBlackPalette}); flat art takes the
 *   point-op mask path, images diffuse.
 */
export type PageColorMode = 'mono' | 'grayscale' | 'redBlack';

/**
 * One printable output colour. Values are the **exact** bytes written to RGB,
 * so they must stay integral: the encoder matches output by exact
 * `0xffffff` / `0xff0000` / everything-else-is-black.
 */
export interface PaletteEntry {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    /**
     * Calibration weight on the squared channel distance; default 1.
     *
     * This is the hook for heat-selected ink: a thermal red dot is not as dark
     * as a black dot at the same dot count (red is heat-selected, not pigment),
     * so treating the entries as equally spaced RGB primaries is a first
     * approximation, not a measured truth. P7's printed test pattern
     * calibrates these numbers; until that print exists every weight stays `1`
     * — no hand-tuned constants ship in this phase.
     */
    readonly weight?: number;
}

/** A printable palette: ordered entries plus an optional nearest-entry test. */
export interface Palette {
    readonly id: string;
    readonly entries: readonly PaletteEntry[];
    /**
     * Closest entry for a (possibly float, possibly out-of-range) source
     * pixel. Defaults to weighted squared RGB distance. `nearestPaletteEntry`
     * clamps the probe to `0..255` before calling this, so an implementation
     * never sees an extrapolated colour.
     */
    readonly nearest?: (r: number, g: number, b: number) => number;
}

/** Diffusion knobs. All neutral defaults preserve the plain nearest-colour op. */
export interface PaletteDiffuseOptions {
    /**
     * 0 → nearest entry with no diffusion; 1 → standard Floyd–Steinberg;
     * >1 stronger (error amplified before distribution). Clamped to `>= 0`.
     * A non-finite strength normalizes to the neutral `1`, matching how the
     * engine normalizes gamma — never NaN into the planes.
     */
    strength?: number;
    /** Serpentine scanning (reverse rows scan right-to-left). Default true. */
    serpentine?: boolean;
    /**
     * Tone curve on **luminance**, hue-preserving; neutral `1` (no rounding, no
     * curve). Default 1.
     */
    gamma?: number;
    /**
     * Per-pixel **point-op mask**: a zero byte diffuses normally, a non-zero
     * byte takes the flat path — one exact palette entry, classified from the
     * **raw source** bytes, with no error emitted. Any error a diffuse neighbour
     * already deposited on a flat pixel is discarded (the energy is lost at the
     * seam, exactly like a clipped tap). Length must equal `width * height`;
     * anything else throws a `RangeError` before any pixel is touched.
     *
     * This is what keeps authored flat colour (text, symbols) crisp while an
     * image beside it still dithers — see {@link classifyFlatRedBlack}. The
     * mask is built from the existing per-object quantizer policies, so
     * `policyKeyOf` and the policy vocabulary are unchanged (page colour is
     * already keyed separately).
     */
    flat?: Uint8Array;
    /**
     * Palette index for a flat pixel, or `undefined` for
     * {@link nearestPaletteEntry}. It receives the **source** RGB — assumed
     * `0..255` bytes, before tone mapping and before any diffusion error — so a
     * classifier such as {@link classifyFlatRedBlack} sees the authored colour.
     */
    flatNearest?: (r: number, g: number, b: number) => number;
}

/**
 * The grey byte at the **centre** of library gray level `k`: `255 - 17k`
 * (0 → white, 15 → black).
 *
 * Derivation, from `ImageEncoder.colorToGrayLevel`
 * (`@mmote/niimbluelib` 0.49, `dist/cjs/utils/image_encoder.js:59-66`): a
 * neutral grey `g` has BT.601 luminance `g`, and the encoder computes
 * `round(15 * (1 - g / 255))`, so level `k` covers
 * `g ∈ (255 - 17k - 8.5, 255 - 17k + 8.5)`. Fifteen levels span exactly 255, so
 * the band centres are exact integers `255 - 17k` — a pixel authored at a
 * centre re-encodes to that same level with no rounding slack. That is what
 * keeps preview ≡ print and makes an exact ramp value dither-free.
 */
export const grayLevelColor = (level: number): number => 255 - 17 * level;

/** Levels in the printer's grayscale page colour (`0` = white … `15` = black). */
export const GRAYSCALE_LEVELS = 16;

/**
 * The 16-level grayscale PageColor ramp: index == library level, ordered
 * 0 = white → 15 = black, each entry at its exact band centre.
 *
 * `nearest` mirrors `ImageEncoder.colorToGrayLevel` rather than using squared
 * RGB distance. For a neutral target the squared-distance nearest grey is the
 * channel **mean**, `(r + g + b) / 3`, which disagrees with the encoder's
 * BT.601 luminance on coloured input (saturated green: luminance ≈ 150, channel
 * mean 85) and would make the preview pick a different level from the print.
 * That is why this palette — and not every palette — carries a `nearest`.
 */
export const grayscaleRampPalette = (): Palette => ({
    id: 'grayscale-ramp',
    entries: Array.from({ length: GRAYSCALE_LEVELS }, (_, level) => {
        const value = grayLevelColor(level);
        return { r: value, g: value, b: value };
    }),
    // Library formula, mirrored: `clamp(round((1 - L / 255) * 15), 0, 15)`.
    nearest: (r, g, b) =>
        Math.max(0, Math.min(15, Math.round((1 - monoLuminance(r, g, b) / 255) * 15))),
});

/**
 * The DoubleColor page palette: `[white, black, red]`, no `nearest` (default
 * weighted squared RGB distance).
 *
 * The entries are the three exact colours the encoder's two planes understand,
 * so a pixel is always either background, a black dot or a red dot. Thermal red
 * is heat-selected rather than pigment, so the RGB distance to red is a
 * calibration value, verified against P7's printed test pattern — see
 * `PaletteEntry.weight`.
 */
export const redBlackPalette = (): Palette => ({
    id: 'red-black',
    entries: [
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 0, b: 0 },
    ],
});

/** `redBlackPalette()` index of white paper. */
export const RED_BLACK_WHITE = 0;
/** `redBlackPalette()` index of black ink. */
export const RED_BLACK_BLACK = 1;
/** `redBlackPalette()` index of red ink. */
export const RED_BLACK_RED = 2;

/**
 * Flat-pixel classifier for the red/black page: one exact palette index, no
 * diffusion.
 *
 * 1. **Red dominance first**: `r > g && r > b` → red. Colour is truth — any
 *    red-dominant authored pixel is red ink, at any luminance. That also keeps
 *    antialiased red glyph edges red (their edge pixels blend red with paper and
 *    stay red-dominant), so flat red text prints crisp rather than ragged. Red
 *    dominance is gamma-independent: the tone curve only moves the grey axis.
 * 2. Otherwise threshold the **luminance** (BT.601, gamma-curved): `< threshold`
 *    → black, else white. A plain nearest-RGB test would send mid grey to white
 *    (white is marginally closer than black in RGB), which would make mid-grey
 *    text vanish; luminance keeps the authored cut.
 *
 * `gamma` uses the same `buildToneLut`/`toByte` curve as the diffusion path, so
 * a flat and a diffuse region authored at the same grey stay consistent.
 */
export const classifyFlatRedBlack = (
    r: number,
    g: number,
    b: number,
    threshold = 128,
    gamma = 1,
): number => {
    if (r > g && r > b) return RED_BLACK_RED;
    // Round into the LUT's byte domain first: the BT.601 weights sum to
    // 0.9999999999999999 in floats, so an authored `#808080` would otherwise
    // measure 127.999… and fall *below* a 128 cutoff. `toByte` makes the
    // classifier agree with the authored byte ("luminance 128 is not < 128").
    const luminance = toByte(monoLuminance(r, g, b));
    const mapped = normalizeGamma(gamma) === 1 ? luminance : buildToneLut(gamma)[luminance];
    return mapped < threshold ? RED_BLACK_BLACK : RED_BLACK_WHITE;
};

/** Clamp one channel to the 8-bit domain the palettes are expressed in. */
const clampChannel = (value: number): number => Math.min(255, Math.max(0, value));

/**
 * Index of the closest palette entry for a probe pixel.
 *
 * Diffusion error can push a working plane outside `0..255`, so the probe is
 * clamped before measuring: the nearest test must answer "closest printable
 * colour to this *clamped* colour", never extrapolate. Ties go to the earlier
 * entry (strict `<`), which keeps entry order meaningful.
 */
export const nearestPaletteEntry = (
    palette: Palette,
    r: number,
    g: number,
    b: number,
): number => {
    if (palette.entries.length === 0) {
        throw new Error('nearestPaletteEntry: palette has no entries');
    }

    const pr = clampChannel(r);
    const pg = clampChannel(g);
    const pb = clampChannel(b);
    if (palette.nearest) return palette.nearest(pr, pg, pb);

    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < palette.entries.length; index++) {
        const entry = palette.entries[index];
        const dr = pr - entry.r;
        const dg = pg - entry.g;
        const db = pb - entry.b;
        // Weight scales the whole squared distance, so `weight < 1` makes an
        // entry cheaper to select (the calibration knob for heat-selected ink).
        const distance = (entry.weight ?? 1) * (dr * dr + dg * dg + db * db);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    }
    return best;
};

/**
 * Floyd–Steinberg taps as `[dx, dy, numerator]` over the shared denominator
 * `FS_DENOM` (7 + 3 + 5 + 1 = 16, so the error is conserved).
 */
const FS_TAPS: readonly (readonly [number, number, number])[] = [
    [1, 0, 7],
    [-1, 1, 3],
    [0, 1, 5],
    [1, 1, 1],
];

const FS_DENOM = 16;

/**
 * Map `rgba` onto `palette` with serpentine Floyd–Steinberg vector error
 * diffusion. Mutates in place and returns the same buffer, matching every other
 * engine in this folder.
 *
 * Order of operations:
 *
 *  1. Copy RGB into three float planes. Alpha is never read, so every alpha
 *     byte survives untouched.
 *  2. Tone-map when `gamma !== 1` (normalized like the mono engine, so a
 *     non-finite gamma is neutral). The curve acts on **luminance**:
 *     `L' = lut[toByte(L)]`, then all three channels scale by `L' / L`, clamped
 *     to `0..255`. A uniform scale preserves hue and saturation, whereas a
 *     per-channel LUT would shift hue — that is why this is not a plain RGB
 *     curve. `L === 0` stays black (division guard, and black is a fixed
 *     point); `lut[0] = 0` and `lut[255] = 255`, so flat authored `0` / `255`
 *     endpoints are unchanged by any gamma.
 *  3. Serpentine scan: `7/16` forward on the current row, then `3/16` (back
 *     diagonal), `5/16` (below) and `1/16` (forward diagonal) on the next row.
 *     Reverse rows mirror the taps by negating the column offset; taps that
 *     fall outside the raster are dropped, exactly like the mono diffusers.
 *     `strength` multiplies the error vector *before* distribution and is
 *     clamped to `>= 0`; `0` degenerates to a pure nearest-colour point op.
 *     A non-finite `strength` normalizes to the neutral `1`, matching how
 *     `gamma` is normalized above — a `NaN` never reaches the working planes.
 *  4. Write the chosen entry's exact integer bytes to RGB. Entries are never
 *     blended, so every output pixel is a palette colour — the encoder relies
 *     on exact `#ffffff` / `#ff0000` matches.
 *
 * With `flat`, a masked pixel is a **point op** instead: its entry comes from
 * `flatNearest` applied to the raw source bytes, it emits no error, and any
 * error already deposited on it by a diffuse neighbour is discarded. Flat art
 * (authored text/symbols) therefore stays crisp while an image in the same page
 * still dithers. A `flat` plane of the wrong length is a `RangeError` — the
 * caller's mask must be one byte per pixel.
 *
 * D-05 (cross-policy seam drift): a page palette is still a page-level decision,
 * but the per-object policies no longer stay 1-bit — in this pass the same
 * policies choose **flat vs diffuse** per pixel (see `flat` above). The seam
 * debt stays: two diffusing objects still meet through a shared error field, and
 * a flat object beside a diffuse one still discards the deposited error, so the
 * two policies' output drifts at their border. Recorded here deliberately; not
 * fixed in this phase.
 */
export const diffuseToPalette = (
    rgba: RgbaBuffer,
    palette: Palette,
    options: PaletteDiffuseOptions = {},
): RgbaBuffer => {
    const { strength = 1, serpentine = true, gamma = 1, flat, flatNearest } = options;
    const { data, width, height } = rgba;
    const count = width * height;

    if (flat !== undefined && flat.length !== count) {
        throw new RangeError(
            `diffuseToPalette: flat mask length ${flat.length} does not match ${width}×${height} = ${count}`,
        );
    }

    const red = new Float32Array(count);
    const green = new Float32Array(count);
    const blue = new Float32Array(count);
    for (let p = 0, i = 0; p < count; p++, i += 4) {
        red[p] = data[i];
        green[p] = data[i + 1];
        blue[p] = data[i + 2];
    }

    // Tone map on luminance only: one scale factor per pixel keeps hue intact.
    if (normalizeGamma(gamma) !== 1) {
        const lut = buildToneLut(gamma);
        for (let p = 0; p < count; p++) {
            const r = red[p];
            const g = green[p];
            const b = blue[p];
            const luminance = monoLuminance(r, g, b);
            if (luminance === 0) continue;
            const scale = lut[toByte(luminance)] / luminance;
            red[p] = clampChannel(r * scale);
            green[p] = clampChannel(g * scale);
            blue[p] = clampChannel(b * scale);
        }
    }

    const diffusionStrength = Number.isFinite(strength) ? Math.max(0, strength) : 1;

    for (let y = 0; y < height; y++) {
        const reverse = serpentine && (y & 1) !== 0;
        const start = reverse ? width - 1 : 0;
        const end = reverse ? -1 : width;
        const step = reverse ? -1 : 1;
        const direction = reverse ? -1 : 1;

        for (let x = start; x !== end; x += step) {
            const p = y * width + x;
            const r = red[p];
            const g = green[p];
            const b = blue[p];
            const offset = p * 4;
            const isFlat = flat !== undefined && flat[p] !== 0;

            let entry: PaletteEntry;
            if (isFlat) {
                // Classify the **raw source** bytes: `data` at this pixel is
                // still unmodified, while `red`/`green`/`blue` may already carry
                // error a diffuse neighbour deposited. Flat art is authored
                // colour, not a diffusion estimate, so the error is discarded
                // below rather than allowed to move the entry.
                const sr = data[offset];
                const sg = data[offset + 1];
                const sb = data[offset + 2];
                entry = palette.entries[
                    flatNearest
                        ? flatNearest(sr, sg, sb)
                        : nearestPaletteEntry(palette, sr, sg, sb)
                ];
            } else {
                entry = palette.entries[nearestPaletteEntry(palette, r, g, b)];
            }

            data[offset] = entry.r;
            data[offset + 1] = entry.g;
            data[offset + 2] = entry.b;

            // A flat pixel emits no error: it is a point op, so it neither
            // diffuses its own residual nor forwards a neighbour's.
            if (isFlat || diffusionStrength === 0) continue;

            const errorR = (r - entry.r) * diffusionStrength;
            const errorG = (g - entry.g) * diffusionStrength;
            const errorB = (b - entry.b) * diffusionStrength;
            if (errorR === 0 && errorG === 0 && errorB === 0) continue;

            for (const [dx, dy, numerator] of FS_TAPS) {
                const nx = x + dx * direction;
                const ny = y + dy;
                // ny >= 0 always (dy is 0 or 1) and ny only grows forward.
                if (nx < 0 || nx >= width || ny >= height) continue;
                const q = ny * width + nx;
                red[q] += (errorR * numerator) / FS_DENOM;
                green[q] += (errorG * numerator) / FS_DENOM;
                blue[q] += (errorB * numerator) / FS_DENOM;
            }
        }
    }

    return rgba;
};

/** Scalar-ramp diffusion knobs. All neutral defaults preserve the nearest op. */
export interface RampDiffuseOptions {
    /**
     * 0 → nearest entry with no diffusion; 1 → standard Floyd–Steinberg;
     * >1 stronger (error amplified before distribution). Clamped to `0..4`.
     * A non-finite strength normalizes to the neutral `1`, matching
     * {@link diffuseToPalette} — a `NaN` never reaches the scalar plane.
     */
    strength?: number;
    /** Serpentine scanning (reverse rows scan right-to-left). Default true. */
    serpentine?: boolean;
    /** Tone curve on the scalar luminance. Neutral `1`; default 1. */
    gamma?: number;
}

/**
 * Map `rgba` onto an ordered neutral `palette` with serpentine Floyd–Steinberg
 * diffusion on **one scalar luminance plane**. Mutates in place and returns the
 * same buffer, matching every other engine in this folder.
 *
 * Entry selection and the diffused error use `entry.r`, so a non-neutral palette
 * is rejected rather than silently mis-rendered.
 *
 * **Why a scalar plane.** A neutral ramp has no chroma sink. The vector engine
 * ({@link diffuseToPalette}) spreads a `(R, G, B)` residual, but for a
 * saturated source that chroma error has nowhere to land: the three planes clip
 * against `0..255`, and the luminance that survives collapses (a flat red field
 * drifts to one dark level instead of dithering at its own tone). Diffusing the
 * luminance the palette actually selects by keeps the error on the quantised
 * axis — the tone is conserved and the output stays on the same 16-level ramp.
 *
 * **Why entry-value nearest.** The entry is chosen by minimising
 * `Math.abs(entry.r - L)`, **not** by `palette.nearest`. With
 * {@link grayscaleRampPalette} the band centres are the exact integers
 * `255 - 17k`, so these boundaries fall midway (`246.5`, `229.5`, …) and this
 * test reproduces `ImageEncoder.colorToGrayLevel` exactly. Calling
 * `nearest(L, L, L)` would re-apply the BT.601 weights, whose float sum is
 * `0.9999999999999999`; a value sitting on a boundary can then flip to the
 * other level and make preview ≠ print. The accumulated scalar is already a
 * luminance, so it is used unclamped (diffusion may push it outside `0..255`
 * without affecting the nearest test). Ties go to the earlier entry.
 *
 * Order of operations:
 *
 *  1. Copy BT.601 luminance of every source pixel into one `Float32Array`.
 *     Alpha is never read, so every alpha byte survives untouched.
 *  2. Tone-map when `normalizeGamma(gamma) !== 1`: `L' = lut[toByte(L)]`. Unlike
 *     the vector engine there is no hue to preserve, so a plain scalar curve is
 *     correct — and the neutral path does not round the copied luminance.
 *     `lut[0] = 0` and `lut[255] = 255`, so the endpoints stay fixed.
 *  3. Serpentine scan: `7/16` forward on the current row, then `3/16` (back
 *     diagonal), `5/16` (below) and `1/16` (forward diagonal) on the next row.
 *     Reverse rows mirror the taps by negating the column offset; out-of-bounds
 *     taps are dropped. `strength` multiplies the error *before* distribution
 *     and is clamped to `0..4`; `0` degenerates to a nearest-value point op. A
 *     non-finite `strength` normalizes to the neutral `1`.
 *  4. Write the chosen entry's exact integer bytes to RGB. Entries are never
 *     blended, so every output pixel is a palette colour.
 *
 * Defaults are neutral: `strength 1`, `serpentine true`, `gamma 1`.
 */
export const diffuseRamp = (
    rgba: RgbaBuffer,
    palette: Palette,
    options: RampDiffuseOptions = {},
): RgbaBuffer => {
    const { strength = 1, serpentine = true, gamma = 1 } = options;
    const { data, width, height } = rgba;
    const count = width * height;
    const entries = palette.entries;

    if (entries.length === 0) {
        // Same wording style as `nearestPaletteEntry`: fail before touching px.
        throw new Error('diffuseRamp: palette has no entries');
    }
    for (const entry of entries) {
        if (entry.r !== entry.g || entry.g !== entry.b) {
            throw new Error('diffuseRamp: palette must be a neutral ramp (r = g = b)');
        }
    }

    // One scalar plane: the same BT.601 luminance the encoder's grey-level test
    // uses. Alpha is opacity metadata, never ink, so it is not read.
    const plane = new Float32Array(count);
    for (let p = 0, i = 0; p < count; p++, i += 4) {
        plane[p] = monoLuminance(data[i], data[i + 1], data[i + 2]);
    }

    // A scalar curve is exact here: there is no hue to preserve, unlike the
    // vector engine's per-channel rescale. The neutral path skips the rounding
    // entirely, so an exact ramp centre stays an exact float.
    if (normalizeGamma(gamma) !== 1) {
        const lut = buildToneLut(gamma);
        for (let p = 0; p < count; p++) {
            plane[p] = lut[toByte(plane[p])];
        }
    }

    // Mirror the settings UI's strength range: a huge finite value would overflow
    // the accumulated error to Infinity and make every entry distance Infinity
    // (the nearest test then falls back to entry 0 and the page goes white).
    const diffusionStrength = Number.isFinite(strength)
        ? Math.min(4, Math.max(0, strength))
        : 1;

    for (let y = 0; y < height; y++) {
        const reverse = serpentine && (y & 1) !== 0;
        const start = reverse ? width - 1 : 0;
        const end = reverse ? -1 : width;
        const step = reverse ? -1 : 1;
        const direction = reverse ? -1 : 1;

        for (let x = start; x !== end; x += step) {
            const p = y * width + x;
            const value = plane[p];

            // Closest entry **grey value**, ties → earlier entry. Deliberately
            // not `palette.nearest` (see the doc comment): the scalar is already
            // the luminance, and re-deriving it from clamped channels would
            // reintroduce the boundary-rounding mismatch with the encoder.
            let best = 0;
            let bestDistance = Infinity;
            for (let index = 0; index < entries.length; index++) {
                const distance = Math.abs(entries[index].r - value);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = index;
                }
            }

            const entry = entries[best];
            const offset = p * 4;
            data[offset] = entry.r;
            data[offset + 1] = entry.g;
            data[offset + 2] = entry.b;

            if (diffusionStrength === 0) continue;

            const error = (value - entry.r) * diffusionStrength;
            if (error === 0) continue;

            for (const [dx, dy, numerator] of FS_TAPS) {
                const nx = x + dx * direction;
                const ny = y + dy;
                // ny >= 0 always (dy is 0 or 1) and ny only grows forward.
                if (nx < 0 || nx >= width || ny >= height) continue;
                const q = ny * width + nx;
                plane[q] += (error * numerator) / FS_DENOM;
            }
        }
    }

    return rgba;
};
