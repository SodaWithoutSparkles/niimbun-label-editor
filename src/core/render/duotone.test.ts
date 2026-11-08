import { describe, expect, it } from 'vitest';
import type { RgbaBuffer } from './colorspace';
import { monoLuminance } from './colorspace';
import {
    RED_BLACK_CELL,
    redBlackDemand,
    rednessOf,
    separateRedBlack,
} from './duotone';
import { classifyFlatRedBlack, RED_BLACK_RED } from './palette';

/**
 * P9 wave B — two-ink duotone separation. Pure `RgbaBuffer` fixtures; no canvas
 * and no DOM. The encoder contract (exact `#ffffff` / `#000000` / `#ff0000`) is
 * asserted on every output pixel rather than sampled.
 */

const bufferOf = (
    width: number,
    height: number,
    pixel: (x: number, y: number) => readonly [number, number, number, number],
): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixel(x, y);
            const i = (y * width + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
        }
    }
    return { data, width, height };
};

const solid = (
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a = 255,
): RgbaBuffer => bufferOf(width, height, () => [r, g, b, a]);

interface Tally {
    white: number;
    black: number;
    red: number;
    other: number;
}

const tally = (rgba: RgbaBuffer): Tally => {
    const counts: Tally = { white: 0, black: 0, red: 0, other: 0 };
    const { data } = rgba;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r === 255 && g === 255 && b === 255) counts.white++;
        else if (r === 0 && g === 0 && b === 0) counts.black++;
        else if (r === 255 && g === 0 && b === 0) counts.red++;
        else counts.other++;
    }
    return counts;
};

const isRed = (rgba: RgbaBuffer, x: number, y: number): boolean => {
    const i = (y * rgba.width + x) * 4;
    return rgba.data[i] === 255 && rgba.data[i + 1] === 0 && rgba.data[i + 2] === 0;
};

/** Red pixels of a raster (or of one cell's coordinate list). */
const redPointsOf = (rgba: RgbaBuffer): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    for (let y = 0; y < rgba.height; y++) {
        for (let x = 0; x < rgba.width; x++) {
            if (isRed(rgba, x, y)) points.push({ x, y });
        }
    }
    return points;
};

/** True when every point is reachable orthogonally from the first. Empty = true. */
const isOrthogonallyConnected = (points: readonly { x: number; y: number }[]): boolean => {
    if (points.length === 0) return true;
    const keys = new Set(points.map(({ x, y }) => `${x},${y}`));
    const seen = new Set<string>();
    const stack = [points[0]!];
    while (stack.length > 0) {
        const point = stack.pop()!;
        const key = `${point.x},${point.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ] as const) {
            const neighbour = `${point.x + dx},${point.y + dy}`;
            if (keys.has(neighbour) && !seen.has(neighbour)) {
                stack.push({ x: point.x + dx, y: point.y + dy });
            }
        }
    }
    return seen.size === points.length;
};

/** A mixed photo-ish fixture: red, neutral, pink and dark bands. */
const photo = (width = 60, height = 24): RgbaBuffer =>
    bufferOf(width, height, (x) => {
        const band = x / width;
        if (band < 0.25) return [200, 40, 30, 255]; // saturated red
        if (band < 0.5) return [128, 128, 128, 255]; // neutral mid grey
        if (band < 0.75) return [230, 150, 140, 255]; // pink
        return [40, 60, 30, 255]; // green
    });

describe('colour separation table', () => {
    /**
     * Defaults: redIntensity 1, blackDepth 0.5. Black is the BT.601 darkness
     * `(1 − Y − 0.04) / 0.96` minus `RED_INK_DARKNESS × red`, so bright red and
     * pink need none, a dark red keeps its shadow, and neutrals match mono.
     */
    const cases = [
        { name: 'bright red', rgb: [200, 40, 30] as const, red: 1, black: 0 },
        { name: 'pink', rgb: [230, 150, 140] as const, red: 0.508, black: 0 },
        { name: 'dark red', rgb: [90, 20, 15] as const, red: 0.546, black: 0.453 },
        { name: 'green', rgb: [40, 60, 30] as const, red: 0, black: 0.793 },
        { name: 'brown', rgb: [140, 110, 80] as const, red: 0, black: 0.528 },
        { name: 'paper', rgb: [250, 250, 240] as const, red: 0, black: 0 },
        { name: 'orange', rgb: [255, 140, 0] as const, red: 0.191, black: 0.219 },
    ];

    it('lands the seven samples in their demand bands (±0.02)', () => {
        for (const sample of cases) {
            const [r, g, b] = sample.rgb;
            const demand = redBlackDemand(r, g, b);
            expect(Math.abs(demand.red - sample.red), `${sample.name} red`)
                .toBeLessThanOrEqual(0.02);
            expect(Math.abs(demand.black - sample.black), `${sample.name} black`)
                .toBeLessThanOrEqual(0.02);
        }
    });

    it('rejects a near-neutral warm colour (chroma guard)', () => {
        // rgb(200,176,172) sits on the red axis (OKLab hue ≈ 29°) but has
        // chroma C ≈ 0.0285, i.e. it is a warm light grey. Without the
        // near-neutral gate the hue gate alone would ask for ink.
        expect(rednessOf(200, 176, 172)).toBeLessThan(0.02);
        expect(redBlackDemand(200, 176, 172).red).toBeLessThan(0.02);

        // Saturated samples are past `smoothstep(0.015, 0.06, C)` (C ≥ 0.098),
        // so the gate is exactly 1 and their values are unchanged.
        expect(rednessOf(200, 40, 30)).toBeCloseTo(1, 3);
        expect(rednessOf(230, 150, 140)).toBeCloseTo(0.508, 2);
        expect(rednessOf(90, 20, 15)).toBeCloseTo(0.546, 2);
    });

    it('maps paper to exactly zero demand', () => {
        const demand = redBlackDemand(250, 250, 240);
        expect(demand.red).toBe(0);
        expect(demand.black).toBe(0);
    });

    it('orders reds and blacks as designed', () => {
        const pink = redBlackDemand(230, 150, 140);
        const bright = redBlackDemand(200, 40, 30);
        const dark = redBlackDemand(90, 20, 15);
        const green = redBlackDemand(40, 60, 30);
        const brown = redBlackDemand(140, 110, 80);
        const orange = redBlackDemand(255, 140, 0);

        expect(pink.red).toBeLessThan(bright.red);
        expect(dark.black).toBeGreaterThan(0);
        expect(green.red).toBe(0);
        expect(brown.red).toBe(0);
        expect(orange.red).toBeGreaterThan(0);
        expect(orange.red).toBeLessThan(1);
        // Neutrals are not lightened relative to the red-hued samples.
        expect(brown.black).toBeGreaterThan(pink.black);
        expect(green.black).toBeGreaterThan(brown.black);
    });

    it('prints neutrals at the mono/grayscale tone', () => {
        // No red demand ⇒ black is exactly the mono darkness, so the print
        // cannot come out lighter than the mono or grayscale rendering.
        for (const [r, g, b] of [
            [128, 128, 128],
            [140, 110, 80],
            [40, 60, 30],
            [20, 20, 20],
        ] as const) {
            const darkness = Math.min(
                1,
                Math.max(0, (1 - monoLuminance(r, g, b) / 255 - 0.04) / 0.96),
            );
            const demand = redBlackDemand(r, g, b);
            expect(demand.red, `rgb(${r},${g},${b}) has no red`).toBe(0);
            expect(demand.black, `rgb(${r},${g},${b}) mono tone`).toBeCloseTo(darkness, 6);
        }
    });
});

describe('hue gate', () => {
    it('produces zero red for green, blue, grey and brown sweeps', () => {
        const nonRed = [
            [0, 255, 0],
            [40, 120, 40],
            [0, 0, 255],
            [0, 80, 200],
            [128, 128, 128],
            [200, 200, 200],
            [140, 110, 80],
            [180, 150, 100],
            [80, 100, 40],
            [0, 128, 128],
            [255, 255, 0],
        ] as const;
        for (const [r, g, b] of nonRed) {
            expect(rednessOf(r, g, b), `rgb(${r},${g},${b})`).toBe(0);
            expect(redBlackDemand(r, g, b).red, `rgb(${r},${g},${b})`).toBe(0);
        }
    });

    it('keeps reds and pinks above zero', () => {
        for (const [r, g, b] of [
            [255, 0, 0],
            [200, 40, 30],
            [230, 150, 140],
            [255, 64, 64],
            [128, 0, 0],
        ] as const) {
            expect(rednessOf(r, g, b), `rgb(${r},${g},${b})`).toBeGreaterThan(0);
        }
    });

    it('treats orange as a partial red', () => {
        const red = rednessOf(255, 140, 0);
        expect(red).toBeGreaterThan(0);
        expect(red).toBeLessThan(1);
    });
});

describe('red cluster floor', () => {
    const cellCounts = (
        rgba: RgbaBuffer,
    ): { n: number; red: number; complete: boolean }[] => {
        const cellCols = Math.ceil(rgba.width / RED_BLACK_CELL);
        const cellRows = Math.ceil(rgba.height / RED_BLACK_CELL);
        const cells: { n: number; red: number; complete: boolean }[] = [];
        for (let cy = 0; cy < cellRows; cy++) {
            for (let cx = 0; cx < cellCols; cx++) {
                let n = 0;
                let red = 0;
                let complete = true;
                for (let dy = 0; dy < RED_BLACK_CELL; dy++) {
                    const y = cy * RED_BLACK_CELL + dy;
                    if (y >= rgba.height) {
                        complete = false;
                        continue;
                    }
                    for (let dx = 0; dx < RED_BLACK_CELL; dx++) {
                        const x = cx * RED_BLACK_CELL + dx;
                        if (x >= rgba.width) {
                            complete = false;
                            continue;
                        }
                        n++;
                        if (isRed(rgba, x, y)) red++;
                    }
                }
                cells.push({ n, red, complete });
            }
        }
        return cells;
    };

    it('gives every activated cell at least five connected dots (full red)', () => {
        const rgba = solid(30, 30, 200, 40, 30);
        separateRedBlack(rgba);

        const cells = cellCounts(rgba);
        expect(cells).toHaveLength(100);
        for (const cell of cells) {
            expect(cell.red, 'activated cell floor').toBeGreaterThanOrEqual(5);
            expect(cell.red).toBeLessThanOrEqual(cell.n);
            expect(cell.red).toBeGreaterThan(0);
        }

        // A full-demand field inks every dot, and every dot has a red orthogonal
        // neighbour (no isolated speckle).
        expect(tally(rgba).red).toBe(30 * 30);
        for (let y = 0; y < 30; y++) {
            for (let x = 0; x < 30; x++) {
                expect(isRed(rgba, x, y), `(${x},${y})`).toBe(true);
                const neighbours = [
                    [x - 1, y],
                    [x + 1, y],
                    [x, y - 1],
                    [x, y + 1],
                ] as const;
                expect(
                    neighbours.some(
                        ([nx, ny]) =>
                            nx >= 0 && nx < 30 && ny >= 0 && ny < 30 && isRed(rgba, nx, ny),
                    ),
                    `(${x},${y}) has a red orthogonal neighbour`,
                ).toBe(true);
            }
        }
    });

    it('uses exactly the 5/9 floor for a half-demand field', () => {
        // Pink (230,150,140) has red demand ≈ 0.51 → the 5/9 level: a 5-dot
        // plus-shape, the physical floor. Cell-level diffusion spreads the tone
        // by switching whole cells off, never by thinning an activated cell.
        const rgba = solid(30, 30, 230, 150, 140);
        separateRedBlack(rgba);

        const cells = cellCounts(rgba);
        let activated = 0;
        for (const cell of cells) {
            expect([0, 5], 'activated cell level').toContain(cell.red);
            if (cell.red > 0) activated++;
        }
        expect(activated, 'the field is red').toBeGreaterThan(0);
        expect(activated, 'most cells carry the floor').toBeGreaterThan(cells.length * 0.7);
    });

    it('never puts a red dot outside an activated cell', () => {
        const rgba = photo();
        separateRedBlack(rgba);
        for (const cell of cellCounts(rgba)) {
            if (cell.red > 0) {
                expect(cell.red).toBeGreaterThanOrEqual(Math.ceil(0.5 * cell.n));
            }
        }
    });
});

describe('connected growth', () => {
    it('keeps a flat-perforated cell connected with at least four dots', () => {
        // The centre dot is flat paper; all eight other dots carry full red
        // demand. An activated cluster must still be one connected patch.
        const rgba = solid(3, 3, 200, 40, 30);
        const flat = new Uint8Array(9);
        flat[4] = 1;
        separateRedBlack(rgba, { flat, flatNearest: () => 0 });

        const points = redPointsOf(rgba);
        expect(points.length).not.toBe(0);
        expect(points.length, '0 or ≥ 4 connected dots').toBeGreaterThanOrEqual(4);
        expect(points.length).toBeLessThanOrEqual(8);
        expect(isOrthogonallyConnected(points)).toBe(true);
        expect(isRed(rgba, 1, 1), 'the flat centre is never inked').toBe(false);
    });

    it('grows through the available dots of a sparse cell', () => {
        // 3×3 raster, five flat pixels; the four available dots form an L.
        const rgba = solid(3, 3, 200, 40, 30);
        const flat = new Uint8Array(9).fill(1);
        for (const [x, y] of [
            [0, 0],
            [0, 1],
            [0, 2],
            [1, 2],
        ] as const) {
            flat[y * 3 + x] = 0;
        }
        separateRedBlack(rgba, { flat, flatNearest: () => 0 });

        const points = redPointsOf(rgba);
        expect(points).toHaveLength(4);
        expect(isOrthogonallyConnected(points)).toBe(true);
    });

    it('drops an unclusterable cell instead of forwarding its residual', () => {
        // Cell 0 has five available dots — a 3-dot column at x=0 plus isolated
        // dots at (2,0) and (2,2) — so growth selects only 3 and the cell is
        // suppressed. Its full-demand residual must be dropped, not diffused:
        // forwarding it would push cell 1 from 5 to 9 red dots.
        const width = 6;
        const height = 3;
        const pixel = (x: number): readonly [number, number, number, number] =>
            x < 3 ? [200, 40, 30, 255] : [230, 150, 140, 255];

        const rgba = bufferOf(width, height, pixel);
        const flat = new Uint8Array(width * height);
        for (const [x, y] of [
            [1, 0],
            [1, 1],
            [1, 2],
            [2, 1],
        ] as const) {
            flat[y * width + x] = 1;
        }
        separateRedBlack(rgba, { flat, flatNearest: () => 0 });

        const countRed = (image: RgbaBuffer, fromX: number, toX: number): number => {
            let count = 0;
            for (let y = 0; y < height; y++) {
                for (let x = fromX; x < toX; x++) if (isRed(image, x, y)) count++;
            }
            return count;
        };

        expect(countRed(rgba, 0, 3), 'cell 0 inks nothing').toBe(0);
        expect(countRed(rgba, 3, width), 'cell 1 keeps its own level').toBe(5);

        // 5 is also what cell 1 inks when cell 0 is entirely flat (n = 0 is
        // skipped), so the suppressed cell demonstrably leaked no residual.
        const reference = bufferOf(width, height, pixel);
        const referenceFlat = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < 3; x++) referenceFlat[y * width + x] = 1;
        }
        separateRedBlack(reference, { flat: referenceFlat, flatNearest: () => 0 });
        expect(countRed(reference, 3, width)).toBe(5);
        expect(countRed(reference, 3, width)).toBe(countRed(rgba, 3, width));
    });

    it('keeps best-effort ink but drops the residual when growth stalls', () => {
        // Cell 0: flat (1,0) and (0,1) leave 7 available dots. Full red demand
        // asks for target 7, but corner (0,0) is isolated by those two flat
        // neighbours: connected growth inks 6 (centre, S, E, BR, TR, BL) and
        // stalls. The 7 → 6 shortfall (raw residual 1 − 6/7 ≈ 0.143) must be
        // dropped, not forwarded into cell 1.
        const width = 6;
        const height = 3;
        const pixel = (x: number): readonly [number, number, number, number] =>
            x < 3 ? [200, 40, 30, 255] : [230, 150, 140, 255];

        const rgba = bufferOf(width, height, pixel);
        const flat = new Uint8Array(width * height);
        for (const [x, y] of [
            [1, 0],
            [0, 1],
        ] as const) {
            flat[y * width + x] = 1;
        }
        separateRedBlack(rgba, { flat, flatNearest: () => 0 });

        const left = redPointsOf(rgba).filter(({ x }) => x < 3);
        expect(left, 'cell 0 keeps its 6-dot best effort').toHaveLength(6);
        expect(isOrthogonallyConnected(left)).toBe(true);
        expect(left.some(({ x, y }) => x === 0 && y === 0), 'isolated corner stays paper')
            .toBe(false);

        const countRed = (image: RgbaBuffer, fromX: number): number =>
            redPointsOf(image).filter(({ x }) => x >= fromX).length;
        expect(countRed(rgba, 3), 'cell 1 is not biased').toBe(5);

        // Reference: cell 0 entirely flat (n = 0, skipped, no residual at all)
        // → cell 1 still inks 5, the same number, so the stalled cell leaked
        // nothing.
        const reference = bufferOf(width, height, pixel);
        const referenceFlat = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < 3; x++) referenceFlat[y * width + x] = 1;
        }
        separateRedBlack(reference, { flat: referenceFlat, flatNearest: () => 0 });
        expect(countRed(reference, 3)).toBe(5);
        expect(countRed(reference, 3)).toBe(countRed(rgba, 3));
    });
});

describe('exclusivity and output bytes', () => {
    it('writes only exact white, black and red, and preserves alpha', () => {
        const rgba = bufferOf(60, 24, (x, y) => {
            const band = x / 60;
            const alpha = (x * 7 + y * 13) % 256;
            if (band < 0.25) return [200, 40, 30, alpha];
            if (band < 0.5) return [40, 60, 30, alpha];
            if (band < 0.75) return [128, 128, 128, alpha];
            return [20, 20, 20, alpha];
        });
        const alphas = rgba.data.filter((_, i) => i % 4 === 3);

        separateRedBlack(rgba);

        const counts = tally(rgba);
        expect(counts.other, 'only the three exact encoder colours').toBe(0);
        expect(counts.red).toBeGreaterThan(0);
        expect(counts.black).toBeGreaterThan(0);
        expect(counts.white).toBeGreaterThan(0);
        expect(rgba.data.filter((_, i) => i % 4 === 3)).toEqual(alphas);
    });
});

describe('knobs', () => {
    it('redIntensity 0 removes red ink entirely', () => {
        const rgba = photo();
        separateRedBlack(rgba, { redIntensity: 0 });
        expect(tally(rgba).red).toBe(0);
    });

    it('redIntensity 1.5 never lowers the red mass', () => {
        const base = photo();
        separateRedBlack(base, { redIntensity: 1 });
        const boosted = photo();
        separateRedBlack(boosted, { redIntensity: 1.5 });
        expect(tally(boosted).red).toBeGreaterThanOrEqual(tally(base).red);
    });

    it('blackDepth is monotonic in black mass', () => {
        const mass = (blackDepth: number): number => {
            const rgba = photo();
            separateRedBlack(rgba, { blackDepth });
            return tally(rgba).black;
        };
        const low = mass(0);
        const mid = mass(0.5);
        const high = mass(1);
        expect(mid).toBeGreaterThanOrEqual(low);
        expect(high).toBeGreaterThanOrEqual(mid);
    });

    it('blackDepth scales the demand ×0.5 … ×2 around the mono tone', () => {
        const grey = [150, 150, 150] as const;
        const base = redBlackDemand(...grey, { blackDepth: 0.5 }).black;
        expect(base).toBeGreaterThan(0);
        expect(redBlackDemand(...grey, { blackDepth: 0.5 }).black).toBeCloseTo(base, 6);
        expect(redBlackDemand(...grey, { blackDepth: 0 }).black).toBeCloseTo(base * 0.5, 6);
        expect(redBlackDemand(...grey, { blackDepth: 1 }).black).toBeCloseTo(base * 2, 6);
        for (const blackDepth of [0, 0.5, 1]) {
            expect(redBlackDemand(...grey, { blackDepth }).black).toBeLessThanOrEqual(1);
        }
    });

    it('treats non-finite knobs as the defaults', () => {
        const reference = photo();
        separateRedBlack(reference);

        for (const options of [
            { redIntensity: Number.NaN },
            { redIntensity: Number.POSITIVE_INFINITY },
            { blackDepth: Number.NaN },
            { blackDepth: Number.NEGATIVE_INFINITY },
        ]) {
            const rgba = photo();
            separateRedBlack(rgba, options);
            expect(Array.from(rgba.data), JSON.stringify(options)).toEqual(
                Array.from(reference.data),
            );
        }
    });
});

describe('flat mask', () => {
    const flatStraight = (r: number, g: number, b: number): number =>
        classifyFlatRedBlack(r, g, b);

    it('keeps locked art exact while a neighbour still dithers', () => {
        // Columns: 0..6 flat white, 6..12 flat black, 12..18 flat "red" (pink,
        // which the photo path would dither at ~50 %), 18..30 diffuse grey.
        const width = 30;
        const height = 6;
        const rgba = bufferOf(width, height, (x) => {
            if (x < 6) return [255, 255, 255, 255];
            if (x < 12) return [0, 0, 0, 255];
            if (x < 18) return [230, 150, 140, 255];
            return [128, 128, 128, 255];
        });
        const flat = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < 18; x++) flat[y * width + x] = 1;
        }
        const alphas = rgba.data.filter((_, i) => i % 4 === 3);

        separateRedBlack(rgba, { flat, flatNearest: flatStraight });

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const [r, g, b] = [rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]];
                if (x < 6) expect([r, g, b], `flat white (${x},${y})`).toEqual([255, 255, 255]);
                else if (x < 12) expect([r, g, b], `flat black (${x},${y})`).toEqual([0, 0, 0]);
                else if (x < 18) expect([r, g, b], `flat red (${x},${y})`).toEqual([255, 0, 0]);
            }
        }

        // The photo half still dithers, and no locked pixel ever receives ink.
        const diffuse = { black: 0, white: 0 } as { black: number; white: number };
        for (let y = 0; y < height; y++) {
            for (let x = 18; x < width; x++) {
                const i = (y * width + x) * 4;
                const r = rgba.data[i];
                if (r === 0) diffuse.black++;
                else if (r === 255) diffuse.white++;
            }
        }
        expect(diffuse.black, 'the diffuse half still dithers').toBeGreaterThan(0);
        expect(diffuse.white).toBeGreaterThan(0);
        expect(tally(rgba).other).toBe(0);
        expect(rgba.data.filter((_, i) => i % 4 === 3)).toEqual(alphas);
    });

    it('never inks a flat pixel the classifier called white', () => {
        // A flat white half beside a dense black field: the diffused black error
        // must be dropped at the locked seam, not develop into dots.
        const width = 24;
        const height = 12;
        const rgba = bufferOf(width, height, (x) => (x < 12 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
        const flat = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < 12; x++) flat[y * width + x] = 1;
        }

        separateRedBlack(rgba, { flat, flatNearest: flatStraight });

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < 12; x++) {
                expect(isRed(rgba, x, y)).toBe(false);
                const i = (y * width + x) * 4;
                expect([rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]]).toEqual([
                    255, 255, 255,
                ]);
            }
        }
    });

    it('classifies flat pixels from the raw source bytes', () => {
        // The classifier must see the authored colour, not any diffused demand.
        const seen: Array<readonly [number, number, number]> = [];
        const rgba = solid(2, 1, 230, 150, 140);
        const flat = new Uint8Array([1, 1]);

        separateRedBlack(rgba, {
            flat,
            flatNearest: (r, g, b) => {
                seen.push([r, g, b]);
                return flatStraight(r, g, b);
            },
        });

        expect(seen).toEqual([
            [230, 150, 140],
            [230, 150, 140],
        ]);
        expect(tally(rgba).red).toBe(2);
        expect(flatStraight(230, 150, 140)).toBe(RED_BLACK_RED);
    });

    it('rejects a flat mask that does not match the raster', () => {
        expect(() => separateRedBlack(solid(4, 4, 128, 128, 128), { flat: new Uint8Array(15) }))
            .toThrow(RangeError);
    });
});

describe('determinism', () => {
    it('is byte-identical across runs and changes with the knobs', () => {
        const first = photo();
        separateRedBlack(first);
        const second = photo();
        separateRedBlack(second);
        expect(Array.from(second.data)).toEqual(Array.from(first.data));

        const different = photo();
        separateRedBlack(different, { redIntensity: 0.6 });
        expect(Array.from(different.data)).not.toEqual(Array.from(first.data));
    });
});

describe('tiny and partial rasters', () => {
    it('never throws and keeps the half-dots rule at every edge', () => {
        for (const [width, height] of [
            [1, 1],
            [1, 3],
            [3, 1],
            [2, 2],
            [4, 5],
            [7, 8],
        ] as const) {
            const rgba = solid(width, height, 200, 40, 30);
            expect(() => separateRedBlack(rgba), `${width}×${height}`).not.toThrow();
            const counts = tally(rgba);
            expect(counts.other, `${width}×${height} colours`).toBe(0);

            const cellCols = Math.ceil(width / RED_BLACK_CELL);
            const cellRows = Math.ceil(height / RED_BLACK_CELL);
            for (let cy = 0; cy < cellRows; cy++) {
                for (let cx = 0; cx < cellCols; cx++) {
                    let n = 0;
                    let red = 0;
                    for (let dy = 0; dy < RED_BLACK_CELL; dy++) {
                        const y = cy * RED_BLACK_CELL + dy;
                        if (y >= height) continue;
                        for (let dx = 0; dx < RED_BLACK_CELL; dx++) {
                            const x = cx * RED_BLACK_CELL + dx;
                            if (x >= width) continue;
                            n++;
                            if (isRed(rgba, x, y)) red++;
                        }
                    }
                    if (red === 0) continue;
                    expect(red, `${width}×${height} cell (${cx},${cy}) half-dots`).toBeGreaterThanOrEqual(
                        Math.ceil(0.5 * n),
                    );
                    expect(red).toBeLessThanOrEqual(n);
                }
            }
        }
    });
    it('puts no red in a cell with fewer than four available dots', () => {
        for (const [width, height] of [
            [1, 1],
            [1, 2],
            [2, 1],
            [1, 3],
            [3, 1],
            [1, 6],
            [1, 9],
        ] as const) {
            const rgba = solid(width, height, 200, 40, 30);
            expect(() => separateRedBlack(rgba), `${width}×${height}`).not.toThrow();
            expect(tally(rgba).red, `${width}×${height} isolated dots`).toBe(0);
            expect(tally(rgba).other, `${width}×${height} colours`).toBe(0);
        }
    });

    it('keeps an activated partial cell connected and at least four dots', () => {
        for (const [width, height] of [
            [2, 2],
            [4, 4],
            [5, 5],
            [7, 8],
        ] as const) {
            const rgba = solid(width, height, 200, 40, 30);
            separateRedBlack(rgba);
            const cellCols = Math.ceil(width / RED_BLACK_CELL);
            const cellRows = Math.ceil(height / RED_BLACK_CELL);
            for (let cy = 0; cy < cellRows; cy++) {
                for (let cx = 0; cx < cellCols; cx++) {
                    const points: { x: number; y: number }[] = [];
                    let n = 0;
                    for (let dy = 0; dy < RED_BLACK_CELL; dy++) {
                        const y = cy * RED_BLACK_CELL + dy;
                        if (y >= height) continue;
                        for (let dx = 0; dx < RED_BLACK_CELL; dx++) {
                            const x = cx * RED_BLACK_CELL + dx;
                            if (x >= width) continue;
                            n++;
                            if (isRed(rgba, x, y)) points.push({ x, y });
                        }
                    }
                    if (points.length === 0) continue;
                    expect(n, `${width}×${height} cell (${cx},${cy}) availability`)
                        .toBeGreaterThanOrEqual(4);
                    expect(points.length, `${width}×${height} cell (${cx},${cy}) floor`)
                        .toBeGreaterThanOrEqual(4);
                    expect(
                        isOrthogonallyConnected(points),
                        `${width}×${height} cell (${cx},${cy}) is connected`,
                    ).toBe(true);
                }
            }
        }
    });
});

describe('tone conservation', () => {
    it('conserves a uniform mid-red field after cell quantisation', () => {
        const size = 60;
        const rgba = solid(size, size, 200, 130, 120);
        const demand = redBlackDemand(200, 130, 120).red;
        expect(demand).toBeGreaterThan(0.3);
        expect(demand).toBeLessThan(0.5);

        separateRedBlack(rgba);

        const expected = demand * size * size;
        const actual = tally(rgba).red;
        expect(Math.abs(actual - expected) / expected).toBeLessThan(0.05);
    });

    it('conserves a neutral mid-grey field', () => {
        const size = 60;
        const rgba = solid(size, size, 128, 128, 128);
        const expected =
            (1 - monoLuminance(128, 128, 128) / 255 - 0.04) / 0.96;

        separateRedBlack(rgba);

        const actual = tally(rgba).black / (size * size);
        expect(Math.abs(actual - expected)).toBeLessThan(0.03);
    });
});

describe('realized-coverage residual', () => {
    it('conserves a floor-limited field within 5 % of the requested level', () => {
        // Every 3×3 cell exposes only a 2×2 corner block, so pink demand
        // (0.508 → level 5/9) is always pushed up to the 4-dot floor. Diffusing
        // the realized coverage (1.0) instead of the level (5/9) pays that
        // over-ink back, so the field keeps the requested average instead of
        // inking every cell.
        const cellsX = 4;
        const cellsY = 4;
        const width = cellsX * RED_BLACK_CELL;
        const height = cellsY * RED_BLACK_CELL;
        const rgba = solid(width, height, 230, 150, 140);
        const flat = new Uint8Array(width * height).fill(1);
        for (let cy = 0; cy < cellsY; cy++) {
            for (let cx = 0; cx < cellsX; cx++) {
                for (const [dx, dy] of [
                    [0, 0],
                    [1, 0],
                    [0, 1],
                    [1, 1],
                ] as const) {
                    flat[(cy * 3 + dy) * width + cx * 3 + dx] = 0;
                }
            }
        }

        separateRedBlack(rgba, { flat, flatNearest: () => 0 });

        const available = cellsX * cellsY * 4; // 64 photo dots
        const requested = (5 / 9) * available; // level × pixelCount
        const actual = tally(rgba).red;
        expect(actual).toBeGreaterThan(0);
        expect(
            Math.abs(actual - requested) / requested,
            `${actual} red vs requested ${requested.toFixed(2)}`,
        ).toBeLessThan(0.05);
    });

    it('pays a floor cell over-ink forward instead of biasing the next cell', () => {
        // Two floor-limited cells (4 of 4 dots inked vs level 5/9) precede a
        // full 3×3 cell, all at pink demand. Diffusing `raw − realized` means
        // the two over-inked cells' excess suppresses the neighbour to zero;
        // with the old `raw − level` rule both cells banked their over-ink and
        // the full neighbour still inked its 5 dots (a +50 % tone bias). A
        // three-cell fixture cannot hit a 5 % total band because the floor
        // quantises coverage to 0/4/5, hence the explicit direction assertion.
        const width = 9;
        const height = 3;
        const rgba = solid(width, height, 230, 150, 140);
        const flat = new Uint8Array(width * height).fill(1);
        for (const [x, y] of [
            // Cell 0: 2×2 block.
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
            // Cell 1: 2×2 block.
            [3, 0],
            [4, 0],
            [3, 1],
            [4, 1],
            // Cell 2: fully available.
            [6, 0],
            [7, 0],
            [8, 0],
            [6, 1],
            [7, 1],
            [8, 1],
            [6, 2],
            [7, 2],
            [8, 2],
        ] as const) {
            flat[y * width + x] = 0;
        }

        separateRedBlack(rgba, { flat, flatNearest: () => 0 });

        let first = 0;
        let second = 0;
        let third = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!isRed(rgba, x, y)) continue;
                if (x < 3) first++;
                else if (x < 6) second++;
                else third++;
            }
        }
        expect([first, second, third]).toEqual([4, 4, 0]);
        expect(tally(rgba).red).toBe(8);

        // 8 dots over the 17 available dots is within 10 % of the requested
        // 8.64, i.e. no positive bias (which would have been 13 dots).
        const requested = redBlackDemand(230, 150, 140).red * 17;
        expect(Math.abs(8 - requested) / requested).toBeLessThan(0.1);
    });
});

describe('ink isolation', () => {
    it('gives a pure green field no red ink', () => {
        const rgba = solid(24, 24, 40, 60, 30);
        separateRedBlack(rgba);
        expect(tally(rgba).red).toBe(0);
        expect(tally(rgba).black).toBeGreaterThan(0);
    });

    it('gives a pure bright red field no black ink', () => {
        const rgba = solid(24, 24, 200, 40, 30);
        separateRedBlack(rgba);
        expect(tally(rgba).black).toBe(0);
        expect(tally(rgba).red).toBeGreaterThan(0);
    });
});
