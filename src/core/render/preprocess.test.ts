import { describe, expect, it } from 'vitest';
import { monoLuminance, MonoColorSpace, type ColorSpace, type RgbaBuffer } from './colorspace';
import {
    applyGreyChain,
    buildPreprocessChain,
    buildToneLut,
    GAMMA_MAX,
    GAMMA_MIN,
    preprocessGrey,
    projectGrey,
    toByte,
    type GreyOp,
    type GreyPlane,
    type PreprocessParams,
} from './preprocess';

/** Build a one-row plane from a list of grey values. */
const planeOf = (values: readonly number[]): GreyPlane => ({
    data: new Float32Array(values),
    width: values.length,
    height: 1,
});

/** Run the preprocess chain for `gamma` over `values` and return the plane. */
const runChain = (gamma: number | undefined, values: readonly number[]): GreyPlane => {
    const plane = planeOf(values);
    const params: PreprocessParams = gamma === undefined ? {} : { gamma };
    preprocessGrey(plane, params);
    return plane;
};

describe('neutral preprocess chain', () => {
    const NEUTRAL: readonly PreprocessParams[] = [
        {},
        { gamma: 1 },
        // Non-finite gammas normalize to the neutral 1, so they build no op.
        { gamma: NaN },
        { gamma: Infinity },
        { gamma: -Infinity },
    ];

    it('is empty for absent, 1 and non-finite gamma', () => {
        for (const params of NEUTRAL) {
            expect(buildPreprocessChain(params), JSON.stringify(params)).toEqual([]);
        }
    });

    it('leaves a plane byte-identical — the neutral path does not round', () => {
        // Deliberately non-integral values: a neutral chain must preserve the raw
        // float projection exactly, including values outside 0..255.
        const values = [-1.25, 0.4, 63.5, 127.5, 200.2, 255.75];
        for (const params of NEUTRAL) {
            const plane = planeOf(values);
            const before = new Float32Array(plane.data);
            preprocessGrey(plane, params);
            expect(plane.data, JSON.stringify(params)).toEqual(before);
        }
    });
});

describe('tone-curve grey op', () => {
    it('matches buildToneLut entry for entry over 0..255', () => {
        const values = Array.from({ length: 256 }, (_, i) => i);
        for (const gamma of [GAMMA_MIN, 0.5, 1.3, 2.2, GAMMA_MAX]) {
            const chain = buildPreprocessChain({ gamma });
            expect(chain, `gamma ${gamma}`).toHaveLength(1);
            const plane = planeOf(values);
            applyGreyChain(plane, chain);
            const lut = buildToneLut(gamma);
            for (let i = 0; i < 256; i++) {
                expect(plane.data[i], `gamma ${gamma} at ${i}`).toBe(lut[i]);
            }
        }
    });

    it('rounds and clamps the plane value into the LUT index domain', () => {
        const values = [-1000, -0.6, -0.4, 0.4, 0.6, 127.5, 128.4, 254.5, 255.4, 1e9];
        const gamma = 1.3;
        const plane = runChain(gamma, values);
        const lut = buildToneLut(gamma);
        for (let p = 0; p < values.length; p++) {
            expect(plane.data[p], `value ${values[p]}`).toBe(lut[toByte(values[p])]);
        }
    });

    it('clamps finite gamma like buildToneLut', () => {
        const values = [0, 37.5, 128, 192.25, 255];
        expect(runChain(0, values).data).toEqual(runChain(GAMMA_MIN, values).data);
        expect(runChain(-3, values).data).toEqual(runChain(GAMMA_MIN, values).data);
        expect(runChain(9, values).data).toEqual(runChain(GAMMA_MAX, values).data);
    });
});

describe('projectGrey', () => {
    const rgba: RgbaBuffer = {
        data: new Uint8ClampedArray([12, 200, 3, 255, 128, 34, 250, 128]),
        width: 2,
        height: 1,
    };

    it('writes one float per pixel, equal to the colorSpace projection', () => {
        const plane = projectGrey(rgba);
        expect(plane.width).toBe(2);
        expect(plane.height).toBe(1);
        expect(plane.data).toHaveLength(2);
        for (let p = 0, i = 0; p < plane.data.length; p++, i += 4) {
            // The plane is Float32; compare against the float32-rounded projection.
            expect(plane.data[p]).toBe(
                Math.fround(MonoColorSpace.toGray(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2])),
            );
        }
    });

    it('uses the supplied colorSpace', () => {
        const inverted: ColorSpace = { id: 'mono', toGray: (r, g, b) => 255 - monoLuminance(r, g, b) };
        const plane = projectGrey(rgba, inverted);
        for (let p = 0, i = 0; p < plane.data.length; p++, i += 4) {
            expect(plane.data[p]).toBe(
                Math.fround(inverted.toGray(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2])),
            );
        }
    });
});

describe('chain ordering', () => {
    it('applies ops in array order', () => {
        const trace: string[] = [];
        const first: GreyOp = (plane) => {
            trace.push('first');
            plane.data[0] += 1;
        };
        const second: GreyOp = (plane) => {
            trace.push('second');
            plane.data[0] *= 2;
        };

        const forward = planeOf([3]);
        applyGreyChain(forward, [first, second]);
        expect(trace).toEqual(['first', 'second']);
        expect(forward.data[0]).toBe(8); // (3 + 1) * 2

        const reverse = planeOf([3]);
        applyGreyChain(reverse, [second, first]);
        expect(reverse.data[0]).toBe(7); // 3 * 2 + 1
    });
});
