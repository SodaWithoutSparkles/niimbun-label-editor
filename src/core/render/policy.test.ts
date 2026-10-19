import { describe, expect, it } from 'vitest';
import { monoLuminance, type ColorSpace, type RgbaBuffer } from './colorspace';
import { floydSteinberg, threshold, type QuantizeOptions, type Quantizer, type QuantizerDefaults } from './quantize';
import {
    applyPolicy,
    DEFAULT_GAMMA_BY_STRATEGY,
    DEFAULT_POLICY_BY_TYPE,
    DEFAULT_SCREENTONE,
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
        expect(resolved).toEqual({
            threshold: 200,
            strength: 2,
            serpentine: true,
            gamma: 1.3,
            screentoneLevels: 4,
            screentonePitchMm: 0.5,
            screentoneAngle: 45,
        });
        // A node param overrides the setting; the render fallback only fills gaps.
        expect(
            resolveQuantizerParams({ threshold: 50 }, 'floydSteinberg', {
                floydSteinberg: { threshold: 200 },
            }, { strength: 3 }),
        ).toEqual({
            threshold: 50,
            strength: 3,
            serpentine: true,
            gamma: 1.3,
            screentoneLevels: 4,
            screentonePitchMm: 0.5,
            screentoneAngle: 45,
        });
    });
});

describe('gamma — tone curve per strategy (P14 W1)', () => {
    it('defaults per strategy: threshold neutral, the diffusers 1.3', () => {
        expect(resolveQuantizerParams(undefined, 'threshold').gamma).toBe(1);
        expect(resolveQuantizerParams(undefined, 'floydSteinberg').gamma).toBe(1.3);
        expect(resolveQuantizerParams(undefined, 'stucki').gamma).toBe(1.3);
        expect(resolveQuantizerParams(undefined, 'atkinson').gamma).toBe(1.3);
        expect(resolveQuantizerParams(undefined, 'ostromoukhov').gamma).toBe(1.3);
        expect(DEFAULT_GAMMA_BY_STRATEGY).toEqual({
            threshold: 1,
            floydSteinberg: 1.3,
            stucki: 1.3,
            atkinson: 1.3,
            ostromoukhov: 1.3,
            screentone: 1,
        });
        // Every diffuser shares the dot-gain default; `threshold` and the point
        // screentone stay neutral.
        for (const [id, gamma] of Object.entries(DEFAULT_GAMMA_BY_STRATEGY)) {
            expect(gamma, id).toBe(id === 'threshold' || id === 'screentone' ? 1 : 1.3);
        }
    });

    it('gives ostromoukhov its own policy slot, distinct from the other strategies', () => {
        const resolved = resolveQuantizerParams(undefined, 'ostromoukhov');
        expect(resolved).toEqual({
            threshold: 128,
            strength: 1,
            serpentine: true,
            gamma: 1.3,
            screentoneLevels: 4,
            screentonePitchMm: 0.5,
            screentoneAngle: 45,
        });
        expect(policyKeyOf('ostromoukhov', resolved)).not.toBe(
            policyKeyOf('floydSteinberg', resolveQuantizerParams(undefined, 'floydSteinberg')),
        );
        // Same id, different gamma: still two slots (D-57(b) applies here too).
        expect(policyKeyOf('ostromoukhov', resolved)).not.toBe(
            policyKeyOf('ostromoukhov', { ...resolved, gamma: 1 }),
        );
        // A node param overrides the strategy default through the usual chain.
        expect(resolveQuantizerParams({ gamma: 1 }, 'ostromoukhov').gamma).toBe(1);
        expect(
            resolveQuantizerParams(undefined, 'ostromoukhov', { ostromoukhov: { gamma: 1.6 } }).gamma,
        ).toBe(1.6);
    });

    it('quantizerSettingsKey carries ostromoukhov settings (preview/thumbnail cache key)', () => {
        expect(quantizerSettingsKey({ ostromoukhov: { gamma: 1.3 } })).toContain(
            'ostromoukhov:gamma=1.3',
        );
        expect(quantizerSettingsKey({ ostromoukhov: { gamma: 1.3 } })).not.toBe(
            quantizerSettingsKey({ ostromoukhov: { gamma: 1.4 } }),
        );
    });

    it('resolves node → settings → render fallback → per-strategy default', () => {
        // The render fallback beats the per-strategy default.
        expect(
            resolveQuantizerParams(undefined, 'threshold', undefined, { gamma: 2 }).gamma,
        ).toBe(2);
        // The settings default beats the render fallback.
        expect(
            resolveQuantizerParams(undefined, 'floydSteinberg', { floydSteinberg: { gamma: 1.6 } }, {
                gamma: 2,
            }).gamma,
        ).toBe(1.6);
        // The node param beats everything.
        expect(
            resolveQuantizerParams({ gamma: 0.8 }, 'floydSteinberg', { floydSteinberg: { gamma: 1.6 } }, {
                gamma: 2,
            }).gamma,
        ).toBe(0.8);
        // An explicit node 1 is a value, not an omission.
        expect(resolveQuantizerParams({ gamma: 1 }, 'floydSteinberg').gamma).toBe(1);
        // Another strategy's default never leaks: `threshold` stays neutral.
        expect(resolveQuantizerParams(undefined, 'threshold').gamma).toBe(1);
    });

    it('policyKeyOf differs when only gamma differs', () => {
        const a = resolveQuantizerParams(undefined, 'floydSteinberg');
        const b = resolveQuantizerParams({ gamma: 1.4 }, 'floydSteinberg');
        expect(a.gamma).toBe(1.3);
        expect(b.gamma).toBe(1.4);
        // Two nodes differing only in effective gamma must not share a slot.
        expect(policyKeyOf('floydSteinberg', a)).not.toBe(policyKeyOf('floydSteinberg', b));
        // The per-strategy defaults differ across strategies, so their keys differ too.
        expect(policyKeyOf('threshold', resolveQuantizerParams(undefined, 'threshold'))).not.toBe(
            policyKeyOf('floydSteinberg', resolveQuantizerParams(undefined, 'floydSteinberg')),
        );
    });

    it('keys the normalized gamma, so raw values that render identically share a slot', () => {
        const base = resolveQuantizerParams(undefined, 'floydSteinberg');
        const keyFor = (gamma: number): string => policyKeyOf('floydSteinberg', { ...base, gamma });
        // Non-finite collapses to the neutral 1 ...
        expect(keyFor(Infinity)).toBe(keyFor(1));
        expect(keyFor(-Infinity)).toBe(keyFor(1));
        expect(keyFor(NaN)).toBe(keyFor(1));
        // ... and an out-of-range value clamps, matching the clamped value.
        expect(keyFor(10)).toBe(keyFor(4));
        // A genuinely different in-range gamma still gets its own slot.
        expect(keyFor(1)).not.toBe(keyFor(1.3));
    });

    it('quantizerSettingsKey moves when gamma moves (preview/thumbnail cache key)', () => {
        // `quantizerSettingsKey` enumerates each strategy's param keys, so gamma
        // is included without a code change — assert it, since a stale key would
        // show a stale preview/thumbnail (R13-c).
        expect(quantizerSettingsKey({ floydSteinberg: { gamma: 1.3 } })).toContain('gamma=1.3');
        expect(quantizerSettingsKey({ floydSteinberg: { gamma: 1.3 } })).not.toBe(
            quantizerSettingsKey({ floydSteinberg: { gamma: 1.4 } }),
        );
        expect(quantizerSettingsKey({ threshold: { gamma: 1 } })).not.toBe(
            quantizerSettingsKey({ threshold: { gamma: 1.2 } }),
        );
    });
});

describe('screentone params (P4)', () => {
    it('keeps the render defaults in the policy layer', () => {
        expect(DEFAULT_SCREENTONE).toEqual({ levels: 4, pitchMm: 0.5, angle: 45 });
        expect(DEFAULT_GAMMA_BY_STRATEGY.screentone).toBe(1);
        // Never a default policy for a node type (a screentoned symbol will not scan).
        expect(Object.values(DEFAULT_POLICY_BY_TYPE)).not.toContain('screentone');
    });

    it('resolves node → strategy setting → render fallback → DEFAULT_SCREENTONE', () => {
        const bare = resolveQuantizerParams(undefined, 'screentone');
        expect(bare).toMatchObject({
            screentoneLevels: 4,
            screentonePitchMm: 0.5,
            screentoneAngle: 45,
        });

        // Render fallback beats the policy default ...
        const fallback = resolveQuantizerParams(undefined, 'screentone', undefined, {
            screentoneLevels: 3,
            screentonePitchMm: 0.8,
            screentoneAngle: 27,
        });
        expect(fallback).toMatchObject({
            screentoneLevels: 3,
            screentonePitchMm: 0.8,
            screentoneAngle: 27,
        });

        // ... a strategy setting beats the render fallback ...
        const settings = resolveQuantizerParams(
            undefined,
            'screentone',
            { screentone: { screentoneLevels: 5, screentonePitchMm: 1.2, screentoneAngle: 14 } },
            { screentoneLevels: 3, screentonePitchMm: 0.8, screentoneAngle: 27 },
        );
        expect(settings).toMatchObject({
            screentoneLevels: 5,
            screentonePitchMm: 1.2,
            screentoneAngle: 14,
        });

        // ... and an explicit node value beats everything.
        const node = resolveQuantizerParams(
            { screentoneLevels: 8, screentonePitchMm: 2, screentoneAngle: 0 },
            'screentone',
            { screentone: { screentoneLevels: 5 } },
            { screentoneLevels: 3 },
        );
        expect(node).toMatchObject({
            screentoneLevels: 8,
            screentonePitchMm: 2,
            screentoneAngle: 0,
        });
    });

    it('policyKeyOf differs when only one screentone knob differs', () => {
        const base = resolveQuantizerParams(undefined, 'screentone');
        const key = (params: Parameters<typeof resolveQuantizerParams>[0]) =>
            policyKeyOf('screentone', resolveQuantizerParams(params, 'screentone'));

        const baseKey = policyKeyOf('screentone', base);
        expect(key({ screentoneLevels: 5 })).not.toBe(baseKey);
        expect(key({ screentonePitchMm: 0.8 })).not.toBe(baseKey);
        expect(key({ screentoneAngle: 0 })).not.toBe(baseKey);
        expect(key({ screentoneAngle: 14 })).not.toBe(baseKey);
    });

    it('keys the pitch at 2 dp, so sub-0.01 mm differences share a slot', () => {
        const base = resolveQuantizerParams(undefined, 'screentone');
        const keyFor = (pitch: number) =>
            policyKeyOf('screentone', { ...base, screentonePitchMm: pitch });
        expect(keyFor(0.5)).toBe(keyFor(0.501));
        expect(keyFor(0.5)).not.toBe(keyFor(0.51));
    });

    it('quantizerSettingsKey carries the screentone settings (preview/thumbnail cache)', () => {
        const base = quantizerSettingsKey({ screentone: { screentoneLevels: 4 } });
        expect(base).toContain('screentone:screentoneLevels=4');
        expect(base).not.toBe(quantizerSettingsKey({ screentone: { screentoneLevels: 6 } }));
        expect(
            quantizerSettingsKey({ screentone: { screentonePitchMm: 0.5 } }),
        ).not.toBe(quantizerSettingsKey({ screentone: { screentonePitchMm: 0.8 } }));
        expect(
            quantizerSettingsKey({ screentone: { screentoneAngle: 0 } }),
        ).not.toBe(quantizerSettingsKey({ screentone: { screentoneAngle: 45 } }));
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
