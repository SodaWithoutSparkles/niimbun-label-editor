import { describe, expect, it } from 'vitest';
import { monoLuminance, type ColorSpace, type RgbaBuffer } from './colorspace';
import { floydSteinberg, threshold, type Quantizer } from './quantize';
import { applyPolicy, DEFAULT_POLICY_BY_TYPE, resolveQuantizer, type PolicyMask } from './policy';
import { quantizeRgba } from './pipeline';

const fromGrays = (width: number, height: number, values: readonly number[]): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < values.length; p++) {
        data[p * 4] = values[p];
        data[p * 4 + 1] = values[p];
        data[p * 4 + 2] = values[p];
        data[p * 4 + 3] = 255;
    }
    return { data, width, height };
};

const clone = (rgba: RgbaBuffer): RgbaBuffer => ({
    data: new Uint8ClampedArray(rgba.data),
    width: rgba.width,
    height: rgba.height,
});

/** Full `[r, g, b]` triplet per pixel. */
const pixelsOf = (rgba: RgbaBuffer): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < rgba.data.length; i += 4) {
        out.push([rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]]);
    }
    return out;
};

const fullPass = (source: RgbaBuffer, quantizer: Quantizer): number[][] => {
    const copy = clone(source);
    quantizer(copy);
    return pixelsOf(copy);
};

const RAMP = [0, 64, 128, 192, 32, 96, 160, 224, 16, 80, 144, 208, 48, 112, 176, 240];
const ramp = fromGrays(4, 4, RAMP);
const inverted: ColorSpace = { id: 'mono', toGray: (r, g, b) => 255 - monoLuminance(r, g, b) };

describe('resolveQuantizer', () => {
    it('maps node type to the default policy', () => {
        expect(resolveQuantizer({ type: 'text' })).toBe('threshold');
        expect(resolveQuantizer({ type: 'qr' })).toBe('threshold');
        expect(resolveQuantizer({ type: 'barcode' })).toBe('threshold');
        expect(resolveQuantizer({ type: 'image' })).toBe('floydSteinberg');
    });

    it('returns undefined for unmapped types and missing type', () => {
        expect(resolveQuantizer({ type: 'shape' })).toBeUndefined();
        expect(resolveQuantizer({ type: 'group' })).toBeUndefined();
        expect(resolveQuantizer({})).toBeUndefined();
    });

    it('does not return inherited object members for a hostile type', () => {
        // A bare `DEFAULT_POLICY_BY_TYPE[type]` lookup would return
        // Object.prototype.toString for these.
        expect(resolveQuantizer({ type: 'toString' })).toBeUndefined();
        expect(resolveQuantizer({ type: 'constructor' })).toBeUndefined();
        expect(resolveQuantizer({ type: 'hasOwnProperty' })).toBeUndefined();
    });

    it('lets an explicit hint win over the type default', () => {
        expect(resolveQuantizer({ type: 'text', quantizerHint: 'stucki' })).toBe('stucki');
        expect(resolveQuantizer({ type: 'image', quantizerHint: 'atkinson' })).toBe('atkinson');
        expect(resolveQuantizer({ quantizerHint: 'threshold' })).toBe('threshold');
    });

    it('exposes the default table', () => {
        expect(DEFAULT_POLICY_BY_TYPE).toMatchObject({
            text: 'threshold',
            qr: 'threshold',
            barcode: 'threshold',
            image: 'floydSteinberg',
        });
        expect(DEFAULT_POLICY_BY_TYPE['shape']).toBeUndefined();
    });
});

describe('applyPolicy / quantizeRgba', () => {
    it('with no mask/hints equals a single global pass', () => {
        const viaPipeline = clone(ramp);
        quantizeRgba(viaPipeline, { globalQuantizer: floydSteinberg });
        expect(pixelsOf(viaPipeline)).toEqual(fullPass(ramp, floydSteinberg));

        // An explicit undefined mask is the same identity.
        const viaApply = clone(ramp);
        applyPolicy(viaApply, undefined, new Map([[0, floydSteinberg]]));
        expect(pixelsOf(viaApply)).toEqual(fullPass(ramp, floydSteinberg));
    });

    it('throws when there is no global (index 0) quantizer', () => {
        // Without a global pass the source would come back un-quantized, breaking
        // the exact-0/255 contract ImageEncoder keys on.
        expect(() => applyPolicy(clone(ramp), undefined, new Map([[1, threshold]]))).toThrow(
            /must contain index 0/,
        );
    });

    it('applies each policy to its masked pixels', () => {
        // Left half (x < 2) → threshold (index 1); right half → floyd (index 2).
        const mask: PolicyMask = { data: new Uint8Array(16), width: 4, height: 4 };
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) mask.data[y * 4 + x] = x < 2 ? 1 : 2;
        }

        const out = clone(ramp);
        quantizeRgba(out, {
            globalQuantizer: threshold,
            policies: new Map([
                [1, threshold],
                [2, floydSteinberg],
            ]),
            mask,
        });

        const thr = fullPass(ramp, threshold);
        const fs = fullPass(ramp, floydSteinberg);
        const expected = RAMP.map((_, p) => ((p % 4) < 2 ? thr[p] : fs[p]));
        expect(pixelsOf(out)).toEqual(expected);

        // The floyd-masked half actually differs from the threshold global pass.
        expect(pixelsOf(out)).not.toEqual(thr);
    });

    it('resolves overlapping coverage by mask write order (last write wins)', () => {
        const mask: PolicyMask = { data: new Uint8Array(16), width: 4, height: 4 };
        // Earlier policy 1 covers rows 0–1 ...
        for (let y = 0; y <= 1; y++) for (let x = 0; x < 4; x++) mask.data[y * 4 + x] = 1;
        // ... then the later (topmost) policy 2 overwrites rows 1–3; row 1 is contested.
        for (let y = 1; y < 4; y++) for (let x = 0; x < 4; x++) mask.data[y * 4 + x] = 2;

        const out = clone(ramp);
        quantizeRgba(out, {
            globalQuantizer: threshold,
            policies: new Map([
                [1, threshold],
                [2, floydSteinberg],
            ]),
            mask,
        });

        const thr = fullPass(ramp, threshold);
        const fs = fullPass(ramp, floydSteinberg);
        const got = pixelsOf(out);
        const expected = RAMP.map((_, p) => (Math.floor(p / 4) === 0 ? thr[p] : fs[p]));
        expect(got).toEqual(expected);

        // The contested row took the later policy, not the earlier one.
        // Pixel 5 (row 1, col 1) is where threshold and floyd disagree.
        expect(got[5]).toEqual(fs[5]);
        expect(got[5]).not.toEqual(thr[5]);
    });

    it('falls back to the global quantizer for unregistered mask indices', () => {
        const mask: PolicyMask = { data: new Uint8Array(16).fill(9), width: 4, height: 4 };
        const out = clone(ramp);
        quantizeRgba(out, { globalQuantizer: threshold, mask });
        expect(pixelsOf(out)).toEqual(fullPass(ramp, threshold));
    });

    it('ignores a mask whose dimensions do not match the buffer', () => {
        const mask: PolicyMask = { data: new Uint8Array(4).fill(1), width: 2, height: 2 };
        const out = clone(ramp);
        quantizeRgba(out, {
            globalQuantizer: threshold,
            policies: new Map([[1, floydSteinberg]]),
            mask,
        });
        expect(pixelsOf(out)).toEqual(fullPass(ramp, threshold));
    });

    it('threads the request color space into the global pass', () => {
        const mono = clone(ramp);
        quantizeRgba(mono, { globalQuantizer: threshold });
        const inv = clone(ramp);
        quantizeRgba(inv, { globalQuantizer: threshold, colorSpace: inverted });
        expect(pixelsOf(inv)).not.toEqual(pixelsOf(mono));
        expect(pixelsOf(inv)[0]).toEqual([255, 255, 255]);
        expect(pixelsOf(mono)[0]).toEqual([0, 0, 0]);
    });

    it('mutates and returns the same buffer', () => {
        const out = clone(ramp);
        expect(quantizeRgba(out, { globalQuantizer: threshold })).toBe(out);
    });
});
