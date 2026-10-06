// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createFtagSpareDoc } from '../../core/doc/factory';
import { regionUnionBounds } from '../../core/doc/derive';
import type { Region } from '../../core/doc/types';
import type { RgbaBuffer } from '../../core/render';
import { HM_PER_INCH, rasterDimensions } from '../../core/render';
import { applyRegionClip } from './clip';
import { pointInUnion } from './regionOverlay';

beforeAll(() => {
    installCanvasShim();
});

const greyBuffer = (width: number, height: number, value = 128): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
    }
    return { data, width, height };
};

const pixelAt = (rgba: RgbaBuffer, x: number, y: number): number[] => {
    const i = (y * rgba.width + x) * 4;
    return [rgba.data[i]!, rgba.data[i + 1]!, rgba.data[i + 2]!, rgba.data[i + 3]!];
};

describe('applyRegionClip — nonzero union, no interior holes', () => {
    it('keeps an overlap-band pixel and blanks pixels outside the union', () => {
        // 1 px = 1 mm (100 hm); a 40×30 px raster.
        const rgba = greyBuffer(40, 30);
        const regions: Region[] = [
            { kind: 'rect', x: 0, y: 0, w: 2000, h: 2000 },
            { kind: 'rect', x: 1000, y: 0, w: 2000, h: 2000 },
        ];
        applyRegionClip(rgba, { widthPx: 40, heightPx: 30 }, regions, 100);

        expect(pixelAt(rgba, 15, 10), 'overlap band 10..20').toEqual([128, 128, 128, 255]);
        expect(pixelAt(rgba, 5, 10), 'left only').toEqual([128, 128, 128, 255]);
        expect(pixelAt(rgba, 25, 10), 'right only').toEqual([128, 128, 128, 255]);
        expect(pixelAt(rgba, 35, 10), 'outside (right)').toEqual([255, 255, 255, 255]);
        expect(pixelAt(rgba, 5, 25), 'outside (below)').toEqual([255, 255, 255, 255]);
    });

    it('reads the F-tag preset as a hole-free union with a blank lower-right notch', () => {
        const doc = createFtagSpareDoc({ nodes: [] });
        const dpi = 300;
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, dpi);
        const hmPerPx = HM_PER_INCH / dpi;
        const rgba = greyBuffer(dims.widthPx, dims.heightPx, 64);
        applyRegionClip(rgba, dims, doc.label.regions, hmPerPx);

        const atHm = (xHm: number, yHm: number): number[] =>
            pixelAt(rgba, Math.round(xHm / hmPerPx), Math.round(yHm / hmPerPx));

        expect(atHm(600, 1900), 'flag').toEqual([64, 64, 64, 255]);
        expect(atHm(600, 5000), 'spare').toEqual([64, 64, 64, 255]);
        expect(atHm(1700, 5000), 'tail only').toEqual([64, 64, 64, 255]);
        expect(atHm(1900, 1000), 'flag ∩ tail overlap stays covered').toEqual([64, 64, 64, 255]);
        expect(atHm(2300, 4000), 'lower-right notch is blank').toEqual([255, 255, 255, 255]);

        // Full-raster no-hole scan: flood-fill the white background from the
        // border; any white pixel that is NOT border-connected and lies inside
        // the union is a genuine interior hole. This is robust to the F-tag's
        // documented sub-pixel pinched seam (which is open to the left border).
        const w = dims.widthPx;
        const h = dims.heightPx;
        const whiteAt = (x: number, y: number): boolean => pixelAt(rgba, x, y)[0] === 255;
        const borderConnected = new Uint8Array(w * h);
        const queue: number[] = [];
        const enqueue = (x: number, y: number): void => {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const p = y * w + x;
            if (borderConnected[p] === 1 || !whiteAt(x, y)) return;
            borderConnected[p] = 1;
            queue.push(p);
        };
        for (let x = 0; x < w; x++) {
            enqueue(x, 0);
            enqueue(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
            enqueue(0, y);
            enqueue(w - 1, y);
        }
        while (queue.length > 0) {
            const p = queue.pop()!;
            const x = p % w;
            const y = (p - x) / w;
            enqueue(x + 1, y);
            enqueue(x - 1, y);
            enqueue(x, y + 1);
            enqueue(x, y - 1);
        }

        let holes = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                if (borderConnected[p] === 1 || !whiteAt(x, y)) continue;
                if (pointInUnion((x + 0.5) * hmPerPx, (y + 0.5) * hmPerPx, doc.label.regions)) holes++;
            }
        }
        expect(holes, 'no interior hole in the F-tag union').toBe(0);
        expect(regionUnionBounds(doc.label.regions)).toEqual({ x: 0, y: 0, w: 2500, h: 7800 });
        expect(
            pixelAt(rgba, Math.round(2300 / hmPerPx), Math.round(4000 / hmPerPx)),
            'notch stays white',
        ).toEqual([255, 255, 255, 255]);
    });

    it('is a no-op when the document declares no regions', () => {
        const rgba = greyBuffer(10, 10, 42);
        applyRegionClip(rgba, { widthPx: 10, heightPx: 10 }, [], 100);
        expect(pixelAt(rgba, 5, 5)).toEqual([42, 42, 42, 255]);
    });

    it('handles circle, roundedRect, and polygon contours', () => {
        // 1 px = 1 hm.
        const circle = greyBuffer(20, 20);
        applyRegionClip(
            circle,
            { widthPx: 20, heightPx: 20 },
            [{ kind: 'circle', cx: 10, cy: 10, r: 5 }],
            1,
        );
        expect(pixelAt(circle, 10, 10), 'centre').toEqual([128, 128, 128, 255]);
        expect(pixelAt(circle, 1, 1), 'corner').toEqual([255, 255, 255, 255]);

        const rounded = greyBuffer(10, 10);
        applyRegionClip(
            rounded,
            { widthPx: 10, heightPx: 10 },
            [{ kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 3 }],
            1,
        );
        expect(pixelAt(rounded, 5, 5), 'inside').toEqual([128, 128, 128, 255]);
        expect(pixelAt(rounded, 0, 0), 'clipped corner').toEqual([255, 255, 255, 255]);

        const polygon = greyBuffer(12, 12);
        applyRegionClip(
            polygon,
            { widthPx: 12, heightPx: 12 },
            [{ kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]], closed: true }],
            1,
        );
        expect(pixelAt(polygon, 2, 2), 'inside triangle').toEqual([128, 128, 128, 255]);
        expect(pixelAt(polygon, 9, 9), 'outside triangle').toEqual([255, 255, 255, 255]);
    });

    it('returns the same mutated buffer', () => {
        const rgba = greyBuffer(4, 4);
        expect(applyRegionClip(rgba, { widthPx: 4, heightPx: 4 }, [{ kind: 'rect', x: 0, y: 0, w: 4, h: 4 }], 1)).toBe(
            rgba,
        );
    });

    it('normalizes a reverse-wound polygon so it does not punch a hole (S6)', () => {
        const rgba = greyBuffer(20, 20);
        // The rect is wound one way; the polygon covers the same square the other
        // way. Without orientation normalization nonzero fill cancels to 0.
        const regions: Region[] = [
            { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
            { kind: 'polygon', points: [[0, 0], [0, 10], [10, 10], [10, 0]], closed: true },
        ];
        applyRegionClip(rgba, { widthPx: 20, heightPx: 20 }, regions, 1);
        expect(pixelAt(rgba, 5, 5), 'overlap is not a hole').toEqual([128, 128, 128, 255]);
    });

    it('does not drop a bow-tie polygon: its lobes paint, the cross is a hole', () => {
        // 1 px = 1 hm. The bow-tie [[0,0],[10,10],[10,0],[0,10]] has two triangular
        // lobes (top and bottom) meeting at the centre; nonzero fill paints both.
        const rgba = greyBuffer(20, 20);
        const regions: Region[] = [
            { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
            { kind: 'polygon', points: [[0, 0], [10, 10], [10, 0], [0, 10]], closed: true },
        ];
        applyRegionClip(rgba, { widthPx: 20, heightPx: 20 }, regions, 1);

        // Both lobes are covered (the rect would cover them anyway, so assert
        // against a bow-tie-only pass to prove the polygon itself paints).
        const bowOnly = greyBuffer(20, 20);
        applyRegionClip(
            bowOnly,
            { widthPx: 20, heightPx: 20 },
            [{ kind: 'polygon', points: [[0, 0], [10, 10], [10, 0], [0, 10]], closed: true }],
            1,
        );
        expect(pixelAt(bowOnly, 8, 2), 'top-right lobe paints').toEqual([128, 128, 128, 255]);
        expect(pixelAt(bowOnly, 8, 8), 'bottom-right lobe paints').toEqual([128, 128, 128, 255]);
        expect(pixelAt(bowOnly, 15, 15), 'outside the bow-tie is blank').toEqual([255, 255, 255, 255]);
        expect(pixelAt(bowOnly, 15, 5), 'outside the bow-tie (right) is blank').toEqual([255, 255, 255, 255]);

        // Overlapping the rect, rect-only coverage is untouched (the bow-tie's
        // cross cancels rect winding at the exact centre, which is expected).
        expect(pixelAt(rgba, 15, 5), 'no spurious hole in the rect').toEqual([128, 128, 128, 255]);
    });

    it('is defensive about negative region geometry (M4)', () => {
        const rgba = greyBuffer(20, 20);
        expect(() =>
            applyRegionClip(
                rgba,
                { widthPx: 20, heightPx: 20 },
                [
                    { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
                    { kind: 'rect', x: 1, y: 1, w: -5, h: -5 },
                    { kind: 'roundedRect', x: 1, y: 1, w: -5, h: -5, r: -2 },
                    { kind: 'circle', cx: 15, cy: 15, r: -3 },
                ],
                1,
            ),
        ).not.toThrow();
        expect(pixelAt(rgba, 5, 5), 'the valid rect stays covered').toEqual([128, 128, 128, 255]);
    });

    it('is a no-op when the regions have no drawable union (M5)', () => {
        const rgba = greyBuffer(10, 10, 42);
        applyRegionClip(
            rgba,
            { widthPx: 10, heightPx: 10 },
            [{ kind: 'polygon', points: [[0, 0], [1, 1]], closed: true }],
            100,
        );
        expect(pixelAt(rgba, 5, 5), 'degenerate polygon does not blank the label').toEqual([42, 42, 42, 255]);
    });

    it('is a no-op for a zero-area rect or circle (B)', () => {
        const zeroRect = greyBuffer(10, 10, 42);
        applyRegionClip(zeroRect, { widthPx: 10, heightPx: 10 }, [{ kind: 'rect', x: 2, y: 2, w: 0, h: 6 }], 1);
        expect(pixelAt(zeroRect, 5, 5), 'zero-width rect').toEqual([42, 42, 42, 255]);

        const zeroCircle = greyBuffer(10, 10, 42);
        applyRegionClip(zeroCircle, { widthPx: 10, heightPx: 10 }, [{ kind: 'circle', cx: 5, cy: 5, r: 0 }], 1);
        expect(pixelAt(zeroCircle, 5, 5), 'zero-radius circle').toEqual([42, 42, 42, 255]);

        const collinear = greyBuffer(10, 10, 42);
        applyRegionClip(
            collinear,
            { widthPx: 10, heightPx: 10 },
            [{ kind: 'polygon', points: [[0, 0], [5, 5], [10, 10]], closed: true }],
            1,
        );
        expect(pixelAt(collinear, 5, 5), 'collinear polygon').toEqual([42, 42, 42, 255]);
    });

    it('excludes an open polygon (no printable interior)', () => {
        const rgba = greyBuffer(12, 12, 42);
        applyRegionClip(
            rgba,
            { widthPx: 12, heightPx: 12 },
            [{ kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]], closed: false }],
            1,
        );
        expect(pixelAt(rgba, 2, 2), 'open polygon does not blank the label').toEqual([42, 42, 42, 255]);
    });

    it('validates hmPerPx even when the union is empty (guard order)', () => {
        const rgba = greyBuffer(4, 4);
        expect(() => applyRegionClip(rgba, { widthPx: 4, heightPx: 4 }, [], 0)).toThrow(RangeError);
        expect(() => applyRegionClip(rgba, { widthPx: 4, heightPx: 4 }, [], Number.NaN)).toThrow(RangeError);
    });
});
