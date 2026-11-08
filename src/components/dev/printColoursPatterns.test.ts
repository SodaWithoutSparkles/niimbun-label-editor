// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { PageColorType } from '@mmote/niimbluelib';
import { isLabelDoc } from '../../core/doc/validate';
import type { Node } from '../../core/doc/types';
import { parseDoc } from '../../core/doc/serialize';
import { rasterDimensions } from '../../core/render';
import { MAX_RASTER_PIXELS } from '../../editor/render';
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
    it('builds four valid docs with no validation repairs', async () => {
        const patterns = buildColourPatterns();
        expect(patterns.map((pattern) => pattern.id)).toEqual([
            'grayscale',
            'redBlack',
            'grayscaleLong',
            'redBlackCalibration',
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

    it('page colours are Grayscale / DoubleColor / Grayscale / DoubleColor', () => {
        expect(buildColourPatterns().map((pattern) => pattern.pageColor)).toEqual([
            PageColorType.Grayscale,
            PageColorType.DoubleColor,
            PageColorType.Grayscale,
            PageColorType.DoubleColor,
        ]);
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
