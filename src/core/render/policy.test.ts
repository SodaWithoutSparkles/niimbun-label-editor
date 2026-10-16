import { describe, expect, it } from 'vitest';
import { monoLuminance, type ColorSpace, type RgbaBuffer } from './colorspace';
import { floydSteinberg, threshold, type QuantizeOptions, type Quantizer, type QuantizerDefaults } from './quantize';
import {
    applyPolicy,
    DEFAULT_POLICY_BY_TYPE,
    policyKeyOf,
    quantizerSettingsKey,
    resolveQuantizer,
    resolveQuantizerParams,
    type PolicyMask,
} from './policy';
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

    it('lets a supplied per-type map win over the module constant, per type', () => {
        // The map replaces only the types it names ...
        expect(resolveQuantizer({ type: 'text' }, { text: 'atkinson' })).toBe('atkinson');
        // ... while types it omits still resolve through DEFAULT_POLICY_BY_TYPE.
        expect(resolveQuantizer({ type: 'image' }, { text: 'atkinson' })).toBe('floydSteinberg');
        // An explicit hint still beats the map.
        expect(resolveQuantizer({ type: 'text', quantizerHint: 'stucki' }, { text: 'atkinson' })).toBe(
            'stucki',
        );
        // An empty (default) map is behaviourally identical to before the setting.
        expect(resolveQuantizer({ type: 'text' }, {})).toBe('threshold');
        expect(resolveQuantizer({ type: 'shape' }, {})).toBeUndefined();
    });

    it('does not read inherited members from a supplied map', () => {
        expect(resolveQuantizer({ type: 'toString' }, {})).toBeUndefined();
    });
});

describe('policyKeyOf (D-57(b))', () => {
    it('includes serpentine so two nodes differing only in effective serpentine differ', () => {
        const params = { threshold: 128, strength: 1 };
        const on = resolveQuantizerParams(params, 'floydSteinberg');
        const off = resolveQuantizerParams({ ...params, serpentine: false }, 'floydSteinberg');
        expect(on.serpentine).toBe(true);
        expect(off.serpentine).toBe(false);
        expect(policyKeyOf('floydSteinberg', on)).not.toBe(policyKeyOf('floydSteinberg', off));
    });

    it('resolves the effective serpentine from the strategy settings default (node → setting → true)', () => {
        // No node param, no setting => engine default true.
        expect(resolveQuantizerParams(undefined, 'stucki').serpentine).toBe(true);
        // No node param, setting says false => the setting wins (never pinned true).
        expect(
            resolveQuantizerParams(undefined, 'stucki', { stucki: { serpentine: false } }).serpentine,
        ).toBe(false);
        // A node param overrides the setting.
        expect(
            resolveQuantizerParams({ serpentine: true }, 'stucki', { stucki: { serpentine: false } })
                .serpentine,
        ).toBe(true);
        expect(policyKeyOf('stucki', resolveQuantizerParams(undefined, 'stucki'))).not.toBe(
            policyKeyOf(
                'stucki',
                resolveQuantizerParams(undefined, 'stucki', { stucki: { serpentine: false } }),
            ),
        );
    });

    it('lets a per-strategy settings default fill an absent threshold/strength', () => {
        const resolved = resolveQuantizerParams(undefined, 'floydSteinberg', {
            floydSteinberg: { threshold: 200, strength: 2 },
        });
        expect(resolved).toEqual({ threshold: 200, strength: 2, serpentine: true });
        // A node param overrides the setting; the render fallback only fills gaps.
        expect(
            resolveQuantizerParams({ threshold: 50 }, 'floydSteinberg', {
                floydSteinberg: { threshold: 200 },
            }, { strength: 3 }),
        ).toEqual({ threshold: 50, strength: 3, serpentine: true });
    });
});

describe('quantizerSettingsKey', () => {
    it('is order-independent: equal content in a different insertion order has one key', () => {
        const a: QuantizerDefaults = {
            floydSteinberg: { threshold: 200, strength: 2, serpentine: false },
            stucki: { strength: 0.5 },
        };
        const b: QuantizerDefaults = {
            stucki: { strength: 0.5 },
            floydSteinberg: { serpentine: false, strength: 2, threshold: 200 },
        };
        expect(quantizerSettingsKey(a)).toBe(quantizerSettingsKey(b));
        expect(
            quantizerSettingsKey(a, { image: 'stucki', text: 'threshold' }),
        ).toBe(quantizerSettingsKey(b, { text: 'threshold', image: 'stucki' }));
    });

    it('a changed value produces a different key', () => {
        const base: QuantizerDefaults = { floydSteinberg: { serpentine: false } };
        expect(quantizerSettingsKey(base)).not.toBe(
            quantizerSettingsKey({ floydSteinberg: { serpentine: true } }),
        );
        expect(quantizerSettingsKey(base, { image: 'stucki' })).not.toBe(
            quantizerSettingsKey(base, { image: 'atkinson' }),
        );
    });

    it('treats absent and empty maps alike', () => {
        expect(quantizerSettingsKey()).toBe(quantizerSettingsKey({}, {}));
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

    it('passes policy-specific threshold and strength options', () => {
        const optionsSeen: (QuantizeOptions | undefined)[] = [];
        const record: Quantizer = (rgba, opts) => {
            optionsSeen.push(opts);
            return threshold(rgba, opts);
        };
        const mask: PolicyMask = { data: new Uint8Array(16).fill(1), width: 4, height: 4 };
        quantizeRgba(clone(ramp), {
            globalQuantizer: threshold,
            policies: new Map([[1, { quantizer: record, options: { threshold: 200, strength: 2 } }]]),
            mask,
        });
        expect(optionsSeen[0]).toMatchObject({ threshold: 200, strength: 2 });
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
