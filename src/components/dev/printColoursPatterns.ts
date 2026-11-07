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

export type ColourPatternId = 'grayscale' | 'redBlack' | 'grayscaleLong';

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

/** Build all patterns, fresh docs + fresh PNGs on every call. */
export const buildColourPatterns = (): ColourPattern[] => [
    grayscalePattern(),
    redBlackPattern(),
    grayscaleLongPattern(),
];
