import { monoLuminance, type RgbaBuffer } from './colorspace';
import { redBlackPalette, RED_BLACK_BLACK, RED_BLACK_RED } from './palette';

/**
 * Two-ink **duotone separation** for the `redBlack` page colour. Pure and
 * headless — no DOM, no store, no document state.
 *
 * The document is authored in full colour; the printer only has two inks. This
 * module turns one RGB raster into exact `#ff0000` / `#000000` / `#ffffff`
 * pixels for the DoubleColor encoder. The split is **spot separation**, not a
 * palette quantizer:
 *
 *  - **Red ink** is a hue-selective spot separation: OKLab chroma projected on
 *    the red axis (29°), gated by **hue and chroma** (a near-neutral guard) and
 *    scaled by a continuous saturation tone. It is halftoned as **clustered
 *    3×3 cells**, so an activated cluster is always orthogonally connected and
 *    has at least four dots (see the physical floor below).
 *  - **Black ink** is an unchanged BT.601 darkness separation — the same tone
 *    the mono and grayscale modes print — minus the darkness the red ink
 *    already supplies (`BT.601 darkness − red ink darkness`). It is
 *    Floyd–Steinberg diffused on the **free** dots (those the red pass did not
 *    claim). Red wins; the two masks are exclusive by construction and checked
 *    before output.
 *
 * **Why clustered red (D-78).** Printed red is heat-selected, and the measured
 * physical floor is ≈50 % local coverage: sparse red dots do not develop on
 * red/black stock. Clustering does not raise the *average* coverage — it makes
 * every activated cell carry at least four connected dots (and at least half
 * its available dots), so the printer either gets a developable patch or no red
 * at all. This is why the old per-pixel palette diffusion produced invisibly
 * sparse highlights and speckle. Cells with fewer than four available dots
 * (tiny rasters, flat-perforated cells) are suppressed entirely: an isolated
 * dot or pair cannot develop, and flat art must not be bridged.
 *
 * **Tone conservation.** Both quantisers pick their level from the *clamped*
 * accumulated value, but diffuse the **realized** residual
 * (`raw = demand + error; level = quantise(clamp01(raw)); realized = inked /
 * available; error = raw − realized`), so clipping and the 4-dot cluster floor
 * never silently accumulate a tone bias at cluster seams. Only a cell that inks
 * its target diffuses `raw − inked/n`; under-delivered cells keep their ink but
 * drop the residual, because the missing dots are not there to receive error
 * later. Cells with fewer than four available dots, and cells whose available
 * dots contain no connected cluster of four, are suppressed and drop their
 * residual entirely: that is an intentional edge/flat-art drop, because
 * forwarding their full demand would paint red into unrelated flat areas or a
 * stripe along the raster edge.
 *
 * **Why red wins.** Red and black are mutually exclusive pigment choices at
 * the same dot. Red is the identity-bearing ink (hue is the signal), so it
 * takes its dots first; black generation then fills the free dots and is
 * rescaled upward so the remaining dots carry the requested tone.
 *
 * **Why black subtracts red.** Printed red is itself dark ink: a bright red or
 * pink pixel needs no black at all, while a genuinely dark red keeps a black
 * shadow. Black is therefore the source's BT.601 darkness,
 * `(1 − Y − WHITE_CLIP) / (1 − WHITE_CLIP)`, minus the darkness the red demand
 * already puts on paper (`RED_INK_DARKNESS × red`). Neutrals have no red, so
 * they print at the mono / grayscale darkening apart from the white-speckle
 * clip — which is why a mid-brown rock and a mid-grey print equally dark in all
 * three modes.
 *
 * **Flat art is a point op.** Authored text/symbols are already crisp
 * two-colour artwork; dithering them would shred glyph edges. A `flat` mask
 * (built from the existing per-object `threshold` policies) classifies each
 * masked pixel straight from its **raw source bytes** through the caller's
 * `flatNearest` (normally `classifyFlatRedBlack`) and locks it out of both
 * halftone passes.
 *
 * **Page-level diffuser knobs do not apply.** Unlike the old palette pass,
 * gamma/strength/serpentine have no meaning here: this mode has exactly two
 * knobs, `redIntensity` and `blackDepth`, applied to the continuous ink demands
 * **before** halftoning. `blackDepth` scales the black demand (`0.5` → ×1,
 * `0` → ×0.5, `1` → ×2) before the clamp. The flat classifier still takes the
 * page's resolved threshold and gamma from the caller.
 *
 * Geometry: the 3×3 cell grid is anchored at the raster origin. The render
 * pipeline's later D-77 head crop is left-aligned and runs **after** this pass,
 * so only the far edge of the raster can ever clip a cell; partial cells at the
 * right/bottom edge are normal and handled by the connected-growth rule. Do not
 * reorder the render pipeline to move this pass after the crop.
 *
 * **Memory.** The two per-pixel demand planes are 8-bit
 * (`Uint8ClampedArray`, 1/255 resolution); the masks are one byte each and the
 * black error plane stays `Float32Array`. That is ~8 bytes/px, below the
 * removed palette engine.
 */

/** Red-halftone cell size in device dots (0.254 mm at 300 dpi). */
export const RED_BLACK_CELL = 3;

/**
 * The two page-level duotone knobs, shared by the engine, the render options and
 * the persisted store settings. Both are optional here because the engine
 * normalizes an absent value to its default; the store keeps the required form
 * (`RedBlackSettings`).
 */
export interface RedBlackTuning {
    /** 0..1.5, default 1. Multiplies the red (chroma) demand. 0 = no red at all. */
    redIntensity?: number;
    /**
     * 0..1, default 0.5. Scales the black (darkness) demand: 0.5 → ×1,
     * 0 → ×0.5, 1 → ×2, clamped to 0..1 per pixel. 0.5 leaves the demand at
     * the mono/grayscale darkening apart from the white-speckle clip (minus
     * the red ink's own darkness).
     */
    blackDepth?: number;
}

/** Options for {@link separateRedBlack}. */
export interface RedBlackSeparateOptions extends RedBlackTuning {
    /** Authored-art mask, one byte/px: non-zero = point op, excluded from both planes. */
    flat?: Uint8Array;
    /** Classifier for a flat pixel's raw source bytes → 0 white / 1 black / 2 red. */
    flatNearest?: (r: number, g: number, b: number) => number;
}

/* ------------------------------------------------------------------------- *
 * Colour math (sRGB → OKLab)
 * ------------------------------------------------------------------------- */

/** sRGB channel (possibly fractional/out of range) → linear light. */
const linearOf = (value: number): number => {
    const s = Math.min(255, Math.max(0, value)) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Red axis in the OKLab `a`/`b` plane. */
const RED_AXIS_COS = 0.8746197; // cos 29°
const RED_AXIS_SIN = 0.4848096; // sin 29°
/** Hue gate: full red inside 15°, zero past 34° (as a tangent of the ratio). */
const HUE_FULL_TAN = 0.2679492; // tan 15°
const HUE_ZERO_TAN = 0.6745085; // tan 34°

const RED_TONE_LO = 0.015;
const RED_TONE_HI = 0.18;
/**
 * Near-neutral guard: red demand is multiplied by
 * `smoothstep(0.015, 0.06, C)`. Hues close to the red axis but nearly grey
 * (warm paper, beige) must not pick up ink demand from the hue gate alone.
 */
const RED_CHROMA_LO = 0.015;
const RED_CHROMA_HI = 0.06;

/**
 * BT.601 luma of the printed red ink on paper, `0.30`. Calibrate after a print:
 * this is the darkness a fully inked red patch contributes, so black can
 * subtract it instead of over-inking red areas.
 */
export const RED_INK_LUMA = 0.3;
/** Darkness the red ink already supplies, `1 − RED_INK_LUMA`. */
export const RED_INK_DARKNESS = 1 - RED_INK_LUMA;
/** Luma headroom kept paper-white: demands are zero below this darkness. */
const WHITE_CLIP = 0.04;

const DEFAULT_RED_INTENSITY = 1;
const DEFAULT_BLACK_DEPTH = 0.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Hermite smoothstep; a degenerate range becomes a step at `a`. */
const smoothstep = (a: number, b: number, x: number): number => {
    if (b <= a) return x < a ? 0 : 1;
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

/** OKLab `L`, `a`, `b` from **linear** RGB. */
const oklabOfLinear = (
    r: number,
    g: number,
    b: number,
): { L: number; a: number; b: number } => {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return {
        L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    };
};

/** OKLab `L`, `a`, `b` from sRGB channels. */
const oklabOf = (r: number, g: number, b: number): { L: number; a: number; b: number } =>
    oklabOfLinear(linearOf(r), linearOf(g), linearOf(b));

/**
 * Hue gate: 1 on the red axis, 0 more than 34° away, smooth between. Continuous
 * (no `atan2`): project the OKLab chroma vector on the 29° axis and compare the
 * perpendicular component as a tangent of the angle.
 */
const hueGateOf = (a: number, b: number): number => {
    const along = a * RED_AXIS_COS + b * RED_AXIS_SIN;
    const across = Math.abs(-a * RED_AXIS_SIN + b * RED_AXIS_COS);
    return along <= 0 ? 0 : 1 - smoothstep(HUE_FULL_TAN, HUE_ZERO_TAN, across / Math.max(along, 1e-6));
};

const redToneOf = (chroma: number): number => smoothstep(RED_TONE_LO, RED_TONE_HI, chroma);

/**
 * Near-neutral guard: zero at the tone floor, full from chroma 0.06. Multiplied
 * into the demand so a warm near-grey cannot develop red dots.
 */
const chromaGateOf = (chroma: number): number =>
    smoothstep(RED_CHROMA_LO, RED_CHROMA_HI, chroma);

/** `redIntensity` → chroma gain: 1 → ×1, 1.5 → ×2, 0 → 0. */
const redGainOf = (intensity: number | undefined): number => {
    const value =
        intensity === undefined || !Number.isFinite(intensity)
            ? DEFAULT_RED_INTENSITY
            : Math.min(1.5, Math.max(0, intensity));
    return value === 0 ? 0 : 2 ** (2 * (value - 1));
};

/**
 * `blackDepth` → black-demand multiplier: 0.5 → ×1, 0 → ×0.5, 1 → ×2.
 * Non-finite falls back to the default 0.5 (×1).
 */
const blackGainOf = (depth: number | undefined): number => {
    const value =
        depth === undefined || !Number.isFinite(depth)
            ? DEFAULT_BLACK_DEPTH
            : Math.min(1, Math.max(0, depth));
    return 2 ** (2 * (value - 0.5));
};

/** Reusable demand pair, so the per-pixel path does not allocate. */
interface Demand {
    red: number;
    black: number;
}

/**
 * Fill `out` from one pixel: `Y` is BT.601 luma / 255 (the mono/grayscale
 * tone), `a`/`b` are the OKLab chroma used for the red hue and near-neutral
 * gates.
 */
const demandInto = (
    out: Demand,
    Y: number,
    a: number,
    b: number,
    redGain: number,
    blackGain: number,
): void => {
    const chroma = Math.hypot(a, b);

    // Hue picks the red family; chromaGate rejects near-neutrals and redTone
    // maps saturation. The two chroma curves are not redundant: the gate is the
    // near-neutral guard, the tone is the continuous ink amount.
    out.red = clamp01(redGain * hueGateOf(a, b) * chromaGateOf(chroma) * redToneOf(chroma));

    // Black generation: the same BT.601 darkness mono/grayscale print, minus
    // the darkness the red ink already supplies. A bright red or pink is fully
    // covered by its own ink (black 0); a dark red keeps the remainder.
    const darkness = clamp01((1 - Y - WHITE_CLIP) / (1 - WHITE_CLIP));
    out.black = clamp01((darkness - RED_INK_DARKNESS * out.red) * blackGain);
};

/**
 * 0..1 red-hue demand from the source colour: hue gate × near-neutral chroma
 * gate × saturation tone, independent of `redIntensity`. Exported for tests and
 * diagnostics.
 */
export const rednessOf = (r: number, g: number, b: number): number => {
    const { a, b: okB } = oklabOf(r, g, b);
    const chroma = Math.hypot(a, okB);
    return clamp01(hueGateOf(a, okB) * chromaGateOf(chroma) * redToneOf(chroma));
};

/**
 * Continuous ink demands before halftoning. `red` is hue-selective spot demand;
 * `black` is the BT.601 darkness separation net of the red ink's own darkness.
 * Both are `0..1`. Non-finite knobs fall back to the engine defaults.
 */
export const redBlackDemand = (
    r: number,
    g: number,
    b: number,
    opts: { redIntensity?: number; blackDepth?: number } = {},
): { red: number; black: number } => {
    const { a, b: okB } = oklabOf(r, g, b);
    const out: Demand = { red: 0, black: 0 };
    demandInto(
        out,
        monoLuminance(r, g, b) / 255,
        a,
        okB,
        redGainOf(opts.redIntensity),
        blackGainOf(opts.blackDepth),
    );
    return out;
};

/* ------------------------------------------------------------------------- *
 * Halftoning
 * ------------------------------------------------------------------------- */

/** Floyd–Steinberg taps `[dx, dy, numerator]`, denominator 16. */
const FS_TAPS: readonly (readonly [number, number, number])[] = [
    [1, 0, 7],
    [-1, 1, 3],
    [0, 1, 5],
    [1, 1, 1],
];

const FS_DENOM = 16;

/**
 * Dot priority inside a cell, used as the growth order for the red cluster:
 * centre plus-shape first, then corners TL, BR, TR, BL. Growth starts at the
 * highest-priority available dot and repeatedly adds the highest-priority
 * available dot orthogonally adjacent to the selected set, so the result is
 * connected by construction. On a full cell this reproduces the centre
 * plus-shape then the four corners.
 */
const RED_DOT_ORDER: readonly (readonly [number, number])[] = [
    [1, 1],
    [1, 0],
    [1, 2],
    [0, 1],
    [2, 1],
    [0, 0],
    [2, 2],
    [2, 0],
    [0, 2],
];

/** Allowed red cell levels. No non-zero level below `5/9` (physical floor). */
const RED_LEVELS: readonly number[] = [0, 5 / 9, 6 / 9, 7 / 9, 8 / 9, 1];

/** Nearest allowed red level; ties go to the lower level. */
const nearestRedLevel = (value: number): number => {
    let best = RED_LEVELS[0]!;
    let bestDistance = Infinity;
    for (const level of RED_LEVELS) {
        const distance = Math.abs(level - value);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = level;
        }
    }
    return best;
};

/** Clamp a channel and pick the closest palette entry (fallback flat classifier). */
const nearestEntryOf = (
    entries: readonly { readonly r: number; readonly g: number; readonly b: number }[],
    r: number,
    g: number,
    b: number,
): number => {
    const pr = Math.min(255, Math.max(0, r));
    const pg = Math.min(255, Math.max(0, g));
    const pb = Math.min(255, Math.max(0, b));
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        const distance = (pr - entry.r) ** 2 + (pg - entry.g) ** 2 + (pb - entry.b) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    }
    return best;
};

/**
 * Separate an RGB raster into the two-ink output. Mutates `rgba` in place and
 * returns the same buffer, matching every other engine in this folder.
 *
 * The output is exactly `#ff0000` (red), `#000000` (black) or `#ffffff` (paper);
 * alpha is never read and every alpha byte survives untouched. The encoder's
 * DoubleColor split keys on those exact bytes, so no intermediate grey is ever
 * written. An overlapping red+black write is an invariant violation and throws.
 *
 * No `Math.random`: two runs on the same input are byte-identical.
 */
export const separateRedBlack = (
    rgba: RgbaBuffer,
    options: RedBlackSeparateOptions = {},
): RgbaBuffer => {
    const { data, width, height } = rgba;
    const count = width * height;
    const flat = options.flat;

    if (flat !== undefined && flat.length !== count) {
        throw new RangeError(
            `separateRedBlack: flat mask length ${flat.length} does not match ${width}×${height} = ${count}`,
        );
    }

    const redMask = new Uint8Array(count);
    const blackMask = new Uint8Array(count);
    // 8-bit demand planes (1/255 resolution): with the two byte masks and the
    // Float32 black error plane the engine stays at ~8 bytes/px.
    const redDemand = new Uint8ClampedArray(count);
    const blackDemand = new Uint8ClampedArray(count);

    const redGain = redGainOf(options.redIntensity);
    const blackGain = blackGainOf(options.blackDepth);
    const entries = redBlackPalette().entries;
    const flatNearest = options.flatNearest;
    const demand: Demand = { red: 0, black: 0 };

    // 1. Continuous demand per pixel. Flat pixels are a point op: classify the
    //    raw source bytes once and lock them out of both halftone passes. Their
    //    demand arrays stay zero, so they never contribute to a cell mean.
    for (let p = 0, i = 0; p < count; p++, i += 4) {
        if (flat !== undefined && flat[p] !== 0) {
            const index = flatNearest
                ? flatNearest(data[i]!, data[i + 1]!, data[i + 2]!)
                : nearestEntryOf(entries, data[i]!, data[i + 1]!, data[i + 2]!);
            if (index === RED_BLACK_RED) redMask[p] = 1;
            else if (index === RED_BLACK_BLACK) blackMask[p] = 1;
            continue;
        }
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        // OKLab is only needed for the red hue/chroma; the black demand is the
        // BT.601 luma (the mono/grayscale darkness, apart from the white clip).
        const { a, b: okB } = oklabOf(r, g, b);
        demandInto(demand, monoLuminance(r, g, b) / 255, a, okB, redGain, blackGain);
        // Store at 1/255 resolution; every read divides by 255.
        redDemand[p] = Math.round(demand.red * 255);
        blackDemand[p] = Math.round(demand.black * 255);
    }

    // 2. Red separation: clustered cells, Floyd–Steinberg at cell resolution.
    const cellCols = Math.ceil(width / RED_BLACK_CELL);
    const cellRows = Math.ceil(height / RED_BLACK_CELL);
    const cellCount = cellCols * cellRows;
    const cellN = new Uint16Array(cellCount);
    const cellDemand = new Float32Array(cellCount);
    const cellRedCount = new Uint16Array(cellCount);
    const cellError = new Float32Array(cellCount);

    // Scratch for connected growth, reused across cells (no per-cell alloc).
    const availX = new Int8Array(RED_DOT_ORDER.length);
    const availY = new Int8Array(RED_DOT_ORDER.length);
    const availP = new Int32Array(RED_DOT_ORDER.length);
    const selected = new Uint8Array(RED_DOT_ORDER.length);

    for (let cy = 0; cy < cellRows; cy++) {
        for (let cx = 0; cx < cellCols; cx++) {
            let n = 0;
            let sum = 0;
            for (let dy = 0; dy < RED_BLACK_CELL; dy++) {
                const y = cy * RED_BLACK_CELL + dy;
                if (y >= height) continue;
                for (let dx = 0; dx < RED_BLACK_CELL; dx++) {
                    const x = cx * RED_BLACK_CELL + dx;
                    if (x >= width) continue;
                    const p = y * width + x;
                    if (flat !== undefined && flat[p] !== 0) continue;
                    n++;
                    sum += redDemand[p]! / 255;
                }
            }
            const cell = cy * cellCols + cx;
            cellN[cell] = n;
            cellDemand[cell] = sum;
        }
    }

    for (let cy = 0; cy < cellRows; cy++) {
        const reverse = (cy & 1) !== 0;
        const start = reverse ? cellCols - 1 : 0;
        const end = reverse ? -1 : cellCols;
        const step = reverse ? -1 : 1;
        const direction = reverse ? -1 : 1;

        for (let cx = start; cx !== end; cx += step) {
            const cell = cy * cellCols + cx;
            const n = cellN[cell]!;
            if (n === 0) continue; // nothing to separate in this cell

            // Clamp only for the level decision. The residual below is
            // diffused unclamped and net of the realized coverage, so neither
            // clipping nor the 4-dot floor loses requested tone.
            const mean = cellDemand[cell]! / n;
            const raw = mean + cellError[cell]!;
            const level = nearestRedLevel(clamp01(raw));

            // Physical floor (D-78): a non-zero cell inks at least four
            // connected dots and at least half its available dots. Cells with
            // fewer than four available dots are suppressed entirely — an
            // isolated dot or pair cannot develop, and flat art must not be
            // bridged.
            const target =
                level === 0
                    ? 0
                    : Math.min(n, Math.max(4, Math.ceil(0.5 * n), Math.round(level * n)));

            let available = 0;
            for (const [dx, dy] of RED_DOT_ORDER) {
                const x = cx * RED_BLACK_CELL + dx;
                const y = cy * RED_BLACK_CELL + dy;
                if (x >= width || y >= height) continue;
                const p = y * width + x;
                if (flat !== undefined && flat[p] !== 0) continue;
                availX[available] = dx;
                availY[available] = dy;
                availP[available] = p;
                available++;
            }

            // Suppressed cells ink nothing and do not diffuse — either too few
            // available dots, or available dots with no connected cluster of
            // four. This is an intentional edge/flat-art drop: forwarding their
            // full demand would paint red into unrelated flat areas or a
            // stripe along the raster edge.
            if (available < 4) {
                cellRedCount[cell] = 0;
                continue;
            }

            // Connected growth: start at the highest-priority available dot,
            // then repeatedly add the highest-priority dot orthogonally
            // adjacent to the selected set. On a full cell this is the centre
            // plus-shape then the corners.
            let inked = 0;
            if (target > 0) {
                selected.fill(0);
                selected[0] = 1;
                let chosen = 1;
                while (chosen < target) {
                    let next = -1;
                    for (let k = 0; k < available && next < 0; k++) {
                        if (selected[k] !== 0) continue;
                        for (let s = 0; s < available; s++) {
                            if (selected[s] === 0) continue;
                            if (
                                Math.abs(availX[s]! - availX[k]!) +
                                    Math.abs(availY[s]! - availY[k]!) ===
                                1
                            ) {
                                next = k;
                                break;
                            }
                        }
                    }
                    if (next < 0) break; // nothing adjacent remains
                    selected[next] = 1;
                    chosen++;
                }
                if (chosen >= 4) {
                    for (let k = 0; k < available; k++) {
                        if (selected[k] !== 0) redMask[availP[k]!] = 1;
                    }
                    inked = chosen;
                } else {
                    // The available dots are split into islands, so growth
                    // cannot form a cluster. Suppress exactly like the
                    // `available < 4` case: no ink and no residual, otherwise a
                    // run of such cells would accumulate a positive demand
                    // that has nowhere legitimate to go.
                    cellRedCount[cell] = 0;
                    continue;
                }
            }
            cellRedCount[cell] = inked;

            // Only a cell that delivered its plan may diffuse a residual. An
            // under-delivered cell keeps its best-effort ink, but its missing
            // dots are not there to receive error later, so forwarding the
            // shortfall would accumulate a positive bias across perforated
            // regions.
            if (inked < target) continue;

            // Diffuse the **realized** coverage, not the requested level: a
            // cell pushed up to the 4-dot floor pays its over-ink back to its
            // neighbours instead of banking a positive tone bias.
            const realized = inked / n;
            const error = raw - realized;
            if (error === 0) continue;
            for (const [dx, dy, numerator] of FS_TAPS) {
                const nx = cx + dx * direction;
                const ny = cy + dy;
                if (nx < 0 || nx >= cellCols || ny >= cellRows) continue;
                cellError[ny * cellCols + nx] += (error * numerator) / FS_DENOM;
            }
        }
    }

    // 3. Black separation: dot-level serpentine FS over the free dots. Red and
    //    flat dots are forbidden targets; any error they accumulate is
    //    redistributed forward over the available taps (renormalised), and
    //    dropped when nothing is available.
    const blackError = new Float32Array(count);

    const redistribute = (x: number, y: number, residual: number, direction: number): void => {
        let weightSum = 0;
        for (const [dx, dy, numerator] of FS_TAPS) {
            const nx = x + dx * direction;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny >= height) continue;
            const q = ny * width + nx;
            if (flat !== undefined && flat[q] !== 0) continue;
            if (redMask[q] !== 0) continue;
            weightSum += numerator;
        }
        if (weightSum === 0) return; // no forward target: the residual is lost
        for (const [dx, dy, numerator] of FS_TAPS) {
            const nx = x + dx * direction;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny >= height) continue;
            const q = ny * width + nx;
            if (flat !== undefined && flat[q] !== 0) continue;
            if (redMask[q] !== 0) continue;
            blackError[q] += (residual * numerator) / weightSum;
        }
    };

    for (let y = 0; y < height; y++) {
        const reverse = (y & 1) !== 0;
        const start = reverse ? width - 1 : 0;
        const end = reverse ? -1 : width;
        const step = reverse ? -1 : 1;
        const direction = reverse ? -1 : 1;

        for (let x = start; x !== end; x += step) {
            const p = y * width + x;

            if ((flat !== undefined && flat[p] !== 0) || redMask[p] !== 0) {
                const residual = blackError[p]!;
                if (residual !== 0) redistribute(x, y, residual, direction);
                continue;
            }

            const cell =
                ((y / RED_BLACK_CELL) | 0) * cellCols + ((x / RED_BLACK_CELL) | 0);
            const n = cellN[cell]!;
            const redFraction = n === 0 ? 0 : cellRedCount[cell]! / n;
            const free = 1 - redFraction;
            // Rescale the black demand onto the dots red did not take, so the
            // free dots carry the requested tone.
            const blackAdjusted = free <= 0 ? 0 : Math.min(1, blackDemand[p]! / 255 / free);

            // Bit from the clamped value, but diffuse the unclamped residual.
            const raw = blackAdjusted + blackError[p]!;
            const isBlack = clamp01(raw) >= 0.5;
            blackMask[p] = isBlack ? 1 : 0;

            const error = raw - (isBlack ? 1 : 0);
            if (error === 0) continue;
            for (const [dx, dy, numerator] of FS_TAPS) {
                const nx = x + dx * direction;
                const ny = y + dy;
                if (nx < 0 || nx >= width || ny >= height) continue;
                blackError[ny * width + nx] += (error * numerator) / FS_DENOM;
            }
        }
    }

    // 4. Exact output bytes. Exclusive masks are an invariant, checked always.
    for (let p = 0, i = 0; p < count; p++, i += 4) {
        const isRed = redMask[p] !== 0;
        const isBlack = blackMask[p] !== 0;
        if (isRed && isBlack) {
            throw new Error('separateRedBlack: overlapping red and black output');
        }
        if (isRed) {
            data[i] = 255;
            data[i + 1] = 0;
            data[i + 2] = 0;
        } else if (isBlack) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
        } else {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
        }
    }

    return rgba;
};
