// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { loadImage } from '@napi-rs/canvas';
import { PageColorType } from '@mmote/niimbluelib';
import { isLabelDoc } from '../../core/doc/validate';
import type { Node } from '../../core/doc/types';
import { parseDoc } from '../../core/doc/serialize';
import { rasterDimensions } from '../../core/render';
import { MAX_RASTER_PIXELS, renderLabelPage } from '../../editor/render';
import { grayLevelColor } from '../../core/render/palette';
import { installCanvasShim } from '../../test/canvasHarness';
import {
    buildColourPatterns,
    buildDensitySweep,
    buildRedBlackCalibrationPattern,
    type ColourPattern,
} from './printColoursPatterns';

/**
 * P7 wave A — the generated print-pattern fixtures.
 *
 * These pin the properties the harness and the owner's print rely on: valid,
 * repair-free documents, the exact 16 band-centre greys, the red/black ink
 * markers, the raster sizes, and decodable inline PNGs. Rendering is not
 * involved; canvas only backs the two generated gradients.
 */

beforeAll(() => {
    installCanvasShim();
});

const patternOf = (patterns: readonly ColourPattern[], id: ColourPattern['id']): ColourPattern => {
    const found = patterns.find((pattern) => pattern.id === id);
    if (!found) throw new Error(`pattern ${id} missing`);
    return found;
};

/** Decode a PNG data URL's IHDR width/height (bytes 16..24 after the signature). */
const pngSizeOf = (dataUrl: string): { widthPx: number; heightPx: number } => {
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe('IHDR');
    return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
};

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');
const hexOf = (value: number): string => `#${hexByte(value)}${hexByte(value)}${hexByte(value)}`;

describe('buildColourPatterns', () => {
    it('builds seven valid docs with no validation repairs', async () => {
        const patterns = buildColourPatterns();
        expect(patterns.map((pattern) => pattern.id)).toEqual([
            'grayscale',
            'redBlack',
            'grayscaleLong',
            'redBlackCalibration',
            'redBlackClustersSmall',
            'redBlackClustersLarge',
            'redBlackHues',
        ]);

        for (const pattern of patterns) {
            const validated = isLabelDoc(pattern.doc);
            expect(validated.ok).toBe(true);
            if (validated.ok) expect(validated.repairs).toEqual([]);

            const parsed = await parseDoc(JSON.stringify(pattern.doc));
            expect(parsed.ok).toBe(true);
            if (parsed.ok) {
                expect(parsed.repairs).toEqual([]);
                expect(parsed.doc).toEqual(pattern.doc);
            }
        }
    });

    it('grayscale: 16 shape fills in ramp order at the exact band-centre greys, valid text fills', () => {
        const pattern = patternOf(buildColourPatterns(), 'grayscale');
        const fills = pattern.doc.nodes
            .filter((node) => node.type === 'shape')
            .map((node) => (node.type === 'shape' ? node.fill : undefined));

        const expected = Array.from({ length: 16 }, (_, level) => hexOf(grayLevelColor(level)));
        expect(fills).toEqual(expected);

        const textFills = pattern.doc.nodes
            .filter((node) => node.type === 'text')
            .map((node) => (node.type === 'text' ? node.fill : undefined));
        for (const fill of textFills) {
            expect(fill === undefined || /^#[0-9a-f]{6}$/i.test(fill)).toBe(true);
        }

        // The title exists and clears the bar block, which starts at y 340.
        const title = pattern.doc.nodes.find((node) => node.id === 'pc-grayscale-title');
        if (title?.type !== 'text') throw new Error('pc-grayscale-title missing');
        expect(title.text.kind === 'static' ? title.text.value : undefined).toBe('GRAY 16');
        const titleBox = title.size;
        if (!titleBox) throw new Error('pc-grayscale-title has no size');
        expect(title.transform.y + titleBox.h).toBeLessThan(340);
    });

    it('red/black: full flat structure, sweep, red/black text and one tinted image', () => {
        const pattern = patternOf(buildColourPatterns(), 'redBlack');
        const nodes = pattern.doc.nodes;
        const shapeFill = (id: string): string | undefined => {
            const node = nodes.find((candidate) => candidate.id === id);
            return node?.type === 'shape' ? node.fill : undefined;
        };

        // Rows: all black, all red, then alternating starting black.
        for (let row = 0; row < 3; row++) {
            const fills = Array.from({ length: 6 }, (_, index) =>
                shapeFill(`pc-rb-row-${row}-${index}`),
            );
            const expected =
                row === 0
                    ? Array.from({ length: 6 }, () => '#000000')
                    : row === 1
                      ? Array.from({ length: 6 }, () => '#ff0000')
                      : Array.from({ length: 6 }, (_, index) =>
                            index % 2 === 0 ? '#000000' : '#ff0000',
                        );
            expect(fills).toEqual(expected);
        }

        // Threshold sweep: the 8 exact greys #000..fff.
        const sweepFills = Array.from({ length: 8 }, (_, step) =>
            shapeFill(`pc-rb-sweep-${step}`),
        );
        expect(sweepFills).toEqual([0, 36, 73, 109, 146, 182, 219, 255].map(hexOf));

        // Text nodes carry explicit ink colours and content.
        const textOf = (
            id: string,
        ): { value: string | undefined; fill: string | undefined } | undefined => {
            const node = nodes.find((candidate) => candidate.id === id);
            return node?.type === 'text'
                ? {
                      value: node.text.kind === 'static' ? node.text.value : undefined,
                      fill: node.fill,
                  }
                : undefined;
        };
        expect(textOf('pc-rb-red-text')).toEqual({ value: 'RED', fill: '#ff0000' });
        expect(textOf('pc-rb-black-text')).toEqual({ value: 'BLACK', fill: '#000000' });

        // Exactly one tinted image and one untinted (colour) image.
        const images = nodes.filter((node) => node.type === 'image');
        expect(images.map((node) => (node.type === 'image' ? node.tint : undefined))).toEqual([
            '#ff0000',
            undefined,
        ]);
    });

    it('image nodes reference exactly one resource each, with no orphans', () => {
        for (const pattern of buildColourPatterns()) {
            const nodeIds = pattern.doc.nodes
                .filter((node) => node.type === 'image')
                .map((node) => (node.type === 'image' ? node.imageId : undefined));
            const resourceIds = pattern.doc.resources.images.map((ref) => ref.imageId);

            expect(new Set(nodeIds)).toEqual(new Set(resourceIds));
            for (const id of new Set(nodeIds)) {
                expect(resourceIds.filter((candidate) => candidate === id)).toHaveLength(1);
            }
            for (const id of new Set(resourceIds)) {
                expect(nodeIds.filter((candidate) => candidate === id)).toHaveLength(1);
            }
        }
    });

    it('raster sizes: short docs match rasterDimensions, the long doc is > 1 M px and under the cap', () => {
        const patterns = buildColourPatterns();
        const expectedShort = rasterDimensions(5000, 3000, 300);
        const expectedCalibration = rasterDimensions(4800, 3000, 300);

        for (const id of ['grayscale', 'redBlack'] as const) {
            const { label } = patternOf(patterns, id).doc;
            expect(rasterDimensions(label.backingW, label.backingH, label.dpi)).toEqual(
                expectedShort,
            );
            expect(expectedShort.widthPx * expectedShort.heightPx).toBeLessThan(1_000_000);
        }

        // The calibration label is 48 mm wide (the printhead width), not 50 mm.
        const calibration = patternOf(patterns, 'redBlackCalibration').doc.label;
        expect(rasterDimensions(calibration.backingW, calibration.backingH, calibration.dpi)).toEqual(
            expectedCalibration,
        );
        expect(expectedCalibration.widthPx * expectedCalibration.heightPx).toBeLessThan(1_000_000);

        const long = patternOf(patterns, 'grayscaleLong').doc.label;
        const longSize = rasterDimensions(long.backingW, long.backingH, long.dpi);
        expect(longSize.widthPx * longSize.heightPx).toBeGreaterThan(1_000_000);
        expect(longSize.widthPx * longSize.heightPx).toBeLessThan(MAX_RASTER_PIXELS);
    });

    it('every inline image is a decodable PNG with honest dimensions', () => {
        const patterns = buildColourPatterns();
        let checked = 0;

        for (const pattern of patterns) {
            for (const ref of pattern.doc.resources.images) {
                expect(ref.source.kind).toBe('inline');
                if (ref.source.kind !== 'inline') continue;
                expect(ref.source.mediaType).toBe('image/png');
                expect(pngSizeOf(ref.source.dataUrl)).toEqual({
                    widthPx: ref.widthPx,
                    heightPx: ref.heightPx,
                });
                checked += 1;
            }
        }

        expect(checked).toBeGreaterThanOrEqual(5);
    });

    it('page colours are Grayscale / DoubleColor / Grayscale / four DoubleColor ladders', () => {
        expect(buildColourPatterns().map((pattern) => pattern.pageColor)).toEqual([
            PageColorType.Grayscale,
            PageColorType.DoubleColor,
            PageColorType.Grayscale,
            PageColorType.DoubleColor,
            PageColorType.DoubleColor,
            PageColorType.DoubleColor,
            PageColorType.DoubleColor,
        ]);
    });

    it('every generated PNG is deterministic (two builds byte-equal)', () => {
        const first = buildColourPatterns();
        const second = buildColourPatterns();
        expect(first.map((pattern) => pattern.id)).toEqual(second.map((pattern) => pattern.id));
        first.forEach((pattern, index) => {
            expect(JSON.stringify(pattern.doc)).toBe(JSON.stringify(second[index]!.doc));
        });
    });
});

const nodeById = (pattern: ColourPattern, id: string) =>
    pattern.doc.nodes.find((node) => node.id === id);

const textValueOf = (pattern: ColourPattern, id: string): string | undefined => {
    const node = nodeById(pattern, id);
    return node?.type === 'text' && node.text.kind === 'static' ? node.text.value : undefined;
};

interface PlacedShape {
    fill: string | undefined;
    x: number;
    y: number;
    w: number;
    h: number;
}

const placedShapes = (pattern: ColourPattern): PlacedShape[] =>
    pattern.doc.nodes.flatMap((node) => {
        if (node.type !== 'shape' || !node.size) return [];
        return [
            {
                fill: node.fill,
                x: node.transform.x,
                y: node.transform.y,
                w: node.size.w,
                h: node.size.h,
            },
        ];
    });

interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Assert the ramp's white margin physically exists: every node box stays on the
 * label's page (48 mm wide for the calibration) and nothing but the ramp itself
 * enters its band (y 400…700).
 */
const assertRampBoxHasMargins = (
    pattern: ColourPattern,
    rampNode: Node,
    rampBox: Box,
): void => {
    const { backingW, backingH } = pattern.doc.label;

    for (const node of pattern.doc.nodes) {
        const { x, y } = node.transform;
        if (!node.size) throw new Error(`node ${node.id} has no size`);
        const { w, h } = node.size;
        const box: Box = { left: x, top: y, right: x + w, bottom: y + h };

        // On-page for text, shape and image nodes alike.
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(backingW);
        expect(box.bottom).toBeLessThanOrEqual(backingH);

        if (node.id === rampNode.id) continue;

        const overlaps =
            box.left < rampBox.right &&
            box.right > rampBox.left &&
            box.top < rampBox.bottom &&
            box.bottom > rampBox.top;
        expect(overlaps).toBe(false);
    }
};

describe('red/black calibration pattern', () => {
    it('validates with no repairs and carries the density caption', async () => {
        const fallback = buildRedBlackCalibrationPattern();
        const atFour = buildRedBlackCalibrationPattern(4);

        for (const pattern of [fallback, atFour]) {
            expect(pattern.pageColor).toBe(PageColorType.DoubleColor);

            const validated = isLabelDoc(pattern.doc);
            expect(validated.ok).toBe(true);
            if (validated.ok) expect(validated.repairs).toEqual([]);

            const parsed = await parseDoc(JSON.stringify(pattern.doc));
            expect(parsed.ok).toBe(true);
            if (parsed.ok) {
                expect(parsed.repairs).toEqual([]);
                expect(parsed.doc).toEqual(pattern.doc);
            }
        }

        expect(textValueOf(fallback, 'pc-cal-density')).toBe('DENSITY —');
        expect(textValueOf(atFour, 'pc-cal-density')).toBe('DENSITY 4');

        const caption = nodeById(atFour, 'pc-cal-density');
        if (caption?.type !== 'text') throw new Error('pc-cal-density missing');
        expect(caption.align).toBe('right');
        expect(caption.fill).toBe('#000000');
    });

    it('is 48 mm wide by default with a full-page region, and still builds a 50 mm variant', () => {
        const at48 = buildRedBlackCalibrationPattern();
        expect(at48.doc.label.backingW).toBe(4800);
        expect(at48.doc.label.backingH).toBe(3000);
        expect(at48.doc.label.regions).toEqual([{ kind: 'rect', x: 0, y: 0, w: 4800, h: 3000 }]);
        // No 50 mm preset on the narrow page: the preset's region would clip it.
        expect(at48.doc.meta.paperTypeId).toBeUndefined();
        expect(at48.doc.meta.name).toBe('Print colours — red/black calibration (48 mm)');
        expect(at48.label).toBe('Red & black — calibration (48 mm)');

        // The 50 mm comparison variant is the D-77 bug repro: unscaled layout.
        const at50 = buildRedBlackCalibrationPattern(undefined, 50);
        expect(at50.doc.label.backingW).toBe(5000);
        expect(at50.doc.label.regions).toEqual([{ kind: 'rect', x: 0, y: 0, w: 5000, h: 3000 }]);
        expect(at50.doc.meta.paperTypeId).toBe('rounded50x30');
        expect(at50.label).toBe('Red & black — calibration (50 mm)');
        const ramp50 = nodeById(at50, 'pc-cal-ramp-node');
        if (ramp50?.type !== 'image' || !ramp50.size) throw new Error('pc-cal-ramp-node missing');
        expect(ramp50.transform.x).toBe(200);
        expect(ramp50.size.w).toBe(4600);
    });

    it('has one isolated red ramp, five red coverage bars and registration pairs', () => {
        const pattern = buildRedBlackCalibrationPattern();
        const nodes = pattern.doc.nodes;
        const images = nodes.filter((node) => node.type === 'image');

        // The isolated ramp is the only image in its band, tinted red, with no
        // black element above or below it (the white-margin test checks overlap).
        expect(images.filter((node) => node.transform.y === 400)).toHaveLength(1);
        const ramp = nodeById(pattern, 'pc-cal-ramp-node');
        if (ramp?.type !== 'image') throw new Error('pc-cal-ramp-node missing');
        expect(ramp.tint).toBe('#ff0000');

        // Coverage ladder: five red-tinted flat bars, 8 mm wide (scaled to
        // 0.96 → 768 hm), 1 mm apart.
        const coverage = images
            .filter((node) => node.id.startsWith('pc-cal-cover-'))
            .sort((a, b) => a.transform.x - b.transform.x);
        expect(coverage).toHaveLength(5);
        expect(coverage.map((node) => (node.type === 'image' ? node.tint : undefined))).toEqual([
            '#ff0000',
            '#ff0000',
            '#ff0000',
            '#ff0000',
            '#ff0000',
        ]);
        expect(coverage.map((node) => node.transform.x)).toEqual([192, 1056, 1920, 2784, 3648]);
        expect(coverage.map((node) => node.size?.w)).toEqual([768, 768, 768, 768, 768]);
        expect(coverage.map((node) => node.transform.y)).toEqual([850, 850, 850, 850, 850]);

        // Authored tones in x order: 64/128/192/224/240 of 255, all distinct.
        const coverageRefs = coverage.map((node) => {
            const imageId = node.type === 'image' ? node.imageId : undefined;
            const ref = pattern.doc.resources.images.find(
                (candidate) => candidate.imageId === imageId,
            );
            if (!ref) throw new Error(`coverage resource ${imageId} missing`);
            return ref;
        });
        expect(coverageRefs.map((ref) => ref.name)).toEqual([
            'red coverage 64/255',
            'red coverage 128/255',
            'red coverage 192/255',
            'red coverage 224/255',
            'red coverage 240/255',
        ]);
        const coverageUrls = coverageRefs.map((ref) =>
            ref.source.kind === 'inline' ? ref.source.dataUrl : undefined,
        );
        expect(new Set(coverageUrls).size).toBe(5);

        // Tone captions sit in the 1 mm gap between the ladder and the band.
        expect(
            [0, 1, 2, 3, 4].map((index) => textValueOf(pattern, `pc-cal-cover-label-${index}`)),
        ).toEqual(['75', '50', '25', '12', '6']);
        for (const index of [0, 1, 2, 3, 4]) {
            const label = nodeById(pattern, `pc-cal-cover-label-${index}`);
            if (label?.type !== 'text' || !label.size) throw new Error('coverage label missing');
            expect(label.transform.y).toBeGreaterThanOrEqual(1650);
            expect(label.transform.y + label.size.h).toBeLessThanOrEqual(1750);
            expect(label.transform.x).toBe(192 + index * 864);
            expect(label.size).toEqual({ w: 768, h: 90 });
            expect(label.fontSize).toBe(80);
            expect(label.align).toBe('center');
            expect(label.fill).toBe('#000000');
        }

        // Image nodes ↔ resources one-to-one for this pattern.
        const nodeImageIds = images.map((node) =>
            node.type === 'image' ? node.imageId : undefined,
        );
        expect(new Set(pattern.doc.resources.images.map((ref) => ref.imageId))).toEqual(
            new Set(nodeImageIds),
        );

        const shapes = placedShapes(pattern);
        const vertical = shapes.filter((shape) => shape.y === 1750).sort((a, b) => a.x - b.x);
        expect(vertical.map((shape) => shape.fill)).toEqual([
            '#000000',
            '#ff0000',
            '#ff0000',
            '#000000',
        ]);
        expect(vertical.map((shape) => shape.x)).toEqual([192, 1152, 2304, 3264]);
        // The two reds are separated by a white gap (2 mm at the authored 50 mm
        // scale, 192 hm once scaled to 48 mm).
        expect(vertical[1]!.x + vertical[1]!.w).toBe(2112);
        expect(vertical[2]!.x - (vertical[1]!.x + vertical[1]!.w)).toBe(192);
        expect(vertical.map((shape) => shape.h)).toEqual([600, 600, 600, 600]);
        expect(vertical.map((shape) => shape.w)).toEqual([960, 960, 960, 960]);

        // Horizontal pairs: red over black (left), black over red (right), the
        // two blocks in each pair touching at the boundary.
        const top = shapes.filter((shape) => shape.y === 2450).sort((a, b) => a.x - b.x);
        const bottom = shapes.filter((shape) => shape.y === 2650).sort((a, b) => a.x - b.x);
        expect(top.map((shape) => shape.fill)).toEqual(['#ff0000', '#000000']);
        expect(bottom.map((shape) => shape.fill)).toEqual(['#000000', '#ff0000']);
        expect(top.map((shape) => shape.x)).toEqual([192, 2112]);
        expect(top.map((shape) => shape.w)).toEqual([1728, 1728]);
        for (let index = 0; index < 2; index++) {
            expect(top[index]!.x).toBe(bottom[index]!.x);
            expect(top[index]!.w).toBe(bottom[index]!.w);
            expect(top[index]!.y + top[index]!.h).toBe(bottom[index]!.y);
            expect(top[index]!.h).toBe(200);
            expect(bottom[index]!.y + bottom[index]!.h).toBe(2850);
        }
    });

    it('keeps the isolated ramp white-margined and every node box on-page', () => {
        const pattern = buildRedBlackCalibrationPattern();
        const ramp = nodeById(pattern, 'pc-cal-ramp-node');
        const title = nodeById(pattern, 'pc-cal-title');
        if (ramp?.type !== 'image' || !ramp.size) throw new Error('pc-cal-ramp-node missing');
        if (title?.type !== 'text' || !title.size) throw new Error('pc-cal-title missing');

        // Identity: the ramp is the one isolated red resource.
        const rampRef = pattern.doc.resources.images.find((ref) => ref.imageId === ramp.imageId);
        if (!rampRef) throw new Error('ramp resource missing');
        expect(rampRef.name).toBe('isolated red ramp');

        // Geometry: title ends at 240, ramp 400…700, ladder starts at 850.
        expect(ramp.transform).toMatchObject({ x: 192, y: 400 });
        expect(ramp.size).toEqual({ w: 4416, h: 300 });
        expect(ramp.transform.y - (title.transform.y + title.size.h)).toBe(160);
        expect(850 - (ramp.transform.y + ramp.size.h)).toBe(150);
        // Title is scaled too: x 192, w 1920, same height.
        expect(title.transform.x).toBe(192);
        expect(title.size).toEqual({ w: 1920, h: 200 });

        const box = {
            left: ramp.transform.x,
            top: ramp.transform.y,
            right: ramp.transform.x + ramp.size.w,
            bottom: ramp.transform.y + ramp.size.h,
        };

        assertRampBoxHasMargins(pattern, ramp, box);
    });

    it('buildDensitySweep: one DoubleColor pattern per density, distinct docs/captions', () => {
        const sweep = buildDensitySweep([1, 3]);

        expect(sweep).toHaveLength(2);
        expect(sweep.map((pattern) => pattern.id)).toEqual([
            'redBlackCalibration',
            'redBlackCalibration',
        ]);
        expect(sweep.map((pattern) => pattern.pageColor)).toEqual([
            PageColorType.DoubleColor,
            PageColorType.DoubleColor,
        ]);
        expect(sweep.map((pattern) => textValueOf(pattern, 'pc-cal-density'))).toEqual([
            'DENSITY 1',
            'DENSITY 3',
        ]);
        expect(sweep[0]!.doc).not.toBe(sweep[1]!.doc);
    });
});

const assertAllNodesOnPage = (pattern: ColourPattern): void => {
    const { backingW, backingH } = pattern.doc.label;
    for (const node of pattern.doc.nodes) {
        if (!node.size) throw new Error(`node ${node.id} has no size`);
        const { x, y } = node.transform;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + node.size.w).toBeLessThanOrEqual(backingW);
        expect(y + node.size.h).toBeLessThanOrEqual(backingH);
    }
};

/** Target column → achieved coverage per footprint for the 60×60 patch. */
const ACHIEVED: Readonly<Record<number, readonly number[]>> = {
    2: [25, 50, 50, 75, 75, 100],
    3: [22, 56, 56, 67, 78, 100],
    4: [25, 50, 56, 69, 75, 100],
    6: [25, 50, 56, 67, 78, 100],
};
const CLUSTER_TARGETS = [25, 50, 56, 67, 78, 100] as const;
const CLUSTER_PATCH_DOTS = 60;
const CLUSTER_PAIRS = [
    {
        id: 'redBlackClustersSmall',
        footprints: [2, 3] as const,
        label: 'Red & black — cluster ladder 2×2/3×3 (48 mm)',
        title: 'CLUSTERS 2x2 / 3x3',
        detail: true,
    },
    {
        id: 'redBlackClustersLarge',
        footprints: [4, 6] as const,
        label: 'Red & black — cluster ladder 4×4/6×6 (48 mm)',
        title: 'CLUSTERS 4x4 / 6x6',
        detail: false,
    },
] as const;
const CLUSTER_DOTS_PER_TILE = (footprint: number, target: number): number =>
    Math.round((target / 100) * footprint * footprint);

/** Decode an inline PNG data URL into RGBA via the native canvas shim. */
const decodePng = async (dataUrl: string): Promise<ImageData> => {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cluster test: 2D context unavailable');
    ctx.drawImage(image as unknown as CanvasImageSource, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
};

const isRed = (data: Uint8ClampedArray, offset: number): boolean =>
    data[offset] === 255 &&
    data[offset + 1] === 0 &&
    data[offset + 2] === 0 &&
    data[offset + 3] === 255;

const renderClusters = async (pattern: ColourPattern) =>
    renderLabelPage(pattern.doc, {}, {
        pageColor: 'redBlack',
        assets: {
            resolveImage: async (ref) => {
                if (ref.source.kind !== 'inline') return null;
                const image = await loadImage(ref.source.dataUrl);
                return {
                    image: image as unknown as CanvasImageSource,
                    widthPx: ref.widthPx,
                    heightPx: ref.heightPx,
                };
            },
        },
    });

const clusterPatternOf = (id: (typeof CLUSTER_PAIRS)[number]['id']): ColourPattern =>
    patternOf(buildColourPatterns(), id);

const clusterImagesOf = (pattern: ColourPattern) =>
    pattern.doc.nodes.filter((node) => node.type === 'image');

describe('red/black cluster ladders (C2a)', () => {
    it('splits the four footprints into two 48 mm DoubleColor pages', () => {
        for (const pair of CLUSTER_PAIRS) {
            const pattern = clusterPatternOf(pair.id);
            expect(pattern.label).toBe(pair.label);
            expect(pattern.pageColor).toBe(PageColorType.DoubleColor);
            expect(pattern.doc.label.backingW).toBe(4800);
            expect(pattern.doc.label.backingH).toBe(3000);
            expect(pattern.doc.label.regions).toEqual([
                { kind: 'rect', x: 0, y: 0, w: 4800, h: 3000 },
            ]);
            expect(pattern.doc.meta.paperTypeId).toBeUndefined();
            assertAllNodesOnPage(pattern);
        }
        // The two patterns partition the footprints; neither repeats one.
        expect([...CLUSTER_PAIRS.flatMap((pair) => pair.footprints)].sort()).toEqual([2, 3, 4, 6]);
    });

    it('uses 60×60-dot patches on a 75-dot pitch, one threshold image per cell', () => {
        for (const pair of CLUSTER_PAIRS) {
            const pattern = clusterPatternOf(pair.id);
            const images = clusterImagesOf(pattern);
            expect(images).toHaveLength(pair.footprints.length * CLUSTER_TARGETS.length);

            for (const node of images) {
                if (node.type !== 'image') continue;
                expect(node.quantizerHint).toBe('threshold');
                expect(node.tint).toBeUndefined();
                expect(node.size).toEqual({ w: 508, h: 508 });
                const ref = pattern.doc.resources.images.find(
                    (candidate) => candidate.imageId === node.imageId,
                );
                if (!ref) throw new Error(`image resource ${node.imageId} missing`);
                expect(ref.widthPx).toBe(CLUSTER_PATCH_DOTS);
                expect(ref.heightPx).toBe(CLUSTER_PATCH_DOTS);
            }

            for (const footprint of pair.footprints) {
                expect(CLUSTER_PATCH_DOTS % footprint).toBe(0);
            }

            const expectedIds = pair.footprints.flatMap((footprint) =>
                CLUSTER_TARGETS.map((target) => `pc-rbc-node-${footprint}-${target}`),
            );
            expect(images.map((node) => node.id).sort()).toEqual(expectedIds.sort());

            // Nodes on the 75-dot grid (60 patch + 15 caption gap).
            const byRow = new Map<number, number[]>();
            for (const node of images) {
                if (node.type !== 'image') continue;
                const xPx = (node.transform.x * 300) / 2540;
                const yPx = (node.transform.y * 300) / 2540;
                expect(xPx % 15).toBe(0);
                expect(yPx % 15).toBe(0);
                const row = byRow.get(yPx) ?? [];
                row.push(xPx);
                byRow.set(yPx, row);
            }
            for (const xs of byRow.values()) {
                expect(xs.sort((a, b) => a - b)).toEqual(
                    CLUSTER_TARGETS.map((_, column) => 60 + column * 75),
                );
            }
        }
    });

    it('sizes and places every patch on whole device dots and whole pixels', () => {
        for (const pair of CLUSTER_PAIRS) {
            const pattern = clusterPatternOf(pair.id);
            for (const node of clusterImagesOf(pattern)) {
                if (node.type !== 'image' || !node.size) continue;
                for (const value of [node.transform.x, node.transform.y]) {
                    const px = (value * 300) / 2540;
                    expect(px).toBe(Math.round(px));
                }
                // 508 hm is exactly 60 px: no resampling at the smooth draw.
                expect((node.size.w * 300) / 2540).toBe(CLUSTER_PATCH_DOTS);
                expect((node.size.h * 300) / 2540).toBe(CLUSTER_PATCH_DOTS);
            }
        }
    });

    it('captions every cell with its achieved coverage, not the target', () => {
        for (const pair of CLUSTER_PAIRS) {
            const pattern = clusterPatternOf(pair.id);
            expect(
                CLUSTER_TARGETS.map((target) => textValueOf(pattern, `pc-rbc-col-${target}`)),
            ).toEqual(CLUSTER_TARGETS.map((target) => `target ${target}%`));
            expect(
                pair.footprints.map((footprint) => textValueOf(pattern, `pc-rbc-row-${footprint}`)),
            ).toEqual(pair.footprints.map((footprint) => `${footprint}x${footprint}`));

            for (const footprint of pair.footprints) {
                CLUSTER_TARGETS.forEach((target, index) => {
                    expect(
                        textValueOf(pattern, `pc-rbc-cell-${footprint}-${target}`),
                        `${footprint}x${footprint} target ${target}`,
                    ).toBe(`${ACHIEVED[footprint]![index]}%`);
                });
            }

            const legend = nodeById(pattern, 'pc-rbc-legend');
            if (legend?.type !== 'text') throw new Error('pc-rbc-legend missing');
            expect(legend.text.kind === 'static' ? legend.text.value : undefined).toContain(
                'ACHIEVED',
            );
            const title = nodeById(pattern, 'pc-rbc-title');
            if (title?.type !== 'text') throw new Error('pc-rbc-title missing');
            expect(title.text.kind === 'static' ? title.text.value : undefined).toBe(pair.title);
        }
    });

    it('decodes every generated patch: per-tile and per-patch counts equal the caption', async () => {
        for (const pair of CLUSTER_PAIRS) {
            const pattern = clusterPatternOf(pair.id);
            for (const footprint of pair.footprints) {
                const tilesPerSide = CLUSTER_PATCH_DOTS / footprint;
                const tileCount = tilesPerSide * tilesPerSide;
                for (const [index, target] of CLUSTER_TARGETS.entries()) {
                    const ref = pattern.doc.resources.images.find(
                        (candidate) => candidate.imageId === `pc-rbc-${footprint}-${target}`,
                    );
                    if (ref?.source.kind !== 'inline') throw new Error('cluster resource missing');
                    const image = await decodePng(ref.source.dataUrl);
                    expect({ w: image.width, h: image.height }).toEqual({
                        w: CLUSTER_PATCH_DOTS,
                        h: CLUSTER_PATCH_DOTS,
                    });

                    const dots = CLUSTER_DOTS_PER_TILE(footprint, target);
                    const achieved = ACHIEVED[footprint]![index]!;

                    for (let tileY = 0; tileY < tilesPerSide; tileY++) {
                        for (let tileX = 0; tileX < tilesPerSide; tileX++) {
                            let tileRed = 0;
                            for (let y = 0; y < footprint; y++) {
                                for (let x = 0; x < footprint; x++) {
                                    const px = tileX * footprint + x;
                                    const py = tileY * footprint + y;
                                    if (isRed(image.data, (py * CLUSTER_PATCH_DOTS + px) * 4)) {
                                        tileRed += 1;
                                    }
                                }
                            }
                            expect(tileRed, `${footprint}x${footprint} @ ${target}% tile`).toBe(dots);
                        }
                    }

                    let totalRed = 0;
                    for (let offset = 0; offset < image.data.length; offset += 4) {
                        if (isRed(image.data, offset)) totalRed += 1;
                    }
                    expect(totalRed).toBe(dots * tileCount);
                    expect(Math.round((100 * dots) / (footprint * footprint))).toBe(achieved);
                    expect(totalRed).toBe(
                        Math.round((achieved / 100) * footprint * footprint) * tileCount,
                    );
                }
            }
        }
    });

    it('renders each patch pixel-for-pixel identical to its decoded source', async () => {
        for (const pair of CLUSTER_PAIRS) {
            const pattern = clusterPatternOf(pair.id);
            const page = await renderClusters(pattern);
            expect({ w: page.widthPx, h: page.heightPx }).toEqual({ w: 567, h: 354 });

            let nonPalette = 0;
            for (let offset = 0; offset < page.rgba.data.length; offset += 4) {
                const r = page.rgba.data[offset]!;
                const g = page.rgba.data[offset + 1]!;
                const b = page.rgba.data[offset + 2]!;
                const ok =
                    (r === 255 && g === 255 && b === 255) ||
                    (r === 0 && g === 0 && b === 0) ||
                    (r === 255 && g === 0 && b === 0);
                if (!ok) nonPalette += 1;
            }
            expect(nonPalette, 'no antialiased greys anywhere on the page').toBe(0);

            for (const footprint of pair.footprints) {
                const tilesPerSide = CLUSTER_PATCH_DOTS / footprint;
                const tileCount = tilesPerSide * tilesPerSide;
                for (const [index, target] of CLUSTER_TARGETS.entries()) {
                    const node = nodeById(pattern, `pc-rbc-node-${footprint}-${target}`);
                    if (node?.type !== 'image' || !node.size) throw new Error('cluster node missing');
                    const originX = (node.transform.x * 300) / 2540;
                    const originY = (node.transform.y * 300) / 2540;
                    expect(originX).toBe(Math.round(originX));
                    expect(originY).toBe(Math.round(originY));

                    const ref = pattern.doc.resources.images.find(
                        (candidate) => candidate.imageId === node.imageId,
                    );
                    if (ref?.source.kind !== 'inline') throw new Error('cluster resource missing');
                    const source = await decodePng(ref.source.dataUrl);

                    // 1:1 proof: the 60×60 raster box is byte-equal to the PNG.
                    let mismatches = 0;
                    let red = 0;
                    for (let y = 0; y < CLUSTER_PATCH_DOTS; y++) {
                        for (let x = 0; x < CLUSTER_PATCH_DOTS; x++) {
                            const raster = ((originY + y) * page.widthPx + (originX + x)) * 4;
                            const png = (y * CLUSTER_PATCH_DOTS + x) * 4;
                            for (let channel = 0; channel < 4; channel++) {
                                if (page.rgba.data[raster + channel] !== source.data[png + channel]) {
                                    mismatches += 1;
                                }
                            }
                            if (isRed(page.rgba.data, raster)) red += 1;
                        }
                    }
                    expect(mismatches, `${footprint}x${footprint} @ ${target}% is 1:1`).toBe(0);
                    const dots = CLUSTER_DOTS_PER_TILE(footprint, target);
                    expect(red).toBe(dots * tileCount);
                    expect(ACHIEVED[footprint]![index]).toBe(
                        Math.round((100 * dots) / (footprint * footprint)),
                    );
                }
            }
        }
    });

    it('keeps the fine-detail block on the small pattern only', () => {
        const small = clusterPatternOf('redBlackClustersSmall');
        for (const id of ['pc-rbc-h1', 'pc-rbc-h2', 'pc-rbc-h3', 'pc-rbc-v1', 'pc-rbc-v2', 'pc-rbc-v3']) {
            const node = nodeById(small, id);
            if (node?.type !== 'shape') throw new Error(`${id} missing`);
            expect(node.fill).toBe('#ff0000');
        }
        const line = (id: string): number => {
            const node = nodeById(small, id);
            if (node?.type !== 'shape' || !node.size) throw new Error(`${id} missing`);
            return node.id.startsWith('pc-rbc-h') ? node.size.h : node.size.w;
        };
        expect([line('pc-rbc-h1'), line('pc-rbc-h2'), line('pc-rbc-h3')]).toEqual([8, 17, 25]);
        expect([line('pc-rbc-v1'), line('pc-rbc-v2'), line('pc-rbc-v3')]).toEqual([8, 17, 25]);
        expect(textValueOf(small, 'pc-rbc-ink-15')).toBe('INK 1.5');
        expect(textValueOf(small, 'pc-rbc-ink-20')).toBe('INK 2.0');

        const large = clusterPatternOf('redBlackClustersLarge');
        for (const id of ['pc-rbc-h1', 'pc-rbc-ink-15', 'pc-rbc-detail-caption']) {
            expect(nodeById(large, id)).toBeUndefined();
        }
    });
});

describe('red/black hues & tone (C2a)', () => {
    it('is a 48 mm DoubleColor page with a full-page region', () => {
        const pattern = patternOf(buildColourPatterns(), 'redBlackHues');
        expect(pattern.label).toBe('Red & black — hues & tone (48 mm)');
        expect(pattern.pageColor).toBe(PageColorType.DoubleColor);
        expect(pattern.doc.label.backingW).toBe(4800);
        expect(pattern.doc.label.backingH).toBe(3000);
        expect(pattern.doc.label.regions).toEqual([{ kind: 'rect', x: 0, y: 0, w: 4800, h: 3000 }]);
        expect(pattern.doc.meta.paperTypeId).toBeUndefined();
        assertAllNodesOnPage(pattern);
    });

    it('has six duotone-path images, six flat rects, two ramps, five highlights and a black ramp', () => {
        const pattern = patternOf(buildColourPatterns(), 'redBlackHues');
        const images = pattern.doc.nodes.filter((node) => node.type === 'image');
        const shapes = placedShapes(pattern);

        // Row A (6) + ramps (2) + highlights (5) + black ramp (1).
        expect(images).toHaveLength(14);
        // Row B (6) + mixed cells (8).
        expect(shapes).toHaveLength(14);

        const photoNodes = images.filter((node) => node.id.startsWith('pc-rbh-photo-'));
        expect(photoNodes).toHaveLength(6);
        for (const node of photoNodes) {
            if (node.type !== 'image') continue;
            // Engine duotone path: no authored tint, no flat-policy hint.
            expect(node.tint).toBeUndefined();
            expect(node.quantizerHint).toBeUndefined();
        }

        expect(
            [0, 1, 2, 3, 4, 5].map((index) => shapes[index]!.fill),
        ).toEqual(['#c8281e', '#e6968c', '#5a140f', '#283c1e', '#8c6e50', '#fafaf0']);

        const redBrown = nodeById(pattern, 'pc-rbh-ramp-red-brown-node');
        const pinkWhite = nodeById(pattern, 'pc-rbh-ramp-pink-white-node');
        if (redBrown?.type !== 'image' || !redBrown.size) throw new Error('red-brown ramp missing');
        if (pinkWhite?.type !== 'image' || !pinkWhite.size) throw new Error('pink-white ramp missing');
        expect(redBrown.size.w).toBe(2000);
        expect(pinkWhite.size.w).toBe(2000);
        expect(redBrown.tint).toBeUndefined();
        expect(pinkWhite.tint).toBeUndefined();

        const highlights = images.filter((node) => node.id.startsWith('pc-rbh-highlight-'));
        expect(highlights).toHaveLength(5);
        expect(highlights.map((node) => node.id).sort()).toEqual([
            'pc-rbh-highlight-0-node',
            'pc-rbh-highlight-1-node',
            'pc-rbh-highlight-2-node',
            'pc-rbh-highlight-3-node',
            'pc-rbh-highlight-4-node',
        ]);
        const highlightRefs = highlights.map((node) => {
            const imageId = node.type === 'image' ? node.imageId : undefined;
            return pattern.doc.resources.images.find((ref) => ref.imageId === imageId)?.name;
        });
        expect(highlightRefs).toEqual([
            'L60 #b16a61',
            'L68 #cc8278',
            'L76 #e79a91',
            'L85 #fbbcb4',
            'L95 #ffe8e4',
        ]);

        const blackRamp = nodeById(pattern, 'pc-rbh-black-ramp-node');
        if (blackRamp?.type !== 'image' || !blackRamp.size) throw new Error('black ramp missing');
        expect(blackRamp.size).toEqual({ w: 4420, h: 300 });
        expect(blackRamp.tint).toBeUndefined();
    });

    it('alternates the touching 2×4 mixed cells black/red', () => {
        const pattern = patternOf(buildColourPatterns(), 'redBlackHues');
        for (let row = 0; row < 2; row++) {
            for (let column = 0; column < 4; column++) {
                const node = nodeById(pattern, `pc-rbh-mixed-${row}-${column}`);
                if (node?.type !== 'shape' || !node.size) throw new Error('mixed cell missing');
                expect(node.fill).toBe((row + column) % 2 === 0 ? '#000000' : '#ff0000');
                expect(node.size).toEqual({ w: 200, h: 200 });
                if (column > 0) {
                    const left = nodeById(pattern, `pc-rbh-mixed-${row}-${column - 1}`);
                    if (left?.type !== 'shape') throw new Error('mixed neighbour missing');
                    expect(left.transform.x + 200).toBe(node.transform.x);
                }
                if (row > 0) {
                    const above = nodeById(pattern, `pc-rbh-mixed-${row - 1}-${column}`);
                    if (above?.type !== 'shape') throw new Error('mixed neighbour missing');
                    expect(above.transform.y + 200).toBe(node.transform.y);
                }
            }
        }
    });
});
