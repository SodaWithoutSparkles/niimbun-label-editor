/**
 * Print-colours test patterns (P7 wave A) — dev-only.
 *
 * The owner prints these on real hardware to answer the physical questions the
 * code cannot: does the 16-level grey ramp band, are all 16 levels distinct, do
 * flat and diffuse red/black art look right, and does the long (50×160 mm)
 * grayscale page survive the printer's buffer?
 *
 * Every pattern is an in-memory `LabelDoc` built from raw node literals (the
 * `PrintSmoke` precedent) so the harness never touches the store. Images are
 * generated canvases exported as inline PNG data URLs — there is no photo
 * fixture in the repo, and a deterministic generator keeps prints repeatable.
 * No randomness anywhere.
 *
 * Strings are hardcoded: this is a dev harness, not product UI.
 */
import { PageColorType } from '@mmote/niimbluelib';
import { createLabelDoc } from '../../core/doc/factory';
import type { ImageRef, LabelDoc, Node } from '../../core/doc/types';
import { grayLevelColor } from '../../core/render/palette';
import type { QuantizerId } from '../../core/render/quantize';

export type ColourPatternId =
    | 'grayscale'
    | 'redBlack'
    | 'grayscaleLong'
    | 'redBlackCalibration'
    | 'redBlackClustersSmall'
    | 'redBlackClustersLarge'
    | 'redBlackHues';

export interface ColourPattern {
    id: ColourPatternId;
    /** Dev-only display label (hardcoded; not an i18n key). */
    label: string;
    doc: LabelDoc;
    pageColor: PageColorType;
}

/** 1/100 mm units, matching the document's `hm`. */
const MM = 100;

const SHORT_W = 50 * MM;
const SHORT_H = 30 * MM;
const LONG_H = 160 * MM;

/** Printhead width at 300 dpi (D-77): the calibration/cluster page width. */
const HEAD_W = 48 * MM;

/** One 300 dpi device dot in hm (1 inch = 2540 hm). */
const dotHm = (dots: number): number => Math.round((dots * 2540) / 300);

/** Fixed identity/time so two builds of the same pattern are byte-equal. */
const FIXED_TIME = 1_760_000_000;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** Grey byte `v` (0–255) as `#rrggbb`. */
const greyHex = (v: number): string => {
    const byte = clampChannel(v).toString(16).padStart(2, '0');
    return `#${byte}${byte}${byte}`;
};

type PixelWriter = (x: number, y: number) => readonly [number, number, number, number];

/**
 * Paint an RGBA raster from a pure pixel function.
 *
 * `ImageData` + `putImageData` (not thousands of `fillRect`s) keeps generation
 * fast and bit-identical for a given canvas implementation.
 */
const writePixels = (
    ctx: CanvasRenderingContext2D,
    widthPx: number,
    heightPx: number,
    pixel: PixelWriter,
): void => {
    const image = ctx.createImageData(widthPx, heightPx);
    const data = image.data;
    for (let y = 0; y < heightPx; y++) {
        for (let x = 0; x < widthPx; x++) {
            const [r, g, b, a] = pixel(x, y);
            const offset = (y * widthPx + x) * 4;
            data[offset] = r;
            data[offset + 1] = g;
            data[offset + 2] = b;
            data[offset + 3] = a;
        }
    }
    ctx.putImageData(image, 0, 0);
};

/** Create a canvas, paint it, and return its PNG data URL (never a blob/URL). */
const pngDataUrl = (
    widthPx: number,
    heightPx: number,
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): string => {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('printColoursPatterns: 2D canvas context unavailable');
    paint(ctx, widthPx, heightPx);
    return canvas.toDataURL('image/png');
};

/** Uniform grey fill — a flat tone for coverage-ladder bars. */
const flatGreyPng = (grey: number, widthPx = 2, heightPx = 2): string =>
    pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, () => [clampChannel(grey), clampChannel(grey), clampChannel(grey), 255]),
    );

/** Uniform colour fill from an exact sRGB triplet. */
const flatColourPng = (
    rgb: readonly [number, number, number],
    widthPx = 8,
    heightPx = 8,
): string =>
    pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, () => [clampChannel(rgb[0]), clampChannel(rgb[1]), clampChannel(rgb[2]), 255]),
    );

/** Horizontal linear ramp between two exact sRGB triplets. */
const colourRampPng = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    widthPx: number,
    heightPx: number,
): string =>
    pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, (x) => {
            const t = x / Math.max(1, w - 1);
            return [
                clampChannel(from[0] + (to[0] - from[0]) * t),
                clampChannel(from[1] + (to[1] - from[1]) * t),
                clampChannel(from[2] + (to[2] - from[2]) * t),
                255,
            ];
        }),
    );

/** Horizontal black → white strip. */
const greyGradientPng = (widthPx: number, heightPx: number): string =>
    pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, (x) => {
            const v = clampChannel((x / Math.max(1, w - 1)) * 255);
            return [v, v, v, 255];
        }),
    );

/**
 * A deterministic photo stand-in: a two-axis luminance ramp crossed with a
 * fixed colour-block grid, so the tone mapping has real hue/saturation work to
 * do (a pure grey ramp would not exercise it).
 */
const photoPng = (widthPx: number, heightPx: number): string => {
    const blocks: readonly (readonly [number, number, number])[] = [
        [200, 40, 40],
        [40, 140, 200],
        [60, 160, 80],
        [210, 190, 60],
        [140, 80, 180],
        [30, 30, 30],
        [230, 230, 230],
        [90, 90, 90],
        [180, 120, 60],
        [60, 180, 200],
        [120, 40, 160],
        [220, 220, 40],
    ];
    const columns = 4;
    const rows = 3;
    return pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, (x, y) => {
            const t = x / Math.max(1, w - 1);
            const shade = 0.35 + 0.65 * (y / Math.max(1, h - 1));
            const column = Math.min(columns - 1, Math.floor((t * columns) | 0));
            const row = Math.min(rows - 1, Math.floor(((y / Math.max(1, h - 1)) * rows) | 0));
            const block = blocks[row * columns + column] ?? blocks[0]!;
            return [
                clampChannel(block[0] * t * shade),
                clampChannel(block[1] * t * shade),
                clampChannel(block[2] * t * shade),
                255,
            ];
        }),
    );
};

/**
 * Reds + greys: the top rows are neutral greys, the bottom rows pure reds, and
 * the middle is the blend. Under the red/black palette this must produce a mix
 * of white, red and black rather than a single ink.
 */
const redGreyGradientPng = (widthPx: number, heightPx: number): string =>
    pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, (x, y) => {
            const t = x / Math.max(1, w - 1);
            const redMix = y / Math.max(1, h - 1);
            const grey = 255 * (1 - t);
            return [
                clampChannel(grey),
                clampChannel(grey * (1 - redMix)),
                clampChannel(grey * (1 - redMix)),
                255,
            ];
        }),
    );

/**
 * The long-page strip: a horizontal 16-band ramp repeated down the whole page.
 * Every row carries the full tonal range, so banding and dithering are visible
 * along the entire length that the printer's buffer has to hold.
 */
const longGradientPng = (widthPx: number, heightPx: number): string =>
    pngDataUrl(widthPx, heightPx, (ctx, w, h) =>
        writePixels(ctx, w, h, (x) => {
            const v = clampChannel((x / Math.max(1, w - 1)) * 255);
            return [v, v, v, 255];
        }),
    );

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

interface RectOptions {
    fill: string;
    stroke?: string;
}

const rectNode = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    { fill, stroke = 'transparent' }: RectOptions,
): Node => ({
    id,
    parentId: null,
    type: 'shape',
    shape: 'rectangle',
    visible: true,
    locked: false,
    transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w, h },
    fill,
    stroke,
});

interface TextStyle {
    fill?: string;
    align?: 'left' | 'center' | 'right';
}

const textNode = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    value: string,
    fontSize: number,
    style: TextStyle = {},
): Node => ({
    id,
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w, h },
    fontSize,
    text: { kind: 'static', value },
    ...(style.fill !== undefined ? { fill: style.fill } : {}),
    ...(style.align !== undefined ? { align: style.align } : {}),
});

const imageRef = (
    imageId: string,
    name: string,
    widthPx: number,
    heightPx: number,
    dataUrl: string,
): ImageRef => ({
    imageId,
    name,
    source: { kind: 'inline', mediaType: 'image/png', dataUrl },
    widthPx,
    heightPx,
});

const imageNode = (
    id: string,
    imageId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    tint?: string,
    quantizerHint?: QuantizerId,
): Node => ({
    id,
    parentId: null,
    type: 'image',
    imageId,
    visible: true,
    locked: false,
    transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w, h },
    fit: 'stretch',
    ...(tint !== undefined ? { tint } : {}),
    ...(quantizerHint !== undefined ? { quantizerHint } : {}),
});

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

/** 16 step bars at the exact 255 − 17k band centres, plus level captions. */
const greyStepBars = (): Node[] => {
    const nodes: Node[] = [];
    const barW = 260;
    const gap = 40;
    const barH = 1200;
    const startX = (SHORT_W - (16 * barW + 15 * gap)) / 2;

    for (let level = 0; level < 16; level++) {
        const x = startX + level * (barW + gap);
        const fill = greyHex(grayLevelColor(level));
        nodes.push(rectNode(`grey-bar-${level}`, x, 340, barW, barH, { fill }));
        nodes.push(
            textNode(`grey-bar-label-${level}`, x, 1550, barW, 130, String(level), 110, {
                fill: '#000000',
                align: 'center',
            }),
        );
    }
    return nodes;
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Grayscale page: 16 step bars + generated gradient/photo strips. */
const grayscalePattern = (): ColourPattern => {
    const gradient = imageRef(
        'pc-gray-gradient',
        'grey gradient',
        480,
        120,
        greyGradientPng(480, 120),
    );
    const photo = imageRef('pc-photo', 'photo stand-in', 240, 120, photoPng(240, 120));
    const bars = greyStepBars();

    const doc = createLabelDoc({
        id: 'pc-grayscale',
        name: 'Print colours — grayscale',
        paperTypeId: 'rounded50x30',
        backingW: SHORT_W,
        backingH: SHORT_H,
        dpi: 300,
        now: FIXED_TIME,
        nodes: [
            textNode('pc-grayscale-title', 120, 40, 3000, 240, 'GRAY 16', 200, { fill: '#000000' }),
            ...bars,
            imageNode('pc-gray-gradient-node', gradient.imageId, 300, 1720, 2100, 1000),
            imageNode('pc-photo-node', photo.imageId, 2600, 1720, 2100, 1000),
            textNode('pc-grayscale-caption', 150, 2740, 3600, 180, 'gradient + photo', 140, {
                fill: '#000000',
            }),
        ],
    });
    doc.resources.images.push(gradient, photo);
    return {
        id: 'grayscale',
        label: 'Grayscale — 16 steps',
        doc,
        pageColor: PageColorType.Grayscale,
    };
};

/** Red/black page: flat rows, a threshold sweep, tinted/colour gradients, text. */
const redBlackPattern = (): ColourPattern => {
    const tinted = imageRef(
        'pc-red-tint-gradient',
        'red-tinted grey gradient',
        240,
        100,
        greyGradientPng(240, 100),
    );
    const colour = imageRef(
        'pc-red-grey-gradient',
        'red + grey gradient',
        300,
        140,
        redGreyGradientPng(300, 140),
    );

    const nodes: Node[] = [
        textNode('pc-rb-title', 120, 40, 3000, 240, 'RED / BLACK', 200, { fill: '#000000' }),
    ];

    // Flat bar rows: black, red, then alternating. Flat art must stay crisp.
    const rowY = [320, 680, 1040];
    const fillFor = (row: number, index: number): string => {
        if (row === 0) return '#000000';
        if (row === 1) return '#ff0000';
        return index % 2 === 0 ? '#000000' : '#ff0000';
    };
    const barW = 620;
    const barGap = 100;
    const rowX = (SHORT_W - (6 * barW + 5 * barGap)) / 2;
    rowY.forEach((y, row) => {
        for (let index = 0; index < 6; index++) {
            nodes.push(
                rectNode(`pc-rb-row-${row}-${index}`, rowX + index * (barW + barGap), y, barW, 280, {
                    fill: fillFor(row, index),
                }),
            );
        }
    });

    // Flat threshold sweep: 8 exact greys from #000 to #fff. A correct flat
    // classifier keeps these as steps with no dithering.
    const sweepW = 560;
    const sweepGap = 60;
    const sweepX = (SHORT_W - (8 * sweepW + 7 * sweepGap)) / 2;
    for (let step = 0; step < 8; step++) {
        const value = Math.round((step * 255) / 7);
        nodes.push(
            rectNode(`pc-rb-sweep-${step}`, sweepX + step * (sweepW + sweepGap), 1420, sweepW, 340, {
                fill: greyHex(value),
            }),
        );
    }

    nodes.push(
        imageNode('pc-rb-tint-node', tinted.imageId, 200, 1840, 2200, 560, '#ff0000'),
        imageNode('pc-rb-colour-node', colour.imageId, 2600, 1840, 2200, 560),
        textNode('pc-rb-red-text', 150, 2520, 1400, 320, 'RED', 260, { fill: '#ff0000' }),
        textNode('pc-rb-black-text', 1800, 2520, 2400, 320, 'BLACK', 260, { fill: '#000000' }),
    );

    const doc = createLabelDoc({
        id: 'pc-red-black',
        name: 'Print colours — red/black',
        paperTypeId: 'rounded50x30',
        backingW: SHORT_W,
        backingH: SHORT_H,
        dpi: 300,
        now: FIXED_TIME,
        nodes,
    });
    doc.resources.images.push(tinted, colour);
    return {
        id: 'redBlack',
        label: 'Red & black — flat / diffuse',
        doc,
        pageColor: PageColorType.DoubleColor,
    };
};

/** Long grayscale page: 50 × 160 mm, the printer-buffer stress case. */
const grayscaleLongPattern = (): ColourPattern => {
    const strip = imageRef(
        'pc-long-gradient',
        'long grey gradient',
        480,
        1595,
        longGradientPng(480, 1595),
    );

    const nodes: Node[] = [
        textNode('pc-long-title', 120, 60, 3000, 240, 'GRAY 16 LONG', 200, { fill: '#000000' }),
    ];
    // The short-page bar block already sits at y 340–1680.
    nodes.push(...greyStepBars());
    nodes.push(imageNode('pc-long-gradient-node', strip.imageId, 500, 1720, 4000, 13500));
    nodes.push(
        textNode('pc-long-caption', 150, 15280, 3600, 280, 'long strip — buffer test', 160, {
            fill: '#000000',
        }),
    );

    const doc = createLabelDoc({
        id: 'pc-grayscale-long',
        name: 'Print colours — grayscale long',
        backingW: SHORT_W,
        backingH: LONG_H,
        dpi: 300,
        now: FIXED_TIME,
        regions: [{ kind: 'rect', x: 0, y: 0, w: SHORT_W, h: LONG_H }],
        nodes,
    });
    doc.resources.images.push(strip);
    return {
        id: 'grayscaleLong',
        label: 'Grayscale — 50×160 long',
        doc,
        pageColor: PageColorType.Grayscale,
    };
};

/**
 * Red/black calibration: separate the three physical effects the P7 print mixed
 * together — ink density, red coverage linearity, and black/red registration.
 *
 * - An isolated red-tinted ramp with white above and below: no black art touches
 *   it, so any black in the result is red overheat, not misregistration.
 * - Five flat grey bars tinted red: red coverage ≈ 75/50/25/12/6 % after
 *   diffusion, straight from authored tone to printed dot coverage.
 * - Black/red vertical and horizontal boundaries: registration only (each side
 *   is solid ink, so density plays no part).
 *
 * The page defaults to **48 mm** — the printhead width at 300 dpi (567 px). The
 * library author found that a wider `DoubleColor` page is truncated by the
 * printer at the end of the packet, where the red colour array lives, which
 * showed up as a red/black artefact along the `Mixed` row's edge (D-77). The
 * 50 mm red/black pattern stays 50 mm on purpose: it is the bug repro.
 */
export const buildRedBlackCalibrationPattern = (
    density?: number,
    widthMm = 48,
): ColourPattern => {
    const width = widthMm * MM;
    /** The calibration layout was authored on the 50 mm page; scale its x axis. */
    const scale = width / SHORT_W;
    const sx = (value: number): number => Math.round(value * scale);
    const ramp = imageRef('pc-cal-ramp', 'isolated red ramp', 460, 40, greyGradientPng(460, 40));
    const coverageGreys = [64, 128, 192, 224, 240] as const;
    const coveragePercent = [75, 50, 25, 12, 6] as const;
    const coverage = coverageGreys.map((grey, index) =>
        imageRef(`pc-cal-cover-${index}`, `red coverage ${grey}/255`, 2, 2, flatGreyPng(grey)),
    );

    const nodes: Node[] = [
        textNode('pc-cal-title', sx(200), 40, sx(2000), 200, 'RED / BLACK CAL', 160, {
            fill: '#000000',
        }),
        textNode('pc-cal-density', sx(2400), 40, sx(2400), 200, `DENSITY ${density ?? '—'}`, 160, {
            fill: '#000000',
            align: 'right',
        }),
        // White margin above (title ends at 240 → 1.6 mm) and below (ladder
        // starts at 850 → 1.5 mm): no black art can bleed onto the ramp.
        imageNode('pc-cal-ramp-node', ramp.imageId, sx(200), 400, sx(4600), 300, '#ff0000'),
    ];

    // Coverage ladder (authored at the 50 mm scale: 8 mm bars, 1 mm gaps),
    // y 850…1650.
    coverage.forEach((ref, index) => {
        const x = sx(200 + index * 900);
        nodes.push(
            imageNode(`pc-cal-cover-${index}-node`, ref.imageId, x, 850, sx(800), 800, '#ff0000'),
        );
        // Tone caption in the 1 mm gap between the ladder (ends 1650) and the
        // vertical band (starts 1750).
        nodes.push(
            textNode(
                `pc-cal-cover-label-${index}`,
                x,
                1655,
                sx(800),
                90,
                String(coveragePercent[index]),
                80,
                { fill: '#000000', align: 'center' },
            ),
        );
    });

    // Vertical registration band: black | red | 2 mm white gap (at the authored
    // 50 mm scale) | red | black.
    nodes.push(
        rectNode('pc-cal-v-black-0', sx(200), 1750, sx(1000), 600, { fill: '#000000' }),
        rectNode('pc-cal-v-red-0', sx(1200), 1750, sx(1000), 600, { fill: '#ff0000' }),
        rectNode('pc-cal-v-red-1', sx(2400), 1750, sx(1000), 600, { fill: '#ff0000' }),
        rectNode('pc-cal-v-black-1', sx(3400), 1750, sx(1000), 600, { fill: '#000000' }),
        // Horizontal registration: red over black, then black over red. The two
        // 2 mm blocks in each pair touch, so a fringe lands on the seam.
        rectNode('pc-cal-h-left-red', sx(200), 2450, sx(1800), 200, { fill: '#ff0000' }),
        rectNode('pc-cal-h-left-black', sx(200), 2650, sx(1800), 200, { fill: '#000000' }),
        rectNode('pc-cal-h-right-black', sx(2200), 2450, sx(1800), 200, { fill: '#000000' }),
        rectNode('pc-cal-h-right-red', sx(2200), 2650, sx(1800), 200, { fill: '#ff0000' }),
    );

    const doc = createLabelDoc({
        id: 'pc-red-black-calibration',
        name: `Print colours — red/black calibration (${widthMm} mm)`,
        // The 50 mm variant keeps its preset; narrower pages spell out a
        // full-page region so the preset's region cannot clip the content.
        ...(widthMm === 50 ? { paperTypeId: 'rounded50x30' } : {}),
        backingW: width,
        backingH: SHORT_H,
        dpi: 300,
        now: FIXED_TIME,
        regions: [{ kind: 'rect', x: 0, y: 0, w: width, h: SHORT_H }],
        nodes,
    });
    doc.resources.images.push(ramp, ...coverage);
    return {
        id: 'redBlackCalibration',
        label: `Red & black — calibration (${widthMm} mm)`,
        doc,
        pageColor: PageColorType.DoubleColor,
    };
};

/** One calibration label per density, in the given order (sweep helper). */
export const buildDensitySweep = (
    densities: readonly number[],
    widthMm = 48,
): ColourPattern[] =>
    densities.map((density) => buildRedBlackCalibrationPattern(density, widthMm));

// ---------------------------------------------------------------------------
// P9 wave C — red/black duotone calibration
// ---------------------------------------------------------------------------

/**
 * Cluster / physical-floor ladder (wave C2a, geometry revision).
 *
 * Each patch is a **60×60-device-dot** image. At 300 dpi `2540/300 = 127/15`,
 * so only dot counts that are multiples of 15 are both exact integer `hm` and
 * whole device pixels; 60 is also the LCM with the footprints 2/3/4/6, so every
 * footprint tiles the patch exactly (30/20/15/10 tiles) with no partial edge
 * tile. The node size is `dotHm(60)` = 508 hm = 60 px and origins sit on
 * 75-dot pitch, so the smooth image draw is a true 1:1 blit: the raster patch is
 * byte-for-byte the source PNG.
 *
 * Four rows do not fit a 30 mm page with captions, so the ladder is split into
 * a small (2×2, 3×3) and a large (4×4, 6×6) pattern. The small one carries the
 * 1/2/3-dot line and 1.5/2 mm text detail block.
 *
 * The dots are **authored exact red**, not the duotone engine's output, so every
 * image node carries `quantizerHint: 'threshold'`: the flat policy keeps the
 * authored bytes instead of running diffusion over them.
 *
 * Because a tile can only hold an integer number of dots, most cells realise a
 * coverage slightly different from the column target. Each cell is captioned
 * with its **achieved** coverage (`round(100·dots/f²)`); the column headers are
 * explicitly `target`.
 */
const clusterLadderPattern = (
    id: 'redBlackClustersSmall' | 'redBlackClustersLarge',
    footprints: readonly number[],
    label: string,
    title: string,
    withDetail: boolean,
): ColourPattern => {
    const targets = [25, 50, 56, 67, 78, 100] as const;

    const patchDots = 60; // LCM(2, 3, 4, 6) and a multiple of 15 → exact hm + px.
    const pitchDots = 75; // 60 patch + 15-dot caption gap.
    const patchHm = dotHm(patchDots); // 508 hm = 60 px exactly.

    /** Whole-dot origins that are also whole px (multiples of 15 dots). */
    const colDots = targets.map((_, column) => 60 + column * pitchDots);
    const rowDots = footprints.map((_, row) => 60 + row * pitchDots);

    const dotsInTile = (footprint: number, target: number): number =>
        Math.round((target / 100) * footprint * footprint);
    const achievedOf = (footprint: number, target: number): number => {
        const dots = dotsInTile(footprint, target);
        return Math.round((100 * dots) / (footprint * footprint));
    };

    const nodes: Node[] = [
        textNode('pc-rbc-title', 60, 30, 4600, 140, title, 110, {
            fill: '#000000',
        }),
        textNode(
            'pc-rbc-legend',
            60,
            180,
            4600,
            100,
            'CAPTIONS = ACHIEVED RED COVERAGE · HEADERS = TARGET',
            55,
            { fill: '#000000' },
        ),
    ];
    const resources: ImageRef[] = [];

    targets.forEach((target, column) => {
        nodes.push(
            textNode(
                `pc-rbc-col-${target}`,
                dotHm(colDots[column]!),
                300,
                patchHm,
                90,
                `target ${target}%`,
                55,
                { fill: '#000000', align: 'center' },
            ),
        );
    });

    footprints.forEach((footprint, row) => {
        const rowY = dotHm(rowDots[row]!);
        nodes.push(
            textNode(`pc-rbc-row-${footprint}`, 20, rowY + 200, 470, 90, `${footprint}x${footprint}`, 60, {
                fill: '#000000',
                align: 'right',
            }),
        );

        targets.forEach((target, column) => {
            // Compact top-left prefix: the first n dots of the f×f tile in
            // row-major order, repeated across the 60×60 patch.
            const dots = dotsInTile(footprint, target);
            const achieved = achievedOf(footprint, target);
            const imageId = `pc-rbc-${footprint}-${target}`;
            const dataUrl = pngDataUrl(patchDots, patchDots, (ctx, w, h) =>
                writePixels(ctx, w, h, (x, y) => {
                    const index = (y % footprint) * footprint + (x % footprint);
                    return index < dots ? [255, 0, 0, 255] : [255, 255, 255, 255];
                }),
            );
            resources.push(
                imageRef(
                    imageId,
                    `red ${footprint}x${footprint} target ${target}% (achieved ${achieved}%)`,
                    patchDots,
                    patchDots,
                    dataUrl,
                ),
            );
            const x = dotHm(colDots[column]!);
            nodes.push(
                imageNode(
                    `pc-rbc-node-${footprint}-${target}`,
                    imageId,
                    x,
                    rowY,
                    patchHm,
                    patchHm,
                    undefined,
                    'threshold',
                ),
                textNode(
                    `pc-rbc-cell-${footprint}-${target}`,
                    x,
                    dotHm(rowDots[row]! + patchDots + 4),
                    patchHm,
                    90,
                    `${achieved}%`,
                    55,
                    { fill: '#000000', align: 'center' },
                ),
            );
        });
    });

    if (withDetail) {
        nodes.push(
            textNode('pc-rbc-detail-caption', 60, 1900, 3200, 90, 'DETAIL 1 / 2 / 3 DOT + INK', 75, {
                fill: '#000000',
            }),
            // Fine detail: 1-, 2- and 3-dot red lines (device-dot thickness) plus
            // 1.5 mm and 2 mm black text.
            rectNode('pc-rbc-h1', 60, 2040, 1400, dotHm(1), { fill: '#ff0000' }),
            rectNode('pc-rbc-h2', 60, 2070, 1400, dotHm(2), { fill: '#ff0000' }),
            rectNode('pc-rbc-h3', 60, 2100, 1400, dotHm(3), { fill: '#ff0000' }),
            rectNode('pc-rbc-v1', 1600, 2030, dotHm(1), 140, { fill: '#ff0000' }),
            rectNode('pc-rbc-v2', 1640, 2030, dotHm(2), 140, { fill: '#ff0000' }),
            rectNode('pc-rbc-v3', 1690, 2030, dotHm(3), 140, { fill: '#ff0000' }),
            textNode('pc-rbc-ink-15', 2200, 2020, 2400, 170, 'INK 1.5', 150, { fill: '#000000' }),
            textNode('pc-rbc-ink-20', 2200, 2210, 2400, 240, 'INK 2.0', 200, { fill: '#000000' }),
        );
    }

    const doc = createLabelDoc({
        id: `pc-red-black-clusters-${withDetail ? 'small' : 'large'}`,
        name: `Print colours — red/black ${label}`,
        backingW: HEAD_W,
        backingH: SHORT_H,
        dpi: 300,
        now: FIXED_TIME,
        regions: [{ kind: 'rect', x: 0, y: 0, w: HEAD_W, h: SHORT_H }],
        nodes,
    });
    doc.resources.images.push(...resources);
    return { id, label, doc, pageColor: PageColorType.DoubleColor };
};

/** 2×2 + 3×3 rows (with the fine-detail block). */
const redBlackClustersSmallPattern = (): ColourPattern =>
    clusterLadderPattern(
        'redBlackClustersSmall',
        [2, 3],
        'Red & black — cluster ladder 2×2/3×3 (48 mm)',
        'CLUSTERS 2x2 / 3x3',
        true,
    );

/** 4×4 + 6×6 rows. */
const redBlackClustersLargePattern = (): ColourPattern =>
    clusterLadderPattern(
        'redBlackClustersLarge',
        [4, 6],
        'Red & black — cluster ladder 4×4/6×6 (48 mm)',
        'CLUSTERS 4x4 / 6x6',
        false,
    );

/** The six P9 sample colours (sRGB), shared by rows A and B. */
const HUE_SAMPLES: readonly { label: string; hex: string; rgb: readonly [number, number, number] }[] = [
    { label: 'red #c8281e', hex: '#c8281e', rgb: [200, 40, 30] },
    { label: 'pink #e6968c', hex: '#e6968c', rgb: [230, 150, 140] },
    { label: 'dark #5a140f', hex: '#5a140f', rgb: [90, 20, 15] },
    { label: 'green #283c1e', hex: '#283c1e', rgb: [40, 60, 30] },
    { label: 'brown #8c6e50', hex: '#8c6e50', rgb: [140, 110, 80] },
    { label: 'paper #fafaf0', hex: '#fafaf0', rgb: [250, 250, 240] },
];

/** Pink-hue highlights in OKLab: L 0.60/0.68/0.76/0.85/0.95 → sRGB. */
const HUE_HIGHLIGHTS: readonly { label: string; rgb: readonly [number, number, number] }[] = [
    // Computed from #e6968c's OKLab hue/chroma, gamut-clamped per L:
    { label: 'L60 #b16a61', rgb: [177, 106, 97] },
    { label: 'L68 #cc8278', rgb: [204, 130, 120] },
    { label: 'L76 #e79a91', rgb: [231, 154, 145] },
    { label: 'L85 #fbbcb4', rgb: [251, 188, 180] },
    { label: 'L95 #ffe8e4', rgb: [255, 232, 228] },
];

/**
 * Hue / chroma / tone page (wave C2a).
 *
 * Row A runs the six sample colours through the **engine's duotone path**
 * (image nodes, no tint, no quantizer hint), row B is the same six as authored
 * flat rects (classifier control). Rows C–E add ramps, highlights, a neutral
 * black ramp and touching red/black cells for registration.
 */
const redBlackHuesPattern = (): ColourPattern => {
    const margin = 190;
    const patch = 250; // 2.5 mm
    const columns = HUE_SAMPLES.length;
    const columnGap = Math.round((HEAD_W - 2 * margin - columns * patch) / (columns - 1));
    const columnX = (index: number): number => margin + index * (patch + columnGap);

    const nodes: Node[] = [
        textNode('pc-rbh-title', 60, 30, 3600, 140, 'RED / BLACK HUES', 120, {
            fill: '#000000',
        }),
        textNode('pc-rbh-a-label', 60, 175, 3600, 90, 'A PHOTO SEPARATION', 75, {
            fill: '#000000',
        }),
        textNode('pc-rbh-b-label', 60, 630, 3600, 90, 'B FLAT CONTROL', 75, {
            fill: '#000000',
        }),
        textNode('pc-rbh-c-label', 60, 995, 4400, 90, 'C RAMPS + HIGHLIGHTS', 75, {
            fill: '#000000',
        }),
        textNode('pc-rbh-c-highlights', 60, 1355, 4400, 80, 'HIGHLIGHTS L 0.60 0.68 0.76 0.85 0.95', 55, {
            fill: '#000000',
        }),
        textNode('pc-rbh-d-label', 60, 1700, 3600, 90, 'D BLACK RAMP', 75, {
            fill: '#000000',
        }),
        textNode('pc-rbh-e-label', 60, 2115, 3600, 90, 'E MIXED CELLS (2 mm, touching)', 75, {
            fill: '#000000',
        }),
    ];
    const resources: ImageRef[] = [];

    HUE_SAMPLES.forEach((sample, index) => {
        const imageId = `pc-rbh-photo-${index}`;
        resources.push(
            imageRef(imageId, sample.label, 8, 8, flatColourPng(sample.rgb)),
        );
        // Row A: engine path — no tint, no quantizer hint.
        nodes.push(imageNode(`pc-rbh-photo-${index}-node`, imageId, columnX(index), 275, patch, patch));
        nodes.push(
            textNode(`pc-rbh-photo-${index}-label`, columnX(index), 535, patch, 80, sample.hex, 60, {
                fill: '#000000',
                align: 'center',
            }),
        );
        // Row B: authored flat art, classified at the resolved threshold.
        nodes.push(
            rectNode(`pc-rbh-flat-${index}`, columnX(index), 730, patch, patch, { fill: sample.hex }),
        );
    });

    // Row C: red→brown and pink→white ramps, 20 mm × 2.5 mm.
    const rampW = 2000;
    const rampY = 1095;
    const redBrown = imageRef(
        'pc-rbh-ramp-red-brown',
        'red to brown ramp',
        400,
        50,
        colourRampPng([200, 40, 30], [140, 110, 80], 400, 50),
    );
    const pinkWhite = imageRef(
        'pc-rbh-ramp-pink-white',
        'pink to white ramp',
        400,
        50,
        colourRampPng([230, 150, 140], [255, 255, 255], 400, 50),
    );
    resources.push(redBrown, pinkWhite);
    nodes.push(
        imageNode('pc-rbh-ramp-red-brown-node', redBrown.imageId, margin, rampY, rampW, patch),
        imageNode('pc-rbh-ramp-pink-white-node', pinkWhite.imageId, margin + rampW + 420, rampY, rampW, patch),
    );

    // Row C highlights: five in-gamut pink-hue patches at the target OKLab L.
    HUE_HIGHLIGHTS.forEach((highlight, index) => {
        const imageId = `pc-rbh-highlight-${index}`;
        resources.push(imageRef(imageId, highlight.label, 8, 8, flatColourPng(highlight.rgb)));
        nodes.push(imageNode(`pc-rbh-highlight-${index}-node`, imageId, margin + index * 300, 1435, patch, patch));
    });

    // Row D: neutral 0→255 grey tone, no red.
    const blackRamp = imageRef('pc-rbh-black-ramp', 'black ramp 0..255', 600, 40, greyGradientPng(600, 40));
    resources.push(blackRamp);
    nodes.push(imageNode('pc-rbh-black-ramp-node', blackRamp.imageId, margin, 1800, 4420, 300));

    // Row E: 2×4 cells of 2 mm, alternating black/red, edges touching.
    for (let row = 0; row < 2; row++) {
        for (let column = 0; column < 4; column++) {
            nodes.push(
                rectNode(`pc-rbh-mixed-${row}-${column}`, margin + column * 200, 2215 + row * 200, 200, 200, {
                    fill: (row + column) % 2 === 0 ? '#000000' : '#ff0000',
                }),
            );
        }
    }

    const doc = createLabelDoc({
        id: 'pc-red-black-hues',
        name: 'Print colours — red/black hues',
        backingW: HEAD_W,
        backingH: SHORT_H,
        dpi: 300,
        now: FIXED_TIME,
        regions: [{ kind: 'rect', x: 0, y: 0, w: HEAD_W, h: SHORT_H }],
        nodes,
    });
    doc.resources.images.push(...resources);
    return {
        id: 'redBlackHues',
        label: 'Red & black — hues & tone (48 mm)',
        doc,
        pageColor: PageColorType.DoubleColor,
    };
};

/** Build all patterns, fresh docs + fresh PNGs on every call. */
export const buildColourPatterns = (): ColourPattern[] => [
    grayscalePattern(),
    redBlackPattern(),
    grayscaleLongPattern(),
    buildRedBlackCalibrationPattern(),
    redBlackClustersSmallPattern(),
    redBlackClustersLargePattern(),
    redBlackHuesPattern(),
];
