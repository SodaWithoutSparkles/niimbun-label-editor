// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { PageColorType } from '@mmote/niimbluelib';
import { isLabelDoc } from '../../core/doc/validate';
import { parseDoc } from '../../core/doc/serialize';
import { rasterDimensions } from '../../core/render';
import { MAX_RASTER_PIXELS } from '../../editor/render';
import { grayLevelColor } from '../../core/render/palette';
import { installCanvasShim } from '../../test/canvasHarness';
import { buildColourPatterns, type ColourPattern } from './printColoursPatterns';

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
    it('builds three valid docs with no validation repairs', async () => {
        const patterns = buildColourPatterns();
        expect(patterns.map((pattern) => pattern.id)).toEqual([
            'grayscale',
            'redBlack',
            'grayscaleLong',
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

        for (const id of ['grayscale', 'redBlack'] as const) {
            const { label } = patternOf(patterns, id).doc;
            expect(rasterDimensions(label.backingW, label.backingH, label.dpi)).toEqual(
                expectedShort,
            );
            expect(expectedShort.widthPx * expectedShort.heightPx).toBeLessThan(1_000_000);
        }

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

    it('page colours are Grayscale / DoubleColor / Grayscale', () => {
        expect(buildColourPatterns().map((pattern) => pattern.pageColor)).toEqual([
            PageColorType.Grayscale,
            PageColorType.DoubleColor,
            PageColorType.Grayscale,
        ]);
    });
});
