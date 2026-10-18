/**
 * Public surface of the pure color pipeline (`src/core/render/`).
 *
 * Headless and React/Konva/DOM-free: operates on the structural `RgbaBuffer`
 * shape, not the DOM `ImageData`. The raster/editor layer owns canvas work.
 */

export { HM_PER_INCH, hmToPx, rasterDimensions, type RasterDimensions } from './dimensions';

export {
    COLOR_SPACES,
    MonoColorSpace,
    MONO_BLUE_WEIGHT,
    MONO_GREEN_WEIGHT,
    MONO_RED_WEIGHT,
    monoLuminance,
    toGrayBuffer,
    type ColorSpace,
    type ColorSpaceId,
    type RgbaBuffer,
} from './colorspace';

export {
    atkinson,
    buildToneLut,
    createDiffuser,
    createVariableDiffuser,
    floydSteinberg,
    GAMMA_MAX,
    GAMMA_MIN,
    normalizeGamma,
    ostromoukhov,
    QUANTIZERS,
    stucki,
    threshold,
    type Quantizer,
    type QuantizerDefaultParams,
    type QuantizerDefaults,
    type QuantizerId,
    type QuantizeOptions,
} from './quantize';

export {
    applyPolicy,
    DEFAULT_GAMMA_BY_STRATEGY,
    DEFAULT_POLICY_BY_TYPE,
    policyKeyOf,
    quantizerSettingsKey,
    resolveQuantizer,
    resolveQuantizerParams,
    type PolicyMask,
    type PolicyNode,
    type PolicyParams,
    type QuantizerByType,
    type QuantizerPolicies,
    type QuantizerPolicy,
    type ResolvedPolicyParams,
} from './policy';

export { quantizeRgba, type QuantizeRequest } from './pipeline';
